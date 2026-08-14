import CoreImage
import Foundation
import Testing

@testable import PhotopipeCoreKit

private func tempDir() throws -> URL {
    let dir = scratchDir("actions")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

private func makeService(in dir: URL) -> LibraryService {
    LibraryService(
        thumbnailer: Thumbnailer(cacheDir: dir.appendingPathComponent("thumbs")),
        renderer: Renderer(cacheDir: dir.appendingPathComponent("renders")))
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
        try service.exportFiles(
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
        try service.exportFiles(
            shoot: shoot.lastPathComponent, paths: [jpg], destination: out.path,
            zip: false, flatten: true, format: .original, quality: 90)
    }
    #expect(try export() == 1)
    // Exporting the same file twice keeps both rather than clobbering.
    #expect(try export() == 1)

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
    let count = try service.exportFiles(
        shoot: shoot.lastPathComponent,
        paths: [
            shoot.appendingPathComponent("Tag1/DSC00002.jpg").path,
            shoot.appendingPathComponent("Tag2/DSC00002.jpg").path,
        ],
        destination: out.path, zip: false, flatten: true, format: .original, quality: 90)
    #expect(count == 2)

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
    let count = try service.exportFiles(
        shoot: shoot.lastPathComponent,
        paths: [
            shoot.appendingPathComponent("Tag1/DSC00002.jpg").path,
            shoot.appendingPathComponent("Tag2/DSC00002.jpg").path,
        ],
        destination: out.path, zip: false, flatten: false, format: .original, quality: 90)
    #expect(count == 2)

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
        try service.exportFiles(
            shoot: shoot.lastPathComponent, paths: paths, destination: flatZip,
            zip: true, flatten: true, format: .original, quality: 90) == 2)
    let flatEntries = try FileActions.list(zip: flatZip).filter { !$0.hasSuffix("/") }
    #expect(
        flatEntries.sorted() == ["DSC00002-1.jpg", "DSC00002.jpg"],
        "the client gets files, not our folder structure")

    let mirroredZip = dir.appendingPathComponent("mirrored.zip").path
    #expect(
        try service.exportFiles(
            shoot: shoot.lastPathComponent, paths: paths, destination: mirroredZip,
            zip: true, flatten: false, format: .original, quality: 90) == 2)
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
    _ = try service.exportFiles(
        shoot: shoot.lastPathComponent, paths: [source.path], destination: out.path,
        zip: false, flatten: true, format: .original, quality: 90)

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
    let count = try service.exportFiles(
        shoot: "2026-06-07_jpeg", paths: [png.path], destination: out.path,
        zip: false, flatten: true, format: .jpeg, quality: 90)
    #expect(count == 1)

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

    // The photo lands in the shoot folder; the text file is skipped, not copied.
    let result = try service.importFiles(
        shoot: "2026-08-11_import",
        paths: [
            source.appendingPathComponent("DSC00050.ARW").path,
            source.appendingPathComponent("notes.txt").path,
        ])
    #expect(result.imported == 1)
    #expect(result.skipped == 1)
    #expect(
        FileManager.default.fileExists(
            atPath: shoot.appendingPathComponent("DSC00050.ARW").path))
    #expect(try service.listImages(shoot: "2026-08-11_import").map(\.rel) == ["DSC00050.ARW"])

    // Importing the same name again never overwrites.
    _ = try service.importFiles(
        shoot: "2026-08-11_import", paths: [source.appendingPathComponent("DSC00050.ARW").path])
    #expect(
        FileManager.default.fileExists(
            atPath: shoot.appendingPathComponent("DSC00050-1.ARW").path))

    // The source was only read.
    #expect(try FileManager.default.contentsOfDirectory(atPath: source.path).count == 2)

    #expect(throws: LibraryService.ServiceError.self) {
        try service.importFiles(shoot: "NOPE", paths: ["/tmp/x.arw"])
    }
}

@Test func emptySelectionsAreRefusedRatherThanSilentlyDoingNothing() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    #expect(throws: FileActions.ActionError.noFiles) { try FileActions.reveal(paths: []) }
    #expect(throws: FileActions.ActionError.noFiles) { try FileActions.trash(paths: []) }
    #expect(throws: FileActions.ActionError.noFiles) {
        try FileActions.copy(paths: [], toFolder: dir.appendingPathComponent("out").path)
    }
}
