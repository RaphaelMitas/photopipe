import Foundation
import Testing

@testable import PhotopipeCoreKit

private func fixtureURL() -> URL {
    URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("fixtures/curve-samples.json")
}

private struct CurveFixture: Codable {
    var resolution: Int
    var cases: [Case]

    struct Case: Codable {
        var name: String
        var points: [CurvePoint]
        var samples: [Double]
    }
}

private let fixtureCases: [(name: String, points: [CurvePoint])] = [
    (
        "sCurve",
        [
            CurvePoint(x: 0, y: 0), CurvePoint(x: 0.25, y: 0.15),
            CurvePoint(x: 0.75, y: 0.85), CurvePoint(x: 1, y: 1),
        ]
    ),
    ("midLift", [CurvePoint(x: 0, y: 0), CurvePoint(x: 0.5, y: 0.7), CurvePoint(x: 1, y: 1)]),
    ("fade", [CurvePoint(x: 0, y: 0.12), CurvePoint(x: 0.6, y: 0.5), CurvePoint(x: 1, y: 0.95)]),
    ("inverted", [CurvePoint(x: 0, y: 1), CurvePoint(x: 1, y: 0)]),
    (
        "plateau",
        [
            CurvePoint(x: 0, y: 0), CurvePoint(x: 0.4, y: 0.5),
            CurvePoint(x: 0.6, y: 0.5), CurvePoint(x: 1, y: 1),
        ]
    ),
]

@Test func splinePassesThroughItsPointsMonotonically() {
    let points = [
        CurvePoint(x: 0, y: 0), CurvePoint(x: 0.3, y: 0.2),
        CurvePoint(x: 0.7, y: 0.8), CurvePoint(x: 1, y: 1),
    ]
    for point in points {
        #expect(abs(Curve.evaluate(points, at: point.x) - point.y) < 1e-9)
    }
    let samples = Curve.sample(points, count: 256)
    for i in 1..<samples.count {
        #expect(samples[i] >= samples[i - 1], "monotone points must give a monotone spline")
    }
    #expect(Curve.evaluate(points, at: -0.5) == 0, "flat below the first point")
    #expect(Curve.evaluate(points, at: 1.5) == 1, "flat above the last point")
}

@Test func identityCurvesAreDetected() {
    #expect(Curve.isIdentity([]))
    #expect(Curve.isIdentity([CurvePoint(x: 0.5, y: 0.5)]))
    #expect(Curve.isIdentity([CurvePoint(x: 0, y: 0), CurvePoint(x: 1, y: 1)]))
    #expect(!Curve.isIdentity([CurvePoint(x: 0, y: 0.1), CurvePoint(x: 1, y: 1)]))
}

@Test func toneLUTOnlyExistsWhenNeeded() {
    #expect(ToneLUT.samples(for: .identity) == nil)
    #expect(ToneLUT.samples(for: Edit(exposure: 1, saturation: 50)) == nil)

    let lifted = ToneLUT.samples(for: Edit(shadows: 100))
    #expect(lifted != nil)
    if let lifted {
        #expect(lifted.count == ToneLUT.resolution * 3)
        let dark = lifted[3 * 32]
        #expect(Double(dark) > 32.0 / 255, "shadows +100 lifts the darks")
        for i in 1..<ToneLUT.resolution {
            #expect(lifted[i * 3] >= lifted[(i - 1) * 3], "the parametric part stays monotone")
        }
    }
}

@Test func editDecodesFromPartialJSON() throws {
    let empty = try JSONDecoder().decode(Edit.self, from: Data("{}".utf8))
    #expect(empty == .identity)
    let partial = try JSONDecoder().decode(
        Edit.self, from: Data(#"{"exposure":0.5,"temperature":5500}"#.utf8))
    #expect(partial.exposure == 0.5)
    #expect(partial.temperature == 5500)
    #expect(partial.tint == nil)
    #expect(partial.curveRGB.isEmpty)
}

@Test func cacheKeyIsDeterministic() {
    let a = Edit(exposure: 0.5, curveRGB: [CurvePoint(x: 0, y: 0), CurvePoint(x: 1, y: 0.9)])
    let b = Edit(exposure: 0.5, curveRGB: [CurvePoint(x: 0, y: 0), CurvePoint(x: 1, y: 0.9)])
    #expect(a.cacheKey == b.cacheKey)
    #expect(a.cacheKey != Edit(exposure: 0.6).cacheKey)
}

/// The TypeScript curve editor ships its own copy of this spline. The fixture
/// pins both to the same samples; regenerate with
/// PHOTOPIPE_WRITE_FIXTURES=1 swift test --filter curveFixture
@Test func curveFixtureMatchesTheSharedSamples() throws {
    let url = fixtureURL()
    if ProcessInfo.processInfo.environment["PHOTOPIPE_WRITE_FIXTURES"] != nil {
        let resolution = 64
        let fixture = CurveFixture(
            resolution: resolution,
            cases: fixtureCases.map {
                CurveFixture.Case(
                    name: $0.name, points: $0.points,
                    samples: Curve.sample($0.points, count: resolution).map {
                        (($0 * 1e9).rounded() / 1e9)
                    })
            })
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(fixture).write(to: url)
    }

    let fixture = try JSONDecoder().decode(CurveFixture.self, from: Data(contentsOf: url))
    #expect(fixture.cases.count == fixtureCases.count)
    for testCase in fixture.cases {
        let samples = Curve.sample(testCase.points, count: fixture.resolution)
        for (i, expected) in testCase.samples.enumerated() {
            #expect(
                abs(samples[i] - expected) < 1e-8,
                "\(testCase.name)[\(i)]: \(samples[i]) vs fixture \(expected)")
        }
    }
}
