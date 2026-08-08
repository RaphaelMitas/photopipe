import Foundation

/// Session state for one library root: current snapshot, generation counter,
/// SQLite index, FSEvents-driven rescans, thumbnail cache.
///
/// Threading: protocol requests arrive on the main read loop; FSEvents rescans
/// run on `rescanQueue`. All mutable state is guarded by `lock`.
public final class LibraryService {
    public enum ServiceError: Error {
        case noRoot
        case unknownShoot(String)
        case pathOutsideRoot(String)
    }

    private let lock = NSLock()
    private var snapshot = LibrarySnapshot.empty
    private var root: String?
    private var generation = 0
    private var watcher: Watcher?
    private var index: SQLiteIndex?
    private let thumbnailer: Thumbnailer
    private let rescanQueue = DispatchQueue(label: "photopipe.rescan")
    private var pendingRescan: DispatchWorkItem?

    public init(thumbnailer: Thumbnailer = Thumbnailer(cacheDir: Thumbnailer.defaultCacheDir())) {
        self.thumbnailer = thumbnailer
    }

    public static func defaultIndexPath() -> String {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Photopipe/index.sqlite").path
    }

    // MARK: - Requests

    public func setRoot(path: String, indexPath: String?) throws -> (
        shoots: Int, files: Int, generation: Int
    ) {
        // Standardize once (drops trailing slashes, resolves "..") so prefix
        // checks like `thumbnail`'s stay robust against typed-in paths.
        let path = URL(fileURLWithPath: path).standardizedFileURL.path
        let scanned = try scanLibrary(root: path)

        lock.lock()
        root = path
        snapshot = scanned
        generation += 1
        let currentGeneration = generation
        lock.unlock()

        // Index is best-effort cache: failures must never break the session.
        // Write-only for now — nothing reads it in production. It exists so a
        // later phase can serve instant startup from it; disk stays the truth.
        let index = try? SQLiteIndex(path: indexPath ?? Self.defaultIndexPath())
        try? index?.save(root: path, filesByShoot: Self.filesByShoot(scanned))
        lock.lock()
        self.index = index
        lock.unlock()

        watcher = Watcher(path: path, queue: rescanQueue) { [weak self] in
            self?.scheduleRescan()
        }

        return (scanned.shoots.count, scanned.fileCount, currentGeneration)
    }

    public func listShoots() -> [Shoot] {
        lock.lock()
        defer { lock.unlock() }
        return snapshot.shoots
    }

    public func listImages(shoot: String) throws -> [ImageGroup] {
        lock.lock()
        defer { lock.unlock() }
        guard root != nil else { throw ServiceError.noRoot }
        guard let images = snapshot.imagesByShoot[shoot] else {
            throw ServiceError.unknownShoot(shoot)
        }
        return images
    }

    public func status() -> (generation: Int, root: String?, shoots: Int) {
        lock.lock()
        defer { lock.unlock() }
        return (generation, root, snapshot.shoots.count)
    }

    /// Thumbnail any file under the root. Stats the file directly so a path
    /// fresh from an external change works even before the rescan lands.
    public func thumbnail(path: String, maxPixel: Int) throws -> String {
        lock.lock()
        let currentRoot = root
        lock.unlock()
        guard let currentRoot else { throw ServiceError.noRoot }
        let canonical = URL(fileURLWithPath: path).standardizedFileURL.path
        guard canonical.hasPrefix(currentRoot + "/") || canonical == currentRoot else {
            throw ServiceError.pathOutsideRoot(path)
        }
        let attrs = try FileManager.default.attributesOfItem(atPath: canonical)
        let ext = (canonical as NSString).pathExtension
        let record = FileRecord(
            path: canonical,
            ext: ext,
            stage: Stage(fileExtension: ext) ?? .export,
            size: (attrs[.size] as? Int64) ?? 0,
            mtime: ((attrs[.modificationDate] as? Date) ?? .distantPast).timeIntervalSince1970)
        return try thumbnailer.thumbnail(for: record, maxPixel: maxPixel).path
    }

    // MARK: - Rescan (FSEvents)

    private func scheduleRescan() {
        // Runs on rescanQueue (watcher's queue) — pendingRescan only touched here.
        pendingRescan?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.rescanNow() }
        pendingRescan = work
        rescanQueue.asyncAfter(deadline: .now() + 0.5, execute: work)
    }

    /// Synchronous rescan; also called directly by tests for determinism.
    public func rescanNow() {
        lock.lock()
        let currentRoot = root
        lock.unlock()
        guard let currentRoot, let scanned = try? scanLibrary(root: currentRoot) else { return }

        lock.lock()
        let changed = scanned != snapshot
        if changed {
            snapshot = scanned
            generation += 1
        }
        let index = self.index
        lock.unlock()

        if changed {
            try? index?.save(root: currentRoot, filesByShoot: Self.filesByShoot(scanned))
        }
    }

    static func filesByShoot(_ snapshot: LibrarySnapshot) -> [String: [FileRecord]] {
        snapshot.imagesByShoot.mapValues { images in images.flatMap(\.files) }
    }
}
