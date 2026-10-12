import CryptoKit
import Foundation

/// JPEGs named by a hash of what they were made from. An entry's mtime is when
/// it was last served, so pruning by age drops only what nobody looks at.
struct CacheFolder: Sendable {
    let dir: URL

    private static let maxAge: TimeInterval = 7 * 24 * 3600

    func url(forKey key: String) -> URL {
        let digest = SHA256.hash(data: Data(key.utf8))
            .map { String(format: "%02x", $0) }.joined().prefix(32)
        return dir.appendingPathComponent("\(digest).jpg")
    }

    /// `write` runs only on a miss, against a temp file that replaces `url`
    /// once complete, so a reader never sees half a JPEG.
    func file(at url: URL, write: (URL) throws -> Void) throws -> URL {
        let fm = FileManager.default
        if let modified = Self.modified(url) {
            // once a day is plenty to stay clear of a weekly prune
            if modified.timeIntervalSinceNow < -24 * 3600 {
                try? fm.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
            }
            return url
        }
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let temp = dir.appendingPathComponent("tmp-\(UUID().uuidString).jpg")
        try write(temp)
        _ = try? fm.replaceItemAt(url, withItemAt: temp)
        return url
    }

    func pruneInBackground() {
        DispatchQueue.global(qos: .utility).async { prune(olderThan: Self.maxAge) }
    }

    func prune(olderThan age: TimeInterval) {
        let cutoff = Date().addingTimeInterval(-age)
        let fm = FileManager.default
        guard
            let entries = try? fm.contentsOfDirectory(
                at: dir, includingPropertiesForKeys: [.contentModificationDateKey])
        else { return }
        for entry in entries where entry.pathExtension == "jpg" {
            if let modified = Self.modified(entry), modified < cutoff {
                try? fm.removeItem(at: entry)
            }
        }
    }

    private static func modified(_ url: URL) -> Date? {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
    }
}
