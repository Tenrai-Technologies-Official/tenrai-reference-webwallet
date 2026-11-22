/** No controls, direction or format characters, invisible or private ones, or piled-up marks; the rule the Tenrai wallets use. */
export declare function isSafeText(text: string): boolean;
/** Chat text may break lines: each line follows `isSafeText`, and at most two empty lines follow each other. */
export declare function isChatText(text: string): boolean;
/** A Tenrai messenger frame, `protocol/messenger-v1.md`: show it as a chat message, never as a payload. */
export declare function isMessengerPayload(payload: string | Uint8Array | null | undefined): boolean;
/**
 * A payload as text when it is UTF-8 and safe to display, else null: show it as hex then. Takes the
 * node's `payload_hex` or the bytes.
 */
export declare function payloadText(payload: string | Uint8Array | null | undefined): string | null;
/** Text goes out as UTF-8 and must be safe to display; bytes go out unchanged. */
export declare function payloadBytes(payload: string | Uint8Array): Uint8Array;
export declare function payloadHex(payload: string | Uint8Array | undefined, limit: number): string;
