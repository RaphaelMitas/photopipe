import CoreImage
import Foundation
import Testing

@testable import PhotopipeCoreKit

/// exiftool availability: soft skip locally, loud failure on CI (which
/// installs it before running tests).
func requireExifTool() -> Bool {
    guard ExifTool.shared.available else {
        #expect(
            ProcessInfo.processInfo.environment["CI"] == nil,
            "exiftool missing on CI — install it before swift test")
        print("SKIP: install exiftool for XMP tests")
        return false
    }
    return true
}

private func tempDir() throws -> URL {
    let dir = scratchDir("xmp")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

/// Independent verification path: what would Lightroom see? Ask exiftool
/// directly rather than trusting our own reader.
func exiftoolTag(_ tag: String, of url: URL) throws -> String {
    try ExifTool.shared.execute([tag, "-s3", url.path])
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

private let gray = CIImage(color: CIColor(red: 0.5, green: 0.5, blue: 0.5))
    .cropped(to: CGRect(x: 0, y: 0, width: 32, height: 32))

private func writeGrayJPEG(to url: URL) throws {
    try CIContext().writeJPEGRepresentation(
        of: gray, to: url, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
}

func image(_ url: URL) throws -> ImageFile {
    let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
    return ImageFile(
        path: url.path, rel: url.lastPathComponent, ext: url.pathExtension,
        size: (attrs[.size] as? Int64) ?? 0,
        mtime: ((attrs[.modificationDate] as? Date) ?? .distantPast).timeIntervalSince1970)
}

/// The iPad's write path, which the Mac takes only to start a sidecar.
func writeTextRating(_ rating: Int, at url: URL) throws {
    try XMP.writeText(XMP.ratingTags(rating), clearing: rating == 0, file: try image(url))
}

func writeTextEdit(_ edit: Edit, at url: URL) throws {
    let file = try image(url)
    try XMP.writeText(XMP.editTags(edit, file: file).tags, clearing: edit.isIdentity, file: file)
}

private func parsed(_ description: String, baseOrientation: Int = 1) -> (rating: Int?, edit: Edit) {
    let packet = """
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
        <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
          xmlns:xmp="http://ns.adobe.com/xap/1.0/"
          xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
          xmlns:tiff="http://ns.adobe.com/tiff/1.0/">
        \(description)
        </rdf:RDF>
        </x:xmpmeta>
        """
    return XMP.parse(packet.utf8, isRaw: true, baseOrientation: baseOrientation)
}

@Test func sidecarCreateWriteReadRoundTrip() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let arw = dir.appendingPathComponent("DSC00001.ARW")
    try Data("fake".utf8).write(to: arw)

    try XMP.writeRating(4, file: try image(arw))

    let sidecar = XMP.sidecarURL(forImagePath: arw.path)
    #expect(sidecar.lastPathComponent == "DSC00001.xmp")
    #expect(FileManager.default.fileExists(atPath: sidecar.path))
    #expect(XMP.read(file: try image(arw)).rating == 4)
    #expect(try exiftoolTag("-XMP:Rating", of: sidecar) == "4")

    // Update in place (no duplicate sidecar, no backup file left behind).
    try XMP.writeRating(2, file: try image(arw))
    #expect(XMP.read(file: try image(arw)).rating == 2)
    let contents = try FileManager.default.contentsOfDirectory(atPath: dir.path)
    #expect(contents.sorted() == ["DSC00001.ARW", "DSC00001.xmp"])
}

@Test func onlyAnAbsurdlyLargeSidecarReadsAsNoSidecar() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let arw = dir.appendingPathComponent("DSC00002.ARW")
    try Data("fake".utf8).write(to: arw)
    let packet = Data(
        """
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
        <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
        <rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="4"/>
        </rdf:RDF>
        </x:xmpmeta>
        """.utf8)
    let sidecar = XMP.sidecarURL(forImagePath: arw.path)

    try (packet + Data(repeating: 0x20, count: XMP.packetSizeLimit)).write(to: sidecar)
    #expect(XMP.read(file: try image(arw)).rating == 4)

    try (packet + Data(repeating: 0x20, count: XMP.sidecarSizeLimit)).write(to: sidecar)
    #expect(XMP.read(file: try image(arw)).rating == 0)
}

@Test func sidecarEditRoundTrip() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let arw = dir.appendingPathComponent("DSC00006.ARW")
    try Data("fake".utf8).write(to: arw)

    #expect(XMP.read(file: try image(arw)).edit == .identity, "no sidecar means untouched")

    let edit = Edit(
        exposure: 1.5, highlights: -42, shadows: 18, whites: 30, blacks: -20,
        texture: 15, clarity: 22, dehaze: -8,
        temperature: 5600, tint: 12, denoise: 25, vibrance: 10, saturation: -5,
        curveRGB: [CurvePoint(x: 0, y: 0), CurvePoint(x: 0.5, y: 0.6), CurvePoint(x: 1, y: 1)],
        curveRed: [CurvePoint(x: 0, y: 0.1), CurvePoint(x: 1, y: 0.9)])
    try XMP.writeEdit(edit, file: try image(arw))

    let read = XMP.read(file: try image(arw)).edit
    #expect(read.exposure == 1.5)
    #expect(read.highlights == -42)
    #expect(read.shadows == 18)
    #expect(read.whites == 30)
    #expect(read.blacks == -20)
    #expect(read.texture == 15)
    #expect(read.clarity == 22)
    #expect(read.dehaze == -8)
    #expect(read.temperature == 5600)
    #expect(read.tint == 12)
    #expect(read.denoise == 25)
    #expect(read.vibrance == 10)
    #expect(read.saturation == -5)
    #expect(read.curveRGB.count == 3)
    #expect(abs(read.curveRGB[1].y - 0.6) < 1.0 / 255, "curve points survive 0-255 quantization")
    #expect(read.curveRed.count == 2)
    #expect(read.curveGreen.isEmpty)

    // The tags Lightroom itself uses, verified independently.
    let sidecar = XMP.sidecarURL(forImagePath: arw.path)
    #expect(try exiftoolTag("-XMP-crs:Exposure2012", of: sidecar) == "1.5")
    #expect(try exiftoolTag("-XMP-crs:Highlights2012", of: sidecar) == "-42")
    #expect(try exiftoolTag("-XMP-crs:Whites2012", of: sidecar) == "30")
    #expect(try exiftoolTag("-XMP-crs:Blacks2012", of: sidecar) == "-20")
    #expect(try exiftoolTag("-XMP-crs:ColorTemperature", of: sidecar) == "5600")
    #expect(try exiftoolTag("-XMP-crs:LuminanceSmoothing", of: sidecar) == "25")
    #expect(try exiftoolTag("-XMP-crs:ToneCurvePV2012", of: sidecar).contains("128, 153"))

    // Edit and rating live in the same sidecar without clobbering each other.
    try XMP.writeRating(3, file: try image(arw))
    #expect(XMP.read(file: try image(arw)).edit.exposure == 1.5)
    #expect(XMP.read(file: try image(arw)).rating == 3)

    // Writing identity clears every tag again.
    try XMP.writeEdit(.identity, file: try image(arw))
    #expect(XMP.read(file: try image(arw)).edit == .identity)
    #expect(try exiftoolTag("-XMP-crs:ToneCurvePV2012", of: sidecar).isEmpty)
    #expect(XMP.read(file: try image(arw)).rating == 3, "clearing the edit keeps the rating")
}

@Test func sidecarCropRoundTrip() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let arw = dir.appendingPathComponent("DSC00008.ARW")
    try Data("fake".utf8).write(to: arw)

    let edit = Edit(
        crop: CropRect(left: 0.125, top: 0.05, right: 0.875, bottom: 0.95), cropAngle: -1.5)
    try XMP.writeEdit(edit, file: try image(arw))

    let read = XMP.read(file: try image(arw)).edit
    #expect(read.crop == edit.crop)
    #expect(read.cropAngle == -1.5)

    let sidecar = XMP.sidecarURL(forImagePath: arw.path)
    #expect(try exiftoolTag("-XMP-crs:CropLeft", of: sidecar) == "0.125")
    #expect(try exiftoolTag("-XMP-crs:CropAngle", of: sidecar) == "-1.5")
    #expect(try exiftoolTag("-XMP-crs:HasCrop", of: sidecar) == "True")

    // Clearing the crop removes every crop tag again.
    try XMP.writeEdit(.identity, file: try image(arw))
    #expect(XMP.read(file: try image(arw)).edit == .identity)
    #expect(try exiftoolTag("-XMP-crs:HasCrop", of: sidecar).isEmpty)
    #expect(try exiftoolTag("-XMP-crs:CropLeft", of: sidecar).isEmpty)
}

@Test func hasCropFalseSuppressesStaleCropValues() {
    // Lightroom's crop-reset keeps the Crop* tags and flips HasCrop to False.
    let sidecar = """
        <rdf:Description
        crs:HasCrop="False" crs:CropLeft="0.1" crs:CropTop="0.1"
        crs:CropRight="0.9" crs:CropBottom="0.9" crs:CropAngle="2.5"/>
        """
    let edit = parsed(sidecar).edit
    #expect(edit.crop == nil)
    #expect(edit.cropAngle == 0)

    let active = parsed(sidecar.replacingOccurrences(of: "\"False\"", with: "\"True\"")).edit
    #expect(active.crop == CropRect(left: 0.1, top: 0.1, right: 0.9, bottom: 0.9))
    #expect(active.cropAngle == 2.5)
}

@Test func straightCurveFromAnotherToolReadsAsNoCurve() {
    let sidecar = """
        <rdf:Description><crs:ToneCurvePV2012><rdf:Seq>
        <rdf:li>0, 0</rdf:li><rdf:li>255, 255</rdf:li>
        </rdf:Seq></crs:ToneCurvePV2012><crs:ToneCurvePV2012Red><rdf:Seq>
        <rdf:li>0, 10</rdf:li><rdf:li>255, 255</rdf:li>
        </rdf:Seq></crs:ToneCurvePV2012Red></rdf:Description>
        """
    let edit = parsed(sidecar).edit
    #expect(edit.curveRGB.isEmpty, "a straight curve is the same edit as no curve")
    #expect(edit.curveRed.count == 2)
}

/// exiftool rewrites move crs:Look, which nests its own tone curve, above the photo's curves.
@Test func lightroomLookCurveIsNotThePhotosCurve() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let arw = dir.appendingPathComponent("DSC00014.ARW")
    try Data("fake".utf8).write(to: arw)
    let sidecar = XMP.sidecarURL(forImagePath: arw.path)
    try FileManager.default.copyItem(
        at: fixturesRoot().appendingPathComponent("sidecars/lightroom-masks.xmp"), to: sidecar)

    try ExifTool.shared.write([
        "-overwrite_original", "-XMP-crs:ToneCurvePV2012Red=0, 20",
        "-XMP-crs:ToneCurvePV2012Red=255, 240", sidecar.path,
    ])
    let read = XMP.read(file: try image(arw)).edit
    let photoCurve = [(0.0, 0.0), (66, 58), (192, 200), (255, 255)].map {
        CurvePoint(x: $0 / 255, y: $1 / 255)
    }
    #expect(read.curveRGB == photoCurve)
    #expect(read.curveRed == [CurvePoint(x: 0, y: 20 / 255), CurvePoint(x: 1, y: 240 / 255)])
    #expect(read.curveGreen.isEmpty)
    #expect(read.highlights == -21)

    try ExifTool.shared.write(["-overwrite_original", "-XMP-crs:ToneCurvePV2012=", sidecar.path])
    #expect(try String(contentsOf: sidecar, encoding: .utf8).contains("<rdf:li>22, 16</rdf:li>"))
    #expect(XMP.read(file: try image(arw)).edit.curveRGB.isEmpty)
}

@Test func maskSettingsAreNotThePhotosSettings() {
    let edit = parsed(
        """
        <rdf:Description crs:Exposure2012="0.5">
         <crs:MaskGroupBasedCorrections><rdf:Seq><rdf:li>
          <rdf:Description crs:Exposure2012="3" crs:Shadows2012="40">
           <crs:ToneCurvePV2012><rdf:Seq>
            <rdf:li>0, 40</rdf:li><rdf:li>255, 255</rdf:li>
           </rdf:Seq></crs:ToneCurvePV2012>
          </rdf:Description>
         </rdf:li></rdf:Seq></crs:MaskGroupBasedCorrections>
        </rdf:Description>
        """
    ).edit
    #expect(edit.exposure == 0.5)
    #expect(edit.shadows == 0)
    #expect(edit.curveRGB.isEmpty)
}

@Test func propertiesResolveByNamespaceNotPrefix() {
    let read = XMP.parse(
        """
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
        <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
         <rdf:Description xmlns:raw="http://ns.adobe.com/camera-raw-settings/1.0/"
           xmlns:crs="urn:example:not-camera-raw" xmlns:xap="http://ns.adobe.com/xap/1.0/"
           raw:Exposure2012="0.5" crs:Shadows2012="40" xap:Rating="&#51;"/>
        </rdf:RDF>
        </x:xmpmeta>
        """.utf8, isRaw: true)
    #expect(read.edit.exposure == 0.5)
    #expect(read.edit.shadows == 0)
    #expect(read.rating == 3)
}

@Test func brokenSidecarKeepsWhatPrecedesTheBreak() {
    let head = """
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
        <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
        <rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/"
          xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" xmp:Rating="4">
         <crs:Shadows2012>20</crs:Shadows2012>

        """
    let truncated = XMP.parse(
        (head + "<crs:ToneCurvePV2012><rdf:Seq><rdf:li>0, 0</rdf:li><rdf:li>128, 16").utf8,
        isRaw: true)
    #expect(truncated.rating == 4)
    #expect(truncated.edit.shadows == 20)
    #expect(truncated.edit.curveRGB.isEmpty)

    let mismatched = XMP.parse(
        (head + "<crs:Exposure2012>0.5</crs:Exposure><crs:Whites2012>9</crs:Whites2012>").utf8,
        isRaw: true)
    #expect(mismatched.rating == 4)
    #expect(mismatched.edit.shadows == 20)
    #expect(mismatched.edit.whites == 0)
}

@Test func sidecarCutInsideTheDescriptionTagKeepsItsAttributes() throws {
    let lightroom = try String(
        contentsOf: fixturesRoot().appendingPathComponent("sidecars/lightroom-masks.xmp"),
        encoding: .utf8
    ).replacingOccurrences(of: "rdf:about=\"\"", with: "rdf:about=\"\" xmp:Rating=\"4\"")
    let cut = try #require(lightroom.range(of: "crs:Shadows2012=\"+3"))
    let read = XMP.parse(lightroom[..<cut.upperBound].utf8, isRaw: true)
    #expect(read.rating == 4)
    #expect(read.edit.highlights == -21)
    #expect(read.edit.shadows == 0)
}

@Test func hugeCurvePointsNeitherPoisonNorTrap() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let arw = dir.appendingPathComponent("DSC00009.ARW")
    try Data("fake".utf8).write(to: arw)

    let overflow = String(repeating: "9", count: 400)
    let sidecar = """
        <rdf:Description><crs:ToneCurvePV2012><rdf:Seq>
        <rdf:li>0, 0</rdf:li><rdf:li>\(overflow), 255</rdf:li>
        </rdf:Seq></crs:ToneCurvePV2012></rdf:Description>
        """
    #expect(parsed(sidecar).edit.curveRGB.isEmpty, "an infinite point is dropped")

    // finite but far past Int.max, as IPC can send it
    let huge = Edit(curveRGB: [CurvePoint(x: 0, y: 0.2), CurvePoint(x: 1e30, y: 1)])
    try XMP.writeEdit(huge, file: try image(arw))
    #expect(XMP.read(file: try image(arw)).edit.curveRGB.last == CurvePoint(x: 1, y: 1))
}

@Test func nonFiniteEmbeddedCurvePointsAreDropped() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let jpg = dir.appendingPathComponent("DSC00011.JPG")
    try writeGrayJPEG(to: jpg)
    try ExifTool.shared.write([
        "-overwrite_original",
        "-XMP-crs:ToneCurvePV2012=0, 0", "-XMP-crs:ToneCurvePV2012=nan, nan",
        "-XMP-crs:ToneCurvePV2012=inf, 0", "-XMP-crs:ToneCurvePV2012=128, 160",
        "-XMP-crs:ToneCurvePV2012=255, 255", jpg.path,
    ])

    let edit = XMP.read(file: try image(jpg)).edit
    #expect(edit.curveRGB.count == 3, "nan and inf are dropped, the rest stays")
    #expect(throws: Never.self) { try JSONEncoder().encode(edit) }
}

@Test func hostileCropValuesAreRejectedOnParse() {
    let digits = String(repeating: "9", count: 400)
    let sidecar = """
        <rdf:Description crs:Exposure2012="\(digits)"
        crs:CropLeft="\(digits)" crs:CropTop="0" crs:CropRight="1"
        crs:CropBottom="1" crs:CropAngle="\(digits)"/>
        """
    let edit = parsed(sidecar).edit
    #expect(edit.exposure == 0, "an overflowing scalar must not become infinity")
    #expect(edit.crop == nil)
    #expect(edit.cropAngle == 0)

    // Degenerate rects (right <= left) never become a crop.
    let inverted = parsed(
        #"<rdf:Description crs:CropLeft="0.9" crs:CropTop="0" crs:CropRight="0.1" crs:CropBottom="1"/>"#
    ).edit
    #expect(inverted.crop == nil)

    // Finite-but-huge exponent values would trap the integer tag writes.
    let huge = parsed(#"<rdf:Description crs:Highlights2012="1e308"/>"#).edit
    #expect(huge.highlights == 0)

    // A straightened crop legitimately overhangs the frame box; the parse
    // tolerance matches the renderer's.
    let overhang = parsed(
        #"<rdf:Description crs:CropLeft="-0.05" crs:CropTop="0" crs:CropRight="1.02" crs:CropBottom="1" crs:CropAngle="12"/>"#
    ).edit
    #expect(overhang.crop == CropRect(left: -0.05, top: 0, right: 1.02, bottom: 1))
}

/// The JPEG segment walk must ignore a decoy packet in a comment segment and
/// read the orientation from the real APP1 XMP.
@Test func decoyXMPPacketInAJPEGCommentIsIgnored() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let jpg = dir.appendingPathComponent("DSC00013.JPG")
    try writeGrayJPEG(to: jpg)
    try ExifTool.shared.write(["-overwrite_original", "-XMP-tiff:Orientation#=6", jpg.path])

    // Splice a decoy packet into a COM segment right after SOI — earlier in
    // the byte stream than the genuine APP1.
    var bytes = try Data(contentsOf: jpg)
    let decoy = Data(#"<x:xmpmeta><rdf:Description tiff:Orientation="3"/></x:xmpmeta>"#.utf8)
    var segment = Data([0xFF, 0xFE])
    let length = decoy.count + 2
    segment.append(UInt8(length >> 8))
    segment.append(UInt8(length & 0xFF))
    segment.append(decoy)
    bytes.insert(contentsOf: segment, at: bytes.startIndex + 2)
    try bytes.write(to: jpg)

    #expect(XMP.embeddedXMPOrientation(at: jpg) == 6)
}

/// A base orientation guessed from a failed read must never be written into
/// an embedded file's real EXIF; the turn fails loudly instead.
@Test func turningAnUnreadableEmbeddedFileThrows() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let jpg = dir.appendingPathComponent("DSC00012.JPG")
    try Data("not a jpeg".utf8).write(to: jpg)

    #expect(throws: XMP.XMPError.self) {
        try XMP.writeEdit(Edit(rotation: 90), file: try image(jpg))
    }
}

@Test func tinyCropEdgeSurvivesTheSidecarRoundTrip() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let arw = dir.appendingPathComponent("DSC00009.ARW")
    try Data("fake".utf8).write(to: arw)

    // 3e-05 in Swift's default interpolation — must be written as a plain
    // decimal or the whole crop is lost on the next read.
    let edit = Edit(crop: CropRect(left: 0.00003, top: 0, right: 0.9, bottom: 1))
    try XMP.writeEdit(edit, file: try image(arw))

    let sidecar = XMP.sidecarURL(forImagePath: arw.path)
    #expect(try exiftoolTag("-XMP-crs:CropLeft", of: sidecar) == "0.00003")
    #expect(XMP.read(file: try image(arw)).edit.crop == edit.crop)

    // Exponent forms in foreign sidecars parse anyway.
    let exponent = parsed(
        #"<rdf:Description crs:CropLeft="3e-05" crs:CropTop="0" crs:CropRight="0.9" crs:CropBottom="1"/>"#)
    #expect(exponent.edit.crop?.left == 3e-05)
}

/// Regression: for embedded formats ImageIO reports our own freshly written
/// XMP orientation back as the file's orientation, so without a pinned EXIF
/// base the turn cancelled itself on the next read ("applies briefly, then
/// resets").
@Test func embeddedRotationSurvivesWithoutExifOrientation() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let jpg = dir.appendingPathComponent("DSC00009.JPG")
    try writeGrayJPEG(to: jpg)

    try XMP.writeEdit(Edit(rotation: 90), file: try image(jpg))
    #expect(XMP.read(file: try image(jpg)).edit.rotation == 90)
    #expect(
        try exiftoolTag("-IFD0:Orientation#", of: jpg) == "1",
        "the pre-edit base gets pinned as real EXIF")

    // A second write reads the pinned base, not our own XMP echo.
    try XMP.writeEdit(Edit(rotation: 180), file: try image(jpg))
    #expect(XMP.read(file: try image(jpg)).edit.rotation == 180)
    #expect(try exiftoolTag("-XMP-tiff:Orientation#", of: jpg) == "3")

    // Un-turning restores the pinned base instead of deleting the tag.
    try XMP.writeEdit(Edit(rotation: 0), file: try image(jpg))
    #expect(XMP.read(file: try image(jpg)).edit.rotation == 0)
    #expect(try exiftoolTag("-XMP-tiff:Orientation#", of: jpg) == "1")
}

/// Regression: any edit used to emit `-XMP-tiff:Orientation=` when the model
/// rotation was 0, deleting the only orientation record of a photo rotated
/// by another tool (Lightroom writes XMP only for JPEG turns).
@Test func foreignXMPOrientationSurvivesUnrelatedEdits() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let jpg = dir.appendingPathComponent("DSC00011.JPG")
    try writeGrayJPEG(to: jpg)
    try ExifTool.shared.write([
        "-overwrite_original", "-XMP-tiff:Orientation#=6", jpg.path,
    ])

    // The foreign turn reads as no model rotation (it is the display base).
    #expect(XMP.read(file: try image(jpg)).edit.rotation == 0)

    try XMP.writeEdit(Edit(exposure: 0.5), file: try image(jpg))
    #expect(
        try exiftoolTag("-XMP-tiff:Orientation#", of: jpg) == "6",
        "a slider edit must not delete a foreign orientation record")
    #expect(XMP.read(file: try image(jpg)).edit.exposure == 0.5)

    try XMP.writeEdit(.identity, file: try image(jpg))
    #expect(try exiftoolTag("-XMP-tiff:Orientation#", of: jpg) == "6")
}

@Test func rotationIsTheDifferenceAgainstTheBaseOrientation() {
    // A Lightroom sidecar for a portrait shot mirrors the file's own
    // orientation without any user turn.
    #expect(XMP.rotation(fromXMP: 6, base: 6) == 0)
    #expect(XMP.rotation(fromXMP: 6, base: 1) == 90)
    #expect(XMP.rotation(fromXMP: 3, base: 6) == 90)
    #expect(XMP.rotation(fromXMP: 1, base: 6) == 270)
    #expect(XMP.rotation(fromXMP: nil, base: 6) == 0)
    #expect(XMP.rotation(fromXMP: 2, base: 1) == 0, "mirrored orientations pass through as no turn")

    #expect(XMP.absoluteOrientation(rotation: 90, base: 1) == 6)
    #expect(XMP.absoluteOrientation(rotation: 90, base: 6) == 3)
    #expect(XMP.absoluteOrientation(rotation: 270, base: 6) == 1)

    // Mirrored bases keep their mirror through turns: a turn only adds
    // display degrees, it never unflips the photo for other readers.
    #expect(XMP.absoluteOrientation(rotation: 90, base: 2) == 7)
    #expect(XMP.absoluteOrientation(rotation: 180, base: 5) == 7)
    #expect(XMP.rotation(fromXMP: 7, base: 2) == 90)
    #expect(XMP.rotation(fromXMP: 2, base: 2) == 0)
    #expect(XMP.rotation(fromXMP: 6, base: 2) == 0, "mirror mismatch is not our turn")

    let sidecar = #"<rdf:Description tiff:Orientation="6" crs:Exposure2012="0.5"/>"#
    #expect(parsed(sidecar, baseOrientation: 1).edit.rotation == 90)
    #expect(parsed(sidecar, baseOrientation: 6).edit.rotation == 0)
}

@Test func sidecarRotationRoundTrip() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let arw = dir.appendingPathComponent("DSC00010.ARW")
    try Data("fake".utf8).write(to: arw)

    // The fake ARW has no readable orientation, so base is 1 and the
    // absolute tag equals the user turn.
    try XMP.writeEdit(Edit(rotation: 90), file: try image(arw))
    let sidecar = XMP.sidecarURL(forImagePath: arw.path)
    #expect(try exiftoolTag("-XMP-tiff:Orientation#", of: sidecar) == "6")
    #expect(XMP.read(file: try image(arw)).edit.rotation == 90)

    // Clearing a turn restores the base rather than deleting the tag, so a
    // foreign orientation record can never be collateral damage.
    try XMP.writeEdit(.identity, file: try image(arw))
    #expect(try exiftoolTag("-XMP-tiff:Orientation#", of: sidecar) == "1")
    #expect(XMP.read(file: try image(arw)).edit == .identity)
}

/// Regression: `-TAG= -TAG+=…` appends to the existing list in exiftool, so
/// every scrub grew the tone curve until a sidecar held thousands of points
/// and writes took seconds. Rewrites must replace the list wholesale.
@Test func rewritingACurveReplacesInsteadOfAppending() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let arw = dir.appendingPathComponent("DSC00007.ARW")
    try Data("fake".utf8).write(to: arw)

    let first = Edit(curveRGB: [
        CurvePoint(x: 0, y: 0), CurvePoint(x: 0.23, y: 0.17), CurvePoint(x: 1, y: 1),
    ])
    let second = Edit(curveRGB: [
        CurvePoint(x: 0, y: 0), CurvePoint(x: 0.4, y: 0.5),
        CurvePoint(x: 0.76, y: 0.81), CurvePoint(x: 1, y: 1),
    ])
    try XMP.writeEdit(first, file: try image(arw))
    try XMP.writeEdit(second, file: try image(arw))
    try XMP.writeEdit(second, file: try image(arw))

    // the reader returns the raw item list, so a stale leftover would show up
    // as extra points here.
    let read = XMP.read(file: try image(arw)).edit
    #expect(read.curveRGB.count == 4)
    let sidecar = XMP.sidecarURL(forImagePath: arw.path)
    let text = try String(contentsOf: sidecar, encoding: .utf8)
    #expect(text.matches(of: /<rdf:li>/).count == 4)
}

@Test func sidecarUpdatePreservesForeignTags() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    // A sidecar Lightroom might have written: rating plus other tags.
    let arw = dir.appendingPathComponent("DSC00002.ARW")
    try Data("fake".utf8).write(to: arw)
    let sidecar = XMP.sidecarURL(forImagePath: arw.path)
    try ExifTool.shared.write([
        "-XMP:Rating=1", "-XMP:Label=Blue", "-XMP:Title=Keeper", "-o", sidecar.path,
    ])

    try XMP.writeRating(5, file: try image(arw))

    #expect(XMP.read(file: try image(arw)).rating == 5)
    #expect(
        try exiftoolTag("-XMP:Label", of: sidecar) == "Blue",
        "existing Lightroom tags must survive our writes")
    #expect(try exiftoolTag("-XMP:Title", of: sidecar) == "Keeper")
}

@Test func exifToolRejectsNewlineArguments() {
    // The stay_open protocol is newline-delimited, so a newline in an
    // argument would inject extra flags into exiftool (`-config` loads
    // arbitrary Perl). Newlines are legal in paths, so this guards a real
    // filename and a hostile request alike — and needs no exiftool binary,
    // the guard fires before the daemon is touched.
    #expect(throws: ExifTool.ExifToolError.self) {
        try ExifTool.shared.execute(["-XMP:Rating=5", "/tmp/out\n-config\n/tmp/evil.config"])
    }
}

@Test func embeddedJPEGRatingAndEditRoundTrip() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let jpg = dir.appendingPathComponent("DSC00003.JPG")
    try writeGrayJPEG(to: jpg)

    try XMP.writeRating(3, file: try image(jpg))
    let edit = Edit(
        exposure: 0.5, shadows: 25, whites: -15, blacks: 40, dehaze: 12.5,
        temperature: 30, tint: -10, saturation: 15,
        curveRGB: [CurvePoint(x: 0, y: 0), CurvePoint(x: 0.25, y: 0.2), CurvePoint(x: 1, y: 1)])
    try XMP.writeEdit(edit, file: try image(jpg))

    #expect(XMP.read(file: try image(jpg)).rating == 3)
    let read = XMP.read(file: try image(jpg)).edit
    #expect(read.exposure == 0.5)
    #expect(read.shadows == 25)
    #expect(read.whites == -15)
    #expect(read.blacks == 40)
    #expect(read.dehaze == 12.5, "Dehaze is a real tag, so a foreign fraction survives")
    #expect(read.temperature == 30)
    #expect(read.tint == -10)
    #expect(read.saturation == 15)
    #expect(read.curveRGB.count == 3)
    #expect(try exiftoolTag("-XMP:Rating", of: jpg) == "3")
    #expect(try exiftoolTag("-XMP-crs:Exposure2012", of: jpg) == "0.5")
    // Embedded formats have no known as-shot neutral, so the incremental tags.
    #expect(try exiftoolTag("-XMP-crs:IncrementalTemperature", of: jpg) == "30")
    #expect(try exiftoolTag("-XMP-crs:IncrementalTint", of: jpg) == "-10")
    // No sidecar for embedded formats, no backup litter.
    let contents = try FileManager.default.contentsOfDirectory(atPath: dir.path)
    #expect(contents == ["DSC00003.JPG"])
}

@Test func ratingZeroClearsTheTag() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let jpg = dir.appendingPathComponent("DSC00004.JPG")
    try writeGrayJPEG(to: jpg)
    try XMP.writeRating(5, file: try image(jpg))
    try XMP.writeRating(0, file: try image(jpg))

    #expect(XMP.read(file: try image(jpg)).rating == 0)
    #expect(try exiftoolTag("-XMP:Rating", of: jpg).isEmpty)
}

@Test func sameStemFilesAreIndependentPhotos() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    // One stem, two photos: rating the raw must not touch the JPEG's rating.
    let arw = dir.appendingPathComponent("DSC00005.ARW")
    try Data("fake".utf8).write(to: arw)
    let jpg = dir.appendingPathComponent("DSC00005.JPG")
    try writeGrayJPEG(to: jpg)

    try XMP.writeRating(4, file: try image(arw))
    try XMP.writeRating(2, file: try image(jpg))

    #expect(XMP.read(file: try image(arw)).rating == 4)
    #expect(XMP.read(file: try image(jpg)).rating == 2)
}

@Test func libraryServiceRatingAndEditEndToEnd() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let shoot = dir.appendingPathComponent("2026-01-01_xmptest")
    try FileManager.default.createDirectory(at: shoot, withIntermediateDirectories: true)
    let arw = shoot.appendingPathComponent("DSC00010.ARW")
    try Data("fake".utf8).write(to: arw)
    let jpg = shoot.appendingPathComponent("DSC00010.JPG")
    try writeGrayJPEG(to: jpg)

    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)

    let result = try service.setRating(shoot: "2026-01-01_xmptest", path: arw.path, rating: 4)
    #expect(result.rating == 4)
    let edit = Edit(
        exposure: 1.25, highlights: -30, vibrance: 20,
        curveRGB: [CurvePoint(x: 0, y: 0), CurvePoint(x: 0.5, y: 0.55), CurvePoint(x: 1, y: 1)])
    _ = try service.setEdit(shoot: "2026-01-01_xmptest", path: jpg.path, edit: edit)

    // Snapshot updated immediately, per file — the JPEG's rating stays 0.
    let images = try service.listImages(shoot: "2026-01-01_xmptest")
    #expect(images.first { $0.path == arw.path }?.rating == 4)
    #expect(images.first { $0.path == jpg.path }?.rating == 0)
    #expect(images.first { $0.path == jpg.path }?.edit.exposure == 1.25)
    #expect(images.first { $0.path == jpg.path }?.edit.highlights == -30)

    // Disk agrees: sidecar for the raw, embedded for the JPG — both verified
    // through the independent exiftool read (the Lightroom proxy).
    let sidecar = shoot.appendingPathComponent("DSC00010.xmp")
    #expect(try exiftoolTag("-XMP:Rating", of: sidecar) == "4")
    #expect(try exiftoolTag("-XMP-crs:Exposure2012", of: jpg) == "1.25")

    // A fresh scan (new service, no snapshot) reads the same values back.
    let fresh = makeService(in: dir)
    _ = try fresh.setRoot(path: dir.path, indexPath: nil)
    waitUntilIndexed(fresh)
    let rescanned = try fresh.listImages(shoot: "2026-01-01_xmptest")
    #expect(rescanned.first { $0.path == arw.path }?.rating == 4)
    let rescannedEdit = try #require(rescanned.first { $0.path == jpg.path }?.edit)
    #expect(rescannedEdit.exposure == 1.25)
    #expect(rescannedEdit.vibrance == 20)
    #expect(rescannedEdit.curveRGB.count == 3)

    #expect(throws: LibraryService.ServiceError.self) {
        try service.setRating(shoot: "2026-01-01_xmptest", path: arw.path, rating: 9)
    }
    #expect(throws: LibraryService.ServiceError.self) {
        try service.setRating(
            shoot: "2026-01-01_xmptest", path: shoot.appendingPathComponent("NOPE.ARW").path,
            rating: 1)
    }
}

/// Writing to a JPEG changes its mtime and size, which is how the scorer spots
/// a file that really changed. Our own metadata writes must not read that way,
/// or every slider commit knocks the photo out of the sort by score.
@Test func editingAPhotoKeepsItsScore() async throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }

    let shoot = dir.appendingPathComponent("2026-01-01_instinct")
    try FileManager.default.createDirectory(at: shoot, withIntermediateDirectories: true)
    for name in ["a.JPG", "b.JPG", "c.JPG"] {
        try writeGrayJPEG(to: shoot.appendingPathComponent(name))
    }

    let service = makeService(in: dir)
    _ = try service.setRoot(path: dir.path, indexPath: nil)
    waitUntilIndexed(service)

    _ = try service.scoreShoot(shoot: "2026-01-01_instinct")
    try await waitForPass { try service.scoreShoot(shoot: "2026-01-01_instinct").running }
    let before = try service.listImages(shoot: "2026-01-01_instinct")
    let target = shoot.appendingPathComponent("b.JPG").path
    let score = try #require(before.first { $0.path == target }?.score)

    _ = try service.setEdit(
        shoot: "2026-01-01_instinct", path: target, edit: Edit(exposure: 0.5))

    let after = try service.listImages(shoot: "2026-01-01_instinct")
    #expect(after.first { $0.path == target }?.score == score)
    let progress = try service.scoreShoot(shoot: "2026-01-01_instinct")
    #expect(progress.running == false)
    #expect(progress.done == progress.total)
}

@Test func theAppFindsTheExiftoolBundledBesideIt() throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("photopipe-bundle-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let app = root.appendingPathComponent("Photopipe.app/Contents")
    let tool = app.appendingPathComponent("Resources/exiftool/exiftool")
    try FileManager.default.createDirectory(
        at: tool.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data("#!/usr/bin/perl\n".utf8).write(to: tool)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: tool.path)

    let executable = app.appendingPathComponent("MacOS/Photopipe")
    #expect(ExifTool.bundledBinary(executable: executable) == tool.path)
}

@Test func textWriterSavesAJPEGInItsOwnSidecarApartFromItsRaw() throws {
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let arw = dir.appendingPathComponent("DSC00020.ARW")
    let jpg = dir.appendingPathComponent("DSC00020.JPG")
    try Data("fake".utf8).write(to: arw)
    try writeGrayJPEG(to: jpg)
    let original = try Data(contentsOf: jpg)

    try writeTextRating(1, at: arw)
    try writeTextRating(4, at: jpg)
    try writeTextEdit(Edit(exposure: 0.5), at: jpg)

    #expect(
        FileManager.default.fileExists(
            atPath: dir.appendingPathComponent("DSC00020.JPG.photopipe.xmp").path))
    #expect(try Data(contentsOf: jpg) == original)
    let read = XMP.read(file: try image(jpg))
    #expect(read.rating == 4)
    #expect(read.edit.exposure == 0.5)
    #expect(XMP.read(file: try image(arw)).rating == 1)
}

@Test func aStartedSidecarKeepsWhatTheJPEGCarried() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let jpg = dir.appendingPathComponent("DSC00021.JPG")
    try writeGrayJPEG(to: jpg)
    try XMP.writeRating(3, file: try image(jpg))
    try XMP.writeEdit(Edit(exposure: 0.5, rotation: 90), file: try image(jpg))

    try writeTextRating(5, at: jpg)
    var read = XMP.read(file: try image(jpg))
    #expect(read.rating == 5)
    #expect(read.edit.exposure == 0.5)
    #expect(read.edit.rotation == 90)

    try writeTextEdit(.identity, at: jpg)
    read = XMP.read(file: try image(jpg))
    #expect(read.edit.isIdentity)
    #expect(read.rating == 5)
}

@Test func clearingAJPEGsRatingFirstStillHidesTheEmbeddedOne() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let jpg = dir.appendingPathComponent("DSC00022.JPG")
    try writeGrayJPEG(to: jpg)
    try XMP.writeRating(3, file: try image(jpg))

    try writeTextRating(0, at: jpg)
    #expect(XMP.read(file: try image(jpg)).rating == 0)
}

@Test func theMacWritesIntoAJPEGSidecarTheIPadStarted() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let jpg = dir.appendingPathComponent("DSC00023.JPG")
    try writeGrayJPEG(to: jpg)
    try writeTextRating(4, at: jpg)

    try XMP.writeRating(2, file: try image(jpg))
    #expect(XMP.read(file: try image(jpg)).rating == 2)
    #expect(try exiftoolTag("-XMP:Rating", of: jpg) == "")
    #expect(
        try exiftoolTag("-XMP:Rating", of: XMP.sidecarURL(forImagePath: jpg.path)) == "2")
}

@Test(arguments: ["HEIC", "TIF"])
func theMacNeverWritesIntoAnUntestedFormatButKeepsWhatItCarried(_ ext: String) throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let photo = dir.appendingPathComponent("IMG_0025.\(ext)")
    let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
    if ext == "HEIC" {
        try CIContext().writeHEIFRepresentation(of: gray, to: photo, format: .RGBA8, colorSpace: srgb)
    } else {
        try CIContext().writeTIFFRepresentation(of: gray, to: photo, format: .RGBA8, colorSpace: srgb)
    }
    try ExifTool.shared.write(["-overwrite_original", "-XMP:Rating=2", photo.path])
    let original = try Data(contentsOf: photo)
    #expect(XMP.read(file: try image(photo)).rating == 2)

    try XMP.writeEdit(Edit(exposure: 0.5), file: try image(photo))
    #expect(XMP.read(file: try image(photo)).rating == 2)
    try XMP.writeRating(5, file: try image(photo))

    #expect(try Data(contentsOf: photo) == original)
    #expect(
        XMP.sidecarURL(forImagePath: photo.path).lastPathComponent
            == "IMG_0025.\(ext).photopipe.xmp")
    let read = XMP.read(file: try image(photo))
    #expect(read.rating == 5 && read.edit.exposure == 0.5)
}

@Test func anotherToolsJPEGSidecarAndASymlinkAreNotOurs() throws {
    guard requireExifTool() else { return }
    let dir = try tempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let jpg = dir.appendingPathComponent("DSC00024.JPG")
    try writeGrayJPEG(to: jpg)
    try XMP.writeRating(3, file: try image(jpg))
    try Data("<x:xmpmeta xmlns:x='adobe:ns:meta/'/>".utf8)
        .write(to: dir.appendingPathComponent("DSC00024.JPG.xmp"))
    let outside = dir.appendingPathComponent("outside.xmp")
    try FileManager.default.createSymbolicLink(
        at: XMP.sidecarURL(forImagePath: jpg.path), withDestinationURL: outside)

    #expect(XMP.read(file: try image(jpg)).rating == 3)
    try XMP.writeRating(4, file: try image(jpg))
    #expect(XMP.read(file: try image(jpg)).rating == 4)
    #expect(!FileManager.default.fileExists(atPath: outside.path))

    let foreign = Data(
        "<x:xmpmeta xmlns:x='adobe:ns:meta/'><rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'><rdf:Description xmlns:crs='http://ns.adobe.com/camera-raw-settings/1.0/' crs:Exposure2012='2'/></rdf:RDF></x:xmpmeta>"
            .utf8)
    try foreign.write(to: outside)
    try writeTextRating(5, at: jpg)
    let read = XMP.read(file: try image(jpg))
    #expect(read.rating == 5)
    #expect(read.edit.exposure == 0)
    #expect(try Data(contentsOf: outside) == foreign)
}
