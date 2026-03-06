import type { StateManager } from "../state-manager";
import type { AppState } from "../types/app-state";
import type { FrameData, FrameRenderer } from "./frame-renderer";
import { WebGpuDebugPresenter } from "./webgpu/debug-presenter";
import { WebGpuLdzPass } from "./webgpu/ldz-pass";
import type { LdzGlobalUniforms, LdzSceneModule } from "./webgpu/ldz-scene-module";

/**
 * WebGPU frame renderer orchestrating scene rendering, readback, and debug output.
 *
 * @typeParam TCpuData - Scene CPU data payload type.
 */
export class WebGpuRenderer<TCpuData> implements FrameRenderer {
    private static readonly TILE_SIZE_CAP = 1024;
    private static readonly MAX_DEBUG_DEPTH = 10.0;
    private static readonly LOG_TOTAL_RENDER_TIME = true;
    private static readonly MAX_IN_FLIGHT_READBACKS = 6;

    private readonly stateManager: StateManager<AppState>;
    private readonly sceneModule: LdzSceneModule<TCpuData>;
    private readonly sceneHasColorOutput: boolean;
    private readonly colorDataTag: string | undefined;
    private readonly device: GPUDevice;
    private readonly queue: GPUQueue;
    private readonly ldzPass: WebGpuLdzPass<TCpuData>;
    private readonly debugPresenter: WebGpuDebugPresenter;
    private readonly maxTextureDimension2D: number;
    private frameRenderQueue: Promise<void> = Promise.resolve();
    private width = 1;
    private height = 1;
    private debugWidth = 1;
    private debugHeight = 1;
    private tileSize = 1;
    private ldzData = new Float32Array(4);
    private colorData: Float32Array | undefined;

    /**
     * Creates and initializes a WebGPU renderer.
     *
     * @param canvasId - Debug canvas ID.
     * @param stateManager - Shared state manager.
     * @param sceneModule - Selected scene module.
     * @returns Initialized renderer instance.
     */
    static async create<TCpuData>(
        canvasId: string,
        stateManager: StateManager<AppState>,
        sceneModule: LdzSceneModule<TCpuData>,
    ): Promise<WebGpuRenderer<TCpuData>> {
        if (!navigator.gpu) {
            throw new Error("WebGPU is not available in this browser");
        }

        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            throw new Error("Failed to acquire a WebGPU adapter");
        }

        const device = await adapter.requestDevice();
        return new WebGpuRenderer(canvasId, stateManager, sceneModule, device);
    }

    /**
     * Creates a WebGPU renderer.
     *
     * @param canvasId - Debug canvas ID.
     * @param stateManager - Shared state manager.
     * @param sceneModule - Selected scene module.
     * @param device - WebGPU device.
     */
    private constructor(
        canvasId: string,
        stateManager: StateManager<AppState>,
        sceneModule: LdzSceneModule<TCpuData>,
        device: GPUDevice,
    ) {
        this.stateManager = stateManager;
        this.sceneModule = sceneModule;
        this.sceneHasColorOutput = this.sceneModule.outputSpec.mode === "ldz-plus-color";
        this.colorDataTag =
            this.sceneModule.outputSpec.mode === "ldz-plus-color"
                ? this.sceneModule.outputSpec.colorDataTag
                : undefined;
        this.device = device;
        this.queue = device.queue;

        const canvas = document.getElementById(canvasId);
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new Error(`Missing or invalid canvas element: #${canvasId}`);
        }

        const initialDimensions = this.stateManager.get("dimensions");
        const initialSeed = this.stateManager.get("gpuSeed");

        this.ldzPass = new WebGpuLdzPass(
            this.device,
            this.sceneModule,
            initialDimensions,
            initialSeed,
        );
        this.debugPresenter = new WebGpuDebugPresenter(
            this.device,
            canvas,
            WebGpuLdzPass.OUTPUT_TEXTURE_FORMAT,
        );

        this.maxTextureDimension2D = this.device.limits.maxTextureDimension2D;
        this.adaptToDimensions();
        this.renderDebug();

        canvas.addEventListener("click", async () => {
            const currentMode = this.stateManager.get("visualizationMode");
            await this.stateManager.setState({
                visualizationMode: (currentMode + 1) % 3,
            });
        });

        this.stateManager.subscribe(["gpuSeed"], async () => {
            this.rebuildSceneResources();
            await this.renderFrameTiled();
        });

        this.stateManager.subscribe(["dimensions"], async () => {
            this.adaptToDimensions();
            this.rebuildSceneResources();
            await this.renderFrameTiled();
        });

        this.stateManager.subscribe(["visualizationMode"], () => {
            this.renderDebug();
        });
    }

    /**
     * Rebuilds scene-specific GPU resources.
     */
    private rebuildSceneResources(): void {
        const dimensions = this.stateManager.get("dimensions");
        const seed = this.stateManager.get("gpuSeed");
        this.ldzPass.rebuildSceneResources(dimensions, seed);
    }

    /**
     * Adapts buffers and texture sizes to state dimensions.
     */
    adaptToDimensions(): void {
        const { width, height, debugWidth, debugHeight } = this.stateManager.get("dimensions");
        const safeWidth = Math.max(1, Math.round(width));
        const safeHeight = Math.max(1, Math.round(height));
        const safeDebugWidth = Math.max(1, Math.round(debugWidth));
        const safeDebugHeight = Math.max(1, Math.round(debugHeight));

        this.tileSize = Math.max(
            1,
            Math.min(
                WebGpuRenderer.TILE_SIZE_CAP,
                Math.max(safeWidth, safeHeight),
                this.maxTextureDimension2D,
            ),
        );
        this.width = safeWidth;
        this.height = safeHeight;
        this.debugWidth = safeDebugWidth;
        this.debugHeight = safeDebugHeight;

        this.ldzPass.adaptToDimensions(this.tileSize);

        const tileTexture = this.ldzPass.getTileTexture();
        if (!tileTexture) {
            throw new Error("Tile texture has not been initialized");
        }

        this.debugPresenter.adaptToDimensions(
            this.width,
            this.height,
            this.debugWidth,
            this.debugHeight,
            tileTexture,
            this.tileSize,
            WebGpuLdzPass.OUTPUT_TEXTURE_FORMAT,
        );

        this.ldzData = new Float32Array(this.width * this.height * 4);
        this.colorData = this.sceneHasColorOutput
            ? new Float32Array(this.width * this.height * 4)
            : undefined;
    }

    /**
     * Renders frame data in tiles and updates debug output.
     */
    async renderFrameTiled(): Promise<void> {
        const queuedRender = this.frameRenderQueue.then(async () => {
            await this.renderFrameTiledNow();
        });
        this.frameRenderQueue = queuedRender.catch(() => undefined);
        return queuedRender;
    }

    /**
     * Performs one tiled frame render pass.
     */
    private async renderFrameTiledNow(): Promise<void> {
        await this.stateManager.setState({ isRendering: true });

        try {
            const renderStart = performance.now();
            const seed = this.stateManager.get("gpuSeed");
            this.debugPresenter.beginFrame();

            type PendingReadback = {
                promise: Promise<void>;
                settled: boolean;
                error: unknown | null;
                slotIndex: number;
            };
            const pendingReadbacks: PendingReadback[] = [];

            const xTileCount = Math.ceil(this.width / this.tileSize);
            const yTileCount = Math.ceil(this.height / this.tileSize);
            const tileCount = xTileCount * yTileCount;
            const readbackSlotCount = Math.max(
                1,
                Math.min(WebGpuRenderer.MAX_IN_FLIGHT_READBACKS, tileCount),
            );
            this.ldzPass.configureReadbackSlots(readbackSlotCount);
            const xTileScale = this.tileSize / this.width;
            const yTileScale = this.tileSize / this.height;

            const collectSettledReadbacks = (): void => {
                for (let index = pendingReadbacks.length - 1; index >= 0; index--) {
                    const pendingReadback = pendingReadbacks[index];
                    if (!pendingReadback.settled) {
                        continue;
                    }

                    this.ldzPass.releaseReadbackSlot(pendingReadback.slotIndex);
                    if (pendingReadback.error) {
                        throw pendingReadback.error;
                    }
                    pendingReadbacks.splice(index, 1);
                }
            };

            for (let yTile = 0; yTile < yTileCount; yTile++) {
                for (let xTile = 0; xTile < xTileCount; xTile++) {
                    const xStart = xTile * this.tileSize;
                    const yStart = yTile * this.tileSize;
                    const validWidth = Math.min(this.tileSize, this.width - xStart);
                    const validHeight = Math.min(this.tileSize, this.height - yStart);

                    const globalUniforms: LdzGlobalUniforms = {
                        aspect: this.height > 0 ? this.width / this.height : 1.0,
                        seed,
                        tileOffsetX: xTile * xTileScale,
                        tileOffsetY: yTile * yTileScale,
                        tileScaleX: xTileScale * (validWidth / this.tileSize),
                        tileScaleY: yTileScale * (validHeight / this.tileSize),
                    };

                    let slotIndex = this.ldzPass.acquireReadbackSlot();
                    while (slotIndex === null) {
                        await Promise.race(pendingReadbacks.map((entry) => entry.promise));
                        collectSettledReadbacks();
                        slotIndex = this.ldzPass.acquireReadbackSlot();
                    }

                    const encoder = this.device.createCommandEncoder();
                    const readback = this.ldzPass.encodeTileRenderAndReadback(
                        encoder,
                        globalUniforms,
                        validWidth,
                        validHeight,
                        slotIndex,
                    );
                    this.debugPresenter.composeTileAndPresent(
                        encoder,
                        xStart,
                        yStart,
                        validWidth,
                        validHeight,
                        this.stateManager.get("visualizationMode"),
                        WebGpuRenderer.MAX_DEBUG_DEPTH,
                    );

                    this.queue.submit([encoder.finish()]);
                    const readbackPromise = (async (): Promise<void> => {
                        await this.ldzPass.copyReadbackToLdzData(
                            readback,
                            this.ldzData,
                            this.width,
                            xStart,
                            yStart,
                        );
                        if (this.colorData) {
                            await this.ldzPass.copyReadbackToColorData(
                                readback,
                                this.colorData,
                                this.width,
                                xStart,
                                yStart,
                            );
                        }
                    })();
                    const pendingReadback: PendingReadback = {
                        promise: Promise.resolve(),
                        settled: false,
                        error: null,
                        slotIndex,
                    };
                    pendingReadback.promise = readbackPromise
                        .then(() => undefined)
                        .catch((error: unknown) => {
                            pendingReadback.error = error;
                        })
                        .finally(() => {
                            pendingReadback.settled = true;
                        });
                    pendingReadbacks.push(pendingReadback);

                    if (pendingReadbacks.length >= readbackSlotCount) {
                        await Promise.race(pendingReadbacks.map((entry) => entry.promise));
                        collectSettledReadbacks();
                    }

                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
            }

            while (pendingReadbacks.length > 0) {
                await Promise.race(pendingReadbacks.map((entry) => entry.promise));
                collectSettledReadbacks();
            }

            if (WebGpuRenderer.LOG_TOTAL_RENDER_TIME) {
                console.log(
                    `[WebGPU LDZ] Total render time: ${(performance.now() - renderStart).toFixed(2)} ms`,
                );
            }

            await this.stateManager.setState({ nprIsDirty: false });
        } finally {
            await this.stateManager.setState({ isRendering: false });
        }
    }

    /**
     * Draws selected LDZ visualization to the debug canvas.
     */
    private renderDebug(): void {
        this.debugPresenter.present(
            this.stateManager.get("visualizationMode"),
            WebGpuRenderer.MAX_DEBUG_DEPTH,
        );
    }

    /**
     * Returns the latest frame data buffers.
     *
     * @returns Frame data.
     */
    getFrameData(): FrameData {
        return {
            width: this.width,
            height: this.height,
            ldzData: this.ldzData,
            colorData: this.colorData,
            colorDataTag: this.colorDataTag,
        };
    }
}
