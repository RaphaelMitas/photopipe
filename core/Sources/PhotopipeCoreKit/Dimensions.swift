import Foundation
import ImageIO

public enum Dimensions {
    public static let fallback = (width: 3000, height: 2000)

    static func properties(at url: URL) -> [CFString: Any]? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        return CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    }

    public static func read(at url: URL) -> (width: Int, height: Int)? {
        guard let props = properties(at: url),
            let width = props[kCGImagePropertyPixelWidth] as? Int,
            let height = props[kCGImagePropertyPixelHeight] as? Int,
            width > 0, height > 0
        else { return nil }
        let orientation = props[kCGImagePropertyOrientation] as? UInt32 ?? 1
        return orientation >= 5 ? (height, width) : (width, height)
    }

    public static func captureDay(at url: URL) -> String? {
        if let props = properties(at: url) {
            let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any]
            let tiff = props[kCGImagePropertyTIFFDictionary] as? [CFString: Any]
            let stamp =
                (exif?[kCGImagePropertyExifDateTimeOriginal] as? String)
                ?? (exif?[kCGImagePropertyExifDateTimeDigitized] as? String)
                ?? (tiff?[kCGImagePropertyTIFFDateTime] as? String)
            // EXIF stamps are "yyyy:MM:dd HH:mm:ss"
            if let date = stamp?.prefix(10).replacingOccurrences(of: ":", with: "-"), isDay(date) {
                return date
            }
        }
        guard
            let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate
        else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let c = calendar.dateComponents([.year, .month, .day], from: modified)
        guard let y = c.year, let m = c.month, let d = c.day else { return nil }
        return String(format: "%04d-%02d-%02d", y, m, d)
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
