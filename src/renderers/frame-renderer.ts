/**
 * Frame payload produced by the WebGPU stage.
 */
export type FrameData = {
    width: number;
    height: number;
    ldzData: Float32Array;
    /**
     * Optional scene-defined color payload, packed as vec4 per pixel.
     */
    colorData?: Float32Array;
    /**
     * Optional semantic tag describing how to interpret `colorData`.
     */
    colorDataTag?: string;
};

/**
 * Common frame renderer contract used by the NPR stage.
 */
export interface FrameRenderer {
    /**
     * Renders frame data in tiled mode.
     */
    renderFrameTiled(): Promise<void>;

    /**
     * Returns the latest frame data payload.
     *
     * @returns LDZ data with optional scene-defined color payload.
     */
    getFrameData(): FrameData;

    /**
     * Rebuilds size-dependent resources from state dimensions.
     */
    adaptToDimensions(): void;
}
