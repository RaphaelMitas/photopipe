import CoreImage

/// Radii are fractions of the frame, so the fit preview, 1:1 loupe and export match.
enum Presence {
    private static let source = """
        #include <CoreImage/CoreImage.h>
        using namespace metal;

        [[ stitchable ]] float4 localContrast(
            coreimage::sample_t p, coreimage::sample_t blurred, float amount
        ) {
            float3 weights = float3(0.2126, 0.7152, 0.0722);
            float luma = dot(p.rgb, weights);
            float base = dot(blurred.rgb, weights);
            float midtone = 4.0 * saturate(luma) * (1.0 - saturate(luma));
            p.rgb += amount * midtone * (luma - base);
            return p;
        }

        [[ stitchable ]] float4 dehaze(
            coreimage::sample_t p, coreimage::sample_t veil, coreimage::sample_t light,
            float omega
        ) {
            float3 airlight = max(light.rgb, 0.05);
            float3 ratio = veil.rgb / airlight;
            float haze = saturate(min(min(ratio.r, ratio.g), ratio.b));
            // lifting scales with the haze found; adding fogs a clear scene too
            float transmission = omega > 0.0 ? max(1.0 - omega * haze, 0.1) : 1.0 - omega;
            p.rgb = (p.rgb - airlight) / transmission + airlight;
            return p;
        }
        """

    // CIKernel predates Sendable; these are compiled once and never mutated
    nonisolated(unsafe) private static let kernels: [String: CIColorKernel] = {
        let compiled = (try? CIKernel.kernels(withMetalString: source)) ?? []
        return Dictionary(
            uniqueKeysWithValues: compiled.compactMap { kernel in
                (kernel as? CIColorKernel).map { (kernel.name, $0) }
            })
    }()

    private static let coarseLongEdge: CGFloat = 1024

    private static func longEdge(_ image: CIImage) -> CGFloat {
        max(image.extent.width, image.extent.height)
    }

    // clamped and whole pixels, or a part-transparent edge row blurs into a bright band
    private static func coarse(_ image: CIImage) -> CIImage {
        let extent = image.extent
        let scale = min(coarseLongEdge / longEdge(image), 1)
        let size = CGSize(
            width: max((extent.width * scale).rounded(), 1),
            height: max((extent.height * scale).rounded(), 1))
        return image.clampedToExtent()
            .transformed(by: .init(translationX: -extent.minX, y: -extent.minY))
            .transformed(by: .init(scaleX: size.width / extent.width, y: size.height / extent.height))
            .cropped(to: CGRect(origin: .zero, size: size))
    }

    private static func upscaled(_ estimate: CIImage, to image: CIImage) -> CIImage {
        let extent = image.extent
        return estimate.samplingLinear().transformed(
            by: CGAffineTransform(translationX: extent.minX, y: extent.minY)
                .scaledBy(
                    x: extent.width / estimate.extent.width,
                    y: extent.height / estimate.extent.height))
    }

    private static func clamped(_ image: CIImage, _ filter: String, radius: CGFloat) -> CIImage {
        image.clampedToExtent()
            .applyingFilter(filter, parameters: [kCIInputRadiusKey: radius])
            .cropped(to: image.extent)
    }

    private static func blurred(_ image: CIImage, radius: CGFloat) -> CIImage {
        clamped(image, "CIGaussianBlur", radius: max(radius, 0.5))
    }

    private static func apply(
        _ kernel: String, to image: CIImage, arguments: [Any]
    ) -> CIImage {
        guard let kernel = kernels[kernel] else { return image }
        return kernel.apply(extent: image.extent, arguments: [image] + arguments) ?? image
    }

    static func dehaze(_ image: CIImage, amount: Double) -> CIImage {
        let coarse = coarse(image)
        // dark channel kept per channel, so its per-channel max estimates a tinted airlight
        let veil = blurred(
            clamped(coarse, "CIMorphologyMinimum", radius: longEdge(coarse) * 0.01),
            radius: longEdge(coarse) * 0.02)
        let light = veil.applyingFilter(
            "CIAreaMaximum", parameters: [kCIInputExtentKey: CIVector(cgRect: veil.extent)]
        ).clampedToExtent()
        return apply(
            "dehaze", to: image,
            arguments: [upscaled(veil, to: image), light, Float(amount / 100 * 0.75)])
    }

    static func clarity(_ image: CIImage, amount: Double) -> CIImage {
        let coarse = coarse(image)
        let base = upscaled(blurred(coarse, radius: longEdge(coarse) * 0.015), to: image)
        return apply("localContrast", to: image, arguments: [base, Float(amount / 100)])
    }

    static func texture(_ image: CIImage, amount: Double) -> CIImage {
        let base = blurred(image, radius: longEdge(image) * 0.0015)
        return apply("localContrast", to: image, arguments: [base, Float(amount / 100)])
    }
}
