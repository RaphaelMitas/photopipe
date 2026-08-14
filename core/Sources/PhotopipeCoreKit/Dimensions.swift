import Foundation
import ImageIO

public enum Dimensions {
    public static let fallback = (width: 3000, height: 2000)

    public static func read(at url: URL) -> (width: Int, height: Int)? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
            let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
            let width = props[kCGImagePropertyPixelWidth] as? Int,
            let height = props[kCGImagePropertyPixelHeight] as? Int,
            width > 0, height > 0
        else { return nil }
        let orientation = props[kCGImagePropertyOrientation] as? UInt32 ?? 1
        return orientation >= 5 ? (height, width) : (width, height)
    }

    private static let cacheLock = NSLock()
    nonisolated(unsafe) private static var cache:
        [String: (mtime: Double, dims: (width: Int, height: Int)?)] = [:]

    public static func cached(for file: ImageFile) -> (width: Int, height: Int)? {
        cacheLock.lock()
        if let entry = cache[file.path], entry.mtime == file.mtime {
            cacheLock.unlock()
            return entry.dims
        }
        cacheLock.unlock()

        let dims = read(at: URL(fileURLWithPath: file.path))
        cacheLock.lock()
        cache[file.path] = (file.mtime, dims)
        cacheLock.unlock()
        return dims
    }
}
