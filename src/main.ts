import { NprRenderer } from "./renderers/npr-renderer";
import { DiatomLdzSceneModule } from "./renderers/webgpu/scenes/diatom-scene";
import { WebGpuRenderer } from "./renderers/webgpu-renderer";
import { StateManager } from "./state-manager";
import type { AppState } from "./types/app-state";

// ======= Configuration =======
const widthCm = 60;
const heightCm = 60;
const dpi = 65;
const maxDebugSize = 1024;
const gpuSeed = 0;
const nprSeed = "52769ff2367023";
// =============================

/**
 * Computes render and debug dimensions from DPI.
 *
 * @param dpiValue - Target DPI.
 * @returns Dimension set.
 */
function computeDimensions(dpiValue: number): {
    width: number;
    height: number;
    debugWidth: number;
    debugHeight: number;
} {
    const aspectRatio = widthCm / heightCm;
    const dpcm = dpiValue / 2.54;

    const width = Math.round(widthCm * dpcm);
    const height = Math.round(heightCm * dpcm);

    const longestSide = Math.max(width, height);
    const debugScale = longestSide > maxDebugSize ? maxDebugSize / longestSide : 1.0;
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
 * Sets up the application state, DOM bindings, and initial render.
 */
async function setup(): Promise<void> {
    const stateManager = new StateManager<AppState>({
        gpuSeed,
        nprSeed,
        dpi,
        dimensions: computeDimensions(dpi),
        visualizationMode: 0,
        nprIsDirty: false,
        isRendering: false,
    });

    const webgpuRenderer = await WebGpuRenderer.create(
        "debugCanvas",
        stateManager,
        new DiatomLdzSceneModule(),
    );
    const nprRenderer = new NprRenderer("outputCanvas", webgpuRenderer, stateManager);

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
        const newDpi = Number.isFinite(parsedDpi) && parsedDpi > 0 ? parsedDpi : dpi;
        await stateManager.setState({
            dpi: newDpi,
            dimensions: computeDimensions(newDpi),
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
        const newSeed = Number.isNaN(parsedInt) ? gpuSeed : parsedInt;
        await stateManager.setState({ gpuSeed: newSeed, nprIsDirty: true });
    });

    applyNprSeedButton.addEventListener("click", async () => {
        const newSeed = nprSeedInput.value || nprSeed;
        await stateManager.setState({ nprSeed: newSeed });
        if (stateManager.get("nprIsDirty")) {
            await stateManager.setState({ nprIsDirty: false });
            await nprRenderer.render();
        }
    });

    await webgpuRenderer.renderLdzTiled();
    await nprRenderer.render();
}

/**
 * Starts setup once the DOM is ready.
 */
function bootstrap(): void {
    const runSetup = (): void => {
        void setup().catch((error) => {
            console.error("Application setup failed:", error);
        });
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", runSetup, { once: true });
    } else {
        runSetup();
    }
}

bootstrap();
