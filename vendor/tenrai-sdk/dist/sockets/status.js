import { TenraiResponseError } from "../errors.js";
import { hash384 } from "../validate.js";
import { Connection, Emitter } from "./socket.js";
export const TRANSACTION_STATUS_PROTOCOL = "tenrai.transaction-status.v1";
const MAX_STATUS_CHARS = 64 * 1024;
/** The node's rule: finalized, or failed for good in a finalized cut. */
export function isFinal(status) {
    if (status.lifecycle === "finalized") {
        return true;
    }
    return (status.lifecycle === "failed" &&
        status.finalized_cut !== null &&
        (status.failure === "conflict" || status.failure === "expired"));
}
/** One transaction's status until it is final; a new snapshot follows every reconnect. */
export class StatusStream extends Emitter {
    #connection;
    #latest;
    /** @internal */
    constructor(http, factory, transactionId, options = {}) {
        super();
        const id = hash384(transactionId, "transactionId");
        this.#connection = new Connection({
            factory,
            url: () => http.socketUrl(`/v1/transactions/${id}/status/stream`),
            protocol: TRANSACTION_STATUS_PROTOCOL,
            maxMessageChars: MAX_STATUS_CHARS,
            idleMillis: options.idleTimeoutMillis ?? 90_000,
            reconnect: options.reconnect,
        }, {
            opened: () => this.emit("open"),
            message: (text) => this.#receive(text),
            closed: (info) => {
                const final = this.#latest !== undefined && isFinal(this.#latest);
                this.emit("close", final ? { code: info.code, reason: info.reason } : info);
                return !final;
            },
            failed: (error) => this.emit("error", error),
        });
        queueMicrotask(() => this.#connection.start());
    }
    /** The last status received. */
    get latest() {
        return this.#latest;
    }
    close() {
        this.#connection.stop();
    }
    #receive(text) {
        const frame = JSON.parse(text);
        if (frame.type === "resync_required") {
            return;
        }
        if (frame.type !== "snapshot" && frame.type !== "update") {
            throw new TenraiResponseError("the status stream sent an unknown frame");
        }
        this.#latest = frame.data;
        this.#connection.settled();
        this.emit("status", frame.data);
        if (isFinal(frame.data)) {
            this.emit("final", frame.data);
            this.#connection.stop();
        }
    }
}
