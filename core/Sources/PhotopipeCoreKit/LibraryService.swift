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
        case unknownImage(String)
        case pathOutsideRoot(String)
        case invalidRating(Int)
        case invalidProjectName(String)
        case projectExists(String)
    }

    private let lock = NSLock()
    private var snapshot = LibrarySnapshot.empty
    private var root: String?
    private var generation = 0
    private var watcher: Watcher?
    private var index: SQLiteIndex?
    private let thumbnailer: Thumbnailer
    private let renderer: Renderer
    private let rescanQueue = DispatchQueue(label: "photopipe.rescan")
    private var pendingRescan: DispatchWorkItem?

    public init(
        thumbnailer: Thumbnailer = Thumbnailer(cacheDir: Thumbnailer.defaultCacheDir()),
        renderer: Renderer = Renderer(cacheDir: Renderer.defaultCacheDir())
    ) {
        self.thumbnailer = thumbnailer
        self.renderer = renderer
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

        let newWatcher = Watcher(path: path, queue: rescanQueue) { [weak self] in
            self?.scheduleRescan()
        }
        lock.lock()
        watcher = newWatcher
        lock.unlock()

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
        try thumbnailer.thumbnail(for: recordUnderRoot(path: path), maxPixel: maxPixel).path
    }

    /// Loupe render with raw-pipeline exposure; same root discipline as
    /// thumbnails.
    public func render(path: String, exposure: Double, maxPixel: Int) throws -> String {
        try renderer.render(
            file: recordUnderRoot(path: path), exposure: exposure, maxPixel: maxPixel
        ).path
    }

    /// Validate a path against the current root and stat it into a record.
    private func recordUnderRoot(path: String) throws -> FileRecord {
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
        return FileRecord(
            path: canonical,
            ext: ext,
            stage: Stage(fileExtension: ext) ?? .export,
            size: (attrs[.size] as? Int64) ?? 0,
            mtime: ((attrs[.modificationDate] as? Date) ?? .distantPast).timeIntervalSince1970)
    }

    /// Rate a logical image: XMP writes across its lineage (sidecar for raw,
    /// embedded for the rest), then an in-place snapshot update so the UI sees
    /// the new rating immediately — the FSEvents rescan that follows re-reads
    /// the same truth from disk.
    public func setRating(shoot shootName: String, stem: String, rating: Int) throws -> (
        rating: Int, generation: Int
    ) {
        guard (0...5).contains(rating) else { throw ServiceError.invalidRating(rating) }

        lock.lock()
        let images = snapshot.imagesByShoot[shootName]
        let hasRoot = root != nil
        lock.unlock()
        guard hasRoot else { throw ServiceError.noRoot }
        guard let images else { throw ServiceError.unknownShoot(shootName) }
        guard let image = images.first(where: { $0.stem.lowercased() == stem.lowercased() })
        else { throw ServiceError.unknownImage(stem) }

        // Disk first — it is the source of truth; the snapshot follows.
        try XMP.writeRating(rating, files: image.files, tool: .shared)

        lock.lock()
        defer { lock.unlock() }
        if var updated = snapshot.imagesByShoot[shootName],
            let index = updated.firstIndex(where: { $0.stem.lowercased() == stem.lowercased() })
        {
            let old = updated[index]
            updated[index] = ImageGroup(
                stem: old.stem, stage: old.stage, rating: rating,
                width: old.width, height: old.height, files: old.files)
            var imagesByShoot = snapshot.imagesByShoot
            imagesByShoot[shootName] = updated
            snapshot = LibrarySnapshot(
                shoots: snapshot.shoots, imagesByShoot: imagesByShoot,
                fileCount: snapshot.fileCount)
            generation += 1
        }
        return (rating, generation)
    }

    // MARK: - Creating projects

    /// Create `<root>/<day>_<name>/` with an `original/` folder for photos to
    /// land in and a metadata file for the notes. The folder *is* the project
    /// — there is no registry to fall out of sync with the disk.
    public func createProject(day: String, name: String, notes: String) throws -> (
        shoot: String, path: String, generation: Int
    ) {
        lock.lock()
        let currentRoot = root
        lock.unlock()
        guard let currentRoot else { throw ServiceError.noRoot }

        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("/") else {
            throw ServiceError.invalidProjectName(name)
        }
        let folder = "\(day)_\(trimmed)"
        let path = URL(fileURLWithPath: currentRoot).appendingPathComponent(folder)
        guard !FileManager.default.fileExists(atPath: path.path) else {
            throw ServiceError.projectExists(folder)
        }
        // All stage folders from the start, so files can be pasted straight
        // into the right place from Finder.
        for stageFolder in ["original", "processed", "export"] {
            try FileManager.default.createDirectory(
                at: path.appendingPathComponent(stageFolder), withIntermediateDirectories: true)
        }
        try ProjectFile(notes: notes, created: day).write(inShoot: path.path)

        rescanNow()
        return (folder, path.path, status().generation)
    }

    /// Copy outside files into a stage's folder. Every page can import: the
    /// originals at the start, but also processed or edited files coming
    /// back from tools that saved them elsewhere. Non-image files are
    /// skipped, names never overwrite, and the source is only read.
    public func importFiles(shoot shootName: String, stage: Stage, paths: [String]) throws -> (
        imported: Int, skipped: Int, generation: Int
    ) {
        lock.lock()
        let path = snapshot.shoots.first { $0.name == shootName }?.path
        lock.unlock()
        guard let path else { throw ServiceError.unknownShoot(shootName) }

        let folder =
            switch stage {
            case .raw: "original"
            case .denoised: "processed"
            case .export: "export"
            }
        let images = paths.filter {
            Stage(fileExtension: ($0 as NSString).pathExtension) != nil
        }
        guard !images.isEmpty else { throw FileActions.ActionError.noFiles }
        let copied = try FileActions.copy(paths: images, toFolder: path + "/" + folder)
        rescanNow()
        return (copied, paths.count - images.count, status().generation)
    }

    // MARK: - Explicit file actions

    /// Hand files to another application. The stage pages use this to send
    /// work out to a denoiser or editor; whatever comes back is picked up by
    /// the watcher, no bookkeeping required.
    public func openIn(paths: [String], app: String) throws {
        try FileActions.open(paths: try pathsUnderRoot(paths), inApp: app)
    }

    public func reveal(paths: [String]) throws {
        try FileActions.reveal(paths: try pathsUnderRoot(paths))
    }

    /// Trash whole logical images: every file of the lineage group plus its
    /// XMP sidecar. Deleting "a photo" and leaving its sidecar or its DNG
    /// behind would be a lie about what you asked for.
    public func trashImages(shoot shootName: String, stems: [String]) throws -> (
        files: Int, generation: Int
    ) {
        lock.lock()
        let images = snapshot.imagesByShoot[shootName]
        let hasRoot = root != nil
        lock.unlock()
        guard hasRoot else { throw ServiceError.noRoot }
        guard let images else { throw ServiceError.unknownShoot(shootName) }

        let wanted = Set(stems.map { $0.lowercased() })
        var targets: [String] = []
        for image in images where wanted.contains(image.stem.lowercased()) {
            for file in image.files {
                targets.append(file.path)
                let sidecar = XMP.sidecarURL(forImagePath: file.path)
                if FileManager.default.fileExists(atPath: sidecar.path) {
                    targets.append(sidecar.path)
                }
            }
        }
        guard !targets.isEmpty else { throw ServiceError.unknownImage(stems.first ?? "") }

        let trashed = try FileActions.trash(paths: try pathsUnderRoot(targets))
        rescanNow()
        return (trashed.count, status().generation)
    }

    /// Copy files to a folder, or zip them flat.
    public func exportFiles(paths: [String], destination: String, zip: Bool) throws -> Int {
        let validated = try pathsUnderRoot(paths)
        return zip
            ? try FileActions.zip(paths: validated, to: destination)
            : try FileActions.copy(paths: validated, toFolder: destination)
    }

    /// Every path must sit inside the library root — the UI supplies paths it
    /// read from us, and this is what keeps a malformed request from touching
    /// anything else on disk.
    private func pathsUnderRoot(_ paths: [String]) throws -> [String] {
        lock.lock()
        let currentRoot = root
        lock.unlock()
        guard let currentRoot else { throw ServiceError.noRoot }
        return try paths.map { path in
            let canonical = URL(fileURLWithPath: path).standardizedFileURL.path
            guard canonical.hasPrefix(currentRoot + "/") else {
                throw ServiceError.pathOutsideRoot(path)
            }
            return canonical
        }
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
