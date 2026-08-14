import Foundation
import ImageIO

public enum XMP {
    public static func sidecarURL(forImagePath path: String) -> URL {
        URL(fileURLWithPath: path).deletingPathExtension().appendingPathExtension("xmp")
    }

    public static func readSidecarRating(at url: URL) -> Int? {
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return parseRating(text)
    }

    static func parseRating(_ text: String) -> Int? {
        if let match = text.firstMatch(of: /xmp:Rating\s*=\s*"(-?\d+)"/) {
            return Int(match.1)
        }
        if let match = text.firstMatch(of: /<xmp:Rating>\s*(-?\d+)\s*<\/xmp:Rating>/) {
            return Int(match.1)
        }
        return nil
    }

    static func parseExposure(_ text: String) -> Double? {
        if let match = text.firstMatch(of: /crs:Exposure2012\s*=\s*"([-+]?[\d.]+)"/) {
            return Double(match.1)
        }
        if let match = text.firstMatch(of: /<crs:Exposure2012>\s*([-+]?[\d.]+)\s*<\/crs:Exposure2012>/) {
            return Double(match.1)
        }
        return nil
    }

    static func readEmbedded(at url: URL) -> (rating: Int?, exposure: Double?) {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
            let metadata = CGImageSourceCopyMetadataAtIndex(source, 0, nil)
        else { return (nil, nil) }
        var rating: Int?
        var exposure: Double?
        CGImageMetadataEnumerateTagsUsingBlock(metadata, nil, nil) { _, tag in
            guard let name = CGImageMetadataTagCopyName(tag) as String? else { return true }
            let namespace = CGImageMetadataTagCopyNamespace(tag) as String?
            let value = CGImageMetadataTagCopyValue(tag)
            if name == "Rating" && namespace == "http://ns.adobe.com/xap/1.0/" {
                if let text = value as? String { rating = Int(text) }
                if let number = value as? Int { rating = number }
            }
            if name == "Exposure2012" && namespace == "http://ns.adobe.com/camera-raw-settings/1.0/" {
                if let text = value as? String { exposure = Double(text) }
                if let number = value as? Double { exposure = number }
            }
            return true
        }
        return (rating, exposure)
    }

    public static func readRating(file: ImageFile) -> Int {
        if file.usesSidecar {
            return readSidecarRating(at: sidecarURL(forImagePath: file.path)) ?? 0
        }
        return embeddedCached(for: file).rating ?? 0
    }

    public static func readExposure(file: ImageFile) -> Double {
        if file.usesSidecar {
            guard
                let text = try? String(
                    contentsOf: sidecarURL(forImagePath: file.path), encoding: .utf8)
            else { return 0 }
            return parseExposure(text) ?? 0
        }
        return embeddedCached(for: file).exposure ?? 0
    }

    private static let cacheLock = NSLock()
    nonisolated(unsafe) private static var embeddedCache:
        [String: (mtime: Double, rating: Int?, exposure: Double?)] = [:]

    private static func embeddedCached(for file: ImageFile) -> (rating: Int?, exposure: Double?) {
        cacheLock.lock()
        if let cached = embeddedCache[file.path], cached.mtime == file.mtime {
            cacheLock.unlock()
            return (cached.rating, cached.exposure)
        }
        cacheLock.unlock()

        let read = readEmbedded(at: URL(fileURLWithPath: file.path))
        cacheLock.lock()
        embeddedCache[file.path] = (file.mtime, read.rating, read.exposure)
        cacheLock.unlock()
        return read
    }

    public static func writeRating(_ rating: Int, file: ImageFile, tool: ExifTool) throws {
        let tagArg = rating == 0 ? "-XMP:Rating=" : "-XMP:Rating=\(rating)"
        try write(tagArg, clearing: rating == 0, file: file, tool: tool)
    }

    public static func writeExposure(_ exposure: Double, file: ImageFile, tool: ExifTool) throws {
        let tagArg =
            exposure == 0
            ? "-XMP-crs:Exposure2012=" : "-XMP-crs:Exposure2012=\(exposure)"
        try write(tagArg, clearing: exposure == 0, file: file, tool: tool)
    }

    private static func write(
        _ tagArg: String, clearing: Bool, file: ImageFile, tool: ExifTool
    ) throws {
        if file.usesSidecar {
            let sidecar = sidecarURL(forImagePath: file.path)
            if FileManager.default.fileExists(atPath: sidecar.path) {
                try tool.write(["-overwrite_original", tagArg, sidecar.path])
            } else if !clearing {
                do {
                    try tool.write([tagArg, "-o", sidecar.path])
                } catch {
                    guard FileManager.default.fileExists(atPath: sidecar.path) else { throw error }
                    try tool.write(["-overwrite_original", tagArg, sidecar.path])
                }
            }
        } else {
            try tool.write(["-overwrite_original", tagArg, file.path])
        }
    }
}
