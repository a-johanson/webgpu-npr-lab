/**
 * Render and debug canvas dimensions.
 */
export type AppDimensions = {
    width: number;
    height: number;
    debugWidth: number;
    debugHeight: number;
};

/**
 * Shared application state shape.
 */
export type AppState = {
    gpuSeed: number;
    nprSeed: string;
    dpi: number;
    dimensions: AppDimensions;
    visualizationMode: number;
    nprIsDirty: boolean;
    isRendering: boolean;
};
