import Foundation

/// Sidecar protocol v1: line-delimited JSON over stdio.
///
/// Request:  {"v":1,"id":"<caller id>","method":"ping","params":{...}}
/// Response: {"v":1,"id":"<caller id>","ok":true,"result":{...}}
///           {"v":1,"id":"<caller id>","ok":false,"error":{"code":"...","message":"..."}}
public let protocolVersion = 1
public let coreVersion = "0.1.0"

public struct Request: Codable, Equatable, Sendable {
    public let v: Int
    public let id: String
    public let method: String
    public let params: JSONValue?

    public init(v: Int = protocolVersion, id: String, method: String, params: JSONValue? = nil) {
        self.v = v
        self.id = id
        self.method = method
        self.params = params
    }
}

public struct ResponseError: Codable, Equatable, Sendable {
    public let code: String
    public let message: String
}

public struct Response: Codable, Equatable, Sendable {
    public let v: Int
    public let id: String
    public let ok: Bool
    public let result: JSONValue?
    public let error: ResponseError?

    public static func success(id: String, result: JSONValue) -> Response {
        Response(v: protocolVersion, id: id, ok: true, result: result, error: nil)
    }

    public static func failure(id: String, code: String, message: String) -> Response {
        Response(
            v: protocolVersion, id: id, ok: false, result: nil,
            error: ResponseError(code: code, message: message))
    }

    /// Single-line JSON, deterministic key order.
    public func encodedLine() throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(self)
        return String(decoding: data, as: UTF8.self)
    }
}
