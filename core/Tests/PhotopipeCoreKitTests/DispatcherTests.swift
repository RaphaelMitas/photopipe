import Foundation
import Testing

@testable import PhotopipeCoreKit

func request(_ method: String) -> String {
    "{\"method\":\"\(method)\"}"
}

@Test func pingRespondsPong() {
    let response = Dispatcher().dispatch(line: request("ping"))
    #expect(response == .success(result: .object(["pong": .bool(true)])))
}

@Test func statusTellsTheIndexingPollerWhetherItIsScanning() {
    let response = Dispatcher().dispatch(line: request("status"))
    #expect(response.result?["scanning"] == .bool(false))
}

@Test func unknownMethodFails() {
    let response = Dispatcher().dispatch(line: request("levitate"))
    #expect(!response.ok)
    #expect(response.error?.code == "unknown_method")
}

@Test func malformedJSONFailsAsBadRequest() {
    let response = Dispatcher().dispatch(line: "{not json")
    #expect(!response.ok)
    #expect(response.error?.code == "bad_request")
}

@Test func requestParamsRoundTrip() throws {
    let json = "{\"method\":\"ping\",\"params\":{\"depth\":2,\"tags\":[\"a\"]}}"
    let request = try JSONDecoder().decode(Request.self, from: Data(json.utf8))
    #expect(request.params?["depth"] == .number(2))
    #expect(request.params?["tags"] == .array([.string("a")]))
}
