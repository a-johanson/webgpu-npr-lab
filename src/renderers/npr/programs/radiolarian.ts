import { LinearGradient, linearToSrgb, oklabToLinear } from "../../../npr/color";
import { FilmGrain } from "../../../npr/grain";
import { outlinesFromLDZ } from "../../../npr/outlines";
import { drawPolyline } from "../../../npr/polyline";
import { flowFieldStreamlines } from "../../../npr/streamlines";
import type { NprProgramModule, NprProgramRenderContext } from "../npr-program-module";

/**
 * NPR module for the radiolarian program.
 */
export class RadiolarianNprProgramModule implements NprProgramModule {
    readonly id = "radiolarian";

    /**
     * Renders the radiolarian NPR program from LDZ data.
     *
     * @param context - Render context values.
     */
    renderFromLdz(context: NprProgramRenderContext): void {
        const { ctx2d, ldzData, width, height, dpi, seed } = context;
        if (
            !Number.isFinite(width) ||
            !Number.isFinite(height) ||
            width <= 0 ||
            height <= 0 ||
            !Number.isFinite(dpi) ||
            dpi <= 0
        ) {
            throw new Error(
                `Invalid radiolarian render inputs: width=${String(width)}, height=${String(height)}, dpi=${String(dpi)}`,
            );
        }

        const pixelsPerMm = dpi / 25.4;

        const config = {
            dSepMax: 1.7 * pixelsPerMm,
            dSepShadowFactor: 0.3,
            gammaLuminance: 2.0,
            dTestFactor: 0.9,
            dStep: 0.3 * pixelsPerMm,
            maxDepthStep: 0.05,
            maxAccumAngle: Math.PI * 0.6,
            maxHatchedLuminance: 1.9,
            maxSteps: 750,
            minSteps: 10,
            orientationOffset: 0.0,
            maxAreaDeviation: 0.25,
        };

        const streamlines = flowFieldStreamlines(ldzData, width, height, seed, config);
        config.orientationOffset = (Math.PI / 180.0) * 30.0;
        config.maxHatchedLuminance = 0.25;
        const crosslines = flowFieldStreamlines(
            ldzData,
            width,
            height,
            `${seed}cross`,
            config,
        );
        const outlines = outlinesFromLDZ(ldzData, width, height, {
            maxAreaDeviation: config.maxAreaDeviation,
        });

        ctx2d.strokeStyle = "#000";
        ctx2d.lineWidth = 0.22 * pixelsPerMm;
        ctx2d.lineCap = "round";
        ctx2d.lineJoin = "round";

        const backgroundGradient = new LinearGradient([
            { position: 0.07, srgb: [0.106, 0.019, 0.134] },
            { position: 0.18, srgb: [0.282, 0.112, 0.302] },
            { position: 0.3, srgb: [0.729, 0.268, 0.396] },
            { position: 0.6, srgb: [0.921, 0.67, 0.582] },
        ]);
        const backgroundGrain = new FilmGrain({
            seed: `${seed}:background-grain`,
            pixelsPerMm,
            grainSizeMm: 0.2,
            lightnessAmplitude: 0.05,
            chromaAmplitude: 0.016,
            hueAmplitude: (1.2 * Math.PI) / 180.0,
            octaves: 3,
            persistence: 0.55,
            lacunarity: 2.0,
            minChromaForHueJitter: 0.025,
        });
        const rFill = Math.round(0.99 * 255);
        const gFill = Math.round(0.97 * 255);
        const bFill = Math.round(0.86 * 255);
        const imgData = ctx2d.createImageData(width, height, { colorSpace: "srgb" });
        const data = imgData.data;
        // const widthDenominator = Math.max(width - 1, 1);
        const heightDenominator = Math.max(height - 1, 1);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idxBase = ((height - 1 - y) * width + x) * 4;
                const z = ldzData[(y * width + x) * 4 + 3];
                if (z < 0.0) {
                    const t = y / heightDenominator;
                    const baseOklab = backgroundGradient.sampleOklab(t);
                    const jitteredOklab = backgroundGrain.applyToOklab(baseOklab, x, y);
                    const rgbBg = linearToSrgb(oklabToLinear(jitteredOklab));
                    data[idxBase] = Math.round(rgbBg[0] * 255);
                    data[idxBase + 1] = Math.round(rgbBg[1] * 255);
                    data[idxBase + 2] = Math.round(rgbBg[2] * 255);
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
}
