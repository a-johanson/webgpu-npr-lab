import { MinHeap } from "./heap";

/**
 * A 2D point.
 */
type Point2 = [number, number];

/**
 * Draws a polyline.
 *
 * @param ctx2d - 2D rendering context.
 * @param points - Polyline points.
 * @param offset - Coordinate offset.
 */
export function drawPolyline(
    ctx2d: CanvasRenderingContext2D,
    points: Point2[],
    offset: Point2 = [0.0, 0.0],
): void {
    if (points.length === 0) return;
    const [xOffset, yOffset] = offset;
    ctx2d.beginPath();
    ctx2d.moveTo(points[0][0] + xOffset, points[0][1] + yOffset);
    for (let i = 1; i < points.length; i++) {
        ctx2d.lineTo(points[i][0] + xOffset, points[i][1] + yOffset);
    }
    ctx2d.stroke();
}

/**
 * Draws points along a polyline.
 *
 * @param ctx2d - 2D rendering context.
 * @param points - Polyline points.
 * @param radius - Point radius.
 * @param offset - Coordinate offset.
 * @param values - Optional scalar values for color coding.
 */
export function drawPolylinePoints(
    ctx2d: CanvasRenderingContext2D,
    points: Point2[],
    radius = 2.0,
    offset: Point2 = [0.0, 0.0],
    values: number[] | null = null,
): void {
    const [xOffset, yOffset] = offset;
    for (let i = 0; i < points.length; i++) {
        if (values) {
            const hue = Math.floor(240 - 240 * Math.max(0.0, Math.min(1.0, values[i])));
            ctx2d.fillStyle = `hsl(${hue}, 100%, 50%)`;
        }
        ctx2d.beginPath();
        ctx2d.arc(points[i][0] + xOffset, points[i][1] + yOffset, radius, 0, 2 * Math.PI);
        ctx2d.fill();
    }
}

/**
 * Segment endpoint linkage metadata.
 */
type EndpointLink = { other: Point2; segIndex: number };

/**
 * Stitches line segments into polylines.
 *
 * @param segments - Segment list.
 * @returns A list of stitched polylines.
 */
export function stitchSegmentsToPolylines(segments: Array<[Point2, Point2]>): Point2[][] {
    /**
     * Quantizes a point to a hash key.
     *
     * @param p - Point.
     * @returns Quantized key.
     */
    function keyForPoint(p: Point2): string {
        const eps_inv = 1000.0;
        const q = (v: number): number => Math.round(v * eps_inv);
        return `${q(p[0])};${q(p[1])}`;
    }

    const endpointMap = new Map<string, EndpointLink[]>();

    segments.forEach(([p0, p1], i) => {
        const k0 = keyForPoint(p0);
        const k1 = keyForPoint(p1);
        if (!endpointMap.has(k0)) endpointMap.set(k0, []);
        if (!endpointMap.has(k1)) endpointMap.set(k1, []);
        endpointMap.get(k0)?.push({ other: p1, segIndex: i });
        endpointMap.get(k1)?.push({ other: p0, segIndex: i });
    });

    const used = new Array(segments.length).fill(false);
    const polylines: Point2[][] = [];

    for (let i = 0; i < segments.length; i++) {
        if (used[i]) continue;
        const [a, b] = segments[i];
        used[i] = true;
        const poly: Point2[] = [
            [a[0], a[1]],
            [b[0], b[1]],
        ];

        let endKey = keyForPoint(b);
        while (true) {
            const neighbors = endpointMap.get(endKey) || [];
            let found: { nb: EndpointLink; segIdx: number } | null = null;
            for (const nb of neighbors) {
                const segIdx = nb.segIndex;
                if (!used[segIdx]) {
                    found = { nb, segIdx };
                    break;
                }
            }
            if (!found) break;
            const nextPt = found.nb.other;
            used[found.segIdx] = true;
            poly.push([nextPt[0], nextPt[1]]);
            endKey = keyForPoint(nextPt);
        }

        let startKey = keyForPoint(a);
        while (true) {
            const neighbors = endpointMap.get(startKey) || [];
            let found: { nb: EndpointLink; segIdx: number } | null = null;
            for (const nb of neighbors) {
                const segIdx = nb.segIndex;
                if (!used[segIdx]) {
                    found = { nb, segIdx };
                    break;
                }
            }
            if (!found) break;
            const nextPt = found.nb.other;
            used[found.segIdx] = true;
            poly.unshift([nextPt[0], nextPt[1]]);
            startKey = keyForPoint(nextPt);
        }

        polylines.push(poly);
    }

    return polylines;
}

/**
 * Computes normalized curvature values based on turning angle.
 *
 * @param points - Polyline points.
 * @param window - Neighborhood window.
 * @param minAngleDeg - Angle mapped to 0.
 * @param maxAngleDeg - Angle mapped to 1.
 * @returns Curvature values in [0, 1].
 */
export function normalizedCurvaturesFromAngle(
    points: Point2[],
    window = 10,
    minAngleDeg = 15.0,
    maxAngleDeg = 90.0,
): number[] {
    const n = points.length;
    const curvatures = new Array(n).fill(0.0);
    if (n < 3) return curvatures;

    const minAngle = (Math.PI * minAngleDeg) / 180.0;
    const maxAngle = (Math.PI * maxAngleDeg) / 180.0;
    for (let i = 1; i < n - 1; i++) {
        const start = Math.max(0, i - window);
        const end = Math.min(n - 1, i + window);
        const v1: Point2 = [points[i][0] - points[start][0], points[i][1] - points[start][1]];
        const v2: Point2 = [points[end][0] - points[i][0], points[end][1] - points[i][1]];
        const len1 = Math.hypot(v1[0], v1[1]);
        const len2 = Math.hypot(v2[0], v2[1]);
        if (len1 < 1e-9 || len2 < 1e-9) {
            curvatures[i] = 0.0;
            continue;
        }
        const dot = (v1[0] * v2[0] + v1[1] * v2[1]) / (len1 * len2);
        const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));
        const weight = end - start < 2 * window + 1 ? (end - start) / (2 * window + 1) : 1.0;
        if (angle <= minAngle) {
            curvatures[i] = 0.0;
        } else if (angle >= maxAngle) {
            curvatures[i] = 1.0 * weight;
        } else {
            curvatures[i] = (weight * (angle - minAngle)) / (maxAngle - minAngle);
        }
    }

    return curvatures;
}

/**
 * Applies curvature-aware Laplacian smoothing.
 *
 * @param points - Polyline points.
 * @param curvatures - Curvature values.
 * @param lambdaMax - Maximum smoothing factor.
 * @param passes - Number of passes.
 * @param window - Neighborhood window.
 * @returns Smoothed points.
 */
export function laplacianSmoothing(
    points: Point2[],
    curvatures: number[],
    lambdaMax = 0.5,
    passes = 1,
    window = 1,
): Point2[] {
    const n = points.length;
    if (n < 3) return points.slice();
    let dest = points.slice();
    let src: Point2[] = new Array(n);

    for (let pass = 0; pass < passes; pass++) {
        const tmp = src;
        src = dest;
        dest = tmp;
        dest[0] = [src[0][0], src[0][1]];
        dest[n - 1] = [src[n - 1][0], src[n - 1][1]];

        for (let i = 1; i < n - 1; i++) {
            const start = Math.max(0, i - window);
            const end = Math.min(n - 1, i + window);
            let sumX = 0.0;
            let sumY = 0.0;
            let count = 0;
            for (let k = start; k <= end; k++) {
                if (k === i) continue;
                sumX += src[k][0];
                sumY += src[k][1];
                count += 1;
            }
            const lambda = lambdaMax * (1.0 - curvatures[i]);
            dest[i] = [
                (1.0 - lambda) * src[i][0] + lambda * (sumX / count),
                (1.0 - lambda) * src[i][1] + lambda * (sumY / count),
            ];
        }
    }

    return dest;
}

/**
 * Heap entry for Visvalingam-Whyatt simplification.
 */
type VwHeapEntry = { area: number; idx: number; version: number };

/**
 * Point metadata for Visvalingam-Whyatt simplification.
 */
type VwPointMeta = { area: number; version: number; prev: number | null; next: number | null };

/**
 * Simplifies a polyline with the Visvalingam-Whyatt algorithm.
 *
 * @param points - Polyline points.
 * @param maxArea - Removal threshold.
 * @returns Simplified polyline.
 */
export function visvalingamWhyatt(points: Point2[], maxArea: number): Point2[] {
    /**
     * Computes triangle area.
     *
     * @param p1 - First point.
     * @param p2 - Second point.
     * @param p3 - Third point.
     * @returns Triangle area.
     */
    function triangleArea(p1: Point2, p2: Point2, p3: Point2): number {
        const ax = p2[0] - p1[0];
        const ay = p2[1] - p1[1];
        const bx = p3[0] - p1[0];
        const by = p3[1] - p1[1];
        return 0.5 * Math.abs(ax * by - ay * bx);
    }

    if (!points || points.length < 3 || !(maxArea > 0)) {
        return points ? points.slice() : [];
    }

    const n = points.length;
    const isDeleted = new Array(n).fill(false);
    let activeCount = n;

    const pointMetadata: VwPointMeta[] = new Array(n);
    const heap = new MinHeap<VwHeapEntry>((a, b) => a.area - b.area);

    const INF = Number.POSITIVE_INFINITY;

    for (let i = 0; i < n; i++) {
        const prev = i > 0 ? i - 1 : null;
        const next = i < n - 1 ? i + 1 : null;
        if (i > 0 && i < n - 1) {
            const area = triangleArea(points[i - 1], points[i], points[i + 1]);
            pointMetadata[i] = { area, version: 0, prev, next };
            heap.push({ area, idx: i, version: 0 });
        } else {
            pointMetadata[i] = { area: INF, version: 0, prev, next };
        }
    }

    while (heap.size() && activeCount > 2) {
        const popped = heap.pop() as VwHeapEntry;
        const { area, idx, version } = popped;

        if (isDeleted[idx] || pointMetadata[idx].version !== version) {
            continue;
        }

        if (area >= maxArea) {
            break;
        }

        isDeleted[idx] = true;
        activeCount -= 1;

        const meta = pointMetadata[idx];
        const prevIdx = meta.prev;
        const nextIdx = meta.next;

        if (prevIdx !== null) {
            const prevMeta = pointMetadata[prevIdx];
            const newVersion = prevMeta.version + 1;
            const prevPrev = prevMeta.prev;
            let newArea = INF;
            if (prevPrev !== null && nextIdx !== null) {
                newArea = triangleArea(points[prevPrev], points[prevIdx], points[nextIdx]);
                heap.push({ area: newArea, idx: prevIdx, version: newVersion });
            }
            pointMetadata[prevIdx] = {
                area: newArea,
                version: newVersion,
                prev: prevPrev,
                next: nextIdx,
            };
        }

        if (nextIdx !== null) {
            const nextMeta = pointMetadata[nextIdx];
            const newVersion = nextMeta.version + 1;
            const nextNext = nextMeta.next;
            let newArea = INF;
            if (prevIdx !== null && nextNext !== null) {
                newArea = triangleArea(points[prevIdx], points[nextIdx], points[nextNext]);
                heap.push({ area: newArea, idx: nextIdx, version: newVersion });
            }
            pointMetadata[nextIdx] = {
                area: newArea,
                version: newVersion,
                prev: prevIdx,
                next: nextNext,
            };
        }
    }

    const out: Point2[] = [];
    for (let i = 0; i < n; i++) {
        if (!isDeleted[i]) out.push(points[i]);
    }
    return out;
}
