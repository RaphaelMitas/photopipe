import Foundation

public struct AnalysisProgress: Equatable, Sendable, Encodable {
    public let done: Int
    public let total: Int
    public let running: Bool

    public static let idle = AnalysisProgress(done: 0, total: 0, running: false)
}

public final class Analyzer<Value: Sendable>: @unchecked Sendable {
    public typealias Progress = AnalysisProgress
    public typealias Row = AnalysisRow<Value>
    public typealias Flush = @Sendable ([(String, Row)]) -> Void

    private let version: Int
    private let concurrency: Int
    private let analyze: @Sendable (ImageFile) async -> Value?
    private let flushEvery = 32

    private let lock = NSLock()
    private var flush: Flush?
    private var cache: [String: Row] = [:]
    private var progressByShoot: [String: Progress] = [:]
    private var passes: [String: Task<Void, Never>] = [:]
    private var generation = 0
    private var moved: [String: ImageFile] = [:]
    private var gone: Set<String> = []

    public init(
        version: Int, concurrency: Int, analyze: @escaping @Sendable (ImageFile) async -> Value?
    ) {
        self.version = version
        self.concurrency = concurrency
        self.analyze = analyze
    }

    public func use(cache: [String: Row], flush: @escaping Flush) {
        let cancelled = lock.withLock {
            let cancelled = passes.values
            passes.removeAll()
            progressByShoot.removeAll()
            moved.removeAll()
            gone.removeAll()
            generation += 1
            self.flush = flush
            self.cache = cache
            return cancelled
        }
        for pass in cancelled { pass.cancel() }
    }

    public func answers(for files: [ImageFile]) -> [String: Value?] {
        lock.withLock {
            var result: [String: Value?] = [:]
            for file in files where isAnswered(file) {
                let value = gone.contains(file.path) ? nil : cache[file.path]?.value
                result.updateValue(value, forKey: file.path)
            }
            return result
        }
    }

    public func values(for files: [ImageFile]) -> [String: Value] {
        answers(for: files).compactMapValues { $0 }
    }

    public func restamp(_ before: ImageFile, to after: ImageFile) {
        lock.withLock {
            if !passes.isEmpty { moved[after.path] = after }
            guard let row = cache[before.path], row.matches(before, version: version),
                !row.matches(after, version: version)
            else { return }
            let carried = Row(value: row.value, for: after, version: version)
            cache[after.path] = carried
            flush?([(after.path, carried)])
        }
    }

    func progress(shoot: String, files: [ImageFile]) -> Progress {
        lock.withLock {
            if let current = progressByShoot[shoot], current.running { return current }
            return Progress(done: answeredCount(files), total: files.count, running: false)
        }
    }

    @discardableResult
    public func start(shoot: String, files: [ImageFile]) -> Progress {
        let back = lock.withLock { files.filter { gone.contains($0.path) } }
            .filter { FileManager.default.fileExists(atPath: $0.path) }
        return lock.withLock {
            if passes[shoot] != nil { return progressByShoot[shoot] ?? .idle }
            for file in back { gone.remove(file.path) }
            let pending = files.filter { !isAnswered($0) }
            guard !pending.isEmpty else {
                return Progress(done: files.count, total: files.count, running: false)
            }
            let start = Progress(
                done: files.count - pending.count, total: files.count, running: true)
            progressByShoot[shoot] = start
            let generation = generation
            passes[shoot] = Task.detached(priority: .utility) { [weak self] in
                await self?.run(
                    shoot: shoot, pending: pending, total: files.count, generation: generation)
            }
            return start
        }
    }

    private func run(shoot: String, pending: [ImageFile], total: Int, generation: Int) async {
        var buffer: [String] = []
        let analyze = self.analyze
        func drain() -> [(String, Row)] {
            defer { buffer.removeAll(keepingCapacity: true) }
            return buffer.compactMap { path in cache[path].map { (path, $0) } }
        }
        await forEachConcurrently(pending, width: concurrency) { file in
            (file, await analyze(file))
        } onResult: { answered, cancelled in
            let (file, value) = answered
            if value == nil && cancelled { return }
            let missing = value == nil && !FileManager.default.fileExists(atPath: file.path)

            lock.withLock {
                guard generation == self.generation else { return }
                if missing {
                    gone.insert(file.path)
                } else {
                    cache[file.path] = Row(
                        value: value, for: moved[file.path] ?? file, version: version)
                    buffer.append(file.path)
                }
                let done = answeredCount(pending) + (total - pending.count)
                progressByShoot[shoot] = Progress(done: done, total: total, running: true)
                if buffer.count >= flushEvery { flush?(drain()) }
            }
        }

        lock.withLock {
            guard generation == self.generation else { return }
            progressByShoot[shoot] = nil
            passes[shoot] = nil
            if passes.isEmpty { moved.removeAll() }
            flush?(drain())
        }
    }

    private func answeredCount(_ files: [ImageFile]) -> Int {
        files.count(where: isAnswered)
    }

    private func isAnswered(_ file: ImageFile) -> Bool {
        gone.contains(file.path) || cache[file.path]?.matches(file, version: version) == true
    }
}

public struct AnalysisRow<Value: Sendable>: Sendable {
    public let value: Value?
    public let mtime: Double
    public let size: Int64
    public let version: Int

    public init(value: Value?, mtime: Double, size: Int64, version: Int) {
        self.value = value
        self.mtime = mtime
        self.size = size
        self.version = version
    }

    init(value: Value?, for file: ImageFile, version: Int) {
        self.init(value: value, mtime: file.mtime, size: file.size, version: version)
    }

    func matches(_ file: ImageFile, version: Int) -> Bool {
        self.version == version && size == file.size && mtime == file.mtime
    }
}

extension AnalysisRow: Equatable where Value: Equatable {}
