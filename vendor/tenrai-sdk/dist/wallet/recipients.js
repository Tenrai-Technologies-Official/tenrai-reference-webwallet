import { TenraiWalletError } from "../errors.js";
import { payloadBytes, payloadHex, payloadText } from "./payload.js";
import { toHex } from "./protocol.js";
/** A zero byte, `TRP` and the version, `protocol/recipient-payloads-v1.md`; no text payload starts with a zero byte. */
const MARKER = [0x00, 0x54, 0x52, 0x50, 0x01];
/** The marker and the entries, outputs rising, each payload at least one byte. */
export function encodeRecipientPayloads(entries) {
    if (entries.length === 0) {
        throw new TenraiWalletError("recipient payloads need at least one entry", "invalid");
    }
    const parts = [...MARKER];
    let last = -1;
    for (const { output, payload } of entries) {
        if (!Number.isInteger(output) || output <= last || output > 255) {
            throw new TenraiWalletError("recipient payloads need rising outputs from 0 to 255", "invalid");
        }
        if (payload.length === 0 || payload.length > 0xffff) {
            throw new TenraiWalletError(`the payload for output ${output} must have 1 to 65535 bytes`, "invalid");
        }
        parts.push(output, payload.length >> 8, payload.length & 0xff, ...payload);
        last = output;
    }
    return Uint8Array.from(parts);
}
/** One payload for all recipients or one per recipient (payment `i` is output `i`), never both; as hex. */
export function transferPayloadHex(general, perRecipient, limit) {
    const entries = perRecipient.flatMap((payload, output) => (payload === undefined ? [] : [{ output, payload: payloadBytes(payload) }]));
    if (entries.length === 0) {
        return payloadHex(general, limit);
    }
    if (general !== undefined) {
        throw new TenraiWalletError("pass one payload for all recipients or one per recipient, not both", "invalid");
    }
    const encoded = encodeRecipientPayloads(entries);
    if (encoded.length > limit) {
        throw new TenraiWalletError(`the recipient payloads take ${encoded.length} bytes with their headers; this network accepts ${limit}`, "invalid");
    }
    return toHex(encoded);
}
/**
 * The entries when a transaction's payload (`payload_hex` or bytes) gives each recipient its own, else null:
 * then it is one payload for the whole transaction.
 */
export function recipientPayloads(payload) {
    if (typeof payload === "string" && (payload.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(payload))) {
        return null;
    }
    const bytes = typeof payload === "string" ? Uint8Array.from(payload.match(/../g) ?? [], (pair) => parseInt(pair, 16)) : payload;
    if (!bytes || bytes.length <= MARKER.length || MARKER.some((value, index) => bytes[index] !== value)) {
        return null;
    }
    const entries = [];
    let offset = MARKER.length;
    while (offset < bytes.length) {
        if (offset + 3 > bytes.length) {
            return null;
        }
        const output = bytes[offset];
        const length = (bytes[offset + 1] << 8) | bytes[offset + 2];
        const start = offset + 3;
        if (length === 0 || start + length > bytes.length || (entries.at(-1)?.output ?? -1) >= output) {
            return null;
        }
        const entry = bytes.subarray(start, start + length);
        entries.push({ output, payloadHex: Array.from(entry, (byte) => byte.toString(16).padStart(2, "0")).join(""), text: payloadText(entry) });
        offset = start + length;
    }
    return entries;
}
