import { TenraiApiError, TenraiTimeoutError } from "../errors.js";
import { LiveSocket } from "../sockets/live.js";
import { StatusStream, isFinal } from "../sockets/status.js";
import { Waiters } from "../sockets/waiters.js";
import { hash384, hex, limit, whole } from "../validate.js";
export const MAX_STATUS_BATCH = 1_024;
const RESEND_MILLIS = 30_000;
export class TransactionsApi {
    #http;
    #sockets;
    #waiters;
    /** @internal */
    constructor(http, sockets) {
        this.#http = http;
        this.#sockets = sockets;
    }
    /** `POST /v1/transactions`. Retry only after an explicit 429 or 503. */
    submit(wireHex, options) {
        return this.#http.submit("/v1/transactions", { api_version: 1, wire_hex: hex(wireHex, "wireHex") }, options);
    }
    /** `POST /v1/transactions/status`. Up to 1,024 IDs, with missing IDs in `unknown`. */
    statuses(transactionIds, options) {
        if (transactionIds.length === 0 || transactionIds.length > MAX_STATUS_BATCH) {
            throw new RangeError(`pass 1 to ${MAX_STATUS_BATCH} transaction ids`);
        }
        const ids = transactionIds.map((id) => hash384(id, "transactionId"));
        return this.#http.post("/v1/transactions/status", { api_version: 1, transaction_ids: ids }, undefined, options);
    }
    /** `GET /v1/transactions/manifest`. Active transaction limits, mass rules and fee floor. */
    manifest(options) {
        return this.#http.get("/v1/transactions/manifest", undefined, options);
    }
    /** `GET /v1/transactions/recent`. Newest first. */
    recent(options = {}) {
        return this.#http.get("/v1/transactions/recent", { limit: limit(options.limit, Number.MAX_SAFE_INTEGER) }, options);
    }
    /** `GET /v1/transactions/{id}`: the full transaction with inputs, outputs, fee and status. */
    get(transactionId, options) {
        return this.#http.get(`/v1/transactions/${hash384(transactionId, "transactionId")}`, undefined, options);
    }
    /** Retained display data without canonical witness bytes. */
    compact(transactionId, options) {
        return this.#http.get(`/v1/transactions/${hash384(transactionId, "transactionId")}/compact`, undefined, options);
    }
    /** `GET /v1/transactions/{id}/status`. */
    status(transactionId, options) {
        return this.#http.get(`/v1/transactions/${hash384(transactionId, "transactionId")}/status`, undefined, options);
    }
    /** `WS /v1/transactions/{id}/status/stream`: every status change until the transaction is final. */
    watch(transactionId, options = {}) {
        const factory = this.#sockets.factory();
        if (!factory) {
            throw new TypeError("this runtime has no WebSocket; pass options.WebSocket to the client");
        }
        return new StatusStream(this.#http, factory, transactionId, { reconnect: this.#sockets.reconnect, ...options });
    }
    /**
     * Wait for a terminal status, including expiry after `validUntil`.
     * Waiters share the client's sockets and batched polling.
     */
    async waitForFinal(transactionId, options = {}) {
        const id = hash384(transactionId, "transactionId");
        const validUntil = options.validUntil === undefined ? undefined : cutHeight(options.validUntil);
        const every = options.pollMillis ?? 2_000;
        if (!(every > 0)) {
            throw new RangeError("pollMillis must be positive");
        }
        const deadline = options.timeoutMillis === undefined ? undefined : AbortSignal.timeout(options.timeoutMillis);
        const signals = [options.signal, deadline].filter((signal) => signal !== undefined);
        const signal = signals.length === 0 ? undefined : AbortSignal.any(signals);
        try {
            return await this.#wait(id, validUntil, every, signal, options.wireHex);
        }
        catch (error) {
            if (!signal?.aborted) {
                throw error;
            }
            throw options.signal?.aborted ? options.signal.reason : new TenraiTimeoutError(`${id} was not final in time`);
        }
    }
    async #wait(id, bound, every, signal, wire) {
        const call = signal ? { signal } : {};
        const first = await this.status(id, call).catch((error) => {
            if (bound !== undefined && error instanceof TenraiApiError && error.status === 404) {
                return unseen(id);
            }
            throw error;
        });
        if (isFinal(first)) {
            return first;
        }
        const validUntil = bound ?? (await this.get(id, call).then((view) => view.valid_until_height, () => undefined));
        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(signal.reason);
                return;
            }
            let stop = () => { };
            const again = wire === undefined ? undefined : setInterval(() => void this.#again(id, wire), RESEND_MILLIS);
            const aborted = () => {
                clearInterval(again);
                stop();
                reject(signal?.reason);
            };
            signal?.addEventListener("abort", aborted, { once: true });
            stop = this.#pool().follow(first, validUntil, every, (status) => {
                clearInterval(again);
                signal?.removeEventListener("abort", aborted);
                resolve(status);
            });
        });
    }
    async #again(id, wire) {
        try {
            await this.status(id);
        }
        catch (error) {
            if (error instanceof TenraiApiError && error.status === 404) {
                await this.submit(wire).catch(() => { });
            }
        }
    }
    #pool() {
        const factory = this.#sockets.factory();
        this.#waiters ??= new Waiters({
            open: factory && (() => new LiveSocket(this.#http, factory, { reconnect: this.#sockets.reconnect })),
            statuses: (ids) => this.statuses(ids),
            head: () => this.#http.get("/v1/chain/head"),
        });
        return this.#waiters;
    }
}
/** An unknown transaction can still execute before its validity bound. */
function unseen(id) {
    return { api_version: 1, transaction_id: id, lifecycle: "processing", observed_work: null, registered_cut: null, finalized_cut: null, failure: null };
}
function cutHeight(value) {
    const height = typeof value === "bigint" && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
    return whole(height, "validUntil");
}
