import Foundation
import Synchronization

final class Enricher: @unchecked Sendable {
    typealias Publish = (_ epoch: Int, _ shoot: String, _ files: [ImageFile], _ done: Bool) -> Void

    private static let batchSize = 128

    private let lock = NSLock()
    private var pending: [String: [ImageFile]] = [:]
    private var order: [String] = []
    private var epoch = 0
    private var draining = false
    private var publish: Publish?
    private var wanted: String?
    private let queue = DispatchQueue(label: "photopipe.enrich", qos: .utility)

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
