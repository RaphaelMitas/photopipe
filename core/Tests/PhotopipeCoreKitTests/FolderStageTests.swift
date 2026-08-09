import Foundation
import Testing

@testable import PhotopipeCoreKit

private func tempDir() throws -> URL {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("photopipe-folders-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

private func write(_ path: String, in shoot: URL) throws {
    let url = shoot.appendingPathComponent(path)
    try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data("fake".utf8).write(to: url)
}

// MARK: - Folder decides the stage

@Test func folderBeatsExtension() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let shoot = dir.appendingPathComponent("2026-08-10_folders")

    // A JPEG-first shoot: JPGs in original/ are originals, not exports.
    try write("original/IMG_0001.JPG", in: shoot)
    // A renamed DNG in processed/ is processed wherever the name drifted.
    try write("processed/IMG_0001-DxO.dng", in: shoot)
    // Exports live in export/.
    try write("export/IMG_0001.jpg", in: shoot)

    let snapshot = try scanLibrary(root: dir.path)
    let images = snapshot.imagesByShoot["2026-08-10_folders"] ?? []
    #expect(images.count == 1, "all three files are one logical image")
    let stages = images[0].files.map(\.stage)
    #expect(stages == [.raw, .denoised, .export])
    #expect(images[0].stage == .export)
}

@Test func legacyFoldersAndLooseFilesFallBackToExtension() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let shoot = dir.appendingPathComponent("2026-07-12_legacy")

    try write("raw/DSC00001.ARW", in: shoot)  // legacy name for original/
    try write("selects/DSC00002.ARW", in: shoot)  // unknown folder → extension
    try write("DSC00003.dng", in: shoot)  // loose in the root → extension

    let snapshot = try scanLibrary(root: dir.path)
    let images = snapshot.imagesByShoot["2026-07-12_legacy"] ?? []
    let byStem = Dictionary(uniqueKeysWithValues: images.map { ($0.stem, $0) })
    #expect(byStem["DSC00001"]?.stage == .raw)
    #expect(byStem["DSC00002"]?.stage == .raw, "an ARW in selects/ is still a raw")
    #expect(byStem["DSC00003"]?.stage == .denoised)
}

// MARK: - Importing into a stage folder

@Test func importCopiesIntoTheStageFolderAndSkipsNonImages() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let shoot = dir.appendingPathComponent("2026-08-11_import")
    try FileManager.default.createDirectory(at: shoot, withIntermediateDirectories: true)
    try ProjectFile().write(inShoot: shoot.path)

    let source = try tempDir()
    defer { try? FileManager.default.removeItem(at: source) }
    try Data("photo".utf8).write(to: source.appendingPathComponent("DSC00050.ARW"))
    try Data("dng".utf8).write(to: source.appendingPathComponent("DSC00050-DxO.dng"))
    try Data("junk".utf8).write(to: source.appendingPathComponent("notes.txt"))

    let service = LibraryService(
        thumbnailer: Thumbnailer(cacheDir: dir.appendingPathComponent("thumbs")),
        renderer: Renderer(cacheDir: dir.appendingPathComponent("renders")))
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    // Originals land in original/, and the text file is skipped, not copied.
    let originals = try service.importFiles(
        shoot: "2026-08-11_import", stage: .raw,
        paths: [
            source.appendingPathComponent("DSC00050.ARW").path,
            source.appendingPathComponent("notes.txt").path,
        ])
    #expect(originals.imported == 1)
    #expect(originals.skipped == 1)
    #expect(
        FileManager.default.fileExists(
            atPath: shoot.appendingPathComponent("original/DSC00050.ARW").path))

    // A processed file imports into processed/ and joins its original's
    // group despite the renamed stem.
    _ = try service.importFiles(
        shoot: "2026-08-11_import", stage: .denoised,
        paths: [source.appendingPathComponent("DSC00050-DxO.dng").path])
    let images = try service.listImages(shoot: "2026-08-11_import")
    #expect(images.count == 1)
    #expect(images[0].stage == .denoised)

    // The source was only read.
    #expect(try FileManager.default.contentsOfDirectory(atPath: source.path).count == 3)

    #expect(throws: LibraryService.ServiceError.self) {
        try service.importFiles(shoot: "NOPE", stage: .raw, paths: ["/tmp/x.arw"])
    }
}

// MARK: - Rename-tolerant grouping

private func record(_ stem: String, ext: String, stage: Stage) -> FileRecord {
    FileRecord(path: "/p/\(stem).\(ext)", ext: ext, stage: stage, size: 1, mtime: 1)
}

@Test func renamedDerivedFilesJoinTheirOriginal() throws {
    let groups = buildImageGroups(files: [
        record("DSC00001", ext: "ARW", stage: .raw),
        record("DSC00001-DxO", ext: "dng", stage: .denoised),
        record("DSC00001-DxO_edit", ext: "jpg", stage: .export),
    ])
    #expect(groups.count == 1)
    #expect(groups[0].stem == "DSC00001")
    #expect(groups[0].stage == .export)
}

@Test func prefixNeedsASeparatorBoundary() throws {
    // DSC0001's stem is a prefix of DSC00010, but the boundary is a digit —
    // these are different photos and must never merge.
    let groups = buildImageGroups(files: [
        record("DSC0001", ext: "ARW", stage: .raw),
        record("DSC00010", ext: "ARW", stage: .raw),
        record("DSC00010-DxO", ext: "dng", stage: .denoised),
    ])
    #expect(groups.count == 2)
    let ten = groups.first { $0.stem == "DSC00010" }
    #expect(ten?.files.count == 2, "the renamed DNG joins the longest matching anchor")
    #expect(groups.first { $0.stem == "DSC0001" }?.files.count == 1)
}

@Test func orphanDerivedFilesStandAlone() throws {
    let groups = buildImageGroups(files: [
        record("DSC00001", ext: "ARW", stage: .raw),
        record("SOMETHINGELSE", ext: "dng", stage: .denoised),
    ])
    #expect(groups.count == 2, "a derived file matching no original is its own image")
}
