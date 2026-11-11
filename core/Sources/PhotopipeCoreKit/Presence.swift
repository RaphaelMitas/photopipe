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

        float minChannel(float3 v) {
            return min(min(v.r, v.g), v.b);
        }

        float3 airlightOf(float4 light) {
            return max(light.rgb / max(light.a, 1e-6), 0.05);
        }

        float hazeGuide(float3 rgb) {
            return sqrt(max(dot(rgb, float3(0.2126, 0.7152, 0.0722)), 0.0));
        }

        [[ stitchable ]] float4 airlightWeight(
            coreimage::sample_t p, coreimage::sample_t dark, coreimage::sample_t peak
        ) {
            float weight = pow(saturate(minChannel(dark.rgb) / max(minChannel(peak.rgb), 1e-6)), 32.0);
            return float4(p.rgb * weight, weight);
        }

        [[ stitchable ]] float4 hazeMoments(
            coreimage::sample_t p, coreimage::sample_t dark, coreimage::sample_t light
        ) {
            float haze = saturate(minChannel(dark.rgb / airlightOf(light)));
            float guide = hazeGuide(p.rgb);
            return float4(guide, haze, guide * haze, guide * guide);
        }

        [[ stitchable ]] float4 hazeFit(coreimage::sample_t mean) {
            float slope = (mean.b - mean.r * mean.g) / (mean.a - mean.r * mean.r + 0.002);
            return float4(slope, mean.g - slope * mean.r, 0.0, 1.0);
        }

        [[ stitchable ]] float4 dehaze(
            coreimage::sample_t p, coreimage::sample_t fit, coreimage::sample_t light,
            float omega
        ) {
            float3 airlight = airlightOf(light);
            if (omega < 0.0) {
                // adding fogs a clear scene too, in the airlight's colour half way to grey
                float grey = dot(airlight, float3(0.2126, 0.7152, 0.0722));
                p.rgb = mix(p.rgb, mix(airlight, float3(grey), 0.5), omega / (omega - 1.0));
                return p;
            }
            // no pixel holds more haze than its darkest channel, which keeps it above black
            float haze = saturate(min(
                fit.r * hazeGuide(p.rgb) + fit.g, minChannel(p.rgb / airlight)));
            // brighter than the airlight rolls off into white instead of clipping
            float3 over = (p.rgb - airlight) / max(1.0 - airlight, 1e-4);
            haze *= 1.0 - saturate(max(max(over.r, over.g), over.b));
            p.rgb = (p.rgb - airlight) / (1.0 - omega * haze) + airlight;
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
        let patch = coarse.longEdge * 0.01
        // opened, so the dark channel's edge sits on the silhouette, not a patch outside it
        let dark = clamped(
            clamped(coarse, "CIMorphologyMinimum", radius: patch),
            "CIMorphologyMaximum", radius: patch)
        let whole = [kCIInputExtentKey: CIVector(cgRect: coarse.extent)]
        // blurred, so a lamp smaller than the blur cannot pass for the haziest region
        let peak = blurred(dark, radius: coarse.longEdge * 0.02)
            .applyingFilter("CIAreaMaximum", parameters: whole).clampedToExtent()
        let light = apply("airlightWeight", to: coarse, arguments: [dark, peak])
            .applyingFilter("CIAreaAverage", parameters: whole).clampedToExtent()
        // haze as a local line through the guide, which puts the photo's edges back at full size
        let radius = coarse.longEdge * 0.015
        let moments = blurred(
            apply("hazeMoments", to: coarse, arguments: [dark, light]), radius: radius)
        let fit = blurred(apply("hazeFit", to: moments, arguments: []), radius: radius)
        return apply(
            "dehaze", to: image,
            arguments: [upscaled(fit, to: image), light, Float(amount / 100 * 0.75)])
    }

    static func clarity(_ image: CIImage, amount: Double) -> CIImage {
        let coarse = coarse(image)
        let base = upscaled(blurred(coarse, radius: coarse.longEdge * 0.015), to: image)
        return apply("localContrast", to: image, arguments: [base, Float(amount / 100)])
    }

    static func texture(_ image: CIImage, amount: Double) -> CIImage {
        let base = blurred(image, radius: image.longEdge * 0.0015)
        return apply("localContrast", to: image, arguments: [base, Float(amount / 100)])
    }
}
