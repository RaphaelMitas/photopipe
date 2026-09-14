import CoreImage

/// Texture, clarity and dehaze: local contrast at three scales. Every radius
/// is a fraction of the frame, so the fit preview, the 1:1 loupe and the
/// export agree on the look.
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
            p.rgb = max(p.rgb + amount * midtone * (luma - base), 0.0);
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
            p.rgb = max((p.rgb - airlight) / transmission + airlight, 0.0);
            return p;
        }
        """

    private static let kernels: [String: CIColorKernel] = {
        let compiled = (try? CIKernel.kernels(withMetalString: source)) ?? []
        return Dictionary(
            uniqueKeysWithValues: compiled.compactMap { kernel in
                (kernel as? CIColorKernel).map { (kernel.name, $0) }
            })
    }()

    /// The low-frequency estimates only carry coarse structure, so they come
    /// from a copy no wider than this and get stretched back over the frame.
    private static let coarseLongEdge: CGFloat = 1024

    private static func coarseScale(for image: CIImage) -> CGFloat {
        min(coarseLongEdge / max(image.extent.width, image.extent.height), 1)
    }

    private static func blurred(_ image: CIImage, radius: CGFloat) -> CIImage {
        image.clampedToExtent()
            .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: max(radius, 0.5)])
            .cropped(to: image.extent)
    }

    private static func apply(
        _ kernel: String, to image: CIImage, arguments: [Any]
    ) -> CIImage {
        guard let kernel = kernels[kernel] else { return image }
        return kernel.apply(extent: image.extent, arguments: [image] + arguments) ?? image
    }

    static func dehaze(_ image: CIImage, amount: Double) -> CIImage {
        let scale = coarseScale(for: image)
        let coarse = image.transformed(by: .init(scaleX: scale, y: scale))
        let longEdge = max(coarse.extent.width, coarse.extent.height)
        // per-channel local minimum: the dark channel prior, kept in colour so
        // the brightest patch of it is the haze's own colour
        let veil = blurred(
            coarse.clampedToExtent()
                .applyingFilter(
                    "CIMorphologyMinimum", parameters: [kCIInputRadiusKey: longEdge * 0.01]
                )
                .cropped(to: coarse.extent),
            radius: longEdge * 0.02)
        let light = veil.applyingFilter(
            "CIAreaMaximum", parameters: [kCIInputExtentKey: CIVector(cgRect: veil.extent)]
        ).clampedToExtent()
        let full = veil.samplingLinear().transformed(by: .init(scaleX: 1 / scale, y: 1 / scale))
        return apply(
            "dehaze", to: image, arguments: [full, light, Float(amount / 100 * 0.75)])
    }

    static func localContrast(_ image: CIImage, texture: Double, clarity: Double) -> CIImage {
        var image = image
        if clarity != 0 {
            let scale = coarseScale(for: image)
            let coarse = image.transformed(by: .init(scaleX: scale, y: scale))
            let base = blurred(coarse, radius: max(coarse.extent.width, coarse.extent.height) * 0.015)
                .samplingLinear().transformed(by: .init(scaleX: 1 / scale, y: 1 / scale))
            image = apply(
                "localContrast", to: image, arguments: [base, Float(clarity / 100)])
        }
        if texture != 0 {
            let base = blurred(
                image, radius: max(image.extent.width, image.extent.height) * 0.0015)
            image = apply(
                "localContrast", to: image, arguments: [base, Float(texture / 100)])
        }
        return image
    }
}
