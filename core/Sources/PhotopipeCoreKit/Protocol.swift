import Foundation

/// Sidecar protocol v1: line-delimited JSON over stdio.
///
/// Request:  {"v":1,"id":"<caller id>","method":"ping","params":{...}}
/// Response: {"v":1,"id":"<caller id>","ok":true,"result":{...}}
///           {"v":1,"id":"<caller id>","ok":false,"error":{"code":"...","message":"..."}}
public let protocolVersion = 1
/// Shipped, the core sits in the app's Contents/MacOS and so reads the app's Info.plist.
public let coreVersion =
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"

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

/// What the client sees of a thrown error; any other error reaches it as io_error.
public protocol WireError: Error {
    var wire: ResponseError { get }
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
        failure(id: id, error: ResponseError(code: code, message: message))
    }

    public static func failure(id: String, error: ResponseError) -> Response {
        Response(v: protocolVersion, id: id, ok: false, result: nil, error: error)
    }

    /// Single-line JSON, deterministic key order.
    public func encodedLine() throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(self)
        return String(decoding: data, as: UTF8.self)
    }
}
