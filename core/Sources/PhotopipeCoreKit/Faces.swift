import CoreImage
import Foundation
import Vision

/// A face in the photo as shot, before any crop or turn of the user's.
public struct FaceSpot: Codable, Equatable, Sendable {
    /// Fractions of the photo from the top left.
    public let box: CropRect
    /// Vision's face capture quality, 0 to 1: sharpness, lighting, expression and pose together.
    public let quality: Double?
    /// Energy of edges in the face at native pixels. Only comparable between frames of the same scene.
    public let sharpness: Double?
}

public typealias Facer = Analyzer<[FaceSpot]>

extension Analyzer where Value == [FaceSpot] {
    /// The biggest faces only: a crowd behind the couple says nothing about the frame.
    static let faceLimit = 4
    static let findEdge = 1600
    static let cropEdge = 1024

    public convenience init(renderer: Renderer) {
        self.init(version: 1, concurrency: 2) { path in
            try? Self.faces(in: Self.file(at: path), renderer: renderer)
        }
    }

    static func file(at path: String) throws -> ImageFile {
        let attrs = try FileManager.default.attributesOfItem(atPath: path)
        return ImageFile(
            path: path, rel: (path as NSString).lastPathComponent,
            ext: (path as NSString).pathExtension, size: (attrs[.size] as? Int64) ?? 0,
            mtime: ((attrs[.modificationDate] as? Date) ?? .distantPast).timeIntervalSince1970)
    }

    static func faces(in file: ImageFile, renderer: Renderer) throws -> [FaceSpot] {
        let photo = try renderer.still(file: file, edit: .identity, longEdge: findEdge)
        let found = try awaited { try await DetectFaceCaptureQualityRequest().perform(on: photo) }
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
        CropRect(
            left: rect.minX, top: 1 - rect.maxY, right: rect.maxX, bottom: 1 - rect.minY)
    }

    /// Mean squared Laplacian of the grey image, scaled up to read as a plain number.
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
