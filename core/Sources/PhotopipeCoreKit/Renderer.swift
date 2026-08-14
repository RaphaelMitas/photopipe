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

    private let lock = NSLock()
    private var filters: [String: (filter: CIRAWFilter, mtime: Double, lastUsed: Date)] = [:]
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

    public func cachePath(for file: ImageFile, exposure: Double, maxPixel: Int) -> URL {
        let key = "\(file.path)|\(file.mtime)|\(file.size)|\(exposure)|\(maxPixel)"
        let digest = SHA256.hash(data: Data(key.utf8))
            .map { String(format: "%02x", $0) }.joined().prefix(32)
        return cacheDir.appendingPathComponent("\(digest).jpg")
    }

    public func render(file: ImageFile, exposure: Double, maxPixel: Int) throws -> URL {
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

        let temp = cacheDir.appendingPathComponent("tmp-\(UUID().uuidString).jpg")
        try jpeg.write(to: temp)
        _ = try? FileManager.default.replaceItemAt(dest, withItemAt: temp)
        return dest
    }

    public func exportJPEG(
        file: ImageFile, exposure: Double, quality: Double, to destination: URL
    ) throws {
        let image = try sourceImage(for: file, exposure: exposure)
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

    private func sourceImage(for file: ImageFile, exposure: Double) throws -> CIImage {
        if Self.rawExtensions.contains(file.ext.lowercased()) {
            let filter = try rawFilter(for: file)
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

    private func rawFilter(for file: ImageFile) throws -> CIRAWFilter {
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
