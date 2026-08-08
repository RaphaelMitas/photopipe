import CoreImage
import Foundation
import Testing

@testable import PhotopipeCoreKit

/// exiftool availability: soft skip locally, loud failure on CI (which
/// installs it before running tests).
private func requireExifTool() -> Bool {
    guard ExifTool.shared.available else {
        #expect(
            ProcessInfo.processInfo.environment["CI"] == nil,
            "exiftool missing on CI — install it before swift test")
        print("SKIP: install exiftool for XMP tests")
        return false
    }
    return true
}

private func tempDir() throws -> URL {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("photopipe-xmp-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

/// Independent verification path: what would Lightroom see? Ask exiftool
/// directly rather than trusting our own reader.
private func exiftoolRating(of url: URL) throws -> String {
    try ExifTool.shared.execute(["-XMP:Rating", "-s3", url.path])
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

private func writeGrayJPEG(to url: URL) throws {
    let gray = CIImage(color: CIColor(red: 0.5, green: 0.5, blue: 0.5))
        .cropped(to: CGRect(x: 0, y: 0, width: 32, height: 32))
    try CIContext().writeJPEGRepresentation(
        of: gray, to: url, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
}

private func record(_ url: URL, stage: Stage) -> FileRecord {
    FileRecord(path: url.path, ext: url.pathExtension, stage: stage, size: 4, mtime: 1)
}

@Test func sidecarCreateWriteReadRoundTrip() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let arw = dir.appendingPathComponent("DSC00001.ARW")
    try Data("fake".utf8).write(to: arw)

    try XMP.writeRating(4, files: [record(arw, stage: .raw)], tool: .shared)

    let sidecar = XMP.sidecarURL(forImagePath: arw.path)
    #expect(sidecar.lastPathComponent == "DSC00001.xmp")
    #expect(FileManager.default.fileExists(atPath: sidecar.path))
    #expect(XMP.readSidecarRating(at: sidecar) == 4)
    #expect(try exiftoolRating(of: sidecar) == "4")

    // Update in place (no duplicate sidecar, no backup file left behind).
    try XMP.writeRating(2, files: [record(arw, stage: .raw)], tool: .shared)
    #expect(XMP.readSidecarRating(at: sidecar) == 2)
    let contents = try FileManager.default.contentsOfDirectory(atPath: dir.path)
    #expect(contents.sorted() == ["DSC00001.ARW", "DSC00001.xmp"])
}

@Test func sidecarUpdatePreservesForeignTags() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    // A sidecar Lightroom might have written: rating plus other tags.
    let arw = dir.appendingPathComponent("DSC00002.ARW")
    try Data("fake".utf8).write(to: arw)
    let sidecar = XMP.sidecarURL(forImagePath: arw.path)
    try ExifTool.shared.write([
        "-XMP:Rating=1", "-XMP:Label=Blue", "-XMP:Title=Keeper", "-o", sidecar.path,
    ])

    try XMP.writeRating(5, files: [record(arw, stage: .raw)], tool: .shared)

    #expect(XMP.readSidecarRating(at: sidecar) == 5)
    let label = try ExifTool.shared.execute(["-XMP:Label", "-s3", sidecar.path])
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let title = try ExifTool.shared.execute(["-XMP:Title", "-s3", sidecar.path])
        .trimmingCharacters(in: .whitespacesAndNewlines)
    #expect(label == "Blue", "existing Lightroom tags must survive our writes")
    #expect(title == "Keeper")
}

@Test func embeddedJPEGWriteReadRoundTrip() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let jpg = dir.appendingPathComponent("DSC00003.JPG")
    try writeGrayJPEG(to: jpg)

    try XMP.writeRating(3, files: [record(jpg, stage: .export)], tool: .shared)

    #expect(XMP.readEmbeddedRating(at: jpg) == 3)
    #expect(try exiftoolRating(of: jpg) == "3")
    // No sidecar for embedded formats, no backup litter.
    let contents = try FileManager.default.contentsOfDirectory(atPath: dir.path)
    #expect(contents == ["DSC00003.JPG"])
}

@Test func ratingZeroClearsTheTag() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let jpg = dir.appendingPathComponent("DSC00004.JPG")
    try writeGrayJPEG(to: jpg)
    try XMP.writeRating(5, files: [record(jpg, stage: .export)], tool: .shared)
    try XMP.writeRating(0, files: [record(jpg, stage: .export)], tool: .shared)

    #expect(XMP.readEmbeddedRating(at: jpg) == nil)
    #expect(try exiftoolRating(of: jpg).isEmpty)
}

@Test func groupRatingPrefersSidecarOverEmbedded() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let arw = dir.appendingPathComponent("DSC00005.ARW")
    try Data("fake".utf8).write(to: arw)
    let jpg = dir.appendingPathComponent("DSC00005.JPG")
    try writeGrayJPEG(to: jpg)

    try ExifTool.shared.write(["-XMP:Rating=4", "-o", XMP.sidecarURL(forImagePath: arw.path).path])
    try ExifTool.shared.write(["-overwrite_original", "-XMP:Rating=2", jpg.path])

    let files = [record(arw, stage: .raw), record(jpg, stage: .export)]
    #expect(XMP.readRating(files: files) == 4, "sidecar is the raw's authority")
}

@Test func libraryServiceSetRatingEndToEnd() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let shoot = dir.appendingPathComponent("2026-01-01_xmptest")
    try FileManager.default.createDirectory(at: shoot, withIntermediateDirectories: true)
    try Data("fake".utf8).write(to: shoot.appendingPathComponent("DSC00010.ARW"))
    try writeGrayJPEG(to: shoot.appendingPathComponent("DSC00010.JPG"))

    let service = LibraryService(
        thumbnailer: Thumbnailer(cacheDir: dir.appendingPathComponent("thumbs")),
        renderer: Renderer(cacheDir: dir.appendingPathComponent("renders")))
    let before = try service.setRoot(path: dir.path, indexPath: nil)

    let result = try service.setRating(shoot: "2026-01-01_xmptest", stem: "DSC00010", rating: 4)
    #expect(result.rating == 4)
    #expect(result.generation > before.generation, "rating must bump the generation")

    // Snapshot updated immediately.
    let images = try service.listImages(shoot: "2026-01-01_xmptest")
    #expect(images.first?.rating == 4)

    // Disk agrees: sidecar for the raw, embedded for the JPG — both verified
    // through the independent exiftool read (the Lightroom proxy).
    let sidecar = shoot.appendingPathComponent("DSC00010.xmp")
    #expect(try exiftoolRating(of: sidecar) == "4")
    #expect(try exiftoolRating(of: shoot.appendingPathComponent("DSC00010.JPG")) == "4")

    // A fresh scan (new service, no snapshot) reads the same rating back.
    let fresh = LibraryService(
        thumbnailer: Thumbnailer(cacheDir: dir.appendingPathComponent("thumbs")),
        renderer: Renderer(cacheDir: dir.appendingPathComponent("renders")))
    _ = try fresh.setRoot(path: dir.path, indexPath: nil)
    #expect(try fresh.listImages(shoot: "2026-01-01_xmptest").first?.rating == 4)

    #expect(throws: LibraryService.ServiceError.self) {
        try service.setRating(shoot: "2026-01-01_xmptest", stem: "DSC00010", rating: 9)
    }
    #expect(throws: LibraryService.ServiceError.self) {
        try service.setRating(shoot: "2026-01-01_xmptest", stem: "NOPE", rating: 1)
    }
}
