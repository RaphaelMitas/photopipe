import CoreImage
import CryptoKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

public final class Renderer {
    public enum RenderError: Error {
        case unreadable(String)
        case encodeFailed
    }

    static let rawExtensions: Set<String> = ["arw", "dng", "cr2", "cr3", "nef", "raf", "orf", "rw2"]

    public let cacheDir: URL
    private let context = CIContext(options: [.cacheIntermediates: true])
    // an export renders each photo once, so there is nothing to reuse
    private let exportContext = CIContext(options: [.cacheIntermediates: false])
    private let jpegColorSpace = CGColorSpace(name: CGColorSpace.displayP3)!
    private let curveColorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

    // bump when the pixels change for an unchanged key; RAW 9 is why it is 2
    private static let pipelineVersion = 2

    /// What the decoder starts a file from. None of these are zero, so a
    /// slider left alone has to reach for them.
    public struct RawDefaults: Sendable {
        public let temperature: Double
        public let tint: Double
        public let denoise: Double
    }

    private struct CachedFilter {
        let filter: CIRAWFilter
        let mtime: Double
        let orientedSizeBeforeScaling: CGSize
        let defaults: RawDefaults
        var lastUsed: Date
    }

    private let lock = NSLock()
    // a zoom render and the preview behind it need different scaleFactors
    private var filtersByPathAndSize: [String: CachedFilter] = [:]
    private var defaultsByPath: [String: (values: RawDefaults, mtime: Double)] = [:]
    // the loupe holds current, both neighbours and a zoom render at once
    private let filterCapacity = 6

    public init(cacheDir: URL) {
        self.cacheDir = cacheDir
        let dir = cacheDir
        DispatchQueue.global(qos: .utility).async {
            Self.prune(cacheDir: dir, olderThan: 7 * 24 * 3600)
        }
    }

    public static func prune(cacheDir: URL, olderThan age: TimeInterval) {
        let cutoff = Date().addingTimeInterval(-age)
        let fm = FileManager.default
        guard
            let entries = try? fm.contentsOfDirectory(
                at: cacheDir, includingPropertiesForKeys: [.contentModificationDateKey])
        else { return }
        for entry in entries where entry.pathExtension == "jpg" {
            let modified = (try? entry.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate
            if let modified, modified < cutoff {
                try? fm.removeItem(at: entry)
            }
        }
    }

    public static func defaultCacheDir() -> URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Photopipe/renders")
    }

    public func cachePath(for file: ImageFile, edit: Edit, maxPixel: Int) -> URL {
        let key =
            "\(file.path)|\(file.mtime)|\(file.size)|\(edit.cacheKey)|\(maxPixel)|v\(Self.pipelineVersion)"
        let digest = SHA256.hash(data: Data(key.utf8))
            .map { String(format: "%02x", $0) }.joined().prefix(32)
        return cacheDir.appendingPathComponent("\(digest).jpg")
    }

    public func render(file: ImageFile, edit: Edit, maxPixel: Int) throws -> URL {
        let dest = cachePath(for: file, edit: edit, maxPixel: maxPixel)
        if FileManager.default.fileExists(atPath: dest.path) {
            return dest
        }
        try FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)

        var image = try sourceImage(for: file, edit: edit, maxPixel: maxPixel)
        // raws already decoded close to this; embedded formats did not
        let longEdge = max(image.extent.width, image.extent.height)
        let scale = maxPixel > 0 ? CGFloat(maxPixel) / longEdge : 1
        if scale < 1 {
            image = image.transformed(by: .init(scaleX: scale, y: scale))
        }

        guard
            let jpeg = context.jpegRepresentation(
                of: image, colorSpace: jpegColorSpace,
                options: [
                    kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.85
                ])
        else { throw RenderError.encodeFailed }

        let temp = cacheDir.appendingPathComponent("tmp-\(UUID().uuidString).jpg")
        try jpeg.write(to: temp)
        _ = try? FileManager.default.replaceItemAt(dest, withItemAt: temp)
        return dest
    }

    public func exportJPEG(
        file: ImageFile, edit: Edit, quality: Double, to destination: URL
    ) throws {
        let image = try sourceImage(for: file, edit: edit, maxPixel: 0)
        guard
            let jpeg = exportContext.jpegRepresentation(
                of: image, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                options: [
                    kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption:
                        quality
                ])
        else { throw RenderError.encodeFailed }
        let temp = destination.deletingLastPathComponent()
            .appendingPathComponent(".photopipe-\(UUID().uuidString).jpg")
        try jpeg.write(to: temp)
        do {
            try FileManager.default.moveItem(at: temp, to: destination)
        } catch {
            try? FileManager.default.removeItem(at: temp)
            throw error
        }
    }

    /// nil for embedded formats, which have no neutral to offset against.
    public func rawDefaults(for file: ImageFile) throws -> RawDefaults? {
        guard Self.rawExtensions.contains(file.ext.lowercased()) else { return nil }
        lock.lock()
        if let cached = defaultsByPath[file.path], cached.mtime == file.mtime {
            lock.unlock()
            return cached.values
        }
        lock.unlock()
        // reading these decodes nothing, so the filter is cheap and discarded
        return try makeFilter(for: file).defaults
    }

    private func sourceImage(for file: ImageFile, edit: Edit, maxPixel: Int) throws -> CIImage {
        var image: CIImage
        if Self.rawExtensions.contains(file.ext.lowercased()) {
            let cached = try rawFilter(for: file, maxPixel: maxPixel)
            let filter = cached.filter
            lock.lock()
            let scale = Self.rawScaleFactor(
                for: edit, orientedSize: cached.orientedSizeBeforeScaling, maxPixel: maxPixel)
            // assigning drops the cached intermediates a slider re-render needs
            if filter.scaleFactor != scale {
                filter.scaleFactor = scale
            }
            filter.exposure = Float(edit.exposure)
            filter.neutralTemperature = Float(edit.temperature ?? cached.defaults.temperature)
            filter.neutralTint = Float(edit.tint ?? cached.defaults.tint)
            if filter.isLuminanceNoiseReductionSupported {
                let denoise = edit.denoise.map { min(max($0, 0), 100) / 100 }
                filter.luminanceNoiseReductionAmount = Float(denoise ?? cached.defaults.denoise)
            }
            let output = filter.outputImage
            lock.unlock()
            guard let output else { throw RenderError.unreadable(file.path) }
            image = output
        } else {
            // the crop rect is against the displayed frame, not the sensor
            // layout, and the option drops the tag so nothing rotates twice
            guard
                let base = CIImage(
                    contentsOf: URL(fileURLWithPath: file.path),
                    options: [.applyOrientationProperty: true])
            else {
                throw RenderError.unreadable(file.path)
            }
            image = base
            if edit.exposure != 0 {
                image = image.applyingFilter(
                    "CIExposureAdjust", parameters: ["inputEV": edit.exposure])
            }
            let temperature = edit.temperature ?? 0
            let tint = edit.tint ?? 0
            if temperature != 0 || tint != 0 {
                // a lower target neutral renders warmer, so the sign flips to
                // match the raw pipeline's "higher temperature = warmer"
                image = image.applyingFilter(
                    "CITemperatureAndTint",
                    parameters: [
                        "inputNeutral": CIVector(x: 6500, y: 0),
                        "inputTargetNeutral": CIVector(x: 6500 - temperature * 20, y: -tint),
                    ])
            }
        }

        if let lut = ToneLUT.samples(for: edit) {
            image = image.applyingFilter(
                "CIColorCurves",
                parameters: [
                    "inputCurvesData": lut.withUnsafeBufferPointer { Data(buffer: $0) },
                    "inputCurvesDomain": CIVector(x: 0, y: 1),
                    "inputColorSpace": curveColorSpace,
                ])
        }
        if edit.vibrance != 0 {
            image = image.applyingFilter(
                "CIVibrance", parameters: ["inputAmount": edit.vibrance / 100])
        }
        if edit.saturation != 0 {
            image = image.applyingFilter(
                "CIColorControls", parameters: ["inputSaturation": 1 + edit.saturation / 100])
        }
        switch edit.normalizedRotation {
        case 90: image = image.oriented(forExifOrientation: 6)
        case 180: image = image.oriented(forExifOrientation: 3)
        case 270: image = image.oriented(forExifOrientation: 8)
        default: break
        }
        if edit.hasCropComponent {
            image = Self.applyCrop(edit, to: image)
        }
        return image
    }

    /// Crop values reach here from sidecars and IPC. nil means geometry Core
    /// Image cannot take, and the frame is left alone.
    static func saneCrop(_ edit: Edit) -> CropRect? {
        let crop = edit.crop ?? CropRect(left: 0, top: 0, right: 1, bottom: 1)
        guard crop.left.isFinite, crop.top.isFinite, crop.right.isFinite,
            crop.bottom.isFinite, crop.right > crop.left, crop.bottom > crop.top,
            edit.cropAngle.isFinite
        else { return nil }
        // a straightened photo's corners overhang, so values run past [0, 1]
        let sane: (Double) -> Double = { min(max($0, -1), 2) }
        return CropRect(
            left: sane(crop.left), top: sane(crop.top),
            right: sane(crop.right), bottom: sane(crop.bottom))
    }

    static func applyCrop(_ edit: Edit, to image: CIImage) -> CIImage {
        let extent = image.extent
        guard let crop = saneCrop(edit) else { return image }
        // Normalized coordinates are top-left-origin; CI's are bottom-left.
        let raw = CGRect(
            x: extent.minX + crop.left * extent.width,
            y: extent.minY + (1 - crop.bottom) * extent.height,
            width: (crop.right - crop.left) * extent.width,
            height: (crop.bottom - crop.top) * extent.height)
        // round inward, or a straightened crop gets a thin blank edge
        let rect = CGRect(
            x: raw.minX.rounded(.up), y: raw.minY.rounded(.up),
            width: max(raw.maxX.rounded(.down) - raw.minX.rounded(.up), 1),
            height: max(raw.maxY.rounded(.down) - raw.minY.rounded(.up), 1))
        var result = image
        if edit.cropAngle != 0 {
            // pivot on center, matching the UI where the photo stays put
            let center = CGPoint(x: extent.midX, y: extent.midY)
            // CI is y-up, so on-screen-clockwise negates here; CSS gets it raw
            let angle = -edit.cropAngle * .pi / 180
            result = result.transformed(
                by: CGAffineTransform(translationX: center.x, y: center.y)
                    .rotated(by: angle)
                    .translatedBy(x: -center.x, y: -center.y))
        }
        return result.cropped(to: rect)
            .transformed(by: .init(translationX: -rect.minX, y: -rect.minY))
    }

    /// How small the decoder itself may render. A preview that decodes the
    /// full sensor first costs RAW 9 about three times as much.
    static func rawScaleFactor(for edit: Edit, orientedSize: CGSize, maxPixel: Int) -> Float {
        guard maxPixel > 0, let crop = saneCrop(edit) else { return 1 }
        var width = orientedSize.width
        var height = orientedSize.height
        // the turn comes before the crop, so the fractions are against it
        if edit.normalizedRotation == 90 || edit.normalizedRotation == 270 {
            swap(&width, &height)
        }
        let longEdge = max(
            width * (crop.right - crop.left), height * (crop.bottom - crop.top))
        guard longEdge > 0 else { return 1 }
        return Float(min(CGFloat(maxPixel) / longEdge, 1))
    }

    private func rawFilter(for file: ImageFile, maxPixel: Int) throws -> CachedFilter {
        let key = "\(file.path)|\(maxPixel)"
        lock.lock()
        if let cached = filtersByPathAndSize[key], cached.mtime == file.mtime {
            filtersByPathAndSize[key]?.lastUsed = Date()
            lock.unlock()
            return cached
        }
        lock.unlock()

        let entry = try makeFilter(for: file)
        lock.lock()
        filtersByPathAndSize[key] = entry
        if filtersByPathAndSize.count > filterCapacity {
            let oldest = filtersByPathAndSize.min { $0.value.lastUsed < $1.value.lastUsed }
            if let oldest { filtersByPathAndSize.removeValue(forKey: oldest.key) }
        }
        lock.unlock()
        return entry
    }

    private func makeFilter(for file: ImageFile) throws -> CachedFilter {
        guard let filter = CIRAWFilter(imageURL: URL(fileURLWithPath: file.path)) else {
            throw RenderError.unreadable(file.path)
        }
        // RAW 9 is opt-in and the list is sorted oldest to newest. Reading it
        // beats naming a version: older Macs still get their best, RAW 10 is free.
        if let newest = filter.supportedDecoderVersions.last {
            filter.decoderVersion = newest
        }
        let entry = CachedFilter(
            filter: filter, mtime: file.mtime,
            orientedSizeBeforeScaling: filter.outputImage?.extent.size ?? filter.nativeSize,
            defaults: RawDefaults(
                temperature: Double(filter.neutralTemperature),
                tint: Double(filter.neutralTint),
                denoise: Double(filter.luminanceNoiseReductionAmount)),
            lastUsed: Date())
        lock.lock()
        defaultsByPath[file.path] = (entry.defaults, file.mtime)
        lock.unlock()
        return entry
    }
}
