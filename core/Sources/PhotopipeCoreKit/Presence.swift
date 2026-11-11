import CoreImage

/// Radii are fractions of the frame, so the fit preview, 1:1 loupe and export match.
enum Presence {
    private static let source = """
        #include <CoreImage/CoreImage.h>
        using namespace metal;

        static float3 toOklab(float3 rgb) {
            float3 lms = float3(
                dot(rgb, float3(0.4122214708, 0.5363325363, 0.0514459929)),
                dot(rgb, float3(0.2119034982, 0.6806995451, 0.1073969566)),
                dot(rgb, float3(0.0883024619, 0.2817188376, 0.6299787005)));
            // wide-gamut colours arrive with negative components
            lms = sign(lms) * pow(abs(lms), float3(1.0 / 3.0));
            return float3(
                dot(lms, float3(0.2104542553, 0.7936177850, -0.0040720468)),
                dot(lms, float3(1.9779984951, -2.4285922050, 0.4505937099)),
                dot(lms, float3(0.0259040371, 0.7827717662, -0.8086757660)));
        }

        static float3 fromOklab(float3 lab) {
            float3 lms = float3(
                dot(lab, float3(1.0, 0.3963377774, 0.2158037573)),
                dot(lab, float3(1.0, -0.1055613458, -0.0638541728)),
                dot(lab, float3(1.0, -0.0894841775, -1.2914855480)));
            lms = lms * lms * lms;
            return float3(
                dot(lms, float3(4.0767416621, -3.3077115913, 0.2309699292)),
                dot(lms, float3(-1.2684380046, 2.6097574011, -0.3413193965)),
                dot(lms, float3(-0.0041960863, -0.7034186147, 1.7076147010)));
        }

        static float3 withChroma(float3 lab, float gain) {
            return fromOklab(float3(lab.x, lab.yz * gain));
        }

        static float roomInSRGB(float3 from, float3 to) {
            float3 move = to - from;
            float3 walls = mix(from, 1.0 - from, step(0.0, move)) / max(abs(move), 1e-9);
            return max(min3(walls.x, walls.y, walls.z), 1e-6);
        }

        [[ stitchable ]] float4 chroma(coreimage::sample_t p, float vibrance, float saturation) {
            float3 lab = toOklab(p.rgb);
            float c = length(lab.yz);
            float purity = saturate(1.0 - min3(p.r, p.g, p.b) / max(max3(p.r, p.g, p.b), 1e-6));
            float faint = 1.0 - purity * purity;
            // skin sits around Oklab hue 55: protected within 15 degrees, not at all past 45
            float skin = smoothstep(0.707, 0.966, dot(lab.yz, float2(0.574, 0.819)) / max(c, 1e-6));
            float reach = vibrance > 0.0 ? 2.5 * faint * (1.0 - 0.8 * skin) : 0.65 + 0.15 * faint;
            float gain = saturation * (1.0 + vibrance * reach);
            if (gain > 1.0) {
                // headroom comes from the pixel alone, so more slider never means less colour
                float headroom = roomInSRGB(p.rgb, withChroma(lab, 2.0));
                headroom *= min(roomInSRGB(p.rgb, withChroma(lab, 1.0 + headroom)), 1.0);
                float push = (gain - 1.0) / headroom;
                gain = 1.0 + (gain - 1.0) / sqrt(1.0 + push * push);
            }
            return float4(withChroma(lab, gain), p.a);
        }

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

        [[ stitchable ]] float4 shoulder(coreimage::sample_t p, float gain) {
            float knee = 0.5;
            float peak = max(max(p.r, p.g), p.b);
            float over = peak - knee;
            if (over <= 0.0) { return p; }
            // leaves the knee at slope 1 and lands the source's white, now at gain, on 1
            float rolled = knee + 1.0 / (1.0 / over + (gain - 1.0) / ((1.0 - knee) * (gain - knee)));
            float kept = rolled / peak;
            // scaling by the peak holds the hue; fading to white is what a raw's tone curve does
            p.rgb = mix(float3(rolled), p.rgb * kept, kept);
            return p;
        }

        float encodedLuma(float3 rgb) {
            return pow(saturate(dot(rgb, float3(0.2126, 0.7152, 0.0722))), 1.0 / 2.2);
        }

        [[ stitchable ]] float4 lumaMoments(coreimage::sample_t p) {
            float luma = encodedLuma(p.rgb);
            return float4(luma, luma * luma, 0.0, 1.0);
        }

        [[ stitchable ]] float4 regionalExposure(
            coreimage::sample_t p, coreimage::sample_t moments, float shadows, float highlights
        ) {
            float mean = moments.r;
            float variance = max(moments.g - mean * mean, 0.0);
            // the neighbourhood's tone inside texture, the pixel's own at a hard edge: no halo
            float edge = variance / (variance + 0.02);
            float own = encodedLuma(p.rgb);
            float tone = saturate(mix(mean, own, edge));
            float dark = pow(1.0 - tone, 3.0);
            // peaks at 1 for a tone of 0.75; a pixel near white has nothing to recover
            float bright = 256.0 / 27.0 * pow(tone, 3.0) * (1.0 - max(tone, own));
            p.rgb *= exp2(shadows * dark + highlights * bright);
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

    static func shoulder(_ image: CIImage, afterExposure exposure: Double) -> CIImage {
        apply("shoulder", to: image, arguments: [Float(pow(2, exposure))])
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

    /// Exposure per region, not a curve per pixel: a curve flattens the detail it lifts.
    static func tone(_ image: CIImage, highlights: Double, shadows: Double) -> CIImage {
        let coarse = apply("lumaMoments", to: coarse(image), arguments: [])
        let moments = blurred(coarse, radius: coarse.longEdge * 0.04)
        let stops = [Float(shadows / 100 * 4), Float(highlights / 100 * 1.25)]
        return apply(
            "regionalExposure", to: image, arguments: [upscaled(moments, to: image)] + stops)
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

    static func chroma(_ image: CIImage, vibrance: Double, saturation: Double) -> CIImage {
        apply(
            "chroma", to: image,
            arguments: [Float(vibrance / 100), Float(1 + saturation / 100)])
    }
}
