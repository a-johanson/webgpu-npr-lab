// SpatialGrid: grid-based structure for fast point proximity queries

/**
 * A point stored in the spatial grid.
 */
type GridPoint = [number, number, unknown];

/**
 * A grid-based accelerator for point proximity queries.
 */
export class SpatialGrid {
    readonly cellSize: number;
    private readonly invCellSize: number;
    private readonly grid: Map<string, GridPoint[]>;

    /**
     * Creates a new spatial grid.
     *
     * @param cellSize - Cell size in world units.
     */
    constructor(cellSize: number) {
        this.cellSize = cellSize;
        this.invCellSize = 1 / cellSize;
        this.grid = new Map();
    }

    /**
     * Builds the key for a grid cell.
     *
     * @param ix - X cell index.
     * @param iy - Y cell index.
     * @returns Cell key.
     */
    private _cellKey(ix: number, iy: number): string {
        return `${ix},${iy}`;
    }

    /**
     * Adds a point to the grid.
     *
     * @param x - X coordinate.
     * @param y - Y coordinate.
     * @param tag - Optional associated tag.
     */
    addPoint(x: number, y: number, tag: unknown = null): void {
        const ix = Math.floor(x * this.invCellSize);
        const iy = Math.floor(y * this.invCellSize);
        const key = this._cellKey(ix, iy);
        const cell = this.grid.get(key);
        if (cell) {
            cell.push([x, y, tag]);
        } else {
            this.grid.set(key, [[x, y, tag]]);
        }
    }

    /**
     * Checks whether there are points within a radius from a query point.
     *
     * @param x - Query X coordinate.
     * @param y - Query Y coordinate.
     * @param radius - Search radius.
     * @param filter - Optional tag filter.
     * @returns True if a nearby point is found.
     */
    hasNearby(
        x: number,
        y: number,
        radius: number,
        filter: ((pointTag: unknown) => boolean) | null = null,
    ): boolean {
        const r = Math.ceil(radius * this.invCellSize);
        const ix = Math.floor(x * this.invCellSize);
        const iy = Math.floor(y * this.invCellSize);
        const radiusSq = radius * radius;

        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                const key = this._cellKey(ix + dx, iy + dy);
                const cell = this.grid.get(key);
                if (cell) {
                    for (const pt of cell) {
                        const dxCell = pt[0] - x;
                        const dyCell = pt[1] - y;
                        const distSq = dxCell * dxCell + dyCell * dyCell;

                        if (distSq < radiusSq && (!filter || filter(pt[2]))) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }
}
