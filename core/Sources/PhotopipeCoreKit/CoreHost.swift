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

    private struct Peek: Decodable {
        let method: String?
    }

    public init() {
        library = LibraryService()
        dispatcher = Dispatcher(library: library)
        let work = OperationQueue()
        work.maxConcurrentOperationCount = 8
        self.work = work
    }

    public func submit(_ line: String, reply: @escaping @Sendable (String) -> Void) {
        let dispatcher = dispatcher
        let respond: @Sendable (Response) -> Void = { reply(Self.encoded($0)) }
        let method = (try? JSONDecoder().decode(Peek.self, from: Data(line.utf8)))?.method
        if method == "setRoot" {
            // a walk of a hung volume never returns, and must not hold a slot everything else needs
            DispatchQueue.global(qos: .userInitiated).async { respond(dispatcher.dispatch(line: line)) }
        } else if let method, let lane = lanes[method] {
            lane.submit {
                respond(dispatcher.dispatch(line: line))
            } superseded: {
                respond(
                    .failure(code: "superseded", message: "dropped for a newer \(method) request"))
            }
        } else {
            work.addOperation { respond(dispatcher.dispatch(line: line)) }
        }
    }

    public func shutdown() {
        work.waitUntilAllOperationsAreFinished()
        for lane in lanes.values { lane.waitUntilIdle() }
        library.stopExports()
        #if os(macOS)
            ExifTool.shared.shutdown()
        #endif
    }

    private static func encoded(_ response: Response) -> String {
        do {
            return try response.encodedLine()
        } catch {
            return #"{"ok":false,"error":{"code":"io_error","message":"unencodable response"}}"#
        }
    }
}
