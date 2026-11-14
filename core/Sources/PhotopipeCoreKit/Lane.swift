import Foundation
import Synchronization

/// Newest first, so a photo the user already moved past cannot hold up the one they stopped on.
public final class Lane: Sendable {
    private struct Job {
        let run: @Sendable () -> Void
        let superseded: @Sendable () -> Void
    }

    private struct State {
        var waiting: [Job] = []
        var running = 0
    }

    private let workers: Int
    private let window: Int
    private let qos: DispatchQoS.QoSClass
    private let state = Mutex(State())
    private let busy = DispatchGroup()

    public init(workers: Int, window: Int, qos: DispatchQoS.QoSClass = .userInitiated) {
        self.workers = workers
        self.window = window
        self.qos = qos
    }

    /// Calls exactly one of the two.
    public func submit(
        _ run: @escaping @Sendable () -> Void,
        superseded: @escaping @Sendable () -> Void
    ) {
        busy.enter()
        let (dropped, startWorker) = state.withLock { state in
            state.waiting.append(Job(run: run, superseded: superseded))
            let dropped = state.waiting.count > window ? state.waiting.removeFirst() : nil
            guard state.running < workers else { return (dropped, false) }
            state.running += 1
            return (dropped, true)
        }
        if let dropped {
            dropped.superseded()
            busy.leave()
        }
        if startWorker {
            DispatchQueue.global(qos: qos).async { self.work() }
        }
    }

    public func waitUntilIdle() {
        busy.wait()
    }

    private func work() {
        while let job = state.withLock({ state -> Job? in
            if let job = state.waiting.popLast() { return job }
            state.running -= 1
            return nil
        }) {
            job.run()
            busy.leave()
        }
    }
}
