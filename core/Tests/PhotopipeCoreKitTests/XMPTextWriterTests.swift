import Foundation
import Testing

@testable import PhotopipeCoreKit

private let fixtures = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent("fixtures/sidecars")

// the oracle: what another tool reads back
private func exiftoolDump(_ url: URL) throws -> String {
    let json = try ExifTool.shared.execute(["-q", "-j", "-G1", "-struct", "-a", url.path])
    let parsed = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: Any]]
    let tags = try #require(parsed?.first).filter { key, _ in
        key != "SourceFile" && key != "XMP-x:XMPToolkit"
            && !["System:", "File:", "ExifTool:"].contains { key.hasPrefix($0) }
    }
    let sorted = try JSONSerialization.data(
        withJSONObject: tags, options: [.sortedKeys, .prettyPrinted])
    return String(decoding: sorted, as: UTF8.self)
}

private struct Writers {
    let exiftool: URL
    let text: URL

    init(in dir: URL, fixture: String?) throws {
        exiftool = dir.appendingPathComponent("exiftool/DSC00001.ARW")
        text = dir.appendingPathComponent("text/DSC00001.ARW")
        for raw in [exiftool, text] {
            try FileManager.default.createDirectory(
                at: raw.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data("fake".utf8).write(to: raw)
            if let fixture {
                try FileManager.default.copyItem(
                    at: fixtures.appendingPathComponent("\(fixture).xmp"),
                    to: XMP.sidecarURL(forImagePath: raw.path))
            }
        }
    }

    func write(_ rating: Int) throws {
        try XMP.writeRating(rating, file: try image(exiftool), tool: .shared)
        try XMPTextWriter.write(
            XMP.ratingTags(rating), to: XMP.sidecarURL(forImagePath: text.path),
            clearing: rating == 0)
    }

    func write(_ edit: Edit) throws {
        try XMP.writeEdit(edit, file: try image(exiftool), tool: .shared)
        try XMPTextWriter.write(
            XMP.editTags(edit, file: try image(text)).tags,
            to: XMP.sidecarURL(forImagePath: text.path), clearing: edit.isIdentity)
    }

    func expectEqual(_ step: String) throws {
        let exiftoolSidecar = XMP.sidecarURL(forImagePath: exiftool.path)
        let textSidecar = XMP.sidecarURL(forImagePath: text.path)
        let exists = FileManager.default.fileExists(atPath: exiftoolSidecar.path)
        #expect(FileManager.default.fileExists(atPath: textSidecar.path) == exists, "\(step)")
        guard exists else { return }
        #expect(try exiftoolDump(textSidecar) == exiftoolDump(exiftoolSidecar), "\(step)")
    }
}

private let fullEdit = Edit(
    exposure: 1.5, highlights: -42, shadows: 18, whites: 30, blacks: -20,
    texture: 15, clarity: 22, dehaze: -8,
    temperature: 5600, tint: 12, denoise: 25, vibrance: 10, saturation: -5,
    curveRGB: [CurvePoint(x: 0, y: 0), CurvePoint(x: 0.5, y: 0.6), CurvePoint(x: 1, y: 1)],
    curveRed: [CurvePoint(x: 0, y: 0.1), CurvePoint(x: 1, y: 0.9)],
    crop: CropRect(left: 0.125, top: 0.00003, right: 0.9, bottom: 0.8), cropAngle: -1.5,
    rotation: 90)

private let changedEdit = Edit(
    exposure: -0.35, shadows: 60, temperature: 4100, tint: -3,
    curveRGB: [
        CurvePoint(x: 0, y: 0.05), CurvePoint(x: 0.25, y: 0.2), CurvePoint(x: 0.75, y: 0.85),
        CurvePoint(x: 1, y: 1),
    ],
    curveBlue: [CurvePoint(x: 0, y: 0), CurvePoint(x: 0.4, y: 0.5), CurvePoint(x: 1, y: 1)])

@Test(arguments: ["lightroom-masks", "exiftool-written", "empty-rdf", nil])
func textWriterMatchesExifTool(fixture: String?) throws {
    guard requireExifTool() else { return }
    let dir = scratchDir("xmp-text")
    defer { try? FileManager.default.removeItem(at: dir) }
    let writers = try Writers(in: dir, fixture: fixture)

    try writers.write(4)
    try writers.expectEqual("rating set")
    try writers.write(fullEdit)
    try writers.expectEqual("full edit")
    try writers.write(changedEdit)
    try writers.expectEqual("changed edit")
    try writers.write(0)
    try writers.expectEqual("rating clear")
    try writers.write(Edit.identity)
    try writers.expectEqual("all clear")
    try writers.write(fullEdit)
    try writers.expectEqual("edit after all clear")
}

@Test func textWriterAlternatesWithExifTool() throws {
    guard requireExifTool() else { return }
    let dir = scratchDir("xmp-text")
    defer { try? FileManager.default.removeItem(at: dir) }
    let writers = try Writers(in: dir, fixture: "lightroom-masks")

    try writers.write(fullEdit)
    try XMP.writeEdit(changedEdit, file: image(writers.exiftool), tool: .shared)
    try XMP.writeEdit(changedEdit, file: image(writers.text), tool: .shared)
    try writers.write(3)
    try writers.expectEqual("text, exiftool, text")
    #expect(XMP.readRating(file: try image(writers.text)) == 3)
}

@Test func textWriterLeavesNestedMaskTagsAlone() throws {
    let original = try Data(contentsOf: fixtures.appendingPathComponent("lightroom-masks.xmp"))
    let cleared = try XMPTextWriter.apply(
        [XMP.TagWrite(.crs, "ToneCurvePV2012", .remove)], to: Array(original))
    let text = String(decoding: cleared, as: UTF8.self)
    #expect(text.components(separatedBy: "<crs:ToneCurvePV2012>").count == 2)
    #expect(text.contains("crs:MaskName=\"Subject 1\""))
}

@Test func textWriterRefusesForeignPrefix() throws {
    let foreign = """
        <x:xmpmeta xmlns:x='adobe:ns:meta/'>
        <rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>
         <rdf:Description rdf:about='' xmlns:raw='http://ns.adobe.com/camera-raw-settings/1.0/'
          raw:Exposure2012='0.5'/>
        </rdf:RDF>
        </x:xmpmeta>
        """
    #expect(throws: XMPTextWriter.WriteError.self) {
        try XMPTextWriter.apply(XMP.ratingTags(3), to: Array(foreign.utf8))
    }
}

@Test func textWriterEditReadsBackFromLightroomSidecar() throws {
    let dir = scratchDir("xmp-text")
    defer { try? FileManager.default.removeItem(at: dir) }
    let raw = try Writers(in: dir, fixture: "lightroom-masks").text
    let edit = Edit(
        exposure: 0.5,
        curveRGB: [CurvePoint(x: 0, y: 0), CurvePoint(x: 0.4, y: 0.6), CurvePoint(x: 1, y: 1)],
        curveBlue: [CurvePoint(x: 0, y: 0.2), CurvePoint(x: 1, y: 0.8)])
    try XMPTextWriter.write(
        XMP.editTags(edit, file: try image(raw)).tags,
        to: XMP.sidecarURL(forImagePath: raw.path), clearing: false)
    let read = XMP.readEdit(file: try image(raw))
    #expect(read.curveRGB == edit.curveRGB)
    #expect(read.curveBlue == edit.curveBlue)
}

@Test func textWriterLeavesUnreadableSidecarAlone() throws {
    let dir = scratchDir("xmp-text")
    defer { try? FileManager.default.removeItem(at: dir) }
    let sidecar = XMP.sidecarURL(
        forImagePath: try Writers(in: dir, fixture: "lightroom-masks").text.path)
    let original = try Data(contentsOf: sidecar)
    try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: sidecar.path)
    #expect(throws: (any Error).self) {
        try XMPTextWriter.write(XMP.ratingTags(3), to: sidecar, clearing: false)
    }
    try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: sidecar.path)
    #expect(try Data(contentsOf: sidecar) == original)
}

@Test func textWriterRatingReadsBackFromSingleQuotedAttribute() throws {
    let compact = """
        <x:xmpmeta xmlns:x='adobe:ns:meta/'>
        <rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>
         <rdf:Description rdf:about='' xmlns:xmp='http://ns.adobe.com/xap/1.0/' xmp:Rating='3'/>
        </rdf:RDF>
        </x:xmpmeta>
        """
    let written = try XMPTextWriter.apply(XMP.ratingTags(5), to: Array(compact.utf8))
    #expect(XMP.parseRating(String(decoding: written, as: UTF8.self)) == 5)
}

@Test func textWriterRefusesForeignPrefixOnChildElement() throws {
    let foreign = """
        <x:xmpmeta xmlns:x='adobe:ns:meta/'>
        <rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>
         <rdf:Description rdf:about=''>
          <raw:Exposure2012 xmlns:raw='http://ns.adobe.com/camera-raw-settings/1.0/'>0.5</raw:Exposure2012>
         </rdf:Description>
        </rdf:RDF>
        </x:xmpmeta>
        """
    #expect(throws: XMPTextWriter.WriteError.self) {
        try XMPTextWriter.apply(XMP.ratingTags(3), to: Array(foreign.utf8))
    }
}
