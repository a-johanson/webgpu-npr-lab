import {
    type Color3,
    type GradientStop,
    linearToOklab,
    type OklabGradientStop,
    srgbToLinear,
} from "../../../npr/color";
import { createSfc32 } from "../../../npr/sfc32";
import type { AppDimensions } from "../../../types/app-state";
import type { LdzSceneGpuResources, LdzSceneModule } from "../ldz-scene-module";

type Vec3 = readonly [number, number, number];

/**
 * Parameters that control radiolarian structure and look.
 */
type RadiolarianParameters = {
    pointCount: number;
    maxNeighbors: number;
    jitterStrength: number;
    contractionMargin: number;
    corridorScale: number;
    shellRadius: number;
    shellThickness: number;
    shellMidSmoothness: number;
    cornerSmoothness: number;
    csgSmoothness: number;
    cellBlendSmoothness: number;
    grainSizeMm: number;
    grainLightnessAmplitude: number;
    grainChromaAmplitude: number;
    grainHueAmplitude: number;
    minChromaForHueJitter: number;
    glowStrength: number;
    glowFalloff: number;
    particleSizeMm: number;
    particleGlowStrength: number;
    particleFalloffRate: number;
    particleWarpStrength: number;
    particleWarpScale: number;
};

const RADIOLARIAN_PARAMS: RadiolarianParameters = {
    pointCount: 100,
    maxNeighbors: 8,
    jitterStrength: 0.8,
    contractionMargin: 0.02,
    corridorScale: 1.5,
    shellRadius: 1.0,
    shellThickness: 0.05,
    shellMidSmoothness: 0.01,
    cornerSmoothness: 0.12 / 6.0,
    csgSmoothness: 0.009,
    cellBlendSmoothness: 0.01,
    grainSizeMm: 0.4,
    grainLightnessAmplitude: 0.05,
    grainChromaAmplitude: 0.016,
    grainHueAmplitude: (1.2 * Math.PI) / 180.0,
    minChromaForHueJitter: 0.025,
    glowStrength: 0.25,
    glowFalloff: 300.0,
    particleSizeMm: 250.0,
    particleGlowStrength: 0.45,
    particleFalloffRate: 42.0,
    particleWarpStrength: 0.15,
    particleWarpScale: 0.45,
};

const FG_SRGB: Color3 = [1.0, 0.98, 0.95];

const BG_STOPS: readonly GradientStop[] = [
    { position: 0.0, srgb: [0.05, 0.5, 0.4] },
    { position: 1.0, srgb: [0.0, 0.15, 0.35] },
];

const buildFragmentShader = (
    parameters: RadiolarianParameters,
    fg_srgb: Color3,
    bgStops: readonly GradientStop[],
): string => {
    if (bgStops.length !== 2) {
        throw new Error("Expected exactly 2 background stops");
    }

    const fg_oklab = linearToOklab(srgbToLinear(fg_srgb));

    const oklabBgStops: OklabGradientStop[] = bgStops.map((stop) => ({
        position: stop.position,
        oklab: linearToOklab(srgbToLinear(stop.srgb)),
    }));
    const floatLiteral = (v: number): string => v.toPrecision(8);
    const vec3Literal = (v: Color3): string =>
        `vec3f(${floatLiteral(v[0])}, ${floatLiteral(v[1])}, ${floatLiteral(v[2])})`;

    return `struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

struct FragmentOut {
    @location(0) ldz: vec4f,
    @location(1) color: vec4f,
};

struct GlobalUniforms {
    aspect: f32,
    seed: u32,
    pixels_per_mm: f32,
    viewport_height_px: f32,
    tile_offset: vec2f,
    tile_scale: vec2f,
};

const MAX_NEIGHBORS: u32 = ${parameters.maxNeighbors}u;
const POINT_COUNT: u32 = ${parameters.pointCount}u;
const CORRIDOR_SCALE: f32 = ${parameters.corridorScale};
const SHELL_RADIUS: f32 = ${parameters.shellRadius};
const SHELL_THICKNESS: f32 = ${parameters.shellThickness};
const SHELL_MID_SMOOTHNESS: f32 = ${parameters.shellMidSmoothness};
const CORNER_SMOOTHNESS: f32 = ${parameters.cornerSmoothness};
const CSG_SMOOTHNESS: f32 = ${parameters.csgSmoothness};
const CELL_BLEND_SMOOTHNESS: f32 = ${parameters.cellBlendSmoothness};
const INVERSE_GRAIN_SIZE_MM: f32 = ${1.0 / parameters.grainSizeMm};
const GRAIN_LIGHTNESS_AMPLITUDE: f32 = ${parameters.grainLightnessAmplitude};
const GRAIN_CHROMA_AMPLITUDE: f32 = ${parameters.grainChromaAmplitude};
const GRAIN_HUE_AMPLITUDE: f32 = ${parameters.grainHueAmplitude};
const MIN_CHROMA_FOR_HUE_JITTER: f32 = ${parameters.minChromaForHueJitter};
const GLOW_STRENGTH: f32 = ${parameters.glowStrength};
const GLOW_FALLOFF: f32 = ${parameters.glowFalloff};
const PARTICLE_SIZE_MM: f32 = ${parameters.particleSizeMm};
const PARTICLE_GLOW_STRENGTH: f32 = ${parameters.particleGlowStrength};
const PARTICLE_FALLOFF_RATE: f32 = ${parameters.particleFalloffRate};
const PARTICLE_WARP_STRENGTH: f32 = ${parameters.particleWarpStrength};
const PARTICLE_WARP_SCALE: f32 = ${parameters.particleWarpScale};

struct SiteData {
    site: vec4f,
    tangent_u: vec4f,
    tangent_v: vec4f,
    metadata: vec4f,
    constraints: array<vec4f, MAX_NEIGHBORS>,
};

@group(0) @binding(0) var<uniform> global_uniforms: GlobalUniforms;
@group(1) @binding(0) var<storage, read> sites: array<SiteData>;

fn smax(a: f32, b: f32, k_in: f32) -> f32 {
    let k = k_in * 6.0;
    let h = max(k - abs(a - b), 0.0) / k;
    return max(a, b) + h * h * h * k * (1.0 / 6.0);
}

fn smin(a: f32, b: f32, k_in: f32) -> f32 {
    return -smax(-a, -b, k_in);
}

fn smooth_abs(x: f32, k: f32) -> f32 {
    return sqrt(x * x + k * k) - k;
}

fn compute_poly_distance(site_index: u32, direction: vec3f) -> f32 {
    let site = sites[site_index];
    let normal = site.site.xyz;
    let tangent_u = site.tangent_u.xyz;
    let tangent_v = site.tangent_v.xyz;

    let safe_denominator = max(dot(direction, normal), 1e-4);
    let gnomonic = direction / safe_denominator;
    let tangent_x = dot(gnomonic, tangent_u);
    let tangent_y = dot(gnomonic, tangent_v);

    let constraint_count = u32(clamp(site.metadata.x, 0.0, f32(MAX_NEIGHBORS)));
    var poly_distance = 1e9;
    if (constraint_count > 0u) {
        poly_distance = -1e9;
        for (var constraint_index: u32 = 0u; constraint_index < constraint_count; constraint_index++) {
            let constraint = site.constraints[constraint_index];
            let a = constraint.x;
            let b = constraint.y;
            let c_contracted = constraint.z;
            let inverse_length = constraint.w;
            let signed_halfplane = (a * tangent_x + b * tangent_y - c_contracted) * inverse_length;
            poly_distance = smax(poly_distance, signed_halfplane, CORNER_SMOOTHNESS);
        }
    }
    return poly_distance;
}

fn scene_sdf(p: vec3f) -> f32 {
    // 1) Base shell band around SHELL_RADIUS with thickness SHELL_THICKNESS.
    //    Uses smooth_abs to round the C1 kink of abs() at the shell mid-radius,
    //    which would otherwise create a visible crease on the inside of the hole walls.
    let radius = length(p);
    let d_shell = smooth_abs(radius - SHELL_RADIUS, SHELL_MID_SMOOTHNESS) - smooth_abs(0.5 * SHELL_THICKNESS, SHELL_MID_SMOOTHNESS);

    let point_count = POINT_COUNT;
    if (point_count == 0u) {
        return d_shell;
    }

    // Normalize p to a unit direction for spherical ownership and boundary tests.
    let safe_radius = max(radius, 1e-6);
    let direction = p / safe_radius;

    // 2) Corridor search.  Find the three sites with strongest alignment to
    //    the direction (closest on the sphere).
    let point_count_f = f32(point_count);
    let approximate_index = ((1.0 - direction.y) * point_count_f * 0.5) - 0.5;
    let center_index = i32(round(approximate_index));
    let corridor_half_width = i32(ceil(CORRIDOR_SCALE * sqrt(point_count_f)));

    let index_min = u32(max(center_index - corridor_half_width, 0));
    let index_max = u32(min(center_index + corridor_half_width, i32(point_count) - 1));

    var best_index = index_min;
    var best_alignment = -2.0;
    var second_index = index_min;
    var second_alignment = -2.0;
    var third_index = index_min;
    var third_alignment = -2.0;
    for (var i = index_min; i <= index_max; i++) {
        let alignment = dot(direction, sites[i].site.xyz);
        if (alignment > best_alignment) {
            third_alignment = second_alignment;
            third_index = second_index;
            second_alignment = best_alignment;
            second_index = best_index;
            best_alignment = alignment;
            best_index = i;
        } else if (alignment > second_alignment) {
            third_alignment = second_alignment;
            third_index = second_index;
            second_alignment = alignment;
            second_index = i;
        } else if (alignment > third_alignment) {
            third_alignment = alignment;
            third_index = i;
        }
    }

    // 3) Compute poly distances for the top 3 sites.
    let poly_distance_0 = compute_poly_distance(best_index, direction);
    let poly_distance_1 = compute_poly_distance(second_index, direction);
    let poly_distance_2 = compute_poly_distance(third_index, direction);

    // 4) Combine via smooth min to avoid creases at cell boundaries.
    //    At 2-way boundaries both near-zero values are rounded together;
    //    at 3-way vertices all three participate; deep inside a cell only
    //    the closest site matters (smin = min for well-separated values).
    let combined_poly = smin(poly_distance_0, poly_distance_1, CELL_BLEND_SMOOTHNESS);
    let d_poly = smin(combined_poly, poly_distance_2, CELL_BLEND_SMOOTHNESS);

    // 5) Radial slab for through-cut extrusion.
    //    d_slab < 0 means radius lies within [SHELL_RADIUS - SHELL_THICKNESS,
    //    SHELL_RADIUS + SHELL_THICKNESS].
    let slab_inner = SHELL_RADIUS - SHELL_THICKNESS;
    let slab_outer = SHELL_RADIUS + SHELL_THICKNESS;
    let d_slab = max(slab_inner - radius, radius - slab_outer);

    // 6) Hole construction and subtraction.
    //    d_hole is the SDF of the hole volume: points must satisfy both
    //    d_poly <= 0 (inside footprint) and d_slab <= 0 (inside slab).
    //    For SDF CSG, intersection uses max(), so d_hole = max(d_poly, d_slab).
    //    Final model subtracts this hole from d_shell via smooth CSG difference.
    let d_hole = max(d_poly, d_slab);
    return smax(d_shell, -d_hole, CSG_SMOOTHNESS);
}

// Cf. https://iquilezles.org/articles/normalsSDF/
fn calc_normal(p: vec3f) -> vec3f {
    let h = 0.001;
    let dx = vec3f(h, 0.0, 0.0);
    let dy = vec3f(0.0, h, 0.0);
    let dz = vec3f(0.0, 0.0, h);
    return normalize(vec3f(
        scene_sdf(p + dx) - scene_sdf(p - dx),
        scene_sdf(p + dy) - scene_sdf(p - dy),
        scene_sdf(p + dz) - scene_sdf(p - dz)
    ));
}

fn calc_ambient_occlusion(p: vec3f, normal: vec3f, max_distance: f32, sample_count: i32) -> f32 {
    var occlusion = 0.0;
    var max_occlusion = 0.0;
    var weight = 1.0;
    let step_size = max_distance / f32(sample_count);
    for (var i = 1; i <= sample_count; i++) {
        let sample_distance = step_size * f32(i);
        let sample_point = p + normal * sample_distance;
        let distance_to_surface = scene_sdf(sample_point);
        // If geometry is close, increase occlusion.
        occlusion += (sample_distance - distance_to_surface) * weight;
        max_occlusion += sample_distance * weight;
        weight *= 0.95;
    }
    // Normalize occlusion by theoretical maximum.
    return 1.0 - clamp(occlusion / max(max_occlusion, 1e-6), 0.0, 1.0);
}

fn calc_soft_shadow(p: vec3f, light_dir: vec3f) -> f32 {
    let epsilon = 0.001;
    let step_scale = 0.2;
    let min_distance = 20.0 * epsilon;
    let max_distance = 2.5;
    let max_steps = 400;
    let penumbra = 10.0;

    var shadow = 1.0;
    var t = min_distance;
    for (var i = 0; i < max_steps; i++) {
        let sample_point = p + light_dir * t;
        let dist = scene_sdf(sample_point);
        if (dist < epsilon) {
            return 0.0;
        }
        shadow = min(shadow, penumbra * dist / t);
        if (t > max_distance) {
            break;
        }
        t += dist * step_scale;
    }
    return clamp(shadow, 0.0, 1.0);
}

fn calc_fresnel(view_direction: vec3f, normal: vec3f) -> f32 {
    let exponent = 3.0;
    let cos_theta = clamp(dot(view_direction, normal), 0.0, 1.0);
    return pow(1.0 - cos_theta, exponent);
}

fn oklab_to_linear_rgb(color: vec3f) -> vec3f {
    let lightness = color.x;
    let a = color.y;
    let b = color.z;

    var l = lightness + 0.3963377774 * a + 0.2158037573 * b;
    var m = lightness - 0.1055613458 * a - 0.0638541728 * b;
    var s = lightness - 0.0894841775 * a - 1.291485548 * b;

    l = l * l * l;
    m = m * m * m;
    s = s * s * s;

    return vec3f(
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
    );
}

fn linear_to_srgb(color: vec3f) -> vec3f {
    return mix(
        12.92 * color,
        1.055 * pow(clamp(color, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.4)) - vec3f(0.055),
        step(vec3f(0.0031308), color)
    );
}

fn oklab_to_oklch(lab: vec3f) -> vec3f {
    let lightness = lab.x;
    let a = lab.y;
    let b = lab.z;
    let chroma = length(vec2f(a, b));
    let hue = atan2(b, a);
    return vec3f(lightness, chroma, hue);
}

fn oklch_to_oklab(lch: vec3f) -> vec3f {
    let lightness = lch.x;
    let chroma = lch.y;
    let hue = lch.z;
    return vec3f(lightness, chroma * cos(hue), chroma * sin(hue));
}

fn sample_background_gradient_oklab(t: f32) -> vec3f {
    let stop0 = ${floatLiteral(oklabBgStops[0].position)};
    let stop1 = ${floatLiteral(oklabBgStops[1].position)};

    let color0 = ${vec3Literal(oklabBgStops[0].oklab)};
    let color1 = ${vec3Literal(oklabBgStops[1].oklab)};

    if (t <= stop0) {
        return color0;
    }
    if (t <= stop1) {
        let segment_t = (t - stop0) / (stop1 - stop0);
        return mix(color0, color1, segment_t);
    }
    return color1;
}

// Cf. https://www.shadertoy.com/view/XlGcRh
fn pcg2d(v_in: vec2u) -> vec2u {
    var v = v_in;

    v = v * 1664525u + 1013904223u;

    v.x += v.y * 1664525u;
    v.y += v.x * 1664525u;

    v ^= (v >> vec2u(16u));

    v.x += v.y * 1664525u;
    v.y += v.x * 1664525u;

    v ^= (v >> vec2u(16u));

    return v;
}

fn u32_to_unit_float(value: u32) -> f32 {
    return f32(value) * (1.0 / 4294967296.0);
}

const GRAD2: array<vec2f, 12> = array<vec2f, 12>(
    vec2f( 1.0,  1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0, -1.0),

    vec2f(-1.0, -1.0),
    vec2f( 1.0,  0.0),
    vec2f(-1.0,  0.0),

    vec2f( 1.0,  0.0),
    vec2f(-1.0,  0.0),
    vec2f( 0.0,  1.0),

    vec2f( 0.0, -1.0),
    vec2f( 0.0,  1.0),
    vec2f( 0.0, -1.0)
);

fn grad_index_2d(lattice: vec2i, seed: u32) -> u32 {
    let p = vec2u(u32(lattice.x), u32(lattice.y));
    let s = vec2u(seed, seed ^ 0x9E3779B9u); // 0x9E3779B9u = 2^32 / ((1 + sqrt(5)) / 2)
    let h = pcg2d(p + s);
    let v = h.x ^ h.y;
    return v % 12u;
}

fn grad2(lattice: vec2i, seed: u32) -> vec2f {
    return GRAD2[grad_index_2d(lattice, seed)];
}

// Adapted from https://github.com/jwagner/simplex-noise.js
fn simplex_noise_2d(p: vec2f, seed: u32) -> f32 {
    const F2: f32 = 0.3660254037844386;  // 0.5*(sqrt(3)-1)
    const G2: f32 = 0.2113248654051871;  // (3-sqrt(3))/6

    let s = (p.x + p.y) * F2;
    let i = i32(floor(p.x + s));
    let j = i32(floor(p.y + s));

    let t = f32(i + j) * G2;

    let x0 = p.x - (f32(i) - t);
    let y0 = p.y - (f32(j) - t);

    let i1: i32 = select(0, 1, x0 > y0);
    let j1: i32 = select(1, 0, x0 > y0);

    let x1 = x0 - f32(i1) + G2;
    let y1 = y0 - f32(j1) + G2;

    let x2 = x0 - 1.0 + 2.0 * G2;
    let y2 = y0 - 1.0 + 2.0 * G2;

    let ij0 = vec2i(i, j);
    let ij1 = vec2i(i + i1, j + j1);
    let ij2 = vec2i(i + 1,  j + 1);

    var n0: f32 = 0.0;
    var n1: f32 = 0.0;
    var n2: f32 = 0.0;

    var t0 = 0.5 - (x0 * x0 + y0 * y0);
    if (t0 >= 0.0) {
        let g0 = grad2(ij0, seed);
        t0 = t0 * t0;
        n0 = (t0 * t0) * dot(g0, vec2f(x0, y0));
    }

    var t1 = 0.5 - (x1 * x1 + y1 * y1);
    if (t1 >= 0.0) {
        let g1 = grad2(ij1, seed);
        t1 = t1 * t1;
        n1 = (t1 * t1) * dot(g1, vec2f(x1, y1));
    }

    var t2 = 0.5 - (x2 * x2 + y2 * y2);
    if (t2 >= 0.0) {
        let g2v = grad2(ij2, seed);
        t2 = t2 * t2;
        n2 = (t2 * t2) * dot(g2v, vec2f(x2, y2));
    }

    return 70.0 * (n0 + n1 + n2);
}

fn rotate(p: vec2f, cos_sin: vec2f) -> vec2f {
    return vec2f(
        p.x * cos_sin.x - p.y * cos_sin.y,
        p.x * cos_sin.y + p.y * cos_sin.x
    );
}

fn fbm3_simplex_2d(p: vec2f, rot_cos_sin: vec2f, seed: u32) -> f32 {
    var amp: f32 = 1.0;
    var freq: f32 = 1.0;
    var sum: f32 = 0.0;
    var q = p;
    for (var i: u32 = 0u; i < 3u; i++) {
        q = rotate(q, rot_cos_sin);
        sum += amp * simplex_noise_2d(q * freq, seed + i);
        freq = freq * 2.0; // lacunarity
        amp = amp * 0.5; // persistence
    }

    // Normalization for three octaves with persistence = 0.5
    let scale = 1.0 / (1.0 + 0.5 + 0.25);
    return sum * scale;
}

fn voronoi_glow(p: vec2f, seed: u32, falloff_rate: f32) -> f32 {
    let ip = floor(p);
    let fp = p - ip;
    var glow = 0.0;
    for (var dx = -1; dx <= 1; dx++) {
        for (var dy = -1; dy <= 1; dy++) {
            let neighbor = ip + vec2f(f32(dx), f32(dy));
            let hashed = pcg2d(
                vec2u(u32(neighbor.x), u32(neighbor.y)) + vec2u(seed, seed ^ 0x9E3779B9u)
            );
            let offset = vec2f(
                u32_to_unit_float(hashed.x),
                u32_to_unit_float(hashed.y)
            );
            let center = vec2f(f32(dx), f32(dy)) + offset;
            let diff = fp - center;
            glow += exp(-dot(diff, diff) * falloff_rate);
        }
    }
    return glow;
}

fn grain_lch(lab: vec3f, grain_coord: vec2f, seed: u32) -> vec3f {
    let lch = oklab_to_oklch(lab);
    let lightness = lch.x;
    let chroma = lch.y;
    let hue = lch.z;

    let l_noise = fbm3_simplex_2d(grain_coord, vec2f(3.0 / 5.0, 4.0 / 5.0), seed);
    let c_noise = fbm3_simplex_2d((grain_coord + vec2f(5.2, 1.3)), vec2f(5.0 / 13.0, 12.0 / 13.0), seed + 17u);
    let h_noise = fbm3_simplex_2d((grain_coord + vec2f(8.7, 3.8)), vec2f(8.0 / 17.0, 15.0 / 17.0), seed + 29u);

    let l = clamp(lightness + GRAIN_LIGHTNESS_AMPLITUDE * l_noise, 0.0, 1.0);
    let c = max(0.0, chroma + GRAIN_CHROMA_AMPLITUDE * c_noise);
    let h = hue + select(0.0, GRAIN_HUE_AMPLITUDE * h_noise, c >= MIN_CHROMA_FOR_HUE_JITTER);

    return oklch_to_oklab(vec3f(l, c, h));
}

@fragment
fn main_fragment(in: VertexOut) -> FragmentOut {
    // Ray setup.
    let uv = in.uv * 2.0 - 1.0;
    let pixel_coord = in.uv * vec2f(
        global_uniforms.aspect * global_uniforms.viewport_height_px,
        global_uniforms.viewport_height_px
    );
    let pixel_index = vec2u(pixel_coord);

    // Light setup.
    let light_dir = normalize(vec3f(0.5, 1.0, 2.0));

    // Camera setup.
    let cam_pos = vec3f(0.5, -0.4, 2.75);
    let cam_target = vec3f(-0.275, 0.3, 0.0);
    let cam_up = vec3f(0.0, 1.0, 0.0);

    // Camera basis.
    let cam_forward = normalize(cam_target - cam_pos);
    let cam_right = normalize(cross(cam_forward, cam_up));
    let cam_true_up = cross(cam_right, cam_forward);

    let fov = radians(50.0);
    let fov_scale = tan(0.5 * fov);
    let ray_dir = normalize(
        cam_right * uv.x * global_uniforms.aspect * fov_scale +
        cam_true_up * uv.y * fov_scale +
        cam_forward
    );

    // Ray marching.
    let max_dist = 10.0;
    let max_steps = 500;
    let epsilon = 0.0001;
    let step_scale = 1.0;
    let orientation_offset = radians(90.0);

    var t = 0.0;
    var luminance = 0.0;
    var direction = vec2f(0.0, 0.0);
    var depth = -1.0;
    var min_dist = 1e9;
    var color = ${vec3Literal(FG_SRGB)};

    for (var step = 0; step < max_steps; step++) {
        let p = cam_pos + ray_dir * t;
        let d = scene_sdf(p);
        min_dist = min(min_dist, d);

        if (d < epsilon) {
            let normal = calc_normal(p);
            let p_relative = p - cam_pos;

            // Simple lighting (luminance).
            let normal_amount = dot(normal, light_dir);
            let diffuse_light = max(0.0, normal_amount);
            let shadow = calc_soft_shadow(p, light_dir);
            let ao = calc_ambient_occlusion(p, normal, 0.1, 5);
            let fresnel = calc_fresnel(-ray_dir, normal);
            luminance = 0.8 * diffuse_light * shadow + 0.2 * ao + 0.05 * fresnel;

            // Compute surface orientation and project to image plane.
            let a = normalize(light_dir - normal_amount * normal);
            let b = cross(normal, a);
            let ab_dir = cos(orientation_offset) * a + sin(orientation_offset) * b;
            let p_plus = p_relative + epsilon * ab_dir;
            let p_minus = p_relative - epsilon * ab_dir;

            let p_plus_clip = vec2f(dot(p_plus, cam_right), dot(p_plus, cam_true_up));
            let p_minus_clip = vec2f(dot(p_minus, cam_right), dot(p_minus, cam_true_up));
            direction = normalize(p_plus_clip - p_minus_clip);

            depth = dot(p - cam_pos, cam_forward);
            break;
        }

        if (t > max_dist) {
            break;
        }

        t += step_scale * d;
    }

    if (depth < 0.0) {
        let t_gradient = pow(dot(in.uv, vec2(0.15, 0.85)), 0.75);
        let bg_gradient = sample_background_gradient_oklab(t_gradient);
        let mm_per_pixel = 1.0 / global_uniforms.pixels_per_mm;
        let grain_coord = pixel_coord * mm_per_pixel * INVERSE_GRAIN_SIZE_MM;
        let bg_with_grain = grain_lch(bg_gradient, grain_coord, global_uniforms.seed);

        let particle_coord = pixel_coord * mm_per_pixel / PARTICLE_SIZE_MM;
        let rot = vec2f(7.0 / 25.0, 24.0 / 25.0);
        let warp_x = fbm3_simplex_2d(particle_coord * PARTICLE_WARP_SCALE, rot, global_uniforms.seed + 101u);
        let warp_y = fbm3_simplex_2d(particle_coord * PARTICLE_WARP_SCALE + vec2f(10.0, 5.0), rot, global_uniforms.seed + 103u);
        let warp = vec2f(warp_x, warp_y) * PARTICLE_WARP_STRENGTH;
        let particle_amount = voronoi_glow(particle_coord + warp, global_uniforms.seed + 107u, PARTICLE_FALLOFF_RATE);
        let bg_with_particles = mix(bg_with_grain, ${vec3Literal(fg_oklab)}, PARTICLE_GLOW_STRENGTH * particle_amount);

        let glow_strength = GLOW_STRENGTH * exp(-min_dist * GLOW_FALLOFF);
        let bg_oklab = mix(bg_with_particles, ${vec3Literal(fg_oklab)}, glow_strength);
        color = linear_to_srgb(oklab_to_linear_rgb(bg_oklab));
    }

    return FragmentOut(
        vec4f(luminance, direction, depth),
        vec4f(color, 1.0),
    );
}
`;
};

/**
 * CPU-side data payload for the radiolarian scene.
 */
type RadiolarianCpuData = {
    siteData: Float32Array<ArrayBuffer>;
};

class RadiolarianGpuResources implements LdzSceneGpuResources {
    readonly bindGroupEntries: readonly GPUBindGroupEntry[];
    readonly #siteBuffer: GPUBuffer;

    /**
     * Creates scene GPU resources.
     *
     * @param siteBuffer - Storage buffer with site and neighbor constraint data.
     */
    constructor(siteBuffer: GPUBuffer) {
        this.#siteBuffer = siteBuffer;
        this.bindGroupEntries = [
            {
                binding: 0,
                resource: { buffer: this.#siteBuffer },
            },
        ];
    }

    /**
     * Releases GPU resources.
     */
    destroy(): void {
        this.#siteBuffer.destroy();
    }
}

/**
 * LDZ scene module for a radiolarian-like shell with contracted cell holes.
 */
export class RadiolarianLdzSceneModule implements LdzSceneModule<RadiolarianCpuData> {
    public static readonly GPU_SEED = 0;

    private static readonly FRAGMENT_SHADER = buildFragmentShader(
        RADIOLARIAN_PARAMS,
        FG_SRGB,
        BG_STOPS,
    );

    readonly id = "radiolarian";
    readonly fragmentShader = RadiolarianLdzSceneModule.FRAGMENT_SHADER;
    readonly fragmentEntryPoint = "main_fragment";
    readonly outputSpec = {
        mode: "ldz-plus-color",
        colorTextureFormat: "rgba8unorm",
    } as const;
    readonly bindGroupLayoutEntries: readonly GPUBindGroupLayoutEntry[] = [
        {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: {
                type: "read-only-storage",
            },
        },
    ];

    /**
     * Computes a dot product between two 3D vectors.
     *
     * @param lhs - Left-hand side vector.
     * @param rhs - Right-hand side vector.
     * @returns Dot product.
     */
    private static dot(lhs: Vec3, rhs: Vec3): number {
        return lhs[0] * rhs[0] + lhs[1] * rhs[1] + lhs[2] * rhs[2];
    }

    /**
     * Computes a cross product between two 3D vectors.
     *
     * @param lhs - Left-hand side vector.
     * @param rhs - Right-hand side vector.
     * @returns Cross product.
     */
    private static cross(lhs: Vec3, rhs: Vec3): Vec3 {
        return [
            lhs[1] * rhs[2] - lhs[2] * rhs[1],
            lhs[2] * rhs[0] - lhs[0] * rhs[2],
            lhs[0] * rhs[1] - lhs[1] * rhs[0],
        ];
    }

    /**
     * Normalizes a 3D vector.
     *
     * @param value - Input vector.
     * @returns Unit-length vector.
     */
    private static normalize(value: Vec3): Vec3 {
        const length = Math.hypot(value[0], value[1], value[2]);
        if (length <= 1e-12) {
            return [1.0, 0.0, 0.0];
        }
        return [value[0] / length, value[1] / length, value[2] / length];
    }

    /**
     * Computes a stable tangent frame for a unit normal.
     *
     * @param normal - Unit site normal.
     * @returns Orthonormal frame vectors u and v.
     */
    private static computeTangentFrame(normal: Vec3): { tangentU: Vec3; tangentV: Vec3 } {
        const reference: Vec3 = Math.abs(normal[1]) < 0.9 ? [0.0, 1.0, 0.0] : [1.0, 0.0, 0.0];
        const tangentU = RadiolarianLdzSceneModule.normalize(
            RadiolarianLdzSceneModule.cross(reference, normal),
        );
        const tangentV = RadiolarianLdzSceneModule.cross(normal, tangentU);
        return { tangentU, tangentV };
    }

    /**
     * Builds brute-force angular KNN neighbors by descending dot product.
     *
     * @param sites - Unit sphere sites.
     * @param neighborCount - Number of neighbors per site.
     * @returns KNN index list per site.
     */
    private static buildKnnNeighbors(
        sites: readonly Vec3[],
        neighborCount: number,
    ): number[][] {
        return sites.map((site, siteIndex) => {
            const candidates: { index: number; alignment: number }[] = [];
            for (let neighborIndex = 0; neighborIndex < sites.length; neighborIndex++) {
                if (neighborIndex === siteIndex) {
                    continue;
                }
                candidates.push({
                    index: neighborIndex,
                    alignment: RadiolarianLdzSceneModule.dot(site, sites[neighborIndex]),
                });
            }
            candidates.sort((lhs, rhs) => rhs.alignment - lhs.alignment);
            return candidates.slice(0, neighborCount).map((candidate) => candidate.index);
        });
    }

    /**
     * Generates site positions and precomputed neighbor constraints.
     *
     * @param seed - Shared deterministic seed.
     * @param dimensions - Current render dimensions.
     * @returns Packed per-site GPU data.
     */
    createCpuData(seed: number, dimensions: AppDimensions): RadiolarianCpuData {
        void dimensions;
        const pointCount = RADIOLARIAN_PARAMS.pointCount;
        const maxNeighbors = RADIOLARIAN_PARAMS.maxNeighbors;
        const goldenAngle = Math.PI * (3.0 - Math.sqrt(5.0));
        const rng = createSfc32(BigInt(seed >>> 0));
        const jitterAmplitude =
            RADIOLARIAN_PARAMS.jitterStrength / Math.sqrt(Math.max(pointCount, 1));

        const sites: Vec3[] = [];
        for (let index = 0; index < pointCount; index++) {
            const y = 1.0 - ((index + 0.5) / pointCount) * 2.0;
            const radial = Math.sqrt(Math.max(0.0, 1.0 - y * y));
            const angle = index * goldenAngle;
            const baseSite: Vec3 = [Math.cos(angle) * radial, y, Math.sin(angle) * radial];
            const baseFrame = RadiolarianLdzSceneModule.computeTangentFrame(baseSite);

            const jitterRawX = rng() * 2.0 - 1.0;
            const jitterRawY = rng() * 2.0 - 1.0;
            const jitterRawLength = Math.hypot(jitterRawX, jitterRawY);
            const jitterNormalization = jitterRawLength > 1.0 ? 1.0 / jitterRawLength : 1.0;
            const jitterX = jitterRawX * jitterNormalization;
            const jitterY = jitterRawY * jitterNormalization;

            const jitteredSite = RadiolarianLdzSceneModule.normalize([
                baseSite[0] +
                    jitterAmplitude *
                        (jitterX * baseFrame.tangentU[0] + jitterY * baseFrame.tangentV[0]),
                baseSite[1] +
                    jitterAmplitude *
                        (jitterX * baseFrame.tangentU[1] + jitterY * baseFrame.tangentV[1]),
                baseSite[2] +
                    jitterAmplitude *
                        (jitterX * baseFrame.tangentU[2] + jitterY * baseFrame.tangentV[2]),
            ]);
            sites.push(jitteredSite);
        }

        const frames = sites.map((site) =>
            RadiolarianLdzSceneModule.computeTangentFrame(site),
        );
        const knnNeighbors = RadiolarianLdzSceneModule.buildKnnNeighbors(sites, maxNeighbors);
        const knnSets = knnNeighbors.map((neighbors) => new Set<number>(neighbors));

        const floatsPerVec4 = 4;
        const staticVec4Count = 4;
        const constraintsVec4Offset = staticVec4Count;
        const vec4PerSite = staticVec4Count + maxNeighbors;
        const floatsPerSite = vec4PerSite * floatsPerVec4;
        const siteData: Float32Array<ArrayBuffer> = new Float32Array(
            pointCount * floatsPerSite,
        );

        for (let siteIndex = 0; siteIndex < pointCount; siteIndex++) {
            const site = sites[siteIndex];
            const frame = frames[siteIndex];

            const mutualNeighbors = knnNeighbors[siteIndex].filter((neighborIndex) =>
                knnSets[neighborIndex].has(siteIndex),
            );
            const selectedNeighbors =
                mutualNeighbors.length > 0 ? mutualNeighbors : knnNeighbors[siteIndex];

            const siteBase = siteIndex * floatsPerSite;
            const siteOffset = siteBase;
            const tangentUOffset = siteOffset + floatsPerVec4;
            const tangentVOffset = tangentUOffset + floatsPerVec4;
            const metadataOffset = tangentVOffset + floatsPerVec4;
            const constraintsOffset = siteBase + constraintsVec4Offset * floatsPerVec4;

            siteData[siteOffset] = site[0];
            siteData[siteOffset + 1] = site[1];
            siteData[siteOffset + 2] = site[2];
            siteData[siteOffset + 3] = 0.0;

            siteData[tangentUOffset] = frame.tangentU[0];
            siteData[tangentUOffset + 1] = frame.tangentU[1];
            siteData[tangentUOffset + 2] = frame.tangentU[2];
            siteData[tangentUOffset + 3] = 0.0;

            siteData[tangentVOffset] = frame.tangentV[0];
            siteData[tangentVOffset + 1] = frame.tangentV[1];
            siteData[tangentVOffset + 2] = frame.tangentV[2];
            siteData[tangentVOffset + 3] = 0.0;

            const clampedNeighborCount = Math.min(selectedNeighbors.length, maxNeighbors);
            siteData[metadataOffset] = clampedNeighborCount;
            siteData[metadataOffset + 1] = 0.0;
            siteData[metadataOffset + 2] = 0.0;
            siteData[metadataOffset + 3] = 0.0;

            for (
                let constraintIndex = 0;
                constraintIndex < clampedNeighborCount;
                constraintIndex++
            ) {
                const neighborSite = sites[selectedNeighbors[constraintIndex]];
                const a = RadiolarianLdzSceneModule.dot(frame.tangentU, neighborSite);
                const b = RadiolarianLdzSceneModule.dot(frame.tangentV, neighborSite);
                const c = 1.0 - RadiolarianLdzSceneModule.dot(site, neighborSite);
                const length = Math.hypot(a, b);
                const safeInverseLength = length > 1e-6 ? 1.0 / length : 0.0;
                const cContracted =
                    c - RADIOLARIAN_PARAMS.contractionMargin * Math.max(length, 1e-6);

                const constraintBase = constraintsOffset + constraintIndex * floatsPerVec4;
                siteData[constraintBase] = a;
                siteData[constraintBase + 1] = b;
                siteData[constraintBase + 2] = cContracted;
                siteData[constraintBase + 3] = safeInverseLength;
            }
        }

        return {
            siteData,
        };
    }

    /**
     * Uploads scene data into WebGPU resources.
     *
     * @param device - Active GPU device.
     * @param queue - Active GPU queue.
     * @param cpuData - Scene CPU data.
     * @returns Scene bindable GPU resources.
     */
    createGpuResources(
        device: GPUDevice,
        queue: GPUQueue,
        cpuData: RadiolarianCpuData,
    ): LdzSceneGpuResources {
        const siteBuffer = device.createBuffer({
            size: cpuData.siteData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        queue.writeBuffer(siteBuffer, 0, cpuData.siteData);

        return new RadiolarianGpuResources(siteBuffer);
    }
}
