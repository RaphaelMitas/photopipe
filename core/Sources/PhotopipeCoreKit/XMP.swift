import Foundation
import ImageIO

/// XMP rating conventions, Lightroom-compatible:
/// - proprietary raw (ARW): rating lives in a `<stem>.xmp` sidecar next to it
/// - DNG/JPG: rating embedded in the file's XMP packet
/// Writes go through exiftool; reads are native (sidecars are small XML,
/// embedded packets come out of ImageIO without decoding pixels).
public enum XMP {
    /// `DSC00832.ARW` → `DSC00832.xmp` (Lightroom's default sidecar naming).
    public static func sidecarURL(forImagePath path: String) -> URL {
        URL(fileURLWithPath: path).deletingPathExtension().appendingPathExtension("xmp")
    }

    /// Parse `xmp:Rating` out of a sidecar. Handles both serializations
    /// (attribute and element form).
    public static func readSidecarRating(at url: URL) -> Int? {
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        if let match = text.firstMatch(of: /xmp:Rating\s*=\s*"(-?\d+)"/) {
            return Int(match.1)
        }
        if let match = text.firstMatch(of: /<xmp:Rating>\s*(-?\d+)\s*<\/xmp:Rating>/) {
            return Int(match.1)
        }
        return nil
    }

    /// Read the embedded `xmp:Rating` from a JPG/DNG without decoding pixels.
    public static func readEmbeddedRating(at url: URL) -> Int? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
            let metadata = CGImageSourceCopyMetadataAtIndex(source, 0, nil),
            let tag = CGImageMetadataCopyTagWithPath(metadata, nil, "xmp:Rating" as CFString)
        else { return nil }
        if let value = CGImageMetadataTagCopyValue(tag) as? String {
            return Int(value)
        }
        if let value = CGImageMetadataTagCopyValue(tag) as? Int {
            return value
        }
        return nil
    }

    /// Rating for a logical image: sidecar wins (it's the raw's authority),
    /// else the furthest-stage embedded rating.
    public static func readRating(files: [FileRecord]) -> Int {
        for file in files where file.stage == .raw {
            if let rating = readSidecarRating(at: sidecarURL(forImagePath: file.path)) {
                return rating
            }
        }
        for file in files.sorted(by: { $0.stage.rank > $1.stage.rank }) where file.stage != .raw {
            if let rating = embeddedRatingCached(for: file) {
                return rating
            }
        }
        return 0
    }

    // MARK: - Embedded-read cache

    /// Embedded reads cost ~1-2ms each; rescans hit this (path, mtime)-keyed
    /// cache instead so watching a big library stays cheap.
    private static let cacheLock = NSLock()
    nonisolated(unsafe) private static var embeddedCache: [String: (mtime: Double, rating: Int?)] =
        [:]

    private static func embeddedRatingCached(for file: FileRecord) -> Int? {
        cacheLock.lock()
        if let cached = embeddedCache[file.path], cached.mtime == file.mtime {
            cacheLock.unlock()
            return cached.rating
        }
        cacheLock.unlock()

        let rating = readEmbeddedRating(at: URL(fileURLWithPath: file.path))
        cacheLock.lock()
        embeddedCache[file.path] = (file.mtime, rating)
        cacheLock.unlock()
        return rating
    }

    // MARK: - Writes

    /// Write a rating across a lineage group: sidecar for raws, embedded for
    /// the rest. Rating 0 clears the tag (Lightroom's "unrated").
    public static func writeRating(_ rating: Int, files: [FileRecord], tool: ExifTool) throws {
        let tagArg = rating == 0 ? "-XMP:Rating=" : "-XMP:Rating=\(rating)"
        for file in files {
            if file.stage == .raw {
                let sidecar = sidecarURL(forImagePath: file.path)
                if FileManager.default.fileExists(atPath: sidecar.path) {
                    try tool.write(["-overwrite_original", tagArg, sidecar.path])
                } else if rating != 0 {
                    // Create the sidecar from scratch — never touches the raw.
                    try tool.write([tagArg, "-o", sidecar.path])
                }
            } else {
                try tool.write(["-overwrite_original", tagArg, file.path])
            }
        }
    }
}
