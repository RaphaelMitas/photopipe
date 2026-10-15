import Foundation

/// Answers protocol lines off the caller's thread, each exactly once.
public final class CoreHost: Sendable {
    public static let shared = CoreHost()

    private let dispatcher = Dispatcher()
    private let work: OperationQueue
    private let lanes = [
        // measured: parallel cold renders share the machine and the newest lands later
        "render": Lane(workers: 1, window: 4),
        // about a large grid's mounted cells, so an on-screen thumbnail rarely waits on a retry
        "thumbnail": Lane(workers: 8, window: 256),
    ]

    private struct Peek: Decodable {
        let id: String?
        let method: String?
    }

    public init() {
        let work = OperationQueue()
        work.maxConcurrentOperationCount = 8
        self.work = work
    }

    public func submit(_ line: String, reply: @escaping @Sendable (String) -> Void) {
        let dispatcher = dispatcher
        let respond: @Sendable (Response) -> Void = { reply(Self.encoded($0)) }
        let peek = try? JSONDecoder().decode(Peek.self, from: Data(line.utf8))
        if let peek, let method = peek.method, let lane = lanes[method] {
            lane.submit {
                respond(dispatcher.dispatch(line: line))
            } superseded: {
                respond(
                    .failure(
                        id: peek.id ?? "", code: "superseded",
                        message: "dropped for a newer \(method) request"))
            }
        } else {
            work.addOperation { respond(dispatcher.dispatch(line: line)) }
        }
    }

    /// Lets running requests finish, then stops exports and exiftool.
    public func shutdown() {
        work.waitUntilAllOperationsAreFinished()
        for lane in lanes.values { lane.waitUntilIdle() }
        _ = dispatcher.dispatch(line: #"{"v":\#(protocolVersion),"id":"","method":"shutdown"}"#)
        #if os(macOS)
            ExifTool.shared.shutdown()
        #endif
    }

    private static func encoded(_ response: Response) -> String {
        do {
            return try response.encodedLine()
        } catch {
            return
                #"{"v":\#(protocolVersion),"id":"\#(response.id)","ok":false,"error":{"code":"io_error","message":"unencodable response"}}"#
        }
    }
}
