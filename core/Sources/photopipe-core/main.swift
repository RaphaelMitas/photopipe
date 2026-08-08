import Foundation
import PhotopipeCoreKit

setvbuf(stdout, nil, _IOLBF, 0)

// Safe off the main actor: Dispatcher is stateless routing over a
// lock-guarded LibraryService, and all stdout writes serialize on `out`.
nonisolated(unsafe) let dispatcher = Dispatcher()

/// Requests run concurrently (bounded, so a thumbnail burst can't spawn
/// unbounded image I/O); responses may return out of order — the envelope id
/// is what routes them. Stdout writes are serialized on `out`.
nonisolated(unsafe) let work = OperationQueue()
work.maxConcurrentOperationCount = 8
nonisolated(unsafe) let out = DispatchQueue(label: "photopipe.stdout")

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
    // Shutdown drains in-flight work first: a rating queued right before
    // Cmd-Q must land on disk, and the ack must genuinely be the last line.
    let method = (try? JSONDecoder().decode(MethodPeek.self, from: Data(line.utf8)))?.method
    if method == "shutdown" {
        work.waitUntilAllOperationsAreFinished()
        emit(dispatcher.dispatch(line: line))
        break
    }
    work.addOperation { emit(dispatcher.dispatch(line: line)) }
}
// EOF path (parent died): same drain so mutations aren't dropped.
work.waitUntilAllOperationsAreFinished()
ExifTool.shared.shutdown()
