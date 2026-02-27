// Cf. https://bottosson.github.io/posts/oklab/

/**
 * RGB triplet.
 */
type Color3 = [number, number, number];

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
