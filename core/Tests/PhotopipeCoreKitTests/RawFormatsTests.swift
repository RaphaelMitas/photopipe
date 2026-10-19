import CoreImage
import Foundation
import Testing

@testable import PhotopipeCoreKit

private let otherBrands = [
    "canon-5d4.cr2", "canon-r6.cr3", "nikon-z6ii.nef", "fujifilm-xt3.raf",
    "olympus-em1iii.orf", "panasonic-s5.rw2", "pentax-k1.pef",
]

/// A copy, so a write that lands in the raw cannot touch the cached fixture.
private func copyOfFixture(_ name: String, into dir: URL) throws -> URL? {
    guard let fixture = rawFixture(name) else { return nil }
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let copy = dir.appendingPathComponent("IMG_0001.\(fixture.pathExtension.uppercased())")
    try FileManager.default.copyItem(at: fixture, to: copy)
    return copy
}

private func renderedSize(_ file: ImageFile, _ edit: Edit, with renderer: Renderer) throws -> CGSize {
    let url = try renderer.render(file: file, edit: edit, maxPixel: 512)
    return try #require(CIImage(contentsOf: url)).extent.size
}

// one camera at a time, so a decoder that wedges rendering on the CI virtual machine is named in the log
@Suite(.serialized)
struct RawFormatsTests {
    @Test(arguments: otherBrands)
    func aRawFromAnyBrandRendersAndSavesBesideItself(_ name: String) throws {
        guard requireExifTool() else { return }
        let dir = scratchDir("raw-\(name)")
        defer { try? FileManager.default.removeItem(at: dir) }
        guard let raw = try copyOfFixture(name, into: dir) else { return }
        let original = try Data(contentsOf: raw)
        let file = try image(raw)
        #expect(file.isRaw && file.sidecarOnly)

        let size = try #require(Dimensions.read(at: raw))
        #expect(size.width > size.height && size.height > 1000, "got \(size)")
        #expect(Dimensions.properties(at: raw).flatMap(Dimensions.captureTime) != nil)
        let renderer = Renderer(cacheDir: dir.appendingPathComponent("cache"))
        #expect(try renderer.rawDefaults(for: file) != nil)
        let upright = try renderedSize(file, .identity, with: renderer)
        let turned = try renderedSize(file, Edit(rotation: 90), with: renderer)
        #expect(upright.width > upright.height && turned.width < turned.height)

        try XMP.writeRating(4, file: file)
        try XMP.writeEdit(Edit(exposure: 0.5, rotation: 90), file: try image(raw))
        let sidecar = dir.appendingPathComponent("IMG_0001.xmp")
        #expect(try exiftoolTag("-XMP:Rating", of: sidecar) == "4")
        var read = XMP.read(file: try image(raw))
        #expect(read.rating == 4 && read.edit.exposure == 0.5 && read.edit.rotation == 90)

        try writeTextRating(5, at: raw)
        read = XMP.read(file: try image(raw))
        #expect(read.rating == 5 && read.edit.rotation == 90)
        #expect(try Data(contentsOf: raw) == original)
    }

    @Test(arguments: otherBrands)
    func aPortraitRawFromAnyBrandStandsUpright(_ name: String) throws {
        guard requireExifTool() else { return }
        let dir = scratchDir("portrait-\(name)")
        defer { try? FileManager.default.removeItem(at: dir) }
        guard let raw = try copyOfFixture(name, into: dir) else { return }
        // a real portrait X-H2 RAF has it in IFD1 too, and ImageIO reads that one
        try ExifTool.shared.write(
            ["-overwrite_original", "-Orientation#=6", "-IFD1:Orientation#=6", raw.path])
        let file = try image(raw)

        let size = try #require(Dimensions.read(at: raw))
        #expect(size.width < size.height, "got \(size)")
        let renderer = Renderer(cacheDir: dir.appendingPathComponent("cache"))
        let upright = try renderedSize(file, .identity, with: renderer)
        #expect(upright.width < upright.height, "got \(upright)")

        try XMP.writeEdit(Edit(rotation: 90), file: file)
        #expect(XMP.read(file: try image(raw)).edit.rotation == 90)
        let turned = try renderedSize(try image(raw), Edit(rotation: 90), with: renderer)
        #expect(turned.width > turned.height, "got \(turned)")
    }

    @Test(arguments: ["canon-r6.cr3", "nikon-z6ii.nef"])
    func aStarRatedInCameraShowsAndStaysOnceTheRawHasASidecar(_ name: String) throws {
        guard requireExifTool() else { return }
        let dir = scratchDir("in-camera-\(name)")
        defer { try? FileManager.default.removeItem(at: dir) }
        guard let raw = try copyOfFixture(name, into: dir) else { return }
        try ExifTool.shared.write(["-overwrite_original", "-XMP:Rating=3", raw.path])
        let original = try Data(contentsOf: raw)
        #expect(XMP.read(file: try image(raw)).rating == 3)

        try XMP.writeEdit(Edit(exposure: 0.5), file: try image(raw))
        let read = XMP.read(file: try image(raw))
        #expect(read.rating == 3 && read.edit.exposure == 0.5)
        #expect(try Data(contentsOf: raw) == original)
    }
}
