import Foundation
import Vision

public typealias Scorer = Analyzer<Double>

extension Analyzer where Value == Double {
    public convenience init() {
        self.init(version: 1, concurrency: 6) { await Self.score(path: $0.path) }
    }

    static func score(path: String) async -> Double? {
        let request = CalculateImageAestheticsScoresRequest()
        guard
            let observation = try? await request.perform(on: URL(fileURLWithPath: path))
        else { return nil }
        return Double(observation.overallScore)
    }
}
