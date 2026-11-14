import CoreImage
import Foundation
import Vision

/// A face in the photo as shot, before any crop or turn of the user's.
public struct FaceSpot: Codable, Equatable, Sendable {
    /// Fractions of the photo from the top left.
    public let box: CropRect
    public let quality: Double?
    /// Only comparable between frames of the same scene.
    public let sharpness: Double?
}

public typealias Facer = Analyzer<[FaceSpot]>

extension Analyzer where Value == [FaceSpot] {
    /// The biggest faces only: a crowd behind the couple says nothing about the frame.
    static let faceLimit = 4
    static let findEdge = 1600
    static let cropEdge = 1024

    public convenience init(renderer: Renderer) {
        self.init(version: 1, concurrency: 2) { file in
            try? await Self.faces(in: file, renderer: renderer)
        }
    }

    static func faces(in file: ImageFile, renderer: Renderer) async throws -> [FaceSpot] {
        let photo = try renderer.still(file: file, edit: .identity, longEdge: findEdge)
        let found = try await DetectFaceCaptureQualityRequest().perform(on: photo)
        return
            found
            .sorted {
                $0.boundingBox.width * $0.boundingBox.height > $1.boundingBox.width * $1.boundingBox.height
            }
            .prefix(faceLimit)
            .map { face in
                let box = Self.box(face.boundingBox.cgRect)
                let crop = try? renderer.still(
                    file: file, edit: .identity, longEdge: cropEdge, viewport: box)
                return FaceSpot(
                    box: box, quality: face.captureQuality.map { Double($0.score) },
                    sharpness: crop.map(Self.sharpness))
            }
    }

    /// Vision's lower-left rect to the renderer's top-left fractions.
    static func box(_ rect: CGRect) -> CropRect {
        // a face cut off at the edge reaches past the frame
        let rect = rect.intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        return CropRect(
            left: rect.minX, top: 1 - rect.maxY, right: rect.maxX, bottom: 1 - rect.minY)
    }

    /// Mean squared Laplacian, scaled up to read as a plain number.
    static func sharpness(of image: CGImage) -> Double {
        let grey = CIImage(cgImage: image)
            .applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 0])
        let edges = grey.clampedToExtent()
            .applyingFilter(
                "CIConvolution3X3",
                parameters: [
                    kCIInputWeightsKey: CIVector(values: [0, 1, 0, 1, -4, 1, 0, 1, 0], count: 9)
                ]
            )
            .cropped(to: grey.extent)
        let energy = edges.applyingFilter(
            "CIMultiplyCompositing", parameters: [kCIInputBackgroundImageKey: edges]
        )
        .applyingFilter(
            "CIAreaAverage", parameters: [kCIInputExtentKey: CIVector(cgRect: grey.extent)])
        var pixel = [Float](repeating: 0, count: 4)
        CIContext().render(
            energy, toBitmap: &pixel, rowBytes: 16, bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
            format: .RGBAf, colorSpace: nil)
        return (Double(pixel[0]) * 10_000).rounded() / 10
    }
}
