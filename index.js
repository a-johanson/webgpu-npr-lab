import { StateManager } from './state-manager.js';
import { WebGLRenderer } from './renderers/webgl-renderer.js';
import { NprRenderer } from './renderers/npr-renderer.js';

// ======= Configuration =======
const widthCm = 60;
const heightCm = 60;
const dpi = 65;
const maxDebugSize = 1024;
const webglSeed = 0;
const nprSeed = '52769ff2367023';
// =============================


function computeDimensions(dpi) {
    const aspectRatio = widthCm / heightCm;
    const dpcm = dpi / 2.54;

    const width = Math.round(widthCm * dpcm);
    const height = Math.round(heightCm * dpcm);

    const longestSide = Math.max(width, height);
    const debugScale = longestSide > maxDebugSize ? maxDebugSize / longestSide : 1.0;
    const debugWidth = debugScale * width;
    const debugHeight = Math.round(debugWidth / aspectRatio);

    return { width, height, debugWidth, debugHeight };
}


const stateManager = new StateManager({
    webglSeed,
    nprSeed,
    dpi,
    dimensions: computeDimensions(dpi),
    visualizationMode: 0,
    nprIsDirty: false,
    isRendering: false
});

const webglRenderer = new WebGLRenderer('debugCanvas', stateManager);
const nprRenderer = new NprRenderer('outputCanvas', webglRenderer, stateManager);

const dpiInput = document.getElementById('dpi');
const webglSeedInput = document.getElementById('webglSeed');
const nprSeedInput = document.getElementById('nprSeed');

const applyDpiButton = document.getElementById('applyDpi');
const applyWebGLSeedButton = document.getElementById('applyWebGLSeed');
const randomizeWebGLSeedButton = document.getElementById('randomizeWebGLSeed');
const applyNprSeedButton = document.getElementById('applyNprSeed');

stateManager.subscribe(['isRendering'], () => {
    const isRendering = stateManager.get('isRendering');
    applyDpiButton.disabled = isRendering;
    applyWebGLSeedButton.disabled = isRendering;
    randomizeWebGLSeedButton.disabled = isRendering;
    applyNprSeedButton.disabled = isRendering;
});

dpiInput.value = String(stateManager.get('dpi'));
webglSeedInput.value = String(stateManager.get('webglSeed'));
nprSeedInput.value = stateManager.get('nprSeed');

applyDpiButton.addEventListener('click', async () => {
    const newDpi = parseInt(dpiInput.value) || dpi;
    await stateManager.setState({
        dpi: newDpi,
        dimensions: computeDimensions(newDpi)
    });
});

randomizeWebGLSeedButton.addEventListener('click', async () => {
    const randomSeed = Math.floor(Math.random() * 0x100000000);
    webglSeedInput.value = String(randomSeed);
    console.log('Random WebGL seed:', randomSeed);
    await stateManager.setState({ webglSeed: randomSeed, nprIsDirty: true });
});

applyWebGLSeedButton.addEventListener('click', async () => {
    const parsedInt = parseInt(webglSeedInput.value);
    const newSeed = Number.isNaN(parsedInt) ? webglSeed : parsedInt;
    await stateManager.setState({ webglSeed: newSeed, nprIsDirty: true });
});

applyNprSeedButton.addEventListener('click', async () => {
    const newSeed = nprSeedInput.value || nprSeed;
    await stateManager.setState({ nprSeed: newSeed });
    if (stateManager.get('nprIsDirty')) {
        await stateManager.setState({ nprIsDirty: false });
        await nprRenderer.render();
    }
});

await webglRenderer.renderLdzTiled();
await nprRenderer.render();
