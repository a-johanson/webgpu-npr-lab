import { SpatialGrid } from "./grid";
import { createSeededRandom } from "./rand";

/**
 * A 2D point.
 */
type Point2 = [number, number];

/**
 * Stippling configuration.
 */
type StippleOptions = {
    rMin?: number;
    rMax?: number;
    gamma?: number;
    cellSize?: number;
    maxAttempts?: number;
};

/**
 * Generates Poisson-style stipples from LDZ data.
 *
 * @param ldzData - LDZ data.
 * @param width - Image width.
 * @param height - Image height.
 * @param rng - Random callback.
 * @param options - Sampling options.
 * @returns Stipple points.
 */
export function poissonStipplesFromLDZ(
    ldzData: Float32Array,
    width: number,
    height: number,
    rng: () => number,
    {
        rMin = 1.1,
        rMax = 5.5,
        gamma = 2.2,
        cellSize = 5.5,
        maxAttempts = 30,
    }: StippleOptions = {},
): Point2[] {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return [];
    }

    const safeCellSize = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 1.0;

    /**
     * Gets luminance and depth for a pixel position.
     *
     * @param x - X coordinate.
     * @param y - Y coordinate.
     * @returns Luminance and depth.
     */
    function luminanceAndZ(x: number, y: number): [number, number] {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const idx = (iy * width + ix) * 4;
        return [ldzData[idx], ldzData[idx + 3]];
    }

    /**
     * Computes sampling radius from luminance.
     *
     * @param luminance - Luminance value.
     * @returns Radius.
     */
    function radius(luminance: number): number {
        return rMin + (rMax - rMin) * luminance ** gamma;
    }

    const grid = new SpatialGrid(safeCellSize);
    const queue: Point2[] = [];

    for (let y = 0; y < height; y += safeCellSize) {
        for (let x = 0; x < width; x += safeCellSize) {
            const px = x + rng() * safeCellSize;
            const py = y + rng() * safeCellSize;
            if (px >= width || py >= height) continue;
            const [luminance, z] = luminanceAndZ(px, py);
            if (z < 0) continue;
            const r = radius(luminance);
            if (!grid.hasNearby(px, py, r)) {
                grid.addPoint(px, py);
                queue.push([px, py]);
            }
        }
    }

    let qi = 0;
    while (qi < queue.length) {
        const [qx, qy] = queue[qi];
        qi += 1;
        const [luminance] = luminanceAndZ(qx, qy);
        const r = radius(luminance);
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const angle = rng() * 2.0 * Math.PI;
            const dist = r * (1.0 + rng());
            const px = qx + Math.cos(angle) * dist;
            const py = qy + Math.sin(angle) * dist;
            if (px < 0 || px >= width || py < 0 || py >= height) continue;
            const [luminance2, z2] = luminanceAndZ(px, py);
            if (z2 < 0) continue;
            const r2 = radius(luminance2);
            if (!grid.hasNearby(px, py, r2)) {
                grid.addPoint(px, py);
                queue.push([px, py]);
            }
        }
    }

    return queue;
}

/**
 * Renders stipples from LDZ data.
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
            `Invalid stippling render inputs: width=${String(width)}, height=${String(height)}, dpi=${String(dpi)}`,
        );
    }

    const pixelsPerMm = dpi / 25.4;

    const rDot = 0.25 * pixelsPerMm;
    const rMin = 1.1 * rDot;
    const rMax = 5.1 * rDot;
    const gamma = 2.2;
    const cellSize = rMax;
    const maxAttempts = 30;

    const stipples = poissonStipplesFromLDZ(ldzData, width, height, createSeededRandom(seed), {
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
