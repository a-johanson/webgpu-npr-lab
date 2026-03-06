/**
 * Shared NPR render context values.
 */
export type NprProgramRenderContext = {
    ctx2d: CanvasRenderingContext2D;
    ldzData: Float32Array;
    colorData?: Float32Array;
    colorDataTag?: string;
    width: number;
    height: number;
    dpi: number;
    seed: string;
};

/**
 * NPR program contract for rendering from LDZ data.
 */
export interface NprProgramModule {
    /**
     * Stable program identifier.
     */
    readonly id: string;

    /**
     * Renders NPR output from LDZ data.
     *
     * @param context - Render context values.
     */
    renderFromLdz(context: NprProgramRenderContext): void;
}
