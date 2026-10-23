import Foundation
import Testing

@testable import PhotopipeCoreKit

private struct StoreRender: Decodable {
    let name: String
    let src: String
    let edit: Edit
    let maxPixel: Int?
}

/// The App Store screenshots show these renders. Their RAW originals stay out
/// of git, so this only runs when pointed at them:
/// PHOTOPIPE_STORE_ORIGINALS=~/Pictures/Camera/2026-09-03_zell-am-see swift test --filter storeRenders
@Test func storeRenders() throws {
    guard let originals = ProcessInfo.processInfo.environment["PHOTOPIPE_STORE_ORIGINALS"] else { return }
    let store = fixturesRoot().deletingLastPathComponent().appendingPathComponent("apps/desktop/e2e/store")
    let renders = try JSONDecoder().decode(
        [StoreRender].self, from: Data(contentsOf: store.appendingPathComponent("renders.json")))
    let cache = FileManager.default.temporaryDirectory.appendingPathComponent(
        "photopipe-store-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: cache) }
    let renderer = Renderer(cacheDir: cache)
    for render in renders {
        let src = URL(fileURLWithPath: originals).appendingPathComponent(render.src)
        let file = ImageFile(path: src.path, rel: render.src, ext: src.pathExtension, size: 1, mtime: 1)
        let rendered = try renderer.render(file: file, edit: render.edit, maxPixel: render.maxPixel ?? 2880)
        let out = store.appendingPathComponent("renders/\(render.name).jpg")
        try? FileManager.default.removeItem(at: out)
        try FileManager.default.copyItem(at: rendered, to: out)
    }
}
