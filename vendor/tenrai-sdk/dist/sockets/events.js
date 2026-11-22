import { TenraiResponseError } from "../errors.js";
import { whole } from "../validate.js";
import { Connection, Emitter } from "./socket.js";
export const NODE_EVENT_PROTOCOL = "tenrai.node-events.v1";
const MAX_EVENT_CHARS = 256 * 1024;
/** Every finalized cut exactly once and in order, resumed by height after each reconnect. */
export class EventStream extends Emitter {
    #connection;
    #lastHeight;
    #checkpoint;
    /** @internal */
    constructor(http, factory, options = {}) {
        super();
        this.#lastHeight = options.afterHeight === undefined ? undefined : whole(options.afterHeight, "afterHeight");
        this.#connection = new Connection({
            factory,
            url: () => http.socketUrl("/v1/events", this.#lastHeight === undefined ? undefined : { after_height: this.#lastHeight }),
            protocol: NODE_EVENT_PROTOCOL,
            maxMessageChars: MAX_EVENT_CHARS,
            idleMillis: options.idleTimeoutMillis ?? 90_000,
            reconnect: options.reconnect,
        }, {
            opened: () => {
                this.#checkpoint = undefined;
                this.emit("open");
            },
            message: (text) => this.#receive(text),
            closed: (info) => {
                this.emit("close", info);
                return true;
            },
            failed: (error) => this.emit("error", error),
        });
        queueMicrotask(() => this.#connection.start());
    }
    /** The height of the last cut delivered, or where the stream resumes. */
    get lastHeight() {
        return this.#lastHeight;
    }
    close() {
        this.#connection.stop();
    }
    #receive(text) {
        let event;
        try {
            event = JSON.parse(text);
        }
        catch {
            this.#broken("the event stream sent a frame that is not JSON");
            return;
        }
        switch (event.type) {
            case "checkpoint": {
                if (this.#checkpoint) {
                    this.#broken("the event stream sent a second checkpoint");
                    return;
                }
                this.#checkpoint = event.data;
                this.#lastHeight ??= event.data.finalized.height;
                this.#connection.settled();
                this.emit("checkpoint", event.data);
                return;
            }
            case "cut_finalized": {
                const height = event.data.cut.height;
                if (!this.#checkpoint || this.#lastHeight === undefined) {
                    this.#broken("the event stream sent a cut before its checkpoint");
                    return;
                }
                if (height <= this.#lastHeight) {
                    return;
                }
                if (height !== this.#lastHeight + 1) {
                    this.#broken(`the event stream skipped from height ${this.#lastHeight} to ${height}`);
                    return;
                }
                this.#lastHeight = height;
                this.emit("cut", event.data);
                return;
            }
            case "resync_required": {
                if (event.data.reason === "history_unavailable" && this.#checkpoint) {
                    const finalized = this.#checkpoint.finalized;
                    this.#lastHeight = Math.max(this.#lastHeight ?? 0, finalized.height);
                    this.emit("resync", { reason: event.data.reason, finalized });
                }
                return;
            }
            default:
                this.#broken("the event stream sent an unknown frame");
        }
    }
    #broken(message) {
        this.emit("error", new TenraiResponseError(message));
        this.#connection.restart(4003, "protocol error");
    }
}
