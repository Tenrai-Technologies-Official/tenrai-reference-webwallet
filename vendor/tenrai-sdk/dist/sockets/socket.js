import { TenraiError, TenraiNetworkError, TenraiResponseError, TenraiTimeoutError } from "../errors.js";
const CONNECT_TIMEOUT_MILLIS = 15_000;
/** What a caller's listener throws surfaces as an uncaught error and leaves the socket alone. */
export function invoke(listener, ...args) {
    try {
        listener(...args);
    }
    catch (error) {
        queueMicrotask(() => {
            throw error;
        });
    }
}
export class Emitter {
    #listeners = new Map();
    /** Returns a function that removes the listener. */
    on(event, listener) {
        let set = this.#listeners.get(event);
        if (!set) {
            set = new Set();
            this.#listeners.set(event, set);
        }
        set.add(listener);
        return () => this.off(event, listener);
    }
    off(event, listener) {
        this.#listeners.get(event)?.delete(listener);
    }
    emit(event, ...args) {
        for (const listener of [...(this.#listeners.get(event) ?? [])]) {
            invoke(listener, ...args);
        }
    }
}
export function webSocketConstructor(given) {
    const found = given ?? globalThis.WebSocket;
    if (typeof found !== "function") {
        throw new TenraiError("this runtime has no WebSocket; pass options.WebSocket, for example from the ws package");
    }
    return found;
}
export class Backoff {
    #min;
    #max;
    #attempt = 0;
    constructor(options = {}) {
        this.#min = options.minDelayMillis ?? 500;
        this.#max = options.maxDelayMillis ?? 30_000;
        if (!(this.#min > 0 && this.#max >= this.#min)) {
            throw new RangeError("reconnect delays must be positive, with max at least min");
        }
    }
    next() {
        const ceiling = Math.min(this.#max, this.#min * 2 ** Math.min(this.#attempt, 30));
        this.#attempt += 1;
        return ceiling / 2 + (Math.random() * ceiling) / 2;
    }
    reset() {
        this.#attempt = 0;
    }
}
/** One WebSocket at a time, reopened after every loss until `stop`. */
export class Connection {
    #options;
    #handlers;
    #backoff;
    #outbox = [];
    #socket;
    #retry;
    #idle;
    #opening;
    #pacer;
    #tokens = 0;
    #refilledAt = 0;
    #stopped = false;
    constructor(options, handlers) {
        this.#options = options;
        this.#handlers = handlers;
        this.#backoff = new Backoff(options.reconnect);
    }
    get open() {
        return this.#socket?.readyState === 1;
    }
    get stopped() {
        return this.#stopped;
    }
    start() {
        if (this.#stopped || this.#socket) {
            return;
        }
        let socket;
        try {
            socket = new this.#options.factory(this.#options.url(), this.#options.protocol);
        }
        catch (error) {
            this.#handlers.failed(new TenraiNetworkError(`cannot open the socket: ${String(error)}`, { cause: error }));
            this.#schedule(1006, "");
            return;
        }
        this.#socket = socket;
        const opening = setTimeout(() => {
            if (this.#socket !== socket || this.#opening !== opening)
                return;
            this.#handlers.failed(new TenraiTimeoutError("the socket did not open in 15000 ms"));
            this.restart(4001, "opening timed out");
        }, CONNECT_TIMEOUT_MILLIS);
        this.#opening = opening;
        socket.onopen = () => {
            if (this.#socket !== socket) {
                return;
            }
            clearTimeout(this.#opening);
            this.#opening = undefined;
            if (socket.protocol !== this.#options.protocol) {
                this.#handlers.failed(new TenraiResponseError(`the server does not speak ${this.#options.protocol}`));
                this.restart(4002, "wrong subprotocol");
                return;
            }
            this.#tokens = this.#options.framesPerSecond ?? 0;
            this.#refilledAt = performance.now();
            this.#touch();
            this.#handlers.opened();
        };
        socket.onmessage = (event) => {
            if (this.#socket !== socket) {
                return;
            }
            this.#touch();
            if (typeof event.data !== "string" || event.data.length > this.#options.maxMessageChars) {
                this.#handlers.failed(new TenraiResponseError("the server sent a frame this protocol does not allow"));
                this.restart(4003, "unexpected frame");
                return;
            }
            try {
                this.#handlers.message(event.data);
            }
            catch (error) {
                this.#handlers.failed(new TenraiResponseError(`the server sent a frame that does not fit ${this.#options.protocol}`, { cause: error }));
                this.restart(4003, "protocol error");
            }
        };
        socket.onclose = (event) => {
            if (this.#socket !== socket) {
                return;
            }
            this.#detach();
            this.#schedule(event.code, event.reason);
        };
        socket.onerror = () => {
            if (this.#socket === socket) {
                this.#handlers.failed(new TenraiNetworkError("the socket connection failed"));
            }
        };
    }
    /** Keeps the delay short after a connection that worked. */
    settled() {
        this.#backoff.reset();
    }
    /** Queues the frame behind the pacing; false while no socket is open. */
    send(text, sent) {
        if (this.#socket?.readyState !== 1) {
            return false;
        }
        this.#outbox.push({ text, sent });
        this.#flush();
        return true;
    }
    /** Drops the current socket without waiting for its close handshake; the connection reopens it. */
    restart(code = 4000, reason = "restart") {
        const socket = this.#socket;
        if (!socket) {
            return;
        }
        this.#detach();
        socket.close(code, reason);
        this.#schedule(code, reason);
    }
    stop() {
        this.#stopped = true;
        clearTimeout(this.#retry);
        const socket = this.#socket;
        this.#detach();
        if (socket && socket.readyState <= 1) {
            socket.close(1000, "closed by the client");
        }
    }
    #detach() {
        this.#socket = undefined;
        this.#outbox.length = 0;
        clearTimeout(this.#idle);
        clearTimeout(this.#opening);
        clearTimeout(this.#pacer);
        this.#idle = undefined;
        this.#opening = undefined;
        this.#pacer = undefined;
    }
    #flush() {
        const socket = this.#socket;
        const rate = this.#options.framesPerSecond;
        if (socket?.readyState !== 1) {
            return;
        }
        if (rate !== undefined) {
            const now = performance.now();
            this.#tokens = Math.min(rate, this.#tokens + ((now - this.#refilledAt) * rate) / 1_000);
            this.#refilledAt = now;
        }
        for (let frame = this.#outbox[0]; frame !== undefined; frame = this.#outbox[0]) {
            if (rate !== undefined) {
                if (this.#tokens < 1) {
                    this.#pacer ??= setTimeout(() => {
                        this.#pacer = undefined;
                        this.#flush();
                    }, Math.ceil(((1 - this.#tokens) * 1_000) / rate));
                    return;
                }
                this.#tokens -= 1;
            }
            this.#outbox.shift();
            socket.send(frame.text);
            if (this.#socket !== socket)
                return;
            frame.sent?.();
            if (this.#socket !== socket)
                return;
        }
    }
    #schedule(code, reason) {
        const delay = this.#stopped ? undefined : this.#backoff.next();
        const again = this.#handlers.closed({ code, reason, ...(delay === undefined ? {} : { retryInMillis: delay }) });
        if (!again || this.#stopped || delay === undefined) {
            this.#stopped = true;
            return;
        }
        this.#retry = setTimeout(() => {
            this.#retry = undefined;
            this.start();
        }, delay);
    }
    #touch() {
        clearTimeout(this.#idle);
        this.#idle = setTimeout(() => this.restart(4001, "idle"), this.#options.idleMillis);
    }
}
