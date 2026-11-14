import Foundation
import Synchronization

/// Blocks the calling thread, so a caller on Swift's pool must leave a thread spare for the task.
func awaited<Value: Sendable>(_ work: @escaping @Sendable () async throws -> Value) throws -> Value {
    let done = DispatchSemaphore(value: 0)
    let answer = Mutex<Result<Value, any Error>?>(nil)
    Task.detached {
        let result: Result<Value, any Error>
        do {
            result = .success(try await work())
        } catch {
            result = .failure(error)
        }
        answer.withLock { $0 = result }
        done.signal()
    }
    done.wait()
    return try answer.withLock { $0! }.get()
}
