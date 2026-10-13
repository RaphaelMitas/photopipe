import Foundation
import Synchronization
import Testing

@testable import PhotopipeCoreKit

@Test func aBurstRunsOnlyTheNewestWindowNewestFirst() {
    let lane = Lane(workers: 1, window: 4)
    let started = DispatchSemaphore(value: 0)
    let gate = DispatchSemaphore(value: 0)
    let ran = Mutex<[Int]>([])
    let superseded = Mutex<[Int]>([])

    lane.submit(
        {
            started.signal()
            gate.wait()
        }, superseded: {})
    started.wait()
    for job in 0..<20 {
        lane.submit(
            { ran.withLock { $0.append(job) } }, superseded: { superseded.withLock { $0.append(job) } })
    }

    #expect(superseded.withLock { $0 } == Array(0..<16))
    #expect(ran.withLock { $0 }.isEmpty)

    gate.signal()
    lane.waitUntilIdle()
    #expect(ran.withLock { $0 } == [19, 18, 17, 16])
    #expect(superseded.withLock { $0 } == Array(0..<16))
}
