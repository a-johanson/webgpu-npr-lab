import { prng_xor4096 } from '../../lib/esm-seedrandom/xor4096.js';
import { linearToOklab, oklabToLinear, srgbToLinear, linearToSrgb } from '../color.js';
import { outlinesFromLDZ } from '../outlines.js';
import { drawPolyline } from '../polyline.js';
import { flowFieldStreamlines } from '../streamlines.js';


export function renderFromLDZ(ctx2d, ldzData, width, height, dpi, seed) {
    const pixelsPerMm = dpi / 25.4;

    const config = {
        dSepMax: 2.7 * pixelsPerMm,
        dSepShadowFactor: 0.2,
        gammaLuminance: 2.0,
        dTestFactor: 1.1,
        dStep: 0.3 * pixelsPerMm,
        maxDepthStep: 0.02,
        maxAccumAngle: Math.PI * 0.6,
        maxHatchedLuminance: 1.9,
        maxSteps: 750,
        minSteps: 10,
        orientationOffset: 0.0,
        maxAreaDeviation: 0.25
    };

    const streamlines = flowFieldStreamlines(ldzData, width, height, seed, config);
    config.orientationOffset = Math.PI / 180.0 * 30.0;
    config.maxHatchedLuminance = 0.2475;
    const crosslines = flowFieldStreamlines(ldzData, width, height, seed + 'cross', config);
    const outlines = outlinesFromLDZ(ldzData, width, height, { maxAreaDeviation: config.maxAreaDeviation });

    ctx2d.strokeStyle = '#111';
    ctx2d.lineWidth = 0.18 * pixelsPerMm;
    ctx2d.lineCap = 'round';
    ctx2d.lineJoin = 'round';

    function mix(a, b, t) {
        t = Math.min(Math.max(t, 0.0), 1.0);
        return a.map((av, i) => av * (1.0 - t) + b[i] * t);
    }
    function clamp01(v) {
        return Math.min(Math.max(v, 0.0), 1.0);
    }
    const labBg1 = linearToOklab(srgbToLinear([0.0, 0.7, 0.95]));
    const labBg2 = linearToOklab(srgbToLinear([0.0, 0.0, 0.24]));
    const rFill = Math.round(0.99 * 255);
    const gFill = Math.round(0.95 * 255);
    const bFill = Math.round(0.85 * 255);
    const rng = prng_xor4096(seed + 'dithering');
    const imgData = ctx2d.createImageData(width, height, { colorSpace: 'srgb' });
    const data = imgData.data;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idxBase = ((height - 1 - y) * width + x) * 4;
            const z = ldzData[(y * width + x) * 4 + 3];
            if (z < 0.0) {
                const labBg = mix(labBg1, labBg2, Math.pow(0.1 * x / (width-1) + 0.9 * y / (height-1), 1.3));
                const rgbBg = linearToSrgb(oklabToLinear(labBg));
                const rb = clamp01(rgbBg[0] + (1.8 / 255.0) * (rng() + rng() - 1.0));
                const gb = clamp01(rgbBg[1] + (1.8 / 255.0) * (rng() + rng() - 1.0));
                const bb = clamp01(rgbBg[2] + (1.8 / 255.0) * (rng() + rng() - 1.0));
                data[idxBase] = Math.round(rb * 255);
                data[idxBase + 1] = Math.round(gb * 255);
                data[idxBase + 2] = Math.round(bb * 255);
            } else {
                data[idxBase] = rFill;
                data[idxBase + 1] = gFill;
                data[idxBase + 2] = bFill;
            }
            data[idxBase + 3] = 255;
        }
    }
    ctx2d.putImageData(imgData, 0, 0);

    for (const line of crosslines) {
        drawPolyline(ctx2d, line);
    }
    for (const line of streamlines) {
        drawPolyline(ctx2d, line);
    }
    for (const line of outlines) {
        drawPolyline(ctx2d, line, [0.5, 0.5]);
    }
}
