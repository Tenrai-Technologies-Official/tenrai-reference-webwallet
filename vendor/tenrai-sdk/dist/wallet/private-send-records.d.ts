import type { PrivateRecord, PrivateSend } from "./private-sends.ts";
export declare const MAX_SENDS_BYTES: number;
export declare const MAX_PENDING_SENDS = 64;
export interface SavedSends {
    entries: PrivateSend[];
    done: PrivateRecord[];
    version: 1;
    nextLeaf: string | null;
    expected: {
        id: string;
        finalizedHeight: number | null;
        closedAtHeight: number | null;
    }[];
}
/** Next-leaf cursors may also equal the exhausted 64-bit tree size. */
export declare function noteCursor(value: unknown): string;
/** Validates persisted public artifacts and reservation metadata without changing their frame. */
export declare function sendRecord(value: unknown): PrivateSend;
export declare function sendSnapshot(entry: PrivateSend): PrivateSend;
/** The canonical frame inspector binds change metadata to actual statement outputs. */
export declare function validateOwnNoteCommitments(frame: unknown, entry: PrivateSend): void;
export declare function samePreparedSend(left: PrivateSend, right: PrivateSend): boolean;
export declare function savedSends(value: unknown): SavedSends;
/** Null means absent only; authentication, decoding and shape errors propagate. */
export declare function openSavedSends(saved: Uint8Array, open: (sealed: Uint8Array) => Uint8Array): SavedSends;
export declare function encodeSavedSends(value: SavedSends): Uint8Array;
