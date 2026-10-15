import Accelerate
import CoreGraphics
import Foundation
import ImageIO
import Vision

public struct Print: Equatable, Sendable {
    public let feature: [Float]
    public let captured: Double?

    public init(feature: [Float], captured: Double?) {
        self.feature = feature
        self.captured = captured
    }
}

/// Vision feature prints of a downscaled preview.
public typealias Printer = Analyzer<Print>

extension Analyzer where Value == Print {
    public convenience init() {
        self.init(version: 1, concurrency: 6, analyze: Self.print)
    }

    static func print(path: String) async -> Print? {
        guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
            let image = preview(source),
            let observation = try? await ImageRequestHandler(image).perform(
                GenerateImageFeaturePrintRequest())
        else { return nil }
        let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        return Print(
            feature: floats(observation), captured: props.flatMap(Dimensions.captureTime))
    }

    /// A raw's embedded preview is cheap and big enough; a JPEG's embedded thumbnail is often
    /// 160 px, too small for the threshold, so that one is decoded instead.
    static func preview(_ source: CGImageSource) -> CGImage? {
        func thumbnail(always: Bool) -> CGImage? {
            CGImageSourceCreateThumbnailAtIndex(
                source, 0,
                [
                    always
                        ? kCGImageSourceCreateThumbnailFromImageAlways
                        : kCGImageSourceCreateThumbnailFromImageIfAbsent: true,
                    kCGImageSourceThumbnailMaxPixelSize: Stacker.previewSize,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                ] as CFDictionary)
        }
        guard let embedded = thumbnail(always: false) else { return nil }
        if max(embedded.width, embedded.height) >= Stacker.previewSize { return embedded }
        return thumbnail(always: true) ?? embedded
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
    /// Tuned by eye on dance-event pairs: 0.35–0.40 still looked the same, 0.40–0.45 did not.
    static let threshold: Float = 0.40
    /// So two near-identical shots of an empty hall an hour apart stay apart.
    static let window: Double = 60
    /// The threshold holds for prints of this size; a full-size preview moves distances by ~0.01.
    static let previewSize = 1024

    /// The stack each photo belongs to, named by the path of its first photo. Photos that stand
    /// alone, or that have no capture time to order them by, are left out. A photo joins the first
    /// stack still open, its first frame within `window`, whose every frame it looks like: every
    /// frame, so slow drift cannot chain a whole song into one stack, and any open stack, so a
    /// misfire or a second shooter's frame mid-burst does not cut the burst in two.
    public static func stacks(_ prints: [String: Print]) -> [String: String] {
        let ordered = prints.compactMap { path, print in
            print.captured.map { (path: path, print: print, captured: $0) }
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
