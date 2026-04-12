export const VERTEX_SHADER_SOURCE = `#version 300 es
out vec2 v_uv;
void main() {
    float x = float((gl_VertexID & 1) << 2);
    float y = float((gl_VertexID & 2) << 1);
    v_uv = vec2(x * 0.5, 1.0 - y * 0.5);
    gl_Position = vec4(x - 1.0, y - 1.0, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_image;
uniform float u_exposure;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_contrast;

vec3 srgbToLinear(vec3 c) {
    vec3 lo = c / 12.92;
    vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
    return mix(lo, hi, step(vec3(0.04045), c));
}

vec3 linearToSrgb(vec3 c) {
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    return mix(lo, hi, step(vec3(0.0031308), c));
}

float luminance(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
    vec4 texel = texture(u_image, v_uv);
    vec3 rgb = srgbToLinear(texel.rgb);

    rgb *= exp2(u_exposure);

    float lum = luminance(rgb);

    float highlightMask = smoothstep(0.5, 1.5, lum);
    float highlightGain = 1.0 + u_highlights * highlightMask * (u_highlights < 0.0 ? -0.6 : 0.4);
    rgb *= highlightGain;

    float shadowMask = 1.0 - smoothstep(0.0, 0.5, lum);
    float shadowGain = 1.0 + u_shadows * shadowMask * (u_shadows > 0.0 ? 1.5 : 0.8);
    rgb *= shadowGain;

    if (u_contrast != 0.0) {
        float contrastFactor = 1.0 + u_contrast * 0.5;
        rgb = pow(max(rgb / 0.18, vec3(0.0)), vec3(contrastFactor)) * 0.18;
    }

    rgb = rgb / (1.0 + rgb * 0.15);
    rgb *= 1.15;

    rgb = clamp(rgb, 0.0, 1.0);
    fragColor = vec4(linearToSrgb(rgb), texel.a);
}
`;
