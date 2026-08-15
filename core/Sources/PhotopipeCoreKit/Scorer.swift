import Foundation
import Vision

/// Aesthetic scores from Vision, cached in the library index.
///
/// Vision reads the RAW file itself, so nothing here decodes an image. A pass runs in the
/// background for one shoot at a time and reports how far it has got, because the browser
/// keeps the sort by score disabled until every file in the shoot has an answer.
public final class Scorer: @unchecked Sendable {
    public struct Progress: Equatable, Sendable {
        public let done: Int
        public let total: Int
        public let running: Bool

        public static let idle = Progress(done: 0, total: 0, running: false)
    }

    /// Every cached row carries this. Bump it when the model or its input changes and the
    /// whole cache is ignored, no migration needed.
    public static let version = 1

    private static let concurrency = 6
    private static let flushEvery = 32

    private let lock = NSLock()
    private var index: SQLiteIndex?
    private var cache: [String: ScoreRow] = [:]
    private var progressByShoot: [String: Progress] = [:]
    private var passes: [String: Task<Void, Never>] = [:]

    public init() {}

    /// Point the scorer at a library index, dropping whatever the previous one had.
    public func use(index: SQLiteIndex?) {
        lock.lock()
        let cancelled = passes.values
        passes.removeAll()
        progressByShoot.removeAll()
        self.index = index
        cache = (try? index?.loadScores()) ?? [:]
        lock.unlock()
        for pass in cancelled { pass.cancel() }
    }

    /// Scores for the files that have a current one, keyed by path.
    public func scores(for files: [ImageFile]) -> [String: Double] {
        lock.lock()
        defer { lock.unlock() }
        var result: [String: Double] = [:]
        for file in files {
            if let row = cache[file.path], row.matches(file), let score = row.score {
                result[file.path] = score
            }
        }
        return result
    }

    /// Only a running pass reports stored progress. Once it ends the answer is recomputed from
    /// the cache, so a file that changed since goes back to being unscored.
    public func progress(shoot: String, files: [ImageFile]) -> Progress {
        lock.lock()
        defer { lock.unlock() }
        if let current = progressByShoot[shoot], current.running { return current }
        return Progress(done: scoredCount(files), total: files.count, running: false)
    }

    /// Score everything in the shoot that has no current answer. Calling this while a pass for
    /// the same shoot runs just reports where it is.
    @discardableResult
    public func start(shoot: String, files: [ImageFile]) -> Progress {
        lock.lock()
        if passes[shoot] != nil {
            let current = progressByShoot[shoot] ?? .idle
            lock.unlock()
            return current
        }
        let pending = files.filter { cache[$0.path]?.matches($0) != true }
        guard !pending.isEmpty else {
            lock.unlock()
            return Progress(done: files.count, total: files.count, running: false)
        }
        let start = Progress(
            done: files.count - pending.count, total: files.count, running: true)
        progressByShoot[shoot] = start
        passes[shoot] = Task.detached(priority: .utility) { [weak self] in
            await self?.run(shoot: shoot, pending: pending, total: files.count)
        }
        lock.unlock()
        return start
    }

    private func run(shoot: String, pending: [ImageFile], total: Int) async {
        var buffer: [(String, ScoreRow)] = []
        await withTaskGroup(of: (ImageFile, Double?).self) { group in
            var next = 0
            func submit() {
                guard next < pending.count else { return }
                let file = pending[next]
                next += 1
                group.addTask { (file, await Self.score(path: file.path)) }
            }
            for _ in 0..<min(Self.concurrency, pending.count) { submit() }

            while let (file, score) = await group.next() {
                if Task.isCancelled { group.cancelAll() } else { submit() }
                let row = ScoreRow(
                    score: score, mtime: file.mtime, size: file.size, version: Self.version)
                buffer.append((file.path, row))

                let (index, flush) = lock.withLock { () -> (SQLiteIndex?, Bool) in
                    cache[file.path] = row
                    let done = scoredCount(pending) + (total - pending.count)
                    progressByShoot[shoot] = Progress(done: done, total: total, running: true)
                    return (self.index, buffer.count >= Self.flushEvery)
                }

                if flush {
                    try? index?.saveScores(buffer)
                    buffer.removeAll(keepingCapacity: true)
                }
            }
        }

        let index = lock.withLock { () -> SQLiteIndex? in
            progressByShoot[shoot] = nil
            passes[shoot] = nil
            return self.index
        }
        try? index?.saveScores(buffer)
    }

    /// Caller holds the lock.
    private func scoredCount(_ files: [ImageFile]) -> Int {
        files.count { cache[$0.path]?.matches($0) == true }
    }

    static func score(path: String) async -> Double? {
        let request = CalculateImageAestheticsScoresRequest()
        guard
            let observation = try? await request.perform(on: URL(fileURLWithPath: path))
        else { return nil }
        return Double(observation.overallScore)
    }
}

/// A cached score. `score` is nil for a file Vision could not read, which still counts as
/// answered so one broken file cannot keep a pass running forever.
public struct ScoreRow: Equatable, Sendable {
    public let score: Double?
    public let mtime: Double
    public let size: Int64
    public let version: Int

    public init(score: Double?, mtime: Double, size: Int64, version: Int) {
        self.score = score
        self.mtime = mtime
        self.size = size
        self.version = version
    }

    public func matches(_ file: ImageFile) -> Bool {
        version == Scorer.version && size == file.size && mtime == file.mtime
    }
}
