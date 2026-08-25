import Foundation
import PhotopipeCoreKit

setvbuf(stdout, nil, _IOLBF, 0)

nonisolated(unsafe) let dispatcher = Dispatcher()

let work = OperationQueue()
work.maxConcurrentOperationCount = 8
let out = DispatchQueue(label: "photopipe.stdout")

private struct MethodPeek: Decodable { let method: String? }

func emit(_ outcome: DispatchOutcome) {
    out.sync {
        do {
            print(try outcome.response.encodedLine())
        } catch {
            FileHandle.standardError.write(Data("encode error: \(error)\n".utf8))
        }
    }
}

while let line = readLine(strippingNewline: true) {
    if line.isEmpty { continue }
    let method = (try? JSONDecoder().decode(MethodPeek.self, from: Data(line.utf8)))?.method
    if method == "shutdown" {
        work.waitUntilAllOperationsAreFinished()
        emit(dispatcher.dispatch(line: line))
        break
    }
    work.addOperation { emit(dispatcher.dispatch(line: line)) }
}
work.waitUntilAllOperationsAreFinished()
