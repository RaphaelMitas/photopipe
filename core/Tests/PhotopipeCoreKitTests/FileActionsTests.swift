import CoreImage
import Foundation
import Testing

@testable import PhotopipeCoreKit

private func tempDir() throws -> URL {
    let dir = scratchDir("actions")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

/// A project with a raw + sidecar + JPEG at the root and the same basename
/// sorted into two subfolders — the flatten-collision shape.
private func makeShoot(in root: URL, named name: String = "2026-06-06_actions") throws -> URL {
    let shoot = root.appendingPathComponent(name)
    for (file, contents) in [
        ("DSC00001.ARW", "raw"), ("DSC00001.xmp", "<x:xmpmeta/>"), ("DSC00001.jpg", "jpg"),
        ("Tag1/DSC00002.jpg", "tag1"), ("Tag2/DSC00002.jpg", "tag2"),
    ] {
        let url = shoot.appendingPathComponent(file)
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(contents.utf8).write(to: url)
    }
    return shoot
}

private func settled(_ service: LibraryService, _ job: Exporter.Progress) throws
    -> Exporter.Progress
{
    var job = job
    let deadline = Date().addingTimeInterval(60)
    while job.running && Date() < deadline {
        Thread.sleep(forTimeInterval: 0.01)
        job = try service.exportStatus(id: job.id)
    }
    return job
}

@discardableResult
private func exportNow(
    _ service: LibraryService, shoot: String, paths: [String], destination: String,
    zip: Bool = false, flatten: Bool = true, format: LibraryService.ExportFormat = .original,
    quality: Int = 90
) throws -> Exporter.Progress {
    try settled(
        service,
        try service.startExport(
            shoot: shoot, paths: paths, destination: destination,
            zip: zip, flatten: flatten, format: format, quality: quality))
}

@Test func trashRemovesTheFileAndItsSidecar() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let shoot = try makeShoot(in: dir)

    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    let result = try service.trashImages(
        shoot: shoot.lastPathComponent, paths: [shoot.appendingPathComponent("DSC00001.ARW").path])
    // The ARW plus its XMP sidecar — and nothing else.
    #expect(result.files == 2)

    let fm = FileManager.default
    #expect(!fm.fileExists(atPath: shoot.appendingPathComponent("DSC00001.ARW").path))
    #expect(!fm.fileExists(atPath: shoot.appendingPathComponent("DSC00001.xmp").path))
    // The JPEG shares the stem but is its own photo, so it stays.
    #expect(fm.fileExists(atPath: shoot.appendingPathComponent("DSC00001.jpg").path))
    #expect(
        try service.listImages(shoot: shoot.lastPathComponent).map(\.rel) == [
            "DSC00001.jpg", "Tag1/DSC00002.jpg", "Tag2/DSC00002.jpg",
        ])

    #expect(throws: LibraryService.ServiceError.self) {
        try service.trashImages(
            shoot: shoot.lastPathComponent,
            paths: [shoot.appendingPathComponent("NOPE.ARW").path])
    }
}

@Test func actionsRefusePathsOutsideTheLibrary() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let root = dir.appendingPathComponent("root")
    let shoot = try makeShoot(in: root)

    let service = makeService(in: dir)
    _ = try service.setRoot(path: root.path, indexPath: nil)

    // A malformed request must never reach a file outside the library.
    // (Reveal is the exception: it shows export destinations the user chose
    // outside the root, and touches nothing.)
    #expect(throws: LibraryService.ServiceError.self) {
        try service.startExport(
            shoot: shoot.lastPathComponent, paths: ["/etc/hosts"],
            destination: dir.appendingPathComponent("out").path,
            zip: false, flatten: true, format: .original, quality: 90)
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
    let export = {
        try exportNow(
            service, shoot: shoot.lastPathComponent, paths: [jpg], destination: out.path)
    }
    #expect(try export().done == 1)
    // Exporting the same file twice keeps both rather than clobbering.
    #expect(try export().done == 1)

    let delivered = try FileManager.default.contentsOfDirectory(atPath: out.path).sorted()
    #expect(delivered == ["DSC00001-1.jpg", "DSC00001.jpg"])
}

@Test func flattenedExportSuffixesBasenameCollisions() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let shoot = try makeShoot(in: dir)
    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    let out = dir.appendingPathComponent("flat")
    let job = try exportNow(
        service, shoot: shoot.lastPathComponent,
        paths: [
            shoot.appendingPathComponent("Tag1/DSC00002.jpg").path,
            shoot.appendingPathComponent("Tag2/DSC00002.jpg").path,
        ],
        destination: out.path)
    #expect(job.done == 2)

    // Same basename in two subfolders: different photos, both must arrive.
    let delivered = try FileManager.default.contentsOfDirectory(atPath: out.path).sorted()
    #expect(delivered == ["DSC00002-1.jpg", "DSC00002.jpg"])
    #expect(
        try String(contentsOf: out.appendingPathComponent("DSC00002.jpg"), encoding: .utf8)
            == "tag1")
    #expect(
        try String(contentsOf: out.appendingPathComponent("DSC00002-1.jpg"), encoding: .utf8)
            == "tag2")
}

@Test func unflattenedExportMirrorsTheSubfolderTree() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let shoot = try makeShoot(in: dir)
    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    let out = dir.appendingPathComponent("mirrored")
    let job = try exportNow(
        service, shoot: shoot.lastPathComponent,
        paths: [
            shoot.appendingPathComponent("Tag1/DSC00002.jpg").path,
            shoot.appendingPathComponent("Tag2/DSC00002.jpg").path,
        ],
        destination: out.path, flatten: false)
    #expect(job.done == 2)

    let fm = FileManager.default
    #expect(fm.fileExists(atPath: out.appendingPathComponent("Tag1/DSC00002.jpg").path))
    #expect(fm.fileExists(atPath: out.appendingPathComponent("Tag2/DSC00002.jpg").path))
}

@Test func zipLayoutsFlatAndMirrored() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let shoot = try makeShoot(in: dir)
    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    let paths = [
        shoot.appendingPathComponent("Tag1/DSC00002.jpg").path,
        shoot.appendingPathComponent("Tag2/DSC00002.jpg").path,
    ]

    let flatZip = dir.appendingPathComponent("flat.zip").path
    #expect(
        try exportNow(
            service, shoot: shoot.lastPathComponent, paths: paths, destination: flatZip,
            zip: true
        ).done == 2)
    let flatEntries = try FileActions.list(zip: flatZip).filter { !$0.hasSuffix("/") }
    #expect(
        flatEntries.sorted() == ["DSC00002-1.jpg", "DSC00002.jpg"],
        "the client gets files, not our folder structure")

    let mirroredZip = dir.appendingPathComponent("mirrored.zip").path
    #expect(
        try exportNow(
            service, shoot: shoot.lastPathComponent, paths: paths, destination: mirroredZip,
            zip: true, flatten: false
        ).done == 2)
    let mirroredEntries = try FileActions.list(zip: mirroredZip).filter { !$0.hasSuffix("/") }
    #expect(mirroredEntries.sorted() == ["Tag1/DSC00002.jpg", "Tag2/DSC00002.jpg"])
}

@Test func originalFolderExportIsAnIndependentCopyNotAHardlink() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let shoot = try makeShoot(in: dir)
    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    let source = shoot.appendingPathComponent("Tag1/DSC00002.jpg")
    let out = dir.appendingPathComponent("delivery")
    try exportNow(
        service, shoot: shoot.lastPathComponent, paths: [source.path], destination: out.path)

    // A hardlink would share the inode, so the source's link count would be
    // 2 and an edit to the delivered file would corrupt the library original.
    let delivered = out.appendingPathComponent("DSC00002.jpg")
    let links =
        try FileManager.default.attributesOfItem(atPath: source.path)[.referenceCount]
        as? Int
    #expect(links == 1, "the library original must not share an inode with the delivery")
    try Data("edited by the client".utf8).write(to: delivered)
    #expect(
        try String(contentsOf: source, encoding: .utf8) == "tag1",
        "editing the delivered file must not touch the library original")
}

@Test func zipReexportKeepsThePriorDeliveryWhenTheNewOneFails() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    // A good archive already sitting at the destination.
    let good = dir.appendingPathComponent("staging-good")
    try FileManager.default.createDirectory(at: good, withIntermediateDirectories: true)
    try Data("keep".utf8).write(to: good.appendingPathComponent("a.txt"))
    let dest = dir.appendingPathComponent("delivery.zip").path
    try FileActions.zipDirectory(at: good, to: dest)
    #expect(try FileActions.list(zip: dest).contains { $0.contains("a.txt") })

    // Re-zipping a directory that does not exist makes zip fail; the old
    // archive must survive rather than being deleted up front.
    #expect(throws: (any Error).self) {
        try FileActions.zipDirectory(
            at: dir.appendingPathComponent("does-not-exist"), to: dest)
    }
    #expect(FileManager.default.fileExists(atPath: dest))
    #expect(try FileActions.list(zip: dest).contains { $0.contains("a.txt") })
}

@Test func jpegExportRendersWithConvertedExtension() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let shoot = dir.appendingPathComponent("2026-06-07_jpeg")
    try FileManager.default.createDirectory(at: shoot, withIntermediateDirectories: true)

    // A real renderable source whose extension differs from the delivery's.
    let gray = CIImage(color: CIColor(red: 0.5, green: 0.5, blue: 0.5))
        .cropped(to: CGRect(x: 0, y: 0, width: 32, height: 32))
    let png = shoot.appendingPathComponent("IMG_0001.png")
    try CIContext().writePNGRepresentation(
        of: gray, to: png, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)

    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    let out = dir.appendingPathComponent("delivery")
    let job = try exportNow(
        service, shoot: "2026-06-07_jpeg", paths: [png.path], destination: out.path,
        format: .jpeg)
    #expect(job.done == 1)

    let delivered = out.appendingPathComponent("IMG_0001.jpg")
    #expect(FileManager.default.fileExists(atPath: delivered.path))
    let decoded = CIImage(contentsOf: delivered)
    #expect(decoded != nil, "the export must be a real JPEG, not renamed bytes")
    #expect(decoded?.extent.width == 32)
}

@Test func importCopiesIntoTheShootRootAndSkipsNonImages() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let shoot = dir.appendingPathComponent("2026-08-11_import")
    try FileManager.default.createDirectory(at: shoot, withIntermediateDirectories: true)
    try ProjectFile().write(inShoot: shoot.path)

    let source = try tempDir()
    defer { try? FileManager.default.removeItem(at: source) }
    try Data("photo".utf8).write(to: source.appendingPathComponent("DSC00050.ARW"))
    try Data("junk".utf8).write(to: source.appendingPathComponent("notes.txt"))

    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    // The photo lands in the shoot folder; the text file never makes the plan.
    let job = try settled(
        service,
        service.startImport(
            shoot: "2026-08-11_import",
            paths: [
                source.appendingPathComponent("DSC00050.ARW").path,
                source.appendingPathComponent("notes.txt").path,
            ]))
    #expect(job.total == 1)
    #expect(job.done == 1)
    #expect(job.failed == 0)
    #expect(
        FileManager.default.fileExists(
            atPath: shoot.appendingPathComponent("DSC00050.ARW").path))
    service.rescanNow()
    #expect(try service.listImages(shoot: "2026-08-11_import").map(\.rel) == ["DSC00050.ARW"])

    // Re-importing the same file is a no-op, not a suffixed duplicate.
    let again = try settled(
        service,
        service.startImport(
            shoot: "2026-08-11_import",
            paths: [source.appendingPathComponent("DSC00050.ARW").path]))
    #expect(again.total == 0)
    #expect(
        !FileManager.default.fileExists(
            atPath: shoot.appendingPathComponent("DSC00050-1.ARW").path))

    // A different file wearing the same name is kept under a suffix.
    let elsewhere = try tempDir()
    defer { try? FileManager.default.removeItem(at: elsewhere) }
    try Data("a longer different photo".utf8)
        .write(to: elsewhere.appendingPathComponent("DSC00050.ARW"))
    let clash = try settled(
        service,
        service.startImport(
            shoot: "2026-08-11_import",
            paths: [elsewhere.appendingPathComponent("DSC00050.ARW").path]))
    #expect(clash.done == 1)
    #expect(
        FileManager.default.fileExists(
            atPath: shoot.appendingPathComponent("DSC00050-1.ARW").path))

    // The source was only read.
    #expect(try FileManager.default.contentsOfDirectory(atPath: source.path).count == 2)

    #expect(throws: FileActions.ActionError.noFiles) {
        try service.startImport(
            shoot: "2026-08-11_import", paths: [source.appendingPathComponent("notes.txt").path])
    }
    #expect(throws: LibraryService.ServiceError.self) {
        try service.startImport(shoot: "NOPE", paths: ["/tmp/x.arw"])
    }
}

@Test func twoCardsSharingFilenamesKeepBothPhotosAndNeitherDuplicates() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let shoot = dir.appendingPathComponent("2026-08-12_cards")
    try FileManager.default.createDirectory(at: shoot, withIntermediateDirectories: true)
    try ProjectFile().write(inShoot: shoot.path)

    // Uncompressed raws are a fixed byte count per body, so two bodies both
    // shooting DSC00001 produce same-name same-size files that are not the
    // same photo. Distinct mtimes are what tells them apart.
    let fm = FileManager.default
    let cardA = try tempDir()
    let cardB = try tempDir()
    defer {
        try? fm.removeItem(at: cardA)
        try? fm.removeItem(at: cardB)
    }
    let fromA = cardA.appendingPathComponent("DSC00001.ARW")
    let fromB = cardB.appendingPathComponent("DSC00001.ARW")
    try Data("aaaaa".utf8).write(to: fromA)
    try Data("bbbbb".utf8).write(to: fromB)
    try fm.setAttributes([.modificationDate: Date(timeIntervalSince1970: 1_000)], ofItemAtPath: fromA.path)
    try fm.setAttributes([.modificationDate: Date(timeIntervalSince1970: 2_000)], ofItemAtPath: fromB.path)

    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    #expect(
        try settled(service, service.startImport(shoot: "2026-08-12_cards", paths: [fromA.path])).done == 1)
    let second = try settled(
        service, service.startImport(shoot: "2026-08-12_cards", paths: [fromB.path]))
    #expect(second.total == 1, "a different photo that merely shares a name must still be imported")
    #expect(second.done == 1)

    let landedA = shoot.appendingPathComponent("DSC00001.ARW")
    let landedB = shoot.appendingPathComponent("DSC00001-1.ARW")
    #expect(try Data(contentsOf: landedA) == Data("aaaaa".utf8))
    #expect(try Data(contentsOf: landedB) == Data("bbbbb".utf8))

    let third = try settled(
        service, service.startImport(shoot: "2026-08-12_cards", paths: [fromB.path]))
    #expect(third.total == 0, "a file that landed under a suffix must not import again")
    #expect(!fm.fileExists(atPath: shoot.appendingPathComponent("DSC00001-2.ARW").path))
}

@Test func framesACardCannotTellApartAreStillImportedSeparately() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let shoot = dir.appendingPathComponent("2026-08-14_burst")
    try FileManager.default.createDirectory(at: shoot, withIntermediateDirectories: true)
    try ProjectFile().write(inShoot: shoot.path)

    // FAT32 keeps mtime to the nearest two seconds and an uncompressed raw is
    // a fixed byte count, so two frames off two cards can agree on both.
    let fm = FileManager.default
    let cardA = try tempDir()
    let cardB = try tempDir()
    defer {
        try? fm.removeItem(at: cardA)
        try? fm.removeItem(at: cardB)
    }
    let fromA = cardA.appendingPathComponent("DSC00001.ARW")
    let fromB = cardB.appendingPathComponent("DSC00001.ARW")
    try Data(repeating: 0xAA, count: 4096).write(to: fromA)
    try Data(repeating: 0xBB, count: 4096).write(to: fromB)
    let stamp = Date(timeIntervalSince1970: 1_780_000_000)
    for card in [fromA, fromB] {
        try fm.setAttributes([.modificationDate: stamp], ofItemAtPath: card.path)
    }

    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    #expect(
        try settled(service, service.startImport(shoot: "2026-08-14_burst", paths: [fromA.path])).done == 1)
    let second = try settled(
        service, service.startImport(shoot: "2026-08-14_burst", paths: [fromB.path]))
    #expect(second.done == 1, "same name, size and mtime, different frame: both must land")
    #expect(
        try Data(contentsOf: shoot.appendingPathComponent("DSC00001-1.ARW"))
            == Data(repeating: 0xBB, count: 4096))

    // Two photos can agree over the whole head the check reads, which is what
    // the byte count is still there for.
    let head = Data(repeating: 0xCC, count: 64 * 1024)
    let cardC = try tempDir()
    let cardD = try tempDir()
    defer {
        try? fm.removeItem(at: cardC)
        try? fm.removeItem(at: cardD)
    }
    let fromC = cardC.appendingPathComponent("DSC00002.ARW")
    let fromD = cardD.appendingPathComponent("DSC00002.ARW")
    try (head + Data("short".utf8)).write(to: fromC)
    try (head + Data("a longer tail".utf8)).write(to: fromD)
    for card in [fromC, fromD] {
        try fm.setAttributes([.modificationDate: stamp], ofItemAtPath: card.path)
    }
    #expect(
        try settled(service, service.startImport(shoot: "2026-08-14_burst", paths: [fromC.path])).done == 1)
    #expect(
        try settled(service, service.startImport(shoot: "2026-08-14_burst", paths: [fromD.path]))
            .done == 1, "same head and mtime, different length: a different photo")

    // And the real duplicate still imports once, however it is offered.
    let repeated = try settled(
        service,
        service.startImport(shoot: "2026-08-14_burst", paths: [fromA.path, fromA.path]))
    #expect(repeated.total == 0, "the same photo picked twice is still one photo")
}

@Test func aCopyNeverOverwritesANameTakenSinceItWasChosen() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let source = dir.appendingPathComponent("DSC00700.ARW")
    try Data("the new photo".utf8).write(to: source)

    // Stands in for a name that was free when the job planned it and taken by
    // the time the writer got there.
    let taken = dir.appendingPathComponent("landing/DSC00700.ARW")
    try FileManager.default.createDirectory(
        at: taken.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data("already here".utf8).write(to: taken)

    let landed = try FileActions.copyWithoutOverwriting(from: source, to: taken)
    #expect(landed.lastPathComponent == "DSC00700-1.ARW")
    #expect(try String(contentsOf: taken, encoding: .utf8) == "already here")
    #expect(try String(contentsOf: landed, encoding: .utf8) == "the new photo")
    // Nothing staged is left behind.
    #expect(
        try FileManager.default.contentsOfDirectory(atPath: taken.deletingLastPathComponent().path)
            .filter { $0.hasPrefix(FileActions.tempPrefix) }.isEmpty)
}

@Test func anImportClearsStagingFilesAKilledCopyLeftBehind() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let shoot = dir.appendingPathComponent("2026-08-13_temps")
    try FileManager.default.createDirectory(at: shoot, withIntermediateDirectories: true)
    try ProjectFile().write(inShoot: shoot.path)

    let fm = FileManager.default
    let stale = shoot.appendingPathComponent("\(FileActions.tempPrefix)DEAD-BEEF")
    let live = shoot.appendingPathComponent("\(FileActions.tempPrefix)IN-FLIGHT")
    try Data("half a raw".utf8).write(to: stale)
    try Data("half a raw".utf8).write(to: live)
    try fm.setAttributes(
        [.modificationDate: Date(timeIntervalSinceNow: -7200)], ofItemAtPath: stale.path)

    let source = try tempDir()
    defer { try? fm.removeItem(at: source) }
    let photo = source.appendingPathComponent("DSC00090.ARW")
    try Data("photo".utf8).write(to: photo)

    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)
    _ = try settled(service, service.startImport(shoot: "2026-08-13_temps", paths: [photo.path]))

    #expect(!fm.fileExists(atPath: stale.path))
    // A concurrent import's staging file is not this import's to delete.
    #expect(fm.fileExists(atPath: live.path))
}

@Test func emptySelectionsAreRefusedRatherThanSilentlyDoingNothing() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    #expect(throws: FileActions.ActionError.noFiles) { try FileActions.reveal(paths: []) }
    #expect(throws: FileActions.ActionError.noFiles) { try FileActions.trash(paths: []) }
}
