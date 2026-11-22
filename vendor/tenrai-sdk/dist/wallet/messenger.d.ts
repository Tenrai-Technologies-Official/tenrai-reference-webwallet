import type { TenraiClient } from "../client.ts";
import type { SendRequest, SentTransfer, WalletActivity, WalletOutput } from "./types.ts";
/** Longest note, accept text and message in bytes, `protocol/messenger-v1.md`. */
export declare const MESSENGER_LIMITS: Readonly<{
    note: 218;
    accept: 202;
    text: 970;
}>;
/** A finalized frame as `exportFrames` gives it and `importFrames` takes it back. */
export interface MessengerFrame {
    transactionId: string;
    payloadHex: string;
    /** Whether this wallet sent the transaction. */
    sent: boolean;
    /** The addresses its coins came from. */
    inputs: string[];
    /** The other side's address for a frame this wallet sent, this wallet's for one it received. */
    to: string | null;
    height: number;
    time: number | null;
}
export interface ChatMessage {
    transactionId: string;
    kind: "request" | "accept" | "message";
    mine: boolean;
    /** Null when the text breaks the chat text rule; never shown then. Display it escaped, never as markup. */
    text: string | null;
    /** False only for a request's note, which anyone can read. */
    encrypted: boolean;
    height: number | null;
    time: number | null;
}
export interface Chat {
    /** The request's transaction id names the chat. */
    request: string;
    side: "requester" | "accepter";
    /** Where this wallet's frames go. */
    peer: string;
    /** This wallet's address in the chat. */
    own: string;
    /** The requester's Messenger ID; only the accepter learns it. */
    peerId: string | null;
    /** Set once the chat is accepted; both sides see the same. */
    chatId: string | null;
    /** `request` waits for this wallet's accept, `waiting` for the other side's. */
    state: "request" | "waiting" | "open";
    messages: ChatMessage[];
}
interface MessengerRoot {
    messengerId(): string;
    messengerRequest(note: string): string;
    messengerAccept(request: string, requestPayloadHex: string, text: string): string;
    messengerMessage(chat: string, text: string): string;
    messengerChats(observed: string): string;
}
/** What a wallet lends its messenger; the key stays in the WASM. */
export interface MessengerHost {
    root(): MessengerRoot;
    owns(address: string): boolean;
    activity(client: TenraiClient, options: {
        limit: number;
    }): Promise<WalletActivity[]>;
    outputs(client: TenraiClient, options?: {
        address?: string;
        limit?: number;
    }): Promise<WalletOutput[]>;
    send(client: TenraiClient, request: SendRequest): Promise<SentTransfer>;
}
/** The chats of one wallet; every frame pays one atom to the other side and its fee. */
export declare class Messenger {
    #private;
    /** @internal */
    constructor(host: MessengerHost, client: TenraiClient);
    /** `TRM-` and eight groups of hex, the same on every device of this wallet; it tells nothing about the phrase. */
    id(): string;
    /**
     * Builds every chat from the wallet's newest `limit` transactions (500 by default) and the frames seen before
     * or imported; throws the read error when a busy node left some unread, and the next call asks only for those.
     */
    chats(options?: {
        limit?: number;
    }): Promise<Chat[]>;
    /**
     * The finalized frames `chats` has seen, oldest first, for apps that keep chats beyond the activity a node
     * lists; at most `limit`, and past it messages give way before requests and accepts. Frames from others are
     * as private as the payloads they are: keep them sealed, and drop them when incoming payloads are turned off.
     */
    exportFrames(limit?: number): MessengerFrame[];
    /** Takes back frames from `exportFrames`; malformed ones are skipped. Returns how many were new. */
    importFrames(frames: readonly unknown[]): number;
    /** Opens a chat with `to`; the note goes out with this wallet's key and anyone can read it. */
    start(to: string, note?: string): Promise<SentTransfer>;
    /** Accepts a request from `chats`; the transfer spends a coin of the address the request went to. */
    accept(chat: Chat, text?: string): Promise<SentTransfer>;
    /** A message in an open chat; the accepter may also write right after its accept. */
    send(chat: Chat, text: string): Promise<SentTransfer>;
}
export {};
