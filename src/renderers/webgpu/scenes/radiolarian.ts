import { prng_xor4096 } from "xor4096";
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
    cornerSmoothness: number;
    csgSmoothness: number;
};

const RADIOLARIAN_PARAMS: RadiolarianParameters = {
    pointCount: 100,
    maxNeighbors: 8,
    jitterStrength: 0.8,
    contractionMargin: 0.02,
    corridorScale: 1.5,
    shellRadius: 1.0,
    shellThickness: 0.05,
    cornerSmoothness: 0.13 / 6.0,
    csgSmoothness: 0.05 / 6.0,
};

const buildFragmentShader = (parameters: RadiolarianParameters): string => `
struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

struct GlobalUniforms {
    aspect: f32,
    seed: u32,
    _pad0: u32,
    _pad1: u32,
    tile_offset: vec2f,
    tile_scale: vec2f,
};

const MAX_NEIGHBORS: u32 = ${parameters.maxNeighbors}u;
const POINT_COUNT: u32 = ${parameters.pointCount}u;
const CORRIDOR_SCALE: f32 = ${parameters.corridorScale};
const SHELL_RADIUS: f32 = ${parameters.shellRadius};
const SHELL_THICKNESS: f32 = ${parameters.shellThickness};
const CORNER_SMOOTHNESS: f32 = ${parameters.cornerSmoothness};
const CSG_SMOOTHNESS: f32 = ${parameters.csgSmoothness};

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

fn scene_sdf(p: vec3f) -> f32 {
    // 1) Base shell band around SHELL_RADIUS with thickness SHELL_THICKNESS.
    let radius = length(p);
    let d_shell = abs(radius - SHELL_RADIUS) - 0.5 * SHELL_THICKNESS;

    let point_count = POINT_COUNT;
    if (point_count == 0u) {
        return d_shell;
    }

    // Normalize p to a unit direction for spherical ownership and boundary tests.
    let safe_radius = max(radius, 1e-6);
    let direction = p / safe_radius;

    // 2) Owning-site selection.
    //    Search a corridor in index space, then pick owner_index by maximum alignment
    //    max(dot(direction, sites[i].site.xyz)).
    let point_count_f = f32(point_count);
    let approximate_index = ((1.0 - direction.y) * point_count_f * 0.5) - 0.5;
    let center_index = i32(round(approximate_index));
    let corridor_half_width = i32(ceil(CORRIDOR_SCALE * sqrt(point_count_f)));

    let index_min = u32(max(center_index - corridor_half_width, 0));
    let index_max = u32(min(center_index + corridor_half_width, i32(point_count) - 1));

    var owner_index = index_min;
    var best_alignment = -2.0;
    for (var i = index_min; i <= index_max; i++) {
        let alignment = dot(direction, sites[i].site.xyz);
        if (alignment > best_alignment) {
            best_alignment = alignment;
            owner_index = i;
        }
    }

    // 3) Gnomonic projection to the owning site's tangent plane.
    //    gnomonic = direction / dot(direction, owner_normal) maps the sphere to the tangent plane
    //    at owner_normal. Voronoi boundaries on the sphere are great-circle arcs (equal-dot loci);
    //    under gnomonic projection they become straight lines on that plane.
    //    tangent_x/tangent_y are 2D coordinates in the owner's (owner_u, owner_v) frame.
    //    safe_denom is clamped only to avoid numerical blow-up near the tangent horizon.
    let owner = sites[owner_index];
    let owner_normal = owner.site.xyz;
    let owner_u = owner.tangent_u.xyz;
    let owner_v = owner.tangent_v.xyz;

    let safe_denom = max(dot(direction, owner_normal), 1e-4);
    let gnomonic = direction / safe_denom;
    let tangent_x = dot(gnomonic, owner_u);
    let tangent_y = dot(gnomonic, owner_v);

    // 4) Contracted cell footprint from precomputed half-plane constraints.
    //    Each neighbor defines a line in tangent coordinates:
    //      a * tangent_x + b * tangent_y - c_contracted = 0
    //    and signed_halfplane <= 0 selects the kept side.
    //    Geometrically, this line is the gnomonic image of the spherical bisector
    //    (a great-circle boundary between owner_normal and the neighbor direction),
    //    shifted inward by c_contracted for contraction.
    //    Smooth-max over all constraints gives a smooth intersection (d_poly < 0 inside).
    let constraint_count = u32(clamp(owner.metadata.x, 0.0, f32(MAX_NEIGHBORS)));
    var d_poly = 1e9;
    if (constraint_count > 0u) {
        d_poly = -1e9;
        for (var constraint_index: u32 = 0u; constraint_index < constraint_count; constraint_index++) {
            let constraint = owner.constraints[constraint_index];
            let a = constraint.x;
            let b = constraint.y;
            let c_contracted = constraint.z;
            let inverse_length = constraint.w;
            let signed_halfplane = (a * tangent_x + b * tangent_y - c_contracted) * inverse_length;
            d_poly = smax(d_poly, signed_halfplane, CORNER_SMOOTHNESS);
        }
    }

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

@fragment
fn main_fragment(in: VertexOut) -> @location(0) vec4f {
    // Ray setup.
    let uv = in.uv * 2.0 - 1.0;

    // Light setup.
    let light_dir = normalize(vec3f(0.5, 1.0, 2.0));

    // Camera setup.
    let cam_pos = vec3f(0.0, 0.0, 3.8);
    let cam_target = vec3f(0.0, 0.0, 0.0);
    let cam_up = vec3f(0.0, 1.0, 0.0);

    // Camera basis.
    let cam_forward = normalize(cam_target - cam_pos);
    let cam_right = normalize(cross(cam_forward, cam_up));
    let cam_true_up = cross(cam_right, cam_forward);

    let fov = radians(40.0);
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

    for (var step = 0; step < max_steps; step++) {
        let p = cam_pos + ray_dir * t;
        let d = scene_sdf(p);

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

    return vec4f(luminance, direction, depth);
}
`;

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
    private static readonly FRAGMENT_SHADER = buildFragmentShader(RADIOLARIAN_PARAMS);

    readonly id = "radiolarian";
    readonly fragmentShader = RadiolarianLdzSceneModule.FRAGMENT_SHADER;
    readonly fragmentEntryPoint = "main_fragment";
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
        const rng = prng_xor4096(seed);
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
