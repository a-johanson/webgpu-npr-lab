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

struct Point {
    position: vec3f,
    radius: f32,
};

@group(0) @binding(0) var<uniform> global_uniforms: GlobalUniforms;
@group(1) @binding(0) var<storage, read> points: array<Point>;
@group(1) @binding(1) var<uniform> scene_meta: SceneMeta;

fn sd_sphere(p: vec3f, r: f32) -> f32 {
    return length(p) - r;
}

fn sd_plane(p: vec3f, n: vec3f, h: f32) -> f32 {
    return dot(p, n) - h;
}

// Cf. https://iquilezles.org/articles/smin/
fn smin(a: f32, b: f32, k_in: f32) -> f32 {
    let k = k_in * 6.0;
    let h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * h * k * (1.0 / 6.0);
}

fn smax(a: f32, b: f32, k: f32) -> f32 {
    return -smin(-a, -b, k);
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
    let radius_from_obj = i32(ceil(1.05 * scene_meta.obj_radius / y_dist_per_index));
    let index_radius = max(min_index_radius, radius_from_obj);

    // Iterate over neighboring indices.
    let i_min = u32(max(i_approx - index_radius, 0));
    let i_max = u32(min(i_approx + index_radius, i32(point_count) - 1));

    var fib_sphere = 1.0e6;

    // Check only objects within the calculated index corridor.
    for (var i = i_min; i <= i_max; i++) {
        let sphere = sd_sphere(p - points[i].position, points[i].radius);
        fib_sphere = smin(fib_sphere, sphere, 0.0035);
    }

    let onion_sphere = abs(min(fib_sphere, sd_sphere(p, 1.1))) - 0.05;
    let half_space = sd_plane(p, normalize(vec3f(-0.5, 1.0, 1.0)), 0.28);
    let cut_sphere = smax(onion_sphere, half_space, 0.0075);

    return cut_sphere;
}

fn scene_ground(p: vec3f) -> f32 {
    return p.y + 1.0 + 0.5 * scene_meta.obj_radius + 0.15;
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
    let light_dir = normalize(vec3f(0.5, 2.0, 3.25));

    // Camera setup.
    let cam_pos = vec3f(0.0, 0.0, 5.0);
    let cam_target = vec3f(0.025, -0.1, 0.0);
    let cam_up = vec3f(0.0, 1.0, 0.0);

    // Camera basis.
    let cam_forward = normalize(cam_target - cam_pos);
    let cam_right = normalize(cross(cam_forward, cam_up));
    let cam_true_up = cross(cam_right, cam_forward);

    let fov = radians(37.0);
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
    let orientation_offset = radians(90.0);
    let step_scale = 1.0;

    var luminance = 0.0;
    var direction = vec2f(0.0, 0.0);
    var depth = -1.0;

    var t = 0.0;

    for (var step = 0; step < max_steps; step++) {
        let p = cam_pos + ray_dir * t;
        let d_scene = scene_sdf(p);
        let d_ground = scene_ground(p);

        if (d_scene < epsilon) {
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

            depth = dot(p_relative, cam_forward);
            break;
        }

        if (d_ground < epsilon) {
            let shadow = calc_ambient_occlusion(p, light_dir, 0.2, 8);
            if (shadow < 1.0) {
                let shadow_strength = 1.0;
                luminance = shadow_strength * shadow + (1.0 - shadow_strength);
                direction = vec2f(1.0, 0.0);
                depth = dot(p - cam_pos, cam_forward);
            }
            break;
        }

        if (t > max_dist) {
            break;
        }

        t += step_scale * min(d_scene, d_ground);
    }

    return vec4f(luminance, direction, depth);
}
`;

/**
 * CPU-side data payload for the shell scene.
 */
type ShellCpuData = {
    points: Float32Array;
    pointCount: number;
};

class ShellGpuResources implements LdzSceneGpuResources {
    readonly bindGroupEntries: readonly GPUBindGroupEntry[];
    readonly #pointsBuffer: GPUBuffer;
    readonly #metaBuffer: GPUBuffer;

    /**
     * Creates scene GPU resources.
     *
     * @param pointsBuffer - Storage buffer with point data.
     * @param metaBuffer - Uniform buffer with metadata.
     */
    constructor(pointsBuffer: GPUBuffer, metaBuffer: GPUBuffer) {
        this.#pointsBuffer = pointsBuffer;
        this.#metaBuffer = metaBuffer;
        this.bindGroupEntries = [
            {
                binding: 0,
                resource: { buffer: this.#pointsBuffer },
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
        this.#pointsBuffer.destroy();
        this.#metaBuffer.destroy();
    }
}

/**
 * LDZ scene module for a shell-like point cloud SDF.
 */
export class ShellLdzSceneModule implements LdzSceneModule<ShellCpuData> {
    private static readonly POINT_COUNT = 70;
    private static readonly BASE_RADIUS = 0.39;

    readonly id = "shell";
    readonly fragmentShader = WGSL_FRAGMENT_SHADER;
    readonly fragmentEntryPoint = "main_fragment";
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
     * Generates a deterministic Fibonacci point cloud.
     *
     * @param seed - Shared deterministic seed.
     * @param dimensions - Current render dimensions.
     * @returns Packed point data and count.
     */
    createCpuData(seed: number, dimensions: AppDimensions): ShellCpuData {
        void seed;
        void dimensions;

        const pointCount = ShellLdzSceneModule.POINT_COUNT;
        const data = new Float32Array(pointCount * 4);
        const goldenAngle = Math.PI * (3.0 - Math.sqrt(5.0));

        for (let index = 0; index < pointCount; index++) {
            const y = 1.0 - ((index + 0.5) / pointCount) * 2.0;
            const r = Math.sqrt(Math.max(0.0, 1.0 - y * y));
            const angle = index * goldenAngle;

            data[index * 4] = Math.cos(angle) * r;
            data[index * 4 + 1] = y;
            data[index * 4 + 2] = Math.sin(angle) * r;
            data[index * 4 + 3] = ShellLdzSceneModule.BASE_RADIUS;
        }

        return {
            points: data,
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
        cpuData: ShellCpuData,
    ): LdzSceneGpuResources {
        const pointsBuffer = device.createBuffer({
            size: cpuData.points.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        const pointUploadData = new Float32Array(cpuData.points.length);
        pointUploadData.set(cpuData.points);
        queue.writeBuffer(pointsBuffer, 0, pointUploadData);

        const sceneMetaBuffer = new ArrayBuffer(16);
        const sceneMetaView = new DataView(sceneMetaBuffer);
        sceneMetaView.setUint32(0, cpuData.pointCount, true);
        sceneMetaView.setUint32(4, 0, true);
        sceneMetaView.setFloat32(8, ShellLdzSceneModule.BASE_RADIUS, true);
        sceneMetaView.setFloat32(12, 0, true);

        const metaBuffer = device.createBuffer({
            size: sceneMetaBuffer.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        queue.writeBuffer(metaBuffer, 0, sceneMetaBuffer);

        return new ShellGpuResources(pointsBuffer, metaBuffer);
    }
}
