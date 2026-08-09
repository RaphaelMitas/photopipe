import CoreImage
import CryptoKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Loupe renderer. Raw files go through `CIRAWFilter` so exposure is applied
/// in the raw pipeline on the GPU (the Phase 0 spike measured ~35ms warm
/// scrubs at loupe resolution); non-raw files get `CIExposureAdjust` so the
/// slider works everywhere. Output JPEGs land in a content-keyed disk cache
/// served over the asset protocol, like thumbnails.
public final class Renderer {
    public enum RenderError: Error {
        case unreadable(String)
        case encodeFailed
    }

    /// Extensions routed through the raw pipeline.
    static let rawExtensions: Set<String> = ["arw", "dng", "cr2", "cr3", "nef", "raf", "orf", "rw2"]

    public let cacheDir: URL
    private let context = CIContext(options: [.cacheIntermediates: true])
    private let jpegColorSpace = CGColorSpace(name: CGColorSpace.displayP3)!

    /// Warm-scrub cache: a live CIRAWFilter per recently-touched file, so
    /// dragging the exposure slider re-renders instead of re-decoding.
    private let lock = NSLock()
    private var filters: [String: (filter: CIRAWFilter, mtime: Double, lastUsed: Date)] = [:]
    private let filterCapacity = 4

    public init(cacheDir: URL) {
        self.cacheDir = cacheDir
        // Every exposure step writes a 1–2MB JPEG that would otherwise live
        // forever; long culling sessions add up to gigabytes. Renders are
        // cheap to recreate, so anything a week old goes.
        let dir = cacheDir
        DispatchQueue.global(qos: .utility).async {
            Self.prune(cacheDir: dir, olderThan: 7 * 24 * 3600)
        }
    }

    /// Delete cached renders whose mtime is older than the cutoff.
    /// Synchronous; callers decide the queue.
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

    public func cachePath(for file: FileRecord, exposure: Double, maxPixel: Int) -> URL {
        let key = "\(file.path)|\(file.mtime)|\(file.size)|\(exposure)|\(maxPixel)"
        let digest = SHA256.hash(data: Data(key.utf8))
            .map { String(format: "%02x", $0) }.joined().prefix(32)
        return cacheDir.appendingPathComponent("\(digest).jpg")
    }

    /// Returns the cached render, generating it on miss.
    public func render(file: FileRecord, exposure: Double, maxPixel: Int) throws -> URL {
        let dest = cachePath(for: file, exposure: exposure, maxPixel: maxPixel)
        if FileManager.default.fileExists(atPath: dest.path) {
            return dest
        }
        try FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)

        var image = try sourceImage(for: file, exposure: exposure)
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

        // Atomic publish, same as the thumbnailer.
        let temp = cacheDir.appendingPathComponent("tmp-\(UUID().uuidString).jpg")
        try jpeg.write(to: temp)
        _ = try? FileManager.default.replaceItemAt(dest, withItemAt: temp)
        return dest
    }

    private func sourceImage(for file: FileRecord, exposure: Double) throws -> CIImage {
        if Self.rawExtensions.contains(file.ext.lowercased()) {
            let filter = try rawFilter(for: file)
            // CIRAWFilter instances are not thread-safe per instance; property
            // set + outputImage under the cache lock keeps scrubs correct when
            // two requests race on the same file.
            lock.lock()
            defer { lock.unlock() }
            filter.exposure = Float(exposure)
            guard let image = filter.outputImage else {
                throw RenderError.unreadable(file.path)
            }
            return image
        }

        guard let base = CIImage(contentsOf: URL(fileURLWithPath: file.path)) else {
            throw RenderError.unreadable(file.path)
        }
        guard exposure != 0 else { return base }
        return base.applyingFilter("CIExposureAdjust", parameters: ["inputEV": exposure])
    }

    private func rawFilter(for file: FileRecord) throws -> CIRAWFilter {
        lock.lock()
        defer { lock.unlock() }
        if let cached = filters[file.path], cached.mtime == file.mtime {
            filters[file.path]?.lastUsed = Date()
            return cached.filter
        }
        guard let filter = CIRAWFilter(imageURL: URL(fileURLWithPath: file.path)) else {
            throw RenderError.unreadable(file.path)
        }
        filters[file.path] = (filter, file.mtime, Date())
        if filters.count > filterCapacity {
            let oldest = filters.min { $0.value.lastUsed < $1.value.lastUsed }
            if let oldest { filters.removeValue(forKey: oldest.key) }
        }
        return filter
    }
}
