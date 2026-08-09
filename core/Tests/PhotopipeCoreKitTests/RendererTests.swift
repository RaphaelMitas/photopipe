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

private func record(for url: URL) throws -> FileRecord {
    let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
    return FileRecord(
        path: url.path, ext: url.pathExtension.lowercased(), stage: .raw,
        size: (attrs[.size] as? Int64) ?? 0,
        mtime: ((attrs[.modificationDate] as? Date) ?? .distantPast).timeIntervalSince1970)
}

private func meanLuminance(of url: URL) throws -> Double {
    guard let image = CIImage(contentsOf: url) else {
        throw Renderer.RenderError.unreadable(url.path)
    }
    let average = image.applyingFilter(
        "CIAreaAverage", parameters: [kCIInputExtentKey: CIVector(cgRect: image.extent)])
    var pixel = [UInt8](repeating: 0, count: 4)
    CIContext().render(
        average, toBitmap: &pixel, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
        format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB))
    return (Double(pixel[0]) + Double(pixel[1]) + Double(pixel[2])) / 3
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
    let file = try record(for: fixture)

    let dark = try renderer.render(file: file, exposure: -2, maxPixel: 800)
    let neutral = try renderer.render(file: file, exposure: 0, maxPixel: 800)
    let bright = try renderer.render(file: file, exposure: 2, maxPixel: 800)

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
    let file = try record(for: fixture)

    let first = try renderer.render(file: file, exposure: 0.5, maxPixel: 800)
    let again = try renderer.render(file: file, exposure: 0.5, maxPixel: 800)
    #expect(first == again, "same request must hit the cache")

    let other = try renderer.render(file: file, exposure: 1.0, maxPixel: 800)
    #expect(first != other, "different exposure must be a different cache entry")

    let stale = FileRecord(
        path: file.path, ext: file.ext, stage: file.stage, size: file.size,
        mtime: file.mtime + 1)
    #expect(
        renderer.cachePath(for: stale, exposure: 0.5, maxPixel: 800)
            != renderer.cachePath(for: file, exposure: 0.5, maxPixel: 800),
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
    let file = try record(for: fixture)

    // The cold render pays for the raw decode and primes the filter LRU.
    let coldStart = Date()
    _ = try renderer.render(file: file, exposure: 0, maxPixel: 2000)
    let cold = Date().timeIntervalSince(coldStart) * 1000

    var times: [Double] = []
    for step in 1...8 {
        let exposure = Double(step) * 0.25 - 1
        let start = Date()
        _ = try renderer.render(file: file, exposure: exposure, maxPixel: 2000)
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
    let attrs = try FileManager.default.attributesOfItem(atPath: jpegURL.path)
    let file = FileRecord(
        path: jpegURL.path, ext: "jpg", stage: .export,
        size: (attrs[.size] as? Int64) ?? 0,
        mtime: ((attrs[.modificationDate] as? Date) ?? .distantPast).timeIntervalSince1970)

    let neutral = try renderer.render(file: file, exposure: 0, maxPixel: 64)
    let bright = try renderer.render(file: file, exposure: 1.5, maxPixel: 64)
    #expect(try meanLuminance(of: bright) > meanLuminance(of: neutral))
}
