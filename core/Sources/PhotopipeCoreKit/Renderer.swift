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
    private let jpegColorSpace = CGColorSpace(name: CGColorSpace.displayP3)!
    private let curveColorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

    private struct CachedFilter {
        let filter: CIRAWFilter
        let mtime: Double
        let asShotTemperature: Double
        let asShotTint: Double
        var lastUsed: Date
    }

    private let lock = NSLock()
    private var filters: [String: CachedFilter] = [:]
    private let filterCapacity = 4

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
        let key = "\(file.path)|\(file.mtime)|\(file.size)|\(edit.cacheKey)|\(maxPixel)"
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

        var image = try sourceImage(for: file, edit: edit)
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
        file: ImageFile, edit: Edit, quality: Double, to destination: URL
    ) throws {
        let image = try sourceImage(for: file, edit: edit)
        guard
            let jpeg = context.jpegRepresentation(
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

    /// The as-shot white balance a raw decode starts from; nil for embedded
    /// formats, where there is no known neutral to offset against.
    public func whiteBalance(for file: ImageFile) throws -> (temperature: Double, tint: Double)? {
        guard Self.rawExtensions.contains(file.ext.lowercased()) else { return nil }
        let cached = try rawFilter(for: file)
        return (cached.asShotTemperature, cached.asShotTint)
    }

    private func sourceImage(for file: ImageFile, edit: Edit) throws -> CIImage {
        var image: CIImage
        if Self.rawExtensions.contains(file.ext.lowercased()) {
            let cached = try rawFilter(for: file)
            lock.lock()
            cached.filter.exposure = Float(edit.exposure)
            cached.filter.neutralTemperature = Float(
                edit.temperature ?? cached.asShotTemperature)
            cached.filter.neutralTint = Float(edit.tint ?? cached.asShotTint)
            let output = cached.filter.outputImage
            lock.unlock()
            guard let output else { throw RenderError.unreadable(file.path) }
            image = output
        } else {
            // Bake EXIF orientation into the pixels (the option also drops the
            // tag, so the encoded JPEG is not rotated twice): the crop rect is
            // defined against the displayed frame, not the sensor layout.
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
                // Moving the target neutral down in Kelvin renders warmer, so
                // the slider sign flips here to match the raw pipeline's
                // "higher temperature = warmer".
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
        // The turn comes before the crop: the rect is defined against the
        // turned frame.
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

    static func applyCrop(_ edit: Edit, to image: CIImage) -> CIImage {
        let extent = image.extent
        let crop = edit.crop ?? CropRect(left: 0, top: 0, right: 1, bottom: 1)
        // Values reach here from sidecars and IPC; refuse geometry that would
        // put NaN or a negative size into Core Image.
        guard crop.left.isFinite, crop.top.isFinite, crop.right.isFinite,
            crop.bottom.isFinite, crop.right > crop.left, crop.bottom > crop.top,
            edit.cropAngle.isFinite
        else { return image }
        // A straightened photo's corners overhang the frame box, so crop
        // values may run past [0, 1]; one frame beyond is plenty for any
        // rotation, and clamping there keeps hostile values bounded.
        let sane: (Double) -> Double = { min(max($0, -1), 2) }
        let left = sane(crop.left)
        let top = sane(crop.top)
        let right = sane(crop.right)
        let bottom = sane(crop.bottom)
        // Normalized coordinates are top-left-origin; CI's are bottom-left.
        let raw = CGRect(
            x: extent.minX + left * extent.width,
            y: extent.minY + (1 - bottom) * extent.height,
            width: (right - left) * extent.width,
            height: (bottom - top) * extent.height)
        // Round inward: expanding past the rotated photo's coverage would
        // leave a thin blank edge on straightened crops.
        let rect = CGRect(
            x: raw.minX.rounded(.up), y: raw.minY.rounded(.up),
            width: max(raw.maxX.rounded(.down) - raw.minX.rounded(.up), 1),
            height: max(raw.maxY.rounded(.down) - raw.minY.rounded(.up), 1))
        var result = image
        if edit.cropAngle != 0 {
            // The straighten pivot is the photo's center (matching the UI:
            // the photo stays put while the crop rect moves over it).
            let center = CGPoint(x: extent.midX, y: extent.midY)
            // CI coordinates are y-up, so the on-screen-clockwise convention
            // needs the negated angle here (CSS rotate() gets the raw value).
            let angle = -edit.cropAngle * .pi / 180
            result = result.transformed(
                by: CGAffineTransform(translationX: center.x, y: center.y)
                    .rotated(by: angle)
                    .translatedBy(x: -center.x, y: -center.y))
        }
        return result.cropped(to: rect)
            .transformed(by: .init(translationX: -rect.minX, y: -rect.minY))
    }

    private func rawFilter(for file: ImageFile) throws -> CachedFilter {
        lock.lock()
        defer { lock.unlock() }
        if let cached = filters[file.path], cached.mtime == file.mtime {
            filters[file.path]?.lastUsed = Date()
            return cached
        }
        guard let filter = CIRAWFilter(imageURL: URL(fileURLWithPath: file.path)) else {
            throw RenderError.unreadable(file.path)
        }
        let entry = CachedFilter(
            filter: filter, mtime: file.mtime,
            asShotTemperature: Double(filter.neutralTemperature),
            asShotTint: Double(filter.neutralTint),
            lastUsed: Date())
        filters[file.path] = entry
        if filters.count > filterCapacity {
            let oldest = filters.min { $0.value.lastUsed < $1.value.lastUsed }
            if let oldest { filters.removeValue(forKey: oldest.key) }
        }
        return entry
    }
}
