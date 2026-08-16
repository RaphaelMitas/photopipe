import CoreImage
import Foundation
import Testing

@testable import PhotopipeCoreKit

@Test func tmpZoomCost() throws {
    let fixture = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("fixtures/raw/sony-a7iv.arw")
    guard FileManager.default.fileExists(atPath: fixture.path) else { return }
    let attrs = try FileManager.default.attributesOfItem(atPath: fixture.path)
    let file = ImageFile(
        path: fixture.path, rel: "x.arw", ext: "arw",
        size: (attrs[.size] as? Int64) ?? 0,
        mtime: ((attrs[.modificationDate] as? Date) ?? .distantPast).timeIntervalSince1970)

    let native = 7008
    for label in ["preview 2560", "zoom native", "zoom native again"] {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pp-zoom-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let renderer = Renderer(cacheDir: dir)
        let maxPixel = label == "preview 2560" ? 2560 : native
        let start = Date()
        let url = try renderer.render(file: file, edit: .identity, maxPixel: maxPixel)
        let ms = Int(-start.timeIntervalSinceNow * 1000)
        let size = CIImage(contentsOf: url)?.extent.size ?? .zero
        print("PROBE \(label): \(ms)ms  \(Int(size.width))x\(Int(size.height))")
    }

    // Zoom on a cropped photo: the decoder must not shrink the visible half.
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("pp-zoom-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: dir) }
    let renderer = Renderer(cacheDir: dir)
    let half = Edit(crop: CropRect(left: 0.25, top: 0.25, right: 0.75, bottom: 0.75))
    let url = try renderer.render(file: file, edit: half, maxPixel: native)
    let size = CIImage(contentsOf: url)?.extent.size ?? .zero
    print("PROBE zoom on 50% crop: \(Int(size.width))x\(Int(size.height)) (want ~3504x2336)")
}
