import { outlinesFromLDZ } from "../../../npr/outlines";
import { drawPolylineWithCircles } from "../../../npr/polyline";
import { createDerivedSeededRandom, createSeededRandom } from "../../../npr/rand";
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
        const { ctx2d, ldzData, colorData, width, height, dpi, seed } = context;
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
        if (!colorData) {
            throw new Error(
                "Radiolarian program requires colorData from the GPU scene output",
            );
        }

        const pixelsPerMm = dpi / 25.4;

        const config = {
            dSepMax: 2.0 * pixelsPerMm,
            dSepShadowFactor: 0.4,
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

        const streamlines = flowFieldStreamlines(
            ldzData,
            width,
            height,
            createSeededRandom(seed),
            config,
        );
        config.orientationOffset = (Math.PI / 180.0) * 30.0;
        config.maxHatchedLuminance = 0.25;
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

        ctx2d.strokeStyle = "#000";
        ctx2d.fillStyle = "#000";
        ctx2d.lineWidth = 0.22 * pixelsPerMm;
        ctx2d.lineCap = "round";
        ctx2d.lineJoin = "round";

        const circleRadius = 0.8 * ctx2d.lineWidth;
        const circleOptions = {
            radius: circleRadius,
            spacing: 0.6 * ctx2d.lineWidth,
            radiusJitter: 0.4 * ctx2d.lineWidth,
            normalOffsetJitter: 0.3 * ctx2d.lineWidth,
        };

        const imgData = ctx2d.createImageData(width, height, { colorSpace: "srgb" });
        const data = imgData.data;
        data.set(colorData);
        ctx2d.putImageData(imgData, 0, 0);

        const inkRandom = createDerivedSeededRandom(seed, "ink");

        for (const line of crosslines) {
            drawPolylineWithCircles(ctx2d, line, inkRandom, circleOptions);
        }
        for (const line of streamlines) {
            drawPolylineWithCircles(ctx2d, line, inkRandom, circleOptions);
        }
        for (const line of outlines) {
            drawPolylineWithCircles(ctx2d, line, inkRandom, circleOptions, [0.5, 0.5]);
        }
    }
}
