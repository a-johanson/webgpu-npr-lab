// Shader utilities module
// Handles shader compilation and program linking

/**
 * Compiles a shader.
 *
 * @param gl - The WebGL context.
 * @param source - GLSL source.
 * @param type - Shader type.
 * @returns The compiled shader or null on failure.
 */
export function compileShader(
    gl: WebGL2RenderingContext,
    source: string,
    type: number,
): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) {
        throw new Error("Failed to create shader object");
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const infoLog = gl.getShaderInfoLog(shader) || "<no shader info log>";
        gl.deleteShader(shader);
        throw new Error(`Shader compile error: ${infoLog}`);
    }
    return shader;
}

/**
 * Links a shader program.
 *
 * @param gl - The WebGL context.
 * @param vs - Vertex shader.
 * @param fs - Fragment shader.
 * @returns The linked program or null on failure.
 */
export function createProgram(
    gl: WebGL2RenderingContext,
    vs: WebGLShader,
    fs: WebGLShader,
): WebGLProgram {
    const program = gl.createProgram();
    if (!program) {
        throw new Error("Failed to create shader program object");
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const infoLog = gl.getProgramInfoLog(program) || "<no program info log>";
        gl.deleteProgram(program);
        throw new Error(`Program link error: ${infoLog}`);
    }
    return program;
}
