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

@Test func sidecarEditRoundTrip() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let arw = dir.appendingPathComponent("DSC00006.ARW")
    try Data("fake".utf8).write(to: arw)

    #expect(XMP.readEdit(file: try image(arw)) == .identity, "no sidecar means untouched")

    let edit = Edit(
        exposure: 1.5, highlights: -42, shadows: 18, temperature: 5600, tint: 12,
        vibrance: 10, saturation: -5,
        curveRGB: [CurvePoint(x: 0, y: 0), CurvePoint(x: 0.5, y: 0.6), CurvePoint(x: 1, y: 1)],
        curveRed: [CurvePoint(x: 0, y: 0.1), CurvePoint(x: 1, y: 0.9)])
    try XMP.writeEdit(edit, file: try image(arw), tool: .shared)

    let read = XMP.readEdit(file: try image(arw))
    #expect(read.exposure == 1.5)
    #expect(read.highlights == -42)
    #expect(read.shadows == 18)
    #expect(read.temperature == 5600)
    #expect(read.tint == 12)
    #expect(read.vibrance == 10)
    #expect(read.saturation == -5)
    #expect(read.curveRGB.count == 3)
    #expect(abs(read.curveRGB[1].y - 0.6) < 1.0 / 255, "curve points survive 0-255 quantization")
    #expect(read.curveRed.count == 2)
    #expect(read.curveGreen.isEmpty)

    // The tags Lightroom itself uses, verified independently.
    let sidecar = XMP.sidecarURL(forImagePath: arw.path)
    #expect(try exiftoolTag("-XMP-crs:Exposure2012", of: sidecar) == "1.5")
    #expect(try exiftoolTag("-XMP-crs:Highlights2012", of: sidecar) == "-42")
    #expect(try exiftoolTag("-XMP-crs:ColorTemperature", of: sidecar) == "5600")
    #expect(try exiftoolTag("-XMP-crs:ToneCurvePV2012", of: sidecar).contains("128, 153"))

    // Edit and rating live in the same sidecar without clobbering each other.
    try XMP.writeRating(3, file: try image(arw), tool: .shared)
    #expect(XMP.readEdit(file: try image(arw)).exposure == 1.5)
    #expect(XMP.readRating(file: try image(arw)) == 3)

    // Writing identity clears every tag again.
    try XMP.writeEdit(.identity, file: try image(arw), tool: .shared)
    #expect(XMP.readEdit(file: try image(arw)) == .identity)
    #expect(try exiftoolTag("-XMP-crs:ToneCurvePV2012", of: sidecar).isEmpty)
    #expect(XMP.readRating(file: try image(arw)) == 3, "clearing the edit keeps the rating")
}

/// Regression: `-TAG= -TAG+=…` appends to the existing list in exiftool, so
/// every scrub grew the tone curve until a sidecar held thousands of points
/// and writes took seconds. Rewrites must replace the list wholesale.
@Test func rewritingACurveReplacesInsteadOfAppending() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let arw = dir.appendingPathComponent("DSC00007.ARW")
    try Data("fake".utf8).write(to: arw)

    let first = Edit(curveRGB: [
        CurvePoint(x: 0, y: 0), CurvePoint(x: 0.23, y: 0.17), CurvePoint(x: 1, y: 1),
    ])
    let second = Edit(curveRGB: [
        CurvePoint(x: 0, y: 0), CurvePoint(x: 0.4, y: 0.5),
        CurvePoint(x: 0.76, y: 0.81), CurvePoint(x: 1, y: 1),
    ])
    try XMP.writeEdit(first, file: try image(arw), tool: .shared)
    try XMP.writeEdit(second, file: try image(arw), tool: .shared)
    try XMP.writeEdit(second, file: try image(arw), tool: .shared)

    // parseCurve returns the raw item list, so a stale leftover would show up
    // as extra points here.
    let read = XMP.readEdit(file: try image(arw))
    #expect(read.curveRGB.count == 4)
    let sidecar = XMP.sidecarURL(forImagePath: arw.path)
    let text = try String(contentsOf: sidecar, encoding: .utf8)
    #expect(text.matches(of: /<rdf:li>/).count == 4)
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
    #expect(
        try exiftoolTag("-XMP:Label", of: sidecar) == "Blue",
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

@Test func embeddedJPEGRatingAndEditRoundTrip() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let jpg = dir.appendingPathComponent("DSC00003.JPG")
    try writeGrayJPEG(to: jpg)

    try XMP.writeRating(3, file: try image(jpg), tool: .shared)
    let edit = Edit(
        exposure: 0.5, shadows: 25, temperature: 30, tint: -10, saturation: 15,
        curveRGB: [CurvePoint(x: 0, y: 0), CurvePoint(x: 0.25, y: 0.2), CurvePoint(x: 1, y: 1)])
    try XMP.writeEdit(edit, file: try image(jpg), tool: .shared)

    #expect(XMP.readRating(file: try image(jpg)) == 3)
    let read = XMP.readEdit(file: try image(jpg))
    #expect(read.exposure == 0.5)
    #expect(read.shadows == 25)
    #expect(read.temperature == 30)
    #expect(read.tint == -10)
    #expect(read.saturation == 15)
    #expect(read.curveRGB.count == 3)
    #expect(try exiftoolTag("-XMP:Rating", of: jpg) == "3")
    #expect(try exiftoolTag("-XMP-crs:Exposure2012", of: jpg) == "0.5")
    // Embedded formats have no known as-shot neutral, so the incremental tags.
    #expect(try exiftoolTag("-XMP-crs:IncrementalTemperature", of: jpg) == "30")
    #expect(try exiftoolTag("-XMP-crs:IncrementalTint", of: jpg) == "-10")
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

@Test func libraryServiceRatingAndEditEndToEnd() throws {
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
    let edit = Edit(
        exposure: 1.25, highlights: -30, vibrance: 20,
        curveRGB: [CurvePoint(x: 0, y: 0), CurvePoint(x: 0.5, y: 0.55), CurvePoint(x: 1, y: 1)])
    _ = try service.setEdit(shoot: "2026-01-01_xmptest", path: jpg.path, edit: edit)

    // Snapshot updated immediately, per file — the JPEG's rating stays 0.
    let images = try service.listImages(shoot: "2026-01-01_xmptest")
    #expect(images.first { $0.path == arw.path }?.rating == 4)
    #expect(images.first { $0.path == jpg.path }?.rating == 0)
    #expect(images.first { $0.path == jpg.path }?.edit.exposure == 1.25)
    #expect(images.first { $0.path == jpg.path }?.edit.highlights == -30)

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
    let rescannedEdit = try #require(rescanned.first { $0.path == jpg.path }?.edit)
    #expect(rescannedEdit.exposure == 1.25)
    #expect(rescannedEdit.vibrance == 20)
    #expect(rescannedEdit.curveRGB.count == 3)

    #expect(throws: LibraryService.ServiceError.self) {
        try service.setRating(shoot: "2026-01-01_xmptest", path: arw.path, rating: 9)
    }
    #expect(throws: LibraryService.ServiceError.self) {
        try service.setRating(
            shoot: "2026-01-01_xmptest", path: shoot.appendingPathComponent("NOPE.ARW").path,
            rating: 1)
    }
}
