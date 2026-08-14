import Foundation

public struct LibrarySnapshot: Equatable, Sendable {
    public let shoots: [Shoot]
    public let imagesByShoot: [String: [ImageFile]]
    public let fileCount: Int

    public static let empty = LibrarySnapshot(shoots: [], imagesByShoot: [:], fileCount: 0)

    public init(shoots: [Shoot], imagesByShoot: [String: [ImageFile]], fileCount: Int) {
        self.shoots = shoots
        self.imagesByShoot = imagesByShoot
        self.fileCount = fileCount
    }
}

public enum ScanError: Error {
    case rootNotFound(String)
}

public func scanLibrary(root: String) throws -> LibrarySnapshot {
    let fm = FileManager.default
    var isDirectory: ObjCBool = false
    guard fm.fileExists(atPath: root, isDirectory: &isDirectory), isDirectory.boolValue else {
        throw ScanError.rootNotFound(root)
    }
    let rootURL = URL(fileURLWithPath: root)

    let shootDirs =
        (try fm.contentsOfDirectory(
            at: rootURL,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]))
        .filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }

    var shoots: [Shoot] = []
    var imagesByShoot: [String: [ImageFile]] = [:]
    var fileCount = 0

    for dir in shootDirs {
        let images = scanShootDirectory(dir)
        let isProject = fm.fileExists(atPath: ProjectFile.url(inShoot: dir.path).path)
        guard !images.isEmpty || isProject else { continue }
        fileCount += images.count
        let project = isProject ? ProjectFile.read(inShoot: dir.path) : ProjectFile()
        let shoot = makeShoot(
            name: dir.lastPathComponent, path: dir.path, images: images,
            notes: project.notes, cover: project.cover)
        shoots.append(shoot)
        imagesByShoot[shoot.name] = images
    }

    shoots.sort {
        switch ($0.day, $1.day) {
        case (let a?, let b?) where a != b: a > b
        case (.some, .none): true
        case (.none, .some): false
        default: $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
    }

    return LibrarySnapshot(shoots: shoots, imagesByShoot: imagesByShoot, fileCount: fileCount)
}

private func scanShootDirectory(_ dir: URL) -> [ImageFile] {
    let fm = FileManager.default
    guard
        let enumerator = fm.enumerator(
            at: dir,
            includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey],
            options: [.skipsHiddenFiles])
    else { return [] }

    let prefix = dir.path + "/"
    var images: [ImageFile] = []
    for case let url as URL in enumerator {
        guard
            let values = try? url.resourceValues(forKeys: [
                .isRegularFileKey, .fileSizeKey, .contentModificationDateKey,
            ]),
            values.isRegularFile == true,
            isImagePath(url.path)
        else { continue }
        let path = url.path
        let stub = ImageFile(
            path: path,
            rel: String(path.dropFirst(prefix.count)),
            ext: url.pathExtension,
            size: Int64(values.fileSize ?? 0),
            mtime: values.contentModificationDate?.timeIntervalSince1970 ?? 0)
        let dims = Dimensions.cached(for: stub) ?? Dimensions.fallback
        images.append(
            ImageFile(
                path: stub.path, rel: stub.rel, ext: stub.ext,
                size: stub.size, mtime: stub.mtime,
                rating: XMP.readRating(file: stub),
                exposure: XMP.readExposure(file: stub),
                width: dims.width, height: dims.height))
    }
    return images.sorted { $0.rel.localizedStandardCompare($1.rel) == .orderedAscending }
}
