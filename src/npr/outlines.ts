import {
    drawPolyline,
    drawPolylinePoints,
    laplacianSmoothing,
    normalizedCurvaturesFromAngle,
    stitchSegmentsToPolylines,
    visvalingamWhyatt,
} from "./polyline";

/**
 * A 2D point.
 */
type Point2 = [number, number];

/**
 * Generates a Laplacian of Gaussian kernel.
 *
 * @param sigma - Standard deviation.
 * @param radius - Kernel radius.
 * @returns Kernel data and dimensions.
 */
function logKernel(
    sigma: number,
    radius = Math.ceil(3.0 * sigma),
): {
    kernel: Float32Array;
    size: number;
    radius: number;
} {
    const size = radius * 2.0 + 1.0;
    const sigma2 = sigma * sigma;
    const sigma4 = sigma2 * sigma2;
    const kernel = new Float32Array(size * size);
    let sum = 0.0;
    for (let j = -radius; j <= radius; j++) {
        for (let i = -radius; i <= radius; i++) {
            const r2 = i * i + j * j;
            const val = ((r2 - 2.0 * sigma2) / sigma4) * Math.exp(-r2 / (2.0 * sigma2));
            kernel[(j + radius) * size + (i + radius)] = val;
            sum += val;
        }
    }
    const mean = sum / (size * size);
    for (let k = 0; k < kernel.length; k++) kernel[k] -= mean;
    return { kernel, size, radius };
}

/**
 * Convolves a single channel from an interleaved source image.
 *
 * @param src - Source LDZ data.
 * @param offset - Channel offset.
 * @param stride - Pixel stride.
 * @param width - Image width.
 * @param height - Image height.
 * @param kernel - Convolution kernel.
 * @param kSize - Kernel size.
 * @param kRadius - Kernel radius.
 * @returns Filtered scalar field.
 */
function convolve2D(
    src: Float32Array,
    offset: number,
    stride: number,
    width: number,
    height: number,
    kernel: Float32Array,
    kSize: number,
    kRadius: number,
): Float32Array {
    const dst = new Float32Array(width * height);
    /**
     * Reflects an index into bounds.
     *
     * @param idx - Input index.
     * @param limit - Upper bound.
     * @returns Reflected index.
     */
    const reflect = (idx: number, limit: number): number => {
        if (idx < 0) return -idx - 1;
        if (idx >= limit) return 2 * limit - idx - 1;
        return idx;
    };

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let sum = 0.0;
            for (let ky = -kRadius; ky <= kRadius; ky++) {
                const sy = reflect(y + ky, height);
                const kRow = (ky + kRadius) * kSize;
                const srcRow = sy * width;
                for (let kx = -kRadius; kx <= kRadius; kx++) {
                    const sx = reflect(x + kx, width);
                    const kval = kernel[kRow + (kx + kRadius)];
                    sum += src[(srcRow + sx) * stride + offset] * kval;
                }
            }
            dst[y * width + x] = sum;
        }
    }
    return dst;
}

/**
 * Extracts zero-crossing contour segments via marching squares.
 *
 * @param lap - Scalar field.
 * @param width - Field width.
 * @param height - Field height.
 * @param threshold - Crossing threshold.
 * @returns Segment list.
 */
function marchingSquaresZeroCrossing(
    lap: Float32Array,
    width: number,
    height: number,
    threshold = 1e-3,
): Array<[Point2, Point2]> {
    /**
     * Tests if two values have a robust zero crossing.
     *
     * @param v1 - First value.
     * @param v2 - Second value.
     * @returns True when crossing exists.
     */
    function edgeHasZeroCrossing(v1: number, v2: number): boolean {
        return v1 * v2 < 0.0 && Math.abs(v1 - v2) > threshold;
    }

    /**
     * Interpolates a zero-crossing position on an edge.
     *
     * @param v1 - First scalar value.
     * @param v2 - Second scalar value.
     * @param x1 - First X.
     * @param y1 - First Y.
     * @param x2 - Second X.
     * @param y2 - Second Y.
     * @returns Interpolated point.
     */
    function interpolateZeroCrossing(
        v1: number,
        v2: number,
        x1: number,
        y1: number,
        x2: number,
        y2: number,
    ): Point2 {
        const t = v1 / (v1 - v2);
        return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
    }

    const segments: Array<[Point2, Point2]> = [];

    for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
            const a = lap[y * width + x];
            const b = lap[y * width + (x + 1)];
            const c = lap[(y + 1) * width + x];
            const d = lap[(y + 1) * width + (x + 1)];

            const pts: Point2[] = [];

            if (edgeHasZeroCrossing(a, b)) {
                pts.push(interpolateZeroCrossing(a, b, x, y, x + 1, y));
            }

            if (edgeHasZeroCrossing(b, d)) {
                pts.push(interpolateZeroCrossing(b, d, x + 1, y, x + 1, y + 1));
            }

            if (edgeHasZeroCrossing(c, d)) {
                pts.push(interpolateZeroCrossing(c, d, x, y + 1, x + 1, y + 1));
            }

            if (edgeHasZeroCrossing(a, c)) {
                pts.push(interpolateZeroCrossing(a, c, x, y, x, y + 1));
            }

            if (pts.length === 2) {
                segments.push([pts[0], pts[1]]);
            } else if (pts.length === 4) {
                const s = a * d - b * c;
                if (s > 0) {
                    segments.push([pts[0], pts[1]]);
                    segments.push([pts[2], pts[3]]);
                } else {
                    segments.push([pts[0], pts[3]]);
                    segments.push([pts[2], pts[1]]);
                }
            }
        }
    }

    return segments;
}

/**
 * Options for outline extraction.
 */
type OutlineOptions = {
    logSigma?: number;
    marchingSquaresThreshold?: number;
    minSegmentCount?: number;
    curvatureWindow?: number;
    minAngleDeg?: number;
    maxAngleDeg?: number;
    laplaceLambdaMax?: number;
    laplaceIterations?: number;
    laplaceWindow?: number;
    maxAreaDeviation?: number;
};

/**
 * Computes smoothed outlines from LDZ data.
 *
 * @param ldzData - LDZ pixel data.
 * @param width - Image width.
 * @param height - Image height.
 * @param options - Processing options.
 * @returns Outline polylines.
 */
export function outlinesFromLDZ(
    ldzData: Float32Array,
    width: number,
    height: number,
    {
        logSigma = 0.7,
        marchingSquaresThreshold = 0.6,
        minSegmentCount = 25,
        curvatureWindow = 10,
        minAngleDeg = 15.0,
        maxAngleDeg = 100.0,
        laplaceLambdaMax = 0.8,
        laplaceIterations = 3,
        laplaceWindow = 4,
        maxAreaDeviation = 0.25,
    }: OutlineOptions = {},
): Point2[][] {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return [];
    }

    const logk = logKernel(logSigma);
    const lap = convolve2D(ldzData, 3, 4, width, height, logk.kernel, logk.size, logk.radius);
    const segments = marchingSquaresZeroCrossing(lap, width, height, marchingSquaresThreshold);
    return stitchSegmentsToPolylines(segments)
        .filter((poly) => poly.length >= minSegmentCount)
        .map((poly) => {
            const curvatures = normalizedCurvaturesFromAngle(
                poly,
                curvatureWindow,
                minAngleDeg,
                maxAngleDeg,
            );
            const smoothed = laplacianSmoothing(
                poly,
                curvatures,
                laplaceLambdaMax,
                laplaceIterations,
                laplaceWindow,
            );
            if (maxAreaDeviation > 0.0) {
                return visvalingamWhyatt(smoothed, maxAreaDeviation);
            }
            return smoothed;
        });
}

/**
 * Renders extracted outlines for LDZ data.
 *
 * @param ctx2d - 2D rendering context.
 * @param ldzData - LDZ data.
 * @param width - Image width.
 * @param height - Image height.
 * @param dpi - Render DPI.
 * @param seed - Render seed.
 */
export function renderFromLDZ(
    ctx2d: CanvasRenderingContext2D,
    ldzData: Float32Array,
    width: number,
    height: number,
    dpi: number,
    seed: string,
): void {
    void dpi;
    void seed;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error(
            `Invalid outline render dimensions: width=${String(width)}, height=${String(height)}`,
        );
    }
    const outlines = outlinesFromLDZ(ldzData, width, height);

    ctx2d.fillStyle = "#fff";
    ctx2d.fillRect(0, 0, width, height);
    ctx2d.strokeStyle = "#000";
    ctx2d.fillStyle = "#D00";
    ctx2d.lineWidth = 1.0;
    ctx2d.lineCap = "round";
    ctx2d.lineJoin = "round";

    outlines.forEach((outline) => {
        drawPolyline(ctx2d, outline, [0.5, 0.5]);
        drawPolylinePoints(ctx2d, outline, 2.0, [0.5, 0.5]);
    });
}
