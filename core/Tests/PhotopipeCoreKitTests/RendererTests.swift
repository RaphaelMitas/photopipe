import CoreImage
import Foundation
import Testing

@testable import PhotopipeCoreKit

private func fixtureARW() -> URL? {
    let fixture = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("fixtures/raw/sony-a7iv.arw")
    guard FileManager.default.fileExists(atPath: fixture.path) else {
        // Locally a missing fixture is a soft skip; CI must fail loudly.
        #expect(
            ProcessInfo.processInfo.environment["CI"] == nil,
            "real-ARW fixture missing on CI — run fixtures/fetch.sh before swift test")
        print("SKIP: run fixtures/fetch.sh for renderer tests")
        return nil
    }
    return fixture
}

private func imageFile(for url: URL) throws -> ImageFile {
    let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
    return ImageFile(
        path: url.path, rel: url.lastPathComponent, ext: url.pathExtension.lowercased(),
        size: (attrs[.size] as? Int64) ?? 0,
        mtime: ((attrs[.modificationDate] as? Date) ?? .distantPast).timeIntervalSince1970)
}

private func meanChannels(of url: URL) throws -> (red: Double, green: Double, blue: Double) {
    guard let image = CIImage(contentsOf: url) else {
        throw Renderer.RenderError.unreadable(url.path)
    }
    let average = image.applyingFilter(
        "CIAreaAverage", parameters: [kCIInputExtentKey: CIVector(cgRect: image.extent)])
    var pixel = [UInt8](repeating: 0, count: 4)
    CIContext().render(
        average, toBitmap: &pixel, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
        format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB))
    return (Double(pixel[0]), Double(pixel[1]), Double(pixel[2]))
}

private func meanLuminance(of url: URL) throws -> Double {
    let channels = try meanChannels(of: url)
    return (channels.red + channels.green + channels.blue) / 3
}

private func tempCacheDir() -> URL {
    FileManager.default.temporaryDirectory
        .appendingPathComponent("photopipe-render-tests-\(UUID().uuidString)")
}

@Test func renderAppliesExposureInRawPipeline() throws {
    guard let fixture = fixtureARW() else { return }
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
    guard let fixture = fixtureARW() else { return }
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

/// The killer-feature budget: warm scrubs must stay interactive. The spike
/// measured ~35ms on real hardware, and 250ms fails the build long before a
/// slider feels broken.
///
/// On CI that number is meaningless. GitHub's macOS runners are VMs without
/// GPU acceleration, so Core Image renders on the CPU: the same scrub took
/// 2180ms and 3230ms on two consecutive runs, varying with whatever else the
/// host was doing. Any absolute ceiling there measures the runner, and a
/// ceiling loose enough to be stable is too loose to catch a regression.
///
/// So CI asserts the invariant that survives the environment instead: warm
/// renders reuse the cached CIRAWFilter rather than decoding the raw again,
/// which is exactly what makes scrubbing possible. That comparison is
/// self-relative, so it holds on any hardware.
@Test func warmRenderLatencyBudget() throws {
    guard let fixture = fixtureARW() else { return }
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

    if ProcessInfo.processInfo.environment["CI"] != nil {
        #expect(
            median < cold,
            "warm render \(median)ms is no faster than cold \(cold)ms: the CIRAWFilter cache is not being reused"
        )
    } else {
        #expect(median < 250, "warm render median \(median)ms exceeds the 250ms budget")
    }
}

@Test func pruneRemovesOnlyStaleRenders() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    try FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)

    let stale = cacheDir.appendingPathComponent("stale.jpg")
    let fresh = cacheDir.appendingPathComponent("fresh.jpg")
    let foreign = cacheDir.appendingPathComponent("notes.txt")
    for url in [stale, fresh, foreign] {
        try Data("x".utf8).write(to: url)
    }
    try FileManager.default.setAttributes(
        [.modificationDate: Date().addingTimeInterval(-8 * 24 * 3600)],
        ofItemAtPath: stale.path)

    Renderer.prune(cacheDir: cacheDir, olderThan: 7 * 24 * 3600)

    #expect(!FileManager.default.fileExists(atPath: stale.path), "8-day-old render pruned")
    #expect(FileManager.default.fileExists(atPath: fresh.path), "fresh render kept")
    #expect(FileManager.default.fileExists(atPath: foreign.path), "non-render files untouched")
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

@Test func renderAppliesCropAndStraighten() throws {
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }

    // Left half red, right half blue.
    let red = CIImage(color: CIColor(red: 1, green: 0, blue: 0))
        .cropped(to: CGRect(x: 0, y: 0, width: 64, height: 64))
    let blue = CIImage(color: CIColor(red: 0, green: 0, blue: 1))
        .cropped(to: CGRect(x: 32, y: 0, width: 32, height: 64))
    let jpegURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("photopipe-crop-\(UUID().uuidString).jpg")
    defer { try? FileManager.default.removeItem(at: jpegURL) }
    try CIContext().writeJPEGRepresentation(
        of: blue.composited(over: red), to: jpegURL,
        colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)

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
}

private func writeSyntheticJPEG(color: CIColor) throws -> URL {
    let image = CIImage(color: color).cropped(to: CGRect(x: 0, y: 0, width: 64, height: 64))
    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("photopipe-synth-\(UUID().uuidString).jpg")
    try CIContext().writeJPEGRepresentation(
        of: image, to: url, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
    return url
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

@Test func rawWhiteBalanceIsAsShotAndAdjustable() throws {
    guard let fixture = fixtureARW() else { return }
    let cacheDir = tempCacheDir()
    defer { try? FileManager.default.removeItem(at: cacheDir) }
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: fixture)

    let asShot = try #require(try renderer.whiteBalance(for: file))
    #expect(asShot.temperature > 1500 && asShot.temperature < 20000, "plausible Kelvin")

    let neutral = try meanChannels(of: renderer.render(file: file, edit: .identity, maxPixel: 400))
    let warm = try meanChannels(
        of: renderer.render(
            file: file, edit: Edit(temperature: asShot.temperature + 4000), maxPixel: 400))
    #expect(
        warm.red - warm.blue > neutral.red - neutral.blue + 5,
        "raising the neutral temperature must warm the raw render")

    // A later as-shot render must not inherit the mutated filter state.
    let backToNeutral = try meanChannels(
        of: renderer.render(file: file, edit: Edit(exposure: 0.001), maxPixel: 400))
    #expect(
        abs((backToNeutral.red - backToNeutral.blue) - (neutral.red - neutral.blue)) < 3,
        "nil temperature must reset the cached filter to as-shot white balance")

    let jpegURL = try writeSyntheticJPEG(color: CIColor(red: 0.5, green: 0.5, blue: 0.5))
    defer { try? FileManager.default.removeItem(at: jpegURL) }
    #expect(try renderer.whiteBalance(for: imageFile(for: jpegURL)) == nil)
}

@Test func exportJPEGBakesTheExposureIn() throws {
    guard let fixture = fixtureARW() else { return }
    let cacheDir = tempCacheDir()
    let out = tempCacheDir()
    defer {
        try? FileManager.default.removeItem(at: cacheDir)
        try? FileManager.default.removeItem(at: out)
    }
    try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
    let renderer = Renderer(cacheDir: cacheDir)
    let file = try imageFile(for: fixture)

    let neutral = out.appendingPathComponent("neutral.jpg")
    let bright = out.appendingPathComponent("bright.jpg")
    try renderer.exportJPEG(file: file, edit: .identity, quality: 0.9, to: neutral)
    try renderer.exportJPEG(file: file, edit: Edit(exposure: 2), quality: 0.9, to: bright)

    #expect(
        try meanLuminance(of: bright) > meanLuminance(of: neutral),
        "the persisted exposure must be baked into the delivery")
    // Full resolution, not the loupe size.
    let source = try #require(CGImageSourceCreateWithURL(neutral as CFURL, nil))
    let props = try #require(
        CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
    let width = try #require(props[kCGImagePropertyPixelWidth] as? Int)
    #expect(width > 2000, "export must be full resolution, got width \(width)")
}
