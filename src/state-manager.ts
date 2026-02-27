// StateManager: manages application state with dependency tracking

/**
 * Generic object state container.
 */
type StateRecord = Record<string, unknown>;

/**
 * Subscriber callback.
 */
type Subscriber<S extends StateRecord> = (value: S[keyof S], state: S) => void | Promise<void>;

/**
 * Manages application state and key-based subscriptions.
 */
export class StateManager<S extends StateRecord = StateRecord> {
    private readonly _state: S;
    private readonly _subscribers: Map<keyof S, Subscriber<S>[]>;

    /**
     * Creates a state manager.
     *
     * @param initialState - Initial state snapshot.
     */
    constructor(initialState = {} as S) {
        this._state = { ...initialState };
        this._subscribers = new Map();
    }

    /**
     * Gets a state value by key.
     *
     * @param key - State key.
     * @returns Current value.
     */
    get<K extends keyof S>(key: K): S[K] {
        return this._state[key];
    }

    /**
     * Updates state and notifies subscribers for changed keys.
     *
     * @param updates - Partial state updates.
     * @returns Changed key names.
     */
    async setState(updates: Partial<S>): Promise<string[]> {
        const changedKeys: Array<keyof S> = [];

        for (const [rawKey, value] of Object.entries(updates)) {
            const key = rawKey as keyof S;
            if (this._state[key] !== value) {
                this._state[key] = value as S[keyof S];
                changedKeys.push(key);
            }
        }

        for (const key of changedKeys) {
            const subscribers = this._subscribers.get(key);
            if (!subscribers) {
                continue;
            }
            const subscribersSnapshot = [...subscribers];
            for (const callback of subscribersSnapshot) {
                await callback(this._state[key], this._state);
            }
        }

        return changedKeys.map(String);
    }

    /**
     * Subscribes to key changes.
     *
     * @param keys - Keys to watch.
     * @param callback - Callback to invoke on change.
     */
    subscribe<K extends keyof S>(
        keys: readonly K[],
        callback: (value: S[K], state: S) => void | Promise<void>,
    ): void {
        keys.forEach((key) => {
            if (!this._subscribers.has(key)) {
                this._subscribers.set(key, []);
            }
            this._subscribers.get(key)?.push(callback as Subscriber<S>);
        });
    }
}
