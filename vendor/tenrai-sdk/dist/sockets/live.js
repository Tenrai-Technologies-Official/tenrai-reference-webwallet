import { TenraiNetworkError, TenraiResponseError, TenraiTimeoutError } from "../errors.js";
import { errorFrom } from "../http.js";
import { Connection, Emitter } from "./socket.js";
import { Subscriptions } from "./subscriptions.js";
export const NODE_API_PROTOCOL = "tenrai.node-api.v1";
/** The Tenrai API sends frames of up to 2 MiB. */
const MAX_FRAME_CHARS = 4 * 1024 * 1024;
const MAX_PATH_BYTES = 1024;
const PING_AFTER_MILLIS = 25_000;
const SUBSCRIBE_TIMEOUT_MILLIS = 30_000;
/** The Tenrai API takes 10 frames a second and 4 requests of a socket at once, a node 100 frames a second and 8. */
const LIMITS = {
    api: { framesPerSecond: 8, inFlight: 4 },
    node: { framesPerSecond: 40, inFlight: 8 },
};
/** The multiplexed `/v1/ws` socket: subscriptions and read requests over one connection. */
export class LiveSocket extends Emitter {
    #connection;
    #subscriptions;
    #timeoutMillis;
    #maxInFlight;
    #pending = new Map();
    #queue = [];
    #inFlight = 0;
    #nextId = 1;
    #opened = false;
    #lastReceived = 0;
    #keepalive;
    /** @internal */
    constructor(http, factory, options = {}) {
        super();
        const limits = LIMITS[http.target];
        this.#timeoutMillis = options.requestTimeoutMillis ?? 15_000;
        this.#maxInFlight = limits.inFlight;
        const framesPerSecond = options.framesPerSecond ?? limits.framesPerSecond;
        if (!(framesPerSecond > 0)) {
            throw new RangeError("framesPerSecond must be positive");
        }
        this.#subscriptions = new Subscriptions({
            send: (frame) => this.#send(frame),
            expect: (group, resync) => this.#id({ kind: "subscribe", group, resync }),
            forget: (id) => this.#pending.delete(id),
            nextId: () => this.#frameId(),
            report: (error) => this.emit("error", error),
        });
        this.#connection = new Connection({
            factory,
            url: () => http.socketUrl("/v1/ws"),
            protocol: NODE_API_PROTOCOL,
            maxMessageChars: MAX_FRAME_CHARS,
            idleMillis: PING_AFTER_MILLIS * 2 + 10_000,
            reconnect: options.reconnect,
            framesPerSecond,
        }, {
            opened: () => this.#onOpen(),
            message: (text) => this.#receive(text),
            closed: (info) => {
                this.#onClose();
                this.emit("close", info);
                return true;
            },
            failed: (error) => this.emit("error", error),
        });
        this.#keepalive = setInterval(() => {
            if (this.#connection.open && Date.now() - this.#lastReceived >= PING_AFTER_MILLIS) {
                this.#send({ type: "ping", data: { id: this.#frameId() } });
            }
        }, PING_AFTER_MILLIS);
        queueMicrotask(() => this.#connection.start());
    }
    /** Renewed after every reconnect, followed by `onResync`. Equal subscriptions share one on the server. */
    subscribe(options) {
        if (this.#connection.stopped) {
            throw new TenraiNetworkError("the socket is closed");
        }
        return this.#subscriptions.add(options);
    }
    /** A GET read route answered over the socket, such as "/v1/chain/head". */
    request(path) {
        if (!path.startsWith("/v1/") || new TextEncoder().encode(path).length > MAX_PATH_BYTES) {
            return Promise.reject(new RangeError(`request paths start with /v1/ and hold at most ${MAX_PATH_BYTES} bytes`));
        }
        if (this.#connection.stopped) {
            return Promise.reject(new TenraiNetworkError("the socket is closed"));
        }
        return new Promise((resolve, reject) => {
            const call = {
                path,
                resolve: resolve,
                reject,
                settled: false,
                timer: setTimeout(() => {
                    if (call.settled) {
                        return;
                    }
                    call.settled = true;
                    const queued = this.#queue.indexOf(call);
                    if (queued >= 0) {
                        this.#queue.splice(queued, 1);
                    }
                    // The same call may have a new frame ID after reconnecting.
                    for (const [id, pending] of this.#pending) {
                        if (pending.kind === "request" && pending.call === call) {
                            this.#pending.delete(id);
                            this.#inFlight = Math.max(0, this.#inFlight - 1);
                            break;
                        }
                    }
                    reject(new TenraiTimeoutError(`the socket did not answer ${path} in ${this.#timeoutMillis} ms`));
                    this.#pump();
                }, this.#timeoutMillis),
            };
            this.#queue.push(call);
            this.#pump();
        });
    }
    /** Round trip in milliseconds. */
    ping() {
        return new Promise((resolve, reject) => {
            const id = this.#id({ kind: "ping", sent: 0, resolve, reject });
            if (!this.#send({ type: "ping", data: { id } })) {
                this.#pending.delete(id);
                reject(new TenraiNetworkError("the socket is not connected"));
            }
        });
    }
    close() {
        clearInterval(this.#keepalive);
        this.#connection.stop();
        this.#onClose();
        for (const call of this.#queue.splice(0)) {
            this.#fail(call, new TenraiNetworkError("the socket was closed"));
        }
        this.#subscriptions.clear();
    }
    #onOpen() {
        const reopened = this.#opened;
        this.#opened = true;
        this.#lastReceived = Date.now();
        this.#subscriptions.renew(reopened);
        this.#pump();
        this.emit("open");
    }
    #onClose() {
        const unanswered = [];
        for (const pending of this.#pending.values()) {
            if (pending.kind !== "request")
                clearTimeout(pending.timer);
            if (pending.kind === "request" && !pending.call.settled) {
                unanswered.push(pending.call);
            }
            else if (pending.kind === "ping") {
                pending.reject(new TenraiNetworkError("the socket closed before the pong"));
            }
        }
        this.#pending.clear();
        this.#queue.unshift(...unanswered);
        this.#inFlight = 0;
        this.#subscriptions.reset();
    }
    #pump() {
        while (this.#inFlight < this.#maxInFlight && this.#connection.open) {
            const call = this.#queue.shift();
            if (!call) {
                return;
            }
            if (call.settled) {
                continue;
            }
            const id = this.#id({ kind: "request", call });
            if (!this.#send({ type: "request", data: { id, path: call.path } })) {
                this.#pending.delete(id);
                this.#queue.unshift(call);
                return;
            }
            this.#inFlight += 1;
        }
    }
    #receive(text) {
        this.#lastReceived = Date.now();
        let frame;
        try {
            frame = JSON.parse(text);
        }
        catch {
            this.emit("error", new TenraiResponseError("the socket sent a frame that is not JSON"));
            return;
        }
        if (frame.type !== "error") {
            this.#connection.settled();
        }
        switch (frame.type) {
            case "notification":
                this.#subscriptions.notify(frame.data.subscription, frame.data.event);
                return;
            case "response": {
                const pending = this.#take(frame.data.id, "request");
                if (pending?.kind === "request") {
                    this.#inFlight = Math.max(0, this.#inFlight - 1);
                    const { status, body } = frame.data;
                    if (status >= 200 && status < 300) {
                        this.#settle(pending.call, body);
                    }
                    else {
                        this.#fail(pending.call, errorFrom(status, body));
                    }
                    this.#pump();
                }
                return;
            }
            case "subscribed": {
                const pending = this.#take(frame.data.id, "subscribe");
                if (pending?.kind === "subscribe") {
                    this.#subscriptions.subscribed(pending.group, frame.data.subscription, pending.resync);
                }
                return;
            }
            case "resync_required":
                this.#subscriptions.resync(frame.data.subscription, frame.data.reason);
                return;
            case "pong": {
                const pending = this.#take(frame.data.id, "ping");
                if (pending?.kind === "ping") {
                    pending.resolve(Date.now() - pending.sent);
                }
                return;
            }
            case "error": {
                const pending = frame.data.id === null ? undefined : this.#take(frame.data.id);
                const error = errorFrom(statusFor(frame.data.error.code), frame.data.error);
                if (pending?.kind === "request") {
                    this.#inFlight = Math.max(0, this.#inFlight - 1);
                    this.#fail(pending.call, error);
                    this.#pump();
                }
                else if (pending?.kind === "subscribe") {
                    this.#subscriptions.refused(pending.group, error);
                }
                else if (pending?.kind === "ping") {
                    pending.reject(error);
                }
                else {
                    this.emit("error", error);
                }
                return;
            }
            case "unsubscribed":
                return;
            default:
                this.emit("error", new TenraiResponseError("the socket sent an unknown frame"));
        }
    }
    #id(pending) {
        const id = this.#frameId();
        this.#pending.set(id, pending);
        return id;
    }
    #frameId() {
        const id = this.#nextId;
        this.#nextId += 1;
        return id;
    }
    #take(id, kind) {
        const pending = this.#pending.get(id);
        if (!pending || (kind !== undefined && pending.kind !== kind)
            || (pending.kind !== "request" && pending.timer === undefined))
            return undefined;
        this.#pending.delete(id);
        if (pending.kind !== "request")
            clearTimeout(pending.timer);
        return pending;
    }
    #send(frame) {
        const pending = this.#pending.get(frame.data.id);
        return this.#connection.send(JSON.stringify(frame), pending && pending.kind !== "request"
            ? () => this.#sent(frame.data.id, pending)
            : undefined);
    }
    #sent(id, pending) {
        if (this.#pending.get(id) !== pending)
            return;
        if (pending.kind === "ping")
            pending.sent = Date.now();
        const millis = pending.kind === "subscribe" ? SUBSCRIBE_TIMEOUT_MILLIS : this.#timeoutMillis;
        const timer = setTimeout(() => {
            if (this.#pending.get(id) !== pending || pending.timer !== timer)
                return;
            if (pending.kind === "subscribe") {
                this.emit("error", new TenraiTimeoutError(`the socket did not acknowledge ${pending.group.topic} in ${millis} ms`));
                this.#connection.restart(4001, "subscription acknowledgement timed out");
            }
            else {
                this.#take(id, "ping");
                pending.reject(new TenraiTimeoutError(`the socket did not answer the ping in ${millis} ms`));
            }
        }, millis);
        pending.timer = timer;
    }
    #settle(call, body) {
        if (!call.settled) {
            call.settled = true;
            clearTimeout(call.timer);
            call.resolve(body);
        }
    }
    #fail(call, error) {
        if (!call.settled) {
            call.settled = true;
            clearTimeout(call.timer);
            call.reject(error);
        }
    }
}
function statusFor(code) {
    const statuses = {
        invalid_request: 400,
        unsupported_api_version: 400,
        not_found: 404,
        conflict: 409,
        payload_too_large: 413,
        rate_limited: 429,
        unavailable: 503,
        internal: 500,
    };
    return statuses[code] ?? 500;
}
