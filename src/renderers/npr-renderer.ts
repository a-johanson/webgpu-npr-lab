import type { StateManager } from "../state-manager";
import type { AppState } from "../types/app-state";
import type { LdzRenderer } from "./ldz-renderer";
import type { NprProgramModule } from "./npr/npr-program-module";

/**
 * 2D canvas renderer for NPR output.
 */
export class NprRenderer {
    private readonly ldzRenderer: LdzRenderer;
    private readonly nprProgram: NprProgramModule;
    private readonly stateManager: StateManager<AppState>;
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private width!: number;
    private height!: number;
    private renderQueue: Promise<void> = Promise.resolve();

    /**
     * Creates an NPR renderer.
     *
     * @param canvasId - Target canvas ID.
     * @param ldzRenderer - LDZ renderer dependency.
     * @param nprProgram - Selected NPR program module.
     * @param stateManager - Shared state manager.
     */
    constructor(
        canvasId: string,
        ldzRenderer: LdzRenderer,
        nprProgram: NprProgramModule,
        stateManager: StateManager<AppState>,
    ) {
        this.ldzRenderer = ldzRenderer;
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

        this.adaptToDimensions();

        this.stateManager.subscribe(["nprSeed"], async () => {
            await this.render();
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
     * Renders NPR output from current LDZ data.
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
            const ldzData = this.ldzRenderer.getLdzData();

            this.ctx.save();
            this.ctx.translate(0, this.height);
            this.ctx.scale(1, -1);
            this.nprProgram.renderFromLdz({
                ctx2d: this.ctx,
                ldzData,
                width: this.width,
                height: this.height,
                dpi,
                seed,
            });
            this.ctx.restore();

            await this.stateManager.setState({ nprIsDirty: false });
        } finally {
            await this.stateManager.setState({ isRendering: false });
        }
    }
}
