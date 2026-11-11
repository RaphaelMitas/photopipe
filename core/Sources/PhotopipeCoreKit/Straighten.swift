import CoreImage

/// `transformed(by:)` samples bilinearly, which softens every pixel of a straightened photo.
enum Straighten {
    private static let source = """
        #include <CoreImage/CoreImage.h>
        using namespace metal;

        [[ stitchable ]] float4 resampleCubic(
            coreimage::sampler src, float3 toSourceX, float3 toSourceY, coreimage::destination dest
        ) {
            float4 extent = src.extent();
            float4 centerBounds = float4(extent.xy + 0.5, extent.xy + extent.zw - 0.5);
            float3 at = float3(dest.coord(), 1.0);
            float2 p = float2(dot(toSourceX, at), dot(toSourceY, at));
            float2 first = floor(p - 0.5) + 0.5;
            float2 t = p - first;
            float2 catmullRom[4] = {
                t * (-0.5 + t * (1.0 - 0.5 * t)),
                1.0 + t * t * (1.5 * t - 2.5),
                t * (0.5 + t * (2.0 - 1.5 * t)),
                t * t * (0.5 * t - 0.5)
            };
            float4 sum = float4(0.0);
            float4 lowest = float4(1e9);
            float4 highest = float4(-1e9);
            for (int j = 0; j < 4; j++) {
                for (int i = 0; i < 4; i++) {
                    float2 tap = clamp(
                        first + float2(i - 1, j - 1), centerBounds.xy, centerBounds.zw);
                    float4 pixel = src.sample(src.transform(tap));
                    sum += catmullRom[i].x * catmullRom[j].y * pixel;
                    if ((i == 1 || i == 2) && (j == 1 || j == 2)) {
                        lowest = min(lowest, pixel);
                        highest = max(highest, pixel);
                    }
                }
            }
            // the negative lobes ring at hard edges, so stay within the four nearest pixels
            sum = clamp(sum, lowest, highest);
            // the taps clamp to the border, so fade it to clear over one pixel like the bilinear fallback
            float2 inside = saturate(min(p - centerBounds.xy, centerBounds.zw - p) + 1.0);
            return sum * inside.x * inside.y;
        }
        """

    private static let kernel = try? CIKernel.kernels(withMetalString: source).first

    static func transformed(_ image: CIImage, by transform: CGAffineTransform) -> CIImage {
        let toSource = transform.inverted()
        return kernel?.apply(
            extent: image.extent.applying(transform),
            roiCallback: { _, rect in rect.applying(toSource).insetBy(dx: -2, dy: -2) },
            arguments: [
                image.samplingNearest(),
                CIVector(x: toSource.a, y: toSource.c, z: toSource.tx),
                CIVector(x: toSource.b, y: toSource.d, z: toSource.ty),
            ]) ?? image.transformed(by: transform)
    }
}
