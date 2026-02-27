import { NprRenderer } from "./renderers/npr-renderer";
import { WebGLRenderer } from "./renderers/webgl-renderer";
import { StateManager } from "./state-manager";
import type { AppState } from "./types/app-state";

// ======= Configuration =======
const widthCm = 60;
const heightCm = 60;
const dpi = 65;
const maxDebugSize = 1024;
const webglSeed = 0;
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
        webglSeed,
        nprSeed,
        dpi,
        dimensions: computeDimensions(dpi),
        visualizationMode: 0,
        nprIsDirty: false,
        isRendering: false,
    });

    const webglRenderer = new WebGLRenderer("debugCanvas", stateManager);
    const nprRenderer = new NprRenderer("outputCanvas", webglRenderer, stateManager);

    const dpiInput = getRequiredElement<HTMLInputElement>("dpi");
    const webglSeedInput = getRequiredElement<HTMLInputElement>("webglSeed");
    const nprSeedInput = getRequiredElement<HTMLInputElement>("nprSeed");

    const applyDpiButton = getRequiredElement<HTMLButtonElement>("applyDpi");
    const applyWebGLSeedButton = getRequiredElement<HTMLButtonElement>("applyWebGLSeed");
    const randomizeWebGLSeedButton =
        getRequiredElement<HTMLButtonElement>("randomizeWebGLSeed");
    const applyNprSeedButton = getRequiredElement<HTMLButtonElement>("applyNprSeed");

    stateManager.subscribe(["isRendering"], () => {
        const isRendering = stateManager.get("isRendering");
        applyDpiButton.disabled = isRendering;
        applyWebGLSeedButton.disabled = isRendering;
        randomizeWebGLSeedButton.disabled = isRendering;
        applyNprSeedButton.disabled = isRendering;
    });

    dpiInput.value = String(stateManager.get("dpi"));
    webglSeedInput.value = String(stateManager.get("webglSeed"));
    nprSeedInput.value = stateManager.get("nprSeed");

    applyDpiButton.addEventListener("click", async () => {
        const parsedDpi = parseInt(dpiInput.value, 10);
        const newDpi = Number.isFinite(parsedDpi) && parsedDpi > 0 ? parsedDpi : dpi;
        await stateManager.setState({
            dpi: newDpi,
            dimensions: computeDimensions(newDpi),
        });
    });

    randomizeWebGLSeedButton.addEventListener("click", async () => {
        const randomSeed = Math.floor(Math.random() * 0x100000000);
        webglSeedInput.value = String(randomSeed);
        console.log("Random WebGL seed:", randomSeed);
        await stateManager.setState({ webglSeed: randomSeed, nprIsDirty: true });
    });

    applyWebGLSeedButton.addEventListener("click", async () => {
        const parsedInt = parseInt(webglSeedInput.value, 10);
        const newSeed = Number.isNaN(parsedInt) ? webglSeed : parsedInt;
        await stateManager.setState({ webglSeed: newSeed, nprIsDirty: true });
    });

    applyNprSeedButton.addEventListener("click", async () => {
        const newSeed = nprSeedInput.value || nprSeed;
        await stateManager.setState({ nprSeed: newSeed });
        if (stateManager.get("nprIsDirty")) {
            await stateManager.setState({ nprIsDirty: false });
            await nprRenderer.render();
        }
    });

    await webglRenderer.renderLdzTiled();
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
