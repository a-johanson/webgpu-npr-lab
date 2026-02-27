/**
 * Vertex shader source.
 */
export const vertexShader = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

uniform vec2 u_tile_offset;
uniform vec2 u_tile_scale;

void main() {
    v_uv = (a_position * 0.5 + 0.5) * u_tile_scale + u_tile_offset;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;
