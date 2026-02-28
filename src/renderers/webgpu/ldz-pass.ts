import type { AppDimensions } from "../../types/app-state";
import type {
    LdzGlobalUniforms,
    LdzSceneGpuResources,
    LdzSceneModule,
} from "./ldz-scene-module";

const FULLSCREEN_VERTEX_SHADER = `
struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

struct GlobalUniforms {
    aspect: f32,
    seed: u32,
    _pad0: u32,
    _pad1: u32,
    tile_offset: vec2f,
    tile_scale: vec2f,
};

@group(0) @binding(0) var<uniform> global_uniforms: GlobalUniforms;

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
    output.uv =
        (position * 0.5 + 0.5) * global_uniforms.tile_scale +
        global_uniforms.tile_offset;
    return output;
}
`;

/**
 * Readback handle for one rendered LDZ tile.
 */
export type LdzTileReadback = {
    slotIndex: number;
    readBuffer: GPUBuffer;
    paddedBytesPerRow: number;
    validWidth: number;
    validHeight: number;
};

type LdzReadbackSlot = {
    buffer: GPUBuffer;
    inUse: boolean;
};

/**
 * Dedicated WebGPU LDZ pass component.
 *
 * @typeParam TCpuData - Scene CPU data payload type.
 */
export class WebGpuLdzPass<TCpuData> {
    private static readonly GLOBAL_UNIFORM_FLOAT_COUNT = 8;
    private static readonly CHANNEL_COUNT = 4;
    private static readonly BYTES_PER_CHANNEL = Float32Array.BYTES_PER_ELEMENT;
    private static readonly READBACK_ALIGNMENT_BYTES = 256;
    static readonly OUTPUT_TEXTURE_FORMAT: GPUTextureFormat = "rgba32float";

    private readonly device: GPUDevice;
    private readonly queue: GPUQueue;
    private readonly sceneModule: LdzSceneModule<TCpuData>;
    private readonly pipeline: GPURenderPipeline;
    private readonly globalUniformBuffer: GPUBuffer;
    private readonly globalBindGroup: GPUBindGroup;
    private sceneBindGroup: GPUBindGroup;
    private sceneGpuResources: LdzSceneGpuResources;
    private tileTexture: GPUTexture | null = null;
    private tileSize = 1;
    private readbackSlots: LdzReadbackSlot[] = [];
    private readbackPaddedBytesPerRow = 0;

    /**
     * Creates an LDZ pass.
     *
     * @param device - Active WebGPU device.
     * @param sceneModule - Scene module for fragment shading.
     * @param dimensions - Initial dimensions.
     * @param seed - Initial deterministic seed.
     */
    constructor(
        device: GPUDevice,
        sceneModule: LdzSceneModule<TCpuData>,
        dimensions: AppDimensions,
        seed: number,
    ) {
        this.device = device;
        this.queue = device.queue;
        this.sceneModule = sceneModule;

        const globalBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: "uniform" },
                },
            ],
        });

        const sceneBindGroupLayout = this.device.createBindGroupLayout({
            entries: [...this.sceneModule.bindGroupLayoutEntries],
        });

        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [globalBindGroupLayout, sceneBindGroupLayout],
        });

        const vertexModule = this.device.createShaderModule({
            code: FULLSCREEN_VERTEX_SHADER,
            label: "ldz-fullscreen-vertex",
        });
        const fragmentModule = this.device.createShaderModule({
            code: this.sceneModule.fragmentShader,
            label: `ldz-fragment-${this.sceneModule.id}`,
        });

        this.pipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: vertexModule,
                entryPoint: "main_vertex",
            },
            fragment: {
                module: fragmentModule,
                entryPoint: this.sceneModule.fragmentEntryPoint,
                targets: [{ format: WebGpuLdzPass.OUTPUT_TEXTURE_FORMAT }],
            },
            primitive: {
                topology: "triangle-strip",
            },
        });

        this.globalUniformBuffer = this.device.createBuffer({
            size: WebGpuLdzPass.GLOBAL_UNIFORM_FLOAT_COUNT * WebGpuLdzPass.BYTES_PER_CHANNEL,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.globalBindGroup = this.device.createBindGroup({
            layout: globalBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.globalUniformBuffer },
                },
            ],
        });

        const cpuData = this.sceneModule.createCpuData(seed, dimensions);
        this.sceneGpuResources = this.sceneModule.createGpuResources(
            this.device,
            this.queue,
            cpuData,
        );
        this.sceneBindGroup = this.device.createBindGroup({
            layout: sceneBindGroupLayout,
            entries: [...this.sceneGpuResources.bindGroupEntries],
        });
    }

    /**
     * Recreates tile texture resources for a new tile size.
     *
     * @param tileSize - Active tile size in pixels.
     */
    adaptToDimensions(tileSize: number): void {
        this.tileSize = tileSize;
        this.resetReadbackSlots();

        if (this.tileTexture) {
            this.tileTexture.destroy();
        }

        this.tileTexture = this.device.createTexture({
            size: {
                width: this.tileSize,
                height: this.tileSize,
            },
            format: WebGpuLdzPass.OUTPUT_TEXTURE_FORMAT,
            usage:
                GPUTextureUsage.RENDER_ATTACHMENT |
                GPUTextureUsage.COPY_SRC |
                GPUTextureUsage.TEXTURE_BINDING,
        });
    }

    /**
     * Rebuilds scene-specific GPU resources from new dimensions/seed.
     *
     * @param dimensions - Current dimensions.
     * @param seed - Deterministic seed.
     */
    rebuildSceneResources(dimensions: AppDimensions, seed: number): void {
        const cpuData = this.sceneModule.createCpuData(seed, dimensions);
        const oldResources = this.sceneGpuResources;
        this.sceneGpuResources = this.sceneModule.createGpuResources(
            this.device,
            this.queue,
            cpuData,
        );
        const sceneLayout = this.pipeline.getBindGroupLayout(1);
        this.sceneBindGroup = this.device.createBindGroup({
            layout: sceneLayout,
            entries: [...this.sceneGpuResources.bindGroupEntries],
        });
        oldResources.destroy();
    }

    /**
     * Configures pooled readback slots.
     *
     * @param slotCount - Number of pooled readback slots.
     */
    configureReadbackSlots(slotCount: number): void {
        const normalizedSlotCount = Math.max(1, Math.floor(slotCount));

        if (this.tileSize <= 0) {
            throw new Error("Tile size must be configured before readback slots");
        }

        if (normalizedSlotCount === this.readbackSlots.length) {
            return;
        }

        this.resetReadbackSlots();

        const unpaddedBytesPerRow =
            this.tileSize * WebGpuLdzPass.CHANNEL_COUNT * WebGpuLdzPass.BYTES_PER_CHANNEL;
        this.readbackPaddedBytesPerRow =
            Math.ceil(unpaddedBytesPerRow / WebGpuLdzPass.READBACK_ALIGNMENT_BYTES) *
            WebGpuLdzPass.READBACK_ALIGNMENT_BYTES;
        const readBufferSize = this.readbackPaddedBytesPerRow * this.tileSize;

        this.readbackSlots = Array.from({ length: normalizedSlotCount }, () => ({
            buffer: this.device.createBuffer({
                size: readBufferSize,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            }),
            inUse: false,
        }));
    }

    /**
     * Acquires a free readback slot index.
     *
     * @returns Slot index, or null if all slots are in use.
     */
    acquireReadbackSlot(): number | null {
        for (let index = 0; index < this.readbackSlots.length; index++) {
            if (this.readbackSlots[index].inUse) {
                continue;
            }
            this.readbackSlots[index].inUse = true;
            return index;
        }
        return null;
    }

    /**
     * Releases a readback slot index.
     *
     * @param slotIndex - Slot index to release.
     */
    releaseReadbackSlot(slotIndex: number): void {
        const slot = this.readbackSlots[slotIndex];
        if (!slot) {
            throw new Error(`Invalid readback slot index: ${slotIndex}`);
        }
        slot.inUse = false;
    }

    /**
     * Destroys all pooled readback slots.
     */
    private resetReadbackSlots(): void {
        for (const slot of this.readbackSlots) {
            slot.buffer.destroy();
        }
        this.readbackSlots = [];
        this.readbackPaddedBytesPerRow = 0;
    }

    /**
     * Encodes one LDZ tile render and copy-to-buffer readback operation.
     *
     * @param encoder - Active command encoder.
     * @param uniforms - Tile global uniforms.
     * @param validWidth - Tile width in pixels.
     * @param validHeight - Tile height in pixels.
     * @returns Readback handle for async mapping.
     */
    encodeTileRenderAndReadback(
        encoder: GPUCommandEncoder,
        uniforms: LdzGlobalUniforms,
        validWidth: number,
        validHeight: number,
        slotIndex: number,
    ): LdzTileReadback {
        if (!this.tileTexture) {
            throw new Error("Tile texture has not been initialized");
        }
        const slot = this.readbackSlots[slotIndex];
        if (!slot) {
            throw new Error(`Invalid readback slot index: ${slotIndex}`);
        }
        if (!slot.inUse) {
            throw new Error(`Readback slot ${slotIndex} must be acquired before use`);
        }

        const packedUniforms = new ArrayBuffer(
            WebGpuLdzPass.GLOBAL_UNIFORM_FLOAT_COUNT * WebGpuLdzPass.BYTES_PER_CHANNEL,
        );
        const uniformView = new DataView(packedUniforms);
        uniformView.setFloat32(0, uniforms.aspect, true);
        uniformView.setUint32(4, uniforms.seed >>> 0, true);
        uniformView.setUint32(8, 0, true);
        uniformView.setUint32(12, 0, true);
        uniformView.setFloat32(16, uniforms.tileOffsetX, true);
        uniformView.setFloat32(20, uniforms.tileOffsetY, true);
        uniformView.setFloat32(24, uniforms.tileScaleX, true);
        uniformView.setFloat32(28, uniforms.tileScaleY, true);
        this.queue.writeBuffer(this.globalUniformBuffer, 0, packedUniforms);

        const paddedBytesPerRow = this.readbackPaddedBytesPerRow;

        const renderPass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: this.tileTexture.createView(),
                    loadOp: "clear",
                    storeOp: "store",
                    clearValue: [0, 0, 0, 0],
                },
            ],
        });
        renderPass.setPipeline(this.pipeline);
        renderPass.setBindGroup(0, this.globalBindGroup);
        renderPass.setBindGroup(1, this.sceneBindGroup);
        renderPass.setViewport(0, 0, validWidth, validHeight, 0, 1);
        renderPass.setScissorRect(0, 0, validWidth, validHeight);
        renderPass.draw(4);
        renderPass.end();

        encoder.copyTextureToBuffer(
            {
                texture: this.tileTexture,
                origin: { x: 0, y: 0, z: 0 },
            },
            {
                buffer: slot.buffer,
                bytesPerRow: paddedBytesPerRow,
                rowsPerImage: validHeight,
            },
            {
                width: validWidth,
                height: validHeight,
                depthOrArrayLayers: 1,
            },
        );

        return {
            slotIndex,
            readBuffer: slot.buffer,
            paddedBytesPerRow,
            validWidth,
            validHeight,
        };
    }

    /**
     * Maps one tile readback and copies it into full LDZ data.
     *
     * @param readback - Tile readback handle.
     * @param target - Full-size LDZ target array.
     * @param targetWidth - Full image width.
     * @param xStart - Tile X offset in full image.
     * @param yStart - Tile Y offset in full image.
     */
    async copyReadbackToLdzData(
        readback: LdzTileReadback,
        target: Float32Array,
        targetWidth: number,
        xStart: number,
        yStart: number,
    ): Promise<void> {
        await readback.readBuffer.mapAsync(GPUMapMode.READ);
        try {
            const mapped = readback.readBuffer.getMappedRange();
            const source = new Float32Array(mapped);
            const sourceRowStride =
                readback.paddedBytesPerRow / WebGpuLdzPass.BYTES_PER_CHANNEL;

            for (let row = 0; row < readback.validHeight; row++) {
                const sourceRowOffset = row * sourceRowStride;
                const destinationRow = yStart + (readback.validHeight - 1 - row);
                const destinationBase =
                    (destinationRow * targetWidth + xStart) * WebGpuLdzPass.CHANNEL_COUNT;

                for (let col = 0; col < readback.validWidth; col++) {
                    const sourceBase = sourceRowOffset + col * WebGpuLdzPass.CHANNEL_COUNT;
                    const destinationOffset =
                        destinationBase + col * WebGpuLdzPass.CHANNEL_COUNT;

                    for (let channel = 0; channel < WebGpuLdzPass.CHANNEL_COUNT; channel++) {
                        target[destinationOffset + channel] = source[sourceBase + channel];
                    }
                }
            }
        } finally {
            readback.readBuffer.unmap();
        }
    }

    /**
     * Returns the current tile texture for debug composition.
     *
     * @returns Tile texture.
     */
    getTileTexture(): GPUTexture | null {
        return this.tileTexture;
    }
}
