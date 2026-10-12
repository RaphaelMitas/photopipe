import CryptoKit
import Foundation

final class ImportPlan {
    private let destination: URL
    private var used: Set<String> = []
    private var claimed: [FileIdentity: Claim] = [:]
    private var digests: [URL: Data] = [:]

    /// The first file is kept whole rather than digested, so a selection
    /// that collides nowhere never opens a file at all.
    private struct Claim {
        var first: URL?
        var digests: Set<Data> = []
    }

    static func items(copying paths: [String], into destination: URL) -> [Exporter.Plan.Item] {
        sweepStaleTemps(in: destination)
        let plan = ImportPlan(destination: destination)
        return paths.compactMap { path in
            let source = URL(fileURLWithPath: path)
            guard let target = plan.target(for: source) else { return nil }
            return Exporter.Plan.Item(label: source.lastPathComponent) {
                try FileActions.copyWithoutOverwriting(from: source, to: target)
            }
        }
    }

    private init(destination: URL) { self.destination = destination }

    private func target(for source: URL) -> URL? {
        let identity = Self.identity(source)
        if let identity, claimedAlready(identity, source) { return nil }
        var imported = false
        let name = FileActions.uniqueName(source.lastPathComponent) { candidate in
            if used.contains(candidate.lowercased()) { return true }
            let landed = destination.appendingPathComponent(candidate)
            guard let landedIdentity = Self.identity(landed) else { return false }
            if landedIdentity == identity, sameHead(source, landed) {
                imported = true
            }
            return true
        }
        guard !imported else { return nil }
        used.insert(name.lowercased())
        if let identity {
            if claimed[identity] == nil {
                claimed[identity] = Claim(first: source)
            } else if let digest = digest(source) {
                claimed[identity]?.digests.insert(digest)
            }
        }
        return destination.appendingPathComponent(name)
    }

    private func claimedAlready(_ identity: FileIdentity, _ source: URL) -> Bool {
        guard var claim = claimed[identity] else { return false }
        if let first = claim.first {
            claim.first = nil
            if let digest = digest(first) { claim.digests.insert(digest) }
            claimed[identity] = claim
        }
        guard let mine = digest(source) else { return false }
        return claim.digests.contains(mine)
    }

    /// FAT32 rounds mtime to two seconds and an uncompressed raw is one size
    /// per body, so two frames of a burst agree on both; their EXIF does not.
    private func sameHead(_ left: URL, _ right: URL) -> Bool {
        guard let left = digest(left) else { return false }
        return left == digest(right)
    }

    private func digest(_ url: URL) -> Data? {
        if let known = digests[url] { return known }
        guard let head = Self.head(url) else { return nil }
        let digest = Data(SHA256.hash(data: head))
        digests[url] = digest
        return digest
    }

    private struct FileIdentity: Hashable {
        let size: Int
        let modified: Date
    }

    private static func identity(_ url: URL) -> FileIdentity? {
        guard
            let values = try? url.resourceValues(forKeys: [
                .fileSizeKey, .contentModificationDateKey,
            ]), let size = values.fileSize, let modified = values.contentModificationDate
        else { return nil }
        return FileIdentity(size: size, modified: modified)
    }

    private static func head(_ url: URL) -> Data? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        return try? handle.read(upToCount: 64 * 1024)
    }

    /// Nothing else clears a staging file, since the prefix hides it from Finder
    /// and the scanner alike. The age bound spares a running import's temps.
    private static func sweepStaleTemps(in folder: URL) {
        let fm = FileManager.default
        let cutoff = Date().addingTimeInterval(-3600)
        let names = (try? fm.contentsOfDirectory(atPath: folder.path)) ?? []
        for name in names where name.hasPrefix(FileActions.tempPrefix) {
            let stale = folder.appendingPathComponent(name)
            guard let modified = Self.identity(stale)?.modified, modified < cutoff else {
                continue
            }
            try? fm.removeItem(at: stale)
        }
    }
}
