import CryptoKit
import Foundation

/// Reached from the dispatcher's worker pool, the watcher's queue and the
/// enricher's; every field below is guarded by `lock`.
public final class LibraryService: @unchecked Sendable {
    public enum ServiceError: Error {
        case noRoot
        case unknownShoot(String)
        case unknownImage(String)
        case pathOutsideRoot(String)
        case invalidRating(Int)
        case invalidProjectName(String)
        case invalidProjectDay(String)
        case projectExists(String)
        case unknownExport(String)
    }

    private let lock = NSLock()
    private var snapshot = LibrarySnapshot.empty
    private var root: String?
    private var generation = 0
    /// Bumped whenever the file list itself is replaced. Enrichment batches
    /// carry the epoch they were queued under and are dropped if it moved on.
    private var epoch = 0
    private var shootGenerations: [String: Int] = [:]
    private var shootPublished: [String: Date] = [:]
    private var pendingByShoot: [String: Int] = [:]
    private var watcher: Watcher?
    private var index: SQLiteIndex?
    private let thumbnailer: Thumbnailer
    private let renderer: Renderer
    private let scorer: Scorer
    private let exporter = Exporter()
    private let rescanQueue = DispatchQueue(label: "photopipe.rescan")
    /// One connection, one writer: enrichment batches and full saves both land
    /// here so they never interleave on the same sqlite handle.
    private let indexQueue = DispatchQueue(label: "photopipe.index", qos: .utility)
    private var pendingRescan: DispatchWorkItem?
    private let enricher = Enricher()

    public init(
        thumbnailer: Thumbnailer = Thumbnailer(cacheDir: Thumbnailer.defaultCacheDir()),
        renderer: Renderer = Renderer(cacheDir: Renderer.defaultCacheDir()),
        scorer: Scorer = Scorer()
    ) {
        self.thumbnailer = thumbnailer
        self.renderer = renderer
        self.scorer = scorer
    }

    public static func defaultIndexPath() -> String {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Photopipe/index.sqlite").path
    }

    /// Returns as soon as the tree has been walked. Ratings, edits and
    /// dimensions arrive afterwards, either straight from the index or from
    /// background enrichment, and are visible through `status`.
    public func setRoot(path: String, indexPath: String?) throws -> (
        shoots: Int, files: Int, generation: Int
    ) {
        let path = URL(fileURLWithPath: path).standardizedFileURL.path
        // Opening the database is itself a write (pragmas, schema, and a delete
        // if it turns out corrupt), so it has to queue behind whatever the
        // previous root left in flight rather than race it on a second handle.
        let (index, warm) = indexQueue.sync { () -> (SQLiteIndex?, [String: ImageFile]) in
            let index = try? SQLiteIndex(path: indexPath ?? Self.defaultIndexPath())
            guard let stored = (try? index?.load()) ?? nil, stored.root == path else {
                return (index, [:])
            }
            return (index, Self.byPath(stored.filesByShoot.values.joined()))
        }
        let scanned = carryEnrichment(into: try walkLibrary(root: path), from: warm)

        lock.lock()
        root = path
        self.index = index
        let currentGeneration = publish(scanned)
        lock.unlock()

        store(scanned, root: path, in: index)
        useScorer(with: index)

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

    public func listImages(shoot: String) throws -> [ImageFile] {
        let images = try images(inShoot: shoot)
        let scores = scorer.scores(for: images)
        return images.map { image in
            scores[image.path].map { image.with(score: $0) } ?? image
        }
    }

    public func scoreShoot(shoot: String) throws -> Scorer.Progress {
        scorer.start(shoot: shoot, files: try images(inShoot: shoot))
    }

    public func scoreStatus(shoot: String) throws -> Scorer.Progress {
        scorer.progress(shoot: shoot, files: try images(inShoot: shoot))
    }

    private func images(inShoot shoot: String) throws -> [ImageFile] {
        lock.lock()
        guard root != nil else {
            lock.unlock()
            throw ServiceError.noRoot
        }
        guard let images = snapshot.imagesByShoot[shoot] else {
            lock.unlock()
            throw ServiceError.unknownShoot(shoot)
        }
        lock.unlock()

        // A read with a side effect: what you are looking at gets indexed first.
        enricher.prioritize(shoot: shoot)
        return images
    }

    public struct Status: Sendable {
        public let generation: Int
        public let root: String?
        public let shoots: Int
        public let filesFound: Int
        public let filesEnriched: Int
        /// Shoots whose images changed after the caller's generation, so the
        /// client can refetch just those instead of the whole library. Nil
        /// when the caller did not say where it left off.
        public let changedShoots: [String]?

        public var scanning: Bool { filesEnriched < filesFound }
    }

    public func status(since: Int? = nil) -> Status {
        lock.lock()
        defer { lock.unlock() }
        return Status(
            generation: generation,
            root: root,
            shoots: snapshot.shoots.count,
            filesFound: snapshot.fileCount,
            filesEnriched: snapshot.fileCount - pendingByShoot.values.reduce(0, +),
            changedShoots: since.map { seen in
                shootGenerations.filter { $0.value > seen }.keys.sorted()
            })
    }

    /// Callers must hold the lock.
    private func publish(_ next: LibrarySnapshot) -> Int {
        // Disappearing is a change too, and it has to be announced under the
        // shoot's own name: a client still holding its photos hears about it
        // only if the name it knows comes back as changed.
        let departed = Set(snapshot.shoots.map(\.name)).subtracting(next.shoots.map(\.name))
        snapshot = next
        epoch += 1
        generation += 1
        pendingByShoot = next.unenriched.mapValues(\.count)
        shootPublished = [:]
        for name in next.shoots.map(\.name) + departed {
            shootGenerations[name] = generation
        }
        return generation
    }

    private func startEnrichment() {
        lock.lock()
        let currentEpoch = epoch
        let pending = snapshot.unenriched
        let order = snapshot.shoots.map(\.name).compactMap { name in
            pending[name].map { (shoot: name, files: $0) }
        }
        // The counter has to come from the same read as the work list. Taking
        // it from the earlier publish would leave anything settled in between
        // counted but never queued, and indexing would never read as finished.
        pendingByShoot = pending.mapValues(\.count)
        lock.unlock()
        enricher.start(epoch: currentEpoch, work: order) { [weak self] epoch, shoot, files, done in
            self?.applyEnrichment(epoch: epoch, shoot: shoot, files: files, shootDone: done)
        }
    }

    private func applyEnrichment(
        epoch: Int, shoot: String, files: [ImageFile], shootDone: Bool
    ) {
        lock.lock()
        guard epoch == self.epoch, let images = snapshot.imagesByShoot[shoot] else {
            lock.unlock()
            return
        }
        let updates = Self.byPath(files)
        // A batch is a snapshot of what the files held when it was queued. If
        // an entry has been settled since — a rating written, say — it is the
        // newer truth and the batch must not walk over it.
        let accepted = images.map { current in
            current.enriched ? current : updates[current.path] ?? current
        }
        let merged = accepted.filter { updates[$0.path] == $0 }
        snapshot = snapshot.replacingImages(inShoot: shoot, with: accepted)

        let left = max(0, (pendingByShoot[shoot] ?? 0) - files.count)
        pendingByShoot[shoot] = left == 0 ? nil : left
        generation += 1

        // Refetching a shoot means re-encoding every image in it, so say a
        // shoot changed at most once a second. The dashboard's counters ride
        // the global generation, which is free to move every batch.
        let now = Date()
        if shootDone || now.timeIntervalSince(shootPublished[shoot] ?? .distantPast) >= 1 {
            shootGenerations[shoot] = generation
            shootPublished[shoot] = now
        }
        let index = self.index
        lock.unlock()

        // Only what the merge accepted: persisting an entry the merge rejected
        // would put the pre-write value back on the next launch.
        indexQueue.async { try? index?.upsert(shoot: shoot, files: merged) }
    }

    private static func byPath(_ files: some Sequence<ImageFile>) -> [String: ImageFile] {
        var byPath: [String: ImageFile] = [:]
        for file in files { byPath[file.path] = file }
        return byPath
    }

    public func thumbnail(path: String, maxPixel: Int) throws -> String {
        try thumbnailer.thumbnail(for: recordUnderRoot(path: path), maxPixel: maxPixel).path
    }

    public func render(
        path: String, edit: Edit, maxPixel: Int, viewport: CropRect? = nil,
        decoderVersion: Int? = nil
    ) throws -> String {
        try renderer.render(
            file: recordUnderRoot(path: path), edit: edit, maxPixel: maxPixel,
            viewport: viewport, decoderVersion: decoderVersion
        ).path
    }

    public func rawDefaults(path: String, decoderVersion: Int? = nil) throws
        -> Renderer.RawDefaults?
    {
        try renderer.rawDefaults(for: recordUnderRoot(path: path), decoderVersion: decoderVersion)
    }

    /// Whether RAW 9 is reachable at all here. Per-file support folds the
    /// camera and this Mac's macOS together, so one body that lacks it proves
    /// nothing; only a library-wide "no" is worth telling the user about.
    /// nil when there is no raw to ask.
    public func raw9Availability() -> Bool? {
        lock.lock()
        let shoots = snapshot.imagesByShoot
        lock.unlock()
        // one raw per shoot: cameras rarely differ within a shoot, and the
        // probe caches per camera, so this stays a handful of header reads
        let samples = shoots.values.compactMap { $0.first(where: \.isRaw) }
        guard !samples.isEmpty else { return nil }
        // A file still copying answers nothing, not no. Condemning the library
        // on it would stick, because the client caches this for the session.
        let verdicts = samples.compactMap { renderer.known(file: $0, major: 9) }
        guard !verdicts.isEmpty else { return nil }
        return verdicts.contains(true)
    }

    public func decoderSupport(paths: [String]) throws -> (raw9: Int, rawTotal: Int) {
        let files = try pathsUnderRoot(paths)
            .compactMap { try? recordUnderRoot(path: $0) }
            .filter(\.isRaw)
        guard !files.isEmpty else { return (0, 0) }
        // a whole shoot serially outruns the caller's read timeout, and a
        // timeout takes the sidecar down mid-export
        DispatchQueue.concurrentPerform(iterations: files.count) { index in
            _ = renderer.supports(file: files[index], major: 9)
        }
        // every answer is cached now, so this pass never touches a file
        return (files.count { renderer.supports(file: $0, major: 9) }, files.count)
    }

    private func recordUnderRoot(path: String) throws -> ImageFile {
        lock.lock()
        let currentRoot = root
        lock.unlock()
        guard let currentRoot else { throw ServiceError.noRoot }
        let canonical = URL(fileURLWithPath: path).standardizedFileURL.path
        guard canonical.hasPrefix(currentRoot + "/") || canonical == currentRoot else {
            throw ServiceError.pathOutsideRoot(path)
        }
        let attrs = try FileManager.default.attributesOfItem(atPath: canonical)
        return ImageFile(
            path: canonical,
            rel: String(canonical.dropFirst(currentRoot.count + 1)),
            ext: (canonical as NSString).pathExtension,
            size: (attrs[.size] as? Int64) ?? 0,
            mtime: ((attrs[.modificationDate] as? Date) ?? .distantPast).timeIntervalSince1970)
    }

    /// One canonical index for the whole selection: resolving each path against
    /// a linear scan makes selecting a whole shoot quadratic.
    private func images(inShoot shootName: String, paths: [String]) throws -> [ImageFile] {
        lock.lock()
        let images = snapshot.imagesByShoot[shootName]
        let hasRoot = root != nil
        lock.unlock()
        guard hasRoot else { throw ServiceError.noRoot }
        guard let images else { throw ServiceError.unknownShoot(shootName) }

        var byCanonical: [String: ImageFile] = [:]
        for image in images {
            byCanonical[URL(fileURLWithPath: image.path).standardizedFileURL.path] = image
        }
        return try paths.map { path in
            let canonical = URL(fileURLWithPath: path).standardizedFileURL.path
            guard let image = byCanonical[canonical] else {
                throw ServiceError.unknownImage(path)
            }
            return image
        }
    }

    private func image(shoot shootName: String, path: String) throws -> ImageFile {
        lock.lock()
        let images = snapshot.imagesByShoot[shootName]
        let hasRoot = root != nil
        lock.unlock()
        guard hasRoot else { throw ServiceError.noRoot }
        guard let images else { throw ServiceError.unknownShoot(shootName) }
        let canonical = URL(fileURLWithPath: path).standardizedFileURL.path
        guard
            let image = images.first(where: {
                $0.path == path
                    || URL(fileURLWithPath: $0.path).standardizedFileURL.path == canonical
            })
        else {
            throw ServiceError.unknownImage(path)
        }
        return image
    }

    /// The image with its real metadata, reading it now if enrichment has not
    /// reached it. A write against a placeholder would both lose what the file
    /// already carries and be overwritten by the batch still in the queue.
    private func settledImage(shoot: String, path: String) throws -> ImageFile {
        let image = try image(shoot: shoot, path: path)
        guard !image.enriched else { return image }
        let settled = enrich(image)
        updateSnapshot(shoot: shoot, path: image.path) { _ in settled }
        return settled
    }

    /// One photo's XMP write, settled afterwards. What settling compares against
    /// is restatted first rather than taken from the snapshot, which a second
    /// write to the same photo leaves behind while it is in flight.
    private func write(
        shoot: String, path: String, _ apply: (ImageFile) throws -> Void
    ) throws -> ImageFile {
        let image = try settledImage(shoot: shoot, path: path)
        let before = Self.restat(image)
        try apply(image)
        return settleAfterWrite(shoot: shoot, image: before)
    }

    /// Re-reads a file we just wrote and records it everywhere the old value
    /// lived. Restatting matters as much as re-reading: the walk compares those
    /// stamps, so an entry left holding the pre-write ones is dropped back to a
    /// placeholder by the very next rescan.
    private func settleAfterWrite(shoot: String, image: ImageFile) -> ImageFile {
        let settled = enrich(Self.restat(image))
        updateSnapshot(shoot: shoot, path: image.path) { _ in settled }
        scorer.restamp(image, to: settled)
        lock.lock()
        let index = self.index
        lock.unlock()
        indexQueue.async { try? index?.upsert(shoot: shoot, files: [settled]) }
        return settled
    }

    private static func restat(_ file: ImageFile) -> ImageFile {
        let values = try? URL(fileURLWithPath: file.path).resourceValues(
            forKeys: [.fileSizeKey, .contentModificationDateKey])
        return ImageFile(
            path: file.path, rel: file.rel, ext: file.ext,
            size: (values?.fileSize).map(Int64.init) ?? file.size,
            mtime: values?.contentModificationDate?.timeIntervalSince1970 ?? file.mtime,
            sidecarMtime: file.usesSidecar ? XMP.sidecarMtime(forImagePath: file.path) : 0)
    }

    private func updateSnapshot(
        shoot shootName: String, path: String, _ transform: (ImageFile) -> ImageFile
    ) {
        lock.lock()
        defer { lock.unlock() }
        if var updated = snapshot.imagesByShoot[shootName],
            let index = updated.firstIndex(where: { $0.path == path })
        {
            updated[index] = transform(updated[index])
            snapshot = snapshot.replacingImages(inShoot: shootName, with: updated)
            generation += 1
            shootGenerations[shootName] = generation
        }
    }

    public func setRating(shoot shootName: String, path: String, rating: Int) throws -> (
        rating: Int, generation: Int
    ) {
        guard (0...5).contains(rating) else { throw ServiceError.invalidRating(rating) }
        let settled = try write(shoot: shootName, path: path) { image in
            try XMP.writeRating(rating, file: image, tool: .shared)
        }
        return (settled.rating, status().generation)
    }

    public func setEdit(shoot shootName: String, path: String, edit: Edit) throws -> (
        edit: Edit, generation: Int
    ) {
        let settled = try write(shoot: shootName, path: path) { image in
            try XMP.writeEdit(edit, file: image, tool: .shared)
        }
        return (settled.edit, status().generation)
    }

    static func projectFolder(day: String, name: String) throws -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("/"), !trimmed.contains(":") else {
            throw ServiceError.invalidProjectName(name)
        }
        let folder = "\(day)_\(trimmed)"
        guard !folder.contains("/"), !folder.contains(":"), parseShootName(folder) != nil else {
            throw ServiceError.invalidProjectDay(day)
        }
        return folder
    }

    static func projectURL(root: String, day: String, name: String) throws -> (
        folder: String, url: URL
    ) {
        let folder = try projectFolder(day: day, name: name)
        let rootURL = URL(fileURLWithPath: root).standardizedFileURL
        let url = rootURL.appendingPathComponent(folder).standardizedFileURL
        guard url.deletingLastPathComponent().path == rootURL.path else {
            throw ServiceError.invalidProjectDay(day)
        }
        return (folder, url)
    }

    public func updateProject(shoot shootName: String, notes: String?, cover: String??) throws
        -> Int
    {
        let path = try shootPath(shootName)
        var file = ProjectFile.read(inShoot: path)
        if let notes { file.notes = notes }
        if let cover { file.cover = cover }
        try file.write(inShoot: path)
        rescanNow()
        return status().generation
    }

    public func renameProject(shoot shootName: String, day: String, name: String) throws -> (
        shoot: String, generation: Int
    ) {
        let path = try shootPath(shootName)
        lock.lock()
        let currentRoot = root
        lock.unlock()
        guard let currentRoot else { throw ServiceError.noRoot }

        let (folder, destination) = try Self.projectURL(
            root: currentRoot, day: day, name: name)
        guard folder != shootName else { return (shootName, status().generation) }

        guard !FileManager.default.fileExists(atPath: destination.path) else {
            throw ServiceError.projectExists(folder)
        }
        try FileManager.default.moveItem(at: URL(fileURLWithPath: path), to: destination)

        var file = ProjectFile.read(inShoot: destination.path)
        file.created = day
        try? file.write(inShoot: destination.path)

        rescanNow()
        return (folder, status().generation)
    }

    public func createProject(day: String, name: String, notes: String) throws -> (
        shoot: String, path: String, generation: Int
    ) {
        lock.lock()
        let currentRoot = root
        lock.unlock()
        guard let currentRoot else { throw ServiceError.noRoot }

        let (folder, path) = try Self.projectURL(root: currentRoot, day: day, name: name)
        guard !FileManager.default.fileExists(atPath: path.path) else {
            throw ServiceError.projectExists(folder)
        }
        try FileManager.default.createDirectory(at: path, withIntermediateDirectories: true)
        try ProjectFile(notes: notes, created: day).write(inShoot: path.path)

        rescanNow()
        return (folder, path.path, status().generation)
    }

    /// The watcher picks up each file as it lands, so the shoot fills in while
    /// the job runs.
    public func startImport(shoot shootName: String, paths: [String]) throws
        -> Exporter.Progress
    {
        let shootPath = try self.shootPath(shootName)
        let images = paths.filter(isImagePath)
        guard !images.isEmpty else { throw FileActions.ActionError.noFiles }

        let destination = URL(fileURLWithPath: shootPath)
        Self.sweepStaleTemps(in: destination)

        let plan = ImportPlan(destination: destination)
        var items: [Exporter.Plan.Item] = []
        for path in images {
            let source = URL(fileURLWithPath: path)
            guard let target = plan.target(for: source) else { continue }
            items.append(
                Exporter.Plan.Item(label: source.lastPathComponent) {
                    try FileActions.copyWithoutOverwriting(from: source, to: target)
                })
        }
        return exporter.start(
            plan: Exporter.Plan(items: items, destination: shootPath, staging: nil))
    }

    /// What one import has spoken for: names taken on disk or by an earlier
    /// item, and the files those items came from, so the same photo picked
    /// twice in one selection is copied once.
    private final class ImportPlan {
        private let destination: URL
        private var used: Set<String> = []
        private var claimed: [FileIdentity: Claim] = [:]
        private var digests: [URL: Data] = [:]

        /// The first file of an identity is held whole rather than digested: a
        /// selection where nothing collides then never opens a file at all. It
        /// is digested only once a second file lands on the same identity.
        private struct Claim {
            var first: URL?
            var digests: Set<Data> = []
        }

        init(destination: URL) { self.destination = destination }

        /// Where this file should land, or nil when the shoot already has it
        /// under any name.
        func target(for source: URL) -> URL? {
            let identity = LibraryService.identity(source)
            if let identity, claimedAlready(identity, source) { return nil }
            var imported = false
            let name = FileActions.uniqueName(source.lastPathComponent) { candidate in
                if used.contains(candidate.lowercased()) { return true }
                let landed = destination.appendingPathComponent(candidate)
                guard let landedIdentity = LibraryService.identity(landed) else { return false }
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

        /// Whether an earlier item in this selection was this same photo. A
        /// burst on a FAT32 card puts every frame in one identity, so this
        /// answers from a set rather than by walking what is already claimed.
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

        /// Size and mtime alone cannot tell two photos apart: a card formatted
        /// FAT32 keeps mtime to the nearest two seconds, and an uncompressed
        /// raw is a fixed byte count per body, so two frames from a burst on
        /// two cards agree on both. The head carries the EXIF and the preview,
        /// which do not.
        private func sameHead(_ left: URL, _ right: URL) -> Bool {
            guard let left = digest(left) else { return false }
            return left == digest(right)
        }

        private func digest(_ url: URL) -> Data? {
            if let known = digests[url] { return known }
            guard let head = LibraryService.head(url) else { return nil }
            let digest = Data(SHA256.hash(data: head))
            digests[url] = digest
            return digest
        }
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

    /// A killed copy leaves its staging file behind, hidden from Finder and
    /// from the scanner alike, so nothing else would ever clear it. The age
    /// bound keeps the sweep off temps a running import still has open.
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

    private func shootPath(_ shootName: String) throws -> String {
        lock.lock()
        let path = snapshot.shoots.first { $0.name == shootName }?.path
        lock.unlock()
        guard let path else { throw ServiceError.unknownShoot(shootName) }
        return path
    }

    public func reveal(paths: [String]) throws {
        try FileActions.reveal(
            paths: paths.map { URL(fileURLWithPath: $0).standardizedFileURL.path })
    }

    public func trashImages(shoot shootName: String, paths: [String]) throws -> (
        files: Int, generation: Int
    ) {
        var targets: [String] = []
        for path in paths {
            let found = try image(shoot: shootName, path: path)
            targets.append(found.path)
            let sidecar = XMP.sidecarURL(forImagePath: found.path)
            if FileManager.default.fileExists(atPath: sidecar.path) {
                targets.append(sidecar.path)
            }
        }
        guard !targets.isEmpty else { throw ServiceError.unknownImage(paths.first ?? "") }

        let trashed = try FileActions.trash(paths: try pathsUnderRoot(targets))
        rescanNow()
        return (trashed.count, status().generation)
    }

    public enum ExportFormat: String, Sendable {
        case original
        case jpeg
    }

    /// Everything that can be refused outright is refused here, so a bad
    /// request comes back as an error rather than as a job that fails a
    /// minute later.
    public func startExport(
        shoot shootName: String, paths: [String], destination: String,
        zip: Bool, flatten: Bool, format: ExportFormat, quality: Int,
        decoderVersion: Int? = nil
    ) throws -> Exporter.Progress {
        let images = try images(inShoot: shootName, paths: pathsUnderRoot(paths))
        guard !images.isEmpty else { throw FileActions.ActionError.noFiles }

        let fm = FileManager.default
        let staging =
            zip
            ? fm.temporaryDirectory
                .appendingPathComponent("photopipe-export-\(UUID().uuidString)")
            : nil
        let base = staging ?? URL(fileURLWithPath: destination)

        var used: Set<String> = []
        let items = images.map { image in
            var rel = image.rel
            if format == .jpeg {
                rel = (rel as NSString).deletingPathExtension + ".jpg"
            }
            if flatten {
                rel = (rel as NSString).lastPathComponent
            }
            let name = FileActions.uniqueName(rel) { candidate in
                used.contains(candidate.lowercased())
                    || (staging == nil
                        && fm.fileExists(atPath: base.appendingPathComponent(candidate).path))
            }
            used.insert(name.lowercased())
            let target = base.appendingPathComponent(name)
            // An export carries the real edit and rating even where enrichment
            // has not reached yet. Reading them opens the file, so it happens
            // in the writers, four wide, rather than in the request that plans
            // the job.
            return Exporter.Plan.Item(label: image.rel) {
                try self.write(
                    enrich(image), format: format, quality: quality, to: target, staging: zip,
                    decoderVersion: decoderVersion)
            }
        }

        if let staging { try fm.createDirectory(at: staging, withIntermediateDirectories: true) }
        return exporter.start(
            plan: Exporter.Plan(items: items, destination: destination, staging: staging))
    }

    public func stopExports() {
        exporter.cancelAll(waitingUpTo: 2)
    }

    public func exportStatus(id: String) throws -> Exporter.Progress {
        guard let progress = exporter.progress(id: id) else { throw ServiceError.unknownExport(id) }
        return progress
    }

    public func cancelExport(id: String) throws -> Exporter.Progress {
        guard let progress = exporter.cancel(id: id) else { throw ServiceError.unknownExport(id) }
        return progress
    }

    private func write(
        _ image: ImageFile, format: ExportFormat, quality: Int, to planned: URL, staging: Bool,
        decoderVersion: Int?
    ) throws {
        let fm = FileManager.default
        try fm.createDirectory(
            at: planned.deletingLastPathComponent(), withIntermediateDirectories: true)
        switch format {
        case .original:
            let source = URL(fileURLWithPath: image.path)
            if staging {
                do { try fm.linkItem(at: source, to: planned) } catch {
                    try fm.copyItem(at: source, to: planned)
                }
            } else {
                try FileActions.copyWithoutOverwriting(from: source, to: planned)
            }
        case .jpeg:
            // Names were picked before the first write, and on a long export
            // something else can reach the folder in between. Rendering has no
            // second chance at the name the way a copy does, so it is resolved
            // here and the gap that leaves is the render's length.
            let target =
                staging || !fm.fileExists(atPath: planned.path)
                ? planned : FileActions.uniqueURL(for: planned)
            try renderer.exportJPEG(
                file: image, edit: image.edit,
                quality: Double(quality) / 100, to: target,
                decoderVersion: decoderVersion)
            if image.rating > 0 {
                try? ExifTool.shared.write(
                    ["-overwrite_original", "-XMP:Rating=\(image.rating)", target.path])
            }
        }
    }

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

    private func scheduleRescan() {
        pendingRescan?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.rescanNow() }
        pendingRescan = work
        rescanQueue.asyncAfter(deadline: .now() + 0.5, execute: work)
    }

    public func rescanNow() {
        lock.lock()
        let currentRoot = root
        lock.unlock()
        guard let currentRoot, let walked = try? walkLibrary(root: currentRoot) else { return }

        // Read what is known only after the walk: on a big tree the walk takes
        // seconds, and anything enriched during it would otherwise be thrown
        // back to a placeholder.
        lock.lock()
        let known = Self.byPath(snapshot.imagesByShoot.values.joined())
        lock.unlock()
        let scanned = carryEnrichment(into: walked, from: known)

        lock.lock()
        guard scanned != snapshot else {
            lock.unlock()
            return
        }
        _ = publish(scanned)
        let index = self.index
        lock.unlock()

        store(scanned, root: currentRoot, in: index)
    }

    /// Writes the file list out and hands whatever is still a placeholder to
    /// the enricher. Both happen on the index queue, in that order, so an
    /// interrupted session still starts warm next time.
    /// The scorer keeps its own copy of the cache and hands results back here to
    /// be written, so the sqlite handle stays on one queue with the enricher.
    private func useScorer(with index: SQLiteIndex?) {
        let cached = indexQueue.sync { (try? index?.loadScores()) ?? [:] }
        let queue = indexQueue
        scorer.use(cache: cached) { rows in
            queue.async { try? index?.saveScores(rows) }
        }
    }

    private func store(_ scanned: LibrarySnapshot, root: String, in index: SQLiteIndex?) {
        indexQueue.async { [weak self] in
            try? index?.save(root: root, filesByShoot: scanned.imagesByShoot)
            self?.startEnrichment()
        }
    }
}
