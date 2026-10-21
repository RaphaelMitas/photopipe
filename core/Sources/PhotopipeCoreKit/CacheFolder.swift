import CryptoKit
import Foundation
import Synchronization

/// An entry's mtime is when it was last served, so pruning by age or size drops what nobody looks at first.
final class CacheFolder: Sendable {
    let dir: URL
    let maxBytes: Int

    private struct Usage {
        var bytesUntilPrune: Int
        var pruning = false
        var retryScheduled = false
    }

    private static let maxAge: TimeInterval = 7 * 24 * 3600
    // the webview reuses a path it let go of for React Query's 5 min gcTime without asking again
    private static let recentlyServed: TimeInterval = 10 * 60
    // a hit's touch and the prune's stat-then-delete must not interleave
    private static let lock = NSLock()
    private let usage: Mutex<Usage>
    let pruneQueue = DispatchQueue(label: "CacheFolder.prune", qos: .utility)

    init(dir: URL, maxBytes: Int) {
        self.dir = dir
        self.maxBytes = maxBytes
        usage = Mutex(Usage(bytesUntilPrune: maxBytes))
    }

    private var headroom: Int { maxBytes / 10 }

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
            $0.bytesUntilPrune -= bytes
            return $0.bytesUntilPrune < 0
        }
        if overBudget { pruneInBackground() }
        return url
    }

    func pruneInBackground() {
        let start = usage.withLock {
            guard !$0.pruning else { return false }
            $0.pruning = true
            // writes landing during the prune spend from what it leaves
            $0.bytesUntilPrune = 0
            return true
        }
        guard start else { return }
        pruneQueue.async { [self] in
            let remaining = prune()
            let retry = usage.withLock {
                // what was just served can hold a prune over budget, so wait for more writes
                $0.bytesUntilPrune += max(maxBytes - remaining, headroom)
                $0.pruning = false
                let overTarget = remaining > maxBytes - headroom || $0.bytesUntilPrune < 0
                guard overTarget, !$0.retryScheduled else { return false }
                $0.retryScheduled = true
                return true
            }
            guard retry else { return }
            // by then what the ten minute window held is past it, even if nothing more is written
            pruneQueue.asyncAfter(deadline: .now() + Self.recentlyServed) {
                [self] in
                usage.withLock { $0.retryScheduled = false }
                pruneInBackground()
            }
        }
    }

    /// Returns the bytes left behind.
    @discardableResult
    func prune() -> Int {
        let cutoff = Date().addingTimeInterval(-Self.maxAge)
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
        let target = maxBytes - headroom
        for var file in kept.sorted(by: { $0.modified < $1.modified })
        where total > target && file.modified.timeIntervalSinceNow < -Self.recentlyServed {
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
