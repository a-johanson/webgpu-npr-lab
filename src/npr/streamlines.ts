import { SpatialGrid } from "./grid";
import { outlinesFromLDZ } from "./outlines";
import { drawPolyline, visvalingamWhyatt } from "./polyline";
import { createSeededRandom } from "./rand";

/**
 * A 2D point.
 */
type Point2 = [number, number];

/**
 * LDZ sample at a point.
 */
type LdzValue = { luminance: number; direction: Point2; depth: number };

/**
 * Streamline generation configuration.
 */
type StreamlineConfig = {
    dSepMax?: number;
    dSepShadowFactor?: number;
    gammaLuminance?: number;
    dTestFactor?: number;
    dStep?: number;
    maxDepthStep?: number;
    maxAccumAngle?: number;
    maxHatchedLuminance?: number;
    maxSteps?: number;
    minSteps?: number;
    orientationOffset?: number;
    maxAreaDeviation?: number;
};

/**
 * Computes separation distance from luminance.
 *
 * @param dSepMax - Maximum separation.
 * @param dSepShadowFactor - Shadow factor.
 * @param gammaLuminance - Luminance gamma.
 * @param luminance - Luminance value.
 * @returns Separation distance.
 */
function dSepFromLuminance(
    dSepMax: number,
    dSepShadowFactor: number,
    gammaLuminance: number,
    luminance: number,
): number {
    const dSepMin = dSepMax * dSepShadowFactor;
    return dSepMin + (dSepMax - dSepMin) * luminance ** gammaLuminance;
}

/**
 * Reads LDZ values at pixel coordinates.
 *
 * @param ldzData - LDZ data.
 * @param width - Image width.
 * @param height - Image height.
 * @param x - X coordinate.
 * @param y - Y coordinate.
 * @param orientationOffset - Optional orientation offset.
 * @returns LDZ value if in bounds.
 */
function getLdzValue(
    ldzData: Float32Array,
    width: number,
    height: number,
    x: number,
    y: number,
    orientationOffset = 0.0,
): LdzValue | undefined {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= width || iy < 0 || iy >= height) return undefined;
    const idx = (iy * width + ix) * 4;
    const luminance = ldzData[idx];
    const direction: Point2 = [ldzData[idx + 1], ldzData[idx + 2]];
    if (orientationOffset !== 0.0) {
        const cosOo = Math.cos(orientationOffset);
        const sinOo = Math.sin(orientationOffset);
        const dirX = direction[0] * cosOo - direction[1] * sinOo;
        const dirY = direction[0] * sinOo + direction[1] * cosOo;
        direction[0] = dirX;
        direction[1] = dirY;
    }
    const depth = ldzData[idx + 3];
    return { luminance, direction, depth };
}

/**
 * Traces a single streamline from a seed point.
 *
 * @param ldzData - LDZ data.
 * @param width - Image width.
 * @param height - Image height.
 * @param grid - Spatial occupancy grid.
 * @param pStart - Start point.
 * @param startFromStreamlineId - Parent streamline ID.
 * @param config - Streamline config.
 * @returns The traced streamline.
 */
function flowFieldStreamline(
    ldzData: Float32Array,
    width: number,
    height: number,
    grid: SpatialGrid,
    pStart: Point2,
    startFromStreamlineId: number,
    config: StreamlineConfig,
): Point2[] | null {
    const {
        dSepMax = 1.0,
        dSepShadowFactor = 0.5,
        gammaLuminance = 1.5,
        dTestFactor = 1.1,
        dStep = 1.0,
        maxDepthStep = 0.1,
        maxAccumAngle = Math.PI * 0.6,
        maxHatchedLuminance = 1.0,
        maxSteps = 200,
        minSteps = 10,
        orientationOffset = 0.0,
    } = config;

    const ldzStart = getLdzValue(
        ldzData,
        width,
        height,
        pStart[0],
        pStart[1],
        orientationOffset,
    );
    if (!ldzStart || ldzStart.depth < 0.0 || ldzStart.luminance > maxHatchedLuminance) {
        return null;
    }

    const dSepStart = dSepFromLuminance(
        dSepMax,
        dSepShadowFactor,
        gammaLuminance,
        ldzStart.luminance,
    );
    if (
        grid.hasNearby(
            pStart[0],
            pStart[1],
            dTestFactor * dSepStart,
            (tag) => tag !== startFromStreamlineId,
        )
    ) {
        return null;
    }

    /**
     * Continues streamline integration in one direction.
     *
     * @param lp0 - Start point.
     * @param direction0 - Start direction.
     * @param depth0 - Start depth.
     * @param step - Step size.
     * @param accumLimit - Maximum accumulated turning angle.
     * @param stepCount - Maximum number of integration steps.
     * @returns Traced half-line.
     */
    function continueLine(
        lp0: Point2,
        direction0: Point2,
        depth0: number,
        step: number,
        accumLimit: number,
        stepCount: number,
    ): Point2[] {
        const line: Point2[] = [];
        let lpLast = lp0;
        let nextDir = direction0;
        let lastDepth = depth0;
        let accumAngle = 0.0;

        for (let i = 0; i < stepCount; i++) {
            const pNew: Point2 = [
                lpLast[0] + nextDir[0] * step,
                lpLast[1] + nextDir[1] * step,
            ];
            const ldz = getLdzValue(
                ldzData,
                width,
                height,
                pNew[0],
                pNew[1],
                orientationOffset,
            );
            if (!ldz) break;

            const newDir = ldz.direction;
            const dot = Math.max(
                -1.0,
                Math.min(1.0, nextDir[0] * newDir[0] + nextDir[1] * newDir[1]),
            );
            accumAngle += Math.acos(dot);
            const dSep = dSepFromLuminance(
                dSepMax,
                dSepShadowFactor,
                gammaLuminance,
                ldz.luminance,
            );
            const r = dTestFactor * dSep;

            if (
                ldz.depth < 0.0 ||
                accumAngle > accumLimit ||
                Math.abs(ldz.depth - lastDepth) > maxDepthStep ||
                ldz.luminance > maxHatchedLuminance ||
                grid.hasNearby(pNew[0], pNew[1], r)
            ) {
                break;
            }

            line.push(pNew);
            lpLast = pNew;
            nextDir = ldz.direction;
            lastDepth = ldz.depth;
        }
        return line;
    }

    const fwd = continueLine(
        pStart,
        ldzStart.direction,
        ldzStart.depth,
        dStep,
        0.5 * maxAccumAngle,
        Math.floor(maxSteps / 2),
    );
    const bwd = continueLine(
        pStart,
        ldzStart.direction,
        ldzStart.depth,
        -dStep,
        0.5 * maxAccumAngle,
        Math.floor(maxSteps / 2),
    );

    const line = bwd.reverse().concat([pStart]).concat(fwd);
    return line.length > minSteps + 1 ? line : null;
}

/**
 * Generates streamlines for a flow field.
 *
 * @param ldzData - LDZ data.
 * @param width - Image width.
 * @param height - Image height.
 * @param rng - Random callback.
 * @param config - Streamline config.
 * @returns Streamlines.
 */
export function flowFieldStreamlines(
    ldzData: Float32Array,
    width: number,
    height: number,
    rng: () => number,
    config: StreamlineConfig,
): Point2[][] {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return [];
    }

    const {
        dSepMax = 1.0,
        dSepShadowFactor = 0.5,
        gammaLuminance = 1.5,
        orientationOffset = 0.0,
        maxAreaDeviation = 0.25,
    } = config;

    const safeSeparation = Number.isFinite(dSepMax) && dSepMax > 0 ? dSepMax : 1.0;

    const grid = new SpatialGrid(safeSeparation);
    const queue: Array<{ sid: number; line: Point2[] }> = [];
    const streamlines: Point2[][] = [];
    let streamlineIdCounter = 1;

    const seedBoxSize = Math.max(1, Math.ceil(safeSeparation));
    const cellCountX = Math.max(1, Math.floor(width / seedBoxSize));
    const cellCountY = Math.max(1, Math.floor(height / seedBoxSize));
    const cellWidth = width / cellCountX;
    const cellHeight = height / cellCountY;

    for (let iy = 0; iy < cellCountY; iy++) {
        for (let ix = 0; ix < cellCountX; ix++) {
            const sx = cellWidth * (ix + rng());
            const sy = cellHeight * (iy + rng());
            const sl = flowFieldStreamline(ldzData, width, height, grid, [sx, sy], 0, config);
            if (sl) {
                const sid = streamlineIdCounter;
                streamlineIdCounter += 1;
                sl.forEach((p) => {
                    grid.addPoint(p[0], p[1], sid);
                });
                queue.push({ sid, line: sl });
                streamlines.push(visvalingamWhyatt(sl, maxAreaDeviation));
            }
        }
    }

    while (queue.length > 0) {
        const shifted = queue.shift();
        if (!shifted) {
            continue;
        }
        const { sid, line } = shifted;
        for (const lp of line) {
            const ldz = getLdzValue(ldzData, width, height, lp[0], lp[1], orientationOffset);
            if (!ldz) {
                continue;
            }
            const dSep = dSepFromLuminance(
                dSepMax,
                dSepShadowFactor,
                gammaLuminance,
                ldz.luminance,
            );
            for (const sign of [-1.0, 1.0]) {
                const newSeed: Point2 = [
                    lp[0] - ldz.direction[1] * sign * dSep,
                    lp[1] + ldz.direction[0] * sign * dSep,
                ];
                const newSl = flowFieldStreamline(
                    ldzData,
                    width,
                    height,
                    grid,
                    newSeed,
                    sid,
                    config,
                );
                if (newSl) {
                    const newSid = streamlineIdCounter;
                    streamlineIdCounter += 1;
                    newSl.forEach((p) => {
                        grid.addPoint(p[0], p[1], newSid);
                    });
                    queue.push({ sid: newSid, line: newSl });
                    streamlines.push(visvalingamWhyatt(newSl, maxAreaDeviation));
                }
            }
        }
    }

    return streamlines;
}

/**
 * Renders flow field streamlines from LDZ data.
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
            `Invalid streamline render inputs: width=${String(width)}, height=${String(height)}, dpi=${String(dpi)}`,
        );
    }

    const pixelsPerMm = dpi / 25.4;

    const config: StreamlineConfig = {
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
    const outlines = outlinesFromLDZ(ldzData, width, height, {
        maxAreaDeviation: config.maxAreaDeviation,
    });

    ctx2d.fillStyle = "#fff";
    ctx2d.fillRect(0, 0, width, height);
    ctx2d.strokeStyle = "#111";
    ctx2d.lineWidth = 0.18 * pixelsPerMm;
    ctx2d.lineCap = "round";
    ctx2d.lineJoin = "round";

    for (const line of streamlines) {
        drawPolyline(ctx2d, line);
    }
    for (const line of outlines) {
        drawPolyline(ctx2d, line, [0.5, 0.5]);
    }
}
