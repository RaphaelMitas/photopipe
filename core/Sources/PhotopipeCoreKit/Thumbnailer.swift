import CryptoKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

public struct Thumbnailer: Sendable {
    public enum ThumbnailError: Error {
        case unreadable(String)
        case encodeFailed
    }

    public let cacheDir: URL

    public init(cacheDir: URL) {
        self.cacheDir = cacheDir
    }

    public static func defaultCacheDir() -> URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Photopipe/thumbs")
    }

    public func cachePath(for file: ImageFile, maxPixel: Int) -> URL {
        let key = "\(file.path)|\(file.mtime)|\(file.size)|\(maxPixel)"
        let digest = SHA256.hash(data: Data(key.utf8))
            .map { String(format: "%02x", $0) }.joined().prefix(32)
        return cacheDir.appendingPathComponent("\(digest).jpg")
    }

    public func thumbnail(for file: ImageFile, maxPixel: Int) throws -> URL {
        let dest = cachePath(for: file, maxPixel: maxPixel)
        if FileManager.default.fileExists(atPath: dest.path) {
            return dest
        }
        try FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)

        let url = URL(fileURLWithPath: file.path)
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
            throw ThumbnailError.unreadable(file.path)
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceCreateThumbnailFromImageIfAbsent: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
        else {
            throw ThumbnailError.unreadable(file.path)
        }

        let temp = cacheDir.appendingPathComponent("tmp-\(UUID().uuidString).jpg")
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
        _ = try? FileManager.default.replaceItemAt(dest, withItemAt: temp)
        return dest
    }
}
