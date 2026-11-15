import Foundation

struct Request: Sendable {
    let method: String
    let params: JSONValue?
}

public protocol WireError: Error {
    var wire: ResponseError { get }
}

public struct ResponseError: Equatable, Sendable {
    public let code: String
    public let message: String
}
