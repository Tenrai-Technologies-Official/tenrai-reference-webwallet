import type { AtomAmount } from "./types/common.ts";
export declare const DECIMALS = 8;
export declare const ATOMS_PER_TRAI = 100000000n;
/** Parse the API's canonical decimal atom string. */
export declare function parseAtoms(value: AtomAmount): bigint;
/** Encode atoms as a canonical decimal string. */
export declare function toAtomAmount(atoms: bigint): AtomAmount;
/** Format exact TRAI text. `fixed` keeps all eight decimals. */
export declare function formatTrai(atoms: bigint | AtomAmount, options?: {
    fixed?: boolean;
}): string;
/** Parse up to eight decimal places into integer atoms. */
export declare function parseTrai(text: string): bigint;
