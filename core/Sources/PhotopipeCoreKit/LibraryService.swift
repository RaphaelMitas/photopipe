import Foundation

public final class LibraryService {
    public enum ServiceError: Error {
        case noRoot
        case unknownShoot(String)
        case unknownImage(String)
        case pathOutsideRoot(String)
        case invalidRating(Int)
        case invalidProjectName(String)
        case invalidProjectDay(String)
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

    public func setRoot(path: String, indexPath: String?) throws -> (
        shoots: Int, files: Int, generation: Int
    ) {
        let path = URL(fileURLWithPath: path).standardizedFileURL.path
        let scanned = try scanLibrary(root: path)

        lock.lock()
        root = path
        snapshot = scanned
        generation += 1
        let currentGeneration = generation
        lock.unlock()

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

    public func listImages(shoot: String) throws -> [ImageFile] {
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

    public func thumbnail(path: String, maxPixel: Int) throws -> String {
        try thumbnailer.thumbnail(for: recordUnderRoot(path: path), maxPixel: maxPixel).path
    }

    public func render(path: String, exposure: Double, maxPixel: Int) throws -> String {
        try renderer.render(
            file: recordUnderRoot(path: path), exposure: exposure, maxPixel: maxPixel
        ).path
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

    private func updateSnapshot(
        shoot shootName: String, path: String, _ transform: (ImageFile) -> ImageFile
    ) {
        lock.lock()
        defer { lock.unlock() }
        if var updated = snapshot.imagesByShoot[shootName],
            let index = updated.firstIndex(where: { $0.path == path })
        {
            updated[index] = transform(updated[index])
            var imagesByShoot = snapshot.imagesByShoot
            imagesByShoot[shootName] = updated
            snapshot = LibrarySnapshot(
                shoots: snapshot.shoots, imagesByShoot: imagesByShoot,
                fileCount: snapshot.fileCount)
            generation += 1
        }
    }

    public func setRating(shoot shootName: String, path: String, rating: Int) throws -> (
        rating: Int, generation: Int
    ) {
        guard (0...5).contains(rating) else { throw ServiceError.invalidRating(rating) }
        let image = try image(shoot: shootName, path: path)

        try XMP.writeRating(rating, file: image, tool: .shared)

        updateSnapshot(shoot: shootName, path: image.path) { $0.with(rating: rating) }
        return (rating, status().generation)
    }

    public func setExposure(shoot shootName: String, path: String, exposure: Double) throws -> (
        exposure: Double, generation: Int
    ) {
        let image = try image(shoot: shootName, path: path)

        try XMP.writeExposure(exposure, file: image, tool: .shared)

        updateSnapshot(shoot: shootName, path: image.path) { $0.with(exposure: exposure) }
        return (exposure, status().generation)
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
        lock.lock()
        let path = snapshot.shoots.first { $0.name == shootName }?.path
        lock.unlock()
        guard let path else { throw ServiceError.unknownShoot(shootName) }

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
        lock.lock()
        let currentRoot = root
        let path = snapshot.shoots.first { $0.name == shootName }?.path
        lock.unlock()
        guard let currentRoot else { throw ServiceError.noRoot }
        guard let path else { throw ServiceError.unknownShoot(shootName) }

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

    public func importFiles(shoot shootName: String, paths: [String]) throws -> (
        imported: Int, skipped: Int, generation: Int
    ) {
        lock.lock()
        let path = snapshot.shoots.first { $0.name == shootName }?.path
        lock.unlock()
        guard let path else { throw ServiceError.unknownShoot(shootName) }

        let images = paths.filter(isImagePath)
        guard !images.isEmpty else { throw FileActions.ActionError.noFiles }
        let copied = try FileActions.copy(paths: images, toFolder: path)
        rescanNow()
        return (copied, paths.count - images.count, status().generation)
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

    public func exportFiles(
        shoot shootName: String, paths: [String], destination: String,
        zip: Bool, flatten: Bool, format: ExportFormat, quality: Int
    ) throws -> Int {
        let images = try pathsUnderRoot(paths).map { try image(shoot: shootName, path: $0) }
        guard !images.isEmpty else { throw FileActions.ActionError.noFiles }

        var used: Set<String> = []
        let items: [(image: ImageFile, rel: String)] = images.map { image in
            var rel = image.rel
            if format == .jpeg {
                rel = (rel as NSString).deletingPathExtension + ".jpg"
            }
            if flatten {
                rel = (rel as NSString).lastPathComponent
            }
            let name = FileActions.uniqueName(rel) { used.contains($0.lowercased()) }
            used.insert(name.lowercased())
            return (image, name)
        }

        let fm = FileManager.default
        if zip {
            let staging = fm.temporaryDirectory
                .appendingPathComponent("photopipe-export-\(UUID().uuidString)")
            defer { try? fm.removeItem(at: staging) }
            for (image, rel) in items {
                try write(image, format: format, quality: quality,
                    to: staging.appendingPathComponent(rel), staging: true)
            }
            try FileActions.zipDirectory(at: staging, to: destination)
        } else {
            let base = URL(fileURLWithPath: destination)
            for (image, rel) in items {
                let target = FileActions.uniqueURL(for: base.appendingPathComponent(rel))
                try write(image, format: format, quality: quality, to: target, staging: false)
            }
        }
        return items.count
    }

    private func write(
        _ image: ImageFile, format: ExportFormat, quality: Int, to target: URL, staging: Bool
    ) throws {
        let fm = FileManager.default
        try fm.createDirectory(
            at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        switch format {
        case .original:
            let source = URL(fileURLWithPath: image.path)
            if staging {
                do { try fm.linkItem(at: source, to: target) } catch {
                    try fm.copyItem(at: source, to: target)
                }
            } else {
                try fm.copyItem(at: source, to: target)
            }
        case .jpeg:
            try renderer.exportJPEG(
                file: image, exposure: image.exposure,
                quality: Double(quality) / 100, to: target)
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

    static func filesByShoot(_ snapshot: LibrarySnapshot) -> [String: [ImageFile]] {
        snapshot.imagesByShoot
    }
}
