import Foundation

/// A full scan snapshot: shoots (sorted newest day first) with their images.
public struct LibrarySnapshot: Equatable, Sendable {
    public let shoots: [Shoot]
    public let imagesByShoot: [String: [ImageGroup]]
    public let fileCount: Int

    public static let empty = LibrarySnapshot(shoots: [], imagesByShoot: [:], fileCount: 0)

    public init(shoots: [Shoot], imagesByShoot: [String: [ImageGroup]], fileCount: Int) {
        self.shoots = shoots
        self.imagesByShoot = imagesByShoot
        self.fileCount = fileCount
    }
}

public enum ScanError: Error {
    case rootNotFound(String)
}

/// Scan `<root>/<shoot>/**` for pipeline files. Disk is the source of truth;
/// this is a read-only pass and must tolerate anything it finds.
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
    var imagesByShoot: [String: [ImageGroup]] = [:]
    var fileCount = 0

    for dir in shootDirs {
        let files = scanShootDirectory(dir)
        // A project the wizard just created has no photos yet but is still a
        // real project — its photopipe.json says so.
        let isProject = fm.fileExists(atPath: ProjectFile.url(inShoot: dir.path).path)
        guard !files.isEmpty || isProject else { continue }
        fileCount += files.count
        let images = buildImageGroups(
            files: files, ratingFor: XMP.readRating, dimensionsFor: Dimensions.forGroup)
        let shoot = makeShoot(
            name: dir.lastPathComponent, path: dir.path, images: images,
            notes: isProject ? ProjectFile.read(inShoot: dir.path).notes : "")
        shoots.append(shoot)
        imagesByShoot[shoot.name] = images
    }

    // Newest day first, undated shoots last, ties by name.
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

/// Stage of a file. The containing folder wins — external tools rename
/// their output (`DSC00001-DxO.dng`), so location is the reliable signal;
/// the extension is only a fallback for files outside the known folders
/// (legacy shoots, loose files in the project root).
func stageFor(url: URL, shootDir: URL) -> Stage? {
    // Only pipeline formats are images at all, wherever they sit.
    guard Stage(fileExtension: url.pathExtension) != nil else { return nil }
    let prefix = shootDir.path + "/"
    guard url.path.hasPrefix(prefix) else { return Stage(fileExtension: url.pathExtension) }
    let components = url.path.dropFirst(prefix.count).split(separator: "/")
    let folder = components.count > 1 ? components.first?.lowercased() : nil
    switch folder {
    case "original", "media", "raw": return .raw
    case "processed", "denoised": return .denoised
    case "export", "exports": return .export
    default: return Stage(fileExtension: url.pathExtension)
    }
}

private func scanShootDirectory(_ dir: URL) -> [FileRecord] {
    let fm = FileManager.default
    guard
        let enumerator = fm.enumerator(
            at: dir,
            includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey],
            options: [.skipsHiddenFiles])
    else { return [] }

    var files: [FileRecord] = []
    for case let url as URL in enumerator {
        guard
            let values = try? url.resourceValues(forKeys: [
                .isRegularFileKey, .fileSizeKey, .contentModificationDateKey,
            ]),
            values.isRegularFile == true,
            let stage = stageFor(url: url, shootDir: dir)
        else { continue }
        files.append(
            FileRecord(
                path: url.path,
                ext: url.pathExtension,
                stage: stage,
                size: Int64(values.fileSize ?? 0),
                mtime: values.contentModificationDate?.timeIntervalSince1970 ?? 0))
    }
    return files
}
