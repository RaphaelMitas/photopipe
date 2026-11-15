import Foundation

public final class CoreHost: Sendable {
    public static let shared = CoreHost()

    private let library: LibraryService
    private let dispatcher: Dispatcher
    private let work: OperationQueue
    private let lanes: [String: Lane] = {
        let masks = Lane(workers: 1, window: 64)
        let agent = Lane(workers: 1, window: 32, qos: .utility)
        return [
            "render": Lane(workers: 1, window: 4),
            "thumbnail": Lane(workers: 8, window: 256),
            "look": agent,
            "faces": agent,
            "describe": agent,
            "maskOverlay": masks,
            "maskAt": masks,
        ]
    }()

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
        if method == "setRoot" || method == "rescan" {
            DispatchQueue.global(qos: .userInitiated).async(execute: answer)
        } else if let lane = lanes[method] {
            lane.submit(answer) {
                reply(false, "superseded: dropped for a newer \(method) request")
            }
        } else {
            work.addOperation(answer)
        }
    }

    public func shutdown() {
        work.waitUntilAllOperationsAreFinished()
        for lane in lanes.values where lane !== lanes["look"] { lane.waitUntilIdle() }
        library.stopExports()
    }
}
