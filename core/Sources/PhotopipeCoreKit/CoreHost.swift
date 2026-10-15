import Foundation

public final class CoreHost: Sendable {
    public static let shared = CoreHost()

    private let library: LibraryService
    private let dispatcher: Dispatcher
    private let work: OperationQueue
    private let lanes = [
        // measured: parallel cold renders share the machine and the newest lands later
        "render": Lane(workers: 1, window: 4),
        // about a large grid's mounted cells, so an on-screen thumbnail rarely waits on a retry
        "thumbnail": Lane(workers: 8, window: 256),
    ]

    public init() {
        library = LibraryService()
        dispatcher = Dispatcher(library: library)
        let work = OperationQueue()
        work.maxConcurrentOperationCount = 8
        self.work = work
    }

    public func submit(
        method: String, params: String?, reply: @escaping @Sendable (Bool, String) -> Void
    ) {
        let dispatcher = dispatcher
        let answer: @Sendable () -> Void = {
            let (ok, text) = dispatcher.dispatch(method: method, params: params)
            reply(ok, text)
        }
        if method == "setRoot" {
            // a walk of a hung volume never returns, and must not hold a slot everything else needs
            DispatchQueue.global(qos: .userInitiated).async(execute: answer)
        } else if let lane = lanes[method] {
            lane.submit(answer) {
                reply(false, "superseded: dropped for a newer \(method) request")
            }
        } else {
            work.addOperation(answer)
        }
    }

    /// exiftool is left to its exit hook, which stops it once the queue is idle.
    public func shutdown() {
        work.waitUntilAllOperationsAreFinished()
        for lane in lanes.values { lane.waitUntilIdle() }
        library.stopExports()
    }
}
