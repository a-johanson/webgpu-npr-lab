declare module "xor4096" {
    export type PRNGState = unknown;

    export interface PRNG {
        (): number;
        double(): number;
        int32(): number;
        quick(): number;
        state?(): PRNGState;
    }

    export function prng_xor4096(seed?: string | number, opts?: { state?: PRNGState }): PRNG;
    export default prng_xor4096;
}
