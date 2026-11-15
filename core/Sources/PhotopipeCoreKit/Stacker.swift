import Accelerate
import CoreGraphics
import Foundation
import ImageIO
import Vision

public struct Print: Equatable, Sendable {
    public let feature: [Float]

    public init(feature: [Float]) {
        self.feature = feature
    }
}

public typealias Printer = Analyzer<Print>

extension Analyzer where Value == Print {
    public convenience init() {
        self.init(version: 1, concurrency: 6) { await Self.print(path: $0.path) }
    }

    static func print(path: String) async -> Print? {
        guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
            let image = preview(source),
            let observation = try? await ImageRequestHandler(image).perform(
                GenerateImageFeaturePrintRequest())
        else { return nil }
        return Print(feature: floats(observation))
    }

    static func preview(_ source: CGImageSource) -> CGImage? {
        let size = Stacker.previewSize
        guard let embedded = Thumbnailer.image(from: source, maxPixel: size) else { return nil }
        if max(embedded.width, embedded.height) >= size { return embedded }
        return Thumbnailer.image(from: source, maxPixel: size, decodeFull: true) ?? embedded
    }

    private static func floats(_ observation: FeaturePrintObservation) -> [Float] {
        observation.data.withUnsafeBytes { bytes in
            switch observation.elementType {
            case .double: bytes.bindMemory(to: Double.self).map(Float.init)
            default: Array(bytes.bindMemory(to: Float.self))
            }
        }
    }
}

public enum Stacker {
    static let threshold: Float = 0.40
    static let window: Double = 60
    static let previewSize = 1024

    public static func stacks(_ prints: [String: Print], captured: [String: Double]) -> [String: String] {
        let ordered = prints.compactMap { path, print in
            captured[path].map { (path: path, print: print, captured: $0) }
        }
        .sorted { ($0.captured, $0.path) < ($1.captured, $1.path) }

        var stacks: [[(path: String, print: Print, captured: Double)]] = []
        var open: [Int] = []
        for photo in ordered {
            open.removeAll { photo.captured - stacks[$0][0].captured > window }
            let match = open.first { index in
                stacks[index].allSatisfy {
                    distance($0.print.feature, photo.print.feature) < threshold
                }
            }
            if let match {
                stacks[match].append(photo)
            } else {
                open.append(stacks.count)
                stacks.append([photo])
            }
        }

        var result: [String: String] = [:]
        for stack in stacks where stack.count > 1 {
            for member in stack { result[member.path] = stack[0].path }
        }
        return result
    }

    static func distance(_ a: [Float], _ b: [Float]) -> Float {
        guard a.count == b.count, !a.isEmpty else { return .infinity }
        return vDSP.distanceSquared(a, b).squareRoot()
    }
}
