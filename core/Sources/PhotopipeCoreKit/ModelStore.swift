import CoreML
import CryptoKit
import Foundation

struct ModelReport: Encodable, Equatable {
    enum State: String, Encodable {
        case unsupported, absent, downloading, preparing, failed, ready
    }

    let id: String
    let name: String
    let bytes: Int
    let licence: String
    let state: State
    let progress: Double?
    let reason: String?
    let loadError: String?
}

struct ModelsReport: Encodable {
    struct Tasks: Encodable {
        let findRegion: FindRegion
        let fillHole: FillHole
    }

    struct FindRegion: Encodable { let clicks: Int }
    struct FillHole: Encodable { let model: String }

    let entries: [ModelReport]
    let tasks: Tasks
}

enum ModelError: WireError, Equatable {
    case unknownModel(String)
    case unsupported
    case notReady(String)
    case inUse(String)
    case outsidePackage(String)
    case hashMismatch(String)
    case tooLarge(String)
    case http(Int)
    case unloadable(String)

    var wire: ResponseError {
        switch self {
        case .unknownModel(let id): ResponseError(code: "unknown_model", message: id)
        case .unsupported:
            ResponseError(code: "unsupported", message: "models need a Mac for now")
        case .notReady(let id): ResponseError(code: "model_not_ready", message: "\(id) is not downloaded")
        case .inUse(let id): ResponseError(code: "model_in_use", message: "\(id) is in use")
        case .outsidePackage(let path):
            ResponseError(code: "bad_model_file", message: "\(path) is outside the model package")
        case .hashMismatch(let path):
            ResponseError(code: "hash_mismatch", message: "\(path) does not match the catalog")
        case .tooLarge(let path):
            ResponseError(code: "too_large", message: "\(path) is larger than the catalog says")
        case .http(let status): ResponseError(code: "http_error", message: "server answered \(status)")
        case .unloadable(let reason): ResponseError(code: "model_unloadable", message: reason)
        }
    }
}

final class ModelStore: @unchecked Sendable {
    private enum Phase {
        case downloading(Int)
        case preparing
        case failed(String)
    }

    private struct Run {
        let token: UUID
        let task: Task<Void, Never>
    }

    static var isSupported: Bool {
        #if os(macOS)
            true
        #else
            false
        #endif
    }

    private static let idle: Duration = .seconds(120)

    let folder: URL
    private let catalog: [ModelEntry]
    private let transfer: Transfer
    private let lock = NSLock()
    private let filling = NSLock()
    private var runs: [String: Run] = [:]
    private var phases: [String: Phase] = [:]
    private var loaded: [String: MLModel] = [:]
    private var loadErrors: [String: String] = [:]
    private var lent: Set<String> = []
    private var lends: [String: Int] = [:]

    init(
        folder: URL, catalog: [ModelEntry] = ModelEntry.catalog, transfer: Transfer = Transfer()
    ) {
        self.folder = folder
        self.catalog = catalog
        self.transfer = transfer
    }

    static func defaultFolder() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Photopipe/models", isDirectory: true)
    }

    func entries() -> [ModelReport] {
        lock.withLock { catalog.map(report) }
    }

    func download(_ id: String) throws {
        let entry = try entry(id)
        guard Self.isSupported else { throw ModelError.unsupported }
        lock.withLock {
            guard runs[id] == nil, !isInstalled(entry) else { return }
            let token = UUID()
            phases[id] = .downloading(0)
            runs[id] = Run(token: token, task: Task.detached { await self.run(entry, token: token) })
        }
    }

    func cancel(_ id: String) throws {
        _ = try entry(id)
        lock.withLock { stop(id) }
    }

    func delete(_ id: String) throws {
        let entry = try entry(id)
        let trash = try lock.withLock { () throws -> URL? in
            guard !lent.contains(id) else { throw ModelError.inUse(id) }
            stop(id)
            loaded[id] = nil
            loadErrors[id] = nil
            guard isInstalled(entry) else { return nil }
            let trash = try scratchFolder()
            try FileManager.default.moveItem(
                at: installed(entry), to: trash.appendingPathComponent(entry.folderName))
            return trash
        }
        if let trash { try? FileManager.default.removeItem(at: trash) }
    }

    func lend<Value>(_ id: String, _ body: (MLModel) throws -> Value) throws -> Value {
        let entry = try entry(id)
        return try filling.withLock {
            let held = try lock.withLock { () throws -> MLModel? in
                guard isInstalled(entry) else { throw ModelError.notReady(id) }
                lent.insert(id)
                return loaded[id]
            }
            defer { giveBack(id) }
            return try body(held ?? load(entry))
        }
    }

    private func load(_ entry: ModelEntry) throws -> MLModel {
        do {
            let model = try MLModel(
                contentsOf: installed(entry).appendingPathComponent("model.mlmodelc"),
                configuration: entry.runner.configuration)
            lock.withLock {
                loaded[entry.id] = model
                loadErrors[entry.id] = nil
            }
            return model
        } catch {
            let reason = error.localizedDescription
            lock.withLock { loadErrors[entry.id] = reason }
            throw ModelError.unloadable(reason)
        }
    }

    private func giveBack(_ id: String) {
        let lend = lock.withLock {
            lent.remove(id)
            let lend = lends[id, default: 0] + 1
            lends[id] = lend
            return lend
        }
        Task.detached {
            try? await Task.sleep(for: Self.idle)
            self.lock.withLock {
                if self.lends[id] == lend, !self.lent.contains(id) { self.loaded[id] = nil }
            }
        }
    }

    private func entry(_ id: String) throws -> ModelEntry {
        guard let entry = catalog.first(where: { $0.id == id }) else {
            throw ModelError.unknownModel(id)
        }
        return entry
    }

    private func installed(_ entry: ModelEntry) -> URL {
        folder.appendingPathComponent(entry.folderName, isDirectory: true)
    }

    private func isInstalled(_ entry: ModelEntry) -> Bool {
        FileManager.default.fileExists(atPath: installed(entry).path)
    }

    private func scratchFolder() throws -> URL {
        try FileManager.default.scratchFolder(beside: folder)
    }

    private func stop(_ id: String) {
        runs.removeValue(forKey: id)?.task.cancel()
        phases[id] = nil
    }

    private func report(_ entry: ModelEntry) -> ModelReport {
        let state: ModelReport.State
        var progress: Double?
        var reason: String?
        switch (Self.isSupported, isInstalled(entry), phases[entry.id]) {
        case (false, _, _): state = .unsupported
        case (true, true, _): state = .ready
        case (true, false, nil): state = .absent
        case (true, false, .downloading(let bytes)?):
            state = .downloading
            progress = Double(bytes) / Double(max(entry.bytes, 1))
        case (true, false, .preparing?): state = .preparing
        case (true, false, .failed(let why)?):
            state = .failed
            reason = why
        }
        return ModelReport(
            id: entry.id, name: entry.name, bytes: entry.bytes, licence: entry.licence, state: state,
            progress: progress, reason: reason,
            loadError: state == .ready ? loadErrors[entry.id] : nil)
    }

    private func update(_ id: String, _ token: UUID, to phase: Phase) throws {
        try lock.withLock {
            guard runs[id]?.token == token else { throw CancellationError() }
            phases[id] = phase
        }
    }

    private func run(_ entry: ModelEntry, token: UUID) async {
        let fm = FileManager.default
        var scratch: URL?
        do {
            try fm.createDirectory(at: folder, withIntermediateDirectories: true)
            var excluded = URLResourceValues()
            excluded.isExcludedFromBackup = true
            var models = folder
            try models.setResourceValues(excluded)
            let staging = try scratchFolder()
            scratch = staging
            let package = staging.appendingPathComponent("model.mlpackage", isDirectory: true)
            var received = 0
            for file in entry.files {
                guard file.isInsidePackage else { throw ModelError.outsidePackage(file.path) }
                let target = package.appendingPathComponent(file.path)
                try fm.createDirectory(
                    at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                let before = received
                try await transfer.fetch(file.url, to: target, limit: file.bytes) { bytes in
                    try? self.update(entry.id, token, to: .downloading(before + bytes))
                }
                guard try Self.sha256(of: target) == file.sha256 else {
                    throw ModelError.hashMismatch(file.path)
                }
                received += file.bytes
            }
            try update(entry.id, token, to: .preparing)
            let ready = staging.appendingPathComponent(entry.folderName, isDirectory: true)
            try fm.createDirectory(at: ready, withIntermediateDirectories: false)
            let compiled = try await MLModel.compileModel(at: package)
            do {
                try fm.moveItem(at: compiled, to: ready.appendingPathComponent("model.mlmodelc"))
            } catch {
                try? fm.removeItem(at: compiled)
                throw error
            }
            try Self.flush(ready)
            try lock.withLock {
                guard runs[entry.id]?.token == token else { throw CancellationError() }
                try Self.moveUnlessTaken(ready, to: installed(entry))
                runs[entry.id] = nil
                phases[entry.id] = nil
            }
        } catch {
            lock.withLock {
                guard runs[entry.id]?.token == token else { return }
                runs[entry.id] = nil
                phases[entry.id] = .failed(Self.reason(error))
            }
        }
        if let scratch { try? fm.removeItem(at: scratch) }
    }

    private static func reason(_ error: any Error) -> String {
        (error as? any WireError)?.wire.message ?? error.localizedDescription
    }

    static func sha256(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 4 << 20), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().hex
    }

    private static func flush(_ folder: URL) throws {
        let files = FileManager.default.enumerator(
            at: folder, includingPropertiesForKeys: [.isRegularFileKey])
        while let file = files?.nextObject() as? URL {
            guard (try file.resourceValues(forKeys: [.isRegularFileKey])).isRegularFile == true
            else { continue }
            let descriptor = open(file.path, O_RDONLY)
            guard descriptor >= 0 else { throw lastPOSIXError() }
            defer { close(descriptor) }
            guard fcntl(descriptor, F_FULLFSYNC) == 0 else {
                throw lastPOSIXError()
            }
        }
    }

    private static func lastPOSIXError() -> POSIXError {
        POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }

    private static func moveUnlessTaken(_ source: URL, to destination: URL) throws {
        guard renamex_np(source.path, destination.path, UInt32(RENAME_EXCL)) != 0 else { return }
        guard errno == EEXIST else { throw lastPOSIXError() }
    }
}

final class Transfer: Sendable {
    private let configuration: @Sendable () -> URLSessionConfiguration

    init(configuration: @escaping @Sendable () -> URLSessionConfiguration = { .ephemeral }) {
        self.configuration = configuration
    }

    func fetch(
        _ url: URL, to destination: URL, limit: Int, progress: @escaping @Sendable (Int) -> Void
    ) async throws {
        guard FileManager.default.createFile(atPath: destination.path, contents: nil) else {
            throw CocoaError(.fileWriteUnknown, userInfo: [NSFilePathErrorKey: destination.path])
        }
        let handle = try FileHandle(forWritingTo: destination)
        defer { try? handle.close() }
        let receiver = Receiver(
            name: url.lastPathComponent, handle: handle, limit: limit, progress: progress)
        let session = URLSession(configuration: configuration(), delegate: receiver, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        let task = session.dataTask(with: url)
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                receiver.wait(continuation)
                task.resume()
            }
        } onCancel: {
            task.cancel()
        }
        try Task.checkCancellation()
    }
}

private final class Receiver: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private enum Outcome {
        case pending
        case waiting(CheckedContinuation<Void, any Error>)
        case finished(Result<Void, any Error>)
    }

    private let outcome = NSLock()
    private var state = Outcome.pending
    private let name: String
    private let handle: FileHandle
    private let limit: Int
    private let progress: @Sendable (Int) -> Void
    private var received = 0
    private var failure: (any Error)?

    init(name: String, handle: FileHandle, limit: Int, progress: @escaping @Sendable (Int) -> Void) {
        self.name = name
        self.handle = handle
        self.limit = limit
        self.progress = progress
    }

    func urlSession(
        _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
        completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void
    ) {
        if let status = (response as? HTTPURLResponse)?.statusCode, !(200..<300).contains(status) {
            failure = ModelError.http(status)
        } else if response.expectedContentLength > limit {
            failure = ModelError.tooLarge(name)
        }
        completionHandler(failure == nil ? .allow : .cancel)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard failure == nil else { return }
        received += data.count
        do {
            guard received <= limit else { throw ModelError.tooLarge(name) }
            try handle.write(contentsOf: data)
            progress(received)
        } catch {
            failure = error
            dataTask.cancel()
        }
    }

    func wait(_ continuation: CheckedContinuation<Void, any Error>) {
        let finished = outcome.withLock { () -> Result<Void, any Error>? in
            guard case .finished(let result) = state else {
                state = .waiting(continuation)
                return nil
            }
            return result
        }
        if let finished { continuation.resume(with: finished) }
    }

    func urlSession(
        _ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?
    ) {
        let result: Result<Void, any Error> = (failure ?? error).map { .failure($0) } ?? .success(())
        let waiting = outcome.withLock { () -> CheckedContinuation<Void, any Error>? in
            defer { state = .finished(result) }
            guard case .waiting(let continuation) = state else { return nil }
            return continuation
        }
        waiting?.resume(with: result)
    }
}
