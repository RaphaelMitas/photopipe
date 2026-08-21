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

    // bump when the pixels change for an unchanged key
    private static let pipelineVersion = 2

    /// None of these are zero, so a slider left alone has to reach for them.
    public struct RawDefaults: Sendable {
        public let temperature: Double
        public let tint: Double
        public let denoise: Double
    }

    struct CachedFilter {
        let filter: CIRAWFilter
        let mtime: Double
        let orientedSizeBeforeScaling: CGSize
        let defaults: RawDefaults
        var lastUsed: Date
    }

    private let lock = NSLock()
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

    public func cachePath(
        for file: ImageFile, edit: Edit, maxPixel: Int, viewport: CropRect? = nil,
        decoderVersion: Int? = nil
    ) -> URL {
        let region = viewport.map { "|\($0.left),\($0.top),\($0.right),\($0.bottom)" } ?? ""
        let decoder = decoderVersion.map { "|d\($0)" } ?? ""
        let key =
            "\(file.path)|\(file.mtime)|\(file.size)|\(edit.cacheKey)|\(maxPixel)\(region)\(decoder)|v\(Self.pipelineVersion)"
        let digest = SHA256.hash(data: Data(key.utf8))
            .map { String(format: "%02x", $0) }.joined().prefix(32)
        return cacheDir.appendingPathComponent("\(digest).jpg")
    }

    public func render(
        file: ImageFile, edit: Edit, maxPixel: Int, viewport: CropRect? = nil,
        decoderVersion: Int? = nil
    ) throws -> URL {
        guard maxPixel > 0 else { throw RenderError.encodeFailed }
        let dest = cachePath(
            for: file, edit: edit, maxPixel: maxPixel, viewport: viewport,
            decoderVersion: decoderVersion)
        if FileManager.default.fileExists(atPath: dest.path) {
            return dest
        }
        try FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)

        var image = try sourceImage(
            for: file, edit: edit, maxPixel: maxPixel, viewport: viewport,
            decoderVersion: decoderVersion)
        // raws already decoded close to this; embedded formats did not
        let longEdge = max(image.extent.width, image.extent.height)
        let scale = CGFloat(maxPixel) / longEdge
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
        file: ImageFile, edit: Edit, quality: Double, to destination: URL,
        decoderVersion: Int? = nil
    ) throws {
        let image = try sourceImage(
            for: file, edit: edit, maxPixel: nil, decoderVersion: decoderVersion)
        // A full-resolution render holds on to surfaces the context will happily
        // keep for the next one. Nothing else reuses them, and about a hundred
        // in they stop being handed out at all: every render after that comes
        // back nil while memory still looks fine.
        defer { exportContext.clearCaches() }
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
    public func rawDefaults(for file: ImageFile, decoderVersion: Int? = nil) throws -> RawDefaults?
    {
        guard Self.rawExtensions.contains(file.ext.lowercased()) else { return nil }
        let key = Self.defaultsKey(path: file.path, decoderVersion: decoderVersion)
        lock.lock()
        if let cached = defaultsByPath[key], cached.mtime == file.mtime {
            lock.unlock()
            return cached.values
        }
        lock.unlock()
        // reading these decodes nothing, so the filter is cheap and discarded
        return try makeFilter(for: file, decoderVersion: decoderVersion).defaults
    }

    /// A nil maxPixel renders the full sensor, for export.
    private func sourceImage(
        for file: ImageFile, edit: Edit, maxPixel: Int?, viewport: CropRect? = nil,
        decoderVersion: Int? = nil
    ) throws -> CIImage {
        var image: CIImage
        if Self.rawExtensions.contains(file.ext.lowercased()) {
            let cached = try rawFilter(
                for: file, maxPixel: maxPixel, decoderVersion: decoderVersion)
            let filter = cached.filter
            lock.lock()
            let scale = Self.rawScaleFactor(
                for: edit, orientedSize: cached.orientedSizeBeforeScaling, maxPixel: maxPixel,
                viewport: viewport)
            // Unconditionally, even when unchanged: skipping the assignment
            // when it already matched returned a decode a quarter of the size
            // on the next read. Re-assigning does not cost the warm path.
            filter.scaleFactor = scale
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
        if let viewport {
            image = Self.applyViewport(viewport, to: image)
        }
        return image
    }

    static func saneCrop(_ edit: Edit) -> CropRect? {
        guard edit.cropAngle.isFinite else { return nil }
        return (edit.crop ?? .full).sanitized()
    }

    /// Normalized coordinates are top-left-origin; CI's are bottom-left.
    /// Rounds inward, or a straightened crop gets a thin blank edge.
    static func pixelRect(for crop: CropRect, in extent: CGRect) -> CGRect {
        let raw = CGRect(
            x: extent.minX + crop.left * extent.width,
            y: extent.minY + (1 - crop.bottom) * extent.height,
            width: crop.width * extent.width,
            height: crop.height * extent.height)
        return CGRect(
            x: raw.minX.rounded(.up), y: raw.minY.rounded(.up),
            width: max(raw.maxX.rounded(.down) - raw.minX.rounded(.up), 1),
            height: max(raw.maxY.rounded(.down) - raw.minY.rounded(.up), 1))
    }

    /// The sub-rect of the edited frame the loupe is actually showing. Not an
    /// edit: it never reaches a sidecar, and it composes on top of the crop.
    static func applyViewport(_ viewport: CropRect, to image: CIImage) -> CIImage {
        guard let sane = viewport.sanitized() else { return image }
        let rect = pixelRect(for: sane, in: image.extent)
        return image.cropped(to: rect)
            .transformed(by: .init(translationX: -rect.minX, y: -rect.minY))
    }

    static func applyCrop(_ edit: Edit, to image: CIImage) -> CIImage {
        let extent = image.extent
        guard let crop = saneCrop(edit) else { return image }
        let rect = pixelRect(for: crop, in: extent)
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

    /// A preview that decodes the full sensor first costs RAW 9 three times
    /// as much.
    static func rawScaleFactor(
        for edit: Edit, orientedSize: CGSize, maxPixel: Int?, viewport: CropRect? = nil
    ) -> Float {
        guard let maxPixel, maxPixel > 0, let crop = saneCrop(edit) else { return 1 }
        var width = orientedSize.width
        var height = orientedSize.height
        // the turn comes before the crop, so the fractions are against it
        if edit.normalizedRotation == 90 || edit.normalizedRotation == 270 {
            swap(&width, &height)
        }
        let region = viewport?.sanitized() ?? .full
        let longEdge = max(
            width * crop.width * region.width, height * crop.height * region.height)
        guard longEdge > 0 else { return 1 }
        return Float(min(CGFloat(maxPixel) / longEdge, 1))
    }

    private func rawFilter(
        for file: ImageFile, maxPixel: Int?, decoderVersion: Int?
    ) throws -> CachedFilter {
        let key =
            "\(file.path)|\(maxPixel.map(String.init) ?? "full")|d\(decoderVersion.map(String.init) ?? "")"
        lock.lock()
        if let cached = filtersByPathAndSize[key], cached.mtime == file.mtime {
            filtersByPathAndSize[key]?.lastUsed = Date()
            lock.unlock()
            return cached
        }
        lock.unlock()

        let entry = try makeFilter(for: file, decoderVersion: decoderVersion)
        lock.lock()
        filtersByPathAndSize[key] = entry
        if filtersByPathAndSize.count > filterCapacity {
            let oldest = filtersByPathAndSize.min { $0.value.lastUsed < $1.value.lastUsed }
            if let oldest { filtersByPathAndSize.removeValue(forKey: oldest.key) }
        }
        lock.unlock()
        return entry
    }

    /// An unsupported request falls back to the newest, never to a nil image:
    /// setting a version the file does not offer makes outputImage nil.
    static func resolveDecoder(
        requested: Int?, supported: [CIRAWDecoderVersion]
    ) -> CIRAWDecoderVersion? {
        let preferred: [CIRAWDecoderVersion]
        switch requested {
        case 9: preferred = [.version9, .version9DNG]
        case 8: preferred = [.version8, .version8DNG]
        default: preferred = []
        }
        // RAW 9 is opt-in, and the list is sorted oldest to newest
        return preferred.first(where: supported.contains) ?? supported.last
    }

    private static func defaultsKey(path: String, decoderVersion: Int?) -> String {
        "\(path)|d\(decoderVersion.map(String.init) ?? "")"
    }

    func makeFilter(for file: ImageFile, decoderVersion: Int? = nil) throws -> CachedFilter {
        guard let filter = CIRAWFilter(imageURL: URL(fileURLWithPath: file.path)) else {
            throw RenderError.unreadable(file.path)
        }
        if let version = Self.resolveDecoder(
            requested: decoderVersion, supported: filter.supportedDecoderVersions)
        {
            filter.decoderVersion = version
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
        defaultsByPath[Self.defaultsKey(path: file.path, decoderVersion: decoderVersion)] = (
            entry.defaults, file.mtime
        )
        lock.unlock()
        return entry
    }
}
