import { poissonStipplesFromLDZ } from "../stippling";

/**
 * Renders the crystal NPR program from LDZ data.
 *
 * @param ctx2d - 2D rendering context.
 * @param ldzData - LDZ data.
 * @param width - Image width.
 * @param height - Image height.
 * @param dpi - Render DPI.
 * @param seed - RNG seed.
 */
export function renderFromLDZ(
    ctx2d: CanvasRenderingContext2D,
    ldzData: Float32Array,
    width: number,
    height: number,
    dpi: number,
    seed: string,
): void {
    if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0 ||
        !Number.isFinite(dpi) ||
        dpi <= 0
    ) {
        throw new Error(
            `Invalid crystal render inputs: width=${String(width)}, height=${String(height)}, dpi=${String(dpi)}`,
        );
    }

    const pixelsPerMm = dpi / 25.4;

    const rDot = 0.25 * pixelsPerMm;
    const rMin = 1.2 * rDot;
    const rMax = 5.1 * rDot;
    const gamma = 1.8;
    const cellSize = rMax;
    const maxAttempts = 30;

    const stipples = poissonStipplesFromLDZ(ldzData, width, height, seed, {
        rMin,
        rMax,
        gamma,
        cellSize,
        maxAttempts,
    });

    ctx2d.save();
    ctx2d.fillStyle = "#fff";
    ctx2d.fillRect(0, 0, width, height);
    ctx2d.fillStyle = "#222";
    for (const [x, y] of stipples) {
        ctx2d.beginPath();
        ctx2d.arc(x, y, rDot, 0, 2 * Math.PI);
        ctx2d.fill();
    }
    ctx2d.restore();
}
