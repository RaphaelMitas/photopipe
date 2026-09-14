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

    /// Whole pixels on both axes: a fractional last row is part transparent,
    /// and the blur spreads that into a bright band along the edge.
    private static func coarseTransform(for image: CIImage) -> CGAffineTransform {
        let scale = min(coarseLongEdge / longEdge(image), 1)
        let size = image.extent.size
        return .init(
            scaleX: (size.width * scale).rounded() / size.width,
            y: (size.height * scale).rounded() / size.height)
    }

    private static func coarse(_ image: CIImage, _ transform: CGAffineTransform) -> CIImage {
        let rect = image.extent.applying(transform)
        return image.clampedToExtent().transformed(by: transform)
            .cropped(
                to: CGRect(
                    x: rect.minX.rounded(), y: rect.minY.rounded(),
                    width: rect.width.rounded(), height: rect.height.rounded()))
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
        let transform = coarseTransform(for: image)
        let coarse = coarse(image, transform)
        // dark channel kept per channel, so its per-channel max estimates a tinted airlight
        let veil = blurred(
            clamped(coarse, "CIMorphologyMinimum", radius: longEdge(coarse) * 0.01),
            radius: longEdge(coarse) * 0.02)
        let light = veil.applyingFilter(
            "CIAreaMaximum", parameters: [kCIInputExtentKey: CIVector(cgRect: veil.extent)]
        ).clampedToExtent()
        let full = veil.samplingLinear().transformed(by: transform.inverted())
        return apply(
            "dehaze", to: image, arguments: [full, light, Float(amount / 100 * 0.75)])
    }

    static func clarity(_ image: CIImage, amount: Double) -> CIImage {
        let transform = coarseTransform(for: image)
        let coarse = coarse(image, transform)
        let base = blurred(coarse, radius: longEdge(coarse) * 0.015)
            .samplingLinear().transformed(by: transform.inverted())
        return apply("localContrast", to: image, arguments: [base, Float(amount / 100)])
    }

    static func texture(_ image: CIImage, amount: Double) -> CIImage {
        let base = blurred(image, radius: longEdge(image) * 0.0015)
        return apply("localContrast", to: image, arguments: [base, Float(amount / 100)])
    }
}
