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
        case unreadableProjectFile(String)
        case unknownExport(String)
        case rootSuperseded(String)
    }

    private let lock = NSLock()
    private var snapshot = LibrarySnapshot.empty
    private var root: String?
    private var rootRequests = 0
    private var generation = 0
    /// Bumped whenever the file list itself is replaced. Enrichment batches
    /// carry the epoch they were queued under and are dropped if it moved on.
    private var epoch = 0
    private var shootGenerations: [String: Int] = [:]
    private var shootPublished: [String: Date] = [:]
    #if os(macOS)
        private var watcher: Watcher?
    #endif
    private var index: SQLiteIndex?
    private let thumbnailer: Thumbnailer
    private let renderer: Renderer
    private let scorer: Scorer
    private let printer: Printer
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
        scorer: Scorer = Scorer(),
        printer: Printer = Printer()
    ) {
        self.thumbnailer = thumbnailer
        self.renderer = renderer
        self.scorer = scorer
        self.printer = printer
    }

    public static func defaultIndexPath() -> String {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Photopipe/index.sqlite").path
    }

    public struct RootSummary: Sendable, Encodable {
        public let shoots: Int
        public let files: Int
        public let generation: Int
    }

    /// Returns as soon as the tree has been walked. Ratings, edits and
    /// dimensions arrive afterwards, either straight from the index or from
    /// background enrichment, and are visible through `status`.
    public func setRoot(path: String, indexPath: String?) throws -> RootSummary {
        let path = Self.canonical(path)
        let request = lock.withLock {
            rootRequests += 1
            return rootRequests
        }
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

        let currentGeneration = try lock.withLock {
            // the caller may have timed out and opened another folder while this one was walked
            guard rootRequests == request else { throw ServiceError.rootSuperseded(path) }
            root = path
            self.index = index
            return publish(scanned)
        }

        store(scanned, root: path, in: index)
        useAnalyzers(with: index, root: path)

        #if os(macOS)
            let newWatcher = Watcher(path: path, queue: rescanQueue) { [weak self] in
                self?.scheduleRescan()
            }
            lock.withLock { watcher = newWatcher }
        #endif

        return RootSummary(
            shoots: scanned.shoots.count, files: scanned.fileCount, generation: currentGeneration)
    }

    public func listShoots() -> [Shoot] {
        lock.withLock { snapshot.shoots }
    }

    public func listImages(shoot: String) throws -> [ImageFile] {
        let images = try images(inShoot: shoot)
        let scores = scorer.values(for: images)
        // one read, so a print landing mid-call cannot be counted without being stacked
        let answers = printer.answers(for: images)
        let prints = answers.compactMapValues { $0 }
        let stacks = Stacker.stacks(prints)
        return images.map { image in
            image.with(
                score: scores[image.path], captured: prints[image.path]?.captured,
                stack: stacks[image.path] ?? (answers.keys.contains(image.path) ? image.path : nil))
        }
    }

    public func scoreShoot(shoot: String) throws -> Scorer.Progress {
        scorer.start(shoot: shoot, files: try images(inShoot: shoot))
    }

    /// Separate from scoring, so turning Instinct off in Settings leaves stacks working.
    public func stackShoot(shoot: String) throws -> Printer.Progress {
        printer.start(shoot: shoot, files: try images(inShoot: shoot))
    }

    private func images(inShoot shoot: String) throws -> [ImageFile] {
        let images = try snapshotImages(inShoot: shoot)
        // A read with a side effect: what you are looking at gets indexed first.
        enricher.prioritize(shoot: shoot)
        return images
    }

    private func snapshotImages(inShoot shoot: String) throws -> [ImageFile] {
        try lock.withLock {
            guard root != nil else { throw ServiceError.noRoot }
            guard let images = snapshot.imagesByShoot[shoot] else {
                throw ServiceError.unknownShoot(shoot)
            }
            return images
        }
    }

    public struct Status: Sendable, Encodable {
        public let generation: Int
        public let root: String?
        public let shoots: Int
        public let filesFound: Int
        public let filesEnriched: Int
        public let scanning: Bool
        /// Shoots whose images changed after the caller's generation, so the
        /// client can refetch just those instead of the whole library. Nil
        /// when the caller did not say where it left off.
        public let changedShoots: [String]?
    }

    public func status(since: Int? = nil) -> Status {
        lock.withLock {
            let enriched = snapshot.imagesByShoot.values.reduce(0) { $0 + $1.count(where: \.enriched) }
            return Status(
                generation: generation,
                root: root,
                shoots: snapshot.shoots.count,
                filesFound: snapshot.fileCount,
                filesEnriched: enriched,
                scanning: enriched < snapshot.fileCount,
                changedShoots: since.map { seen in
                    shootGenerations.filter { $0.value > seen }.keys.sorted()
                })
        }
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
        shootPublished = [:]
        for name in next.shoots.map(\.name) + departed {
            shootGenerations[name] = generation
        }
        return generation
    }

    private func startEnrichment() {
        let (currentEpoch, order) = lock.withLock {
            let pending = snapshot.unenriched
            let order = snapshot.shoots.map(\.name).compactMap { name in
                pending[name].map { (shoot: name, files: $0) }
            }
            return (epoch, order)
        }
        enricher.start(epoch: currentEpoch, work: order) { [weak self] epoch, shoot, files, done in
            self?.applyEnrichment(epoch: epoch, shoot: shoot, files: files, shootDone: done)
        }
    }

    private func applyEnrichment(
        epoch: Int, shoot: String, files: [ImageFile], shootDone: Bool
    ) {
        let applied = lock.withLock { () -> (merged: [ImageFile], index: SQLiteIndex?)? in
            guard epoch == self.epoch, let images = snapshot.imagesByShoot[shoot] else {
                return nil
            }
            let updates = Self.byPath(files)
            // A batch is a snapshot of what the files held when it was queued. If
            // an entry has been settled since — a rating written, say — it is the
            // newer truth and the batch must not walk over it.
            let accepted = images.map { current in
                current.enriched ? current : updates[current.path] ?? current
            }
            snapshot = snapshot.replacingImages(inShoot: shoot, with: accepted)
            generation += 1

            // Refetching a shoot means re-encoding every image in it, so say a
            // shoot changed at most once a second. The dashboard's counters ride
            // the global generation, which is free to move every batch.
            let now = Date()
            if shootDone || now.timeIntervalSince(shootPublished[shoot] ?? .distantPast) >= 1 {
                shootGenerations[shoot] = generation
                shootPublished[shoot] = now
            }
            return (accepted.filter { updates[$0.path] == $0 }, index)
        }
        guard let (merged, index) = applied else { return }

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
        let shoots = lock.withLock { snapshot.imagesByShoot }
        // one raw per shoot: cameras rarely differ within a shoot, and the
        // probe caches per camera
        let samples = shoots.values.compactMap { $0.first(where: \.isRaw) }
        // A file still copying answers nothing, not no. Condemning the library
        // on it would stick, because the client caches this for the session.
        var answered = false
        for sample in samples {
            guard let verdict = renderer.known(file: sample, major: 9) else { continue }
            // a probe loads RAW 9 on its first yes, which takes seconds; one is enough
            if verdict { return true }
            answered = true
        }
        return answered ? false : nil
    }

    public struct DecoderSupport: Sendable, Encodable {
        public let raw9: Int
        public let rawTotal: Int
    }

    public func decoderSupport(paths: [String]) throws -> DecoderSupport {
        let files = try pathsUnderRoot(paths)
            .compactMap { try? recordUnderRoot(path: $0) }
            .filter(\.isRaw)
        guard !files.isEmpty else { return DecoderSupport(raw9: 0, rawTotal: 0) }
        // a whole shoot serially outruns the caller's request timeout
        DispatchQueue.concurrentPerform(iterations: files.count) { index in
            _ = renderer.supports(file: files[index], major: 9)
        }
        // every answer is cached now, so this pass never touches a file
        return DecoderSupport(
            raw9: files.count { renderer.supports(file: $0, major: 9) }, rawTotal: files.count)
    }

    private func recordUnderRoot(path: String) throws -> ImageFile {
        let currentRoot = try requireRoot()
        let canonical = try Self.canonical(path, under: currentRoot)
        let attrs = try FileManager.default.attributesOfItem(atPath: canonical)
        return ImageFile(
            path: canonical,
            rel: String(canonical.dropFirst(currentRoot.count + 1)),
            ext: (canonical as NSString).pathExtension,
            size: (attrs[.size] as? Int64) ?? 0,
            mtime: ((attrs[.modificationDate] as? Date) ?? .distantPast).timeIntervalSince1970)
    }

    /// One index for the whole selection, since a linear scan per path is quadratic.
    private func images(inShoot shootName: String, paths: [String]) throws -> [ImageFile] {
        let images = try snapshotImages(inShoot: shootName)
        let byPath = Self.byPath(images)
        // Clients send back the paths they were listed, so canonicalizing every
        // photo is the fallback: the walk keeps /private, canonical() drops it.
        lazy var byCanonical = Dictionary(
            images.map { (Self.canonical($0.path), $0) }, uniquingKeysWith: { _, last in last })
        return try paths.map { path in
            guard let image = byPath[path] ?? byCanonical[Self.canonical(path)] else {
                throw ServiceError.unknownImage(path)
            }
            return image
        }
    }

    /// The image with its real metadata, reading it now if enrichment has not
    /// reached it. A write against a placeholder would both lose what the file
    /// already carries and be overwritten by the batch still in the queue.
    private func settledImage(shoot: String, path: String) throws -> ImageFile {
        let image = try images(inShoot: shoot, paths: [path])[0]
        guard !image.enriched else { return image }
        let settled = enrich(image)
        replace(settled, inShoot: shoot)
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
        replace(settled, inShoot: shoot)
        scorer.restamp(image, to: settled)
        printer.restamp(image, to: settled)
        let index = lock.withLock { self.index }
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
            sidecarMtime: XMP.sidecarMtime(forImagePath: file.path))
    }

    /// Not announced through `status`: the writer gets the new value in its
    /// answer, and a shoot named as changed costs every client a full refetch.
    private func replace(_ image: ImageFile, inShoot shootName: String) {
        lock.withLock {
            guard var updated = snapshot.imagesByShoot[shootName],
                let index = updated.firstIndex(where: { $0.path == image.path })
            else { return }
            updated[index] = image
            snapshot = snapshot.replacingImages(inShoot: shootName, with: updated)
        }
    }

    public struct RatingChange: Sendable, Encodable {
        public let rating: Int
    }

    public func setRating(shoot shootName: String, path: String, rating: Int) throws
        -> RatingChange
    {
        guard (0...5).contains(rating) else { throw ServiceError.invalidRating(rating) }
        let settled = try write(shoot: shootName, path: path) { image in
            try XMP.writeRating(rating, file: image)
        }
        return RatingChange(rating: settled.rating)
    }

    public struct EditChange: Sendable, Encodable {
        public let edit: Edit
    }

    public func setEdit(shoot shootName: String, path: String, edit: Edit) throws -> EditChange {
        let settled = try write(shoot: shootName, path: path) { image in
            try XMP.writeEdit(edit, file: image)
        }
        return EditChange(edit: settled.edit)
    }

    /// A leading dot is refused because the scan would hide the folder.
    static func projectFolder(name: String) throws -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let scalars = trimmed.unicodeScalars
        guard !trimmed.isEmpty, !scalars.contains("/"), !scalars.contains(":"),
            scalars.first != ".", !scalars.contains(where: { $0.value < 0x20 || $0.value == 0x7F })
        else {
            throw ServiceError.invalidProjectName(name)
        }
        return trimmed
    }

    static func freeProjectURL(root: String, folder: String) throws -> URL {
        let url = URL(fileURLWithPath: root).appendingPathComponent(folder)
        guard !FileManager.default.fileExists(atPath: url.path) else {
            throw ServiceError.projectExists(folder)
        }
        return url
    }

    public struct UpdatedProject: Sendable, Encodable {
        public let shoot: String
        public let generation: Int
    }

    public func updateProject(
        shoot shootName: String, name: String, day: String?, notes: String, cover: String?
    ) throws -> UpdatedProject {
        let shoot = try self.shoot(named: shootName)
        let source = URL(fileURLWithPath: shoot.path)
        if day != nil, day.map(isDay) != true { throw ServiceError.invalidProjectDay(day ?? "") }
        guard ProjectFile.read(inShoot: shoot.path) != nil else {
            throw ServiceError.unreadableProjectFile(shoot.name)
        }

        let folder = try Self.projectFolder(name: name)
        var path = source
        if folder != shoot.name {
            path = try Self.freeProjectURL(
                root: source.deletingLastPathComponent().path, folder: folder)
            try FileManager.default.moveItem(at: source, to: path)
        }

        do {
            try ProjectFile(notes: notes, day: day, cover: cover).write(inShoot: path.path)
        } catch {
            if path != source { try? FileManager.default.moveItem(at: path, to: source) }
            rescanNow()
            throw error
        }

        rescanNow()
        return UpdatedProject(shoot: folder, generation: status().generation)
    }

    public struct CreatedProject: Sendable, Encodable {
        public let shoot: String
        public let path: String
        public let generation: Int
    }

    public func createProject(name: String, notes: String) throws -> CreatedProject {
        let currentRoot = try requireRoot()
        let folder = try Self.projectFolder(name: name)
        let path = try Self.freeProjectURL(root: currentRoot, folder: folder)
        try FileManager.default.createDirectory(at: path, withIntermediateDirectories: false)
        try ProjectFile(notes: notes).write(inShoot: path.path)

        rescanNow()
        return CreatedProject(shoot: folder, path: path.path, generation: status().generation)
    }

    public func captureDate(path: String) throws -> String? {
        let canonical = try pathsUnderRoot([path])[0]
        return Dimensions.captureDay(at: URL(fileURLWithPath: canonical))
    }

    public func startImport(shoot shootName: String, paths: [String]) throws
        -> Exporter.Progress
    {
        let shootPath = try shoot(named: shootName).path
        let images = paths.filter(isImagePath)
        guard !images.isEmpty else { throw FileActions.ActionError.noFiles }
        return exporter.start(plan: .importing(images, into: shootPath), settled: rescanWhenSettled)
    }

    private func shoot(named shootName: String) throws -> Shoot {
        let shoot = lock.withLock { snapshot.shoots.first { $0.name == shootName } }
        guard let shoot else { throw ServiceError.unknownShoot(shootName) }
        return shoot
    }

    public struct TrashResult: Sendable, Encodable {
        public let files: Int
        public let generation: Int
    }

    public func trashImages(shoot shootName: String, paths: [String]) throws -> TrashResult {
        let doomed = try images(inShoot: shootName, paths: paths)
        let doomedPaths = Set(doomed.map(\.path))
        // raws sharing a stem, like an ORF and its ORI, share Lightroom's DSC0001.xmp
        let stillUsed = Set(
            try snapshotImages(inShoot: shootName).filter { !doomedPaths.contains($0.path) }
                .map { XMP.sidecarURL(forImagePath: $0.path).path })
        let sidecars = Set(doomed.map { XMP.sidecarURL(forImagePath: $0.path).path })
            .subtracting(stillUsed).filter { FileManager.default.fileExists(atPath: $0) }
        let targets = doomed.map(\.path) + sidecars.sorted()
        guard !targets.isEmpty else { throw ServiceError.unknownImage(paths.first ?? "") }

        let trashed = try FileActions.trash(paths: try pathsUnderRoot(targets))
        rescanNow()
        return TrashResult(files: trashed.count, generation: status().generation)
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
        return try exporter.start(
            plan: .export(
                images, to: destination, zip: zip, flatten: flatten, format: format,
                quality: quality, decoderVersion: decoderVersion, renderer: renderer),
            settled: rescanWhenSettled)
    }

    /// The watcher would see the delivered files, but iPadOS has none.
    private var rescanWhenSettled: @Sendable () -> Void {
        { [weak self] in self?.rescanNow() }
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

    private func pathsUnderRoot(_ paths: [String]) throws -> [String] {
        let currentRoot = try requireRoot()
        return try paths.map { try Self.canonical($0, under: currentRoot) }
    }

    private func requireRoot() throws -> String {
        guard let root = lock.withLock({ root }) else { throw ServiceError.noRoot }
        return root
    }

    private static func canonical(_ path: String) -> String {
        URL(fileURLWithPath: path).standardizedFileURL.path
    }

    private static func canonical(_ path: String, under root: String) throws -> String {
        let canonical = canonical(path)
        guard canonical.hasPrefix(root + "/") else { throw ServiceError.pathOutsideRoot(path) }
        return canonical
    }

    private func scheduleRescan() {
        pendingRescan?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.rescanNow() }
        pendingRescan = work
        rescanQueue.asyncAfter(deadline: .now() + 0.5, execute: work)
    }

    public func rescanNow() {
        guard let currentRoot = try? requireRoot(),
            let walked = try? walkLibrary(root: currentRoot)
        else { return }

        // Read what is known only after the walk: on a big tree the walk takes
        // seconds, and anything enriched during it would otherwise be thrown
        // back to a placeholder.
        let known = lock.withLock { Self.byPath(snapshot.imagesByShoot.values.joined()) }
        let scanned = carryEnrichment(into: walked, from: known)

        let (changed, index) = lock.withLock { () -> (Bool, SQLiteIndex?) in
            let changed = scanned != snapshot
            if changed { _ = publish(scanned) }
            return (changed, self.index)
        }
        guard changed else { return }

        store(scanned, root: currentRoot, in: index)
    }

    /// Each analyzer keeps its own copy of the cache and hands results back here to
    /// be written, so the sqlite handle stays on one queue with the enricher.
    private func useAnalyzers(with index: SQLiteIndex?, root: String) {
        let queue = indexQueue
        // on the queue, so a superseded root's late load cannot land after the current one
        queue.sync {
            scorer.use(cache: (try? index?.loadScores(under: root)) ?? [:]) { rows in
                queue.async { try? index?.saveScores(rows) }
            }
            printer.use(cache: (try? index?.loadPrints(under: root)) ?? [:]) { rows in
                queue.async { try? index?.savePrints(rows) }
            }
        }
    }

    /// Writes the file list out and hands whatever is still a placeholder to
    /// the enricher. Both happen on the index queue, in that order, so an
    /// interrupted session still starts warm next time.
    private func store(_ scanned: LibrarySnapshot, root: String, in index: SQLiteIndex?) {
        indexQueue.async { [weak self] in
            try? index?.save(root: root, filesByShoot: scanned.imagesByShoot)
            self?.startEnrichment()
        }
    }
}

extension LibraryService.ServiceError: WireError {
    public var wire: ResponseError {
        switch self {
        case .noRoot: ResponseError(code: "no_root", message: "call setRoot first")
        case .unknownShoot(let name): ResponseError(code: "unknown_shoot", message: name)
        case .pathOutsideRoot(let path): ResponseError(code: "path_outside_root", message: path)
        case .unknownImage(let stem): ResponseError(code: "unknown_image", message: stem)
        case .invalidRating(let rating):
            ResponseError(code: "invalid_rating", message: "rating \(rating) not in 0...5")
        case .invalidProjectName(let name):
            ResponseError(code: "invalid_project_name", message: "\(name) is not a usable project name")
        case .invalidProjectDay(let day):
            ResponseError(code: "invalid_project_day", message: "\(day) is not a YYYY-MM-DD date")
        case .unknownExport(let id): ResponseError(code: "unknown_export", message: id)
        case .rootSuperseded(let path):
            ResponseError(code: "superseded", message: "\(path) was replaced by a newer folder")
        case .projectExists(let folder):
            ResponseError(code: "project_exists", message: "\(folder) already exists")
        case .unreadableProjectFile(let shoot):
            ResponseError(
                code: "unreadable_project_file",
                message: "\(shoot) has a photopipe.json that could not be read")
        }
    }
}
