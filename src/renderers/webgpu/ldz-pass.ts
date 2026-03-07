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
    ldzReadBuffer: GPUBuffer;
    colorReadBuffer: GPUBuffer | null;
    ldzPaddedBytesPerRow: number;
    colorPaddedBytesPerRow: number | null;
    validWidth: number;
    validHeight: number;
};

type LdzReadbackSlot = {
    ldzBuffer: GPUBuffer;
    colorBuffer: GPUBuffer | null;
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
    private static readonly FLOAT32_BYTES_PER_VALUE = Float32Array.BYTES_PER_ELEMENT;
    private static readonly UINT8_BYTES_PER_VALUE = Uint8Array.BYTES_PER_ELEMENT;
    private static readonly READBACK_ALIGNMENT_BYTES = 256;
    static readonly OUTPUT_TEXTURE_FORMAT: GPUTextureFormat = "rgba32float";

    private readonly device: GPUDevice;
    private readonly queue: GPUQueue;
    private readonly sceneModule: LdzSceneModule<TCpuData>;
    private readonly hasColorOutput: boolean;
    private readonly colorTextureFormat: GPUTextureFormat | null;
    private readonly pipeline: GPURenderPipeline;
    private readonly globalUniformBuffer: GPUBuffer;
    private readonly globalBindGroup: GPUBindGroup;
    private sceneBindGroup: GPUBindGroup;
    private sceneGpuResources: LdzSceneGpuResources;
    private tileTexture: GPUTexture | null = null;
    private colorTileTexture: GPUTexture | null = null;
    private tileSize = 1;
    private readbackSlots: LdzReadbackSlot[] = [];
    private ldzReadbackPaddedBytesPerRow = 0;
    private colorReadbackPaddedBytesPerRow: number | null = null;

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
        this.hasColorOutput = this.sceneModule.outputSpec.mode === "ldz-plus-color";
        this.colorTextureFormat =
            this.sceneModule.outputSpec.mode === "ldz-plus-color"
                ? this.sceneModule.outputSpec.colorTextureFormat
                : null;

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
        const colorTargets: GPUColorTargetState[] = [
            { format: WebGpuLdzPass.OUTPUT_TEXTURE_FORMAT },
        ];
        if (this.hasColorOutput && this.colorTextureFormat) {
            colorTargets.push({ format: this.colorTextureFormat });
        }

        this.pipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: vertexModule,
                entryPoint: "main_vertex",
            },
            fragment: {
                module: fragmentModule,
                entryPoint: this.sceneModule.fragmentEntryPoint,
                targets: colorTargets,
            },
            primitive: {
                topology: "triangle-strip",
            },
        });

        this.globalUniformBuffer = this.device.createBuffer({
            size:
                WebGpuLdzPass.GLOBAL_UNIFORM_FLOAT_COUNT *
                WebGpuLdzPass.FLOAT32_BYTES_PER_VALUE,
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
        if (this.colorTileTexture) {
            this.colorTileTexture.destroy();
            this.colorTileTexture = null;
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

        if (this.hasColorOutput) {
            if (!this.colorTextureFormat) {
                throw new Error("Color texture format must be provided for color output");
            }
            this.colorTileTexture = this.device.createTexture({
                size: {
                    width: this.tileSize,
                    height: this.tileSize,
                },
                format: this.colorTextureFormat,
                usage:
                    GPUTextureUsage.RENDER_ATTACHMENT |
                    GPUTextureUsage.COPY_SRC |
                    GPUTextureUsage.TEXTURE_BINDING,
            });
        }
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

        const ldzUnpaddedBytesPerRow =
            this.tileSize *
            WebGpuLdzPass.CHANNEL_COUNT *
            WebGpuLdzPass.FLOAT32_BYTES_PER_VALUE;
        this.ldzReadbackPaddedBytesPerRow =
            Math.ceil(ldzUnpaddedBytesPerRow / WebGpuLdzPass.READBACK_ALIGNMENT_BYTES) *
            WebGpuLdzPass.READBACK_ALIGNMENT_BYTES;
        const ldzReadBufferSize = this.ldzReadbackPaddedBytesPerRow * this.tileSize;

        if (this.hasColorOutput) {
            const colorUnpaddedBytesPerRow =
                this.tileSize *
                WebGpuLdzPass.CHANNEL_COUNT *
                WebGpuLdzPass.UINT8_BYTES_PER_VALUE;
            this.colorReadbackPaddedBytesPerRow =
                Math.ceil(colorUnpaddedBytesPerRow / WebGpuLdzPass.READBACK_ALIGNMENT_BYTES) *
                WebGpuLdzPass.READBACK_ALIGNMENT_BYTES;
        } else {
            this.colorReadbackPaddedBytesPerRow = null;
        }

        this.readbackSlots = Array.from({ length: normalizedSlotCount }, () => ({
            ldzBuffer: this.device.createBuffer({
                size: ldzReadBufferSize,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            }),
            colorBuffer:
                this.hasColorOutput && this.colorReadbackPaddedBytesPerRow !== null
                    ? this.device.createBuffer({
                          size: this.colorReadbackPaddedBytesPerRow * this.tileSize,
                          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
                      })
                    : null,
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
            slot.ldzBuffer.destroy();
            if (slot.colorBuffer) {
                slot.colorBuffer.destroy();
            }
        }
        this.readbackSlots = [];
        this.ldzReadbackPaddedBytesPerRow = 0;
        this.colorReadbackPaddedBytesPerRow = null;
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
        if (this.hasColorOutput && !this.colorTileTexture) {
            throw new Error("Color tile texture has not been initialized");
        }
        const slot = this.readbackSlots[slotIndex];
        if (!slot) {
            throw new Error(`Invalid readback slot index: ${slotIndex}`);
        }
        if (!slot.inUse) {
            throw new Error(`Readback slot ${slotIndex} must be acquired before use`);
        }

        const packedUniforms = new ArrayBuffer(
            WebGpuLdzPass.GLOBAL_UNIFORM_FLOAT_COUNT * WebGpuLdzPass.FLOAT32_BYTES_PER_VALUE,
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

        const ldzPaddedBytesPerRow = this.ldzReadbackPaddedBytesPerRow;
        const colorPaddedBytesPerRow = this.colorReadbackPaddedBytesPerRow;

        const colorAttachments: GPURenderPassColorAttachment[] = [
            {
                view: this.tileTexture.createView(),
                loadOp: "clear",
                storeOp: "store",
                clearValue: [0, 0, 0, 0],
            },
        ];
        if (this.hasColorOutput && this.colorTileTexture) {
            colorAttachments.push({
                view: this.colorTileTexture.createView(),
                loadOp: "clear",
                storeOp: "store",
                clearValue: [0, 0, 0, 0],
            });
        }

        const renderPass = encoder.beginRenderPass({
            colorAttachments,
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
                buffer: slot.ldzBuffer,
                bytesPerRow: ldzPaddedBytesPerRow,
                rowsPerImage: validHeight,
            },
            {
                width: validWidth,
                height: validHeight,
                depthOrArrayLayers: 1,
            },
        );

        if (this.colorTileTexture && slot.colorBuffer && colorPaddedBytesPerRow !== null) {
            encoder.copyTextureToBuffer(
                {
                    texture: this.colorTileTexture,
                    origin: { x: 0, y: 0, z: 0 },
                },
                {
                    buffer: slot.colorBuffer,
                    bytesPerRow: colorPaddedBytesPerRow,
                    rowsPerImage: validHeight,
                },
                {
                    width: validWidth,
                    height: validHeight,
                    depthOrArrayLayers: 1,
                },
            );
        }

        return {
            slotIndex,
            ldzReadBuffer: slot.ldzBuffer,
            colorReadBuffer: slot.colorBuffer,
            ldzPaddedBytesPerRow,
            colorPaddedBytesPerRow,
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
        await readback.ldzReadBuffer.mapAsync(GPUMapMode.READ);
        try {
            const mapped = readback.ldzReadBuffer.getMappedRange();
            const source = new Float32Array(mapped);
            const sourceRowStride =
                readback.ldzPaddedBytesPerRow / WebGpuLdzPass.FLOAT32_BYTES_PER_VALUE;

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
            readback.ldzReadBuffer.unmap();
        }
    }

    /**
     * Maps one tile readback and copies it into full color data.
     *
     * @param readback - Tile readback handle.
     * @param target - Full-size color target array.
     * @param targetWidth - Full image width.
     * @param xStart - Tile X offset in full image.
     * @param yStart - Tile Y offset in full image.
     */
    async copyReadbackToColorData(
        readback: LdzTileReadback,
        target: Uint8Array,
        targetWidth: number,
        xStart: number,
        yStart: number,
    ): Promise<void> {
        if (!readback.colorReadBuffer || readback.colorPaddedBytesPerRow === null) {
            return;
        }

        await readback.colorReadBuffer.mapAsync(GPUMapMode.READ);
        try {
            const mapped = readback.colorReadBuffer.getMappedRange();
            const source = new Uint8Array(mapped);
            const sourceRowStride = readback.colorPaddedBytesPerRow;

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
            readback.colorReadBuffer.unmap();
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
