export const DECIMALS = 8;
export const ATOMS_PER_TRAI = 100000000n;
const MAX_ATOMS = (1n << 128n) - 1n;
const ATOMS = /^(0|[1-9][0-9]{0,38})$/;
const TRAI = /^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/;
/** Reads an amount as the API sends it: atoms in a canonical decimal string. */
export function parseAtoms(value) {
    if (typeof value !== "string" || !ATOMS.test(value)) {
        throw new TypeError(`not an atom amount: ${JSON.stringify(value)}`);
    }
    const atoms = BigInt(value);
    if (atoms > MAX_ATOMS) {
        throw new RangeError("atom amount exceeds 128 bits");
    }
    return atoms;
}
/** Atoms as the API expects them. */
export function toAtomAmount(atoms) {
    if (typeof atoms !== "bigint") {
        throw new TypeError("atoms must be a bigint");
    }
    if (atoms < 0n || atoms > MAX_ATOMS) {
        throw new RangeError("atom amounts are 0 to 2^128 - 1");
    }
    return atoms.toString();
}
/** Exact TRAI text, such as "12.00005"; `fixed` keeps all eight decimals. */
export function formatTrai(atoms, options = {}) {
    const value = typeof atoms === "bigint" ? atoms : parseAtoms(atoms);
    const sign = value < 0n ? "-" : "";
    const magnitude = value < 0n ? -value : value;
    const whole = magnitude / ATOMS_PER_TRAI;
    const fraction = (magnitude % ATOMS_PER_TRAI).toString().padStart(DECIMALS, "0");
    const shown = options.fixed ? fraction : fraction.replace(/0+$/, "");
    return shown ? `${sign}${whole}.${shown}` : `${sign}${whole}`;
}
/** Parses TRAI text with up to eight decimals, without floating point. */
export function parseTrai(text) {
    if (typeof text !== "string" || !TRAI.test(text)) {
        throw new TypeError(`not a TRAI amount: ${JSON.stringify(text)}`);
    }
    const [whole = "0", fraction = ""] = text.split(".");
    const atoms = BigInt(whole) * ATOMS_PER_TRAI + BigInt(fraction.padEnd(DECIMALS, "0"));
    if (atoms > MAX_ATOMS) {
        throw new RangeError("amount exceeds 128 bits");
    }
    return atoms;
}
