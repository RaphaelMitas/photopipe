import Foundation

public struct AnalysisProgress: Equatable, Sendable, Encodable {
    public let done: Int
    public let total: Int
    public let running: Bool

    public static let idle = AnalysisProgress(done: 0, total: 0, running: false)
}

/// One answer per file, worked out in the background and cached in the library index.
///
/// A pass runs for one shoot at a time and reports how far it has got, because the browser
/// keeps whatever depends on the answers disabled until every file in the shoot has one.
public final class Analyzer<Value: Sendable>: @unchecked Sendable {
    public typealias Progress = AnalysisProgress
    public typealias Row = AnalysisRow<Value>
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
        let (write, carried) = lock.withLock { () -> (Flush?, Row?) in
            if !passes.isEmpty { moved[after.path] = after }
            guard let row = cache[before.path], row.matches(before, version: version),
                !row.matches(after, version: version)
            else { return (nil, nil) }
            let carried = Row(value: row.value, for: after, version: version)
            cache[after.path] = carried
            return (flush, carried)
        }
        if let carried { write?([(after.path, carried)]) }
    }

    /// Only a running pass reports stored progress. Once it ends the answer is recomputed from
    /// the cache, so a file that changed since goes back to being unanswered.
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
            let pending = files.filter { cache[$0.path]?.matches($0, version: version) != true }
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
        var buffer: [(String, Row)] = []
        let analyze = self.analyze
        await forEachConcurrently(pending, width: concurrency) { file in
            (file, await analyze(file.path))
        } onResult: { answered, cancelled in
            let (file, value) = answered
            // Vision reports a cancelled read the same way it reports an
            // unreadable file. Recording that would write the photo off for
            // good, so a cancelled pass leaves it untouched instead.
            if cancelled && value == nil { return }

            let (write, full) = lock.withLock { () -> (Flush?, Bool) in
                guard generation == self.generation else { return (nil, false) }
                let row = Row(value: value, for: moved[file.path] ?? file, version: version)
                cache[file.path] = row
                buffer.append((file.path, row))
                let done = answeredCount(pending) + (total - pending.count)
                progressByShoot[shoot] = Progress(done: done, total: total, running: true)
                return (self.flush, buffer.count >= flushEvery)
            }

            if full {
                write?(buffer)
                buffer.removeAll(keepingCapacity: true)
            }
        }

        let write = lock.withLock { () -> Flush? in
            guard generation == self.generation else { return nil }
            progressByShoot[shoot] = nil
            passes[shoot] = nil
            if passes.isEmpty { moved.removeAll() }
            return self.flush
        }
        write?(buffer)
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

    /// What the file was when the answer was taken, which is what `matches` asks about later.
    init(value: Value?, for file: ImageFile, version: Int) {
        self.init(value: value, mtime: file.mtime, size: file.size, version: version)
    }

    func matches(_ file: ImageFile, version: Int) -> Bool {
        self.version == version && size == file.size && mtime == file.mtime
    }
}

extension AnalysisRow: Equatable where Value: Equatable {}
