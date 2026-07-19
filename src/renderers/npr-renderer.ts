import type { StateManager } from "../state-manager";
import type { AppState } from "../types/app-state";
import type { FrameRenderer } from "./frame-renderer";
import type { NprProgramModule } from "./npr/npr-program-module";

/**
 * 2D canvas renderer for NPR output.
 */
export class NprRenderer {
    private static readonly HISTORY_CAP = 100;
    private static readonly THUMBNAIL_MAX_DIM = 512;

    private readonly frameRenderer: FrameRenderer;
    private readonly nprProgram: NprProgramModule;
    private readonly stateManager: StateManager<AppState>;
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly historyContainer: HTMLElement;
    private width!: number;
    private height!: number;
    private renderQueue: Promise<void> = Promise.resolve();
    private history: Array<{ gpuSeed: number; wrapper: HTMLDivElement }> = [];
    private pendingHistoryGpuSeed: number | null = null;

    /**
     * Creates an NPR renderer.
     *
     * @param canvasId - Target canvas ID.
     * @param frameRenderer - Frame renderer dependency.
     * @param nprProgram - Selected NPR program module.
     * @param stateManager - Shared state manager.
     */
    constructor(
        canvasId: string,
        frameRenderer: FrameRenderer,
        nprProgram: NprProgramModule,
        stateManager: StateManager<AppState>,
    ) {
        this.frameRenderer = frameRenderer;
        this.nprProgram = nprProgram;
        this.stateManager = stateManager;

        const canvas = document.getElementById(canvasId);
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new Error(`Missing or invalid canvas element: #${canvasId}`);
        }
        this.canvas = canvas;

        const context = this.canvas.getContext("2d", {
            alpha: false,
            colorSpace: "srgb",
            willReadFrequently: false,
        });
        if (!context) {
            throw new Error("Failed to acquire 2D rendering context");
        }
        this.ctx = context;

        const historyContainer = document.getElementById("nprHistory");
        if (!historyContainer) {
            throw new Error("Missing required DOM element: #nprHistory");
        }
        this.historyContainer = historyContainer;

        this.adaptToDimensions();

        this.stateManager.subscribe(["nprSeed"], async () => {
            await this.render();
        });

        this.stateManager.subscribe(["gpuSeed"], async () => {
            if (this.stateManager.get("autoSaveHistory")) {
                this.pendingHistoryGpuSeed = this.stateManager.get("gpuSeed");
            }
            if (this.stateManager.get("autoRerenderNpr")) {
                await this.render();
            }
        });

        this.stateManager.subscribe(["dimensions"], async () => {
            this.adaptToDimensions();
            await this.render();
        });
    }

    /**
     * Adapts canvas size to state dimensions.
     */
    adaptToDimensions(): void {
        const { width, height } = this.stateManager.get("dimensions");

        this.width = width;
        this.height = height;

        this.canvas.width = width;
        this.canvas.height = height;
    }

    /**
     * Renders NPR output from current frame data.
     */
    async render(): Promise<void> {
        const queuedRender = this.renderQueue.then(async () => {
            await this.#renderNow();
        });
        this.renderQueue = queuedRender.catch(() => undefined);
        return queuedRender;
    }

    /**
     * Performs one NPR render pass.
     */
    async #renderNow(): Promise<void> {
        await this.stateManager.setState({ isRendering: true });

        try {
            const seed = this.stateManager.get("nprSeed");
            const dpi = this.stateManager.get("dpi");
            const frameData = this.frameRenderer.getFrameData();

            this.ctx.save();
            this.ctx.translate(0, this.height);
            this.ctx.scale(1, -1);
            this.nprProgram.renderFromLdz({
                ctx2d: this.ctx,
                ldzData: frameData.ldzData,
                colorData: frameData.colorData,
                width: this.width,
                height: this.height,
                dpi,
                seed,
            });
            this.ctx.restore();

            const pendingSeed = this.pendingHistoryGpuSeed;
            this.pendingHistoryGpuSeed = null;
            if (pendingSeed !== null && this.stateManager.get("autoSaveHistory")) {
                this.captureThumbnail(pendingSeed);
            }

            await this.stateManager.setState({ nprIsDirty: false });
        } finally {
            await this.stateManager.setState({ isRendering: false });
        }
    }

    /**
     * Captures the current NPR canvas as a thumbnail labeled with the GPU seed.
     *
     * @param gpuSeed - GPU seed associated with this NPR render.
     */
    private captureThumbnail(gpuSeed: number): void {
        const longestSide = Math.max(this.width, this.height);
        const scale =
            longestSide > NprRenderer.THUMBNAIL_MAX_DIM
                ? NprRenderer.THUMBNAIL_MAX_DIM / longestSide
                : 1.0;
        const thumbWidth = Math.max(1, Math.round(this.width * scale));
        const thumbHeight = Math.max(1, Math.round(this.height * scale));

        const thumbnail = document.createElement("canvas");
        thumbnail.width = thumbWidth;
        thumbnail.height = thumbHeight;
        const thumbnailCtx = thumbnail.getContext("2d");
        if (!thumbnailCtx) {
            return;
        }
        thumbnailCtx.drawImage(this.canvas, 0, 0, thumbWidth, thumbHeight);

        const label = document.createElement("div");
        label.className = "label";
        label.textContent = `GPU Seed: ${gpuSeed}`;

        const wrapper = document.createElement("div");
        wrapper.className = "npr-history-item";
        wrapper.appendChild(thumbnail);
        wrapper.appendChild(label);

        this.historyContainer.appendChild(wrapper);
        this.history.push({ gpuSeed, wrapper });

        if (this.history.length > NprRenderer.HISTORY_CAP) {
            const evicted = this.history.shift();
            evicted?.wrapper.remove();
        }

        this.historyContainer.scrollLeft = this.historyContainer.scrollWidth;
    }

    /**
     * Clears the NPR render history.
     */
    clearHistory(): void {
        for (const entry of this.history) {
            entry.wrapper.remove();
        }
        this.history = [];
    }
}
