// WebGL setup module
// Handles canvas, context, extension checks, buffer/texture/framebuffer setup

/**
 * Initializes a WebGL2 context and validates required extensions.
 *
 * @param canvas - The target canvas.
 * @returns The initialized WebGL2 context.
 */
export function initWebGL(canvas: HTMLCanvasElement): WebGL2RenderingContext {
    const gl = canvas.getContext("webgl2");
    if (!gl) {
        throw new Error("WebGL2 not supported");
    }
    const ext = gl.getExtension("EXT_color_buffer_float");
    if (!ext) {
        throw new Error(
            "EXT_color_buffer_float not supported. Cannot render to RGBA32F texture.",
        );
    }
    return gl;
}

/**
 * Creates and uploads a static array buffer.
 *
 * @param gl - The WebGL context.
 * @param data - The buffer source data.
 * @returns The created buffer.
 */
export function createBuffer(gl: WebGL2RenderingContext, data: BufferSource): WebGLBuffer {
    const buffer = gl.createBuffer();
    if (!buffer) {
        throw new Error("Failed to create WebGL buffer");
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
}

/**
 * Creates an RGBA32F texture.
 *
 * @param gl - The WebGL context.
 * @param width - Texture width.
 * @param height - Texture height.
 * @returns The created texture.
 */
export function createFloatTexture(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
): WebGLTexture {
    const texture = gl.createTexture();
    if (!texture) {
        throw new Error("Failed to create WebGL float texture");
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
}

/**
 * Creates an RGBA8 texture.
 *
 * @param gl - The WebGL context.
 * @param width - Texture width.
 * @param height - Texture height.
 * @returns The created texture.
 */
export function createRGBA8Texture(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
): WebGLTexture {
    const texture = gl.createTexture();
    if (!texture) {
        throw new Error("Failed to create WebGL RGBA8 texture");
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
}

/**
 * Creates a framebuffer and attaches textures as color attachments.
 *
 * @param gl - The WebGL context.
 * @param textures - Textures to attach.
 * @returns The created framebuffer.
 */
export function createFramebuffer(
    gl: WebGL2RenderingContext,
    textures: WebGLTexture[],
): WebGLFramebuffer {
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) {
        throw new Error("Failed to create WebGL framebuffer");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    const drawBuffers: number[] = [];
    for (let i = 0; i < textures.length; i++) {
        const attachment = gl.COLOR_ATTACHMENT0 + i;
        gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, textures[i], 0);
        drawBuffers.push(attachment);
    }
    gl.drawBuffers(drawBuffers);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Framebuffer not complete: ${status}`);
    }
    return framebuffer;
}
