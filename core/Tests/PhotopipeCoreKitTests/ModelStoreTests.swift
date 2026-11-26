import CoreImage
import CoreML
import CryptoKit
import Foundation
import Synchronization
import Testing

@testable import PhotopipeCoreKit

private final class Served: URLProtocol, @unchecked Sendable {
    enum Reply: Sendable {
        case body(Data)
        case status(Int)
        case hang
        case held(Data, DispatchSemaphore)
    }

    static let replies = Mutex<[URL: Reply]>([:])
    static let requests = Mutex<[URL: Int]>([:])
    static let stopped = Mutex<Set<URL>>([])

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url, let reply = Self.replies.withLock({ $0[url] }) else {
            client?.urlProtocol(self, didFailWithError: URLError(.fileDoesNotExist))
            return
        }
        Self.requests.withLock { $0[url, default: 0] += 1 }
        let status: Int
        switch reply {
        case .status(let code): status = code
        default: status = 200
        }
        client?.urlProtocol(
            self,
            didReceive: HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!,
            cacheStoragePolicy: .notAllowed)
        switch reply {
        case .body(let data):
            client?.urlProtocol(self, didLoad: data)
        case .held(let data, let gate):
            gate.wait()
            client?.urlProtocol(self, didLoad: data)
        case .hang:
            return
        case .status:
            break
        }
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {
        guard let url = request.url else { return }
        Self.stopped.withLock { _ = $0.insert(url) }
    }
}

private let fillFixture = fixturesRoot().appendingPathComponent("models/Fill.mlpackage")

private final class Harness {
    let folder: URL
    let entry: ModelEntry
    let store: ModelStore
    let files: [(ModelFile, Data)]

    init(body: (ModelFile, Data) -> Served.Reply = { .body($1) }) throws {
        folder = scratchDir("models")
        let package = fillFixture
        let host = "https://\(UUID().uuidString).test/"
        files = try ["Manifest.json", "Data/com.apple.CoreML/model.mlmodel"].map { path in
            let data = try Data(contentsOf: package.appendingPathComponent(path))
            let file = ModelFile(
                url: URL(string: host + path.replacingOccurrences(of: "/", with: "-"))!, path: path,
                sha256: SHA256.hash(data: data).hex, bytes: data.count)
            return (file, data)
        }
        entry = ModelEntry(
            id: "fill-test", name: "Fill", licence: "MIT", runner: .lama1024,
            files: files.map(\.0))
        for (file, data) in files {
            Served.replies.withLock { $0[file.url] = body(file, data) }
        }
        store = ModelStore(
            folder: folder, catalog: [entry],
            transfer: Transfer {
                let configuration = URLSessionConfiguration.ephemeral
                configuration.protocolClasses = [Served.self]
                return configuration
            })
    }

    deinit {
        try? FileManager.default.removeItem(at: folder)
    }

    var report: ModelReport { store.entries()[0] }

    var installed: URL { folder.appendingPathComponent(entry.folderName) }

    func settle() async throws -> ModelReport {
        for _ in 0..<1000 where [.downloading, .preparing].contains(report.state) {
            try await Task.sleep(for: .milliseconds(10))
        }
        return report
    }

    func requests(_ index: Int) -> Int {
        Served.requests.withLock { $0[files[index].0.url] ?? 0 }
    }
}

@Test func aDownloadRebuildsThePackageCompilesItAndLendsTheModel() async throws {
    let harness = try Harness()
    #expect(harness.report.state == .absent)

    try harness.store.download("fill-test")
    let report = try await harness.settle()

    #expect(report.state == .ready, "\(report)")
    #expect(
        FileManager.default.fileExists(
            atPath: harness.installed.appendingPathComponent("model.mlmodelc").path))
    let inputs = try harness.store.lend("fill-test") {
        Set($0.modelDescription.inputDescriptionsByName.keys)
    }
    #expect(inputs == ["image", "mask"])
}

@Test func aStartWhileOneRunsIsTheSameDownload() async throws {
    let gate = DispatchSemaphore(value: 0)
    let harness = try Harness { file, data in
        file.path == "Manifest.json" ? .held(data, gate) : .body(data)
    }

    try harness.store.download("fill-test")
    try harness.store.download("fill-test")
    gate.signal()
    #expect(try await harness.settle().state == .ready)
    #expect(harness.requests(0) == 1)
}

@Test func aFileThatDoesNotMatchItsHashFailsAndInstallsNothing() async throws {
    let harness = try Harness { file, data in
        file.path == "Manifest.json" ? .body(Data(data.reversed())) : .body(data)
    }

    try harness.store.download("fill-test")
    let report = try await harness.settle()

    #expect(report.state == .failed)
    #expect(report.reason == "Manifest.json does not match the catalog")
    #expect(!FileManager.default.fileExists(atPath: harness.installed.path))
}

@Test func aFileLargerThanTheCatalogSaysIsCutOff() async throws {
    let harness = try Harness { file, data in
        file.path == "Manifest.json" ? .body(data + Data(count: 1 << 20)) : .body(data)
    }

    try harness.store.download("fill-test")
    let report = try await harness.settle()

    #expect(report.state == .failed)
    #expect(report.reason == "Manifest.json is larger than the catalog says")
}

@Test func aServerErrorFailsWithItsStatus() async throws {
    let harness = try Harness { _, _ in .status(404) }

    try harness.store.download("fill-test")

    #expect(try await harness.settle().reason == "server answered 404")
}

@Test func aPathThatLeavesThePackageIsRefused() async throws {
    let harness = try Harness()
    let escaping = ModelEntry(
        id: "escaping", name: "Escaping", licence: "MIT", runner: .lama1024,
        files: [
            ModelFile(
                url: harness.files[0].0.url, path: "../../escaped.json",
                sha256: harness.files[0].0.sha256, bytes: harness.files[0].0.bytes)
        ])
    let store = ModelStore(folder: harness.folder, catalog: [escaping])

    try store.download("escaping")
    for _ in 0..<500 where store.entries()[0].state == .downloading {
        try await Task.sleep(for: .milliseconds(10))
    }

    #expect(store.entries()[0].reason == "../../escaped.json is outside the model package")
}

@Test func cancelStopsTheTransferAndADownloadCanStartAgain() async throws {
    let harness = try Harness { file, data in
        file.path == "Manifest.json" ? .hang : .body(data)
    }
    try harness.store.download("fill-test")
    for _ in 0..<500 where harness.requests(0) == 0 {
        try await Task.sleep(for: .milliseconds(10))
    }
    #expect(harness.report.state == .downloading)

    try harness.store.cancel("fill-test")
    #expect(harness.report.state == .absent)
    let manifest = harness.files[0].0.url
    for _ in 0..<500 where !Served.stopped.withLock({ $0.contains(manifest) }) {
        try await Task.sleep(for: .milliseconds(10))
    }
    #expect(Served.stopped.withLock { $0.contains(manifest) })

    Served.replies.withLock { $0[harness.files[0].0.url] = .body(harness.files[0].1) }
    try harness.store.download("fill-test")
    #expect(try await harness.settle().state == .ready)
}

@Test func aFolderForOtherHashesIsLeftAlone() async throws {
    let harness = try Harness()
    let other = harness.folder.appendingPathComponent("fill-test-000000000000")
    try FileManager.default.createDirectory(at: other, withIntermediateDirectories: true)

    #expect(harness.report.state == .absent)
    try harness.store.delete("fill-test")
    #expect(FileManager.default.fileExists(atPath: other.path))
}

@Test func deleteIsRefusedDuringAFillAndRemovesAnIdleModel() async throws {
    let harness = try Harness()
    try harness.store.download("fill-test")
    _ = try await harness.settle()

    let refused = try harness.store.lend("fill-test") { _ in
        #expect(throws: ModelError.inUse("fill-test")) { try harness.store.delete("fill-test") }
        return true
    }
    #expect(refused)

    try harness.store.delete("fill-test")
    #expect(harness.report.state == .absent)
    #expect(!FileManager.default.fileExists(atPath: harness.installed.path))
}

@Test func aModelThatWillNotLoadKeepsItsFiles() async throws {
    let harness = try Harness()
    try harness.store.download("fill-test")
    _ = try await harness.settle()
    let compiled = harness.installed.appendingPathComponent("model.mlmodelc")
    try Data("broken".utf8).write(to: compiled.appendingPathComponent("coremldata.bin"))

    #expect(throws: ModelError.self) { try harness.store.lend("fill-test") { _ in } }

    #expect(harness.report.state == .ready)
    #expect(harness.report.loadError != nil)
    #expect(FileManager.default.fileExists(atPath: compiled.path))
}

@Test func catalogEntriesAreWellFormedAndShippedHashesStayFrozen() {
    let shipped = ["lama-1": "lama-1-9dac752d50c7"]
    let entries = ModelEntry.catalog
    #expect(Set(entries.map(\.id)).count == entries.count)
    for entry in entries {
        #expect(Set(entry.files.map(\.path)).count == entry.files.count)
        for file in entry.files {
            #expect(file.url.scheme == "https")
            #expect(file.sha256.count == 64 && file.sha256.allSatisfy(\.isHexDigit))
            #expect(file.bytes > 0)
            #expect(file.isInsidePackage)
        }
        #expect(!entry.licence.isEmpty)
        if let frozen = shipped[entry.id] { #expect(entry.folderName == frozen) }
    }
    #expect(entries.contains { $0.id == ModelEntry.fillHole.id })
}

@Test func theModelsRequestCarriesTheClickLimitAndTheFillModel() throws {
    let (ok, text) = Dispatcher().dispatch(method: "models")
    #expect(ok)
    let report = try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
    #expect(
        report["tasks"]?["findRegion"]?["clicks"]?.intValue
            == (Masker.isAvailable ? Mask.clickLimit : 0))
    #expect(report["tasks"]?["fillHole"]?["model"]?.stringValue == "lama-1")
    guard case .array(let entries) = report["entries"] else {
        Issue.record("no entries in \(text)")
        return
    }
    #expect(entries.first?["bytes"]?.intValue == ModelEntry.lama.bytes)
}

@Test func theCropHoldsFourTimesTheHoleInsideThePhoto() {
    let photo = CGRect(x: 0, y: 0, width: 6000, height: 4000)

    #expect(
        LaMa.crop(around: CGRect(x: 100, y: 100, width: 50, height: 50), in: photo)
            == CGRect(x: 0, y: 0, width: 1024, height: 1024))
    #expect(
        LaMa.crop(around: CGRect(x: 3000, y: 2000, width: 500, height: 300), in: photo)
            == CGRect(x: 2250, y: 1150, width: 2000, height: 2000))
    #expect(LaMa.crop(around: CGRect(x: 0, y: 0, width: 3000, height: 3000), in: photo)?.width == 4000)
    #expect(LaMa.crop(around: CGRect(x: 500, y: 2000, width: 5000, height: 20), in: photo) == nil)
}

@Test func theFillReplacesTheHoleAndKeepsTheRest() async throws {
    let model = try MLModel(contentsOf: await MLModel.compileModel(at: fillFixture))
    let side = 2048
    let photo = CGContext(
        data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    photo.setFillColor(red: 0.8, green: 0.2, blue: 0.2, alpha: 1)
    photo.fill(CGRect(x: 0, y: 0, width: side, height: side))
    let hole = CGContext(
        data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
    hole.setFillColor(gray: 1, alpha: 1)
    hole.fill(CGRect(x: 768, y: 768, width: 512, height: 512))

    let filled = try LaMa.fill(photo.makeImage()!, hole: hole.makeImage()!, with: model)

    #expect(filled.extent == CGRect(x: 0, y: 0, width: side, height: side))
    let inside = pixel(of: filled, at: CGPoint(x: 1024, y: 1024)).prefix(3).map(Int.init)
    let outside = pixel(of: filled, at: CGPoint(x: 100, y: 100)).prefix(3).map(Int.init)
    #expect(zip(inside, [51, 204, 204]).allSatisfy { abs($0 - $1) <= 3 }, "\(inside)")
    #expect(zip(outside, [204, 51, 51]).allSatisfy { abs($0 - $1) <= 3 }, "\(outside)")
}
