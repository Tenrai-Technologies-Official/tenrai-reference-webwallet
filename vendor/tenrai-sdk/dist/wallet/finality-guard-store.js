export const MAX_FINALITY_GUARD_SEALED_BYTES = 65_536;
/** The native root authenticates the wallet, chain and genesis binding. */
export function finalityGuardScope(value) {
    if (typeof value !== "string" || !/^[\x20-\x7e]{1,512}$/.test(value)) {
        throw new Error("Invalid full-wallet finality guard scope.");
    }
    return value;
}
/** Copy Node Buffers too. Buffer.slice() aliases caller-owned memory. */
export function finalityGuardBytes(value) {
    if (!(value instanceof Uint8Array) || value.byteLength < 40 || value.byteLength > MAX_FINALITY_GUARD_SEALED_BYTES
        || (typeof SharedArrayBuffer !== "undefined" && value.buffer instanceof SharedArrayBuffer)) {
        throw new Error("The sealed finality guard is damaged or exceeds its bound.");
    }
    return new Uint8Array(value);
}
