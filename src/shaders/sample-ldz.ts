/**
 * LDZ sampling fragment shader source.
 */
export const fragmentSampleLdzShader = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 out_color;

uniform sampler2D u_ldz_texture;

void main() {
    vec4 data = texture(u_ldz_texture, v_uv);
    const float MAX_Z = 10.0;
    out_color = vec4(data.r, data.gb * 0.5 + 0.5, max(data.a, 0.0) / MAX_Z);
}
`;
