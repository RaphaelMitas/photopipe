import Foundation
import Synchronization

/// Runs `enrich` over everything the walk left as a placeholder, off the
/// request path and across every core, publishing each batch as it lands.
///
/// Work is ordered shoot by shoot so a shoot completes rather than every shoot
/// creeping forward at once, and `prioritize` pulls the shoot the user just
/// opened to the front of that order.
final class Enricher: @unchecked Sendable {
    /// One finished batch: `done` marks the last one for that shoot.
    typealias Publish = (_ epoch: Int, _ shoot: String, _ files: [ImageFile], _ done: Bool) -> Void

    /// Small enough that an opened shoot starts filling in within a frame or
    /// two, large enough that the fan-out cost stays in the noise.
    private static let batchSize = 128

    private let lock = NSLock()
    private var pending: [String: [ImageFile]] = [:]
    private var order: [String] = []
    private var epoch = 0
    private var draining = false
    private var publish: Publish?
    /// A shoot opened before there was a queue to reorder. Remembered so the
    /// next `start` still honours it — on a cold library that request lands in
    /// the window before the first walk has been handed over.
    private var wanted: String?
    private let queue = DispatchQueue(label: "photopipe.enrich", qos: .utility)

    /// Replaces the queue wholesale. Batches from an older epoch may still be
    /// in flight; they carry their epoch so the receiver can drop them.
    func start(epoch: Int, work: [(shoot: String, files: [ImageFile])], publish: @escaping Publish) {
        let wake = lock.withLock {
            self.epoch = epoch
            self.publish = publish
            pending = [:]
            order = []
            for (shoot, files) in work where !files.isEmpty {
                pending[shoot] = files
                order.append(shoot)
            }
            moveWantedToFront()
            let wake = !draining && !order.isEmpty
            if wake { draining = true }
            return wake
        }
        if wake { queue.async { self.drain() } }
    }

    func prioritize(shoot: String) {
        lock.withLock {
            wanted = shoot
            moveWantedToFront()
        }
    }

    /// Callers must hold the lock.
    private func moveWantedToFront() {
        guard let wanted, let index = order.firstIndex(of: wanted), index != 0 else { return }
        order.remove(at: index)
        order.insert(wanted, at: 0)
    }

    private func drain() {
        while true {
            let next = lock.withLock {
                () -> (epoch: Int, shoot: String, batch: [ImageFile], done: Bool, Publish?)? in
                guard let shoot = order.first, let queued = pending[shoot] else {
                    draining = false
                    return nil
                }
                let batch = Array(queued.prefix(Self.batchSize))
                let rest = Array(queued.dropFirst(batch.count))
                if rest.isEmpty {
                    pending[shoot] = nil
                    order.removeFirst()
                } else {
                    pending[shoot] = rest
                }
                return (epoch, shoot, batch, rest.isEmpty, publish)
            }
            guard let (epoch, shoot, batch, done, publish) = next else { return }
            publish?(epoch, shoot, Self.enrichConcurrently(batch), done)
        }
    }

    /// Contiguous chunks rather than a stride, so the result keeps the input's
    /// order and each worker walks a neighbourhood of the directory.
    private static func enrichConcurrently(_ files: [ImageFile]) -> [ImageFile] {
        let lanes = min(ProcessInfo.processInfo.activeProcessorCount, files.count)
        guard lanes > 1 else { return files.map(enrich) }
        let chunk = (files.count + lanes - 1) / lanes
        let byLane = Mutex<[Int: [ImageFile]]>([:])
        DispatchQueue.concurrentPerform(iterations: lanes) { lane in
            let start = lane * chunk
            guard start < files.count else { return }
            let end = min(start + chunk, files.count)
            let enriched = files[start..<end].map(enrich)
            byLane.withLock { $0[lane] = enriched }
        }
        return byLane.withLock { done in (0..<lanes).flatMap { done[$0] ?? [] } }
    }
}
