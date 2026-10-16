import Foundation

struct Request: Sendable {
    let method: String
    let params: JSONValue?
}

/// What the client sees of a thrown error; any other error reaches it as io_error.
public protocol WireError: Error {
    var wire: ResponseError { get }
}

public struct ResponseError: Equatable, Sendable {
    public let code: String
    public let message: String
}
