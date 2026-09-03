import Foundation

/// An export of a few hundred raws takes minutes, far past the client's read
/// timeout, so the request that asks for one only plans it: `start` returns an
/// id straight away and the client polls `progress` until it stops running.
/// Imports ride the same engine: an item is just a label and the work that
/// delivers it, whatever that work is.
public final class Exporter: @unchecked Sendable {
    public struct Progress: Equatable, Sendable {
        public let id: String
        public let total: Int
        public var done: Int
        public var failed: Int
        public var running: Bool
        public var cancelled: Bool
        /// Every file is written by now, so the counts stop moving until zip is
        /// done with them.
        public var archiving: Bool
        /// Set when the delivery as a whole did not happen; files that failed
        /// on their own leave this nil.
        public var error: String?
        /// A count does not say which photos are missing from the folder.
        public var failures: [String]
    }

    /// Names are decided here, before the first write, so the writers cannot
    /// pick the same one from a listing that keeps changing under them.
    public struct Plan: Sendable {
        public struct Item: Sendable {
            public let label: String
            public let write: @Sendable () throws -> Void
        }

        public let items: [Item]
        public let destination: String
        /// Set for a zip delivery; the archive is built from it at the end.
        public let staging: URL?
    }

    /// A full-resolution render saturates a core, and the machine has to stay
    /// usable while the export runs.
    private static let concurrency = 4

    private let lock = NSLock()
    private var jobs: [String: Progress] = [:]
    private var tasks: [String: Task<Void, Never>] = [:]
    private var settledAt: [String: Date] = [:]

    public init() {}

    public func start(plan: Plan) -> Progress {
        lock.lock()
        // A counter would restart at 1 with the process, and a client that
        // outlives a sidecar respawn would poll and cancel a stranger's job.
        let id = UUID().uuidString
        for (old, settled) in settledAt where settled.timeIntervalSinceNow < -600 {
            jobs[old] = nil
            settledAt[old] = nil
        }
        let initial = Progress(
            id: id, total: plan.items.count, done: 0, failed: 0, running: true,
            cancelled: false, archiving: false, error: nil, failures: [])
        jobs[id] = initial
        tasks[id] = Task.detached(priority: .utility) { [weak self] in
            await self?.run(id: id, plan: plan)
        }
        lock.unlock()
        return initial
    }

    public func progress(id: String) -> Progress? {
        lock.withLock { jobs[id] }
    }

    /// Asks; it does not decide. `cancelled` is set by the job itself when it
    /// stops, so a cancel that loses the race to the last write is reported as
    /// the delivery it turned out to be rather than flipping the client twice.
    public func cancel(id: String) -> Progress? {
        lock.withLock { tasks[id] }?.cancel()
        return progress(id: id)
    }

    private func run(id: String, plan: Plan) async {
        var failures: [String] = []
        await withTaskGroup(of: String?.self) { group in
            var next = 0
            func submit() {
                guard next < plan.items.count else { return }
                let item = plan.items[next]
                next += 1
                group.addTask {
                    do {
                        try item.write()
                        return nil
                    } catch {
                        return "\(item.label): \(error)"
                    }
                }
            }
            for _ in 0..<min(Self.concurrency, plan.items.count) { submit() }

            while let failure = await group.next() {
                // A render cannot be interrupted mid-file, so cancelling stops
                // the queue rather than the writes already under way.
                if Task.isCancelled { group.cancelAll() } else { submit() }
                if let failure {
                    failures.append(failure)
                    // the drawer is the only other place these show, and it
                    // goes away with the window
                    FileHandle.standardError.write(Data("job failed: \(failure)\n".utf8))
                }
                lock.withLock {
                    if failure == nil {
                        jobs[id]?.done += 1
                    } else {
                        jobs[id]?.failed += 1
                        jobs[id]?.failures = failures
                    }
                }
            }
        }

        let cancelled = Task.isCancelled
        var (written, failed) = lock.withLock {
            (jobs[id]?.done ?? 0, jobs[id]?.failed ?? 0)
        }
        var error: String?
        if let staging = plan.staging {
            if cancelled {
                // Staging is deleted below, so neither count describes anything
                // that exists: a cancelled zip delivered nothing at all.
                written = 0
                failed = 0
                failures = []
            } else if written > 0 {
                lock.withLock { jobs[id]?.archiving = true }
                do {
                    try FileActions.zipDirectory(at: staging, to: plan.destination)
                } catch let zip {
                    written = 0
                    error = "\(zip)"
                }
            }
            try? FileManager.default.removeItem(at: staging)
        }
        // An empty delivery reported as a success sends the user looking for
        // files that are not there.
        if error == nil && !cancelled && written == 0 { error = failures.first }

        lock.withLock {
            jobs[id]?.done = written
            jobs[id]?.failed = failed
            jobs[id]?.running = false
            jobs[id]?.cancelled = cancelled
            jobs[id]?.archiving = false
            jobs[id]?.error = error
            jobs[id]?.failures = failures
            tasks[id] = nil
            settledAt[id] = Date()
        }
    }

    /// Waits so that quitting mid-export still cleans up staging and the temp
    /// files the writers work through.
    public func cancelAll(waitingUpTo timeout: TimeInterval) {
        for task in lock.withLock({ Array(tasks.values) }) { task.cancel() }
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline, !lock.withLock({ tasks.isEmpty }) {
            Thread.sleep(forTimeInterval: 0.02)
        }
    }
}
