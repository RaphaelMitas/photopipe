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
    let dir = scratchDir("xmp")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

/// Independent verification path: what would Lightroom see? Ask exiftool
/// directly rather than trusting our own reader.
private func exiftoolTag(_ tag: String, of url: URL) throws -> String {
    try ExifTool.shared.execute([tag, "-s3", url.path])
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

private func writeGrayJPEG(to url: URL) throws {
    let gray = CIImage(color: CIColor(red: 0.5, green: 0.5, blue: 0.5))
        .cropped(to: CGRect(x: 0, y: 0, width: 32, height: 32))
    try CIContext().writeJPEGRepresentation(
        of: gray, to: url, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
}

/// Fresh stat every time: the embedded-read cache is (path, mtime)-keyed, so
/// a stale mtime would serve pre-write values.
private func image(_ url: URL) throws -> ImageFile {
    let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
    return ImageFile(
        path: url.path, rel: url.lastPathComponent, ext: url.pathExtension,
        size: (attrs[.size] as? Int64) ?? 0,
        mtime: ((attrs[.modificationDate] as? Date) ?? .distantPast).timeIntervalSince1970)
}

@Test func sidecarCreateWriteReadRoundTrip() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let arw = dir.appendingPathComponent("DSC00001.ARW")
    try Data("fake".utf8).write(to: arw)

    try XMP.writeRating(4, file: try image(arw), tool: .shared)

    let sidecar = XMP.sidecarURL(forImagePath: arw.path)
    #expect(sidecar.lastPathComponent == "DSC00001.xmp")
    #expect(FileManager.default.fileExists(atPath: sidecar.path))
    #expect(XMP.readRating(file: try image(arw)) == 4)
    #expect(try exiftoolTag("-XMP:Rating", of: sidecar) == "4")

    // Update in place (no duplicate sidecar, no backup file left behind).
    try XMP.writeRating(2, file: try image(arw), tool: .shared)
    #expect(XMP.readRating(file: try image(arw)) == 2)
    let contents = try FileManager.default.contentsOfDirectory(atPath: dir.path)
    #expect(contents.sorted() == ["DSC00001.ARW", "DSC00001.xmp"])
}

@Test func sidecarExposureRoundTrip() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let arw = dir.appendingPathComponent("DSC00006.ARW")
    try Data("fake".utf8).write(to: arw)

    #expect(XMP.readExposure(file: try image(arw)) == 0, "no sidecar means untouched")

    try XMP.writeExposure(1.5, file: try image(arw), tool: .shared)
    #expect(XMP.readExposure(file: try image(arw)) == 1.5)
    // The tag Lightroom itself uses, verified independently.
    let sidecar = XMP.sidecarURL(forImagePath: arw.path)
    #expect(try exiftoolTag("-XMP-crs:Exposure2012", of: sidecar) == "1.5")

    // Exposure and rating live in the same sidecar without clobbering each other.
    try XMP.writeRating(3, file: try image(arw), tool: .shared)
    #expect(XMP.readExposure(file: try image(arw)) == 1.5)
    #expect(XMP.readRating(file: try image(arw)) == 3)

    try XMP.writeExposure(-0.75, file: try image(arw), tool: .shared)
    #expect(XMP.readExposure(file: try image(arw)) == -0.75)
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

    try XMP.writeRating(5, file: try image(arw), tool: .shared)

    #expect(XMP.readSidecarRating(at: sidecar) == 5)
    #expect(try exiftoolTag("-XMP:Label", of: sidecar) == "Blue",
        "existing Lightroom tags must survive our writes")
    #expect(try exiftoolTag("-XMP:Title", of: sidecar) == "Keeper")
}

@Test func exifToolRejectsNewlineArguments() {
    // The stay_open protocol is newline-delimited, so a newline in an
    // argument would inject extra flags into exiftool (`-config` loads
    // arbitrary Perl). Newlines are legal in paths, so this guards a real
    // filename and a hostile request alike — and needs no exiftool binary,
    // the guard fires before the daemon is touched.
    #expect(throws: ExifTool.ExifToolError.self) {
        try ExifTool.shared.execute(["-XMP:Rating=5", "/tmp/out\n-config\n/tmp/evil.config"])
    }
}

@Test func embeddedJPEGRatingAndExposureRoundTrip() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let jpg = dir.appendingPathComponent("DSC00003.JPG")
    try writeGrayJPEG(to: jpg)

    try XMP.writeRating(3, file: try image(jpg), tool: .shared)
    try XMP.writeExposure(0.5, file: try image(jpg), tool: .shared)

    #expect(XMP.readRating(file: try image(jpg)) == 3)
    #expect(XMP.readExposure(file: try image(jpg)) == 0.5)
    #expect(try exiftoolTag("-XMP:Rating", of: jpg) == "3")
    #expect(try exiftoolTag("-XMP-crs:Exposure2012", of: jpg) == "0.5")
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
    try XMP.writeRating(5, file: try image(jpg), tool: .shared)
    try XMP.writeRating(0, file: try image(jpg), tool: .shared)

    #expect(XMP.readRating(file: try image(jpg)) == 0)
    #expect(try exiftoolTag("-XMP:Rating", of: jpg).isEmpty)
}

@Test func sameStemFilesAreIndependentPhotos() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    // One stem, two photos: rating the raw must not touch the JPEG's rating.
    let arw = dir.appendingPathComponent("DSC00005.ARW")
    try Data("fake".utf8).write(to: arw)
    let jpg = dir.appendingPathComponent("DSC00005.JPG")
    try writeGrayJPEG(to: jpg)

    try XMP.writeRating(4, file: try image(arw), tool: .shared)
    try XMP.writeRating(2, file: try image(jpg), tool: .shared)

    #expect(XMP.readRating(file: try image(arw)) == 4)
    #expect(XMP.readRating(file: try image(jpg)) == 2)
}

@Test func libraryServiceRatingAndExposureEndToEnd() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let shoot = dir.appendingPathComponent("2026-01-01_xmptest")
    try FileManager.default.createDirectory(at: shoot, withIntermediateDirectories: true)
    let arw = shoot.appendingPathComponent("DSC00010.ARW")
    try Data("fake".utf8).write(to: arw)
    let jpg = shoot.appendingPathComponent("DSC00010.JPG")
    try writeGrayJPEG(to: jpg)

    let service = LibraryService(
        thumbnailer: Thumbnailer(cacheDir: dir.appendingPathComponent("thumbs")),
        renderer: Renderer(cacheDir: dir.appendingPathComponent("renders")))
    let before = try service.setRoot(path: dir.path, indexPath: nil)

    let result = try service.setRating(shoot: "2026-01-01_xmptest", path: arw.path, rating: 4)
    #expect(result.rating == 4)
    #expect(result.generation > before.generation, "rating must bump the generation")
    _ = try service.setExposure(shoot: "2026-01-01_xmptest", path: jpg.path, exposure: 1.25)

    // Snapshot updated immediately, per file — the JPEG's rating stays 0.
    let images = try service.listImages(shoot: "2026-01-01_xmptest")
    #expect(images.first { $0.path == arw.path }?.rating == 4)
    #expect(images.first { $0.path == jpg.path }?.rating == 0)
    #expect(images.first { $0.path == jpg.path }?.exposure == 1.25)

    // Disk agrees: sidecar for the raw, embedded for the JPG — both verified
    // through the independent exiftool read (the Lightroom proxy).
    let sidecar = shoot.appendingPathComponent("DSC00010.xmp")
    #expect(try exiftoolTag("-XMP:Rating", of: sidecar) == "4")
    #expect(try exiftoolTag("-XMP-crs:Exposure2012", of: jpg) == "1.25")

    // A fresh scan (new service, no snapshot) reads the same values back.
    let fresh = LibraryService(
        thumbnailer: Thumbnailer(cacheDir: dir.appendingPathComponent("thumbs")),
        renderer: Renderer(cacheDir: dir.appendingPathComponent("renders")))
    _ = try fresh.setRoot(path: dir.path, indexPath: nil)
    let rescanned = try fresh.listImages(shoot: "2026-01-01_xmptest")
    #expect(rescanned.first { $0.path == arw.path }?.rating == 4)
    #expect(rescanned.first { $0.path == jpg.path }?.exposure == 1.25)

    #expect(throws: LibraryService.ServiceError.self) {
        try service.setRating(shoot: "2026-01-01_xmptest", path: arw.path, rating: 9)
    }
    #expect(throws: LibraryService.ServiceError.self) {
        try service.setRating(
            shoot: "2026-01-01_xmptest", path: shoot.appendingPathComponent("NOPE.ARW").path,
            rating: 1)
    }
}
