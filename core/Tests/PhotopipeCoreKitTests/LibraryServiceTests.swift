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
    _ = try service.setRoot(path: root.path, indexPath: tempIndexPath())
    waitUntilIndexed(service)
    let settled = service.status().generation

    // Nothing changed → rescan must NOT bump the generation.
    service.rescanNow()
    #expect(service.status().generation == settled)

    // External tool drops in a new file (deterministic: call rescanNow directly).
    try Data("x".utf8).write(
        to: root.appendingPathComponent("2026-07-12_zell/DSC003.ARW"))
    service.rescanNow()
    #expect(service.status().generation == settled + 1)
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
    _ = try service.setRoot(path: root.path, indexPath: tempIndexPath())
    // Settle first, or background enrichment would bump the generation and the
    // test would pass without the watcher ever firing.
    waitUntilIndexed(service)
    let settled = service.status().generation
    try Data("x".utf8).write(to: root.appendingPathComponent("2026-07-12_zell/DSC002.ARW"))

    // FSEvents latency + debounce: poll up to 5 s.
    let deadline = Date().addingTimeInterval(5)
    while Date() < deadline, service.status().generation == settled {
        Thread.sleep(forTimeInterval: 0.1)
    }
    #expect(service.status().generation > settled, "watcher never triggered a rescan")
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

// MARK: - Progressive indexing

@Test func setRootServesTheLibraryBeforeMetadataIsRead() throws {
    let root = try makeTree([
        "2026-07-12_zell": (0..<40).map { "DSC\($0).ARW" },
        "2026-08-01_beach": ["IMG_1.ARW"],
    ])
    defer { try? FileManager.default.removeItem(at: root) }

    // The walk alone accounts for every file, and hands them over as
    // placeholders — no image is opened to get this far.
    let walked = try walkLibrary(root: root.path)
    #expect(walked.fileCount == 41)
    #expect(walked.shoots.allSatisfy { !$0.indexed })
    let placeholder = try #require(walked.imagesByShoot["2026-07-12_zell"]?.first)
    #expect(!placeholder.enriched)
    #expect(placeholder.width == Dimensions.fallback.width)

    let service = makeService()
    let summary = try service.setRoot(path: root.path, indexPath: tempIndexPath())
    #expect(summary.files == 41)
    #expect(service.status().filesFound == 41)

    waitUntilIndexed(service)
    let settled = service.status()
    #expect(!settled.scanning)
    #expect(settled.filesEnriched == 41)
    #expect(service.listShoots().allSatisfy { $0.indexed })
    let indexed = try service.listImages(shoot: "2026-07-12_zell")
    #expect(indexed.allSatisfy { $0.enriched })
}

@Test func aSecondSessionStartsFullyIndexedFromTheStoredIndex() throws {
    let root = try makeTree(["2026-07-12_zell": ["DSC001.ARW", "DSC002.ARW"]])
    defer { try? FileManager.default.removeItem(at: root) }
    let indexPath = tempIndexPath()

    let first = makeService()
    _ = try first.setRoot(path: root.path, indexPath: indexPath)
    waitUntilIndexed(first)

    // No second pass over the files: the index answers for all of them.
    let second = makeService()
    _ = try second.setRoot(path: root.path, indexPath: indexPath)
    #expect(!second.status().scanning)
    let images = try second.listImages(shoot: "2026-07-12_zell")
    #expect(images.allSatisfy { $0.enriched })
}

@Test func rescanOnlyIndexesWhatActuallyChanged() throws {
    let root = try makeTree(["2026-07-12_zell": ["DSC001.ARW", "DSC002.ARW"]])
    defer { try? FileManager.default.removeItem(at: root) }

    let service = makeService()
    _ = try service.setRoot(path: root.path, indexPath: tempIndexPath())
    waitUntilIndexed(service)

    // An import drops in one file; the other two keep what they already paid for.
    try Data("x".utf8).write(to: root.appendingPathComponent("2026-07-12_zell/DSC003.ARW"))
    service.rescanNow()
    let images = try service.listImages(shoot: "2026-07-12_zell")
    #expect(images.filter { $0.enriched }.count == 2)
    #expect(images.first { $0.rel == "DSC003.ARW" }?.enriched == false)
}

@Test func aRatingOnARawSurvivesARelaunchOffTheIndex() throws {
    let root = try makeTree(["2026-07-12_zell": ["DSC001.ARW"]])
    defer { try? FileManager.default.removeItem(at: root) }
    let indexPath = tempIndexPath()
    let target = root.appendingPathComponent("2026-07-12_zell/DSC001.ARW")

    let first = makeService()
    _ = try first.setRoot(path: root.path, indexPath: indexPath)
    waitUntilIndexed(first)
    _ = try first.setRating(shoot: "2026-07-12_zell", path: target.path, rating: 4)

    // A raw's own bytes never change when its rating does, so a cached record
    // keyed on the file alone would shadow the sidecar for good.
    let second = makeService()
    _ = try second.setRoot(path: root.path, indexPath: indexPath)
    waitUntilIndexed(second)
    #expect(try second.listImages(shoot: "2026-07-12_zell").first?.rating == 4)
}

@Test func aSidecarWrittenByAnotherToolIsPickedUpNextLaunch() throws {
    let root = try makeTree(["2026-07-12_zell": ["DSC001.ARW"]])
    defer { try? FileManager.default.removeItem(at: root) }
    let indexPath = tempIndexPath()
    let target = root.appendingPathComponent("2026-07-12_zell/DSC001.ARW")

    let first = makeService()
    _ = try first.setRoot(path: root.path, indexPath: indexPath)
    waitUntilIndexed(first)

    // Lightroom, exiftool, a synced folder: something else rates the photo
    // while Photopipe is not running.
    try XMP.writeRating(
        5,
        file: ImageFile(path: target.path, rel: "DSC001.ARW", ext: "ARW", size: 1, mtime: 1),
        tool: .shared)

    let second = makeService()
    _ = try second.setRoot(path: root.path, indexPath: indexPath)
    waitUntilIndexed(second)
    #expect(try second.listImages(shoot: "2026-07-12_zell").first?.rating == 5)
}

@Test func indexingFinishesEvenIfAPhotoIsRatedDuringTheFirstSave() throws {
    let root = try makeTree(["2026-07-12_zell": (0..<300).map { "DSC\($0).ARW" }])
    defer { try? FileManager.default.removeItem(at: root) }
    let target = root.appendingPathComponent("2026-07-12_zell/DSC0.ARW")

    let service = makeService()
    _ = try service.setRoot(path: root.path, indexPath: tempIndexPath())
    // Settling a file before the enricher was handed its queue used to leave
    // the counter one short of the total, so indexing never read as done.
    _ = try service.setRating(shoot: "2026-07-12_zell", path: target.path, rating: 3)

    waitUntilIndexed(service)
    let status = service.status()
    #expect(!status.scanning)
    #expect(status.filesEnriched == status.filesFound)
}

@Test func statusNamesOnlyTheShootsThatMovedOn() throws {
    let root = try makeTree([
        "2026-07-12_zell": ["DSC001.ARW"],
        "2026-08-01_beach": ["IMG_1.ARW"],
    ])
    defer { try? FileManager.default.removeItem(at: root) }

    let service = makeService()
    _ = try service.setRoot(path: root.path, indexPath: tempIndexPath())
    waitUntilIndexed(service)
    let settled = service.status().generation
    #expect(service.status(since: settled).changedShoots == [])

    _ = try service.setRating(
        shoot: "2026-07-12_zell",
        path:
            root
            .appendingPathComponent("2026-07-12_zell/DSC001.ARW").path, rating: 2)
    #expect(service.status(since: settled).changedShoots == ["2026-07-12_zell"])

    // Disappearing is a change too: a client that never hears about it keeps
    // serving photos from a folder that is gone.
    let rated = service.status().generation
    try FileManager.default.removeItem(at: root.appendingPathComponent("2026-08-01_beach"))
    service.rescanNow()
    #expect(service.status(since: rated).changedShoots?.contains("2026-08-01_beach") == true)
}

@Test func aRatingWrittenDuringIndexingIsNotOverwrittenByIt() throws {
    let root = try makeTree(["2026-07-12_zell": (0..<200).map { "DSC\($0).ARW" }])
    defer { try? FileManager.default.removeItem(at: root) }
    let target = root.appendingPathComponent("2026-07-12_zell/DSC199.ARW")
    let onDisk = ImageFile(
        path: target.path, rel: "DSC199.ARW", ext: "ARW", size: 1, mtime: 1)
    try XMP.writeRating(3, file: onDisk, tool: .shared)

    let service = makeService()
    _ = try service.setRoot(path: root.path, indexPath: tempIndexPath())
    // Rate it while enrichment is still working through the shoot: the batch
    // that reads this file may have been queued before the write landed.
    _ = try service.setRating(shoot: "2026-07-12_zell", path: target.path, rating: 5)
    waitUntilIndexed(service)

    let images = try service.listImages(shoot: "2026-07-12_zell")
    #expect(images.first { $0.path == target.path }?.rating == 5)
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
