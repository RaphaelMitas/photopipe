import CoreImage

/// `transformed(by:)` samples bilinearly, which softens every pixel of a straightened photo.
enum Straighten {
    private static let source = """
        #include <CoreImage/CoreImage.h>
        using namespace metal;

        // bounds holds the first and last pixel centre, toSource the two rows of the affine
        [[ stitchable ]] float4 resampleCubic(
            coreimage::sampler src, float3 toSourceX, float3 toSourceY, float4 bounds,
            coreimage::destination dest
        ) {
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
                    float2 tap = clamp(first + float2(i - 1, j - 1), bounds.xy, bounds.zw);
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
            // the photo's own border fades over one pixel, as the bilinear transform's did
            float2 inside = saturate(min(p - bounds.xy, bounds.zw - p) + 1.0);
            return sum * inside.x * inside.y;
        }
        """

    private static let kernel = try? CIKernel.kernels(withMetalString: source).first

    static func transformed(_ image: CIImage, by transform: CGAffineTransform) -> CIImage {
        let toSource = transform.inverted()
        let extent = image.extent
        return kernel?.apply(
            extent: extent.applying(transform),
            roiCallback: { _, rect in rect.applying(toSource).insetBy(dx: -2, dy: -2) },
            arguments: [
                image.samplingNearest(),
                CIVector(x: toSource.a, y: toSource.c, z: toSource.tx),
                CIVector(x: toSource.b, y: toSource.d, z: toSource.ty),
                CIVector(
                    x: extent.minX + 0.5, y: extent.minY + 0.5, z: extent.maxX - 0.5,
                    w: extent.maxY - 0.5),
            ]) ?? image.transformed(by: transform)
    }
}
