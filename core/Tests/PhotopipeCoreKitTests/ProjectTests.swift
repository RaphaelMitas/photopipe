import Foundation
import Testing

@testable import PhotopipeCoreKit

private func tempDir() throws -> URL {
    let dir = scratchDir("project")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

private func makeProjectFolder(_ dir: URL, _ folder: String, json: String? = nil) throws -> URL {
    let shoot = dir.appendingPathComponent(folder)
    try FileManager.default.createDirectory(at: shoot, withIntermediateDirectories: true)
    if let json {
        try Data(json.utf8).write(to: ProjectFile.url(inShoot: shoot.path))
    }
    return shoot
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

    _ = try service.updateProject(
        shoot: "tanzabend", name: "tanzabend", day: "2026-09-06", dateInFolder: false, notes: "",
        cover: nil)
    #expect(service.listShoots()[0].name == "tanzabend")
    #expect(service.listShoots()[0].day == "2026-09-06")
    _ = try service.updateProject(
        shoot: "tanzabend", name: "tanzabend", day: nil, dateInFolder: false, notes: "",
        cover: nil)
    #expect(service.listShoots().first { $0.name == "tanzabend" }?.day == nil)
    #expect(throws: LibraryService.ServiceError.self) {
        try service.updateProject(
            shoot: "tanzabend", name: "tanzabend", day: "yesterday", dateInFolder: false,
            notes: "", cover: nil)
    }
}

@Test func theFolderDateWinsAndMetadataFillsIn() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    _ = try makeProjectFolder(dir, "2026-07-12_zell", json: #"{"notes":"","created":"2026-07-13"}"#)
    _ = try makeProjectFolder(dir, "legacy", json: #"{"notes":"kept","created":"2026-01-01"}"#)
    _ = try makeProjectFolder(dir, "broken", json: #"{"notes":"","created":"2026-9-5"}"#)

    let shoots = try walkLibrary(root: dir.path).shoots
    #expect(shoots.map(\.name) == ["2026-07-12_zell", "legacy", "broken"])
    #expect(shoots[0].day == "2026-07-12")
    #expect(shoots[0].project == "zell")
    #expect(shoots[1].day == "2026-01-01")
    #expect(shoots[1].notes == "kept")
    #expect(shoots[2].day == nil)
}

@Test func theDayIsStoredUnderTheKeyOlderBuildsKnow() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    try ProjectFile(notes: "n", day: "2026-01-01").write(inShoot: dir.path)
    let json = try String(contentsOf: ProjectFile.url(inShoot: dir.path), encoding: .utf8)
    #expect(json.contains(#""created" : "2026-01-01""#))
    #expect(!json.contains("day"))
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
    // The scan skips dot folders, so a leading dot is refused even undated.
    for hidden in [".hidden", ".\u{301}hidden"] {
        #expect(throws: LibraryService.ServiceError.self) {
            try service.createProject(name: hidden, day: nil, dateInFolder: false, notes: "")
        }
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
    _ = try makeProjectFolder(dir, "2026-08-10_random")
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
    let save = { (notes: String, cover: String?) in
        try service.updateProject(
            shoot: "2026-09-09_cover", name: "cover", day: "2026-09-09", dateInFolder: true,
            notes: notes, cover: cover)
    }

    // No choice yet: the first image is the project's face.
    #expect(service.listShoots()[0].coverPath?.hasSuffix("DSC00001.ARW") == true)

    _ = try save("n", "selects/DSC00002.ARW")
    #expect(service.listShoots()[0].cover == "selects/DSC00002.ARW")
    #expect(service.listShoots()[0].coverPath?.hasSuffix("DSC00002.ARW") == true)

    // The chosen cover is deleted: fall back rather than show a blank card.
    _ = try service.trashImages(
        shoot: "2026-09-09_cover", paths: [selects.appendingPathComponent("DSC00002.ARW").path])
    #expect(service.listShoots()[0].coverPath?.hasSuffix("DSC00001.ARW") == true)

    _ = try save("kept", nil)
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
    let save = { (shoot: String, name: String, day: String?, dateInFolder: Bool) in
        try service.updateProject(
            shoot: shoot, name: name, day: day, dateInFolder: dateInFolder, notes: "keep me",
            cover: nil
        ).shoot
    }

    #expect(try save("2026-09-09_before", "after", "2026-09-09", true) == "2026-09-09_after")
    let moved = dir.appendingPathComponent("2026-09-09_after")
    #expect(FileManager.default.fileExists(atPath: moved.path))
    #expect(!FileManager.default.fileExists(atPath: shoot.path))
    #expect(
        FileManager.default.fileExists(
            atPath: moved.appendingPathComponent("original/DSC00001.ARW").path))
    #expect(ProjectFile.read(inShoot: moved.path).notes == "keep me")
    #expect(service.listShoots().map(\.name) == ["2026-09-09_after"])

    #expect(try save("2026-09-09_after", "after", "2026-09-09", false) == "after")
    #expect(service.listShoots()[0].day == "2026-09-09")
    #expect(try save("after", "after", "2026-09-10", false) == "after")
    #expect(try save("after", "after", "2026-09-10", true) == "2026-09-10_after")
    #expect(try save("2026-09-10_after", "after", nil, true) == "after")
    #expect(service.listShoots()[0].day == nil)

    // Renaming onto an existing project is refused, not a silent merge.
    _ = try makeProjectFolder(dir, "taken", json: "{}")
    service.rescanNow()
    #expect(throws: LibraryService.ServiceError.self) {
        try save("after", "taken", nil, true)
    }
    #expect(throws: LibraryService.ServiceError.self) {
        try save("after", " ", nil, true)
    }
}

@Test func foldersNamedInFinderAreLeftAloneUntilTheirNameWouldChange() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    // "a:b" is how a folder called "a/b" in Finder sits on disk.
    _ = try makeProjectFolder(dir, "a:b", json: "{}")
    _ = try makeProjectFolder(dir, " spaced", json: "{}")
    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)
    let save = { (folder: String, day: String?, dateInFolder: Bool) in
        try service.updateProject(
            shoot: folder, name: folder, day: day, dateInFolder: dateInFolder, notes: "noted",
            cover: nil
        ).shoot
    }

    for folder in ["a:b", " spaced"] {
        #expect(try save(folder, nil, true) == folder)
        #expect(try save(folder, "2026-09-09", false) == folder)
    }
    #expect(service.listShoots().map(\.notes) == ["noted", "noted"])
    #expect(service.listShoots().map(\.day) == ["2026-09-09", "2026-09-09"])

    // Putting the date into the name is a rename, and the rules apply again.
    #expect(try save(" spaced", "2026-09-09", true) == "2026-09-09_spaced")
    #expect(throws: LibraryService.ServiceError.self) {
        try save("a:b", "2026-09-09", true)
    }
    #expect(throws: LibraryService.ServiceError.self) {
        try save("a:b", "garbage", false)
    }
}

@Test func aRefusedMoveOrFailedWriteLeavesTheProjectAsItWas() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)
    _ = try service.createProject(name: "zell", day: "2026-07-12", dateInFolder: true, notes: "")
    _ = try service.createProject(name: "zell", day: "2026-07-13", dateInFolder: true, notes: "")

    #expect(throws: LibraryService.ServiceError.self) {
        try service.updateProject(
            shoot: "2026-07-12_zell", name: "zell", day: "2026-07-13", dateInFolder: true,
            notes: "moved?", cover: nil)
    }
    let file = ProjectFile.read(inShoot: dir.appendingPathComponent("2026-07-12_zell").path)
    #expect(file.day == "2026-07-12")
    #expect(file.notes == "")
    #expect(service.listShoots().map(\.name) == ["2026-07-13_zell", "2026-07-12_zell"])

    let readOnly = try makeProjectFolder(dir, "2026-07-14_locked", json: "{}")
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o555], ofItemAtPath: readOnly.path)
    defer {
        try? FileManager.default.setAttributes(
            [.posixPermissions: 0o755], ofItemAtPath: readOnly.path)
    }
    service.rescanNow()
    #expect(throws: (any Error).self) {
        try service.updateProject(
            shoot: "2026-07-14_locked", name: "locked", day: "2026-07-14", dateInFolder: false,
            notes: "", cover: nil)
    }
    #expect(FileManager.default.fileExists(atPath: readOnly.path))
    #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent("locked").path))
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
            try service.updateProject(
                shoot: created.shoot, name: hostile, day: "2026-09-09", dateInFolder: true,
                notes: "", cover: nil)
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
        ("zell", "2026-9-9"), ("zell", "٢٠٢٦-٠٩-٠٩"), ("a/b", "2026-09-09"),
        ("  ", "2026-09-09"), (".x", "2026-09-09"), ("n", "2026-09-09_a/../../x"),
    ] {
        #expect(throws: LibraryService.ServiceError.self) {
            try LibraryService.projectFolder(name: name, day: day, dateInFolder: true)
        }
    }
    // The day is written to photopipe.json, so it is checked even when it stays out of the name.
    #expect(throws: LibraryService.ServiceError.self) {
        try LibraryService.projectFolder(name: "n", day: "nope", dateInFolder: false)
    }
    #expect(throws: LibraryService.ServiceError.self) {
        try LibraryService.freeProjectURL(root: "/tmp/library", folder: "a/../../x")
    }
    #expect(
        try LibraryService.freeProjectURL(root: "/tmp/library", folder: "2026-09-09_zell").path
            == "/tmp/library/2026-09-09_zell")
}
