import { TenraiWalletError } from "../errors.js";
import { toHex } from "./protocol.js";
const UNSAFE_CHARACTER = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
const EMOJI_PRESENTATION = new Set(["\ufe0e", "\ufe0f"]);
const MARK_PILE = /\p{M}{8,}/u;
const ZERO_WIDTH_JOINER = "\u200d";
const PICTOGRAPH = /^\p{Extended_Pictographic}$/u;
const EMOJI_MODIFIER = /^[\u{1f3fb}-\u{1f3ff}\ufe0f]$/u;
const MESSENGER_MARKER = [0x00, 0x54, 0x52, 0x4d, 0x01];
// A joiner between two emoji, as in a woman technologist, makes one picture and hides no text.
function joinsEmoji(characters, index) {
    let before = index - 1;
    while (before >= 0 && EMOJI_MODIFIER.test(characters[before] ?? "")) {
        before -= 1;
    }
    return before >= 0 && PICTOGRAPH.test(characters[before] ?? "") && PICTOGRAPH.test(characters[index + 1] ?? "");
}
/** No controls, direction or format characters, invisible or private ones, or piled-up marks; the rule the Tenrai wallets use. */
export function isSafeText(text) {
    if (MARK_PILE.test(text) || !text.isWellFormed()) {
        return false;
    }
    const characters = [...text];
    return characters.every((character, index) => !UNSAFE_CHARACTER.test(character) ||
        EMOJI_PRESENTATION.has(character) ||
        (character === ZERO_WIDTH_JOINER && joinsEmoji(characters, index)));
}
/** Chat text may break lines: each line follows `isSafeText`, and at most two empty lines follow each other. */
export function isChatText(text) {
    return !text.includes("\n\n\n\n") && text.split("\n").every((line) => isSafeText(line));
}
/** A Tenrai messenger frame, `protocol/messenger-v1.md`: show it as a chat message, never as a payload. */
export function isMessengerPayload(payload) {
    if (typeof payload === "string") {
        return payload.toLowerCase().startsWith("0054524d01");
    }
    return payload instanceof Uint8Array && MESSENGER_MARKER.every((byte, index) => payload[index] === byte);
}
/**
 * A payload as text when it is UTF-8 and safe to display, else null: show it as hex then. Takes the
 * node's `payload_hex` or the bytes.
 */
export function payloadText(payload) {
    if (isMessengerPayload(payload)) {
        return null;
    }
    if (typeof payload === "string" && (payload.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(payload))) {
        return null;
    }
    const bytes = typeof payload === "string" ? Uint8Array.from(payload.match(/../g) ?? [], (pair) => parseInt(pair, 16)) : payload;
    if (!bytes || bytes.length === 0) {
        return null;
    }
    try {
        const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        return isSafeText(text) ? text : null;
    }
    catch {
        return null;
    }
}
/** Text goes out as UTF-8 and must be safe to display; bytes go out unchanged. */
export function payloadBytes(payload) {
    if (typeof payload === "string" && !isSafeText(payload)) {
        throw new TenraiWalletError("the payload text holds control or invisible characters; pass such data as bytes", "invalid");
    }
    return typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
}
export function payloadHex(payload, limit) {
    if (payload === undefined) {
        return "";
    }
    const bytes = payloadBytes(payload);
    if (bytes.length > limit) {
        throw new TenraiWalletError(`the payload is larger than the ${limit} bytes this network accepts`, "invalid");
    }
    return toHex(bytes);
}
