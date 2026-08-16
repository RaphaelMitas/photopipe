import Foundation

/// Runs a delivery in the background and reports how far it got.
///
/// An export of a few hundred raws takes minutes, far past the client's read
/// timeout, so the request that asks for one only plans it: `start` returns an
/// id straight away and the client polls `progress` until it stops running.
/// A file that cannot be written is counted and skipped, because one unreadable
/// photo losing the other hundred and fifty is not a trade anyone would take.
public final class Exporter: @unchecked Sendable {
    public struct Progress: Equatable, Sendable {
        public let id: String
        public let total: Int
        public let destination: String
        public var done: Int
        public var failed: Int
        public var running: Bool
        public var cancelled: Bool
        /// Set when the delivery as a whole did not happen. Individual files
        /// that failed are in `failed` and leave this nil.
        public var error: String?
    }

    /// A delivery resolved down to "write this image to this url": names are
    /// decided here, before the first write, so four writers cannot pick the
    /// same one from a directory listing that keeps changing under them.
    public struct Plan: Sendable {
        public struct Item: Sendable {
            public let image: ImageFile
            public let target: URL

            public init(image: ImageFile, target: URL) {
                self.image = image
                self.target = target
            }
        }

        public let items: [Item]
        public let destination: String
        /// Set for a zip delivery: every target sits in here and the archive is
        /// built from it once the last file has landed.
        public let staging: URL?

        public init(items: [Item], destination: String, staging: URL?) {
            self.items = items
            self.destination = destination
            self.staging = staging
        }
    }

    /// A full-resolution render saturates a core, and the machine has to stay
    /// usable while the export runs.
    private static let concurrency = 4

    public typealias Write = @Sendable (ImageFile, URL) throws -> Void

    private let lock = NSLock()
    private var jobs: [String: Progress] = [:]
    private var tasks: [String: Task<Void, Never>] = [:]
    private var nextID = 1

    public init() {}

    public func start(plan: Plan, write: @escaping Write) -> Progress {
        lock.lock()
        let id = String(nextID)
        nextID += 1
        let initial = Progress(
            id: id, total: plan.items.count, destination: plan.destination,
            done: 0, failed: 0, running: true, cancelled: false, error: nil)
        jobs[id] = initial
        tasks[id] = Task.detached(priority: .utility) { [weak self] in
            await self?.run(id: id, plan: plan, write: write)
        }
        lock.unlock()
        return initial
    }

    public func progress(id: String) -> Progress? {
        lock.withLock { jobs[id] }
    }

    /// Files already written stay where they are; a zip is not built at all.
    /// A delivery that finished between the client's last poll and this call is
    /// left alone rather than relabelled as cancelled.
    public func cancel(id: String) -> Progress? {
        let task = lock.withLock { () -> Task<Void, Never>? in
            guard jobs[id]?.running == true else { return nil }
            jobs[id]?.cancelled = true
            return tasks[id]
        }
        task?.cancel()
        return progress(id: id)
    }

    private func run(id: String, plan: Plan, write: @escaping Write) async {
        var firstFailure: String?
        await withTaskGroup(of: String?.self) { group in
            var next = 0
            func submit() {
                guard next < plan.items.count else { return }
                let item = plan.items[next]
                next += 1
                group.addTask {
                    do {
                        try write(item.image, item.target)
                        return nil
                    } catch {
                        return "\(item.image.rel): \(error)"
                    }
                }
            }
            for _ in 0..<min(Self.concurrency, plan.items.count) { submit() }

            while let failure = await group.next() {
                // A render cannot be interrupted mid-file, so cancelling stops
                // the queue rather than the writes already under way.
                if Task.isCancelled { group.cancelAll() } else { submit() }
                if let failure, firstFailure == nil { firstFailure = failure }
                lock.withLock {
                    if failure == nil { jobs[id]?.done += 1 } else { jobs[id]?.failed += 1 }
                }
            }
        }

        let cancelled = Task.isCancelled
        var written = lock.withLock { jobs[id]?.done ?? 0 }
        var error: String?
        if let staging = plan.staging {
            if !cancelled && written > 0 {
                do {
                    try FileActions.zipDirectory(at: staging, to: plan.destination)
                } catch let zip {
                    // The staged files are about to be deleted, so counting
                    // them as delivered would name files nobody can open.
                    written = 0
                    error = "\(zip)"
                }
            }
            try? FileManager.default.removeItem(at: staging)
        }
        // Nothing arrived and something went wrong: the client needs to be told
        // what, not handed an empty delivery reported as a success.
        if error == nil && !cancelled && written == 0 { error = firstFailure }

        lock.withLock {
            jobs[id]?.done = written
            jobs[id]?.running = false
            jobs[id]?.cancelled = cancelled
            jobs[id]?.error = error
            tasks[id] = nil
        }
    }
}
