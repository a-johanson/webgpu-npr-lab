// Cf. https://bottosson.github.io/posts/oklab/

/**
 * RGB triplet.
 */
type Color3 = [number, number, number];

/**
 * A single color stop in a linear gradient.
 */
export type GradientStop = {
    position: number;
    srgb: Color3;
};

/**
 * An internal color stop represented in OKLAB.
 */
type OklabGradientStop = {
    position: number;
    oklab: Color3;
};

/**
 * A linear gradient with interpolation in OKLAB space.
 */
export class LinearGradient {
    private static readonly MIN_STOP_POSITION_DELTA = 1e-9;

    private readonly stops: OklabGradientStop[];

    /**
     * Creates a linear gradient from sRGB stops in [0, 1].
     *
     * @param stops - Gradient stops sorted or unsorted.
     */
    constructor(stops: readonly GradientStop[]) {
        if (stops.length < 2) {
            throw new Error("LinearGradient requires at least 2 stops.");
        }

        const parsedStops: OklabGradientStop[] = stops.map((stop, index) => {
            if (!(stop.position >= 0.0 && stop.position <= 1.0)) {
                throw new Error(
                    `Gradient stop ${String(index)} has position ${String(stop.position)} outside [0, 1].`,
                );
            }

            const srgb = stop.srgb;
            for (let channelIndex = 0; channelIndex < 3; channelIndex++) {
                const channel = srgb[channelIndex];
                if (!(channel >= 0.0 && channel <= 1.0)) {
                    throw new Error(
                        `Gradient stop ${String(index)} has sRGB channel ${String(channelIndex)} outside [0, 1].`,
                    );
                }
            }

            return {
                position: stop.position,
                oklab: linearToOklab(srgbToLinear(srgb)),
            };
        });

        const sortedStops = parsedStops.toSorted(
            (left, right) => left.position - right.position,
        );
        for (let index = 1; index < sortedStops.length; index++) {
            const positionDelta =
                sortedStops[index].position - sortedStops[index - 1].position;
            if (positionDelta <= LinearGradient.MIN_STOP_POSITION_DELTA) {
                throw new Error(
                    `Gradient stops at sorted indices ${String(index - 1)} and ${String(index)} are too close: delta=${String(positionDelta)} (minimum is ${String(LinearGradient.MIN_STOP_POSITION_DELTA)}).`,
                );
            }
        }

        this.stops = sortedStops;
    }

    /**
     * Samples the gradient and returns the color in OKLAB.
     *
     * @param position - Position along the gradient.
     * @returns Interpolated OKLAB color.
     */
    sampleOklab(position: number): Color3 {
        const clampedPosition = LinearGradient.clampToUnitInterval(position);
        const firstStop = this.stops[0];
        const lastStop = this.stops[this.stops.length - 1];

        if (clampedPosition <= firstStop.position) {
            return [...firstStop.oklab] as Color3;
        }
        if (clampedPosition >= lastStop.position) {
            return [...lastStop.oklab] as Color3;
        }

        const upperStopIndex = this.findUpperStopIndex(clampedPosition);
        const lowerStop = this.stops[upperStopIndex - 1];
        const upperStop = this.stops[upperStopIndex];
        const segmentLength = upperStop.position - lowerStop.position;
        const localPosition = (clampedPosition - lowerStop.position) / segmentLength;

        return LinearGradient.mix(lowerStop.oklab, upperStop.oklab, localPosition);
    }

    /**
     * Samples the gradient and returns the color in sRGB.
     *
     * @param position - Position along the gradient.
     * @returns Interpolated sRGB color.
     */
    sampleSrgb(position: number): Color3 {
        return linearToSrgb(oklabToLinear(this.sampleOklab(position)));
    }

    /**
     * Samples the gradient in sRGB and adds triangular-distributed jitter.
     *
     * @param position - Position along the gradient.
     * @param jitterAmplitude - Jitter scale applied to each sRGB channel.
     * @param rng - Random number generator in [0, 1).
     * @returns Jittered sRGB color.
     */
    sampleSrgbJittered(
        position: number,
        jitterAmplitude: number,
        rng: () => number = Math.random,
    ): Color3 {
        const srgb = this.sampleSrgb(position);
        const red = LinearGradient.clampToUnitInterval(
            srgb[0] + jitterAmplitude * LinearGradient.sampleTriangular(rng),
        );
        const green = LinearGradient.clampToUnitInterval(
            srgb[1] + jitterAmplitude * LinearGradient.sampleTriangular(rng),
        );
        const blue = LinearGradient.clampToUnitInterval(
            srgb[2] + jitterAmplitude * LinearGradient.sampleTriangular(rng),
        );

        return [red, green, blue];
    }

    /**
     * Finds the first stop with position >= query position.
     *
     * @param position - Clamped query position.
     * @returns Upper stop index.
     */
    private findUpperStopIndex(position: number): number {
        let low = 0;
        let high = this.stops.length - 1;

        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (position <= this.stops[mid].position) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }

        return low;
    }

    /**
     * Clamps a value to [0, 1].
     *
     * @param value - Input value.
     * @returns Clamped value.
     */
    private static clampToUnitInterval(value: number): number {
        return Math.min(Math.max(value, 0.0), 1.0);
    }

    /**
     * Linearly interpolates two vectors.
     *
     * @param start - Start vector.
     * @param end - End vector.
     * @param t - Interpolation amount.
     * @returns Interpolated vector.
     */
    private static mix(start: Color3, end: Color3, t: number): Color3 {
        return start.map((value, index) => value * (1.0 - t) + end[index] * t) as Color3;
    }

    /**
     * Samples from a triangular distribution in [-1, 1].
     *
     * @param rng - Random number generator in [0, 1).
     * @returns Triangular random sample.
     */
    private static sampleTriangular(rng: () => number): number {
        return rng() + rng() - 1.0;
    }
}

/**
 * Converts linear RGB to OKLAB.
 *
 * @param c - Linear RGB color.
 * @returns OKLAB color.
 */
export function linearToOklab(c: Color3): Color3 {
    const r = c[0];
    const g = c[1];
    const b = c[2];

    let l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    let m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    let s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

    l = l ** (1.0 / 3.0);
    m = m ** (1.0 / 3.0);
    s = s ** (1.0 / 3.0);

    return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
}

/**
 * Converts OKLAB to linear RGB.
 *
 * @param c - OKLAB color.
 * @returns Linear RGB color.
 */
export function oklabToLinear(c: Color3): Color3 {
    const L = c[0];
    const a = c[1];
    const b = c[2];

    let l = L + 0.3963377774 * a + 0.2158037573 * b;
    let m = L - 0.1055613458 * a - 0.0638541728 * b;
    let s = L - 0.0894841775 * a - 1.291485548 * b;

    l = l * l * l;
    m = m * m * m;
    s = s * s * s;

    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
}

/**
 * Converts OKLAB to OKLCH.
 *
 * @param lab - OKLAB color.
 * @returns OKLCH color.
 */
export function oklabToOklch(lab: Color3): Color3 {
    const L = lab[0];
    const a = lab[1];
    const b = lab[2];
    const C = Math.hypot(a, b);
    const H = Math.atan2(b, a);
    return [L, C, H];
}

/**
 * Converts OKLCH to OKLAB.
 *
 * @param lch - OKLCH color.
 * @returns OKLAB color.
 */
export function oklchToOklab(lch: Color3): Color3 {
    const L = lch[0];
    const C = lch[1];
    const H = lch[2];
    return [L, C * Math.cos(H), C * Math.sin(H)];
}

/**
 * Converts sRGB to linear RGB.
 *
 * @param c - sRGB color.
 * @returns Linear RGB color.
 */
export function srgbToLinear(c: Color3): Color3 {
    const out: Color3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
        const v = c[i];
        out[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }
    return out;
}

/**
 * Converts linear RGB to sRGB.
 *
 * @param c - Linear RGB color.
 * @returns sRGB color.
 */
export function linearToSrgb(c: Color3): Color3 {
    const out: Color3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
        const v = Math.min(Math.max(c[i], 0.0), 1.0);
        out[i] = v < 0.0031308 ? 12.92 * v : 1.055 * v ** (1.0 / 2.4) - 0.055;
    }
    return out;
}
