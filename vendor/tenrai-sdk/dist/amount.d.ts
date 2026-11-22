import type { AtomAmount } from "./types/common.ts";
export declare const DECIMALS = 8;
export declare const ATOMS_PER_TRAI = 100000000n;
/** Reads an amount as the API sends it: atoms in a canonical decimal string. */
export declare function parseAtoms(value: AtomAmount): bigint;
/** Atoms as the API expects them. */
export declare function toAtomAmount(atoms: bigint): AtomAmount;
/** Exact TRAI text, such as "12.00005"; `fixed` keeps all eight decimals. */
export declare function formatTrai(atoms: bigint | AtomAmount, options?: {
    fixed?: boolean;
}): string;
/** Parses TRAI text with up to eight decimals, without floating point. */
export declare function parseTrai(text: string): bigint;
