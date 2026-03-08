import type { AppDimensions } from "../../../types/app-state";
import type { LdzSceneGpuResources, LdzSceneModule } from "../ldz-scene-module";

const WGSL_FRAGMENT_SHADER = `
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

struct SceneMeta {
    point_count: u32,
    _pad0: u32,
    obj_radius: f32,
    _pad1: f32,
};

struct CrystalObject {
    position: vec3f,
    scale: f32,
    rotation: vec4f,
};

@group(0) @binding(0) var<uniform> global_uniforms: GlobalUniforms;
@group(1) @binding(0) var<storage, read> objects: array<CrystalObject>;
@group(1) @binding(1) var<uniform> scene_meta: SceneMeta;

// Cf. https://iquilezles.org/articles/distfunctions/
fn sd_cube(p: vec3f, half_extent: f32) -> f32 {
    let q = abs(p) - half_extent;
    return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn quat_rotate(p: vec3f, q: vec4f) -> vec3f {
    let t = 2.0 * cross(q.xyz, p);
    return p + q.w * t + cross(q.xyz, t);
}

// Cf. https://iquilezles.org/articles/smin/
fn smin(a: f32, b: f32, k_in: f32) -> f32 {
    let k = k_in * 6.0;
    let h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * h * k * (1.0 / 6.0);
}

fn scene_sdf(p: vec3f) -> f32 {
    // Number of points on the Fibonacci sphere.
    let point_count = scene_meta.point_count;
    let point_count_f = f32(point_count);

    // Optimization: estimate the central index i from the y-coordinate of p.
    let p_norm = normalize(p);
    let i_from_y = ((1.0 - p_norm.y) * point_count_f * 0.5) - 0.5;
    let i_approx = i32(round(i_from_y));

    // Calculate a search range ("corridor") of indices on the spiral.
    // To set a minimum search radius in terms of indices:
    // - Surface area around each point on the unit sphere scales ~1/N.
    // - Radius around each point scales ~1/sqrt(N).
    // - A fixed-size search band across the unit sphere scales ~N indices.
    // - Therefore, cover at least ~N/sqrt(N) = sqrt(N) indices.
    let min_index_radius = i32(ceil(sqrt(point_count_f)));
    let y_dist_per_index = 2.0 / max(point_count_f - 1.0, 1.0);
    let radius_from_obj = i32(ceil(1.85 * scene_meta.obj_radius / y_dist_per_index));
    let index_radius = max(min_index_radius, radius_from_obj);

    // Iterate over neighboring indices.
    let i_min = u32(max(i_approx - index_radius, 0));
    let i_max = u32(min(i_approx + index_radius, i32(point_count) - 1));

    let smoothing_dir = -normalize(vec3f(1.0, 2.0, 0.7));
    var fib_sphere = 1.0e6;

    // Check only objects within the calculated index corridor.
    for (var i = i_min; i <= i_max; i++) {
        let object = objects[i];
        let p_rot = quat_rotate(p - object.position, object.rotation);
        let cube = sd_cube(p_rot, object.scale * scene_meta.obj_radius);

        let smoothing_radius =
            0.015 + 0.085 * smoothstep(-1.0, 1.0, dot(p, smoothing_dir));
        fib_sphere = smin(fib_sphere, cube, smoothing_radius * scene_meta.obj_radius);
    }

    return fib_sphere;
}

// Cf. https://iquilezles.org/articles/normalsSDF/
fn calc_normal(p: vec3f) -> vec3f {
    let h = 0.001;
    let k = vec2f(1.0, -1.0);
    return normalize(
        k.xyy * scene_sdf(p + k.xyy * h) +
        k.yyx * scene_sdf(p + k.yyx * h) +
        k.yxy * scene_sdf(p + k.yxy * h) +
        k.xxx * scene_sdf(p + k.xxx * h)
    );
}

fn calc_ambient_occlusion(p: vec3f, normal: vec3f) -> f32 {
    let sample_count = 5;
    let max_distance = 0.1;
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
        weight *= 0.85;
    }
    // Normalize occlusion by theoretical maximum.
    return 1.0 - clamp(occlusion / max(max_occlusion, 1e-6), 0.0, 1.0);
}

fn calc_soft_shadow(p: vec3f, light_dir: vec3f) -> f32 {
    let epsilon = 0.001;
    let step_scale = 1.0;
    let min_distance = 30.0 * epsilon;
    let max_distance = 2.0;
    let max_steps = 100;
    let penumbra = 16.0;

    var shadow = 1.0;
    var t = min_distance;
    for (var i = 0; i < max_steps; i++) {
        let sample_point = p + light_dir * t;
        let dist = scene_sdf(sample_point);
        if (dist < epsilon) {
            return 0.0;
        }
        shadow = min(shadow, penumbra * dist / t);
        t += dist * step_scale;
        if (t > max_distance) {
            break;
        }
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
    let light_dir = normalize(vec3f(1.0, 2.0, 1.25));

    // Camera setup.
    let cam_pos = vec3f(0.0, 0.0, 5.0);
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
    let max_dist = 50.0;
    let max_steps = 200;
    let epsilon = 0.001;
    let orientation_offset = radians(90.0);
    let step_scale = 1.0;

    var luminance = 0.0;
    var direction = vec2f(0.0, 0.0);
    var depth = -1.0;

    var t = 0.0;

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
            let ao = calc_ambient_occlusion(p, normal);
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

            depth = dot(p_relative, cam_forward);
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
 * CPU-side data payload for the crystal scene.
 */
type CrystalCpuData = {
    objects: Float32Array<ArrayBuffer>;
    pointCount: number;
};

class CrystalGpuResources implements LdzSceneGpuResources {
    readonly bindGroupEntries: readonly GPUBindGroupEntry[];
    readonly #objectsBuffer: GPUBuffer;
    readonly #metaBuffer: GPUBuffer;

    /**
     * Creates scene GPU resources.
     *
     * @param objectsBuffer - Storage buffer with object data.
     * @param metaBuffer - Uniform buffer with metadata.
     */
    constructor(objectsBuffer: GPUBuffer, metaBuffer: GPUBuffer) {
        this.#objectsBuffer = objectsBuffer;
        this.#metaBuffer = metaBuffer;
        this.bindGroupEntries = [
            {
                binding: 0,
                resource: { buffer: this.#objectsBuffer },
            },
            {
                binding: 1,
                resource: { buffer: this.#metaBuffer },
            },
        ];
    }

    /**
     * Releases GPU resources.
     */
    destroy(): void {
        this.#objectsBuffer.destroy();
        this.#metaBuffer.destroy();
    }
}

/**
 * LDZ scene module for a crystal-like rotated cube SDF.
 */
export class CrystalLdzSceneModule implements LdzSceneModule<CrystalCpuData> {
    private static readonly POINT_COUNT = 1000;
    private static readonly BASE_RADIUS = 0.3;

    readonly id = "crystal";
    readonly fragmentShader = WGSL_FRAGMENT_SHADER;
    readonly fragmentEntryPoint = "main_fragment";
    readonly outputSpec = { mode: "ldz-only" } as const;
    readonly bindGroupLayoutEntries: readonly GPUBindGroupLayoutEntry[] = [
        {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: {
                type: "read-only-storage",
            },
        },
        {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: {
                type: "uniform",
            },
        },
    ];

    /**
     * PCG hash function (https://www.pcg-random.org/).
     *
     * @param value - Input value.
     * @returns Hashed uint32 value.
     */
    private static pcgHash(value: number): number {
        const state = (Math.imul(value >>> 0, 747796405) + 2891336453) >>> 0;
        const shift = ((state >>> 28) + 4) >>> 0;
        const word = Math.imul(((state >>> shift) ^ state) >>> 0, 277803737) >>> 0;
        return ((word >>> 22) ^ word) >>> 0;
    }

    /**
     * Generates a reproducible random float in [0, 1).
     *
     * @param value - Input seed value.
     * @param seed - Shared deterministic seed.
     * @returns Random float in [0, 1).
     */
    private static rand(value: number, seed: number): number {
        const hashed = CrystalLdzSceneModule.pcgHash((value + (seed >>> 0)) >>> 0);
        return hashed / 0xffffffff;
    }

    /**
     * Samples a random unit quaternion from three random values.
     *
     * @param x - First random sample in [0, 1).
     * @param y - Second random sample in [0, 1).
     * @param z - Third random sample in [0, 1).
     * @returns Quaternion components [x, y, z, w].
     */
    private static randomQuaternion(
        x: number,
        y: number,
        z: number,
    ): [number, number, number, number] {
        const sqrt1 = Math.sqrt(1.0 - x);
        const sqrt2 = Math.sqrt(x);
        const theta1 = 2.0 * Math.PI * y;
        const theta2 = 2.0 * Math.PI * z;

        const qx = sqrt1 * Math.sin(theta1);
        const qy = sqrt1 * Math.cos(theta1);
        const qz = sqrt2 * Math.sin(theta2);
        const qw = sqrt2 * Math.cos(theta2);

        return [qx, qy, qz, qw];
    }

    /**
     * Generates deterministic crystal object data.
     *
     * @param seed - Shared deterministic seed.
     * @param dimensions - Current render dimensions.
     * @returns Packed object data and count.
     */
    createCpuData(seed: number, dimensions: AppDimensions): CrystalCpuData {
        void dimensions;

        const pointCount = CrystalLdzSceneModule.POINT_COUNT;
        const data: Float32Array<ArrayBuffer> = new Float32Array(pointCount * 8);
        const goldenAngle = Math.PI * (3.0 - Math.sqrt(5.0));
        const seedU32 = seed >>> 0;

        for (let index = 0; index < pointCount; index++) {
            const y = 1.0 - ((index + 0.5) / pointCount) * 2.0;
            const r = Math.sqrt(Math.max(0.0, 1.0 - y * y));
            const angle = index * goldenAngle;

            const randomX = CrystalLdzSceneModule.rand(index, seedU32);
            const randomY = CrystalLdzSceneModule.rand(index + pointCount, seedU32);
            const randomZ = CrystalLdzSceneModule.rand(index + 2 * pointCount, seedU32);
            const [qx, qy, qz, qw] = CrystalLdzSceneModule.randomQuaternion(
                randomX,
                randomY,
                randomZ,
            );
            const scaleRandom = CrystalLdzSceneModule.rand(index + 3 * pointCount, seedU32);
            const scale = scaleRandom * 0.7 + 0.5;

            const base = index * 8;
            data[base] = Math.cos(angle) * r;
            data[base + 1] = y;
            data[base + 2] = Math.sin(angle) * r;
            data[base + 3] = scale;
            data[base + 4] = qx;
            data[base + 5] = qy;
            data[base + 6] = qz;
            data[base + 7] = qw;
        }

        return {
            objects: data,
            pointCount,
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
        cpuData: CrystalCpuData,
    ): LdzSceneGpuResources {
        const objectsBuffer = device.createBuffer({
            size: cpuData.objects.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        queue.writeBuffer(objectsBuffer, 0, cpuData.objects);

        const sceneMetaBuffer = new ArrayBuffer(16);
        const sceneMetaView = new DataView(sceneMetaBuffer);
        sceneMetaView.setUint32(0, cpuData.pointCount, true);
        sceneMetaView.setUint32(4, 0, true);
        sceneMetaView.setFloat32(8, CrystalLdzSceneModule.BASE_RADIUS, true);
        sceneMetaView.setFloat32(12, 0, true);

        const metaBuffer = device.createBuffer({
            size: sceneMetaBuffer.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        queue.writeBuffer(metaBuffer, 0, sceneMetaBuffer);

        return new CrystalGpuResources(objectsBuffer, metaBuffer);
    }
}
