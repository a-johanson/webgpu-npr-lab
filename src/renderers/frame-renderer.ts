/**
 * Frame payload produced by the WebGPU stage.
 */
export type FrameData = {
    width: number;
    height: number;
    ldzData: Float32Array;
    /**
     * Optional color payload, packed as 8-bit RGBA per pixel.
     */
    colorData?: Uint8Array;
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
