import Foundation

public struct AnalysisProgress: Equatable, Sendable, Encodable {
    public let done: Int
    public let total: Int
    public let running: Bool

    public static let idle = AnalysisProgress(done: 0, total: 0, running: false)
}

/// One answer per file, worked out in the background and cached in the library index.
///
/// Each pass covers one shoot and reports how far it has got, because the browser
/// keeps whatever depends on the answers disabled until every file in the shoot has one.
public final class Analyzer<Value: Sendable>: @unchecked Sendable {
    public typealias Progress = AnalysisProgress
    public typealias Row = AnalysisRow<Value>
    /// Called under the analyzer's lock, so it must queue the write rather than do it.
    public typealias Flush = @Sendable ([(String, Row)]) -> Void

    /// Rows cached under another version are ignored, so a bump replaces the cache without a migration.
    private let version: Int
    private let concurrency: Int
    private let analyze: @Sendable (String) async -> Value?
    private let flushEvery = 32

    private let lock = NSLock()
    private var flush: Flush?
    private var cache: [String: Row] = [:]
    private var progressByShoot: [String: Progress] = [:]
    private var passes: [String: Task<Void, Never>] = [:]
    /// Bumped by `use`, so a cancelled pass still finishing its reads can tell it is stale.
    private var generation = 0
    /// Files one of our writes moved while a pass had them queued. The pass reads them as they
    /// are now, so it records its answer under these stamps, not the ones it queued with.
    private var moved: [String: ImageFile] = [:]

    public init(
        version: Int, concurrency: Int, analyze: @escaping @Sendable (String) async -> Value?
    ) {
        self.version = version
        self.concurrency = concurrency
        self.analyze = analyze
    }

    /// Adopt a library's cached answers, dropping whatever the previous one had.
    public func use(cache: [String: Row], flush: @escaping Flush) {
        let cancelled = lock.withLock {
            let cancelled = passes.values
            passes.removeAll()
            progressByShoot.removeAll()
            moved.removeAll()
            generation += 1
            self.flush = flush
            self.cache = cache
            return cancelled
        }
        for pass in cancelled { pass.cancel() }
    }

    /// Files with a current answer, keyed by path; nil for one that could not be read.
    public func answers(for files: [ImageFile]) -> [String: Value?] {
        lock.withLock {
            var result: [String: Value?] = [:]
            for file in files where isAnswered(file) {
                result[file.path] = cache[file.path]?.value
            }
            return result
        }
    }

    public func values(for files: [ImageFile]) -> [String: Value] {
        answers(for: files).compactMapValues { $0 }
    }

    /// Carry an answer across our own metadata write, which moves a file's mtime and size without
    /// touching a pixel: expiring it would spend another read arriving at the same answer.
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

    /// Only a running pass reports stored progress. Once it ends, progress is recomputed from the
    /// cache, so a file that changed since counts as unanswered again.
    func progress(shoot: String, files: [ImageFile]) -> Progress {
        lock.withLock {
            if let current = progressByShoot[shoot], current.running { return current }
            return Progress(done: answeredCount(files), total: files.count, running: false)
        }
    }

    /// Analyze everything in the shoot that has no current answer. Calling this while a pass for
    /// the same shoot runs just reports where it is.
    @discardableResult
    public func start(shoot: String, files: [ImageFile]) -> Progress {
        lock.withLock {
            if passes[shoot] != nil { return progressByShoot[shoot] ?? .idle }
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
        // Rows are read from the cache and handed to `flush` under the lock, as `restamp` does, so
        // disk writes queue in the same order as the cache changed.
        func drain() -> [(String, Row)] {
            defer { buffer.removeAll(keepingCapacity: true) }
            return buffer.compactMap { path in cache[path].map { (path, $0) } }
        }
        await forEachConcurrently(pending, width: concurrency) { file in
            (file, await analyze(file.path))
        } onResult: { answered, cancelled in
            let (file, value) = answered
            // A failed read is only recorded as unreadable when the file is still there: a
            // cancelled read or a dropped drive looks the same, and would write it off for good.
            if value == nil
                && (cancelled || !FileManager.default.fileExists(atPath: file.path))
            {
                return
            }

            lock.withLock {
                guard generation == self.generation else { return }
                cache[file.path] = Row(
                    value: value, for: moved[file.path] ?? file, version: version)
                buffer.append(file.path)
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

    /// Caller holds the lock.
    private func answeredCount(_ files: [ImageFile]) -> Int {
        files.count(where: isAnswered)
    }

    /// Caller holds the lock.
    private func isAnswered(_ file: ImageFile) -> Bool {
        cache[file.path]?.matches(file, version: version) == true
    }
}

/// A cached answer. `value` is nil for a file that could not be read, which still counts as
/// answered so one broken file cannot keep a pass running forever.
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
