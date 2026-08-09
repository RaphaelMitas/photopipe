import CoreImage
import Foundation
import Testing

@testable import PhotopipeCoreKit

private func tempDir() throws -> URL {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("photopipe-actions-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

private func makeService(in dir: URL) -> LibraryService {
    LibraryService(
        thumbnailer: Thumbnailer(cacheDir: dir.appendingPathComponent("thumbs")),
        renderer: Renderer(cacheDir: dir.appendingPathComponent("renders")))
}

/// A project with one image that exists as raw + DNG + JPG, plus a sidecar.
private func makeShoot(in root: URL, named name: String = "2026-06-06_actions") throws -> URL {
    let shoot = root.appendingPathComponent(name)
    try FileManager.default.createDirectory(at: shoot, withIntermediateDirectories: true)
    for (file, contents) in [
        ("DSC00001.ARW", "raw"), ("DSC00001.dng", "dng"), ("DSC00001.jpg", "jpg"),
        ("DSC00001.xmp", "<x:xmpmeta/>"), ("DSC00002.ARW", "raw2"),
    ] {
        try Data(contents.utf8).write(to: shoot.appendingPathComponent(file))
    }
    return shoot
}

@Test func trashRemovesTheWholeLineageIncludingSidecar() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let shoot = try makeShoot(in: dir)

    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    let result = try service.trashImages(shoot: shoot.lastPathComponent, stems: ["DSC00001"])
    // ARW + DNG + JPG + the XMP sidecar.
    #expect(result.files == 4)

    let fm = FileManager.default
    for gone in ["DSC00001.ARW", "DSC00001.dng", "DSC00001.jpg", "DSC00001.xmp"] {
        #expect(!fm.fileExists(atPath: shoot.appendingPathComponent(gone).path), "\(gone) trashed")
    }
    // The other image is untouched, and the library reflects the deletion.
    #expect(fm.fileExists(atPath: shoot.appendingPathComponent("DSC00002.ARW").path))
    #expect(try service.listImages(shoot: shoot.lastPathComponent).map(\.stem) == ["DSC00002"])

    #expect(throws: LibraryService.ServiceError.self) {
        try service.trashImages(shoot: shoot.lastPathComponent, stems: ["NOPE"])
    }
}

@Test func actionsRefusePathsOutsideTheLibrary() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    _ = try makeShoot(in: dir)

    let outsider = dir.appendingPathComponent("../escape.jpg").path
    let service = makeService(in: dir.appendingPathComponent("root"))
    let root = dir.appendingPathComponent("root")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    _ = try service.setRoot(path: root.path, indexPath: nil)

    // A malformed request must never reach a file outside the library.
    #expect(throws: LibraryService.ServiceError.self) {
        try service.reveal(paths: [outsider])
    }
    #expect(throws: LibraryService.ServiceError.self) {
        try service.openIn(paths: ["/etc/hosts"], app: "/System/Applications/Preview.app")
    }
    #expect(throws: LibraryService.ServiceError.self) {
        try service.exportFiles(
            paths: ["/etc/hosts"], destination: dir.appendingPathComponent("out").path, zip: false)
    }
}

@Test func exportCopiesToAFolderWithoutOverwriting() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let shoot = try makeShoot(in: dir)
    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    let out = dir.appendingPathComponent("delivery")
    let jpg = shoot.appendingPathComponent("DSC00001.jpg").path
    #expect(try service.exportFiles(paths: [jpg], destination: out.path, zip: false) == 1)
    // Exporting the same file twice keeps both rather than clobbering.
    #expect(try service.exportFiles(paths: [jpg], destination: out.path, zip: false) == 1)

    let delivered = try FileManager.default.contentsOfDirectory(atPath: out.path).sorted()
    #expect(delivered == ["DSC00001-1.jpg", "DSC00001.jpg"])
}

@Test func exportZipsFlat() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let shoot = try makeShoot(in: dir)
    // Put the export in a subfolder so flattening is observable.
    let nested = shoot.appendingPathComponent("exports")
    try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)
    let deep = nested.appendingPathComponent("DSC00003.jpg")
    try Data("deep".utf8).write(to: deep)

    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    let zipPath = dir.appendingPathComponent("delivery.zip").path
    #expect(try service.exportFiles(paths: [deep.path], destination: zipPath, zip: true) == 1)

    let listing = try FileActions.list(zip: zipPath)
    #expect(listing == ["DSC00003.jpg"], "the client gets files, not our folder structure")
}

@Test func emptySelectionsAreRefusedRatherThanSilentlyDoingNothing() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    #expect(throws: FileActions.ActionError.noFiles) { try FileActions.reveal(paths: []) }
    #expect(throws: FileActions.ActionError.noFiles) {
        try FileActions.zip(paths: [], to: dir.appendingPathComponent("x.zip").path)
    }
    #expect(throws: FileActions.ActionError.noApp) {
        try FileActions.open(paths: ["/tmp/x"], inApp: "")
    }
}
