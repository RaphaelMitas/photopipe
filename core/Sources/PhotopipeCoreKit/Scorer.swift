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

    public typealias Flush = @Sendable ([(String, ScoreRow)]) -> Void

    private let lock = NSLock()
    private var flush: Flush?
    private var cache: [String: ScoreRow] = [:]
    private var progressByShoot: [String: Progress] = [:]
    private var passes: [String: Task<Void, Never>] = [:]
    /// Files one of our writes moved while a pass had them queued. Vision reads them as they
    /// are now, so the pass records its answer under these stamps, not the ones it queued with.
    private var moved: [String: ImageFile] = [:]

    public init() {}

    /// Adopt a library's cached scores, dropping whatever the previous one had.
    /// Results are handed to `flush` rather than written here, so the scorer
    /// never touches the database directly.
    public func use(cache: [String: ScoreRow], flush: @escaping Flush) {
        lock.lock()
        let cancelled = passes.values
        passes.removeAll()
        progressByShoot.removeAll()
        moved.removeAll()
        self.flush = flush
        self.cache = cache
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

    /// Carry a score across our own metadata write, which moves a file's mtime and size without
    /// touching a pixel: expiring it would drop the photo out of the sort by score and spend a
    /// Vision read arriving at the same number. Only a score that was current for `before`
    /// travels, so a file something else had already changed stays unscored.
    public func restamp(_ before: ImageFile, to after: ImageFile) {
        let (write, carried) = lock.withLock { () -> (Flush?, ScoreRow?) in
            if !passes.isEmpty { moved[after.path] = after }
            guard let row = cache[before.path], row.matches(before), !row.matches(after)
            else { return (nil, nil) }
            let carried = ScoreRow(score: row.score, for: after)
            cache[after.path] = carried
            return (flush, carried)
        }
        if let carried { write?([(after.path, carried)]) }
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
                let cancelled = Task.isCancelled
                if cancelled { group.cancelAll() } else { submit() }
                // Vision reports a cancelled read the same way it reports an
                // unreadable file. Recording that would write the photo off for
                // good, so a cancelled pass leaves it untouched instead.
                if cancelled && score == nil { continue }

                let (write, full) = lock.withLock { () -> (Flush?, Bool) in
                    let row = ScoreRow(score: score, for: moved[file.path] ?? file)
                    cache[file.path] = row
                    buffer.append((file.path, row))
                    let done = scoredCount(pending) + (total - pending.count)
                    progressByShoot[shoot] = Progress(done: done, total: total, running: true)
                    return (self.flush, buffer.count >= Self.flushEvery)
                }

                if full {
                    write?(buffer)
                    buffer.removeAll(keepingCapacity: true)
                }
            }
        }

        let write = lock.withLock { () -> Flush? in
            progressByShoot[shoot] = nil
            passes[shoot] = nil
            if passes.isEmpty { moved.removeAll() }
            return self.flush
        }
        write?(buffer)
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

    /// What the file was when the score was taken, which is what `matches` asks about later.
    init(score: Double?, for file: ImageFile) {
        self.init(score: score, mtime: file.mtime, size: file.size, version: Scorer.version)
    }

    public func matches(_ file: ImageFile) -> Bool {
        version == Scorer.version && size == file.size && mtime == file.mtime
    }
}
