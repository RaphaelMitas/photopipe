import Foundation
import ImageIO

public enum Dimensions {
    public static let fallback = (width: 3000, height: 2000)

    static func properties(at url: URL) -> [CFString: Any]? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        return CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    }

    public static func read(at url: URL) -> (width: Int, height: Int)? {
        properties(at: url).flatMap(dimensions)
    }

    static func dimensions(_ props: [CFString: Any]) -> (width: Int, height: Int)? {
        guard let width = props[kCGImagePropertyPixelWidth] as? Int,
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

    /// Seconds since the epoch, read as if the camera clock were UTC: only the gaps between
    /// photos matter, and a camera does not record which zone it was set to.
    static func captureTime(_ props: [CFString: Any]) -> Double? {
        guard let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any],
            let stamp = exif[kCGImagePropertyExifDateTimeOriginal] as? String,
            let date = exifDate.date(from: stamp)
        else { return nil }
        // digits only: "1e999" would parse to infinity and fail encoding the whole shoot
        let fraction =
            (exif[kCGImagePropertyExifSubsecTimeOriginal] as? String)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .flatMap { $0.isEmpty || !$0.allSatisfy { "0"..."9" ~= $0 } ? nil : Double("0." + $0) }
            ?? 0
        return date.timeIntervalSince1970 + fraction
    }

    private static let exifDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy:MM:dd HH:mm:ss"
        return formatter
    }()

    public struct Header: Sendable {
        public let dimensions: (width: Int, height: Int)?
        public let captured: Double?
        public let exif: Exif
    }

    private static let cacheLock = NSLock()
    nonisolated(unsafe) private static var cache: [String: (mtime: Double, size: Int64, header: Header)] = [:]

    public static func header(for file: ImageFile) -> Header {
        cacheLock.lock()
        if let entry = cache[file.path], entry.mtime == file.mtime, entry.size == file.size {
            cacheLock.unlock()
            return entry.header
        }
        cacheLock.unlock()

        let props = properties(at: URL(fileURLWithPath: file.path)) ?? [:]
        let header = Header(
            dimensions: dimensions(props), captured: captureTime(props), exif: Exif(props))
        cacheLock.lock()
        cache[file.path] = (file.mtime, file.size, header)
        cacheLock.unlock()
        return header
    }
}
