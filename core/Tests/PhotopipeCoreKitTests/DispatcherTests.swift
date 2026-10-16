import Foundation
import Testing

@testable import PhotopipeCoreKit

@Test func pingRespondsPong() {
    let reply = Dispatcher().dispatch(method: "ping")
    #expect(reply.ok)
    #expect(reply.text == #"{"pong":true}"#)
}

@Test func statusTellsTheIndexingPollerWhetherItIsScanning() {
    let reply = Dispatcher().dispatch(method: "status")
    #expect(reply.text.contains(#""scanning":false"#))
}

@Test func unknownMethodFails() {
    let reply = Dispatcher().dispatch(method: "levitate")
    #expect(!reply.ok)
    #expect(reply.text.hasPrefix("unknown_method:"))
}

@Test func malformedParamsFailAsBadRequest() {
    let reply = Dispatcher().dispatch(method: "ping", params: "{not json")
    #expect(!reply.ok)
    #expect(reply.text.hasPrefix("bad_request:"))
}

@Test func aMissingParamIsNamedInTheError() {
    let reply = Dispatcher().dispatch(method: "listImages", params: #"{"other":1}"#)
    #expect(!reply.ok)
    #expect(reply.text == "invalid_params: shoot required")
}
