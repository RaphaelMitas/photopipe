import CryptoKit
import Foundation
import Synchronization

/// An entry's mtime is when it was last served, so pruning by age or size drops what nobody looks at first.
final class CacheFolder: Sendable {
    let dir: URL
    let maxBytes: Int

    private struct Usage {
        var estimatedBytes = 0
        var pruning = false
    }

    private static let maxAge: TimeInterval = 7 * 24 * 3600
    // a hit's touch and the prune's stat-then-delete must not interleave
    private static let lock = NSLock()
    private let usage = Mutex(Usage())

    init(dir: URL, maxBytes: Int) {
        self.dir = dir
        self.maxBytes = maxBytes
    }

    func url(forKey key: String) -> URL {
        let digest = SHA256.hash(data: Data(key.utf8))
            .map { String(format: "%02x", $0) }.joined().prefix(32)
        return dir.appendingPathComponent("\(digest).jpg")
    }

    func cachedFile(at url: URL, orWrite write: (URL) throws -> Void) throws -> URL {
        let fm = FileManager.default
        let hit = Self.lock.withLock {
            (try? fm.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)) != nil
        }
        if hit { return url }
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        // a reader never sees half a JPEG
        let temp = dir.appendingPathComponent("tmp-\(UUID().uuidString).jpg")
        try write(temp)
        let bytes = (try? temp.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
        _ = try? fm.replaceItemAt(url, withItemAt: temp)
        let overBudget = usage.withLock {
            $0.estimatedBytes += bytes
            return $0.estimatedBytes > maxBytes
        }
        if overBudget { pruneInBackground() }
        return url
    }

    func pruneInBackground() {
        let start = usage.withLock {
            guard !$0.pruning else { return false }
            $0.pruning = true
            // writes landing during the prune count on top of what it leaves
            $0.estimatedBytes = 0
            return true
        }
        guard start else { return }
        DispatchQueue.global(qos: .utility).async { [self] in
            let remaining = prune(olderThan: Self.maxAge)
            usage.withLock {
                $0.estimatedBytes += remaining
                $0.pruning = false
            }
        }
    }

    /// Returns the bytes left behind.
    @discardableResult
    func prune(olderThan age: TimeInterval) -> Int {
        let cutoff = Date().addingTimeInterval(-age)
        let fm = FileManager.default
        guard
            let entries = try? fm.contentsOfDirectory(
                at: dir, includingPropertiesForKeys: nil)
        else { return 0 }
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
        // a tenth of headroom, so the next prune is that many writes away
        let target = maxBytes - maxBytes / 10
        for var file in kept.sorted(by: { $0.modified < $1.modified }) where total > target {
            file.url.removeAllCachedResourceValues()
            Self.lock.withLock {
                // served since the listing, so no longer the least recent
                guard Self.modified(file.url) == file.modified,
                    (try? fm.removeItem(at: file.url)) != nil
                else { return }
                total -= file.size
            }
        }
        return total
    }

    private static func modified(_ url: URL) -> Date? {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
    }
}
