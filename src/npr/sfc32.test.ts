import { Sfc32 } from "./sfc32";

/**
 * Formats an unsigned 32-bit value as uppercase hexadecimal.
 *
 * @param value - Value to format.
 * @returns Hexadecimal string.
 */
function formatUint32Hex(value: number): string {
    return `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

/**
 * Throws when two values are not identical.
 *
 * @param actual - Observed value.
 * @param expected - Expected value.
 * @param message - Failure context.
 */
function assertEqual(actual: unknown, expected: unknown, message: string): void {
    if (!Object.is(actual, expected)) {
        throw new Error(
            `${message}: expected ${String(expected)}, received ${String(actual)}`,
        );
    }
}

/**
 * Verifies a fixed reference sequence.
 */
function reference(): void {
    const generator = new Sfc32();
    generator.setState({
        a: 0x395d1ce6,
        b: 0xca5aeec2,
        c: 0xa6ea70f8,
        d: 0x00000010,
    });

    // Oracle from https://github.com/rust-random/rngs/blob/41c64361063ffe39994ee43b614769dabc2c6657/rand_sfc/src/sfc32.rs#L113
    const expected: number[] = [
        0x03b80bb8, 0xa87dbc7e, 0x1787178c, 0x4c7b7234, 0xc65dade2, 0x2c692349, 0xf52c2153,
        0xdf098072, 0x9d49b03c, 0x9562381a, 0xc9b41738, 0x64b75e54, 0x36ce9b32, 0xf106947e,
        0x0afc726b, 0x549bbc87,
    ];

    for (const expectedValue of expected) {
        const actualValue = generator.nextUint32();

        assertEqual(
            actualValue,
            expectedValue,
            `nextUint32() should match the reference output ${formatUint32Hex(expectedValue)}`,
        );
    }
}

/**
 * Runs all SFC32 unit tests.
 */
export function runSfc32Tests(): void {
    reference();
}

runSfc32Tests();
