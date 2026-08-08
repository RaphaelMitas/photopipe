import Foundation
import PhotopipeCoreKit

setvbuf(stdout, nil, _IOLBF, 0)

while let line = readLine(strippingNewline: true) {
    if line.isEmpty { continue }
    let outcome = dispatch(line: line)
    do {
        print(try outcome.response.encodedLine())
    } catch {
        FileHandle.standardError.write(Data("encode error: \(error)\n".utf8))
    }
    if case .shutdown = outcome { break }
}
