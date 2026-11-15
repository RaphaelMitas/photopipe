import CoreImage

enum Presence {
    private static let source = """
        #include <CoreImage/CoreImage.h>
        using namespace metal;

        static float3 toOklab(float3 rgb) {
            float3 lms = float3(
                dot(rgb, float3(0.4122214708, 0.5363325363, 0.0514459929)),
                dot(rgb, float3(0.2119034982, 0.6806995451, 0.1073969566)),
                dot(rgb, float3(0.0883024619, 0.2817188376, 0.6299787005)));
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
            float skin = smoothstep(0.707, 0.966, dot(lab.yz, float2(0.574, 0.819)) / max(c, 1e-6));
            float reach = vibrance > 0.0 ? 2.5 * faint * (1.0 - 0.8 * skin) : 0.65 + 0.15 * faint;
            float gain = saturation * (1.0 + vibrance * reach);
            if (gain > 1.0) {
                float headroom = roomInSRGB(p.rgb, withChroma(lab, 2.0));
                headroom *= min(roomInSRGB(p.rgb, withChroma(lab, 1.0 + headroom)), 1.0);
                float push = (gain - 1.0) / headroom;
                gain = 1.0 + (gain - 1.0) / sqrt(1.0 + push * push);
            }
            return float4(withChroma(lab, gain), p.a);
        }

        float minChannel(float3 v) {
            return min(min(v.r, v.g), v.b);
        }

        float3 airlightOf(float4 light) {
            return max(light.rgb / max(light.a, 1e-6), 1e-3);
        }

        float lumaOf(float3 rgb) {
            return dot(rgb, float3(0.2126, 0.7152, 0.0722));
        }

        float hazeGuide(float3 rgb) {
            return sqrt(clamp(lumaOf(rgb), 0.0, 16.0));
        }

        [[ stitchable ]] float4 airlightWeight(
            coreimage::sample_t p, coreimage::sample_t dark, coreimage::sample_t peak
        ) {
            float weight = pow(saturate(minChannel(dark.rgb) / max(peak.r, 1e-6)), 32.0);
            return float4(clamp(p.rgb, 0.0, 16.0) * weight, weight);
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
                float3 fog = mix(airlight, float3(lumaOf(airlight)), 0.5);
                p.rgb = mix(p.rgb, fog, omega / (omega - 1.0));
                return p;
            }
            float haze = saturate(min(
                fit.r * hazeGuide(p.rgb) + fit.g, minChannel(p.rgb / airlight)));
            float3 over = (p.rgb - airlight) / max(1.0 - airlight, 1e-4);
            haze *= 1.0 - saturate(max(max(over.r, over.g), over.b));
            p.rgb = (p.rgb - airlight) / (1.0 - omega * haze) + airlight;
            return p;
        }

        [[ stitchable ]] float4 shoulder(coreimage::sample_t p, float gain) {
            float knee = 0.5;
            float peak = max(max(p.r, p.g), p.b);
            float over = peak - knee;
            if (over <= 0.0) { return p; }
            float rolled = knee + 1.0 / (1.0 / over + (gain - 1.0) / ((1.0 - knee) * (gain - knee)));
            float kept = rolled / peak;
            p.rgb = mix(float3(rolled), p.rgb * kept, kept);
            return p;
        }

        float encodedLuma(float3 rgb) {
            return pow(saturate(lumaOf(rgb)), 1.0 / 2.2);
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
            float edge = variance / (variance + 0.02);
            float own = encodedLuma(p.rgb);
            float tone = saturate(mix(mean, own, edge));
            float dark = pow(1.0 - tone, 3.0);
            float bright = 256.0 / 27.0 * pow(tone, 3.0) * (1.0 - max(tone, own));
            p.rgb *= exp2(shadows * dark + highlights * bright);
            return p;
        }

        [[ stitchable ]] float4 localContrast(
            coreimage::sample_t p, coreimage::sample_t fine, coreimage::sample_t base, float amount
        ) {
            float detail = 0.125 * tanh((fine.r - base.r) / 0.125);
            p.rgb *= pow(1.0 + amount * 4.0 * (1.0 - encodedLuma(p.rgb)) * detail, 2.2);
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
        stretched(estimate, from: estimate.extent, to: image.extent)
    }

    static func stretched(_ image: CIImage, from: CGRect, to: CGRect) -> CIImage {
        image.samplingLinear().transformed(
            by: CGAffineTransform(translationX: to.minX, y: to.minY)
                .scaledBy(x: to.width / from.width, y: to.height / from.height)
                .translatedBy(x: -from.minX, y: -from.minY))
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
        let patch = coarse.longEdge * 0.01
        let dark = clamped(
            clamped(coarse, "CIMorphologyMinimum", radius: patch),
            "CIMorphologyMaximum", radius: patch)
        let whole = [kCIInputExtentKey: CIVector(cgRect: coarse.extent)]
        let peak = blurred(dark.applyingFilter("CIMinimumComponent"), radius: coarse.longEdge * 0.02)
            .applyingFilter("CIAreaMaximum", parameters: whole).clampedToExtent()
        let light = apply("airlightWeight", to: coarse, arguments: [dark, peak])
            .applyingFilter("CIAreaAverage", parameters: whole).clampedToExtent()
        let radius = coarse.longEdge * 0.015
        let moments = blurred(
            apply("hazeMoments", to: coarse, arguments: [dark, light]), radius: radius)
        let fit = blurred(apply("hazeFit", to: moments, arguments: []), radius: radius)
        let omega = min(max(amount, -100), 100) / 100 * 0.75
        return apply("dehaze", to: image, arguments: [upscaled(fit, to: image), light, Float(omega)])
    }

    static func tone(_ image: CIImage, highlights: Double, shadows: Double) -> CIImage {
        let coarse = apply("lumaMoments", to: coarse(image), arguments: [])
        let moments = blurred(coarse, radius: coarse.longEdge * 0.04)
        let stops = [Float(shadows / 100 * 4), Float(highlights / 100 * 1.25)]
        return apply(
            "regionalExposure", to: image, arguments: [upscaled(moments, to: image)] + stops)
    }

    static func clarity(_ image: CIImage, amount: Double) -> CIImage {
        let luma = apply("lumaMoments", to: image, arguments: [])
        let base = blurred(luma, radius: image.longEdge * 0.015)
        return apply("localContrast", to: image, arguments: [luma, base, Float(amount / 100)])
    }

    static func texture(_ image: CIImage, amount: Double) -> CIImage {
        let luma = apply("lumaMoments", to: image, arguments: [])
        let fine = clamped(luma, "CIGaussianBlur", radius: image.longEdge * 0.00025)
        let base = blurred(luma, radius: image.longEdge * 0.002)
        return apply("localContrast", to: image, arguments: [fine, base, Float(amount / 100)])
    }

    static func chroma(_ image: CIImage, vibrance: Double, saturation: Double) -> CIImage {
        apply(
            "chroma", to: image,
            arguments: [Float(vibrance / 100), Float(1 + saturation / 100)])
    }
}
