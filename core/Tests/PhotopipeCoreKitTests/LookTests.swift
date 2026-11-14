import CoreImage
import Foundation
import ImageIO
import Testing

@testable import PhotopipeCoreKit

private func decoded(_ shown: Look.Shown) throws -> CGImage {
    let data = try #require(Data(base64Encoded: shown.jpeg))
    let source = try #require(CGImageSourceCreateWithData(data as CFData, nil))
    return try #require(CGImageSourceCreateImageAtIndex(source, 0, nil))
}

private func blueShare(of image: CGImage) -> Double {
    // the average is taken in linear light, so read it out linear
    let mean = meanChannels(
        of: CIImage(cgImage: image), colorSpace: CGColorSpace(name: CGColorSpace.linearSRGB)!)
    return mean.blue / (mean.red + mean.blue)
}

private func withShoot(
    photos: Int, width: Int = 400, height: Int = 200,
    _ body: (LibraryService, [String]) throws -> Void
) throws {
    let root = scratchDir("look")
    let caches = scratchDir("look-caches")
    defer {
        try? FileManager.default.removeItem(at: root)
        try? FileManager.default.removeItem(at: caches)
    }
    let paths = try (1...photos).map { index in
        let url = root.appendingPathComponent("shoot/IMG_\(index).jpg")
        try writeHalvesJPEG(width: width, height: height, at: url)
        return url.path
    }
    let service = makeService(in: caches)
    _ = try service.setRoot(
        path: root.path, indexPath: caches.appendingPathComponent("index.sqlite").path)
    try body(service, paths)
}

@Test func aSheetPutsEveryPhotoOnOneCanvas() throws {
    try withShoot(photos: 5) { service, paths in
        let shown = try service.look(
            paths: paths, edited: true, longEdge: 600, at: nil, sheet: true, maxBytes: 500_000)
        #expect(shown.count == 1)
        let canvas = try decoded(shown[0])
        // five photos take three columns and two rows of 200 px cells
        #expect((canvas.width, canvas.height) == (600, 400))
    }
}

@Test func separateFramesComeBackOnePerPhotoAtTheLongEdgeAsked() throws {
    try withShoot(photos: 2) { service, paths in
        let shown = try service.look(
            paths: paths, edited: true, longEdge: 300, at: nil, sheet: false, maxBytes: 500_000)
        #expect(shown.count == 2)
        let frame = try decoded(shown[0])
        #expect((frame.width, frame.height) == (300, 150))
    }
}

@Test func aSpotShowsNativePixelsAroundItSlidInsideTheFrame() throws {
    try withShoot(photos: 1) { service, paths in
        let shown = try service.look(
            paths: paths, edited: true, longEdge: 256, at: CGPoint(x: 0.95, y: 0.5),
            sheet: false, maxBytes: 500_000)
        let crop = try decoded(shown[0])
        // 256 native px wide, and the 200 px tall frame is all there is
        #expect((crop.width, crop.height) == (256, 200))
        // slid left to fit, so it spans x 144 to 400: 200 of its 256 px are the blue half
        #expect(abs(blueShare(of: crop) - 200.0 / 256) < 0.05)
    }
}

@Test func aLookOverTheLimitIsRefusedBeforeAnythingRenders() throws {
    try withShoot(photos: 1) { service, paths in
        let many = Array(repeating: paths[0], count: Look.separateLimit + 1)
        #expect(throws: Look.LookError.self) {
            try service.look(
                paths: many, edited: true, longEdge: 512, at: nil, sheet: false,
                maxBytes: 500_000)
        }
    }
}

@Test func aFrameOverItsByteShareIsEncodedSmaller() throws {
    try withShoot(photos: 1, width: 1600, height: 1200) { service, paths in
        let roomy = try service.look(
            paths: paths, edited: true, longEdge: 1600, at: nil, sheet: false,
            maxBytes: 5_000_000)
        let tight = try service.look(
            paths: paths, edited: true, longEdge: 1600, at: nil, sheet: false, maxBytes: 1)
        #expect(tight[0].jpeg.count < roomy[0].jpeg.count)
    }
}

@Test func originalsNameTheSidecarPhotopipeActuallyWrites() throws {
    try withShoot(photos: 1) { service, paths in
        #expect(try service.originals(paths: paths)[0].sidecar == nil)
        let sidecar = XMP.sidecarURL(forImagePath: paths[0])
        try Data("<x/>".utf8).write(to: sidecar)
        // a JPEG's is IMG_1.jpg.photopipe.xmp, not the IMG_1.xmp a raw would get
        #expect(try service.originals(paths: paths)[0].sidecar == sidecar.path)
        #expect(throws: LibraryService.ServiceError.self) {
            try service.originals(paths: [paths[0] + "/../../elsewhere.jpg"])
        }
    }
}

@Test func theGridKeepsSheetsRoughlySquare() {
    #expect(Look.grid(count: 6, longEdge: 1500) == (3, 2, 500))
    #expect(Look.grid(count: 48, longEdge: 2100) == (7, 7, 300))
    #expect(Look.grid(count: 1, longEdge: 800) == (1, 1, 800))
}
