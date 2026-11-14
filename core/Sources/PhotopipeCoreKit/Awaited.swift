import Foundation
import Synchronization

/// For a synchronous core request that has to use an async API. An export waits here on a thread of Swift's
/// pool, which spares one for this task only while exports stay utility.
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
