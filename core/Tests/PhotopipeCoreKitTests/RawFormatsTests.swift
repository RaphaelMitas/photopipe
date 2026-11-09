import CoreImage
import Foundation
import Testing

@testable import PhotopipeCoreKit

private let otherBrands = [
    "canon-5d4.cr2", "canon-r6.cr3", "nikon-z6ii.nef", "fujifilm-xt4.raf",
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

// macOS 26.7 lists no decoder for a Panasonic S5 RW2, which macOS 27 decodes again
private func osHasNoDecoder(for raw: URL) -> Bool {
    CIRAWFilter(imageURL: raw)?.supportedDecoderVersions.allSatisfy { $0.rawValue == "None" }
        ?? true
}

private let noDecoder: Comment = "this macOS has no raw decoder for the camera"

// one camera at a time: in parallel with the rest, they stalled the CI virtual machine for hours
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
        try withKnownIssue(noDecoder) {
            let renderer = Renderer(cacheDir: dir.appendingPathComponent("cache"))
            #expect(try renderer.rawDefaults(for: file) != nil)
            let upright = try renderedSize(file, .identity, with: renderer)
            let turned = try renderedSize(file, Edit(rotation: 90), with: renderer)
            #expect(upright.width > upright.height && turned.width < turned.height)
        } when: {
            osHasNoDecoder(for: raw)
        }

        try XMP.writeRating(4, file: file)
        try XMP.writeFlag(-1, file: try image(raw))
        try XMP.writeEdit(Edit(exposure: 0.5, rotation: 90), file: try image(raw))
        let sidecar = dir.appendingPathComponent("IMG_0001.xmp")
        #expect(try exiftoolTag("-XMP:Rating", of: sidecar) == "4")
        #expect(try exiftoolTag("-XMP-xmpDM:Pick", of: sidecar) == "-1")
        var read = XMP.read(file: try image(raw))
        #expect(read.rating == 4 && read.flag == -1)
        #expect(read.edit.exposure == 0.5 && read.edit.rotation == 90)

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
        try XMP.writeEdit(Edit(rotation: 90), file: file)
        #expect(XMP.read(file: try image(raw)).edit.rotation == 90)

        try withKnownIssue(noDecoder) {
            let renderer = Renderer(cacheDir: dir.appendingPathComponent("cache"))
            let upright = try renderedSize(file, .identity, with: renderer)
            #expect(upright.width < upright.height, "got \(upright)")
            let turned = try renderedSize(try image(raw), Edit(rotation: 90), with: renderer)
            #expect(turned.width > turned.height, "got \(turned)")
        } when: {
            osHasNoDecoder(for: raw)
        }
    }

    @Test func exiftoolSizesARawWhenImageIOGivesNoPixelSize() throws {
        guard requireExifTool() else { return }
        let dir = scratchDir("no-pixel-size")
        defer { try? FileManager.default.removeItem(at: dir) }
        guard let raw = try copyOfFixture("panasonic-s5.rw2", into: dir) else { return }
        func withoutPixelSize() throws -> [CFString: Any] {
            var props = try #require(Dimensions.properties(at: raw))
            props[kCGImagePropertyPixelWidth] = nil
            props[kCGImagePropertyPixelHeight] = nil
            return props
        }
        #expect(try #require(Dimensions.dimensions(withoutPixelSize(), of: raw)) == (6000, 4000))

        try ExifTool.shared.write(["-overwrite_original", "-Orientation#=6", raw.path])
        #expect(try #require(Dimensions.dimensions(withoutPixelSize(), of: raw)) == (4000, 6000))
    }

    @Test(arguments: otherBrands + ["sony-a7iii.arw", "sony-a7iv.arw"])
    func everyBrandShowsTheExposureItWasShotWith(_ name: String) throws {
        guard let raw = rawFixture(name) else { return }
        let exif = Exif(try #require(Dimensions.properties(at: raw)))
        #expect(exif.shutter != nil && exif.aperture != nil && exif.iso != nil, "got \(exif)")
        #expect(exif.focal != nil && exif.lens != nil && exif.body != nil, "got \(exif)")
    }

    // a NEF: macOS 15 does not surface the XMP inside a CR3
    @Test func aStarRatedInCameraShowsAndStaysOnceTheRawHasASidecar() throws {
        let name = "nikon-z6ii.nef"
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
