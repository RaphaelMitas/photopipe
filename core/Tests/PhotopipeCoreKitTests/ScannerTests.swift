import Foundation
import Testing

@testable import PhotopipeCoreKit

// MARK: - Fixtures

/// Builds a temp photo tree: [shootName: [relative file paths]] → root URL.
func makeTree(_ layout: [String: [String]]) throws -> URL {
    let root = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("photopipe-test-\(UUID().uuidString)")
    for (shoot, paths) in layout {
        for relative in paths {
            let file = root.appendingPathComponent(shoot).appendingPathComponent(relative)
            try FileManager.default.createDirectory(
                at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data("x".utf8).write(to: file)
        }
    }
    return root
}

// MARK: - Stage

@Test func stageDerivesFromExtensionCaseInsensitively() {
    #expect(Stage(fileExtension: "ARW") == .raw)
    #expect(Stage(fileExtension: "dng") == .denoised)
    #expect(Stage(fileExtension: "JPG") == .export)
    #expect(Stage(fileExtension: "jpeg") == .export)
    #expect(Stage(fileExtension: "png") == .export)
    #expect(Stage(fileExtension: "xmp") == nil)
    #expect(Stage(fileExtension: "mov") == nil)
}

// MARK: - Shoot name parsing

@Test func shootNameParsesDayAndProject() throws {
    let parsed = try #require(parseShootName("2026-07-12_zell"))
    #expect(parsed.day == "2026-07-12")
    #expect(parsed.project == "zell")
}

@Test func shootNameAllowsUnderscoresInProject() throws {
    let parsed = try #require(parseShootName("2026-01-03_brand_shoot_v2"))
    #expect(parsed.project == "brand_shoot_v2")
}

@Test func nonConventionShootNamesParseAsNil() {
    #expect(parseShootName("random-folder") == nil)
    #expect(parseShootName("2026-7-12_zell") == nil)
    #expect(parseShootName("2026-07-12") == nil)
}

// MARK: - Lineage

@Test func lineageGroupsByStemAcrossStagesAndFolders() {
    let files = [
        FileRecord(path: "/s/DSC001.ARW", ext: "ARW", stage: .raw, size: 1, mtime: 1),
        FileRecord(path: "/s/denoised/DSC001.dng", ext: "dng", stage: .denoised, size: 1, mtime: 2),
        FileRecord(path: "/s/exports/DSC001.jpg", ext: "jpg", stage: .export, size: 1, mtime: 3),
        FileRecord(path: "/s/DSC002.ARW", ext: "ARW", stage: .raw, size: 1, mtime: 1),
    ]
    let groups = buildImageGroups(files: files)
    #expect(groups.count == 2)
    let first = groups[0]
    #expect(first.stem == "DSC001")
    #expect(first.stage == .export)
    #expect(first.files.map(\.stage) == [.raw, .denoised, .export])
    #expect(groups[1].stage == .raw)
}

@Test func lineageStemMatchingIsCaseInsensitive() {
    let files = [
        FileRecord(path: "/s/dsc001.arw", ext: "arw", stage: .raw, size: 1, mtime: 1),
        FileRecord(path: "/s/DSC001.JPG", ext: "JPG", stage: .export, size: 1, mtime: 2),
    ]
    #expect(buildImageGroups(files: files).count == 1)
}

@Test func displayFilePrefersFurthestStage() {
    let files = [
        FileRecord(path: "/s/DSC001.ARW", ext: "ARW", stage: .raw, size: 1, mtime: 1),
        FileRecord(path: "/s/DSC001.dng", ext: "dng", stage: .denoised, size: 1, mtime: 2),
    ]
    let group = buildImageGroups(files: files)[0]
    #expect(group.displayFile?.ext == "dng")
}

@Test func stageCountsCountLogicalImagesNotFiles() {
    let files = [
        FileRecord(path: "/s/DSC001.ARW", ext: "ARW", stage: .raw, size: 1, mtime: 1),
        FileRecord(path: "/s/DSC001.jpg", ext: "jpg", stage: .export, size: 1, mtime: 2),
        FileRecord(path: "/s/DSC002.ARW", ext: "ARW", stage: .raw, size: 1, mtime: 1),
    ]
    let counts = stageCounts(images: buildImageGroups(files: files))
    #expect(counts == ["raw": 1, "denoised": 0, "export": 1])
}

// MARK: - Scanning real directories

@Test func scanFindsShootsGroupsLineagesAndSkipsJunk() throws {
    let root = try makeTree([
        "2026-07-12_zell": [
            "DSC001.ARW", "DSC001.dng", "exports/DSC001.jpg",
            "DSC002.ARW",
            "notes.txt", "meta.xmp",
        ],
        "2026-08-01_beach": ["IMG_1.ARW"],
        "not-a-shoot": ["readme.md"],
    ])
    defer { try? FileManager.default.removeItem(at: root) }

    let snapshot = try scanLibrary(root: root.path)
    // not-a-shoot has no pipeline files → dropped entirely
    #expect(snapshot.shoots.map(\.name) == ["2026-08-01_beach", "2026-07-12_zell"])
    #expect(snapshot.fileCount == 5)

    let zell = try #require(snapshot.imagesByShoot["2026-07-12_zell"])
    #expect(zell.count == 2)
    #expect(zell[0].files.count == 3)
    #expect(snapshot.shoots[1].counts == ["raw": 1, "denoised": 0, "export": 1])
}

@Test func scanSortsNewestDayFirstUndatedLast() throws {
    let root = try makeTree([
        "2026-01-01_old": ["a.ARW"],
        "2026-12-31_new": ["b.ARW"],
        "misc": ["c.ARW"],
    ])
    defer { try? FileManager.default.removeItem(at: root) }

    let names = try scanLibrary(root: root.path).shoots.map(\.name)
    #expect(names == ["2026-12-31_new", "2026-01-01_old", "misc"])
}

@Test func scanMissingRootThrows() {
    #expect(throws: ScanError.self) {
        try scanLibrary(root: "/nonexistent/path/\(UUID().uuidString)")
    }
}
