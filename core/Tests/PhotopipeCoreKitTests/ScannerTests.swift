import Foundation
import Testing

@testable import PhotopipeCoreKit

// MARK: - Fixtures

/// Symlink-free scratch space for library fixtures. NSTemporaryDirectory sits
/// behind the /var → /private/var symlink, and the service's path-identity
/// lookups compare canonical strings — a symlinked root would test the
/// symlink, not the code.
func scratchDir(_ prefix: String) -> URL {
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("photopipe-tests/\(prefix)-\(UUID().uuidString)")
}

/// `setRoot` returns as soon as the tree is walked, so anything that asserts on
/// ratings, edits, dimensions or a settled generation has to wait for the
/// background enrichment to land first.
func waitUntilIndexed(
    _ service: LibraryService, timeout: TimeInterval = 10,
    sourceLocation: SourceLocation = #_sourceLocation
) {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline, service.status().scanning {
        Thread.sleep(forTimeInterval: 0.02)
    }
    // Loudly: a counter that never reaches its total is a bug in its own right,
    // and swallowing it here would let every assertion below pass on stale data.
    let status = service.status()
    #expect(
        !status.scanning,
        "indexing never finished: \(status.filesEnriched)/\(status.filesFound)",
        sourceLocation: sourceLocation)
}

/// Caches under the fixture's own directory, so one test's thumbnails and
/// renders can never be served to another.
func makeService(in dir: URL) -> LibraryService {
    LibraryService(
        thumbnailer: Thumbnailer(cacheDir: dir.appendingPathComponent("thumbs")),
        renderer: Renderer(cacheDir: dir.appendingPathComponent("renders")))
}

/// Builds a scratch photo tree: [shootName: [relative file paths]] → root URL.
func makeTree(_ layout: [String: [String]]) throws -> URL {
    let root = scratchDir("tree")
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

// MARK: - Image files

@Test func imagePathsAreRecognizedCaseInsensitively() {
    #expect(isImagePath("/s/DSC001.ARW"))
    #expect(isImagePath("/s/DSC001.dng"))
    #expect(isImagePath("/s/deep/nested/DSC001.JPG"))
    #expect(isImagePath("/s/x.jpeg"))
    #expect(isImagePath("/s/x.png"))
    #expect(!isImagePath("/s/DSC001.xmp"))
    #expect(!isImagePath("/s/clip.mov"))
    #expect(!isImagePath("/s/notes.txt"))
}

// MARK: - Day format

@Test func isDayAcceptsOnlyIsoDates() {
    #expect(isDay("2026-07-12"))
    #expect(!isDay("2026-7-12"))
    #expect(!isDay("random"))
    #expect(!isDay("2026-07-12_zell"))
}

// MARK: - Scanning real directories

@Test func scanFindsEveryImageRecursivelyWithRelPaths() throws {
    let root = try makeTree([
        "2026-07-12_zell": [
            "DSC001.ARW", "DSC001.jpg",
            "selects/DSC002.ARW",
            "selects/deep/DSC003.dng",
            "notes.txt", "meta.xmp",
        ],
        "2026-08-01_beach": ["IMG_1.ARW"],
        "not-a-shoot": ["readme.md"],
    ])
    defer { try? FileManager.default.removeItem(at: root) }

    let snapshot = try walkLibrary(root: root.path)
    // not-a-shoot has no images and no photopipe.json → dropped entirely.
    // Both are undated (no photopipe.json), so they sort by name.
    #expect(snapshot.shoots.map(\.name) == ["2026-07-12_zell", "2026-08-01_beach"])
    #expect(snapshot.fileCount == 5)

    let zell = try #require(snapshot.imagesByShoot["2026-07-12_zell"])
    // One file = one image, wherever it sits; sorted by rel.
    #expect(
        zell.map(\.rel) == [
            "DSC001.ARW", "DSC001.jpg", "selects/deep/DSC003.dng", "selects/DSC002.ARW",
        ])
    let nested = try #require(zell.first { $0.rel == "selects/DSC002.ARW" })
    #expect(nested.path == root.appendingPathComponent("2026-07-12_zell/selects/DSC002.ARW").path)
    #expect(nested.ext == "ARW")
    #expect(snapshot.shoots.first { $0.name == "2026-07-12_zell" }?.imageCount == 4)
}

@Test func scanSortsNewestDayFirstUndatedLast() throws {
    // The date is metadata, not the folder name: the sort reads photopipe.json.
    let root = try makeTree([
        "old": ["a.ARW"],
        "new": ["b.ARW"],
        "misc": ["c.ARW"],
    ])
    defer { try? FileManager.default.removeItem(at: root) }
    try ProjectFile(day: "2026-01-01").write(inShoot: root.appendingPathComponent("old").path)
    try ProjectFile(day: "2026-12-31").write(inShoot: root.appendingPathComponent("new").path)

    let names = try walkLibrary(root: root.path).shoots.map(\.name)
    #expect(names == ["new", "old", "misc"])
}

@Test func scanMissingRootThrows() {
    #expect(throws: ScanError.self) {
        try walkLibrary(root: "/nonexistent/path/\(UUID().uuidString)")
    }
}
