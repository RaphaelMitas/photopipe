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

    static func crop(around hole: CGRect, in extent: CGRect) -> CGRect {
        let wanted = max(hole.width, hole.height) * contextPerHole
        let side = min(max(wanted, Double(Self.side)), extent.width, extent.height).rounded(.down)
        let x = min(max(hole.midX - side / 2, extent.minX), extent.maxX - side).rounded(.down)
        let y = min(max(hole.midY - side / 2, extent.minY), extent.maxY - side).rounded(.down)
        return CGRect(x: x, y: y, width: side, height: side)
    }

    static func fill(_ crop: CGImage, hole: CGImage, with model: MLModel) throws -> CIImage {
        guard crop.width == hole.width, crop.height == hole.height else {
            throw FillError.sizeMismatch
        }
        let inputs = model.modelDescription.inputDescriptionsByName
        guard let imageInput = inputs["image"]?.imageConstraint,
            let maskInput = inputs["mask"]?.imageConstraint
        else { throw FillError.unexpectedModel }
        let scaleFill: [MLFeatureValue.ImageOption: Any] = [
            .cropAndScale: VNImageCropAndScaleOption.scaleFill.rawValue
        ]
        let output = try model.prediction(
            from: MLDictionaryFeatureProvider(dictionary: [
                "image": try MLFeatureValue(cgImage: crop, constraint: imageInput, options: scaleFill),
                "mask": try MLFeatureValue(
                    cgImage: try covering(hole, side: maskInput.pixelsWide), constraint: maskInput,
                    options: scaleFill),
            ]))
        guard let filled = output.featureValue(for: "output")?.imageBufferValue else {
            throw FillError.unexpectedModel
        }
        let original = CIImage(cgImage: crop)
        let scale = original.extent.width / Double(CVPixelBufferGetWidth(filled))
        let feather = CIImage(cgImage: hole).clampedToExtent()
            .applyingGaussianBlur(sigma: max(1.5, scale * 1.5))
            .cropped(to: original.extent)
        return CIImage(cvPixelBuffer: filled)
            .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            .applyingFilter(
                "CIBlendWithMask",
                parameters: [
                    kCIInputBackgroundImageKey: original, kCIInputMaskImageKey: feather,
                ]
            )
            .cropped(to: original.extent)
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
