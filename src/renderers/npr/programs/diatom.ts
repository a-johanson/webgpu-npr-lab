import { LinearGradient } from "../../../npr/color";
import { outlinesFromLDZ } from "../../../npr/outlines";
import { drawPolyline } from "../../../npr/polyline";
import { createDerivedSeededRandom, createSeededRandom } from "../../../npr/rand";
import { flowFieldStreamlines } from "../../../npr/streamlines";
import type { NprProgramModule, NprProgramRenderContext } from "../npr-program-module";

/**
 * NPR module for the diatom program.
 */
export class DiatomNprProgramModule implements NprProgramModule {
    readonly id = "diatom";

    /**
     * Renders the diatom NPR program from LDZ data.
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
                `Invalid diatom render inputs: width=${String(width)}, height=${String(height)}, dpi=${String(dpi)}`,
            );
        }

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
            maxAreaDeviation: 0.25,
        };

        const streamlines = flowFieldStreamlines(
            ldzData,
            width,
            height,
            createSeededRandom(seed),
            config,
        );
        config.orientationOffset = (Math.PI / 180.0) * 30.0;
        config.maxHatchedLuminance = 0.2475;
        const crosslines = flowFieldStreamlines(
            ldzData,
            width,
            height,
            createDerivedSeededRandom(seed, "cross"),
            config,
        );
        const outlines = outlinesFromLDZ(ldzData, width, height, {
            maxAreaDeviation: config.maxAreaDeviation,
        });

        ctx2d.strokeStyle = "#111";
        ctx2d.lineWidth = 0.18 * pixelsPerMm;
        ctx2d.lineCap = "round";
        ctx2d.lineJoin = "round";

        const backgroundGradient = new LinearGradient([
            { position: 0.0, srgb: [0.0, 0.7, 0.95] },
            { position: 1.0, srgb: [0.0, 0.0, 0.24] },
        ]);
        const rFill = Math.round(0.99 * 255);
        const gFill = Math.round(0.95 * 255);
        const bFill = Math.round(0.85 * 255);
        const rng = createDerivedSeededRandom(seed, "dithering");
        const imgData = ctx2d.createImageData(width, height, { colorSpace: "srgb" });
        const data = imgData.data;
        const widthDenominator = Math.max(width - 1, 1);
        const heightDenominator = Math.max(height - 1, 1);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idxBase = ((height - 1 - y) * width + x) * 4;
                const z = ldzData[(y * width + x) * 4 + 3];
                if (z < 0.0) {
                    const rgbBg = backgroundGradient.sampleSrgbJittered(
                        ((0.1 * x) / widthDenominator + (0.9 * y) / heightDenominator) ** 1.3,
                        1.8 / 255.0,
                        rng,
                    );
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
