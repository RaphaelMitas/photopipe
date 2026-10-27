import CoreGraphics
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers

@testable import PhotopipeCoreKit

/// Each photo is a one-number print and its capture time.
private func stacked(_ photos: [String: (Float, Double?)]) -> [String: String] {
    Stacker.stacks(
        photos.mapValues { Print(feature: [$0.0, 0]) },
        captured: photos.compactMapValues { $0.1 })
}

@Test func aPhotoJoinsOnlyWhenItLooksLikeEveryPhotoInTheStack() {
    // a–b and b–c are each 0.3 apart, a–c 0.6: chaining neighbours would take c too
    let stacks = stacked([
        "a": (0, 0), "b": (0.3, 1), "c": (0.6, 2),
    ])
    #expect(stacks == ["a": "a", "b": "a"])
}

@Test func anOddFrameMidBurstDoesNotCutTheBurstInTwo() {
    let stacks = stacked([
        "a": (0, 0), "b": (0.1, 1),
        "x": (5, 2), "c": (0.2, 3),
    ])
    #expect(stacks == ["a": "a", "b": "a", "c": "a"])
}

@Test func aStackIsNamedByItsFirstPhotoInCaptureOrder() {
    let stacks = stacked(["z": (0, 10), "m": (0.1, 11)])
    #expect(stacks == ["z": "z", "m": "z"])
}

@Test func identicalPhotosOutsideTheWindowStayApart() {
    let stacks = stacked([
        "a": (0, 0), "b": (0, 30), "c": (0, 61),
    ])
    #expect(stacks == ["a": "a", "b": "a"])
}

@Test func photosWithoutACaptureTimeStandAlone() {
    let stacks = stacked(["a": (0, 0), "b": (0, nil)])
    #expect(stacks.isEmpty)
}

private func exifDate(_ stamp: String, subsec: String) -> [CFString: Any] {
    [
        kCGImagePropertyExifDictionary: [
            kCGImagePropertyExifDateTimeOriginal: stamp,
            kCGImagePropertyExifSubsecTimeOriginal: subsec,
        ]
    ]
}

/// Different patterns read as different pictures.
private func writeJPEG(
    _ url: URL, pattern: Int, stamp: String = "2026:08:08 19:24:28", subsec: String = "000",
    size: Int = 256, embedThumbnail: Bool = false
) throws {
    let context = CGContext(
        data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.setFillColor(CGColor(red: 0.9, green: 0.5, blue: 0.2, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: size, height: size))
    context.setFillColor(CGColor(red: 0.1, green: 0.2, blue: 0.8, alpha: 1))
    let cell = size / (pattern + 1)
    for x in stride(from: 0, to: size, by: cell * 2) {
        for y in stride(from: 0, to: size, by: cell * 2) {
            context.fill(CGRect(x: x, y: y, width: cell, height: cell))
        }
    }
    let destination = CGImageDestinationCreateWithURL(
        url as CFURL, UTType.jpeg.identifier as CFString, 1, nil)!
    var props = exifDate(stamp, subsec: subsec)
    props[kCGImageDestinationEmbedThumbnail] = embedThumbnail
    CGImageDestinationAddImage(destination, context.makeImage()!, props as CFDictionary)
    #expect(CGImageDestinationFinalize(destination))
}

@Test func enrichmentCarriesTheCaptureTimeToTheSubsecond() throws {
    let url = URL(fileURLWithPath: tempFile("captured.jpg"))
    try writeJPEG(url, pattern: 3, subsec: "963")
    defer { try? FileManager.default.removeItem(at: url) }

    let file = enrich(ImageFile(path: url.path, rel: "captured.jpg", ext: "jpg", size: 1, mtime: 1))
    // 2026-08-08 19:24:28 read as UTC
    #expect(try #require(file.captured) == 1_786_217_068.963)
}

@Test func printsSurviveTheIndexIncludingUnreadableFiles() throws {
    let path = tempFile("index.sqlite")
    defer { try? FileManager.default.removeItem(atPath: path) }
    let index = try SQLiteIndex(path: path)
    let rows: [(String, Printer.Row)] = [
        ("/r/a", .init(value: Print(feature: [0.25, -1, 3]), mtime: 1, size: 2, version: 1)),
        ("/r/b", .init(value: Print(feature: [1]), mtime: 3, size: 4, version: 1)),
        ("/r/c", .init(value: nil, mtime: 5, size: 6, version: 1)),
    ]
    try index.savePrints(rows)
    #expect(try index.loadPrints(under: "/r") == Dictionary(uniqueKeysWithValues: rows))
}

@Test func listImagesStacksNearIdenticalPhotos() async throws {
    let root = URL(fileURLWithPath: tempFile("stacks-root"))
    let shoot = root.appendingPathComponent("2026-08-08_dance")
    try FileManager.default.createDirectory(at: shoot, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    try writeJPEG(shoot.appendingPathComponent("1.jpg"), pattern: 3, stamp: "2026:08:08 19:24:28")
    try writeJPEG(shoot.appendingPathComponent("2.jpg"), pattern: 3, stamp: "2026:08:08 19:24:29")
    try writeJPEG(shoot.appendingPathComponent("3.jpg"), pattern: 0, stamp: "2026:08:08 19:24:30")

    let service = LibraryService(
        thumbnailer: Thumbnailer(cacheDir: URL(fileURLWithPath: tempFile("thumbs"))))
    _ = try service.setRoot(path: root.path, indexPath: tempFile("index.sqlite"))
    waitUntilIndexed(service)
    try await waitForPass { try service.stackShoot(shoot: "2026-08-08_dance").running }

    let images = try service.listImages(shoot: "2026-08-08_dance")
    let stack = Dictionary(uniqueKeysWithValues: images.map { ($0.rel, $0.stack) })
    #expect(stack["1.jpg"] == images.first { $0.rel == "1.jpg" }?.path)
    #expect(stack["2.jpg"] == stack["1.jpg"])
    #expect(stack["3.jpg"] == images.first { $0.rel == "3.jpg" }?.path)
    #expect(images.allSatisfy { $0.captured != nil })
}

@Test func aSubsecondThatIsNotDigitsIsIgnored() throws {
    let stamp = "2026:08:08 19:24:28"
    let base = try #require(Dimensions.captureTime(exifDate(stamp, subsec: "0")))
    for junk in ["1e999", "nan", "-5", "12a"] {
        #expect(Dimensions.captureTime(exifDate(stamp, subsec: junk)) == base)
    }
    #expect(Dimensions.captureTime(exifDate(stamp, subsec: " 25 ")) == base + 0.25)
}

@Test func aJPEGsTinyEmbeddedThumbnailIsNotWhatGetsPrinted() throws {
    let url = URL(fileURLWithPath: tempFile("thumbnailed.jpg"))
    defer { try? FileManager.default.removeItem(at: url) }
    try writeJPEG(url, pattern: 3, size: 2048, embedThumbnail: true)

    let source = try #require(CGImageSourceCreateWithURL(url as CFURL, nil))
    let preview = try #require(Printer.preview(source))
    #expect(max(preview.width, preview.height) == Stacker.previewSize)
}

@Test func analysisLoadsOnlyTheOpenLibrary() throws {
    let path = tempFile("index.sqlite")
    defer { try? FileManager.default.removeItem(atPath: path) }
    let index = try SQLiteIndex(path: path)
    let row = Printer.Row(value: Print(feature: [1]), mtime: 1, size: 1, version: 1)
    try index.savePrints([("/lib/a.arw", row), ("/lib2/b.arw", row), ("/li/c.arw", row)])
    #expect(try index.loadPrints(under: "/lib").keys.sorted() == ["/lib/a.arw"])
}
