import CryptoKit
import Foundation

/// An entry's mtime is when it was last served, so pruning by age or size drops what nobody looks at first.
struct CacheFolder: Sendable {
    let dir: URL
    let maxBytes: Int

    private static let maxAge: TimeInterval = 7 * 24 * 3600
    private static let touchInterval: TimeInterval = 24 * 3600
    // a hit's touch and the prune's stat-then-delete must not interleave
    private static let lock = NSLock()

    func url(forKey key: String) -> URL {
        let digest = SHA256.hash(data: Data(key.utf8))
            .map { String(format: "%02x", $0) }.joined().prefix(32)
        return dir.appendingPathComponent("\(digest).jpg")
    }

    func cachedFile(at url: URL, orWrite write: (URL) throws -> Void) throws -> URL {
        let fm = FileManager.default
        let hit = Self.lock.withLock { () -> Bool in
            guard let modified = Self.modified(url) else { return false }
            if modified.timeIntervalSinceNow > -Self.touchInterval { return true }
            return (try? fm.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)) != nil
        }
        if hit { return url }
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        // a reader never sees half a JPEG
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
                at: dir, includingPropertiesForKeys: nil)
        else { return }
        var kept: [(url: URL, modified: Date, size: Int)] = []
        for var entry in entries where entry.pathExtension == "jpg" {
            entry.removeAllCachedResourceValues()
            Self.lock.withLock {
                guard
                    let values = try? entry.resourceValues(forKeys: [
                        .contentModificationDateKey, .fileSizeKey,
                    ]),
                    let modified = values.contentModificationDate
                else { return }
                if modified < cutoff {
                    try? fm.removeItem(at: entry)
                } else if !entry.lastPathComponent.hasPrefix("tmp-") {
                    kept.append((entry, modified, values.fileSize ?? 0))
                }
            }
        }
        var total = kept.reduce(0) { $0 + $1.size }
        for var file in kept.sorted(by: { $0.modified < $1.modified }) where total > maxBytes {
            file.url.removeAllCachedResourceValues()
            Self.lock.withLock {
                // served since the listing, so no longer the least recent
                guard Self.modified(file.url) == file.modified,
                    (try? fm.removeItem(at: file.url)) != nil
                else { return }
                total -= file.size
            }
        }
    }

    private static func modified(_ url: URL) -> Date? {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
    }
}
