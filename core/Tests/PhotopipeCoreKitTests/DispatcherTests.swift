import Foundation
import Testing

@testable import PhotopipeCoreKit

func request(_ method: String, id: String = "1", v: Int = protocolVersion) -> String {
    "{\"v\":\(v),\"id\":\"\(id)\",\"method\":\"\(method)\"}"
}

@Test func pingRespondsPong() {
    let response = Dispatcher().dispatch(line: request("ping"))
    #expect(response == .success(id: "1", result: .object(["pong": .bool(true)])))
}

@Test func versionReportsSemverAndProtocol() throws {
    let response = Dispatcher().dispatch(line: request("version", id: "42"))
    #expect(response.ok)
    #expect(response.id == "42")
    #expect(response.result?["protocol"] == .number(1))
    guard case .string(let version)? = response.result?["version"] else {
        Issue.record("missing version string")
        return
    }
    #expect(version.split(separator: ".").count == 3)
}

@Test func shutdownSaysBye() {
    let response = Dispatcher().dispatch(line: request("shutdown"))
    #expect(response == .success(id: "1", result: .object(["bye": .bool(true)])))
}

@Test func unknownMethodFails() {
    let response = Dispatcher().dispatch(line: request("levitate"))
    #expect(!response.ok)
    #expect(response.error?.code == "unknown_method")
    #expect(response.id == "1")
}

@Test func malformedJSONFailsAsBadRequest() {
    let response = Dispatcher().dispatch(line: "{not json")
    #expect(!response.ok)
    #expect(response.error?.code == "bad_request")
}

@Test func futureProtocolVersionIsRejected() {
    let response = Dispatcher().dispatch(line: request("ping", v: 99))
    #expect(!response.ok)
    #expect(response.error?.code == "unsupported_protocol")
}

@Test func encodedResponseIsSingleLine() throws {
    let line = try Dispatcher().dispatch(line: request("version")).encodedLine()
    #expect(!line.contains("\n"))
    #expect(line.hasPrefix("{"))
}

@Test func requestParamsRoundTrip() throws {
    let json = "{\"v\":1,\"id\":\"7\",\"method\":\"ping\",\"params\":{\"depth\":2,\"tags\":[\"a\"]}}"
    let request = try JSONDecoder().decode(Request.self, from: Data(json.utf8))
    #expect(request.params?["depth"] == .number(2))
    #expect(request.params?["tags"] == .array([.string("a")]))
}
