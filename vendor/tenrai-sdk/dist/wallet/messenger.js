import { TenraiApiError, TenraiNetworkError, TenraiTimeoutError, TenraiWalletError } from "../errors.js";
import { isChatText, isMessengerPayload } from "./payload.js";
/** Longest note, accept text and message in bytes, `protocol/messenger-v1.md`. */
export const MESSENGER_LIMITS = Object.freeze({ note: 218, accept: 202, text: 970 });
/** A chat frame moves one atom and its fee; transactions that moved more carry none. */
const MOST_A_FRAME_MOVES = 1000000n;
const PARALLEL_READS = 4;
const MAX_FRAMES = 10_000;
const MAX_FRAME_HEX = 2_048;
const MESSAGE_KIND = "03";
const TRANSACTION_ID = /^[0-9a-f]{96}$/;
const PAYLOAD_HEX = /^(?:[0-9a-f]{2})+$/;
const ADDRESS = /^[a-z0-9]{1,128}$/;
function fromHex(hex) {
    return Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}
function later(failure) {
    return (failure instanceof TenraiNetworkError ||
        failure instanceof TenraiTimeoutError ||
        (failure instanceof TenraiApiError && (failure.retryable || failure.status >= 500)));
}
function cleanFrame(value) {
    if (!value || typeof value !== "object") {
        return null;
    }
    const frame = value;
    const payload = typeof frame.payloadHex === "string" ? frame.payloadHex.toLowerCase() : "";
    const valid = typeof frame.transactionId === "string" &&
        TRANSACTION_ID.test(frame.transactionId) &&
        payload.length <= MAX_FRAME_HEX &&
        PAYLOAD_HEX.test(payload) &&
        isMessengerPayload(payload) &&
        typeof frame.sent === "boolean" &&
        Array.isArray(frame.inputs) &&
        frame.inputs.length <= 16 &&
        frame.inputs.every((address) => typeof address === "string" && ADDRESS.test(address)) &&
        (frame.to === null || (typeof frame.to === "string" && ADDRESS.test(frame.to))) &&
        Number.isSafeInteger(frame.height) &&
        frame.height >= 0 &&
        (frame.time === null || (Number.isSafeInteger(frame.time) && frame.time >= 0));
    if (!valid) {
        return null;
    }
    return {
        transaction: frame.transactionId,
        payload_hex: payload,
        sent: frame.sent,
        inputs: [...frame.inputs],
        to: frame.to,
        height: frame.height,
        time: frame.time,
    };
}
/** Oldest first; past `limit`, messages give way before any request or accept, which hold a chat's keys. */
function kept(frames, limit) {
    const sorted = [...frames].sort((a, b) => (a.height ?? 0) - (b.height ?? 0));
    if (sorted.length <= limit) {
        return sorted;
    }
    const message = (entry) => entry.payload_hex.slice(10, 12) === MESSAGE_KIND;
    const keys = sorted.filter((entry) => !message(entry)).slice(-limit);
    const room = limit - keys.length;
    const messages = room > 0 ? sorted.filter(message).slice(-room) : [];
    return [...keys, ...messages].sort((a, b) => (a.height ?? 0) - (b.height ?? 0));
}
function checked(text, limit, empty = false) {
    if (typeof text !== "string" || (!empty && !text.trim())) {
        throw new TenraiWalletError("a message needs text", "invalid");
    }
    if (!isChatText(text)) {
        throw new TenraiWalletError("the text holds control, direction or invisible characters", "invalid");
    }
    if (new TextEncoder().encode(text).length > limit) {
        throw new TenraiWalletError(`the text is longer than ${limit} bytes`, "invalid");
    }
    return text;
}
/** The chats of one wallet; every frame pays one atom to the other side and its fee. */
export class Messenger {
    #host;
    #client;
    #views = new Map();
    #wire = new Map();
    #frames = new Map();
    /** @internal */
    constructor(host, client) {
        this.#host = host;
        this.#client = client;
    }
    /** `TRM-` and eight groups of hex, the same on every device of this wallet; it tells nothing about the phrase. */
    id() {
        return this.#host.root().messengerId();
    }
    /**
     * Builds every chat from the wallet's newest `limit` transactions (500 by default) and the frames seen before
     * or imported; throws the read error when a busy node left some unread, and the next call asks only for those.
     */
    async chats(options = {}) {
        const activity = await this.#host.activity(this.#client, { limit: options.limit ?? 500 });
        const wanted = activity
            // A reward payout carries no frame, a transfer that spent a reward may.
            .filter((entry) => entry.transactionId !== null && !(entry.spent === 0n && !entry.sources.includes("regular")))
            .filter((entry) => (entry.received > entry.spent ? entry.received - entry.spent : entry.spent - entry.received) <= MOST_A_FRAME_MOVES)
            .map((entry) => entry.transactionId)
            .filter((id) => !this.#views.has(id));
        let next = 0;
        let failed;
        const read = async () => {
            for (let id = wanted[next]; id !== undefined; id = wanted[next]) {
                next += 1;
                try {
                    this.#views.set(id, await this.#client.transactions.get(id));
                }
                catch (failure) {
                    if (later(failure)) {
                        failed ??= failure;
                    }
                    else {
                        // A pruning node no longer has it, or its answer is unusable; it is not asked again.
                        this.#views.set(id, null);
                    }
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(PARALLEL_READS, wanted.length) }, read));
        if (failed !== undefined) {
            throw failed;
        }
        const owns = (address) => this.#host.owns(address);
        const observed = new Map(this.#frames);
        for (const view of this.#views.values()) {
            if (!view || !isMessengerPayload(view.payload_hex)) {
                continue;
            }
            const inputs = [...new Set(view.inputs.map((input) => input.spends?.address).filter((address) => typeof address === "string"))];
            const sent = inputs.some(owns);
            const to = (sent ? view.outputs.find((output) => !owns(output.address)) : view.outputs.find((output) => owns(output.address)))?.address ?? null;
            const height = view.status.finalized_cut?.height ?? null;
            const entry = { transaction: view.transaction_id, payload_hex: (view.payload_hex ?? "").toLowerCase(), sent, inputs, to, height, time: view.finalized_at_millis ?? null };
            observed.set(entry.transaction, entry);
            if (height !== null) {
                this.#frames.set(entry.transaction, entry);
            }
        }
        if (this.#frames.size > MAX_FRAMES) {
            this.#frames = new Map(kept([...this.#frames.values()], MAX_FRAMES).map((entry) => [entry.transaction, entry]));
        }
        const built = JSON.parse(this.#host.root().messengerChats(JSON.stringify([...observed.values()])));
        this.#wire.clear();
        return built.chats.map((chat) => {
            this.#wire.set(chat.request, chat);
            return {
                request: chat.request,
                side: chat.side,
                peer: chat.peer,
                own: chat.own,
                peerId: chat.peer_id,
                chatId: chat.chat_id,
                state: chat.chat_id ? "open" : chat.side === "accepter" ? "request" : "waiting",
                messages: chat.messages.map((message) => ({
                    transactionId: message.transaction,
                    kind: message.kind,
                    mine: message.mine,
                    text: message.text !== null && isChatText(message.text) ? message.text : null,
                    encrypted: message.encrypted,
                    height: message.height,
                    time: message.time,
                })),
            };
        });
    }
    /**
     * The finalized frames `chats` has seen, oldest first, for apps that keep chats beyond the activity a node
     * lists; at most `limit`, and past it messages give way before requests and accepts. Frames from others are
     * as private as the payloads they are: keep them sealed, and drop them when incoming payloads are turned off.
     */
    exportFrames(limit = MAX_FRAMES) {
        return kept([...this.#frames.values()], limit).map((entry) => ({
            transactionId: entry.transaction,
            payloadHex: entry.payload_hex,
            sent: entry.sent,
            inputs: [...entry.inputs],
            to: entry.to,
            height: entry.height,
            time: entry.time,
        }));
    }
    /** Takes back frames from `exportFrames`; malformed ones are skipped. Returns how many were new. */
    importFrames(frames) {
        let added = 0;
        for (const value of Array.isArray(frames) ? frames : []) {
            const frame = cleanFrame(value);
            if (frame && !this.#frames.has(frame.transaction)) {
                this.#frames.set(frame.transaction, frame);
                added += 1;
            }
        }
        return added;
    }
    /** Opens a chat with `to`; the note goes out with this wallet's key and anyone can read it. */
    async start(to, note = "") {
        const frame = this.#host.root().messengerRequest(checked(note, MESSENGER_LIMITS.note, true));
        return this.#host.send(this.#client, { to, amount: 1n, payload: fromHex(frame) });
    }
    /** Accepts a request from `chats`; the transfer spends a coin of the address the request went to. */
    async accept(chat, text = "") {
        const wire = this.#chat(chat);
        if (wire.side !== "accepter" || wire.chat_id) {
            throw new TenraiWalletError("only a request this wallet received and has not accepted can be accepted", "invalid");
        }
        const requestHex = this.#views.get(wire.request)?.payload_hex ?? this.#frames.get(wire.request)?.payload_hex;
        if (!requestHex) {
            throw new TenraiWalletError("the request is not read yet; call chats first", "invalid");
        }
        const held = (await this.#host.outputs(this.#client, { address: wire.own })).filter((output) => output.address === wire.own);
        const coin = held.find((output) => output.transactionId === wire.request) ?? held[0];
        if (!coin) {
            throw new TenraiWalletError(`the answer has to spend a coin of ${wire.own}, where the request arrived, and that address holds none`, "insufficient");
        }
        const frame = this.#host.root().messengerAccept(wire.request, requestHex, checked(text, MESSENGER_LIMITS.accept, true));
        return this.#host.send(this.#client, {
            to: wire.peer,
            amount: 1n,
            payload: fromHex(frame),
            include: [{ transactionId: coin.transactionId, outputIndex: coin.outputIndex }],
        });
    }
    /** A message in an open chat; the accepter may also write right after its accept. */
    async send(chat, text) {
        const wire = this.#chat(chat);
        if (wire.side === "requester" && !wire.chat_id) {
            throw new TenraiWalletError("the other side has not accepted this chat yet", "invalid");
        }
        const keys = JSON.stringify({ request: wire.request, side: wire.side, requester_key: wire.requester_key, capsule: wire.capsule });
        const frame = this.#host.root().messengerMessage(keys, checked(text, MESSENGER_LIMITS.text));
        return this.#host.send(this.#client, { to: wire.peer, amount: 1n, payload: fromHex(frame) });
    }
    #chat(chat) {
        const wire = this.#wire.get(chat?.request);
        if (!wire) {
            throw new TenraiWalletError("unknown chat; call chats first", "invalid");
        }
        return wire;
    }
}
