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
