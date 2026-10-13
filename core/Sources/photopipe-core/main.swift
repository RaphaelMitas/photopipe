import Foundation
import PhotopipeCoreKit

setvbuf(stdout, nil, _IOLBF, 0)

nonisolated(unsafe) let dispatcher = Dispatcher()

let work = OperationQueue()
work.maxConcurrentOperationCount = 8
let lanes = [
    // measured: parallel cold renders share the machine and the newest lands later
    "render": Lane(workers: 1, window: 4),
    // a superseded thumbnail stays blank while mounted, so cover a large grid's mounted cells
    "thumbnail": Lane(workers: 8, window: 256),
]
let out = DispatchQueue(label: "photopipe.stdout")

private struct Peek: Decodable {
    let id: String?
    let method: String?
}

func emit(_ response: Response) {
    out.sync {
        do {
            print(try response.encodedLine())
        } catch {
            FileHandle.standardError.write(Data("encode error: \(error)\n".utf8))
        }
    }
}

func waitUntilIdle() {
    work.waitUntilAllOperationsAreFinished()
    for lane in lanes.values { lane.waitUntilIdle() }
}

while let line = readLine(strippingNewline: true) {
    if line.isEmpty { continue }
    let peek = try? JSONDecoder().decode(Peek.self, from: Data(line.utf8))
    if peek?.method == "shutdown" {
        waitUntilIdle()
        emit(dispatcher.dispatch(line: line))
        break
    }
    if let peek, let method = peek.method, let lane = lanes[method] {
        lane.submit {
            emit(dispatcher.dispatch(line: line))
        } superseded: {
            emit(
                .failure(
                    id: peek.id ?? "", code: "superseded",
                    message: "dropped for a newer \(method) request"))
        }
    } else {
        work.addOperation { emit(dispatcher.dispatch(line: line)) }
    }
}
waitUntilIdle()
ExifTool.shared.shutdown()
