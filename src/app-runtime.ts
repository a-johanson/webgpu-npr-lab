import type { NprProgramModule } from "./renderers/npr/npr-program-module";
import { NprRenderer } from "./renderers/npr-renderer";
import type { LdzSceneModule } from "./renderers/webgpu/ldz-scene-module";
import { WebGpuRenderer } from "./renderers/webgpu-renderer";
import { StateManager } from "./state-manager";
import type { AppDimensions, AppState } from "./types/app-state";

/**
 * Configuration used to bootstrap the application runtime.
 *
 * @typeParam TCpuData - Scene-specific CPU data payload type.
 */
export type AppRuntimeConfiguration<TCpuData> = {
    widthCm: number;
    heightCm: number;
    dpi: number;
    maxDebugSize: number;
    gpuSeed: number;
    nprSeed: string;
    ldzSceneModule: LdzSceneModule<TCpuData>;
    nprProgramModule: NprProgramModule;
};

/**
 * Computes render and debug dimensions from DPI.
 *
 * @param configuration - Runtime configuration values.
 * @param dpiValue - Target DPI.
 * @returns Dimension set.
 */
function computeDimensions(
    configuration: Pick<
        AppRuntimeConfiguration<unknown>,
        "widthCm" | "heightCm" | "maxDebugSize"
    >,
    dpiValue: number,
): AppDimensions {
    const aspectRatio = configuration.widthCm / configuration.heightCm;
    const dpcm = dpiValue / 2.54;

    const width = Math.round(configuration.widthCm * dpcm);
    const height = Math.round(configuration.heightCm * dpcm);

    const longestSide = Math.max(width, height);
    const debugScale =
        longestSide > configuration.maxDebugSize
            ? configuration.maxDebugSize / longestSide
            : 1.0;
    const debugWidth = debugScale * width;
    const debugHeight = Math.round(debugWidth / aspectRatio);

    return { width, height, debugWidth, debugHeight };
}

/**
 * Gets a required DOM element and throws if it does not exist.
 *
 * @param id - Element ID.
 * @returns The found element.
 */
function getRequiredElement<TElement extends HTMLElement>(id: string): TElement {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing required DOM element: #${id}`);
    }
    return element as TElement;
}

/**
 * Sets up application state, renderers, UI bindings, and initial rendering.
 *
 * @typeParam TCpuData - Scene-specific CPU data payload type.
 * @param configuration - Runtime configuration values.
 */
export async function setupApplication<TCpuData>(
    configuration: AppRuntimeConfiguration<TCpuData>,
): Promise<void> {
    const stateManager = new StateManager<AppState>({
        gpuSeed: configuration.gpuSeed,
        nprSeed: configuration.nprSeed,
        dpi: configuration.dpi,
        dimensions: computeDimensions(configuration, configuration.dpi),
        visualizationMode: 0,
        nprIsDirty: false,
        isRendering: false,
    });

    const webgpuRenderer = await WebGpuRenderer.create(
        "debugCanvas",
        stateManager,
        configuration.ldzSceneModule,
    );
    const nprRenderer = new NprRenderer(
        "outputCanvas",
        webgpuRenderer,
        configuration.nprProgramModule,
        stateManager,
    );

    const dpiInput = getRequiredElement<HTMLInputElement>("dpi");
    const gpuSeedInput = getRequiredElement<HTMLInputElement>("gpuSeed");
    const nprSeedInput = getRequiredElement<HTMLInputElement>("nprSeed");

    const applyDpiButton = getRequiredElement<HTMLButtonElement>("applyDpi");
    const applyGpuSeedButton = getRequiredElement<HTMLButtonElement>("applyGpuSeed");
    const randomizeGpuSeedButton = getRequiredElement<HTMLButtonElement>("randomizeGpuSeed");
    const applyNprSeedButton = getRequiredElement<HTMLButtonElement>("applyNprSeed");

    stateManager.subscribe(["isRendering"], () => {
        const isRendering = stateManager.get("isRendering");
        applyDpiButton.disabled = isRendering;
        applyGpuSeedButton.disabled = isRendering;
        randomizeGpuSeedButton.disabled = isRendering;
        applyNprSeedButton.disabled = isRendering;
    });

    dpiInput.value = String(stateManager.get("dpi"));
    gpuSeedInput.value = String(stateManager.get("gpuSeed"));
    nprSeedInput.value = stateManager.get("nprSeed");

    applyDpiButton.addEventListener("click", async () => {
        const parsedDpi = parseInt(dpiInput.value, 10);
        const newDpi =
            Number.isFinite(parsedDpi) && parsedDpi > 0 ? parsedDpi : configuration.dpi;
        await stateManager.setState({
            dpi: newDpi,
            dimensions: computeDimensions(configuration, newDpi),
        });
    });

    randomizeGpuSeedButton.addEventListener("click", async () => {
        const randomSeed = Math.floor(Math.random() * 0x100000000);
        gpuSeedInput.value = String(randomSeed);
        console.log("Random GPU seed:", randomSeed);
        await stateManager.setState({ gpuSeed: randomSeed, nprIsDirty: true });
    });

    applyGpuSeedButton.addEventListener("click", async () => {
        const parsedInt = parseInt(gpuSeedInput.value, 10);
        const newSeed = Number.isNaN(parsedInt) ? configuration.gpuSeed : parsedInt;
        await stateManager.setState({ gpuSeed: newSeed, nprIsDirty: true });
    });

    applyNprSeedButton.addEventListener("click", async () => {
        const newSeed = nprSeedInput.value || configuration.nprSeed;
        await stateManager.setState({ nprSeed: newSeed });
        if (stateManager.get("nprIsDirty")) {
            await stateManager.setState({ nprIsDirty: false });
            await nprRenderer.render();
        }
    });

    await webgpuRenderer.renderFrameTiled();
    await nprRenderer.render();
}

/**
 * Boots the application once the DOM is ready.
 *
 * @typeParam TCpuData - Scene-specific CPU data payload type.
 * @param configuration - Runtime configuration values.
 */
export function bootstrapApplication<TCpuData>(
    configuration: AppRuntimeConfiguration<TCpuData>,
): void {
    const runSetup = (): void => {
        void setupApplication(configuration).catch((error) => {
            console.error("Application setup failed:", error);
        });
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", runSetup, { once: true });
    } else {
        runSetup();
    }
}
