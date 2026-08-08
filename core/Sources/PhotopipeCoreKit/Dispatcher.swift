import Foundation

public enum DispatchOutcome: Equatable, Sendable {
    case respond(Response)
    /// Respond, then the caller should exit the read loop.
    case shutdown(Response)

    public var response: Response {
        switch self {
        case .respond(let response), .shutdown(let response): response
        }
    }
}

/// Pure request dispatch — no I/O, fully unit-testable.
public func dispatch(line: String) -> DispatchOutcome {
    let request: Request
    do {
        request = try JSONDecoder().decode(Request.self, from: Data(line.utf8))
    } catch {
        return .respond(
            .failure(id: "", code: "bad_request", message: "malformed request: \(error.localizedDescription)")
        )
    }

    guard request.v == protocolVersion else {
        return .respond(
            .failure(
                id: request.id, code: "unsupported_protocol",
                message: "protocol v\(request.v) not supported, this core speaks v\(protocolVersion)"))
    }

    switch request.method {
    case "ping":
        return .respond(.success(id: request.id, result: .object(["pong": .bool(true)])))
    case "version":
        return .respond(
            .success(
                id: request.id,
                result: .object([
                    "version": .string(coreVersion),
                    "protocol": .number(Double(protocolVersion)),
                ])))
    case "shutdown":
        return .shutdown(.success(id: request.id, result: .object(["bye": .bool(true)])))
    default:
        return .respond(
            .failure(id: request.id, code: "unknown_method", message: "unknown method: \(request.method)"))
    }
}
