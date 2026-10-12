import Foundation
import ImageIO
import UniformTypeIdentifiers

public struct Thumbnailer: Sendable {
    public enum ThumbnailError: Error {
        case unreadable(String)
        case encodeFailed
    }

    private let cache: CacheFolder

    public init(cacheDir: URL) {
        cache = CacheFolder(dir: cacheDir)
        cache.pruneInBackground()
    }

    public static func defaultCacheDir() -> URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Photopipe/thumbs")
    }

    public func cachePath(for file: ImageFile, maxPixel: Int) -> URL {
        cache.url(forKey: "\(file.path)|\(file.mtime)|\(file.size)|\(maxPixel)")
    }

    public func thumbnail(for file: ImageFile, maxPixel: Int) throws -> URL {
        try cache.file(at: cachePath(for: file, maxPixel: maxPixel)) { temp in
            let url = URL(fileURLWithPath: file.path)
            guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
                throw ThumbnailError.unreadable(file.path)
            }
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceCreateThumbnailFromImageIfAbsent: true,
                kCGImageSourceThumbnailMaxPixelSize: maxPixel,
            ]
            guard
                let cgImage = CGImageSourceCreateThumbnailAtIndex(
                    source, 0, options as CFDictionary)
            else {
                throw ThumbnailError.unreadable(file.path)
            }
            guard
                let destination = CGImageDestinationCreateWithURL(
                    temp as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
            else {
                throw ThumbnailError.encodeFailed
            }
            CGImageDestinationAddImage(
                destination, cgImage,
                [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
            guard CGImageDestinationFinalize(destination) else {
                throw ThumbnailError.encodeFailed
            }
        }
    }
}
