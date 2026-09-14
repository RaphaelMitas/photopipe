import CoreGraphics
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers

@testable import PhotopipeCoreKit

private func tempDir() throws -> URL {
    let dir = scratchDir("project")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

@discardableResult
private func makeProjectFolder(_ dir: URL, _ folder: String, json: String? = nil) throws -> URL {
    let shoot = dir.appendingPathComponent(folder)
    try FileManager.default.createDirectory(at: shoot, withIntermediateDirectories: true)
    if let json {
        try Data(json.utf8).write(to: ProjectFile.url(inShoot: shoot.path))
    }
    return shoot
}

private func writeJPEG(at url: URL, dateTimeOriginal: String?) {
    let ctx = CGContext(
        data: nil, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let image = ctx.makeImage()!
    let dest = CGImageDestinationCreateWithURL(
        url as CFURL, UTType.jpeg.identifier as CFString, 1, nil)!
    var props: [CFString: Any] = [:]
    if let dateTimeOriginal {
        props[kCGImagePropertyExifDictionary] = [
            kCGImagePropertyExifDateTimeOriginal: dateTimeOriginal
        ]
    }
    CGImageDestinationAddImage(dest, image, props as CFDictionary)
    CGImageDestinationFinalize(dest)
}

// MARK: - Creating

@Test func createProjectMakesFolderAndNotes() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let service = makeService(in: dir)
    let before = try service.setRoot(path: dir.path, indexPath: nil)

    let created = try service.createProject(name: "riverside", notes: "client wants 12 finals")
    #expect(created.shoot == "riverside")
    #expect(created.generation > before.generation)

    let fm = FileManager.default
    var isDir: ObjCBool = false
    #expect(fm.fileExists(atPath: created.path, isDirectory: &isDir) && isDir.boolValue)
    #expect(try fm.contentsOfDirectory(atPath: created.path) == [ProjectFile.fileName])
    let file = try #require(ProjectFile.read(inShoot: created.path))
    #expect(file.notes == "client wants 12 finals")
    #expect(file.day == nil)

    let shoot = service.listShoots().first { $0.name == created.shoot }
    #expect(shoot?.imageCount == 0)
    #expect(shoot?.notes == "client wants 12 finals")
    #expect(shoot?.day == nil)
}

@Test func createProjectRefusesBadNamesAndDuplicates() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    _ = try service.createProject(name: "dup", notes: "")
    // A date-looking name is now just a folder name and is allowed.
    _ = try service.createProject(name: "2026-01-01_gala", notes: "")
    for bad in ["dup", "   ", "a/b", "a:b", ".hidden", ".\u{301}hidden", "line\nbreak", ""] {
        #expect(throws: LibraryService.ServiceError.self) {
            try service.createProject(name: bad, notes: "")
        }
    }
    #expect(
        try Set(FileManager.default.contentsOfDirectory(atPath: dir.path))
            == ["dup", "2026-01-01_gala"])
}

// MARK: - The file is the only home for the date

@Test func theDateComesOnlyFromTheFile() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    // A folder whose name looks like the old convention is just a name; its
    // date is whatever the file says, and a broken file is left untouched.
    try makeProjectFolder(dir, "2026-07-12_zell", json: #"{"notes":"n","day":"2026-07-13"}"#)
    try makeProjectFolder(dir, "plain", json: #"{"notes":"kept","day":"2026-01-01"}"#)
    try makeProjectFolder(dir, "undated", json: #"{"notes":"","cover":"a.jpg"}"#)
    let corrupt = try makeProjectFolder(dir, "2026-06-06_corrupt", json: #"{"notes":"precious","c"#)

    let shoots = try walkLibrary(root: dir.path).shoots
    let byName = Dictionary(uniqueKeysWithValues: shoots.map { ($0.name, $0) })
    #expect(byName["2026-07-12_zell"]?.day == "2026-07-13")
    #expect(byName["plain"]?.day == "2026-01-01")
    #expect(byName["undated"]?.day == nil)
    // The prefix is never copied into the file, and a broken file is not rewritten.
    #expect(byName["2026-06-06_corrupt"]?.day == nil)
    #expect(
        try String(contentsOf: ProjectFile.url(inShoot: corrupt.path), encoding: .utf8)
            == #"{"notes":"precious","c"#)
}

@Test func projectFileReadDistinguishesMissingFromBroken() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    // Missing → defaults.
    #expect(ProjectFile.read(inShoot: dir.path) == ProjectFile())
    // Present but unreadable → nil, so a save refuses rather than clobbering it.
    try Data("{not json".utf8).write(to: ProjectFile.url(inShoot: dir.path))
    #expect(ProjectFile.read(inShoot: dir.path) == nil)
    // A missing or null notes key is not "broken"; the cover survives.
    try Data(#"{"cover":"a.jpg","notes":null}"#.utf8).write(to: ProjectFile.url(inShoot: dir.path))
    #expect(ProjectFile.read(inShoot: dir.path) == ProjectFile(cover: "a.jpg"))
}

// MARK: - Saving

@Test func updateWritesMetadataWithoutMovingTheFolder() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)
    _ = try service.createProject(name: "zell", notes: "")

    _ = try service.updateProject(
        shoot: "zell", name: "zell", day: "2026-09-06", notes: "noted", cover: nil)
    #expect(service.listShoots()[0].name == "zell")
    #expect(service.listShoots()[0].day == "2026-09-06")
    #expect(service.listShoots()[0].notes == "noted")

    _ = try service.updateProject(shoot: "zell", name: "zell", day: nil, notes: "noted", cover: nil)
    #expect(service.listShoots()[0].day == nil)

    #expect(throws: LibraryService.ServiceError.self) {
        try service.updateProject(
            shoot: "zell", name: "zell", day: "yesterday", notes: "", cover: nil)
    }
}

@Test func aNameChangeRenamesTheFolder() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let originals = try makeProjectFolder(dir, "before").appendingPathComponent("original")
    try FileManager.default.createDirectory(at: originals, withIntermediateDirectories: true)
    try Data("x".utf8).write(to: originals.appendingPathComponent("DSC00001.ARW"))
    try ProjectFile(notes: "keep me", day: "2026-09-09").write(
        inShoot: dir.appendingPathComponent("before").path)
    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    let renamed = try service.updateProject(
        shoot: "before", name: "after", day: "2026-09-09", notes: "keep me", cover: nil)
    #expect(renamed.shoot == "after")
    let moved = dir.appendingPathComponent("after")
    #expect(FileManager.default.fileExists(atPath: moved.path))
    #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent("before").path))
    #expect(
        FileManager.default.fileExists(
            atPath: moved.appendingPathComponent("original/DSC00001.ARW").path))
    #expect(ProjectFile.read(inShoot: moved.path)?.day == "2026-09-09")
    #expect(service.listShoots().map(\.name) == ["after"])

    // Renaming onto an existing project is refused, not a silent merge.
    try makeProjectFolder(dir, "taken", json: "{}")
    service.rescanNow()
    #expect(throws: LibraryService.ServiceError.self) {
        try service.updateProject(shoot: "after", name: "taken", day: nil, notes: "", cover: nil)
    }
    #expect(throws: LibraryService.ServiceError.self) {
        try service.updateProject(shoot: "after", name: " ", day: nil, notes: "", cover: nil)
    }
}

@Test func saveRefusesAnUnreadableFileAndRollsBackAFailedWrite() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    // A file that will not decode is refused, so a save cannot land defaults on it.
    try makeProjectFolder(dir, "broken", json: #"{"notes":"precious","c"#)
    try Data("x".utf8).write(
        to: dir.appendingPathComponent("broken").appendingPathComponent("DSC1.ARW"))
    service.rescanNow()
    #expect(throws: LibraryService.ServiceError.self) {
        try service.updateProject(shoot: "broken", name: "broken", day: nil, notes: "x", cover: nil)
    }
    #expect(
        try String(
            contentsOf: ProjectFile.url(inShoot: dir.appendingPathComponent("broken").path),
            encoding: .utf8) == #"{"notes":"precious","c"#)

    // A move that succeeds but a write that fails leaves the folder where it was.
    let locked = try makeProjectFolder(dir, "locked", json: "{}")
    try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: locked.path)
    defer {
        try? FileManager.default.setAttributes(
            [.posixPermissions: 0o755], ofItemAtPath: locked.path)
    }
    service.rescanNow()
    #expect(throws: (any Error).self) {
        try service.updateProject(shoot: "locked", name: "moved", day: nil, notes: "", cover: nil)
    }
    #expect(FileManager.default.fileExists(atPath: locked.path))
    #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent("moved").path))
}

@Test func aHostileNameCannotEscapeTheLibrary() throws {
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
            try service.createProject(name: hostile, notes: "")
        }
    }
    #expect(try FileManager.default.contentsOfDirectory(atPath: outside.path).isEmpty)

    let created = try service.createProject(name: "keep", notes: "")
    for hostile in ["../outside", "a/../../x"] {
        #expect(throws: LibraryService.ServiceError.self) {
            try service.updateProject(
                shoot: created.shoot, name: hostile, day: nil, notes: "", cover: nil)
        }
    }
    #expect(FileManager.default.fileExists(atPath: created.path))
    #expect(try FileManager.default.contentsOfDirectory(atPath: outside.path).isEmpty)
    #expect(service.listShoots().map(\.name) == ["keep"])
}

@Test func projectFolderChecksTheNameInOnePlace() throws {
    #expect(try LibraryService.projectFolder(name: " zell ") == "zell")
    for bad in ["", "  ", "a/b", "a:b", ".x", "x\u{7F}y"] {
        #expect(throws: LibraryService.ServiceError.self) {
            try LibraryService.projectFolder(name: bad)
        }
    }
    #expect(
        try LibraryService.freeProjectURL(root: "/tmp/library", folder: "zell").path
            == "/tmp/library/zell")
}

// MARK: - Suggesting the first photo's date

@Test func captureDayReadsExifThenFallsBackToTheFileDate() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let withExif = dir.appendingPathComponent("shot.jpg")
    writeJPEG(at: withExif, dateTimeOriginal: "2026:07:12 08:30:00")
    #expect(Dimensions.captureDay(at: withExif) == "2026-07-12")

    // No EXIF stamp: fall back to the file's modification day.
    let noExif = dir.appendingPathComponent("plain.txt")
    try Data("x".utf8).write(to: noExif)
    var comps = DateComponents()
    (comps.year, comps.month, comps.day, comps.hour) = (2025, 11, 8, 12)
    let modified = Calendar(identifier: .gregorian).date(from: comps)!
    try FileManager.default.setAttributes(
        [.modificationDate: modified], ofItemAtPath: noExif.path)
    #expect(Dimensions.captureDay(at: noExif) == "2025-11-08")
}

@Test func captureDateRefusesAPathOutsideTheRoot() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)
    #expect(throws: LibraryService.ServiceError.self) {
        _ = try service.captureDate(path: "/etc/hosts")
    }
}
