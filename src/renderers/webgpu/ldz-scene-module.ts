import type { AppDimensions } from "../../types/app-state";

/**
 * Shared uniforms consumed by all LDZ fragment shaders.
 */
export type LdzGlobalUniforms = {
    aspect: number;
    seed: number;
    tileOffsetX: number;
    tileOffsetY: number;
    tileScaleX: number;
    tileScaleY: number;
};

/**
 * Declares whether a scene shader writes only LDZ or LDZ plus opaque color payload.
 */
export type LdzSceneOutputSpec =
    | {
          mode: "ldz-only";
      }
    | {
          mode: "ldz-plus-color";
          colorDataTag: string;
      };

/**
 * Scene-owned GPU resource set.
 */
export interface LdzSceneGpuResources {
    /**
     * Bind group entries matching the scene bind-group layout.
     */
    readonly bindGroupEntries: readonly GPUBindGroupEntry[];

    /**
     * Releases GPU resources held by this set.
     */
    destroy(): void;
}

/**
 * Scene contract for LDZ rendering in WebGPU.
 *
 * @typeParam TCpuData - Scene-specific CPU data shape.
 */
export interface LdzSceneModule<TCpuData> {
    /**
     * Stable scene identifier.
     */
    readonly id: string;

    /**
     * WGSL fragment source that writes LDZ values.
     */
    readonly fragmentShader: string;

    /**
     * WGSL entry point name.
     */
    readonly fragmentEntryPoint: string;

    /**
     * Output shape produced by the scene fragment shader.
     */
    readonly outputSpec: LdzSceneOutputSpec;

    /**
     * Scene bind-group layout entries.
     */
    readonly bindGroupLayoutEntries: readonly GPUBindGroupLayoutEntry[];

    /**
     * Builds scene-specific CPU data from current dimensions and seed.
     *
     * @param seed - Shared deterministic seed for GPU stage.
     * @param dimensions - Active render dimensions.
     * @returns Scene CPU data payload.
     */
    createCpuData(seed: number, dimensions: AppDimensions): TCpuData;

    /**
     * Uploads scene-specific data to GPU resources.
     *
     * @param device - Target GPU device.
     * @param queue - Target queue.
     * @param cpuData - Scene CPU data.
     * @returns GPU resource set for bind-group creation.
     */
    createGpuResources(
        device: GPUDevice,
        queue: GPUQueue,
        cpuData: TCpuData,
    ): LdzSceneGpuResources;
}
