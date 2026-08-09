import Foundation
import Testing

@testable import PhotopipeCoreKit

private func tempDir() throws -> URL {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("photopipe-project-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

private func makeService(in dir: URL) -> LibraryService {
    LibraryService(
        thumbnailer: Thumbnailer(cacheDir: dir.appendingPathComponent("thumbs")),
        renderer: Renderer(cacheDir: dir.appendingPathComponent("renders")))
}

@Test func createProjectMakesFolderRawAndNotes() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let service = makeService(in: dir)
    let before = try service.setRoot(path: dir.path, indexPath: nil)

    let created = try service.createProject(
        day: "2026-08-10", name: "riverside", notes: "client wants 12 finals")
    #expect(created.shoot == "2026-08-10_riverside")
    #expect(created.generation > before.generation)

    let fm = FileManager.default
    // Every stage folder exists from the start, so files can be pasted
    // straight into the right place from Finder.
    for stageFolder in ["original", "processed", "export"] {
        var isDir: ObjCBool = false
        #expect(
            fm.fileExists(atPath: created.path + "/" + stageFolder, isDirectory: &isDir)
                && isDir.boolValue,
            "\(stageFolder)/ should exist")
    }
    let file = ProjectFile.read(inShoot: created.path)
    #expect(file.notes == "client wants 12 finals")
    #expect(file.created == "2026-08-10")

    // The empty project is immediately a shoot, with its notes surfaced.
    let shoot = service.listShoots().first { $0.name == created.shoot }
    #expect(shoot != nil)
    #expect(shoot?.imageCount == 0)
    #expect(shoot?.notes == "client wants 12 finals")
    #expect(shoot?.day == "2026-08-10")
    #expect(shoot?.project == "riverside")
}

@Test func createProjectRefusesBadNamesAndDuplicates() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    _ = try service.createProject(day: "2026-08-10", name: "dup", notes: "")
    #expect(throws: LibraryService.ServiceError.self) {
        try service.createProject(day: "2026-08-10", name: "dup", notes: "")
    }
    #expect(throws: LibraryService.ServiceError.self) {
        try service.createProject(day: "2026-08-10", name: "   ", notes: "")
    }
    #expect(throws: LibraryService.ServiceError.self) {
        try service.createProject(day: "2026-08-10", name: "a/b", notes: "")
    }
}

@Test func projectFileToleratesGarbage() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    #expect(ProjectFile.read(inShoot: dir.path) == ProjectFile())
    try Data("{not json".utf8).write(to: ProjectFile.url(inShoot: dir.path))
    #expect(ProjectFile.read(inShoot: dir.path) == ProjectFile())
}

@Test func plainFoldersWithoutPhotosStayInvisible() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    // An empty folder without photopipe.json is not a project.
    try FileManager.default.createDirectory(
        at: dir.appendingPathComponent("2026-08-10_random"), withIntermediateDirectories: true)
    let snapshot = try scanLibrary(root: dir.path)
    #expect(snapshot.shoots.isEmpty)
}

// MARK: - Cover and renaming

@Test func coverFallsBackToTheFirstImageAndSurvivesADeletedChoice() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let shoot = dir.appendingPathComponent("2026-09-09_cover")
    let originals = shoot.appendingPathComponent("original")
    try FileManager.default.createDirectory(at: originals, withIntermediateDirectories: true)
    for stem in ["DSC00001", "DSC00002"] {
        try Data("x".utf8).write(to: originals.appendingPathComponent("\(stem).ARW"))
    }
    try ProjectFile(notes: "n").write(inShoot: shoot.path)

    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    // No choice yet: the first image is the project's face.
    #expect(service.listShoots()[0].coverPath?.hasSuffix("DSC00001.ARW") == true)

    _ = try service.updateProject(shoot: "2026-09-09_cover", notes: nil, cover: "DSC00002")
    #expect(service.listShoots()[0].cover == "DSC00002")
    #expect(service.listShoots()[0].coverPath?.hasSuffix("DSC00002.ARW") == true)

    // The chosen cover is deleted: fall back rather than show a blank card.
    _ = try service.trashImages(shoot: "2026-09-09_cover", stems: ["DSC00002"])
    #expect(service.listShoots()[0].coverPath?.hasSuffix("DSC00001.ARW") == true)

    // Clearing the choice explicitly is different from leaving it alone.
    _ = try service.updateProject(shoot: "2026-09-09_cover", notes: "kept", cover: .some(nil))
    #expect(service.listShoots()[0].cover == nil)
    #expect(service.listShoots()[0].notes == "kept")
}

@Test func renamingAProjectRenamesItsFolder() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let shoot = dir.appendingPathComponent("2026-09-09_before")
    let originals = shoot.appendingPathComponent("original")
    try FileManager.default.createDirectory(at: originals, withIntermediateDirectories: true)
    try Data("x".utf8).write(to: originals.appendingPathComponent("DSC00001.ARW"))
    try ProjectFile(notes: "keep me", created: "2026-09-09").write(inShoot: shoot.path)

    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    let renamed = try service.renameProject(
        shoot: "2026-09-09_before", day: "2026-10-10", name: "after")
    #expect(renamed.shoot == "2026-10-10_after")

    let moved = dir.appendingPathComponent("2026-10-10_after")
    #expect(FileManager.default.fileExists(atPath: moved.path))
    #expect(!FileManager.default.fileExists(atPath: shoot.path))
    // Photos and notes travel with the folder; the date stays in step.
    #expect(
        FileManager.default.fileExists(atPath: moved.appendingPathComponent("original/DSC00001.ARW").path))
    let file = ProjectFile.read(inShoot: moved.path)
    #expect(file.notes == "keep me")
    #expect(file.created == "2026-10-10")
    #expect(service.listShoots().map(\.name) == ["2026-10-10_after"])

    // Renaming onto an existing project is refused, not a silent merge.
    try FileManager.default.createDirectory(
        at: dir.appendingPathComponent("2026-01-01_taken"), withIntermediateDirectories: true)
    try ProjectFile().write(inShoot: dir.appendingPathComponent("2026-01-01_taken").path)
    service.rescanNow()
    #expect(throws: LibraryService.ServiceError.self) {
        try service.renameProject(shoot: "2026-10-10_after", day: "2026-01-01", name: "taken")
    }
    #expect(throws: LibraryService.ServiceError.self) {
        try service.renameProject(shoot: "2026-10-10_after", day: "2026-10-10", name: " ")
    }
}
