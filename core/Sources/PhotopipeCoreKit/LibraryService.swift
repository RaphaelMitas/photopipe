import CoreGraphics
import Foundation
import Synchronization

public final class LibraryService: @unchecked Sendable {
    public enum ServiceError: Error {
        case noRoot
        case unknownShoot(String)
        case unknownImage(String)
        case pathOutsideRoot(String)
        case invalidRating(Int)
        case invalidFlag(Int)
        case invalidProjectName(String)
        case invalidExportName(String)
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
    private let facer: Facer
    private let exporter = Exporter()
    let modelStore = ModelStore(folder: ModelStore.defaultFolder())
    private let rescanQueue = DispatchQueue(label: "photopipe.rescan")
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
        facer = Facer(renderer: renderer)
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

    public func setRoot(path: String, indexPath: String?) throws -> RootSummary {
        let path = Self.canonical(path)
        let request = lock.withLock {
            rootRequests += 1
            return rootRequests
        }
        let (index, warm) = indexQueue.sync { () -> (SQLiteIndex?, [String: ImageFile]) in
            let index = try? SQLiteIndex(path: indexPath ?? Self.defaultIndexPath())
            guard let stored = (try? index?.load()) ?? nil, stored.root == path else {
                return (index, [:])
            }
            return (index, Self.byPath(stored.filesByShoot.values.joined()))
        }
        let scanned = carryEnrichment(into: try walkLibrary(root: path), from: warm)

        let currentGeneration = try lock.withLock {
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
        let answers = printer.answers(for: images)
        let captured = images.reduce(into: [String: Double]()) { $0[$1.path] = $1.captured }
        let stacks = Stacker.stacks(answers.compactMapValues { $0 }, captured: captured)
        return images.map { image in
            image.with(
                score: scores[image.path],
                stack: stacks[image.path] ?? (answers.keys.contains(image.path) ? image.path : nil))
        }
    }

    public func scoreShoot(shoot: String) throws -> Scorer.Progress {
        scorer.start(shoot: shoot, files: try images(inShoot: shoot))
    }

    public func stackShoot(shoot: String) throws -> Printer.Progress {
        printer.start(shoot: shoot, files: try images(inShoot: shoot))
    }

    private func images(inShoot shoot: String) throws -> [ImageFile] {
        let images = try snapshotImages(inShoot: shoot)
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

    private func publish(_ next: LibrarySnapshot) -> Int {
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
            let accepted = images.map { current in
                current.enriched ? current : updates[current.path] ?? current
            }
            snapshot = snapshot.replacingImages(inShoot: shoot, with: accepted)
            generation += 1

            let now = Date()
            if shootDone || now.timeIntervalSince(shootPublished[shoot] ?? .distantPast) >= 1 {
                shootGenerations[shoot] = generation
                shootPublished[shoot] = now
            }
            return (accepted.filter { updates[$0.path] == $0 }, index)
        }
        guard let (merged, index) = applied else { return }

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
    ) throws -> Renderer.Preview {
        try renderer.preview(
            file: recordUnderRoot(path: path), edit: edit, maxPixel: maxPixel,
            viewport: viewport, decoderVersion: decoderVersion)
    }

    public func look(
        ids: [String], edited: Bool, longEdge: Int, at spot: CGPoint?, sheet: Bool,
        faces: Bool = false, maxBytes: Int
    ) throws -> Look.Reply {
        guard !ids.isEmpty else { throw Look.LookError.nothingToShow }
        let limit = sheet || faces ? Look.sheetLimit : Look.separateLimit
        guard ids.count <= limit else { throw Look.LookError.tooMany(ids.count, limit: limit) }
        let files = try readImages(ids: ids)
        let longEdge = min(max(longEdge, Look.longEdges.lowerBound), Look.longEdges.upperBound)
        if faces {
            return Look.Reply(
                images: [try faceSheet(of: files, ids: ids, longEdge: longEdge, maxBytes: maxBytes)],
                unmasked: [])
        }
        let tile = sheet ? Look.grid(count: files.count, longEdge: longEdge).cell : longEdge
        let rendered = try renderInBatches(files.count) { index in
            try self.still(of: files[index], edited: edited, tile: tile, at: spot)
        }
        let unmasked = rendered.indices.filter { rendered[$0].unmasked }
        if sheet {
            let labels = files.enumerated().map { index, file in
                "\(index + 1)  \(Self.stem(file))"
            }
            let canvas = try Look.sheet(rendered.map(\.image), labels: labels, longEdge: longEdge)
            return Look.Reply(images: [try Look.shown(canvas, maxBytes: maxBytes)], unmasked: unmasked)
        }
        return Look.Reply(
            images: try rendered.map { try Look.shown($0.image, maxBytes: maxBytes / rendered.count) },
            unmasked: unmasked)
    }

    private func faceSheet(of files: [ImageFile], ids: [String], longEdge: Int, maxBytes: Int) throws
        -> Look.Shown
    {
        let found = try self.faces(ids: ids, wait: 60)
        let pending = found.count { !$0.done }
        guard pending == 0 else { throw Look.LookError.facesPending(pending) }
        let crops = zip(files, found).enumerated().flatMap { index, pair in
            (pair.1.faces ?? []).enumerated().map { face, spot in
                (
                    file: pair.0, box: Look.around(spot.box),
                    label: "\(index + 1).\(face + 1)  \(Self.stem(pair.0))"
                )
            }
        }
        guard !crops.isEmpty else { throw Look.LookError.noFaces }
        guard crops.count <= Look.sheetLimit else { throw Look.LookError.tooManyFaces(crops.count) }
        let tile = Look.grid(count: crops.count, longEdge: longEdge).cell
        let rendered = try renderInBatches(crops.count) { index in
            try self.renderer.still(
                file: crops[index].file, edit: .identity, longEdge: tile, viewport: crops[index].box
            ).image
        }
        let canvas = try Look.sheet(rendered, labels: crops.map(\.label), longEdge: longEdge)
        return try Look.shown(canvas, maxBytes: maxBytes)
    }

    private static func stem(_ file: ImageFile) -> String {
        (file.rel as NSString).lastPathComponent
    }

    private func renderInBatches<Still: Sendable>(
        _ count: Int, _ render: @escaping @Sendable (Int) throws -> Still
    ) throws -> [Still] {
        let stills = Mutex([Still?](repeating: nil, count: count))
        let failure = Mutex<Error?>(nil)
        for start in stride(from: 0, to: count, by: 3) {
            let batch = Array(start..<min(start + 3, count))
            DispatchQueue.concurrentPerform(iterations: batch.count) { slot in
                let index = batch[slot]
                do {
                    let still = try render(index)
                    stills.withLock { $0[index] = still }
                } catch {
                    failure.withLock { $0 = $0 ?? error }
                }
            }
            if let error = failure.withLock({ $0 }) { throw error }
        }
        return stills.withLock { $0 }.compactMap { $0 }
    }

    public struct PhotoFaces: Sendable, Encodable {
        public let faces: [FaceSpot]?
        public let done: Bool
    }

    public func faces(ids: [String], wait: TimeInterval = 90) throws -> [PhotoFaces] {
        guard ids.count <= Look.sheetLimit else {
            throw Look.LookError.tooMany(ids.count, limit: Look.sheetLimit)
        }
        let deadline = Date().addingTimeInterval(wait)
        var files = try knownImages(ids: ids)
        var answers = facer.answers(for: files)
        while !files.allSatisfy({ answers.keys.contains($0.path) }), Date() < deadline {
            facer.start(shoot: "agent", files: files)
            Thread.sleep(forTimeInterval: 0.25)
            guard let fresh = try? knownImages(ids: ids) else { break }
            files = fresh
            answers = facer.answers(for: files)
        }
        return files.map {
            PhotoFaces(faces: answers[$0.path] ?? nil, done: answers.keys.contains($0.path))
        }
    }

    public struct Description: Sendable, Encodable {
        public let text: String?
        public let error: String?
        public let unmasked: Bool
    }

    public func describe(ids: [String]) throws -> [Description] {
        guard ids.count <= Look.separateLimit else {
            throw Look.LookError.tooMany(ids.count, limit: Look.separateLimit)
        }
        guard Describer.isAvailable else { throw Describer.Unavailable() }
        return try readImages(ids: ids).map { file in
            do {
                let still = try still(of: file, edited: true, tile: 1024, at: nil)
                return Description(
                    text: try Describer.describe(still.image), error: nil, unmasked: still.unmasked)
            } catch {
                let error = error is Renderer.RenderError ? "could not read this photo" : "\(error)"
                return Description(text: nil, error: error, unmasked: false)
            }
        }
    }

    private func still(of file: ImageFile, edited: Bool, tile: Int, at spot: CGPoint?) throws
        -> (image: CGImage, unmasked: Bool)
    {
        let edit = edited ? file.edit : .identity
        let viewport = spot.map {
            Look.viewport(around: $0, tile: tile, framed: Look.framedSize(of: file, edit: edit))
        }
        return try renderer.still(file: file, edit: edit, longEdge: tile, viewport: viewport)
    }

    public struct Original: Sendable, Encodable {
        public let path: String
        public let sidecar: String?
    }

    public func originals(ids: [String]) throws -> [Original] {
        try knownImages(ids: ids).map { image in
            let sidecar = XMP.sidecarURL(forImagePath: image.path)
            return Original(
                path: image.path,
                sidecar: (try? XMP.isOwnSidecar(sidecar)) == true ? sidecar.path : nil)
        }
    }

    private func readImages(ids: [String]) throws -> [ImageFile] {
        try knownImages(ids: ids).map { $0.enriched ? $0 : enrich($0) }
    }

    private func knownImages(ids: [String]) throws -> [ImageFile] {
        var shoots: [String: [String: ImageFile]] = [:]
        return try ids.map { id in
            let parts = id.split(separator: "/", maxSplits: 1).map(String.init)
            guard parts.count == 2 else { throw ServiceError.unknownImage(id) }
            if shoots[parts[0]] == nil {
                shoots[parts[0]] = Dictionary(
                    try snapshotImages(inShoot: parts[0]).map { ($0.rel, $0) },
                    uniquingKeysWith: { $1 })
            }
            guard let image = shoots[parts[0]]?[parts[1]] else { throw ServiceError.unknownImage(id) }
            return image
        }
    }

    public func maskOverlay(
        path: String, source: Mask.Source, points: [Mask.Point], inverted: Bool, edit: Edit,
        maxPixel: Int
    ) throws -> String {
        try renderer.maskOverlay(
            file: recordUnderRoot(path: path), source: source, points: points, inverted: inverted,
            edit: edit, maxPixel: maxPixel
        ).path
    }

    public func maskAt(
        path: String, edit: Edit, points: [Mask.Point], inverted: Bool, at framedSpot: CGPoint,
        include: Bool, maxPixel: Int
    ) throws -> Renderer.MaskPick {
        try renderer.maskAt(
            file: recordUnderRoot(path: path), edit: edit, points: points, inverted: inverted,
            at: framedSpot, include: include, maxPixel: maxPixel)
    }

    public func rawDefaults(path: String, decoderVersion: Int? = nil) throws
        -> Renderer.RawDefaults?
    {
        try renderer.rawDefaults(for: recordUnderRoot(path: path), decoderVersion: decoderVersion)
    }

    public func raw9Availability() -> Bool? {
        let shoots = lock.withLock { snapshot.imagesByShoot }
        let samples = shoots.values.compactMap { $0.first(where: \.isRaw) }
        var answered = false
        for sample in samples {
            guard let verdict = renderer.known(file: sample, major: 9) else { continue }
            if verdict { return true }
            answered = true
        }
        return answered ? false : nil
    }

    func models() -> ModelsReport {
        ModelsReport(
            entries: modelStore.entries(),
            tasks: .init(
                findRegion: .init(clicks: Masker.isAvailable ? Mask.clickLimit : 0),
                fillHole: .init(model: ModelEntry.fillHole.id)))
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
        DispatchQueue.concurrentPerform(iterations: files.count) { index in
            _ = renderer.supports(file: files[index], major: 9)
        }
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

    private func images(inShoot shootName: String, paths: [String]) throws -> [ImageFile] {
        let images = try snapshotImages(inShoot: shootName)
        let byPath = Self.byPath(images)
        lazy var byCanonical = Dictionary(
            images.map { (Self.canonical($0.path), $0) }, uniquingKeysWith: { $1 })
        return try paths.map { path in
            guard let image = byPath[path] ?? byCanonical[Self.canonical(path)] else {
                throw ServiceError.unknownImage(path)
            }
            return image
        }
    }

    private func settledImage(shoot: String, path: String) throws -> ImageFile {
        let image = try images(inShoot: shoot, paths: [path])[0]
        guard !image.enriched else { return image }
        let settled = enrich(image)
        replace(settled, inShoot: shoot)
        return settled
    }

    private func write(
        shoot: String, path: String, _ apply: (ImageFile) throws -> Void
    ) throws -> ImageFile {
        let image = try settledImage(shoot: shoot, path: path)
        let before = Self.restat(image)
        try apply(image)
        return settleAfterWrite(shoot: shoot, image: before)
    }

    private func settleAfterWrite(shoot: String, image: ImageFile) -> ImageFile {
        let settled = enrich(Self.restat(image))
        replace(settled, inShoot: shoot)
        scorer.restamp(image, to: settled)
        printer.restamp(image, to: settled)
        facer.restamp(image, to: settled)
        renderer.restamp(image, to: settled)
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

    public struct FlagChange: Sendable, Encodable {
        public let flag: Int
    }

    public func setFlag(shoot shootName: String, path: String, flag: Int) throws -> FlagChange {
        guard (-1...1).contains(flag) else { throw ServiceError.invalidFlag(flag) }
        let settled = try write(shoot: shootName, path: path) { image in
            try XMP.writeFlag(flag, file: image)
        }
        return FlagChange(flag: settled.flag)
    }

    public struct EditChange: Sendable, Encodable {
        public let edit: Edit
    }

    public func setEdit(shoot shootName: String, path: String, edit: Edit) throws -> EditChange {
        let settled = try write(shoot: shootName, path: path) { image in
            try XMP.writeEdit(edit, file: image, asShot: try? renderer.rawDefaults(for: image))
        }
        return EditChange(edit: settled.edit)
    }

    static func projectFolder(name: String) throws -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard FileActions.isUsableName(trimmed) else { throw ServiceError.invalidProjectName(name) }
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

    public func startExport(
        shoot shootName: String, paths: [String], destination: String,
        zip: Bool, flatten: Bool, format: ExportFormat, quality: Int,
        longEdge: Int? = nil, decoderVersion: Int? = nil, names: [String]? = nil
    ) throws -> Exporter.Progress {
        let images = try images(inShoot: shootName, paths: pathsUnderRoot(paths))
        guard !images.isEmpty else { throw FileActions.ActionError.noFiles }
        if let names {
            guard names.count == images.count else {
                throw ServiceError.invalidExportName(
                    "\(names.count) names for \(images.count) photos")
            }
            if let bad = names.first(where: { !FileActions.isUsableName($0) }) {
                throw ServiceError.invalidExportName("\(bad) is not a usable file name")
            }
        }
        return try exporter.start(
            plan: .export(
                images, to: destination, zip: zip, flatten: flatten, format: format,
                quality: quality, longEdge: longEdge, decoderVersion: decoderVersion,
                names: names, renderer: renderer),
            settled: rescanWhenSettled)
    }

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

    private func useAnalyzers(with index: SQLiteIndex?, root: String) {
        let queue = indexQueue
        queue.sync {
            scorer.use(cache: (try? index?.loadScores(under: root)) ?? [:]) { rows in
                queue.async { try? index?.saveScores(rows) }
            }
            printer.use(cache: (try? index?.loadPrints(under: root)) ?? [:]) { rows in
                queue.async { try? index?.savePrints(rows) }
            }
            facer.use(cache: (try? index?.loadFaces(under: root)) ?? [:]) { rows in
                queue.async { try? index?.saveFaces(rows) }
            }
        }
    }

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
        case .invalidFlag(let flag):
            ResponseError(code: "invalid_flag", message: "flag \(flag) not in -1...1")
        case .invalidProjectName(let name):
            ResponseError(code: "invalid_project_name", message: "\(name) is not a usable project name")
        case .invalidExportName(let message):
            ResponseError(code: "invalid_export_name", message: message)
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
