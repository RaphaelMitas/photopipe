import CoreGraphics
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers

@testable import PhotopipeCoreKit

private func tempFile(_ name: String) -> String {
    URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("photopipe-\(UUID().uuidString)-\(name)").path
}

private let sampleFiles: [String: [ImageFile]] = [
    "2026-07-12_zell": [
        ImageFile(
            path: "/r/2026-07-12_zell/DSC001.ARW", rel: "DSC001.ARW", ext: "ARW",
            size: 10, mtime: 1),
        ImageFile(
            path: "/r/2026-07-12_zell/selects/DSC001.jpg", rel: "selects/DSC001.jpg", ext: "jpg",
            size: 2, mtime: 2),
    ],
    "misc": [
        ImageFile(path: "/r/misc/x.dng", rel: "x.dng", ext: "dng", size: 5, mtime: 3)
    ],
]

// MARK: - SQLite index

@Test func indexRoundTripsSnapshot() throws {
    let path = tempFile("index.sqlite")
    defer { try? FileManager.default.removeItem(atPath: path) }

    let index = try SQLiteIndex(path: path)
    try index.save(root: "/r", filesByShoot: sampleFiles)
    let loaded = try #require(try index.load())
    #expect(loaded.root == "/r")
    #expect(loaded.filesByShoot.count == 2)
    #expect(loaded.filesByShoot["2026-07-12_zell"]?.count == 2)
    let nested = try #require(
        loaded.filesByShoot["2026-07-12_zell"]?.first { $0.rel == "selects/DSC001.jpg" })
    #expect(nested.path == "/r/2026-07-12_zell/selects/DSC001.jpg")
    #expect(nested.ext == "jpg")
    let dng = try #require(loaded.filesByShoot["misc"]?.first)
    #expect(dng.size == 5)
    #expect(dng.mtime == 3)
}

@Test func indexSaveReplacesFully() throws {
    let path = tempFile("index.sqlite")
    defer { try? FileManager.default.removeItem(atPath: path) }

    let index = try SQLiteIndex(path: path)
    try index.save(root: "/r", filesByShoot: sampleFiles)
    try index.save(root: "/r", filesByShoot: ["only": sampleFiles["misc"]!])
    let loaded = try #require(try index.load())
    #expect(loaded.filesByShoot.keys.sorted() == ["only"])
}

@Test func indexSurvivesReopenAcrossInstances() throws {
    let path = tempFile("index.sqlite")
    defer { try? FileManager.default.removeItem(atPath: path) }

    try SQLiteIndex(path: path).save(root: "/r", filesByShoot: sampleFiles)
    let loaded = try #require(try SQLiteIndex(path: path).load())
    #expect(loaded.filesByShoot.count == 2)
}

@Test func emptyIndexLoadsAsNil() throws {
    let path = tempFile("index.sqlite")
    defer { try? FileManager.default.removeItem(atPath: path) }
    #expect(try SQLiteIndex(path: path).load() == nil)
}

@Test func corruptIndexFileIsRecreatedNotFatal() throws {
    let path = tempFile("index.sqlite")
    defer { try? FileManager.default.removeItem(atPath: path) }
    try Data("this is not a sqlite database at all".utf8).write(to: URL(fileURLWithPath: path))

    let index = try SQLiteIndex(path: path)
    #expect(try index.load() == nil)
    try index.save(root: "/r", filesByShoot: sampleFiles)
    #expect(try index.load() != nil)
}

@Test func rootWithQuotesIsEscaped() throws {
    let path = tempFile("index.sqlite")
    defer { try? FileManager.default.removeItem(atPath: path) }
    let index = try SQLiteIndex(path: path)
    try index.save(root: "/r/it's here", filesByShoot: [:])
    #expect(try #require(try index.load()).root == "/r/it's here")
}

// MARK: - Thumbnailer

private func makePNG(width: Int = 64, height: Int = 48) throws -> (ImageFile, URL) {
    let path = tempFile("img.png")
    let url = URL(fileURLWithPath: path)
    let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.setFillColor(CGColor(red: 0.8, green: 0.4, blue: 0.2, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    let image = context.makeImage()!
    let destination = CGImageDestinationCreateWithURL(
        url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, image, nil)
    CGImageDestinationFinalize(destination)
    let attrs = try FileManager.default.attributesOfItem(atPath: path)
    let file = ImageFile(
        path: path, rel: url.lastPathComponent, ext: "png",
        size: (attrs[.size] as? Int64) ?? 0,
        mtime: ((attrs[.modificationDate] as? Date) ?? Date(timeIntervalSince1970: 0)).timeIntervalSince1970)
    return (file, url)
}

@Test func thumbnailGeneratesAndCaches() throws {
    let cacheDir = URL(fileURLWithPath: tempFile("thumbs"))
    let (file, source) = try makePNG()
    defer {
        try? FileManager.default.removeItem(at: cacheDir)
        try? FileManager.default.removeItem(at: source)
    }

    let thumbnailer = Thumbnailer(cacheDir: cacheDir)
    let first = try thumbnailer.thumbnail(for: file, maxPixel: 32)
    #expect(FileManager.default.fileExists(atPath: first.path))
    let producedSource = CGImageSourceCreateWithURL(first as CFURL, nil)
    let produced = try #require(
        producedSource.flatMap { CGImageSourceCreateImageAtIndex($0, 0, nil) })
    #expect(max(produced.width, produced.height) <= 32)

    // Cache hit: same path, file untouched.
    let stamp = try FileManager.default.attributesOfItem(atPath: first.path)[.modificationDate] as? Date
    let second = try thumbnailer.thumbnail(for: file, maxPixel: 32)
    #expect(second == first)
    let stampAfter = try FileManager.default.attributesOfItem(atPath: first.path)[.modificationDate] as? Date
    #expect(stamp == stampAfter)
}

@Test func thumbnailKeyChangesWithMtimeAndSize() throws {
    let thumbnailer = Thumbnailer(cacheDir: URL(fileURLWithPath: tempFile("thumbs")))
    let a = ImageFile(path: "/x.jpg", rel: "x.jpg", ext: "jpg", size: 1, mtime: 1)
    let b = ImageFile(path: "/x.jpg", rel: "x.jpg", ext: "jpg", size: 1, mtime: 2)
    #expect(thumbnailer.cachePath(for: a, maxPixel: 256) != thumbnailer.cachePath(for: b, maxPixel: 256))
    #expect(
        thumbnailer.cachePath(for: a, maxPixel: 256) != thumbnailer.cachePath(for: a, maxPixel: 512))
}

@Test func thumbnailExtractsEmbeddedPreviewFromRealARW() throws {
    let fixture = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // Tests/PhotopipeCoreKitTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // core
        .deletingLastPathComponent()  // repo root
        .appendingPathComponent("fixtures/raw/sony-a7iv.arw")
    guard FileManager.default.fileExists(atPath: fixture.path) else {
        // Locally a missing fixture is a soft skip; CI fetches fixtures first,
        // so there it must fail loudly instead of going silently green.
        #expect(
            ProcessInfo.processInfo.environment["CI"] == nil,
            "real-ARW fixture missing on CI — run fixtures/fetch.sh before swift test")
        print("SKIP: run fixtures/fetch.sh for the real-ARW thumbnail test")
        return
    }
    let attrs = try FileManager.default.attributesOfItem(atPath: fixture.path)
    let file = ImageFile(
        path: fixture.path, rel: fixture.lastPathComponent, ext: "arw",
        size: (attrs[.size] as? Int64) ?? 0,
        mtime: ((attrs[.modificationDate] as? Date) ?? .distantPast).timeIntervalSince1970)

    let cacheDir = URL(fileURLWithPath: tempFile("thumbs"))
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let start = Date()
    let thumb = try Thumbnailer(cacheDir: cacheDir).thumbnail(for: file, maxPixel: 512)
    let elapsed = Date().timeIntervalSince(start)
    #expect(FileManager.default.fileExists(atPath: thumb.path))
    // Embedded-preview extraction must stay far from full raw decode territory.
    #expect(elapsed < 2.0, "ARW thumbnail took \(elapsed)s")
}
