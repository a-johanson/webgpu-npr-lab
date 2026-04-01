import { createSeededRandom } from "../../../npr/rand";
import { poissonStipplesFromLDZ } from "../../../npr/stippling";
import type { NprProgramModule, NprProgramRenderContext } from "../npr-program-module";

/**
 * NPR module for the shell program.
 */
export class ShellNprProgramModule implements NprProgramModule {
    readonly id = "shell";

    public static readonly WIDTH_CM = 50;
    public static readonly HEIGHT_CM = 50;
    public static readonly NPR_SEED = "shell-1";

    /**
     * Renders the shell NPR program from LDZ data.
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
                `Invalid shell render inputs: width=${String(width)}, height=${String(height)}, dpi=${String(dpi)}`,
            );
        }
        if (!colorData) {
            throw new Error("Shell program requires colorData from the GPU scene output");
        }

        const pixelsPerMm = dpi / 25.4;

        const rDot = 0.25 * pixelsPerMm;
        const rMin = 1.1 * rDot;
        const rMax = 5.1 * rDot;
        const gamma = 2.2;
        const cellSize = rMax;
        const maxAttempts = 30;

        const stipples = poissonStipplesFromLDZ(
            ldzData,
            width,
            height,
            createSeededRandom(seed),
            {
                rMin,
                rMax,
                gamma,
                cellSize,
                maxAttempts,
            },
        );

        ctx2d.save();
        const imgData = ctx2d.createImageData(width, height, { colorSpace: "srgb" });
        imgData.data.set(colorData);
        ctx2d.putImageData(imgData, 0, 0);
        ctx2d.fillStyle = "#222";
        for (const [x, y] of stipples) {
            ctx2d.beginPath();
            ctx2d.arc(x, y, rDot, 0, 2 * Math.PI);
            ctx2d.fill();
        }
        ctx2d.restore();
    }
}
