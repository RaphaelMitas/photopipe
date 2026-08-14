import Foundation
import Testing

@testable import PhotopipeCoreKit

private func makeService() -> LibraryService {
    let cacheDir = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("photopipe-thumbs-\(UUID().uuidString)")
    return LibraryService(thumbnailer: Thumbnailer(cacheDir: cacheDir))
}

private func tempIndexPath() -> String {
    URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("photopipe-index-\(UUID().uuidString).sqlite").path
}

@Test func setRootScansAndServesShootsAndImages() throws {
    let root = try makeTree([
        "2026-07-12_zell": ["DSC001.ARW", "DSC001.jpg", "selects/DSC002.ARW"],
        "2026-08-01_beach": ["IMG_1.ARW"],
    ])
    defer { try? FileManager.default.removeItem(at: root) }

    let service = makeService()
    let summary = try service.setRoot(path: root.path, indexPath: tempIndexPath())
    #expect(summary.shoots == 2)
    #expect(summary.files == 4)

    let shoots = service.listShoots()
    #expect(shoots.map(\.name) == ["2026-08-01_beach", "2026-07-12_zell"])
    let images = try service.listImages(shoot: "2026-07-12_zell")
    #expect(images.map(\.rel) == ["DSC001.ARW", "DSC001.jpg", "selects/DSC002.ARW"])
}

@Test func externalMutationBumpsGenerationOnRescan() throws {
    let root = try makeTree(["2026-07-12_zell": ["DSC001.ARW"]])
    defer { try? FileManager.default.removeItem(at: root) }

    let service = makeService()
    let summary = try service.setRoot(path: root.path, indexPath: tempIndexPath())

    // Nothing changed → rescan must NOT bump the generation.
    service.rescanNow()
    #expect(service.status().generation == summary.generation)

    // External tool drops in a new file (deterministic: call rescanNow directly).
    try Data("x".utf8).write(
        to: root.appendingPathComponent("2026-07-12_zell/DSC003.ARW"))
    service.rescanNow()
    #expect(service.status().generation == summary.generation + 1)
    #expect(try service.listImages(shoot: "2026-07-12_zell").count == 2)

    // External deletion is picked up too.
    try FileManager.default.removeItem(
        at: root.appendingPathComponent("2026-07-12_zell/DSC001.ARW"))
    service.rescanNow()
    #expect(try service.listImages(shoot: "2026-07-12_zell").map(\.rel) == ["DSC003.ARW"])
}

@Test func watcherPicksUpExternalChangesWithoutManualRescan() throws {
    let root = try makeTree(["2026-07-12_zell": ["DSC001.ARW"]])
    defer { try? FileManager.default.removeItem(at: root) }

    let service = makeService()
    let summary = try service.setRoot(path: root.path, indexPath: tempIndexPath())
    try Data("x".utf8).write(to: root.appendingPathComponent("2026-07-12_zell/DSC002.ARW"))

    // FSEvents latency + debounce: poll up to 5 s.
    let deadline = Date().addingTimeInterval(5)
    while Date() < deadline, service.status().generation == summary.generation {
        Thread.sleep(forTimeInterval: 0.1)
    }
    #expect(service.status().generation > summary.generation, "watcher never triggered a rescan")
}

@Test func deletingIndexLosesNothing() throws {
    let root = try makeTree(["2026-07-12_zell": ["DSC001.ARW", "DSC001.jpg"]])
    defer { try? FileManager.default.removeItem(at: root) }
    let indexPath = tempIndexPath()

    let service = makeService()
    _ = try service.setRoot(path: root.path, indexPath: indexPath)
    #expect(FileManager.default.fileExists(atPath: indexPath))

    // Nuke the index, start a fresh session: identical answers, index rebuilt.
    try FileManager.default.removeItem(atPath: indexPath)
    let fresh = makeService()
    _ = try fresh.setRoot(path: root.path, indexPath: indexPath)
    #expect(fresh.listShoots().map(\.name) == ["2026-07-12_zell"])
    #expect(try fresh.listImages(shoot: "2026-07-12_zell").count == 2)
    #expect(FileManager.default.fileExists(atPath: indexPath))
}

@Test func thumbnailRejectsPathsOutsideRoot() throws {
    let root = try makeTree(["2026-07-12_zell": ["DSC001.ARW"]])
    defer { try? FileManager.default.removeItem(at: root) }

    let service = makeService()
    _ = try service.setRoot(path: root.path, indexPath: tempIndexPath())
    #expect(throws: LibraryService.ServiceError.self) {
        try service.thumbnail(path: "/etc/hosts", maxPixel: 256)
    }
    #expect(throws: LibraryService.ServiceError.self) {
        try service.thumbnail(path: root.path + "/../escape.jpg", maxPixel: 256)
    }
}

@Test func scanOfThousandFilesMeetsPerfBudget() throws {
    var layout: [String: [String]] = [:]
    for shoot in 0..<10 {
        layout["2026-01-\(String(format: "%02d", shoot + 1))_perf\(shoot)"] =
            (0..<100).flatMap { ["DSC\($0).ARW"] }
    }
    let root = try makeTree(layout)
    defer { try? FileManager.default.removeItem(at: root) }

    let service = makeService()
    let start = Date()
    let summary = try service.setRoot(path: root.path, indexPath: tempIndexPath())
    let elapsed = Date().timeIntervalSince(start)
    #expect(summary.files == 1000)
    // Generous CI bound; locally this runs in well under a second.
    #expect(elapsed < 5.0, "1000-file scan+index took \(elapsed)s")
}

// MARK: - Dispatcher JSON layer

@Test func dispatcherServesLibraryMethodsOverProtocol() throws {
    let root = try makeTree(["2026-07-12_zell": ["DSC001.ARW", "DSC001.jpg"]])
    defer { try? FileManager.default.removeItem(at: root) }

    let dispatcher = Dispatcher(library: makeService())
    let escapedRoot = root.path.replacingOccurrences(of: "\"", with: "\\\"")

    let setRoot = dispatcher.dispatch(
        line:
            "{\"v\":1,\"id\":\"1\",\"method\":\"setRoot\",\"params\":{\"path\":\"\(escapedRoot)\",\"indexPath\":\"\(tempIndexPath())\"}}"
    ).response
    #expect(setRoot.ok)
    #expect(setRoot.result?["files"] == .number(2))

    let shoots = dispatcher.dispatch(
        line: "{\"v\":1,\"id\":\"2\",\"method\":\"listShoots\"}"
    ).response
    #expect(shoots.ok)
    guard case .array(let shootList)? = shoots.result?["shoots"] else {
        Issue.record("shoots missing")
        return
    }
    #expect(shootList.count == 1)
    #expect(shootList[0]["name"] == .string("2026-07-12_zell"))
    #expect(shootList[0]["imageCount"] == .number(2))

    let images = dispatcher.dispatch(
        line: "{\"v\":1,\"id\":\"3\",\"method\":\"listImages\",\"params\":{\"shoot\":\"2026-07-12_zell\"}}"
    ).response
    #expect(images.ok)
    guard case .array(let imageList)? = images.result?["images"] else {
        Issue.record("images missing")
        return
    }
    #expect(imageList.count == 2)
    #expect(imageList[0]["rel"] == .string("DSC001.ARW"))
    #expect(imageList[1]["rel"] == .string("DSC001.jpg"))

    let unknown = dispatcher.dispatch(
        line: "{\"v\":1,\"id\":\"4\",\"method\":\"listImages\",\"params\":{\"shoot\":\"nope\"}}"
    ).response
    #expect(unknown.error?.code == "unknown_shoot")
}

@Test func libraryMethodsWithoutRootFailCleanly() {
    let dispatcher = Dispatcher(library: makeService())
    let response = dispatcher.dispatch(
        line: "{\"v\":1,\"id\":\"1\",\"method\":\"listImages\",\"params\":{\"shoot\":\"x\"}}"
    ).response
    #expect(response.error?.code == "no_root")
}

@Test func setRootOnMissingDirectoryFailsCleanly() {
    let dispatcher = Dispatcher(library: makeService())
    let response = dispatcher.dispatch(
        line:
            "{\"v\":1,\"id\":\"1\",\"method\":\"setRoot\",\"params\":{\"path\":\"/nope/\(UUID().uuidString)\"}}"
    ).response
    #expect(response.error?.code == "root_not_found")
}
