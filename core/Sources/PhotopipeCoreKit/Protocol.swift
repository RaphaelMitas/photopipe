import Foundation

/// Request:  {"method":"ping","params":{...}}
/// Response: {"ok":true,"result":{...}} or {"ok":false,"error":{"code":"...","message":"..."}}
public struct Request: Codable, Equatable, Sendable {
    public let method: String
    public let params: JSONValue?
}

/// What the client sees of a thrown error; any other error reaches it as io_error.
public protocol WireError: Error {
    var wire: ResponseError { get }
}

public struct ResponseError: Codable, Equatable, Sendable {
    public let code: String
    public let message: String
}

public struct Response: Codable, Equatable, Sendable {
    public let ok: Bool
    public let result: JSONValue?
    public let error: ResponseError?

    public static func success(result: JSONValue) -> Response {
        Response(ok: true, result: result, error: nil)
    }

    public static func failure(code: String, message: String) -> Response {
        failure(error: ResponseError(code: code, message: message))
    }

    public static func failure(error: ResponseError) -> Response {
        Response(ok: false, result: nil, error: error)
    }

    public func encodedLine() throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(self)
        return String(decoding: data, as: UTF8.self)
    }
}
