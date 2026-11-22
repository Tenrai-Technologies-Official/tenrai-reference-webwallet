export interface RecipientPayload {
    /** The transaction output the payload belongs to; payment `i` of a transfer is output `i`. */
    output: number;
    payloadHex: string;
    /** The payload as text when it is UTF-8 and safe to show, else null: show it as hex then. */
    text: string | null;
}
/** The marker and the entries, outputs rising, each payload at least one byte. */
export declare function encodeRecipientPayloads(entries: {
    output: number;
    payload: Uint8Array;
}[]): Uint8Array;
/** One payload for all recipients or one per recipient (payment `i` is output `i`), never both; as hex. */
export declare function transferPayloadHex(general: string | Uint8Array | undefined, perRecipient: (string | Uint8Array | undefined)[], limit: number): string;
/**
 * The entries when a transaction's payload (`payload_hex` or bytes) gives each recipient its own, else null:
 * then it is one payload for the whole transaction.
 */
export declare function recipientPayloads(payload: string | Uint8Array | null | undefined): RecipientPayload[] | null;
