import CoreImage
import Foundation
import Testing

@testable import PhotopipeCoreKit

private func storePhoto(_ name: String) -> URL {
    fixturesRoot().deletingLastPathComponent()
        .appendingPathComponent("apps/desktop/e2e/store/photos/\(name)")
}

@Test func blurReadsAsLessSharp() throws {
    let photo = try #require(CIImage(contentsOf: storePhoto("DSC03455.jpg")))
    let context = CIContext()
    let sharp = try #require(context.createCGImage(photo, from: photo.extent))
    let blurred = try #require(
        context.createCGImage(
            photo.clampedToExtent().applyingGaussianBlur(sigma: 3).cropped(to: photo.extent),
            from: photo.extent))
    #expect(Facer.sharpness(of: sharp) > 2 * Facer.sharpness(of: blurred))
}

@Test func facesAreFoundOnceAndRememberedForTheSamePhoto() throws {
    let root = scratchDir("faces")
    let caches = scratchDir("faces-caches")
    defer {
        try? FileManager.default.removeItem(at: root)
        try? FileManager.default.removeItem(at: caches)
    }
    let shoot = root.appendingPathComponent("Shoot")
    try FileManager.default.createDirectory(at: shoot, withIntermediateDirectories: true)
    let copy = shoot.appendingPathComponent("DSC03455.jpg")
    try FileManager.default.copyItem(at: storePhoto("DSC03455.jpg"), to: copy)
    let service = makeService(in: caches)
    _ = try service.setRoot(
        path: root.path, indexPath: caches.appendingPathComponent("index.sqlite").path)

    let found = try #require(try service.faces(paths: [copy.path]).first?.faces)
    #expect(found.count == 1)
    let face = try #require(found.first)
    // the dancer's face sits in the upper middle of the frame
    #expect((0.3...0.7).contains((face.box.left + face.box.right) / 2))
    #expect((0.1...0.4).contains((face.box.top + face.box.bottom) / 2))
    #expect((0...1).contains(face.quality ?? -1))
    #expect((face.sharpness ?? 0) > 0)

    let again = Date()
    #expect(try service.faces(paths: [copy.path]).first?.faces == found)
    #expect(Date().timeIntervalSince(again) < 0.5, "a second ask is answered from the cache")

    let sheet = try service.look(
        paths: [copy.path], edited: true, longEdge: 512, at: nil, sheet: true, faces: true,
        maxBytes: 500_000)
    #expect(sheet.count == 1)
}
