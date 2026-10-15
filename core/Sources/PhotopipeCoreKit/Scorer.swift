import Foundation
import Vision

/// Aesthetic scores from Vision, -1 to 1.
public typealias Scorer = Analyzer<Double>

extension Analyzer where Value == Double {
    /// Vision reads the RAW file itself, so nothing here decodes an image.
    public convenience init() {
        self.init(version: 1, concurrency: 6, analyze: Self.score)
    }

    public func scores(for files: [ImageFile]) -> [String: Double] {
        values(for: files)
    }

    static func score(path: String) async -> Double? {
        let request = CalculateImageAestheticsScoresRequest()
        guard
            let observation = try? await request.perform(on: URL(fileURLWithPath: path))
        else { return nil }
        return Double(observation.overallScore)
    }
}
