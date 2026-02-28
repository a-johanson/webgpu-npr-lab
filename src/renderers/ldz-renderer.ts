/**
 * Common LDZ renderer contract used by the NPR stage.
 */
export interface LdzRenderer {
    /**
     * Renders luminance, direction, and depth data in tiled mode.
     */
    renderLdzTiled(): Promise<void>;

    /**
     * Returns the latest LDZ pixel buffer.
     *
     * @returns Interleaved LDZ data in RGBA layout.
     */
    getLdzData(): Float32Array;

    /**
     * Rebuilds size-dependent resources from state dimensions.
     */
    adaptToDimensions(): void;
}
