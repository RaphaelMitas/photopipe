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

    public var unenriched: [String: [ImageFile]] {
        imagesByShoot.compactMapValues { images in
            let pending = images.filter { !$0.enriched }
            return pending.isEmpty ? nil : pending
        }
    }
}

public enum ScanError: Error {
    case rootNotFound(String)
}

/// Finds every shoot and file by stat alone. Nothing here opens an image, so
/// the cost is one directory enumeration — this is what the library can be
/// drawn from while `enrich` catches up in the background.
public func walkLibrary(root: String) throws -> LibrarySnapshot {
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
        let images = walkShootDirectory(dir)
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

/// Reads the metadata the walk skipped: dimensions, rating and edit. Each call
/// opens the file, twice for a raw with a sidecar, which is why this runs off
/// the request path.
public func enrich(_ file: ImageFile) -> ImageFile {
    file.with(
        rating: XMP.readRating(file: file),
        edit: XMP.readEdit(file: file),
        dimensions: Dimensions.cached(for: file) ?? Dimensions.fallback,
        enriched: true)
}

/// Rebuilds a walked snapshot on top of metadata that was already paid for,
/// keyed by path. A cached record only counts while the file it describes is
/// byte-for-byte the one on disk.
public func carryEnrichment(
    into walked: LibrarySnapshot, from cache: [String: ImageFile]
) -> LibrarySnapshot {
    var imagesByShoot: [String: [ImageFile]] = [:]
    for (shoot, images) in walked.imagesByShoot {
        imagesByShoot[shoot] = images.map { image in
            guard let known = cache[image.path], known.enriched,
                known.mtime == image.mtime, known.size == image.size
            else { return image }
            return image.with(
                rating: known.rating, edit: known.edit,
                dimensions: (known.width, known.height), enriched: true)
        }
    }
    let shoots = walked.shoots.map { shoot in
        makeShoot(
            name: shoot.name, path: shoot.path, images: imagesByShoot[shoot.name] ?? [],
            notes: shoot.notes, cover: shoot.cover)
    }
    return LibrarySnapshot(
        shoots: shoots, imagesByShoot: imagesByShoot, fileCount: walked.fileCount)
}

private func walkShootDirectory(_ dir: URL) -> [ImageFile] {
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
        images.append(
            ImageFile(
                path: path,
                rel: String(path.dropFirst(prefix.count)),
                ext: url.pathExtension,
                size: Int64(values.fileSize ?? 0),
                mtime: values.contentModificationDate?.timeIntervalSince1970 ?? 0))
    }
    return images.sorted { $0.rel.localizedStandardCompare($1.rel) == .orderedAscending }
}
