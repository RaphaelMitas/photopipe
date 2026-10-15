import CoreGraphics
import Foundation
import ImageIO
import Vision

/// What stacking needs to know about a photo: what it looks like, and when it was taken.
public struct Print: Equatable, Sendable {
    public let feature: [Float]
    public let captured: Double?

    public init(feature: [Float], captured: Double?) {
        self.feature = feature
        self.captured = captured
    }
}

/// Vision feature prints, read from the preview a camera embeds rather than the raw itself.
public typealias Printer = Analyzer<Print>

extension Analyzer where Value == Print {
    public convenience init() {
        self.init(version: 1, concurrency: 6, analyze: Self.print)
    }

    public func prints(for files: [ImageFile]) -> [String: Print] {
        values(for: files)
    }

    static func print(path: String) async -> Print? {
        guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
            let image = CGImageSourceCreateThumbnailAtIndex(
                source, 0,
                [
                    kCGImageSourceCreateThumbnailFromImageIfAbsent: true,
                    kCGImageSourceThumbnailMaxPixelSize: Stacker.previewSize,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                ] as CFDictionary),
            let observation = try? await ImageRequestHandler(image).perform(
                GenerateImageFeaturePrintRequest())
        else { return nil }
        let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        return Print(
            feature: floats(observation), captured: props.flatMap(Dimensions.captureTime))
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

/// Groups near-identical photos. In capture order, a photo joins the stack being built when it
/// looks like every photo already in it and was taken within `window` of the first; comparing
/// against all of them stops a slow drift from chaining a whole song into one stack.
public enum Stacker {
    /// Feature-print distance below which two frames read as the same picture. Tuned by eye on
    /// consecutive pairs from a dance event: 0.35–0.40 still looked the same, 0.40–0.45 did not.
    static let threshold: Float = 0.40
    /// So two near-identical shots of an empty hall an hour apart stay apart.
    static let window: Double = 60
    /// The threshold holds for prints of this size; a full-size preview moves distances by ~0.01.
    static let previewSize = 1024

    /// The stack each photo belongs to, named by the path of its first photo. Photos that stand
    /// alone, or that have no capture time to order them by, are left out.
    public static func stacks(_ prints: [String: Print]) -> [String: String] {
        let ordered = prints.compactMap { path, print in
            print.captured.map { (path: path, print: print, captured: $0) }
        }
        .sorted { ($0.captured, $0.path) < ($1.captured, $1.path) }

        var result: [String: String] = [:]
        var current: [(path: String, print: Print, captured: Double)] = []
        func close() {
            guard current.count > 1 else { return }
            for member in current { result[member.path] = current[0].path }
        }
        for photo in ordered {
            if let first = current.first, photo.captured - first.captured <= window,
                current.allSatisfy({
                    distance($0.print.feature, photo.print.feature) < threshold
                })
            {
                current.append(photo)
            } else {
                close()
                current = [photo]
            }
        }
        close()
        return result
    }

    static func distance(_ a: [Float], _ b: [Float]) -> Float {
        guard a.count == b.count, !a.isEmpty else { return .infinity }
        var sum: Float = 0
        for i in a.indices {
            let d = a[i] - b[i]
            sum += d * d
        }
        return sum.squareRoot()
    }
}
