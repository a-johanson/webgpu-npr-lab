/**
 * Crystal fragment shader source.
 */
export const fragmentShader = `#version 300 es
precision highp float;

#define M_PI 3.14159265358979323846

in vec2 v_uv;
out vec4 out_ldz;

uniform float u_aspect; // Aspect ratio
uniform uint u_prng_seed; // PRNG seed


// Cf. https://www.shadertoy.com/view/XlGcRh and https://www.pcg-random.org/
uint pcg(uint v) {
	uint state = v * 747796405u + 2891336453u;
	uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
	return (word >> 22u) ^ word;
}

float rand(uint seed) {
    uint r = pcg(seed + u_prng_seed);
    return float(r) / float(0xffffffffu);
}

vec3 rand3(uint seed, uint stride) {
    return vec3(rand(seed), rand(seed + stride), rand(seed + 2u * stride));
}

// Cf. https://iquilezles.org/articles/distfunctions/
float sd_cube(vec3 p, float a) {
  vec3 q = abs(p) - a;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

vec4 random_quaternion(vec3 rand) {
    float sqrt1 = sqrt(1.0 - rand.x);
    float sqrt2 = sqrt(rand.x);
    float theta1 = 2.0 * M_PI * rand.y;
    float theta2 = 2.0 * M_PI * rand.z;

    float x = sqrt1 * sin(theta1);
    float y = sqrt1 * cos(theta1);
    float z = sqrt2 * sin(theta2);
    float w = sqrt2 * cos(theta2);

    return vec4(x, y, z, w);
}

// Rotates vector p by quaternion q (q must be normalized)
vec3 quat_rotate(vec3 p, vec4 q) {
    vec3 t = 2.0 * cross(q.xyz, p);
    return p + q.w * t + cross(q.xyz, t);
}

// Cf. https://iquilezles.org/articles/smin/
float smin(float a, float b, float k) {
    k *= 6.0;
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * h * k * (1.0 / 6.0);
}

float scene(vec3 p) {
    const uint N = 1000u; // Number of points on the Fibonacci sphere
    const float N_f = float(N);
    const float GOLDEN_ANGLE = M_PI * (3.0 - sqrt(5.0));
    const float OBJ_RADIUS = 0.3;

    // Optimization: we only want to compute the distance to objects on the spiral points that are close to p.
    // 1. Estimate the central index i from the y-coordinate of p.
    vec3 p_norm = normalize(p);
    float i_from_y = ((1.0 - p_norm.y) * N_f * 0.5) - 0.5; // <=> y = 1 - 2 * ((i + 0.5) / N)
    int i_approx = int(round(i_from_y));


    // 2. Calculate a search range ("corridor") of indices on the spiral.

    // To set a minimum search radius in terms of indices:
    // The surface area around each point on the unit sphere scales ~1/N.
    // Therefore, the radius around each point scales ~1/sqrt(N).
    // Any fixed size search band across the unit sphere, scales ~N in terms of indices to cover.
    // Therefore, to cover the radius around each point, we need to cover at least ~N/sqrt(N) = sqrt(N) indices.
    int min_index_radius = int(ceil(sqrt(N_f)));

    float y_dist_per_index = 2.0 / (N_f - 1.0);
    int radius_from_obj = int(ceil(1.85 * OBJ_RADIUS / y_dist_per_index));
    int index_radius = max(min_index_radius, radius_from_obj);


    // 3. Iterate over neighboring indices.
    uint i_min = uint(max(i_approx - index_radius, 0));
    uint i_max = uint(min(i_approx + index_radius, int(N) - 1));

    float fib_sphere = 1.0e6;

    // 4. Check only the objects within the calculated index corridor.
    const vec3 smoothing_dir = -normalize(vec3(1.0, 2.0, 0.7));
    for (uint i = i_min; i <= i_max; i++) {
    float y = 1.0 - ((float(i) + 0.5) / N_f) * 2.0;
        float r = sqrt(1.0 - y * y);
        float angle = float(i) * GOLDEN_ANGLE;

        vec3 objPos = vec3(cos(angle) * r, y, sin(angle) * r);

        vec4 q = random_quaternion(rand3(i, N));
        vec3 p_rot = quat_rotate(p - objPos, q);
        float scale = rand(i + 3u * N) * 0.7 + 0.5;
        float cube = sd_cube(p_rot, scale * OBJ_RADIUS);
        float smoothing_radius = 0.015 + 0.085 * smoothstep(-1.0, 1.0, dot(p, smoothing_dir));
        fib_sphere = smin(fib_sphere, cube, smoothing_radius * OBJ_RADIUS);
    }

    return fib_sphere;
}

// Cf. https://iquilezles.org/articles/normalsSDF/
vec3 calc_normal(vec3 p) {
    const float h = 0.001;
    const vec2 k = vec2(1, -1);
    return normalize(k.xyy * scene(p + k.xyy * h) + 
                     k.yyx * scene(p + k.yyx * h) + 
                     k.yxy * scene(p + k.yxy * h) + 
                     k.xxx * scene(p + k.xxx * h));
}

float calc_ambient_occlusion(vec3 p, vec3 normal) {
    const int numSamples = 5;
    const float maxDistance = 0.1;
    float occlusion = 0.0;
    float maxOcclusion = 0.0;
    float weight = 1.0;
    float stepSize = maxDistance / float(numSamples);
    for (int i = 1; i <= numSamples; i++) {
        float sampleDistance = stepSize * float(i);
        vec3 samplePoint = p + normal * sampleDistance;
        float distanceToSurface = scene(samplePoint);
        // If geometry is close, increase occlusion
        occlusion += (sampleDistance - distanceToSurface) * weight;
        maxOcclusion += sampleDistance * weight;
        weight *= 0.85;
    }
    // Normalize occlusion by theoretical maximum
    float ao = 1.0 - clamp(occlusion / maxOcclusion, 0.0, 1.0);
    return ao;
}

float calc_soft_shadow(vec3 p, vec3 light_dir) {
    const float epsilon = 0.001;
    const float step_scale = 1.0;
    const float min_distance = 30.0 * epsilon;
    const float max_distance = 2.0;
    const int max_steps = 100;
    const float penumbra = 16.0;

    float shadow = 1.0;
    float t = min_distance;
    for (int i = 0; i < max_steps; i++) {
        vec3 sample_point = p + light_dir * t;
        float dist = scene(sample_point);
        if (dist < epsilon) {
            return 0.0; // Fully shaded
        }
        shadow = min(shadow, penumbra * dist / t);
        t += dist * step_scale;
        if (t > max_distance) {
            break;
        }
    }
    return clamp(shadow, 0.0, 1.0);
}

float calc_fresnel(vec3 view_direction, vec3 normal) {
    const float exponent = 3.0;
    float cos_theta = clamp(dot(view_direction, normal), 0.0, 1.0);
    float fresnel = pow(1.0 - cos_theta, exponent);
    return fresnel;
}

void main() {
    // Ray setup
    vec2 uv = v_uv * 2.0 - 1.0;

    // Light setup
    const vec3 light_dir = normalize(vec3(1.0, 2.0, 1.25));

    // Camera setup
    const vec3 cam_pos = vec3(0.0, 0.0, 5.0);
    const vec3 cam_target = vec3(0.0, 0.0, 0.0);
    const vec3 cam_up = vec3(0.0, 1.0, 0.0);

    // Camera basis
    const vec3 cam_forward = normalize(cam_target - cam_pos);
    const vec3 cam_right = normalize(cross(cam_forward, cam_up));
    const vec3 cam_true_up = cross(cam_right, cam_forward);

    const float fov = 40.0 * M_PI / 180.0;
    const float fov_scale = tan(0.5 * fov);

    vec3 ray_dir = normalize(
        cam_right * uv.x * u_aspect * fov_scale +
        cam_true_up * uv.y * fov_scale +
        cam_forward
    );

    // Ray marching
    const float max_dist = 50.0;
    const int max_steps = 200;
    const float epsilon = 0.001;
    const float orientation_offset = 0.5 * M_PI;
    const float step_scale = 1.0;

    float luminance = 0.0;
    vec2 surface_direction = vec2(0.0);
    float z_value = -1.0;

    float t = 0.0;

    for (int i = 0; i < max_steps; i++) {
        vec3 p = cam_pos + ray_dir * t;
        float d = scene(p);

        if (d < epsilon) {
            vec3 normal = calc_normal(p);
            vec3 p_relative = p - cam_pos;

            // Simple lighting (luminance)
            float normal_amount = dot(normal, light_dir);

            float diffuse_light = max(0.0, normal_amount);
            float shadow = calc_soft_shadow(p, light_dir);
            float ao = calc_ambient_occlusion(p, normal);
            float fresnel = calc_fresnel(-ray_dir, normal);
            luminance = 0.8 * diffuse_light * shadow + 0.2 * ao + 0.05 * fresnel;

            // Compute surface orientation and project to image plane
            vec3 a = normalize(light_dir - normal_amount * normal);
            vec3 b = cross(normal, a);
            vec3 ab_dir = cos(orientation_offset) * a + sin(orientation_offset) * b;
            vec3 p_plus  = p_relative + epsilon * ab_dir;
            vec3 p_minus = p_relative - epsilon * ab_dir;

            vec2 p_plus_clip = vec2(dot(p_plus, cam_right), dot(p_plus, cam_true_up));
            vec2 p_minus_clip = vec2(dot(p_minus, cam_right), dot(p_minus, cam_true_up));

            surface_direction = normalize(p_plus_clip - p_minus_clip);

            z_value = dot(p_relative, cam_forward);

            break;
        }

        if (t > max_dist) break;

        t += step_scale * d;
    }

    out_ldz = vec4(luminance, surface_direction, z_value);
}
`;
