import { createSfc32 } from "./sfc32";

const textEncoder = new TextEncoder();

/**
 * Applies a SplitMix64-style avalanche finalizer to a 64-bit value.
 *
 * @param value - Input value.
 * @returns Mixed 64-bit value.
 */
function mixUint64(value: bigint): bigint {
    let mixed = BigInt.asUintN(64, value);

    mixed ^= mixed >> 30n;
    mixed = BigInt.asUintN(64, mixed * 0xbf58_476d_1ce4_e5b9n);
    mixed ^= mixed >> 27n;
    mixed = BigInt.asUintN(64, mixed * 0x94d0_49bb_1331_11ebn);
    mixed ^= mixed >> 31n;

    return BigInt.asUintN(64, mixed);
}

/**
 * Hashes a string into an unsigned 64-bit seed.
 *
 * The input string is encoded as UTF-8, hashed with FNV-1a 64, and then
 * passed through a final avalanche mixer so nearby strings disperse well.
 *
 * @param value - Seed text.
 * @returns Unsigned 64-bit hash value.
 */
export function hashStringToUint64(value: string): bigint {
    const fnv64OffsetBasis = 0xcbf2_9ce4_8422_2325n;
    const fnv64Prime = 0x0000_0100_0000_01b3n;

    let hash = fnv64OffsetBasis;
    const bytes = textEncoder.encode(value);

    for (const byte of bytes) {
        hash ^= BigInt(byte);
        hash = BigInt.asUintN(64, hash * fnv64Prime);
    }

    return mixUint64(hash);
}

/**
 * Derives a stable child seed from a base seed and stream label.
 *
 * @param baseSeed - Base unsigned 64-bit seed.
 * @param streamLabel - Deterministic child stream label.
 * @returns Derived unsigned 64-bit seed.
 */
export function deriveUint64Seed(baseSeed: bigint, streamLabel: string): bigint {
    const derivationConstant = 0x9e37_79b9_7f4a_7c15n;
    const normalizedBaseSeed = BigInt.asUintN(64, baseSeed);
    const labelHash = hashStringToUint64(streamLabel);
    return mixUint64(normalizedBaseSeed ^ labelHash ^ derivationConstant);
}

/**
 * Creates an SFC32-backed random callback from a string seed.
 *
 * @param seed - Free-form seed text.
 * @returns Random callback that returns values in [0, 1).
 */
export function createSeededRandom(seed: string): () => number {
    return createSfc32(hashStringToUint64(seed));
}

/**
 * Creates an SFC32-backed random callback for a named child stream.
 *
 * @param seed - Free-form base seed text.
 * @param streamLabel - Deterministic child stream label.
 * @returns Random callback that returns values in [0, 1).
 */
export function createDerivedSeededRandom(seed: string, streamLabel: string): () => number {
    return createSfc32(deriveUint64Seed(hashStringToUint64(seed), streamLabel));
}

/**
 * Converts an unsigned 64-bit seed to a canonical lowercase hexadecimal string.
 *
 * @param seed - Unsigned 64-bit seed.
 * @returns Hexadecimal string without a prefix.
 */
export function formatUint64Hex(seed: bigint): string {
    return BigInt.asUintN(64, seed).toString(16).padStart(16, "0");
}
