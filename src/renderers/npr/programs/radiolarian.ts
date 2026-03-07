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

        const imgData = ctx2d.createImageData(width, height, { colorSpace: "srgb" });
        const data = imgData.data;
        data.set(colorData);
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
