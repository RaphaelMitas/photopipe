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
    /// alone, or that have no capture time to order them by, are left out. A photo must look like
    /// every frame already in the stack, not just the last, so slow drift cannot chain a song.
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
        return vDSP.distanceSquared(a, b).squareRoot()
    }
}
