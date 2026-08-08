import CoreImage
import Foundation
import Testing

@testable import PhotopipeCoreKit

@Test func dimensionsFromRealARWHeader() throws {
    let fixture = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("fixtures/raw/sony-a7iv.arw")
    guard FileManager.default.fileExists(atPath: fixture.path) else {
        #expect(
            ProcessInfo.processInfo.environment["CI"] == nil,
            "real-ARW fixture missing on CI — run fixtures/fetch.sh before swift test")
        print("SKIP: run fixtures/fetch.sh for dimension tests")
        return
    }
    let dims = Dimensions.read(at: fixture)
    let unwrapped = try #require(dims)
    #expect(unwrapped.width > 1000 && unwrapped.height > 1000, "got \(unwrapped)")
}

@Test func dimensionsOfKnownJPEGIncludingOrientation() throws {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("photopipe-dims-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }

    // 64x32 landscape JPEG.
    let gray = CIImage(color: CIColor(red: 0.5, green: 0.5, blue: 0.5))
        .cropped(to: CGRect(x: 0, y: 0, width: 64, height: 32))
    let plain = dir.appendingPathComponent("plain.jpg")
    try CIContext().writeJPEGRepresentation(
        of: gray, to: plain, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
    let dims = try #require(Dimensions.read(at: plain))
    #expect(dims.width == 64 && dims.height == 32)

    // Same pixels with EXIF orientation 6 (90° CW): upright dims must swap.
    guard ExifTool.shared.available else {
        print("SKIP: exiftool needed for the orientation case")
        return
    }
    let rotated = dir.appendingPathComponent("rotated.jpg")
    try FileManager.default.copyItem(at: plain, to: rotated)
    try ExifTool.shared.write(["-overwrite_original", "-Orientation#=6", rotated.path])
    let rotatedDims = try #require(Dimensions.read(at: rotated))
    #expect(rotatedDims.width == 32 && rotatedDims.height == 64, "got \(rotatedDims)")
}

@Test func unreadableFilesFallBackToThreeTwo() throws {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("photopipe-dims-fake-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }
    let fake = dir.appendingPathComponent("DSC.ARW")
    try Data("fake".utf8).write(to: fake)

    #expect(Dimensions.read(at: fake) == nil)
    let record = FileRecord(path: fake.path, ext: "arw", stage: .raw, size: 4, mtime: 1)
    let dims = Dimensions.forGroup(files: [record])
    #expect(dims.width == 3000 && dims.height == 2000)
}
