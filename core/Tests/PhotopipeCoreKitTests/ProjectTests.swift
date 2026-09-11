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
        name: "riverside", day: "2026-08-10", dateInFolder: true,
        notes: "client wants 12 finals")
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
    #expect(file.day == "2026-08-10")

    // The empty project is immediately a shoot, with its notes surfaced.
    let shoot = service.listShoots().first { $0.name == created.shoot }
    #expect(shoot != nil)
    #expect(shoot?.imageCount == 0)
    #expect(shoot?.notes == "client wants 12 finals")
    #expect(shoot?.day == "2026-08-10")
    #expect(shoot?.project == "riverside")
}
@Test func theDayLivesInMetadataAndTheFolderNameIsOptional() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    let plain = try service.createProject(
        name: "tanzabend", day: "2026-09-05", dateInFolder: false, notes: "")
    #expect(plain.shoot == "tanzabend")
    let undated = try service.createProject(
        name: "loose", day: nil, dateInFolder: true, notes: "")
    #expect(undated.shoot == "loose")

    // Dated projects sort newest first, undated ones last, whatever the folder says.
    _ = try service.createProject(name: "old", day: "2020-01-01", dateInFolder: true, notes: "")
    #expect(service.listShoots().map(\.name) == ["tanzabend", "2020-01-01_old", "loose"])
    #expect(service.listShoots()[0].day == "2026-09-05")
    #expect(service.listShoots()[0].project == "tanzabend")
    #expect(service.listShoots()[2].day == nil)

    _ = try service.updateProject(shoot: "tanzabend", day: "2026-09-06")
    #expect(service.listShoots()[0].name == "tanzabend")
    #expect(service.listShoots()[0].day == "2026-09-06")
    _ = try service.updateProject(shoot: "tanzabend", day: .some(nil))
    #expect(service.listShoots().first { $0.name == "tanzabend" }?.day == nil)
    #expect(throws: LibraryService.ServiceError.self) {
        try service.updateProject(shoot: "tanzabend", day: "yesterday")
    }
}
@Test func theFolderDateWinsAndMetadataFillsIn() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    for (folder, json) in [
        ("2026-07-12_zell", #"{"notes":"","day":"2026-07-13"}"#),
        ("legacy", #"{"notes":"kept","created":"2026-01-01"}"#),
        ("broken", #"{"notes":"","day":"2026-9-5"}"#),
    ] {
        let shoot = dir.appendingPathComponent(folder)
        try FileManager.default.createDirectory(at: shoot, withIntermediateDirectories: true)
        try Data(json.utf8).write(to: ProjectFile.url(inShoot: shoot.path))
    }

    let shoots = try walkLibrary(root: dir.path).shoots
    #expect(shoots.map(\.name) == ["2026-07-12_zell", "legacy", "broken"])
    #expect(shoots[0].day == "2026-07-12")
    #expect(shoots[0].project == "zell")
    #expect(shoots[1].day == "2026-01-01")
    #expect(shoots[1].notes == "kept")
    #expect(shoots[2].day == nil)

    var file = ProjectFile.read(inShoot: dir.appendingPathComponent("legacy").path)
    file.notes = "edited"
    try file.write(inShoot: dir.appendingPathComponent("legacy").path)
    let rewritten = try String(
        contentsOf: ProjectFile.url(inShoot: dir.appendingPathComponent("legacy").path),
        encoding: .utf8)
    #expect(rewritten.contains(#""day" : "2026-01-01""#))
    #expect(!rewritten.contains("created"))
}
@Test func createProjectRefusesBadNamesAndDuplicates() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    _ = try service.createProject(name: "dup", day: "2026-08-10", dateInFolder: true, notes: "")
    for (name, day) in [
        ("dup", "2026-08-10"), ("   ", "2026-08-10"), ("a/b", "2026-08-10"),
        ("dup", "2026-8-10"), (".hidden", "2026-08-10"),
    ] {
        #expect(throws: LibraryService.ServiceError.self) {
            try service.createProject(name: name, day: day, dateInFolder: true, notes: "")
        }
    }
    // A hidden folder would vanish from the scan, so the name is refused
    // even without a date prefix to protect it.
    #expect(throws: LibraryService.ServiceError.self) {
        try service.createProject(name: ".hidden", day: nil, dateInFolder: false, notes: "")
    }
    #expect(try FileManager.default.contentsOfDirectory(atPath: dir.path) == ["2026-08-10_dup"])
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
    try ProjectFile(notes: "keep me", day: "2026-09-09").write(inShoot: shoot.path)

    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    let renamed = try service.updateProject(shoot: "2026-09-09_before", name: "after")
    #expect(renamed.shoot == "2026-09-09_after")

    let moved = dir.appendingPathComponent("2026-09-09_after")
    #expect(FileManager.default.fileExists(atPath: moved.path))
    #expect(!FileManager.default.fileExists(atPath: shoot.path))
    #expect(
        FileManager.default.fileExists(
            atPath: moved.appendingPathComponent("original/DSC00001.ARW").path))
    #expect(ProjectFile.read(inShoot: moved.path).notes == "keep me")
    #expect(service.listShoots().map(\.name) == ["2026-09-09_after"])

    #expect(
        try service.updateProject(shoot: "2026-09-09_after", dateInFolder: false).shoot == "after")
    #expect(service.listShoots()[0].day == "2026-09-09")
    #expect(try service.updateProject(shoot: "after", day: "2026-09-10").shoot == "after")
    #expect(
        try service.updateProject(shoot: "after", dateInFolder: true).shoot == "2026-09-10_after")
    #expect(try service.updateProject(shoot: "2026-09-10_after", day: .some(nil)).shoot == "after")
    #expect(service.listShoots()[0].day == nil)

    // Renaming onto an existing project is refused, not a silent merge.
    try FileManager.default.createDirectory(
        at: dir.appendingPathComponent("taken"), withIntermediateDirectories: true)
    try ProjectFile().write(inShoot: dir.appendingPathComponent("taken").path)
    service.rescanNow()
    #expect(throws: LibraryService.ServiceError.self) {
        try service.updateProject(shoot: "after", name: "taken")
    }
    #expect(throws: LibraryService.ServiceError.self) {
        try service.updateProject(shoot: "after", name: " ")
    }
}

@Test func aRefusedMoveLeavesTheMetadataAlone() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)
    _ = try service.createProject(name: "zell", day: "2026-07-12", dateInFolder: true, notes: "")
    _ = try service.createProject(name: "zell", day: "2026-07-13", dateInFolder: true, notes: "")

    #expect(throws: LibraryService.ServiceError.self) {
        try service.updateProject(shoot: "2026-07-12_zell", day: "2026-07-13", notes: "moved?")
    }
    let file = ProjectFile.read(inShoot: dir.appendingPathComponent("2026-07-12_zell").path)
    #expect(file.day == "2026-07-12")
    #expect(file.notes == "")
    #expect(service.listShoots().map(\.name) == ["2026-07-13_zell", "2026-07-12_zell"])
}
@Test func aHostileNameOrDayCannotEscapeTheLibrary() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let root = dir.appendingPathComponent("library")
    let outside = dir.appendingPathComponent("outside")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)

    let service = makeService(in: dir)
    _ = try service.setRoot(path: root.path, indexPath: nil)

    for hostile in ["../outside", "..", ".", "a/../../x", ""] {
        #expect(throws: LibraryService.ServiceError.self) {
            try service.createProject(name: hostile, day: nil, dateInFolder: false, notes: "")
        }
    }
    for hostile in ["../outside", "2026-09-09/..", "2026-09-09_a/../../x"] {
        #expect(throws: LibraryService.ServiceError.self) {
            try service.createProject(name: "escape", day: hostile, dateInFolder: true, notes: "")
        }
    }
    #expect(try FileManager.default.contentsOfDirectory(atPath: outside.path).isEmpty)
    #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)

    let created = try service.createProject(
        name: "keep", day: "2026-09-09", dateInFolder: true, notes: "")
    for hostile in ["../outside", "a/../../x"] {
        #expect(throws: LibraryService.ServiceError.self) {
            try service.updateProject(shoot: created.shoot, name: hostile)
        }
    }
    #expect(FileManager.default.fileExists(atPath: created.path), "the project stayed put")
    #expect(try FileManager.default.contentsOfDirectory(atPath: outside.path).isEmpty)
    #expect(service.listShoots().map(\.name) == ["2026-09-09_keep"])
}
@Test func projectFolderNamesAreCheckedInOnePlace() throws {
    #expect(
        try LibraryService.projectFolder(name: " zell ", day: "2026-09-09", dateInFolder: true)
            == "2026-09-09_zell")
    #expect(
        try LibraryService.projectFolder(name: "zell", day: "2026-09-09", dateInFolder: false)
            == "zell")
    #expect(try LibraryService.projectFolder(name: "zell", day: nil, dateInFolder: true) == "zell")
    for (name, day) in [
        ("zell", "2026-9-9"), ("a/b", "2026-09-09"), ("  ", "2026-09-09"),
        (".x", "2026-09-09"), ("n", "2026-09-09_a/../../x"),
    ] {
        #expect(throws: LibraryService.ServiceError.self) {
            try LibraryService.projectFolder(name: name, day: day, dateInFolder: true)
        }
    }
    // A malformed day is rejected even when it would not reach the folder name.
    #expect(throws: LibraryService.ServiceError.self) {
        try LibraryService.projectFolder(name: "n", day: "nope", dateInFolder: false)
    }
    // And the composed path must land directly inside the root.
    #expect(throws: LibraryService.ServiceError.self) {
        try LibraryService.projectURL(root: "/tmp/library", folder: "a/../../x")
    }
    #expect(
        try LibraryService.projectURL(root: "/tmp/library", folder: "2026-09-09_zell").path
            == "/tmp/library/2026-09-09_zell")
}
