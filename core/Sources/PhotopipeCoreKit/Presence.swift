import CoreImage

/// Radii are fractions of the frame, so the fit preview, 1:1 loupe and export match.
enum Presence {
    private static let source = """
        #include <CoreImage/CoreImage.h>
        using namespace metal;

        static float perceptual(float3 rgb) {
            return pow(max(dot(rgb, float3(0.2126, 0.7152, 0.0722)), 0.0), 1.0 / 2.2);
        }

        [[ stitchable ]] float4 perceptualLuma(coreimage::sample_t p) {
            return float4(float3(perceptual(p.rgb)), 1.0);
        }

        [[ stitchable ]] float4 localContrast(
            coreimage::sample_t p, coreimage::sample_t fine, coreimage::sample_t base, float amount
        ) {
            float luma = saturate(perceptual(p.rgb));
            // an eighth keeps every tone above half its luma at full strength, so no edge crushes
            // Metal's tanh returns 0 and then NaN past 44, which an HDR highlight reaches
            float detail = 0.125 * tanh(clamp((fine.r - base.r) / 0.125, -8.0, 8.0));
            // the midtone weight 4·luma·(1 - luma) with its luma factored out, leaving a gain
            p.rgb *= pow(1.0 + amount * 4.0 * (1.0 - luma) * detail, 2.2);
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

    private static let kernels: [String: CIColorKernel] = {
        let compiled = (try? CIKernel.kernels(withMetalString: source)) ?? []
        return Dictionary(
            uniqueKeysWithValues: compiled.compactMap { kernel in
                (kernel as? CIColorKernel).map { (kernel.name, $0) }
            })
    }()

    private static let coarseLongEdge: CGFloat = 1024

    private static func coarse(_ image: CIImage) -> CIImage {
        Renderer.fitted(image, longEdge: coarseLongEdge)
    }

    private static func upscaled(_ estimate: CIImage, to image: CIImage) -> CIImage {
        let extent = image.extent
        return estimate.samplingLinear().transformed(
            by: CGAffineTransform(translationX: extent.minX, y: extent.minY)
                .scaledBy(
                    x: extent.width / estimate.extent.width,
                    y: extent.height / estimate.extent.height
                )
                .translatedBy(x: -estimate.extent.minX, y: -estimate.extent.minY))
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
            clamped(coarse, "CIMorphologyMinimum", radius: coarse.longEdge * 0.01),
            radius: coarse.longEdge * 0.02)
        let light = veil.applyingFilter(
            "CIAreaMaximum", parameters: [kCIInputExtentKey: CIVector(cgRect: veil.extent)]
        ).clampedToExtent()
        return apply(
            "dehaze", to: image,
            arguments: [upscaled(veil, to: image), light, Float(amount / 100 * 0.75)])
    }

    private static func perceptualLuma(_ image: CIImage) -> CIImage {
        apply("perceptualLuma", to: image, arguments: [])
    }

    static func clarity(_ image: CIImage, amount: Double) -> CIImage {
        let luma = perceptualLuma(image)
        let coarse = coarse(luma)
        let base = upscaled(blurred(coarse, radius: coarse.longEdge * 0.015), to: image)
        return apply("localContrast", to: image, arguments: [luma, base, Float(amount / 100)])
    }

    /// Starts above the finest pixels, where noise and capture sharpening live.
    static func texture(_ image: CIImage, amount: Double) -> CIImage {
        let luma = perceptualLuma(image)
        // not `blurred`: its half pixel floor would narrow the band in renders under 2000 px
        let fine = clamped(luma, "CIGaussianBlur", radius: image.longEdge * 0.00025)
        let base = blurred(luma, radius: image.longEdge * 0.002)
        return apply("localContrast", to: image, arguments: [fine, base, Float(amount / 100)])
    }
}
