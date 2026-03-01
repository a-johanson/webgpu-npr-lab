const DEBUG_FULLSCREEN_VERTEX_SHADER = `
struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@vertex
fn main_vertex(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
    var positions = array<vec2f, 4>(
        vec2f(-1.0, -1.0),
        vec2f(1.0, -1.0),
        vec2f(-1.0, 1.0),
        vec2f(1.0, 1.0),
    );

    var output: VertexOut;
    let position = positions[vertex_index];
    output.position = vec4f(position, 0.0, 1.0);
    output.uv = position * 0.5 + 0.5;
    return output;
}
`;

const DEBUG_COMPOSE_FRAGMENT_SHADER = `
struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

struct DebugTileUniforms {
    sample_scale: vec2f,
    _pad: vec2f,
};

@group(0) @binding(0) var tile_sampler: sampler;
@group(0) @binding(1) var tile_texture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> tile_uniforms: DebugTileUniforms;

@fragment
fn main_fragment(in: VertexOut) -> @location(0) vec4f {
    let sample_uv = vec2f(
        in.uv.x * tile_uniforms.sample_scale.x,
        (1.0 - in.uv.y) * tile_uniforms.sample_scale.y,
    );
    return textureSample(tile_texture, tile_sampler, sample_uv);
}
`;

const DEBUG_PRESENT_FRAGMENT_SHADER = `
struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

struct DebugPresentUniforms {
    mode: f32,
    max_depth: f32,
    _pad0: f32,
    _pad1: f32,
};

@group(0) @binding(0) var debug_sampler: sampler;
@group(0) @binding(1) var debug_texture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> present_uniforms: DebugPresentUniforms;

@fragment
fn main_fragment(in: VertexOut) -> @location(0) vec4f {
    let data = textureSample(debug_texture, debug_sampler, vec2f(in.uv.x, 1.0 - in.uv.y));
    let mode = i32(round(present_uniforms.mode));

    if (mode == 0) {
        return vec4f(vec3f(clamp(data.r, 0.0, 1.0)), 1.0);
    }

    if (mode == 1) {
        return vec4f(
            clamp(data.g * 0.5 + 0.5, 0.0, 1.0),
            clamp(data.b * 0.5 + 0.5, 0.0, 1.0),
            0.5,
            1.0,
        );
    }

    if (data.a >= 0.0) {
        let depth = clamp(data.a / max(present_uniforms.max_depth, 1e-6), 0.0, 1.0);
        return vec4f(vec3f(depth), 1.0);
    }

    return vec4f(1.0, 0.0, 1.0, 1.0);
}
`;

/**
 * GPU debug presenter with tile composition and per-frame present.
 */
export class WebGpuDebugPresenter {
    private static readonly DEBUG_UNIFORM_FLOAT_COUNT = 4;
    private static readonly BYTES_PER_CHANNEL = Float32Array.BYTES_PER_ELEMENT;

    private readonly device: GPUDevice;
    private readonly queue: GPUQueue;
    private readonly debugCanvas: HTMLCanvasElement;
    private readonly debugGpuContext: GPUCanvasContext;
    private readonly debugCanvasFormat: GPUTextureFormat;
    private readonly debugComposePipeline: GPURenderPipeline;
    private readonly debugPresentPipeline: GPURenderPipeline;
    private readonly debugTileUniformBuffer: GPUBuffer;
    private readonly debugPresentUniformBuffer: GPUBuffer;
    private readonly debugSampler: GPUSampler;
    private debugLdzTexture: GPUTexture | null = null;
    private debugComposeBindGroup: GPUBindGroup | null = null;
    private debugPresentBindGroup: GPUBindGroup | null = null;
    private tileTexture: GPUTexture | null = null;
    private tileSize = 1;
    private width = 1;
    private height = 1;
    private debugWidth = 1;
    private debugHeight = 1;
    private clearDebugTarget = true;

    /**
     * Creates a debug presenter.
     *
     * @param device - Active WebGPU device.
     * @param debugCanvas - Debug target canvas.
     * @param outputTextureFormat - LDZ output texture format.
     */
    constructor(
        device: GPUDevice,
        debugCanvas: HTMLCanvasElement,
        outputTextureFormat: GPUTextureFormat,
    ) {
        this.device = device;
        this.queue = device.queue;
        this.debugCanvas = debugCanvas;

        const context = this.debugCanvas.getContext("webgpu");
        if (!context) {
            throw new Error("Failed to acquire WebGPU context for debug canvas");
        }
        this.debugGpuContext = context;
        this.debugCanvasFormat = navigator.gpu.getPreferredCanvasFormat();

        const debugVertexModule = this.device.createShaderModule({
            code: DEBUG_FULLSCREEN_VERTEX_SHADER,
            label: "debug-fullscreen-vertex",
        });
        const debugComposeFragmentModule = this.device.createShaderModule({
            code: DEBUG_COMPOSE_FRAGMENT_SHADER,
            label: "debug-compose-fragment",
        });
        const debugPresentFragmentModule = this.device.createShaderModule({
            code: DEBUG_PRESENT_FRAGMENT_SHADER,
            label: "debug-present-fragment",
        });

        const debugBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: { type: "non-filtering" },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: "unfilterable-float" },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "uniform" },
                },
            ],
        });

        this.debugComposePipeline = this.device.createRenderPipeline({
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [debugBindGroupLayout],
            }),
            vertex: {
                module: debugVertexModule,
                entryPoint: "main_vertex",
            },
            fragment: {
                module: debugComposeFragmentModule,
                entryPoint: "main_fragment",
                targets: [{ format: outputTextureFormat }],
            },
            primitive: {
                topology: "triangle-strip",
            },
        });

        this.debugPresentPipeline = this.device.createRenderPipeline({
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [debugBindGroupLayout],
            }),
            vertex: {
                module: debugVertexModule,
                entryPoint: "main_vertex",
            },
            fragment: {
                module: debugPresentFragmentModule,
                entryPoint: "main_fragment",
                targets: [{ format: this.debugCanvasFormat }],
            },
            primitive: {
                topology: "triangle-strip",
            },
        });

        this.debugTileUniformBuffer = this.device.createBuffer({
            size:
                WebGpuDebugPresenter.DEBUG_UNIFORM_FLOAT_COUNT *
                WebGpuDebugPresenter.BYTES_PER_CHANNEL,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.debugPresentUniformBuffer = this.device.createBuffer({
            size:
                WebGpuDebugPresenter.DEBUG_UNIFORM_FLOAT_COUNT *
                WebGpuDebugPresenter.BYTES_PER_CHANNEL,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.debugSampler = this.device.createSampler({
            magFilter: "nearest",
            minFilter: "nearest",
            mipmapFilter: "nearest",
        });
    }

    /**
     * Adapts debug resources to current dimensions and tile texture source.
     *
     * @param width - Full render width.
     * @param height - Full render height.
     * @param debugWidth - Debug canvas width.
     * @param debugHeight - Debug canvas height.
     * @param tileTexture - Current tile texture.
     * @param tileSize - Current tile size.
     * @param outputTextureFormat - LDZ output format.
     */
    adaptToDimensions(
        width: number,
        height: number,
        debugWidth: number,
        debugHeight: number,
        tileTexture: GPUTexture,
        tileSize: number,
        outputTextureFormat: GPUTextureFormat,
    ): void {
        this.width = width;
        this.height = height;
        this.debugWidth = debugWidth;
        this.debugHeight = debugHeight;
        this.tileTexture = tileTexture;
        this.tileSize = tileSize;
        this.clearDebugTarget = true;

        this.debugCanvas.width = debugWidth;
        this.debugCanvas.height = debugHeight;
        this.debugGpuContext.configure({
            device: this.device,
            format: this.debugCanvasFormat,
            alphaMode: "opaque",
        });

        if (this.debugLdzTexture) {
            this.debugLdzTexture.destroy();
        }
        this.debugLdzTexture = this.device.createTexture({
            size: {
                width: this.debugWidth,
                height: this.debugHeight,
            },
            format: outputTextureFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });

        this.rebuildBindGroups();
    }

    /**
     * Starts a new tiled debug frame.
     */
    beginFrame(): void {
        this.clearDebugTarget = true;
    }

    /**
     * Encodes one tile compose pass and immediate present pass.
     *
     * @param encoder - Active command encoder.
     * @param xStart - Tile X in full image space.
     * @param yStart - Tile Y in full image space.
     * @param validWidth - Tile width.
     * @param validHeight - Tile height.
     * @param mode - Debug visualization mode.
     * @param maxDepth - Maximum expected depth.
     */
    composeTileAndPresent(
        encoder: GPUCommandEncoder,
        xStart: number,
        yStart: number,
        validWidth: number,
        validHeight: number,
        mode: number,
        maxDepth: number,
    ): void {
        if (
            !this.debugLdzTexture ||
            !this.debugComposeBindGroup ||
            !this.debugPresentBindGroup
        ) {
            return;
        }

        const packedTileUniforms = new Float32Array([
            validWidth / this.tileSize,
            validHeight / this.tileSize,
            0,
            0,
        ]);
        this.queue.writeBuffer(this.debugTileUniformBuffer, 0, packedTileUniforms);

        const debugX0 = (xStart / this.width) * this.debugWidth;
        const debugY0 = (yStart / this.height) * this.debugHeight;
        const debugX1 = ((xStart + validWidth) / this.width) * this.debugWidth;
        const debugY1 = ((yStart + validHeight) / this.height) * this.debugHeight;

        const viewportX = Math.round(debugX0);
        const viewportYBottom = Math.round(debugY0);
        const viewportW = Math.max(1, Math.round(debugX1) - viewportX);
        const viewportH = Math.max(1, Math.round(debugY1) - viewportYBottom);
        const viewportY = this.debugHeight - (viewportYBottom + viewportH);

        const composePass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: this.debugLdzTexture.createView(),
                    loadOp: this.clearDebugTarget ? "clear" : "load",
                    storeOp: "store",
                    clearValue: [0, 0, 0, 0],
                },
            ],
        });
        composePass.setPipeline(this.debugComposePipeline);
        composePass.setBindGroup(0, this.debugComposeBindGroup);
        composePass.setViewport(viewportX, viewportY, viewportW, viewportH, 0, 1);
        composePass.setScissorRect(viewportX, viewportY, viewportW, viewportH);
        composePass.draw(4);
        composePass.end();
        this.clearDebugTarget = false;

        this.updatePresentUniforms(mode, maxDepth);
        const presentPass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: this.debugGpuContext.getCurrentTexture().createView(),
                    loadOp: "clear",
                    storeOp: "store",
                    clearValue: [0, 0, 0, 1],
                },
            ],
        });
        presentPass.setPipeline(this.debugPresentPipeline);
        presentPass.setBindGroup(0, this.debugPresentBindGroup);
        presentPass.draw(4);
        presentPass.end();
    }

    /**
     * Presents current composed debug texture with a selected mode.
     *
     * @param mode - Visualization mode.
     * @param maxDepth - Maximum expected depth.
     */
    present(mode: number, maxDepth: number): void {
        if (!this.debugPresentBindGroup) {
            return;
        }

        this.updatePresentUniforms(mode, maxDepth);
        const encoder = this.device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: this.debugGpuContext.getCurrentTexture().createView(),
                    loadOp: "clear",
                    storeOp: "store",
                    clearValue: [0, 0, 0, 1],
                },
            ],
        });
        pass.setPipeline(this.debugPresentPipeline);
        pass.setBindGroup(0, this.debugPresentBindGroup);
        pass.draw(4);
        pass.end();
        this.queue.submit([encoder.finish()]);
    }

    /**
     * Rebuilds texture-dependent bind groups.
     */
    private rebuildBindGroups(): void {
        if (!this.tileTexture || !this.debugLdzTexture) {
            this.debugComposeBindGroup = null;
            this.debugPresentBindGroup = null;
            return;
        }

        this.debugComposeBindGroup = this.device.createBindGroup({
            layout: this.debugComposePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.debugSampler },
                { binding: 1, resource: this.tileTexture.createView() },
                { binding: 2, resource: { buffer: this.debugTileUniformBuffer } },
            ],
        });

        this.debugPresentBindGroup = this.device.createBindGroup({
            layout: this.debugPresentPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.debugSampler },
                { binding: 1, resource: this.debugLdzTexture.createView() },
                { binding: 2, resource: { buffer: this.debugPresentUniformBuffer } },
            ],
        });
    }

    /**
     * Updates debug present uniforms.
     *
     * @param mode - Visualization mode.
     * @param maxDepth - Maximum expected depth.
     */
    private updatePresentUniforms(mode: number, maxDepth: number): void {
        const packed = new Float32Array([mode, maxDepth, 0, 0]);
        this.queue.writeBuffer(this.debugPresentUniformBuffer, 0, packed);
    }
}
