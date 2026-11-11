import CoreImage
import Foundation
import Testing
import UniformTypeIdentifiers

@testable import PhotopipeCoreKit

/// Built from the raw value so the tests compile on SDKs without `.version9`.
private func decoder(_ raw: String) -> CIRAWDecoderVersion {
    CIRAWDecoderVersion(rawValue: raw)
}

private func imageFile(for url: URL) throws -> ImageFile {
    let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
    return ImageFile(
        path: url.path, rel: url.lastPathComponent, ext: url.pathExtension.lowercased(),
        size: (attrs[.size] as? Int64) ?? 0,
        mtime: ((attrs[.modificationDate] as? Date) ?? .distantPast).timeIntervalSince1970)
}

private func meanChannels(
    of url: URL, region: CGRect? = nil,
    colorSpace: CGColorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
) throws -> (red: Double, green: Double, blue: Double) {
    guard let image = CIImage(contentsOf: url) else {
        throw Renderer.RenderError.unreadable(url.path)
    }
    let average = image.applyingFilter(
        "CIAreaAverage",
        parameters: [kCIInputExtentKey: CIVector(cgRect: region ?? image.extent)])
    var pixel = [UInt8](repeating: 0, count: 4)
    CIContext().render(
        average, toBitmap: &pixel, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
        format: .RGBA8, colorSpace: colorSpace)
    return (Double(pixel[0]), Double(pixel[1]), Double(pixel[2]))
}

private func meanLuminance(of url: URL, region: CGRect? = nil) throws -> Double {
    let channels = try meanChannels(of: url, region: region)
    return (channels.red + channels.green + channels.blue) / 3
}

private func tempCacheDir() -> URL {
    FileManager.default.temporaryDirectory
        .appendingPathComponent("photopipe-render-tests-\(UUID().uuidString)")
}

private func withExportScratch(_ body: (Renderer, URL) throws -> Void) throws {
    let cacheDir = tempCacheDir()
    let out = tempCacheDir()
    defer {
        try? FileManager.default.removeItem(at: cacheDir)
        try? FileManager.default.removeItem(at: out)
    }
    try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
    try body(Renderer(cacheDir: cacheDir), out)
}

@Test func renderAppliesExposureInRawPipeline() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: fixture)

    let dark = try renderer.render(file: file, edit: Edit(exposure: -2), maxPixel: 800)
    let neutral = try renderer.render(file: file, edit: .identity, maxPixel: 800)
    let bright = try renderer.render(file: file, edit: Edit(exposure: 2), maxPixel: 800)

    let lumDark = try meanLuminance(of: dark)
    let lumNeutral = try meanLuminance(of: neutral)
    let lumBright = try meanLuminance(of: bright)
    #expect(lumDark < lumNeutral, "-2EV (\(lumDark)) should be darker than 0EV (\(lumNeutral))")
    #expect(lumBright > lumNeutral, "+2EV (\(lumBright)) should be brighter than 0EV (\(lumNeutral))")
}

@Test func renderCachesByExposureAndFreshness() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: fixture)

    let first = try renderer.render(file: file, edit: Edit(exposure: 0.5), maxPixel: 800)
    let again = try renderer.render(file: file, edit: Edit(exposure: 0.5), maxPixel: 800)
    #expect(first == again, "same request must hit the cache")

    let other = try renderer.render(file: file, edit: Edit(exposure: 1.0), maxPixel: 800)
    #expect(first != other, "different exposure must be a different cache entry")

    let curved = try renderer.render(
        file: file,
        edit: Edit(curveRGB: [
            CurvePoint(x: 0, y: 0), CurvePoint(x: 0.5, y: 0.6), CurvePoint(x: 1, y: 1),
        ]), maxPixel: 800)
    #expect(curved != first, "a curve must be a different cache entry")

    let stale = ImageFile(
        path: file.path, rel: file.rel, ext: file.ext, size: file.size,
        mtime: file.mtime + 1)
    #expect(
        renderer.cachePath(for: stale, edit: Edit(exposure: 0.5), maxPixel: 800)
            != renderer.cachePath(for: file, edit: Edit(exposure: 0.5), maxPixel: 800),
        "mtime change must invalidate")
}

/// Warm scrubs must stay interactive: ~35ms on real hardware, and 250ms fails
/// the build long before a slider feels broken.
///
/// CI is a GPU-less VM running the whole suite at once, where the same scrub
/// took 2180ms and 3230ms on consecutive runs and a warm render has clocked
/// slower than the cold one it reused, so any stopwatch there measures the
/// runner. The decode count is the invariant under the budget, and it holds
/// on every machine: warm renders reuse the cached CIRAWFilter.
@Test func warmRenderLatencyBudget() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: fixture)

    // The cold render pays for the raw decode and primes the filter LRU.
    let coldStart = Date()
    _ = try renderer.render(file: file, edit: .identity, maxPixel: 2000)
    let cold = Date().timeIntervalSince(coldStart) * 1000

    var times: [Double] = []
    for step in 1...8 {
        let exposure = Double(step) * 0.25 - 1
        let start = Date()
        _ = try renderer.render(file: file, edit: Edit(exposure: exposure), maxPixel: 2000)
        times.append(Date().timeIntervalSince(start) * 1000)
    }
    let median = times.sorted()[times.count / 2]
    print("warm render median \(median)ms, cold \(cold)ms")

    #expect(
        renderer.rawDecodeCount == 1,
        "8 warm renders decoded the raw \(renderer.rawDecodeCount) times: the CIRAWFilter cache is not being reused"
    )
    if ProcessInfo.processInfo.environment["CI"] == nil {
        #expect(median < 250, "warm render median \(median)ms exceeds the 250ms budget")
    }
}

@Test func pruneRemovesOnlyStaleRenders() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let stale = try writeEntry("stale.jpg", in: cacheDir, bytes: 1, hoursAgo: 8 * 24)
    let fresh = try writeEntry("fresh.jpg", in: cacheDir, bytes: 1, hoursAgo: 0)
    let foreign = try writeEntry("notes.txt", in: cacheDir, bytes: 1, hoursAgo: 8 * 24)

    CacheFolder(dir: cacheDir, maxBytes: .max).prune()

    #expect(!FileManager.default.fileExists(atPath: stale.path), "8-day-old render pruned")
    #expect(FileManager.default.fileExists(atPath: fresh.path), "fresh render kept")
    #expect(FileManager.default.fileExists(atPath: foreign.path), "non-render files untouched")
}

@Test func aCacheEntryInUseOutlivesThePrune() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let cache = CacheFolder(dir: cacheDir, maxBytes: .max)
    let entry = try cache.cachedFile(at: cache.url(forKey: "photo")) { try Data("x".utf8).write(to: $0) }
    try backdate(entry, hoursAgo: 8 * 24)

    _ = try cache.cachedFile(at: cache.url(forKey: "photo")) { _ in
        Issue.record("a hit must not rewrite the entry")
    }
    cache.prune()

    #expect(FileManager.default.fileExists(atPath: entry.path), "a hit keeps the entry alive")
}

private func backdate(_ url: URL, hoursAgo: Double) throws {
    try FileManager.default.setAttributes(
        [.modificationDate: Date().addingTimeInterval(-hoursAgo * 3600)], ofItemAtPath: url.path)
}

private func writeEntry(_ name: String, in dir: URL, bytes: Int, hoursAgo: Double) throws -> URL {
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let url = dir.appendingPathComponent(name)
    try Data(count: bytes).write(to: url)
    try backdate(url, hoursAgo: hoursAgo)
    return url
}

@Test func pruneOverBudgetDropsLeastRecentlyServedFirst() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    #expect(CacheFolder(dir: cacheDir, maxBytes: 0).prune() == 0)
    let entries = try (1...5).map {
        try writeEntry("\($0).jpg", in: cacheDir, bytes: 100, hoursAgo: Double($0))
    }
    let inFlight = try writeEntry("tmp-write.jpg", in: cacheDir, bytes: 1000, hoursAgo: 6)

    let left = CacheFolder(dir: cacheDir, maxBytes: 250).prune()

    let survivors = entries.filter { FileManager.default.fileExists(atPath: $0.path) }
    #expect(survivors == Array(entries.prefix(2)), "the two most recently served fit the budget")
    #expect(left == 200)
    #expect(
        FileManager.default.fileExists(atPath: inFlight.path), "an in-flight write is not counted or pruned")
}

@Test func aHitOrTheLastTenMinutesSaveAnEntryFromTheBudgetPrune() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let cache = CacheFolder(dir: cacheDir, maxBytes: 0)
    let served = try writeEntry(
        cache.url(forKey: "served").lastPathComponent, in: cacheDir, bytes: 100, hoursAgo: 2)
    let recent = try writeEntry("recent.jpg", in: cacheDir, bytes: 100, hoursAgo: 9 / 60)
    let other = try writeEntry("other.jpg", in: cacheDir, bytes: 100, hoursAgo: 11 / 60)

    _ = try cache.cachedFile(at: served) { _ in Issue.record("a hit must not rewrite the entry") }
    cache.prune()

    #expect(FileManager.default.fileExists(atPath: served.path), "a hit makes the entry the most recent")
    #expect(
        FileManager.default.fileExists(atPath: recent.path),
        "the webview may still load a path it was just given")
    #expect(!FileManager.default.fileExists(atPath: other.path))
}

@Test func writingPastTheBudgetPrunesWithoutARelaunch() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let cache = CacheFolder(dir: cacheDir, maxBytes: 250)
    let entries = try (1...3).map { index in
        let entry = try cache.cachedFile(at: cache.url(forKey: "\(index)")) {
            try Data(count: 100).write(to: $0)
        }
        if index < 3 { try backdate(entry, hoursAgo: Double(3 - index)) }
        return entry
    }

    cache.pruneQueue.sync {}

    #expect(!FileManager.default.fileExists(atPath: entries[0].path), "the least recently served goes")
    #expect(FileManager.default.fileExists(atPath: entries[1].path))
    #expect(FileManager.default.fileExists(atPath: entries[2].path), "the entry just written stays")
}

@Test func nonRawRenderAdjustsExposureToo() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }

    // Tiny synthetic JPEG: mid-gray via CIContext.
    let gray = CIImage(color: CIColor(red: 0.5, green: 0.5, blue: 0.5))
        .cropped(to: CGRect(x: 0, y: 0, width: 64, height: 64))
    let jpegURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("photopipe-gray-\(UUID().uuidString).jpg")
    defer { try? FileManager.default.removeItem(at: jpegURL) }
    try CIContext().writeJPEGRepresentation(
        of: gray, to: jpegURL, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)

    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: jpegURL)

    let neutral = try renderer.render(file: file, edit: .identity, maxPixel: 64)
    let bright = try renderer.render(file: file, edit: Edit(exposure: 1.5), maxPixel: 64)
    #expect(try meanLuminance(of: bright) > meanLuminance(of: neutral))
}

@Test func aJPEGClaimingAHugeFrameIsUnreadableNotACrash() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let jpegURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("photopipe-huge-\(UUID().uuidString).jpg")
    defer { try? FileManager.default.removeItem(at: jpegURL) }
    let gray = CIImage(color: CIColor(red: 0.5, green: 0.5, blue: 0.5))
        .cropped(to: CGRect(x: 0, y: 0, width: 64, height: 64))
    try CIContext().writeJPEGRepresentation(
        of: gray, to: jpegURL, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)

    var bytes = [UInt8](try Data(contentsOf: jpegURL))
    let sof = try #require(bytes.indices.dropLast().first { bytes[$0] == 0xFF && bytes[$0 + 1] == 0xC0 })
    // 20000 x 20000 in the frame header; the scan data still holds 64 x 64
    bytes.replaceSubrange((sof + 5)...(sof + 8), with: [0x4E, 0x20, 0x4E, 0x20])
    try Data(bytes).write(to: jpegURL)

    let renderer = Renderer(cacheDir: cacheDir)
    #expect(throws: Renderer.RenderError.self) {
        try renderer.render(file: try imageFile(for: jpegURL), edit: .identity, maxPixel: 64)
    }
}

@Test func renderAppliesCropAndStraighten() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }

    let jpegURL = try writeHalvesJPEG()
    defer { try? FileManager.default.removeItem(at: jpegURL) }

    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: jpegURL)

    let cropped = try renderer.render(
        file: file,
        edit: Edit(crop: CropRect(left: 0.5, top: 0, right: 1, bottom: 1)), maxPixel: 64)
    guard let output = CIImage(contentsOf: cropped) else {
        throw Renderer.RenderError.unreadable(cropped.path)
    }
    #expect(output.extent.width == 32)
    #expect(output.extent.height == 64)
    let channels = try meanChannels(of: cropped)
    #expect(channels.blue > 180, "the right half is blue")
    #expect(channels.red < 60, "the red half is cropped away")

    // Angle-only straighten rotates behind the full-frame rect: same size.
    let straightened = try renderer.render(file: file, edit: Edit(cropAngle: 3), maxPixel: 64)
    guard let rotated = CIImage(contentsOf: straightened) else {
        throw Renderer.RenderError.unreadable(straightened.path)
    }
    #expect(rotated.extent.width == 64)
    #expect(rotated.extent.height == 64)

    // Sign convention: +90° turns the photo clockwise on screen, so the red
    // left half must end up as the top half (the high-y rows in CI space).
    let quarter = try renderer.render(file: file, edit: Edit(cropAngle: 90), maxPixel: 64)
    let top = try meanChannels(
        of: quarter, region: CGRect(x: 0, y: 40, width: 64, height: 24))
    #expect(top.red > 180, "clockwise 90° puts the red left half on top, got \(top)")
    #expect(top.blue < 60, "blue must have rotated to the bottom, got \(top)")
}

private func redBitmap(size: Int = 256, _ value: (Int, Int) -> Double) -> CIImage {
    let pixels = (0..<size * size).map { Float(value($0 % size, $0 / size)) }
    return CIImage(
        bitmapData: pixels.withUnsafeBufferPointer { Data(buffer: $0) }, bytesPerRow: size * 4,
        size: CGSize(width: size, height: size), format: .Rf, colorSpace: nil)
}

private func linearRed(of image: CIImage) -> [Float] {
    let width = Int(image.extent.width)
    var pixels = [Float](repeating: 0, count: width * Int(image.extent.height))
    CIContext().render(
        image, toBitmap: &pixels, rowBytes: width * 4, bounds: image.extent, format: .Rf,
        colorSpace: CGColorSpace(name: CGColorSpace.extendedLinearSRGB))
    return pixels
}

private func contrast(_ values: [Float]) -> Float {
    let mean = values.reduce(0, +) / Float(values.count)
    return (values.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Float(values.count)).squareRoot()
}

@Test func straighteningKeepsFineDetailWithoutRinging() {
    let middle = CropRect(left: 0.25, top: 0.25, right: 0.75, bottom: 0.75)
    func straightened(_ image: CIImage, by angle: Double) -> [Float] {
        linearRed(of: Renderer.applyCrop(Edit(crop: middle, cropAngle: angle), to: image))
    }

    // bilinear sampling keeps 0.77 of a wave four pixels long
    let wave = redBitmap { x, y in 0.5 + 0.4 * sin(2 * .pi * (0.25 * Double(x) + 0.11 * Double(y))) }
    let kept = contrast(straightened(wave, by: 0.5)) / contrast(straightened(wave, by: 0))
    #expect(kept > 0.88, "a straightened photo keeps its fine detail, got \(kept)")

    let stripes = redBitmap { x, _ in x % 4 < 2 ? 1 : 0 }
    let turned = straightened(stripes, by: 0.5)
    #expect(turned.allSatisfy { (0...1).contains($0) }, "a hard edge must not overshoot")
}

@Test func anAngleTooLargeToTurnIsNoCrop() {
    #expect(Renderer.saneCrop(Edit(cropAngle: 1e308)) == nil)
}

@Test func rotationTurnsClockwiseAndCropFollowsTheTurnedFrame() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }

    let jpegURL = try writeHalvesJPEG()
    defer { try? FileManager.default.removeItem(at: jpegURL) }

    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: jpegURL)

    // 90° clockwise puts the red left half on top; cropping the top half of
    // the TURNED frame must keep it.
    let turned = try renderer.render(
        file: file,
        edit: Edit(crop: CropRect(left: 0, top: 0, right: 1, bottom: 0.5), rotation: 90),
        maxPixel: 64)
    guard let output = CIImage(contentsOf: turned) else {
        throw Renderer.RenderError.unreadable(turned.path)
    }
    #expect(output.extent.width == 64)
    #expect(output.extent.height == 32)
    let channels = try meanChannels(of: turned)
    #expect(channels.red > 180, "the turned frame's top half is red, got \(channels)")
    #expect(channels.blue < 60)
}

@Test func cropFollowsExifOrientation() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }

    // Stored 64x32 (left red, right blue), tagged Orientation=6: displays as
    // 32x64 tall with red on top. Cropping the display's top half must keep
    // the red — not a side band of the sensor layout.
    let flat = try writeHalvesJPEG(width: 64, height: 32)
    let jpegURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("photopipe-orient6-\(UUID().uuidString).jpg")
    defer {
        try? FileManager.default.removeItem(at: flat)
        try? FileManager.default.removeItem(at: jpegURL)
    }
    guard let source = CGImageSourceCreateWithURL(flat as CFURL, nil),
        let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil),
        let destination = CGImageDestinationCreateWithURL(
            jpegURL as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
    else { throw Renderer.RenderError.unreadable(flat.path) }
    CGImageDestinationAddImage(
        destination, cgImage, [kCGImagePropertyOrientation: 6] as CFDictionary)
    CGImageDestinationFinalize(destination)

    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: jpegURL)
    let cropped = try renderer.render(
        file: file,
        edit: Edit(crop: CropRect(left: 0, top: 0, right: 1, bottom: 0.5)), maxPixel: 64)
    guard let output = CIImage(contentsOf: cropped) else {
        throw Renderer.RenderError.unreadable(cropped.path)
    }
    #expect(output.extent.width == 32)
    #expect(output.extent.height == 32)
    let channels = try meanChannels(of: cropped)
    #expect(channels.red > 180, "the display-space top half is red")
    #expect(channels.blue < 60)
}

private func writeSyntheticJPEG(
    color: CIColor, width: Int = 64, height: Int = 64,
    colorSpace: CGColorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
) throws -> URL {
    let image = CIImage(color: color).cropped(to: CGRect(x: 0, y: 0, width: width, height: height))
    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("photopipe-synth-\(UUID().uuidString).jpg")
    try CIContext().writeJPEGRepresentation(of: image, to: url, colorSpace: colorSpace)
    return url
}

private func writeHalvesJPEG(
    left: CIColor = CIColor(red: 1, green: 0, blue: 0),
    right: CIColor = CIColor(red: 0, green: 0, blue: 1),
    width: Int = 64, height: Int = 64
) throws -> URL {
    let leftHalf = CIImage(color: left)
        .cropped(to: CGRect(x: 0, y: 0, width: width, height: height))
    let rightHalf = CIImage(color: right)
        .cropped(to: CGRect(x: width / 2, y: 0, width: width / 2, height: height))
    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("photopipe-halves-\(UUID().uuidString).jpg")
    try CIContext().writeJPEGRepresentation(
        of: rightHalf.composited(over: leftHalf), to: url,
        colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
    return url
}

private func gray(_ value: CGFloat) -> CIColor {
    CIColor(red: value, green: value, blue: value)
}

/// Step across the seam of a 256 px halves render.
private func seamContrast(of url: URL) throws -> Double {
    let left = try meanLuminance(of: url, region: CGRect(x: 120, y: 0, width: 8, height: 256))
    let right = try meanLuminance(of: url, region: CGRect(x: 128, y: 0, width: 8, height: 256))
    return right - left
}

@Test func dehazeLiftsTheVeilAndNegativeAddsIt() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    // a veiled scene: two tones squeezed toward one bright, flat gray
    let jpegURL = try writeHalvesJPEG(left: gray(0.55), right: gray(0.7), width: 256, height: 256)
    defer { try? FileManager.default.removeItem(at: jpegURL) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: jpegURL)
    let render = { (edit: Edit) in try renderer.render(file: file, edit: edit, maxPixel: 256) }

    let neutral = try seamContrast(of: render(.identity))
    let cleared = try seamContrast(of: render(Edit(dehaze: 80)))
    let veiled = try seamContrast(of: render(Edit(dehaze: -80)))
    #expect(cleared > neutral + 10, "dehaze +80 must spread the tones apart, got \(neutral) → \(cleared)")
    #expect(veiled < neutral - 5, "dehaze -80 must squeeze them together, got \(neutral) → \(veiled)")
}

@Test func coarseEstimatesLeaveNoBandAlongTheEdge() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    // 3:2 at this size shrinks to a fractional row count for the coarse copy;
    // two tones, because on flat gray dehaze cancels out whatever the veil says
    let jpegURL = try writeHalvesJPEG(
        left: gray(0.55), right: gray(0.7), width: 3000, height: 2000)
    defer { try? FileManager.default.removeItem(at: jpegURL) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: jpegURL)

    for edit in [Edit(clarity: 100), Edit(dehaze: 80), Edit(highlights: -100, shadows: 100)] {
        let url = try renderer.render(file: file, edit: edit, maxPixel: 3000)
        let band = { (y: Int) in
            try meanLuminance(of: url, region: CGRect(x: 0, y: y, width: 1400, height: 16))
        }
        let top = try band(1984)
        let bottom = try band(0)
        let middle = try band(992)
        #expect(abs(top - middle) < 1.5, "the top must match the middle, got \(top) vs \(middle)")
        #expect(abs(bottom - middle) < 1.5, "and the bottom, got \(bottom) vs \(middle)")
    }
}

@Test func dehazeLeavesNoHaloAlongASilhouetteInAnyViewport() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let jpegURL = try writeHalvesJPEG(left: gray(0.2), right: gray(0.7), width: 1500, height: 1000)
    defer { try? FileManager.default.removeItem(at: jpegURL) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: jpegURL)

    let whole = try renderer.render(file: file, edit: Edit(dehaze: 100), maxPixel: 1500)
    let band = { (x: Int) in
        try meanLuminance(of: whole, region: CGRect(x: x, y: 0, width: 16, height: 1000))
    }
    let beside = try band(728)
    let away = try band(300)
    #expect(
        abs(beside - away) < 3,
        "the silhouette must be as dark at the sky's edge as away from it, got \(beside) vs \(away)")

    // a viewport that sees no sky still clears against the sky's haze
    let silhouette = try renderer.render(
        file: file, edit: Edit(dehaze: 100), maxPixel: 1000,
        viewport: CropRect(left: 0, top: 0, right: 0.4, bottom: 1))
    let zoomed = try meanLuminance(of: silhouette)
    #expect(abs(zoomed - away) < 2, "a viewport must match the whole frame, got \(zoomed) vs \(away)")
}

@Test func dehazeLeavesNoRimInTheSkyBesideASilhouette() {
    let frame = CGRect(x: 0, y: 0, width: 1500, height: 1000)
    let sky = CGRect(x: 0, y: 0, width: 1500, height: 700)
    let silhouette = CGRect(x: 0, y: 0, width: 750, height: 700)
    // the bright band above takes the airlight, so the sky is haze that clears
    let scene = CIImage(color: gray(0.2)).cropped(to: silhouette)
        .composited(over: CIImage(color: gray(0.6)).cropped(to: sky))
        .composited(over: CIImage(color: gray(0.8)).cropped(to: frame))
    let dehazed = Presence.dehaze(scene, amount: 100)
    let cleared = { (x: CGFloat) in
        linearPixels(of: dehazed, in: CGRect(x: x, y: 300, width: 1, height: 1))[0]
    }
    let beside = cleared(758)
    let away = cleared(1250)
    #expect(
        beside - away < 0.04,
        "the sky must clear as far at the silhouette as away from it, got \(beside) vs \(away)")
}

@Test func dehazeTakesNoCastFromABrightColour() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let jpegURL = try writeHalvesJPEG(
        left: gray(0.6), right: CIColor(red: 0.3, green: 0.3, blue: 1), width: 256, height: 256)
    defer { try? FileManager.default.removeItem(at: jpegURL) }
    let renderer = Renderer(cacheDir: cacheDir)
    let haze = try meanChannels(
        of: renderer.render(file: imageFile(for: jpegURL), edit: Edit(dehaze: 100), maxPixel: 256),
        region: CGRect(x: 0, y: 0, width: 96, height: 256))
    #expect(
        abs(haze.red - haze.blue) < 3,
        "gray haze beside a blue wall must stay gray, got \(haze)")
}

@Test func dehazeDoesNotBrightenASceneOfTwoColours() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let jpegURL = try writeHalvesJPEG(
        left: CIColor(red: 0.95, green: 0.63, blue: 0.31), right: CIColor(red: 0.35, green: 0.48, blue: 0.67),
        width: 256, height: 256)
    defer { try? FileManager.default.removeItem(at: jpegURL) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: jpegURL)
    let water = { (edit: Edit) in
        try meanLuminance(
            of: renderer.render(file: file, edit: edit, maxPixel: 256),
            region: CGRect(x: 160, y: 0, width: 96, height: 256))
    }
    let plain = try water(Edit())
    let dehazed = try water(Edit(dehaze: 100))
    #expect(
        dehazed < plain + 2,
        "blue water beside an orange sky must not brighten, got \(dehazed) from \(plain)")
}

// a sidecar may ask for more than the slider reaches
@Test(arguments: [100.0, 400]) func dehazeStaysBetweenBlackAndWhite(amount: Double) {
    let frame = CGRect(x: 0, y: 0, width: 1000, height: 600)
    // the cloud is smaller than the dark channel's patch, so it stays above the airlight
    let scene = CIImage(color: gray(0.98))
        .cropped(to: CGRect(x: 500, y: 400, width: 12, height: 12))
        .composited(over: CIImage(color: gray(0.15)).cropped(to: frame.insetBy(dx: 0, dy: 200)))
        .composited(over: CIImage(color: gray(0.75)).cropped(to: frame))
    let pixels = linearPixels(of: Presence.dehaze(scene, amount: amount), in: frame)
    let darkest = pixels.min() ?? 0
    let brightest = pixels.max() ?? 0
    #expect(darkest > -0.001, "no channel may fall below black, got \(darkest)")
    #expect(brightest < 1.001, "and none may pass white, got \(brightest)")
}

@Test func dehazeLeavesAFlatFieldAsItWas() {
    let frame = CGRect(x: 0, y: 0, width: 512, height: 512)
    let corner = CGRect(x: 0, y: 0, width: 1, height: 1)
    let change = { (scene: CIImage) in
        linearPixels(of: Presence.dehaze(scene, amount: 100), in: corner)[0]
            - linearPixels(of: scene, in: corner)[0]
    }
    let dim = change(CIImage(color: gray(0.2)).cropped(to: frame))
    #expect(abs(dim) < 0.002, "a dim field is its own airlight, moved \(dim)")

    // far above white, the way a stray pixel in a float TIFF is
    let stray: [Float] = [60000, 60000, 60000, 1]
    let glint = change(
        CIImage(
            bitmapData: Data(bytes: stray, count: 16), bytesPerRow: 16,
            size: CGSize(width: 1, height: 1), format: .RGBAf, colorSpace: nil
        )
        .transformed(by: CGAffineTransform(translationX: 300, y: 300))
        .composited(over: CIImage(color: gray(0.6)).cropped(to: frame)))
    #expect(abs(glint) < 0.01, "one stray pixel must not move the airlight, moved \(glint)")
}

private func linearPixels(of image: CIImage, in frame: CGRect) -> [Float] {
    var pixels = [Float](repeating: 0, count: Int(frame.width * frame.height) * 4)
    CIContext().render(
        image, toBitmap: &pixels, rowBytes: Int(frame.width) * 16, bounds: frame, format: .RGBAf,
        colorSpace: nil)
    return pixels
}

@Test func clarityDeepensAndSoftensTheSeam() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let jpegURL = try writeHalvesJPEG(left: gray(0.4), right: gray(0.6), width: 256, height: 256)
    defer { try? FileManager.default.removeItem(at: jpegURL) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: jpegURL)
    let render = { (edit: Edit) in try renderer.render(file: file, edit: edit, maxPixel: 256) }

    let neutral = try seamContrast(of: render(.identity))
    let punchy = try seamContrast(of: render(Edit(clarity: 100)))
    let soft = try seamContrast(of: render(Edit(clarity: -100)))
    #expect(punchy > neutral + 5, "clarity +100 must deepen the seam, got \(neutral) → \(punchy)")
    #expect(soft < neutral - 5, "clarity -100 must soften the seam, got \(neutral) → \(soft)")

    let flat = try meanLuminance(of: render(.identity))
    let flatPunchy = try meanLuminance(of: render(Edit(clarity: 100)))
    #expect(abs(flatPunchy - flat) < 3, "local contrast must not move the overall brightness")
}

@Test func clarityKeepsTheDarkSideOfAHardEdgeAndItsHue() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let jpegURL = try writeHalvesJPEG(
        left: CIColor(red: 0.2, green: 0.25, blue: 0.35),
        right: CIColor(red: 0.9, green: 0.95, blue: 1), width: 256, height: 256)
    defer { try? FileManager.default.removeItem(at: jpegURL) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: jpegURL)
    let render = { (edit: Edit) in try renderer.render(file: file, edit: edit, maxPixel: 256) }

    for (side, x) in [("dark", 124), ("light", 128)] {
        let halo = CGRect(x: x, y: 0, width: 4, height: 256)
        let neutral = try meanChannels(of: render(.identity), region: halo)
        let punchy = try meanChannels(of: render(Edit(clarity: 100)), region: halo)
        #expect(
            punchy.red > neutral.red * 0.5,
            "the \(side) side must not crush, got red \(neutral.red) → \(punchy.red)")
        let hueShift = (punchy.red / punchy.blue) / (neutral.red / neutral.blue)
        #expect(
            abs(hueShift - 1) < 0.15,
            "the \(side) side must keep its hue, got \(neutral) → \(punchy)")
    }
}

@Test func clarityKeepsAHighlightFarOverWhiteBesideBlack() {
    // an HDR highlight: its luma unclipped drives Metal's tanh past 44, to NaN
    let halves = redBitmap { x, _ in x < 128 ? 0 : 4096 }
    let highlight = linearRed(of: Presence.clarity(halves, amount: 100))
        .enumerated().filter { $0.offset % 256 >= 128 }.map(\.element)
    #expect(highlight.allSatisfy { $0 >= 1 }, "the highlight must stay over white")
}

private func writeStripesPNG(stripe: Int) throws -> URL {
    let stripes = CIFilter(
        name: "CIStripesGenerator",
        parameters: [
            "inputColor0": gray(0.4), "inputColor1": gray(0.6), "inputWidth": stripe,
            "inputSharpness": 1, kCIInputCenterKey: CIVector(x: 0, y: 0),
        ])!.outputImage!
    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("photopipe-stripes-\(UUID().uuidString).png")
    try CIContext().writePNGRepresentation(
        of: stripes.cropped(to: CGRect(x: 0, y: 0, width: 3000, height: 256)), to: url,
        format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
    return url
}

@Test func textureWorksAMiddleBandAndLeavesTheFinestDetail() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    let contrast = { (stripe: Int, edit: Edit) in
        let pngURL = try writeStripesPNG(stripe: stripe)
        defer { try? FileManager.default.removeItem(at: pngURL) }
        let url = try renderer.render(file: imageFile(for: pngURL), edit: edit, maxPixel: 3000)
        let column = { (x: Int) in
            try meanLuminance(of: url, region: CGRect(x: x, y: 0, width: stripe, height: 256))
        }
        return abs(try column(1500) - column(1500 + stripe))
    }

    // a pixel wide is where noise and capture sharpening live; 6 px sits mid-band at this size
    let fine = try contrast(1, .identity)
    let mid = try contrast(6, .identity)
    let crispFine = try contrast(1, Edit(texture: 100))
    let crispMid = try contrast(6, Edit(texture: 100))
    #expect(crispMid > mid * 1.4, "texture +100 must lift mid detail, got \(mid) → \(crispMid)")
    #expect(crispFine < fine * 1.2, "and leave the finest alone, got \(fine) → \(crispFine)")

    let smoothFine = try contrast(1, Edit(texture: -100))
    let smoothMid = try contrast(6, Edit(texture: -100))
    #expect(smoothMid < mid * 0.5, "texture -100 must smooth mid detail, got \(mid) → \(smoothMid)")
    #expect(smoothFine > fine * 0.8, "and keep the finest, got \(fine) → \(smoothFine)")
}

@Test func temperatureWarmsAndTintShiftsMagenta() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let jpegURL = try writeSyntheticJPEG(color: CIColor(red: 0.5, green: 0.5, blue: 0.5))
    defer { try? FileManager.default.removeItem(at: jpegURL) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: jpegURL)

    let neutral = try meanChannels(of: renderer.render(file: file, edit: .identity, maxPixel: 64))
    let warm = try meanChannels(
        of: renderer.render(file: file, edit: Edit(temperature: 80), maxPixel: 64))
    let magenta = try meanChannels(
        of: renderer.render(file: file, edit: Edit(tint: 80), maxPixel: 64))

    #expect(
        warm.red - warm.blue > neutral.red - neutral.blue + 5,
        "positive temperature must warm the image, got neutral \(neutral) warm \(warm)")
    #expect(
        (magenta.red + magenta.blue) / 2 - magenta.green
            > (neutral.red + neutral.blue) / 2 - neutral.green + 5,
        "positive tint must shift green toward magenta, got neutral \(neutral) tinted \(magenta)")
}

@Test func temperatureCoolsAsFarAsItWarms() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let jpegURL = try writeSyntheticJPEG(color: gray(0.5))
    defer { try? FileManager.default.removeItem(at: jpegURL) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: jpegURL)
    let redOverBlue = { (temperature: Double) in
        let channels = try meanChannels(
            of: renderer.render(file: file, edit: Edit(temperature: temperature), maxPixel: 64))
        return log(channels.red / channels.blue)
    }

    let warmed = try redOverBlue(50)
    let cooled = try -redOverBlue(-50)
    #expect(warmed > 0.05)
    #expect(
        abs(warmed - cooled) < 0.15 * warmed,
        "+50 and -50 must move red against blue equally far, got \(warmed) and \(cooled)")
}

@Test func brighteningANonRawRollsOffInsteadOfClipping() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let highlightsURL = try writeHalvesJPEG(left: gray(0.8), right: gray(1), width: 256, height: 256)
    let skyURL = try writeSyntheticJPEG(color: CIColor(red: 0.35, green: 0.55, blue: 0.9))
    defer {
        try? FileManager.default.removeItem(at: highlightsURL)
        try? FileManager.default.removeItem(at: skyURL)
    }
    let renderer = Renderer(cacheDir: cacheDir)

    let detail = try seamContrast(
        of: renderer.render(
            file: imageFile(for: highlightsURL), edit: Edit(exposure: 1), maxPixel: 256))
    #expect(detail > 8, "+1 EV must keep bright gray apart from white, got a step of \(detail)")

    let sky = try meanChannels(
        of: renderer.render(file: imageFile(for: skyURL), edit: Edit(exposure: 2), maxPixel: 64))
    #expect(sky.blue > sky.green + 10, "+2 EV must leave a blue sky blue, not cyan, got \(sky)")
}

@Test func shadowsAndHighlightsBendTheToneScale() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let darkURL = try writeSyntheticJPEG(color: CIColor(red: 0.2, green: 0.2, blue: 0.2))
    let brightURL = try writeSyntheticJPEG(color: CIColor(red: 0.8, green: 0.8, blue: 0.8))
    defer {
        try? FileManager.default.removeItem(at: darkURL)
        try? FileManager.default.removeItem(at: brightURL)
    }
    let renderer = Renderer(cacheDir: cacheDir)
    let dark = try imageFile(for: darkURL)
    let bright = try imageFile(for: brightURL)

    let darkNeutral = try meanLuminance(of: renderer.render(file: dark, edit: .identity, maxPixel: 64))
    let darkLifted = try meanLuminance(
        of: renderer.render(file: dark, edit: Edit(shadows: 80), maxPixel: 64))
    #expect(darkLifted > darkNeutral + 5, "shadows +80 must lift dark tones")

    let brightNeutral = try meanLuminance(
        of: renderer.render(file: bright, edit: .identity, maxPixel: 64))
    let brightRecovered = try meanLuminance(
        of: renderer.render(file: bright, edit: Edit(highlights: -80), maxPixel: 64))
    #expect(brightRecovered < brightNeutral - 5, "highlights -80 must pull bright tones down")
}

@Test func shadowsAndHighlightsKeepTheDetailTheyMove() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let stripes = CIFilter(
        name: "CIStripesGenerator",
        parameters: [
            "inputColor0": gray(0.35), "inputColor1": gray(0.45), "inputWidth": 8,
            "inputCenter": CIVector(x: 0, y: 0),
        ]
    )!.outputImage!.cropped(to: CGRect(x: 0, y: 0, width: 256, height: 256))
    let jpegURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("photopipe-stripes-\(UUID().uuidString).jpg")
    try CIContext().writeJPEGRepresentation(
        of: stripes, to: jpegURL, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
    defer { try? FileManager.default.removeItem(at: jpegURL) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: jpegURL)

    let neutral = try abs(
        seamContrast(of: renderer.render(file: file, edit: .identity, maxPixel: 256)))
    let moved = try abs(
        seamContrast(
            of: renderer.render(
                file: file, edit: Edit(highlights: -100, shadows: 100), maxPixel: 256)))
    #expect(neutral > 15)
    #expect(
        moved > neutral * 0.9,
        "texture inside one region must survive both sliders, got \(neutral) → \(moved)")
}

@Test func shadowsAndHighlightsStopAtAHardEdge() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let jpegURL = try writeHalvesJPEG(left: gray(0.15), right: gray(0.85), width: 512, height: 256)
    defer { try? FileManager.default.removeItem(at: jpegURL) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: jpegURL)

    let url = try renderer.render(
        file: file, edit: Edit(highlights: -100, shadows: 100), maxPixel: 512)
    let strip = { (x: Int) in
        try meanLuminance(of: url, region: CGRect(x: x, y: 0, width: 8, height: 256))
    }
    let darkHalo = try abs(strip(244) - strip(100))
    let brightHalo = try abs(strip(260) - strip(404))
    #expect(darkHalo < 20, "the dark side must be as lifted beside the edge as away from it")
    #expect(brightHalo < 20, "and the bright side as recovered, got \(darkHalo) and \(brightHalo)")
}

@Test func shadowsAndHighlightsKeepTheHue() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    func saturation(_ channels: (red: Double, green: Double, blue: Double)) -> Double {
        let high = max(channels.red, channels.green, channels.blue)
        return (high - min(channels.red, channels.green, channels.blue)) / high
    }

    let skin = CIColor(red: 0.3, green: 0.19, blue: 0.15)
    let sky = CIColor(red: 0.42, green: 0.62, blue: 0.85)
    for (color, edit) in [(skin, Edit(shadows: 100)), (sky, Edit(highlights: -100))] {
        let jpegURL = try writeSyntheticJPEG(color: color)
        defer { try? FileManager.default.removeItem(at: jpegURL) }
        let file = try imageFile(for: jpegURL)
        let neutral = try meanChannels(
            of: renderer.render(file: file, edit: .identity, maxPixel: 64))
        let moved = try meanChannels(of: renderer.render(file: file, edit: edit, maxPixel: 64))
        #expect(abs(moved.green - neutral.green) > 20, "the tone must move")
        #expect(
            abs(saturation(moved) - saturation(neutral)) < 0.04,
            "without the colour washing out or deepening, got \(neutral) → \(moved)")
    }
}

@Test func whitesAndBlacksRenderAgainstTheEndPoints() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let nearBlackURL = try writeSyntheticJPEG(color: CIColor(red: 0.12, green: 0.12, blue: 0.12))
    let brightURL = try writeSyntheticJPEG(color: CIColor(red: 0.9, green: 0.9, blue: 0.9))
    defer {
        try? FileManager.default.removeItem(at: nearBlackURL)
        try? FileManager.default.removeItem(at: brightURL)
    }
    let renderer = Renderer(cacheDir: cacheDir)
    let nearBlack = try imageFile(for: nearBlackURL)
    let bright = try imageFile(for: brightURL)

    let blackNeutral = try meanLuminance(
        of: renderer.render(file: nearBlack, edit: .identity, maxPixel: 64))
    let crushed = try meanLuminance(
        of: renderer.render(file: nearBlack, edit: Edit(blacks: -80), maxPixel: 64))
    #expect(crushed < blackNeutral - 5, "blacks -80 must crush the near-blacks")

    let brightNeutral = try meanLuminance(
        of: renderer.render(file: bright, edit: .identity, maxPixel: 64))
    let blown = try meanLuminance(
        of: renderer.render(file: bright, edit: Edit(whites: 80), maxPixel: 64))
    #expect(blown > brightNeutral + 5, "whites +80 must push the brights toward white")
}

@Test func saturationAndVibranceMoveColorfulness() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let jpegURL = try writeSyntheticJPEG(color: CIColor(red: 0.6, green: 0.4, blue: 0.4))
    defer { try? FileManager.default.removeItem(at: jpegURL) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: jpegURL)

    func spread(_ channels: (red: Double, green: Double, blue: Double)) -> Double {
        max(channels.red, channels.green, channels.blue)
            - min(channels.red, channels.green, channels.blue)
    }
    let neutral = try meanChannels(of: renderer.render(file: file, edit: .identity, maxPixel: 64))
    let muted = try meanChannels(
        of: renderer.render(file: file, edit: Edit(saturation: -100), maxPixel: 64))
    let vivid = try meanChannels(
        of: renderer.render(file: file, edit: Edit(vibrance: 100), maxPixel: 64))
    #expect(spread(muted) < 3, "saturation -100 must be effectively grayscale, got \(muted)")
    #expect(spread(vivid) > spread(neutral) + 3, "vibrance +100 must add colorfulness")
}

private let skin = [222.0, 170, 140]
private let deepBlue = [65.0, 80, 200]
private let foliage = [120.0, 190, 70]
private let flowerRed = [200.0, 30, 40]
private let paleBlue = [150.0, 170, 200]
private let ultramarine = [20.0, 40, 180]

private func chroma(
    _ srgb: [Double], vibrance: Double = 0, saturation: Double = 0
) -> [Double] {
    chroma(
        CIColor(red: srgb[0] / 255, green: srgb[1] / 255, blue: srgb[2] / 255),
        vibrance: vibrance, saturation: saturation)
}

private func chroma(_ color: CIColor, vibrance: Double = 0, saturation: Double = 0) -> [Double] {
    let image = Presence.chroma(
        CIImage(color: color).cropped(to: CGRect(x: 0, y: 0, width: 1, height: 1)),
        vibrance: vibrance, saturation: saturation)
    var pixel = [Float](repeating: 0, count: 4)
    CIContext().render(
        image, toBitmap: &pixel, rowBytes: 16, bounds: image.extent, format: .RGBAf,
        colorSpace: CGColorSpace(name: CGColorSpace.extendedLinearSRGB))
    return pixel.prefix(3).map(Double.init)
}

private func oklab(_ rgb: [Double]) -> (lightness: Double, chroma: Double, hue: Double) {
    let l = cbrt(0.4122214708 * rgb[0] + 0.5363325363 * rgb[1] + 0.0514459929 * rgb[2])
    let m = cbrt(0.2119034982 * rgb[0] + 0.6806995451 * rgb[1] + 0.1073969566 * rgb[2])
    let s = cbrt(0.0883024619 * rgb[0] + 0.2817188376 * rgb[1] + 0.6299787005 * rgb[2])
    let a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    let b = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return (
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, hypot(a, b),
        atan2(b, a) * 180 / .pi
    )
}

@Test func chromaHoldsHueAndLightnessInsideSRGB() {
    for color in [skin, deepBlue, foliage, flowerRed] {
        let before = oklab(chroma(color))
        for (vibrance, saturation) in [(0.0, 100.0), (0, -50), (100, 0), (-100, 0), (100, 100)] {
            let rgb = chroma(color, vibrance: vibrance, saturation: saturation)
            let after = oklab(rgb)
            let edit = "\(color) at vibrance \(vibrance), saturation \(saturation) gave \(rgb)"
            #expect(abs(after.lightness - before.lightness) < 0.002, "lightness moved: \(edit)")
            #expect(abs(after.hue - before.hue) < 0.5, "hue moved: \(edit)")
            #expect(rgb.allSatisfy { (-0.005...1.005).contains($0) }, "left sRGB: \(edit)")
        }
    }
}

@Test func saturationMinus100IsNeutral() throws {
    for color in [skin, deepBlue, foliage, flowerRed] {
        for vibrance in [0.0, 100] {
            let rgb = chroma(color, vibrance: vibrance, saturation: -100)
            #expect(
                try #require(rgb.max()) - #require(rgb.min()) < 1e-5,
                "\(color) kept a tint at vibrance \(vibrance)")
        }
    }
}

@Test func saturationPlus100NearlyDoublesAFaintColour() {
    let gain = oklab(chroma(paleBlue, saturation: 100)).chroma / oklab(chroma(paleBlue)).chroma
    #expect((1.7...2.05).contains(gain), "pale blue gained x\(gain)")
}

@Test func oklabRoundTripSurvivesNegativeComponents() throws {
    let wideGamut = [0.01, -0.004, 0.002]
    let linear = try #require(CGColorSpace(name: CGColorSpace.extendedLinearSRGB))
    let color = try #require(
        CIColor(red: wideGamut[0], green: wideGamut[1], blue: wideGamut[2], colorSpace: linear))
    let rgb = chroma(color)
    #expect(zip(rgb, wideGamut).allSatisfy { abs($0 - $1) < 1e-4 }, "came back as \(rgb)")
}

@Test func vibranceFavoursFaintColoursAndSparesSkin() {
    func added(_ color: [Double], vibrance: Double) -> Double {
        oklab(chroma(color, vibrance: vibrance)).chroma / oklab(chroma(color)).chroma - 1
    }
    #expect(
        added(paleBlue, vibrance: 10) > 3 * added(deepBlue, vibrance: 10),
        "a pale blue must gain more than a deep one")
    #expect(
        added(skin, vibrance: 100) < added(skin.reversed(), vibrance: 100) - 0.15,
        "skin must gain less than its blue mirror")
}

@Test func moreSliderNeverMeansLessColour() {
    let saturated = stride(from: 0.0, through: 100, by: 20).map {
        oklab(chroma(ultramarine, saturation: $0)).chroma
    }
    #expect(
        zip(saturated, saturated.dropFirst()).allSatisfy(<),
        "ultramarine lost chroma along saturation: \(saturated)")
    #expect(
        oklab(chroma(deepBlue, vibrance: 100, saturation: 100)).chroma
            > oklab(chroma(deepBlue, saturation: 100)).chroma,
        "vibrance on top of saturation took colour away")
    #expect(
        oklab(chroma(paleBlue, vibrance: -50)).chroma < oklab(chroma(paleBlue)).chroma,
        "negative vibrance added colour")
}

@Test func rgbCurveBrightensMidtones() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let jpegURL = try writeSyntheticJPEG(color: CIColor(red: 0.5, green: 0.5, blue: 0.5))
    defer { try? FileManager.default.removeItem(at: jpegURL) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: jpegURL)

    let neutral = try meanLuminance(of: renderer.render(file: file, edit: .identity, maxPixel: 64))
    let lifted = try meanLuminance(
        of: renderer.render(
            file: file,
            edit: Edit(curveRGB: [
                CurvePoint(x: 0, y: 0), CurvePoint(x: 0.5, y: 0.7), CurvePoint(x: 1, y: 1),
            ]), maxPixel: 64))
    let redOnly = try meanChannels(
        of: renderer.render(
            file: file,
            edit: Edit(curveRed: [
                CurvePoint(x: 0, y: 0), CurvePoint(x: 0.5, y: 0.7), CurvePoint(x: 1, y: 1),
            ]), maxPixel: 64))
    #expect(lifted > neutral + 10, "midtone lift in the RGB curve must brighten")
    #expect(
        redOnly.red > redOnly.green + 10,
        "a red-channel curve must only move red, got \(redOnly)")
}

@Test func aToneCurveKeepsColorsOutsideSRGB() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let displayP3 = CGColorSpace(name: CGColorSpace.displayP3)!
    let green = try #require(CIColor(red: 0.1, green: 0.9, blue: 0.1, colorSpace: displayP3))
    let jpegURL = try writeSyntheticJPEG(color: green, colorSpace: displayP3)
    defer { try? FileManager.default.removeItem(at: jpegURL) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: jpegURL)

    let neutral = try meanChannels(
        of: renderer.render(file: file, edit: .identity, maxPixel: 64), colorSpace: displayP3)
    let curved = try meanChannels(
        of: renderer.render(
            file: file,
            edit: Edit(curveRGB: [
                CurvePoint(x: 0, y: 0), CurvePoint(x: 0.5, y: 0.51), CurvePoint(x: 1, y: 1),
            ]), maxPixel: 64), colorSpace: displayP3)
    #expect(neutral.red < 40, "the source green must sit outside sRGB, got \(neutral)")
    #expect(
        curved.red < neutral.red + 10,
        "a near-identity curve must not pull the green into sRGB, got \(curved)")
}

@Test func rawWhiteBalanceIsAsShotAndAdjustable() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: fixture)

    let asShot = try #require(try renderer.rawDefaults(for: file))
    #expect(asShot.temperature > 1500 && asShot.temperature < 20000, "plausible Kelvin")

    let neutral = try meanChannels(of: renderer.render(file: file, edit: .identity, maxPixel: 400))
    let warm = try meanChannels(
        of: renderer.render(
            file: file, edit: Edit(temperature: asShot.temperature + 4000), maxPixel: 400))
    #expect(
        warm.red - warm.blue > neutral.red - neutral.blue + 5,
        "raising the neutral temperature must warm the raw render")

    let backToNeutral = try meanChannels(
        of: renderer.render(file: file, edit: Edit(exposure: 0.001), maxPixel: 400))
    #expect(
        abs((backToNeutral.red - backToNeutral.blue) - (neutral.red - neutral.blue)) < 3,
        "nil temperature must reset the cached filter to as-shot white balance")

    let jpegURL = try writeSyntheticJPEG(color: CIColor(red: 0.5, green: 0.5, blue: 0.5))
    defer { try? FileManager.default.removeItem(at: jpegURL) }
    #expect(try renderer.rawDefaults(for: imageFile(for: jpegURL)) == nil)
}

/// Older Macs top out at RAW 8, which is already a fresh filter's default, so
/// the opt-in is only observable where a newer version exists. Asserting the
/// resolved version holds everywhere; asserting it *changed* does not.
@Test func newestDecoderVersionIsUsed() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)

    let fresh = try #require(CIRAWFilter(imageURL: fixture))
    let newest = try #require(fresh.supportedDecoderVersions.last)
    let ours = try renderer.makeFilter(for: try imageFile(for: fixture)).filter

    #expect(ours.decoderVersion == newest)
    if fresh.decoderVersion == newest {
        print("NOTE: this Mac has no decoder newer than \(newest.rawValue)")
    }
}

@Test func requestedDecoderVersionIsApplied() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: fixture)

    let supported = try #require(CIRAWFilter(imageURL: fixture)).supportedDecoderVersions
    guard supported.contains(decoder("8")) else {
        print("SKIP: fixture does not offer RAW 8")
        return
    }
    let filter = try renderer.makeFilter(for: file, decoderVersion: 8).filter
    #expect(filter.decoderVersion == decoder("8"))
    #expect(filter.outputImage != nil)
}

@Test func unsupportedDecoderRequestFallsBackToNewest() {
    #expect(
        Renderer.resolveDecoder(requested: 9, supported: [decoder("7"), decoder("8")])
            == decoder("8"))
    #expect(
        Renderer.resolveDecoder(requested: 8, supported: [decoder("8.dng"), decoder("9.dng")])
            == decoder("8.dng"))
    #expect(
        Renderer.resolveDecoder(requested: nil, supported: [decoder("8"), decoder("9")])
            == decoder("9"))
    // a DNG-only file still answers a plain RAW 9 request
    #expect(
        Renderer.resolveDecoder(requested: 9, supported: [decoder("8.dng"), decoder("9.dng")])
            == decoder("9.dng"))
    #expect(Renderer.resolveDecoder(requested: 8, supported: []) == nil)
}

@Test func aDecoderThatRendersNothingFallsBackToTheNewestThatDoes() {
    let supported = [decoder("7"), decoder("9")]
    let renders = { (version: CIRAWDecoderVersion) in version != decoder("9") }
    #expect(Renderer.resolveDecoder(requested: 9, supported: supported, renders: renders) == decoder("7"))
    #expect(Renderer.resolveDecoder(requested: nil, supported: supported, renders: renders) == decoder("7"))
    #expect(Renderer.resolveDecoder(requested: 9, supported: supported, renders: { _ in false }) == nil)
}

@Test func decoderVersionSeparatesTheRenderCache() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: fixture)

    let nine = renderer.cachePath(for: file, edit: .identity, maxPixel: 800, decoderVersion: 9)
    let eight = renderer.cachePath(for: file, edit: .identity, maxPixel: 800, decoderVersion: 8)
    let plain = renderer.cachePath(for: file, edit: .identity, maxPixel: 800)
    // Only a decoder this Mac can actually run earns its own key; a request
    // that falls back renders the default, so it shares the default entry.
    // CI runs an older macOS with no RAW 9, which is the whole point.
    if renderer.supports(file: file, major: 9) {
        #expect(nine != plain)
        #expect(nine != eight)
    } else {
        #expect(nine == plain)
    }
    if renderer.supports(file: file, major: 8) {
        #expect(eight != plain)
    }
}

@Test func denoiseOverridesTheDecoderDefault() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: fixture)

    let defaults = try #require(try renderer.rawDefaults(for: file))
    #expect(defaults.denoise > 0, "the decoder's own amount is what nil has to mean")

    // JPEG size stands in for retained grain: less smoothing compresses worse.
    // Native size, since a downscale is itself a denoise.
    let native = Int(max(CIRAWFilter(imageURL: fixture)?.nativeSize.width ?? 0, 1))
    let off = try Data(
        contentsOf: renderer.render(file: file, edit: Edit(denoise: 0), maxPixel: native))
    let full = try Data(
        contentsOf: renderer.render(file: file, edit: Edit(denoise: 100), maxPixel: native))
    #expect(off.count > full.count, "the denoise slider must reach the decoder")
}

/// maxPixel crosses IPC unvalidated, and 0 must not read as "full sensor":
/// that would decode every pixel of a 33MP raw on request, eight at a time.
@Test func nonPositiveMaxPixelIsRefused() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: fixture)

    for maxPixel in [0, -1, Int.min] {
        #expect(throws: (any Error).self) {
            try renderer.render(file: file, edit: .identity, maxPixel: maxPixel)
        }
    }
}

/// Two renders that want the same decode scale must both get it. A cached
/// CIRAWFilter whose scaleFactor was left alone because it already matched
/// handed back a quarter-size decode on the second read.
@Test func aReusedFilterKeepsItsDecodeSize() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: fixture)

    let left = Edit(crop: CropRect(left: 0, top: 0, right: 0.25, bottom: 1))
    let right = Edit(crop: CropRect(left: 0.75, top: 0, right: 1, bottom: 1))
    let first = try #require(
        CIImage(
            contentsOf: renderer.render(
                file: file, edit: left, maxPixel: 400)))
    let second = try #require(
        CIImage(
            contentsOf: renderer.render(
                file: file, edit: right, maxPixel: 400)))

    #expect(
        first.extent.size == second.extent.size,
        "same shape and size asked twice, got \(first.extent.size) then \(second.extent.size)")
    #expect(max(second.extent.width, second.extent.height) > 390)
}

/// The loupe zoomed to a quarter of the frame wants that quarter at 1:1, not
/// the whole sensor. It must cost a fraction of the full-frame render and come
/// back at the size it asked for.
@Test func viewportRendersOnlyTheVisibleRegion() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: fixture)
    let native = Int(max(CIRAWFilter(imageURL: fixture)?.nativeSize.width ?? 0, 1))
    let quarter = CropRect(left: 0.375, top: 0.375, right: 0.625, bottom: 0.625)

    let start = Date()
    let url = try renderer.render(
        file: file, edit: .identity, maxPixel: native / 4, viewport: quarter)
    let regionMs = Date().timeIntervalSince(start) * 1000
    let region = try #require(CIImage(contentsOf: url))
    #expect(
        abs(region.extent.width - Double(native / 4)) < 4,
        "asked for \(native / 4)px of the frame, got \(region.extent.width)")

    let wholeStart = Date()
    _ = try renderer.render(file: file, edit: .identity, maxPixel: native)
    let wholeMs = Date().timeIntervalSince(wholeStart) * 1000
    print("viewport \(Int(regionMs))ms vs whole frame \(Int(wholeMs))ms")
    #expect(
        regionMs < wholeMs,
        "a quarter-frame render (\(Int(regionMs))ms) must beat the whole frame (\(Int(wholeMs))ms)")
}

@Test func viewportComposesOnTopOfTheCrop() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: fixture)

    // The right half of the left half is the second quarter of the frame.
    let leftHalf = Edit(crop: CropRect(left: 0, top: 0, right: 0.5, bottom: 1))
    let rightOfIt = CropRect(left: 0.5, top: 0, right: 1, bottom: 1)
    let composed = try meanChannels(
        of: renderer.render(file: file, edit: leftHalf, maxPixel: 300, viewport: rightOfIt))
    let direct = try meanChannels(
        of: renderer.render(
            file: file, edit: Edit(crop: CropRect(left: 0.25, top: 0, right: 0.5, bottom: 1)),
            maxPixel: 300))
    #expect(
        abs(composed.red - direct.red) < 3 && abs(composed.blue - direct.blue) < 3,
        "viewport must land inside the crop, got \(composed) vs \(direct)")
}

@Test func viewportIsNotAnEdit() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: fixture)
    let region = CropRect(left: 0.1, top: 0.1, right: 0.4, bottom: 0.4)

    #expect(
        renderer.cachePath(for: file, edit: .identity, maxPixel: 800, viewport: region)
            != renderer.cachePath(for: file, edit: .identity, maxPixel: 800),
        "a viewport render must not overwrite the whole-frame entry")
    #expect(
        Dispatcher.viewport(from: nil) == nil,
        "no viewport param means the whole frame")
    #expect(
        CropRect(left: 0.6, top: 0, right: 0.2, bottom: 1).sanitized() == nil,
        "an inverted region is refused rather than rendered")
}

@Test func scaleFactorSurvivesACrop() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: fixture)

    let half = Edit(crop: CropRect(left: 0.25, top: 0.25, right: 0.75, bottom: 0.75))
    let url = try renderer.render(file: file, edit: half, maxPixel: 1200)
    let image = try #require(CIImage(contentsOf: url))
    #expect(
        max(image.extent.width, image.extent.height) > 1100,
        "a cropped render decoded too small: \(image.extent)")
}

@Test func exportJPEGBakesTheExposureIn() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    try withExportScratch { renderer, out in
        let file = try imageFile(for: fixture)

        let neutral = out.appendingPathComponent("neutral.jpg")
        let bright = out.appendingPathComponent("bright.jpg")
        try renderer.exportJPEG(file: file, edit: .identity, quality: 0.9, to: neutral)
        try renderer.exportJPEG(file: file, edit: Edit(exposure: 2), quality: 0.9, to: bright)

        #expect(
            try meanLuminance(of: bright) > meanLuminance(of: neutral),
            "the persisted exposure must be baked into the delivery")
        let width = try #require(Dimensions.read(at: neutral)).width
        #expect(width > 2000, "export must be full resolution, got width \(width)")
    }
}

@Test func aResizedExportLandsOnTheLongEdgeOfTheTurnedCrop() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    try withExportScratch { renderer, out in
        let file = try imageFile(for: fixture)

        let crop = CropRect(left: 0.113, top: 0.071, right: 0.877, bottom: 0.613)
        let cases: [(edit: Edit, portrait: Bool)] = [
            (Edit(crop: crop), false),
            (Edit(crop: crop, rotation: 90), true),
            (Edit(crop: crop, cropAngle: 4.7, rotation: 270), true),
        ]
        for (index, (edit, portrait)) in cases.enumerated() {
            let url = out.appendingPathComponent("\(index).jpg")
            try renderer.exportJPEG(
                file: file, edit: edit, quality: 0.9, to: url, longEdge: 1080)
            let size = try #require(Dimensions.read(at: url))
            #expect(max(size.width, size.height) == 1080, "\(edit): \(size)")
            #expect((size.height > size.width) == portrait, "\(edit): \(size)")
        }
    }
}

/// The final fit hides a decode budget measured before the crop or the turn.
@Test func sourceScaleMeasuresTheTurnedCrop() {
    let size = CGSize(width: 6000, height: 4000)
    let leftHalf = CropRect(left: 0, top: 0, right: 0.5, bottom: 1)
    #expect(
        Renderer.sourceScale(for: Edit(crop: leftHalf), orientedSize: size, maxPixel: 1000)
            == Float(1000.0 / 4000))
    #expect(
        Renderer.sourceScale(
            for: Edit(crop: leftHalf, rotation: 90), orientedSize: size, maxPixel: 1000)
            == Float(1000.0 / 6000))
    #expect(
        Renderer.sourceScale(for: Edit(crop: leftHalf), orientedSize: size, maxPixel: 8000) == 1)
}

@Test func aResizedExportNeverUpscales() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    try withExportScratch { renderer, out in
        let file = try imageFile(for: fixture)

        // about 1400 px across at full resolution, short of the 2048 asked for
        let small = Edit(crop: CropRect(left: 0.4, top: 0.4, right: 0.6, bottom: 0.6))
        let full = out.appendingPathComponent("full.jpg")
        let resized = out.appendingPathComponent("resized.jpg")
        try renderer.exportJPEG(file: file, edit: small, quality: 0.9, to: full)
        try renderer.exportJPEG(file: file, edit: small, quality: 0.9, to: resized, longEdge: 2048)
        let resizedSize = try #require(Dimensions.read(at: resized))
        #expect(try resizedSize == #require(Dimensions.read(at: full)))
    }
}

@Test func aResizedNonRawExportLandsOnTheTurnedCropToo() throws {
    try withExportScratch { renderer, out in
        let jpegURL = try writeHalvesJPEG(width: 3001, height: 1999)
        defer { try? FileManager.default.removeItem(at: jpegURL) }
        let url = out.appendingPathComponent("turned.jpg")
        try renderer.exportJPEG(
            file: try imageFile(for: jpegURL),
            edit: Edit(crop: CropRect(left: 0.05, top: 0.1, right: 0.93, bottom: 0.8), rotation: 90),
            quality: 0.9, to: url, longEdge: 512)
        let size = try #require(Dimensions.read(at: url))
        #expect(size.height == 512, "the turned crop is portrait: \(size)")

        let tiny = try writeHalvesJPEG(width: 64, height: 48)
        defer { try? FileManager.default.removeItem(at: tiny) }
        let kept = out.appendingPathComponent("tiny.jpg")
        try renderer.exportJPEG(
            file: try imageFile(for: tiny), edit: .identity, quality: 0.9, to: kept, longEdge: 1080)
        #expect(try #require(Dimensions.read(at: kept)) == (64, 48))
    }
}

@Test func exportLeavesTheLoupeFilterCacheWarm() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    try withExportScratch { renderer, out in
        let file = try imageFile(for: fixture)

        _ = try renderer.render(file: file, edit: .identity, maxPixel: 64)
        for longEdge in [nil, 1080] {
            try renderer.exportJPEG(
                file: file, edit: .identity, quality: 0.9,
                to: out.appendingPathComponent("\(UUID().uuidString).jpg"), longEdge: longEdge)
        }
        _ = try renderer.render(file: file, edit: Edit(exposure: 1), maxPixel: 64)

        #expect(
            renderer.rawDecodeCount == 1,
            "the export took a slot in the loupe's filter cache, where it evicts warm filters")
    }
}

@Test func raw9SupportMatchesWhatTheFilterRenders() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: fixture)

    let filter = try #require(CIRAWFilter(imageURL: fixture))
    let expected = filter.supportedDecoderVersions.contains { version in
        guard Renderer.isVersion(version, 9) else { return false }
        filter.decoderVersion = version
        return filter.outputImage != nil
    }
    #expect(renderer.supports(file: file, major: 9) == expected)
    // the second ask answers from the per-camera cache, same verdict
    #expect(renderer.supports(file: file, major: 9) == expected)
}

@Test func embeddedFormatsNeverClaimRaw9() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    let jpeg = ImageFile(
        path: "/nowhere/DSC0001.JPG", rel: "DSC0001.JPG", ext: "JPG", size: 1, mtime: 1)
    #expect(renderer.supports(file: jpeg, major: 9) == false)
}

@Test func fixtureCarriesACameraModelForTheProbeCache() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    let model = Renderer.cameraModel(of: fixture)
    #expect(model?.isEmpty == false, "header model read broke: every file would probe alone")
}

@Test func repeatedSupportChecksStopReadingTheFile() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: fixture)

    let first = Date()
    _ = renderer.supports(file: file, major: 9)
    let cold = Date().timeIntervalSince(first)

    let second = Date()
    for _ in 0..<500 { _ = renderer.supports(file: file, major: 9) }
    let warm = Date().timeIntervalSince(second)

    // a per-path miss means a whole shoot re-reads every header on every
    // selection change
    // per call, not in total: a sibling test that already warmed CoreImage's
    // codec shrinks `cold`, and a bare warm < cold would start failing
    #expect(
        warm / 500 < cold / 10,
        "warm: \(warm)s for 500, cold: \(cold)s for 1")
}

@Test func aHalfCopiedFileCannotAnswerForItsWholeCamera() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("poison-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }

    let renderer = Renderer(cacheDir: cacheDir)
    let whole = try imageFile(for: fixture)
    // Probing 8 rather than 9: CI runs a macOS with no RAW 9, where a poisoned
    // "no" and an honest "no" look alike and the regression goes untested.
    guard renderer.supports(file: whole, major: 8) else {
        print("SKIP: fixture does not offer RAW 8")
        return
    }

    // a card still copying: the header names the camera, the body is missing
    let partial = dir.appendingPathComponent("IMG_0001.arw")
    let head = try Data(contentsOf: fixture).prefix(1_000_000)
    try head.write(to: partial)
    let truncated = try imageFile(for: partial)

    let fresh = Renderer(cacheDir: cacheDir)
    _ = fresh.supports(file: truncated, major: 8)
    #expect(
        fresh.supports(file: whole, major: 8),
        "an unreadable file poisoned the camera verdict for every sibling")
}

@Test func aDecoderTheFileCannotHonourSharesTheDefaultCacheKey() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: fixture)

    let plain = renderer.cachePath(for: file, edit: .identity, maxPixel: 800)
    let asked = renderer.cachePath(
        for: file, edit: .identity, maxPixel: 800, decoderVersion: 9)

    if renderer.supports(file: file, major: 9) {
        #expect(asked != plain, "a decoder that ran must not share the default key")
    } else {
        // The request fell back, so these are the same pixels. Were the key to
        // record the wish, a macOS that later gains RAW 9 would serve them.
        #expect(asked == plain, "a fallback must not be cached as RAW 9")
    }
}

@Test func aFileStillCopyingAnswersNothingNotNo() throws {
    guard let fixture = rawFixture("sony-a7iv.arw") else { return }
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("half-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }
    let partial = dir.appendingPathComponent("IMG_0001.arw")
    let bytes = try Data(contentsOf: fixture).prefix(512 * 1024)
    try bytes.write(to: partial)

    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = ImageFile(
        path: partial.path, rel: "IMG_0001.arw", ext: "arw",
        size: Int64(bytes.count), mtime: 1)

    // "cannot read yet" must stay distinguishable: the library-wide answer
    // caches for the session, so a no here would stick after the copy lands.
    #expect(renderer.known(file: file, major: 9) == nil)
    #expect(renderer.supports(file: file, major: 9) == false)
}
