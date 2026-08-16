import Foundation
import Testing

@testable import PhotopipeCoreKit

private func tempDir() throws -> URL {
    let dir = scratchDir("project")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

@Test func createProjectMakesFolderAndNotes() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let service = makeService(in: dir)
    let before = try service.setRoot(path: dir.path, indexPath: nil)

    let created = try service.createProject(
        day: "2026-08-10", name: "riverside", notes: "client wants 12 finals")
    #expect(created.shoot == "2026-08-10_riverside")
    #expect(created.generation > before.generation)

    let fm = FileManager.default
    var isDir: ObjCBool = false
    #expect(fm.fileExists(atPath: created.path, isDirectory: &isDir) && isDir.boolValue)
    // Just the folder and its metadata — no scaffolding the flat model
    // doesn't need.
    #expect(
        try fm.contentsOfDirectory(atPath: created.path) == [ProjectFile.fileName])
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
    let snapshot = try walkLibrary(root: dir.path)
    #expect(snapshot.shoots.isEmpty)
}

// MARK: - Cover and renaming

@Test func coverFallsBackToTheFirstImageAndSurvivesADeletedChoice() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let shoot = dir.appendingPathComponent("2026-09-09_cover")
    let selects = shoot.appendingPathComponent("selects")
    try FileManager.default.createDirectory(at: selects, withIntermediateDirectories: true)
    for stem in ["DSC00001", "DSC00002"] {
        try Data("x".utf8).write(to: selects.appendingPathComponent("\(stem).ARW"))
    }
    try ProjectFile(notes: "n").write(inShoot: shoot.path)

    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    // No choice yet: the first image is the project's face.
    #expect(service.listShoots()[0].coverPath?.hasSuffix("DSC00001.ARW") == true)

    _ = try service.updateProject(
        shoot: "2026-09-09_cover", notes: nil, cover: "selects/DSC00002.ARW")
    #expect(service.listShoots()[0].cover == "selects/DSC00002.ARW")
    #expect(service.listShoots()[0].coverPath?.hasSuffix("DSC00002.ARW") == true)

    // The chosen cover is deleted: fall back rather than show a blank card.
    _ = try service.trashImages(
        shoot: "2026-09-09_cover", paths: [selects.appendingPathComponent("DSC00002.ARW").path])
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

@Test func aHostileDayCannotEscapeTheLibrary() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let root = dir.appendingPathComponent("library")
    let outside = dir.appendingPathComponent("outside")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)

    let service = makeService(in: dir)
    _ = try service.setRoot(path: root.path, indexPath: nil)

    // `day` is interpolated into a path, so it gets the same scrutiny `name`
    // has always had. Creating must not reach outside the library...
    // The last shape is the subtle one: it satisfies the YYYY-MM-DD_… pattern
    // (parseShootName ends in `.+`, which matches slashes) yet still escapes.
    for hostile in [
        "../outside", "..", "2026-09-09/../..", "nope", "",
        "2026-09-09_a/../../x",
    ] {
        #expect(throws: LibraryService.ServiceError.self) {
            try service.createProject(day: hostile, name: "escape", notes: "")
        }
    }
    #expect(try FileManager.default.contentsOfDirectory(atPath: outside.path).isEmpty)
    #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)

    // ...and renaming must not move an existing project out of it.
    let created = try service.createProject(day: "2026-09-09", name: "keep", notes: "")
    for hostile in ["../outside", "2026-09-09_a/../../x"] {
        #expect(throws: LibraryService.ServiceError.self) {
            try service.renameProject(shoot: created.shoot, day: hostile, name: "gone")
        }
    }
    #expect(FileManager.default.fileExists(atPath: created.path), "the project stayed put")
    #expect(try FileManager.default.contentsOfDirectory(atPath: outside.path).isEmpty)
    #expect(service.listShoots().map(\.name) == ["2026-09-09_keep"])
}

@Test func projectFolderNamesAreCheckedInOnePlace() throws {
    #expect(try LibraryService.projectFolder(day: "2026-09-09", name: " zell ") == "2026-09-09_zell")
    #expect(throws: LibraryService.ServiceError.self) {
        try LibraryService.projectFolder(day: "2026-9-9", name: "zell")
    }
    #expect(throws: LibraryService.ServiceError.self) {
        try LibraryService.projectFolder(day: "2026-09-09", name: "a/b")
    }
    #expect(throws: LibraryService.ServiceError.self) {
        try LibraryService.projectFolder(day: "2026-09-09", name: "  ")
    }
    // Why the separator check exists: the date pattern alone accepts this,
    // because parseShootName ends in `.+` and `.` matches a slash. Deleting
    // the separator guard would reopen the escape.
    #expect(parseShootName("2026-09-09_a/../../x_n") != nil)
    // Matches the date pattern, but is not a single path component.
    #expect(throws: LibraryService.ServiceError.self) {
        try LibraryService.projectFolder(day: "2026-09-09_a/../../x", name: "n")
    }
    // And the composed path must land directly inside the root.
    #expect(throws: LibraryService.ServiceError.self) {
        try LibraryService.projectURL(
            root: "/tmp/library", day: "2026-09-09_a/../../x", name: "n")
    }
    #expect(
        try LibraryService.projectURL(root: "/tmp/library", day: "2026-09-09", name: "zell")
            .url.path == "/tmp/library/2026-09-09_zell")
}
