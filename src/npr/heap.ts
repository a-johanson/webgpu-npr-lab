/// Binary min-heap implemented over an array.

/**
 * Comparator function for heap values.
 */
type Comparator<T> = (a: T, b: T) => number;

/**
 * A generic binary min-heap.
 */
export class MinHeap<T> {
    private readonly _cmp: Comparator<T>;
    private readonly _data: T[];

    /**
     * Creates a new heap.
     *
     * @param comparator - Optional comparator.
     */
    constructor(comparator?: Comparator<T>) {
        this._cmp = comparator || ((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        this._data = [];
    }

    /**
     * Gets heap size.
     *
     * @returns The number of elements.
     */
    size(): number {
        return this._data.length;
    }

    /**
     * Checks whether the heap is empty.
     *
     * @returns True if empty.
     */
    isEmpty(): boolean {
        return this._data.length === 0;
    }

    /**
     * Returns the minimum element without removing it.
     *
     * @returns The minimum element if present.
     */
    peek(): T | undefined {
        return this._data.length ? this._data[0] : undefined;
    }

    /**
     * Pushes an item onto the heap.
     *
     * @param item - The item to insert.
     */
    push(item: T): void {
        const d = this._data;
        d.push(item);
        this._siftUp(d.length - 1);
    }

    /**
     * Pops the minimum item from the heap.
     *
     * @returns The minimum element if present.
     */
    pop(): T | undefined {
        const d = this._data;
        const n = d.length;
        if (n === 0) return undefined;
        const min = d[0];
        const last = d.pop() as T;
        if (n > 1) {
            d[0] = last;
            this._siftDown(0);
        }
        return min;
    }

    /**
     * Clears all elements from the heap.
     */
    clear(): void {
        this._data.length = 0;
    }

    /**
     * Computes parent index.
     *
     * @param i - Child index.
     * @returns Parent index.
     */
    private _parent(i: number): number {
        return (i - 1) >>> 1;
    }

    /**
     * Computes left child index.
     *
     * @param i - Parent index.
     * @returns Left child index.
     */
    private _left(i: number): number {
        return (i << 1) + 1;
    }

    /**
     * Computes right child index.
     *
     * @param i - Parent index.
     * @returns Right child index.
     */
    private _right(i: number): number {
        return (i << 1) + 2;
    }

    /**
     * Sifts an element up the heap.
     *
     * @param i - Start index.
     */
    private _siftUp(i: number): void {
        const d = this._data;
        let idx = i;
        while (idx > 0) {
            const p = this._parent(idx);
            if (this._cmp(d[idx], d[p]) < 0) {
                const tmp = d[idx];
                d[idx] = d[p];
                d[p] = tmp;
                idx = p;
            } else {
                break;
            }
        }
    }

    /**
     * Sifts an element down the heap.
     *
     * @param i - Start index.
     */
    private _siftDown(i: number): void {
        const d = this._data;
        const n = d.length;
        let idx = i;
        while (true) {
            const l = this._left(idx);
            const r = this._right(idx);
            let smallest = idx;
            if (l < n && this._cmp(d[l], d[smallest]) < 0) smallest = l;
            if (r < n && this._cmp(d[r], d[smallest]) < 0) smallest = r;
            if (smallest !== idx) {
                const tmp = d[idx];
                d[idx] = d[smallest];
                d[smallest] = tmp;
                idx = smallest;
            } else {
                break;
            }
        }
    }
}
