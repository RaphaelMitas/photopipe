import Foundation

public final class Exporter: @unchecked Sendable {
    public struct Progress: Equatable, Sendable, Encodable {
        public let id: String
        public let total: Int
        public var done: Int
        public var failed: Int
        public var running: Bool
        public var cancelled: Bool
        public var archiving: Bool
        public var error: String?
        public var failures: [String]
    }

    public struct Plan: Sendable {
        public struct Item: Sendable {
            public let label: String
            public let write: @Sendable () throws -> Void
        }

        public let items: [Item]
        public let destination: String
        public let staging: URL?
    }

    private static let concurrency = 4

    private let lock = NSLock()
    private var jobs: [String: Progress] = [:]
    private var tasks: [String: Task<Void, Never>] = [:]
    private var settledAt: [String: Date] = [:]

    public init() {}

    public func start(plan: Plan, settled: @escaping @Sendable () -> Void = {}) -> Progress {
        let id = UUID().uuidString
        let initial = Progress(
            id: id, total: plan.items.count, done: 0, failed: 0, running: true,
            cancelled: false, archiving: false, error: nil, failures: [])
        lock.withLock {
            for (old, settled) in settledAt where settled.timeIntervalSinceNow < -600 {
                jobs[old] = nil
                settledAt[old] = nil
            }
            jobs[id] = initial
            tasks[id] = Task.detached(priority: .utility) { [weak self] in
                await self?.run(id: id, plan: plan)
                settled()
            }
        }
        return initial
    }

    public func progress(id: String) -> Progress? {
        lock.withLock { jobs[id] }
    }

    public func cancel(id: String) -> Progress? {
        lock.withLock { tasks[id] }?.cancel()
        return progress(id: id)
    }

    private func run(id: String, plan: Plan) async {
        var failures: [String] = []
        await forEachConcurrently(plan.items, width: Self.concurrency) { item -> String? in
            do {
                try item.write()
                return nil
            } catch {
                return "\(item.label): \(error)"
            }
        } onResult: { failure, _ in
            if let failure {
                failures.append(failure)
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

        let cancelled = Task.isCancelled
        var (written, failed) = lock.withLock {
            (jobs[id]?.done ?? 0, jobs[id]?.failed ?? 0)
        }
        var error: String?
        if let staging = plan.staging {
            if cancelled {
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

    public func cancelAll(waitingUpTo timeout: TimeInterval) {
        for task in lock.withLock({ Array(tasks.values) }) { task.cancel() }
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline, !lock.withLock({ tasks.isEmpty }) {
            Thread.sleep(forTimeInterval: 0.02)
        }
    }
}
