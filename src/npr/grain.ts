import { createNoise2D } from "simplex-noise";
import { prng_xor4096 } from "xor4096";
import { type Color3, oklabToOklch, oklchToOklab } from "./color";

/**
 * Configuration values for film-like grain.
 */
export type FilmGrainOptions = {
    seed: string;
    pixelsPerMm: number;
    grainSizeMm?: number;
    lightnessAmplitude?: number;
    chromaAmplitude?: number;
    hueAmplitude?: number;
    octaves?: number;
    persistence?: number;
    lacunarity?: number;
    minChromaForHueJitter?: number;
};

/**
 * Film-like grain model using correlated simplex noise.
 */
export class FilmGrain {
    private readonly mmPerPixel: number;

    private readonly inverseGrainSizeMm: number;

    private readonly lightnessAmplitude: number;

    private readonly chromaAmplitude: number;

    private readonly hueAmplitude: number;

    private readonly minChromaForHueJitter: number;

    private readonly octaves: number;

    private readonly persistence: number;

    private readonly lacunarity: number;

    private readonly lightnessNoise: (x: number, y: number) => number;

    private readonly chromaNoise: (x: number, y: number) => number;

    private readonly hueNoise: (x: number, y: number) => number;

    /**
     * Creates a film-like grain model.
     *
     * @param options - Grain parameters.
     */
    constructor({
        seed,
        pixelsPerMm,
        grainSizeMm = 0.09,
        lightnessAmplitude = 0.05,
        chromaAmplitude = 0.016,
        hueAmplitude = (1.2 * Math.PI) / 180.0,
        octaves = 3,
        persistence = 0.55,
        lacunarity = 2.0,
        minChromaForHueJitter = 0.01,
    }: FilmGrainOptions) {
        if (!(pixelsPerMm > 0.0)) {
            throw new Error(
                `FilmGrain requires pixelsPerMm > 0. Received ${String(pixelsPerMm)}.`,
            );
        }
        if (!(grainSizeMm > 0.0)) {
            throw new Error(
                `FilmGrain requires grainSizeMm > 0. Received ${String(grainSizeMm)}.`,
            );
        }
        if (!(lightnessAmplitude >= 0.0)) {
            throw new Error(
                `FilmGrain requires lightnessAmplitude >= 0. Received ${String(lightnessAmplitude)}.`,
            );
        }
        if (!(chromaAmplitude >= 0.0)) {
            throw new Error(
                `FilmGrain requires chromaAmplitude >= 0. Received ${String(chromaAmplitude)}.`,
            );
        }
        if (!(hueAmplitude >= 0.0)) {
            throw new Error(
                `FilmGrain requires hueAmplitude >= 0. Received ${String(hueAmplitude)}.`,
            );
        }
        if (!(minChromaForHueJitter >= 0.0)) {
            throw new Error(
                `FilmGrain requires minChromaForHueJitter >= 0. Received ${String(minChromaForHueJitter)}.`,
            );
        }
        if (!Number.isInteger(octaves) || octaves <= 0) {
            throw new Error(
                `FilmGrain requires octaves to be a positive integer. Received ${String(octaves)}.`,
            );
        }
        if (!(persistence > 0.0)) {
            throw new Error(
                `FilmGrain requires persistence > 0. Received ${String(persistence)}.`,
            );
        }
        if (!(lacunarity > 1.0)) {
            throw new Error(
                `FilmGrain requires lacunarity > 1. Received ${String(lacunarity)}.`,
            );
        }

        this.mmPerPixel = 1.0 / pixelsPerMm;
        this.inverseGrainSizeMm = 1.0 / grainSizeMm;
        this.lightnessAmplitude = lightnessAmplitude;
        this.chromaAmplitude = chromaAmplitude;
        this.hueAmplitude = hueAmplitude;
        this.minChromaForHueJitter = minChromaForHueJitter;
        this.octaves = octaves;
        this.persistence = persistence;
        this.lacunarity = lacunarity;

        this.lightnessNoise = createNoise2D(prng_xor4096(`${seed}:lightness`));
        this.chromaNoise = createNoise2D(prng_xor4096(`${seed}:chroma`));
        this.hueNoise = createNoise2D(prng_xor4096(`${seed}:hue`));
    }

    /**
     * Applies film-like grain in OKLCH and returns a jittered OKLAB color.
     *
     * @param oklab - Base color in OKLAB.
     * @param xPx - X position in pixels.
     * @param yPx - Y position in pixels.
     * @returns Jittered color in OKLAB.
     */
    applyToOklab(oklab: Color3, xPx: number, yPx: number): Color3 {
        const [lightness, chroma, hue] = oklabToOklch(oklab);
        const xNoise = xPx * this.mmPerPixel * this.inverseGrainSizeMm;
        const yNoise = yPx * this.mmPerPixel * this.inverseGrainSizeMm;

        const lightnessNoise = this.sampleFbm(this.lightnessNoise, xNoise, yNoise);
        const chromaNoise = this.sampleFbm(this.chromaNoise, xNoise, yNoise);
        const hueNoise = this.sampleFbm(this.hueNoise, xNoise, yNoise);

        const jitteredLightness = FilmGrain.clampToUnitInterval(
            lightness + this.lightnessAmplitude * lightnessNoise,
        );
        const jitteredChroma = Math.max(0.0, chroma + this.chromaAmplitude * chromaNoise);
        const hueJitter =
            jitteredChroma >= this.minChromaForHueJitter ? this.hueAmplitude * hueNoise : 0.0;

        return oklchToOklab([jitteredLightness, jitteredChroma, hue + hueJitter]);
    }

    /**
     * Samples multi-octave simplex noise and normalizes the output to [-1, 1].
     *
     * @param noise2d - 2D noise source.
     * @param xNoise - X noise coordinate.
     * @param yNoise - Y noise coordinate.
     * @returns Normalized noise value.
     */
    private sampleFbm(
        noise2d: (x: number, y: number) => number,
        xNoise: number,
        yNoise: number,
    ): number {
        let frequency = 1.0;
        let amplitude = 1.0;
        let amplitudeSum = 0.0;
        let valueSum = 0.0;

        for (let octave = 0; octave < this.octaves; octave++) {
            valueSum += amplitude * noise2d(xNoise * frequency, yNoise * frequency);
            amplitudeSum += amplitude;
            amplitude *= this.persistence;
            frequency *= this.lacunarity;
        }

        return amplitudeSum > 0.0 ? valueSum / amplitudeSum : 0.0;
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
}
