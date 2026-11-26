import CoreImage
import CoreML
import Vision

extension Runner {
    var configuration: MLModelConfiguration {
        let configuration = MLModelConfiguration()
        switch self {
        case .lama1024: configuration.computeUnits = .cpuAndGPU
        }
        return configuration
    }
}

enum LaMa {
    enum FillError: Error {
        case unexpectedModel
        case sizeMismatch
    }

    static let side = 1024
    static let contextPerHole = 4.0

    static func crop(around hole: CGRect, in extent: CGRect) -> CGRect? {
        let wanted = max(hole.width, hole.height) * contextPerHole
        let fits = min(extent.width, extent.height)
        guard wanted <= fits else { return nil }
        let side = min(max(wanted, Double(Self.side)), fits).rounded(.down)
        let x = min(max(hole.midX - side / 2, extent.minX), extent.maxX - side).rounded(.down)
        let y = min(max(hole.midY - side / 2, extent.minY), extent.maxY - side).rounded(.down)
        return CGRect(x: x, y: y, width: side, height: side)
    }

    static func fill(_ crop: CGImage, hole: CGImage, with model: MLModel) throws -> CIImage {
        guard crop.width == crop.height, crop.width == hole.width, crop.height == hole.height
        else { throw FillError.sizeMismatch }
        let inputs = model.modelDescription.inputDescriptionsByName
        guard let imageInput = inputs["image"]?.imageConstraint,
            let maskInput = inputs["mask"]?.imageConstraint
        else { throw FillError.unexpectedModel }
        let output = try model.prediction(
            from: MLDictionaryFeatureProvider(dictionary: [
                "image": try MLFeatureValue(
                    cgImage: crop, constraint: imageInput,
                    options: [.cropAndScale: VNImageCropAndScaleOption.scaleFill.rawValue]),
                "mask": try MLFeatureValue(
                    cgImage: try covering(hole, side: maskInput.pixelsWide), constraint: maskInput),
            ]))
        guard let filled = output.featureValue(for: "output")?.imageBufferValue else {
            throw FillError.unexpectedModel
        }
        let scale = Double(crop.width) / Double(CVPixelBufferGetWidth(filled))
        return CIImage(cvPixelBuffer: filled)
            .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    }

    private static func covering(_ hole: CGImage, side: Int) throws -> CGImage {
        guard
            let context = CGContext(
                data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side,
                space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue),
            let pixels = context.data?.assumingMemoryBound(to: UInt8.self)
        else { throw FillError.unexpectedModel }
        context.interpolationQuality = .high
        context.draw(hole, in: CGRect(x: 0, y: 0, width: side, height: side))
        for index in 0..<side * side where pixels[index] > 0 { pixels[index] = 255 }
        guard let covering = context.makeImage() else { throw FillError.unexpectedModel }
        return covering
    }
}
