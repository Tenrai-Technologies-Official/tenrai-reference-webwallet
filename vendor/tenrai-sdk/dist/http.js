import { TenraiApiError, TenraiNetworkError, TenraiResponseError, TenraiTimeoutError, } from "./errors.js";
import { Lane } from "./limit.js";
export const DEFAULT_URL = "https://api.tenrai-technologies.org";
export const NONCE_HEADER = "x-tenrai-request-nonce";
export const SIGNATURE_HEADER = "x-tenrai-signature";
const DEFAULT_TIMEOUT_MILLIS = 15_000;
const DEFAULT_RETRIES = 2;
/** A busy node or an address over its budget has room again within seconds; each attempt waits longer. */
const DEFAULT_BUSY_RETRIES = 5;
const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_RETRY_DELAY_MILLIS = 30_000;
const MAX_RESPONSE_CHUNKS = 4_096;
/** The Tenrai API's budget for reads that reach its node: ten units per second, four of them waiting at once. */
const API_REQUESTS_PER_SECOND = 10;
const API_MAX_CONCURRENT = 4;
/** The Tenrai API relays two submissions per second and one at a time for each client. */
const API_SUBMISSIONS_PER_SECOND = 2;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function callLimits(options) {
    return { signal: options?.signal, timeoutMillis: options?.timeoutMillis, maxResponseBytes: options?.maxResponseBytes };
}
export class Transport {
    base;
    target;
    #prefix;
    #fetch;
    #timeoutMillis;
    #retries;
    #busyRetries;
    #headers;
    #maxResponseBytes;
    #verifier;
    #reads;
    #submissions;
    #prepared;
    constructor(options = {}) {
        const base = new URL(options.url ?? DEFAULT_URL);
        if (base.protocol !== "http:" && base.protocol !== "https:") {
            throw new TypeError("the node URL must use http or https");
        }
        if (base.username || base.password || base.search || base.hash) {
            throw new TypeError("the node URL must not carry credentials, a query or a fragment");
        }
        const fetcher = options.fetch ?? globalThis.fetch;
        if (typeof fetcher !== "function") {
            throw new TypeError("this runtime has no fetch; pass options.fetch");
        }
        this.base = base;
        this.#prefix = base.pathname.replace(/\/+$/, "");
        this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
        this.#timeoutMillis = positive(options.timeoutMillis, DEFAULT_TIMEOUT_MILLIS, "timeoutMillis");
        this.#retries = options.retries ?? DEFAULT_RETRIES;
        this.#busyRetries = options.retries ?? DEFAULT_BUSY_RETRIES;
        if (!Number.isSafeInteger(this.#retries) || this.#retries < 0) {
            throw new RangeError("retries must be a whole number");
        }
        this.#headers = { ...options.headers };
        this.#maxResponseBytes = positive(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, "maxResponseBytes");
        this.#verifier = options.verify;
        this.target = options.target ?? "api";
        if (this.target !== "api" && this.target !== "node") {
            throw new TypeError('target must be "api" or "node"');
        }
        const api = this.target === "api";
        const perSecond = options.requestsPerSecond ?? (api ? API_REQUESTS_PER_SECOND : 0);
        if (!Number.isFinite(perSecond) || perSecond < 0) {
            throw new RangeError("requestsPerSecond must be 0 or more");
        }
        const concurrent = options.maxConcurrent ?? (api ? API_MAX_CONCURRENT : Infinity);
        if (!(Number.isSafeInteger(concurrent) || concurrent === Infinity) || concurrent < 1) {
            throw new RangeError("maxConcurrent must be a whole number from 1");
        }
        this.#reads = new Lane(concurrent, perSecond, perSecond * 2);
        this.#submissions = api
            ? new Lane(1, API_SUBMISSIONS_PER_SECOND, API_SUBMISSIONS_PER_SECOND)
            : new Lane(concurrent, perSecond, perSecond * 2);
    }
    url(path, query) {
        const url = new URL(this.base.href);
        url.pathname = this.#prefix + path;
        for (const [key, value] of Object.entries(query ?? {})) {
            if (value !== undefined) {
                url.searchParams.append(key, String(value));
            }
        }
        return url;
    }
    socketUrl(path, query) {
        const url = this.url(path, query);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        return url.href;
    }
    get(path, query, options) {
        return this.send({ method: "GET", path, query, repeat: "reads", ...callLimits(options) });
    }
    post(path, body, query, options) {
        return this.send({ method: "POST", path, query, body, repeat: "reads", ...callLimits(options) });
    }
    submit(path, body, options) {
        return this.send({ method: "POST", path, body, repeat: "refusals", ...callLimits(options) });
    }
    text(path, options) {
        return this.send({ method: "GET", path, repeat: "reads", ...callLimits(options), text: true });
    }
    async send(request) {
        for (let attempt = 0;; attempt += 1) {
            try {
                return await this.#once(request);
            }
            catch (error) {
                const delay = this.#retryDelay(error, request, attempt);
                if (delay === undefined) {
                    throw error;
                }
                await sleep(delay, request.signal);
            }
        }
    }
    #retryDelay(error, request, attempt) {
        if (request.signal?.aborted) {
            return undefined;
        }
        const backoff = Math.min(250 * 2 ** attempt, 5_000) * (0.5 + Math.random() / 2);
        if (error instanceof TenraiApiError) {
            const refused = error.status === 429 || error.status === 503;
            if (!error.retryable || (request.repeat === "refusals" && !refused) || attempt >= (refused ? this.#busyRetries : this.#retries)) {
                return undefined;
            }
            // The lane holds back this request with all others.
            if (error.status === 429) {
                return 0;
            }
            const asked = error.retryAfterMillis === undefined ? backoff : error.retryAfterMillis * (refused ? attempt + 1 : 1);
            return Math.min(asked, MAX_RETRY_DELAY_MILLIS);
        }
        const lost = error instanceof TenraiNetworkError || error instanceof TenraiTimeoutError;
        return lost && request.repeat === "reads" && attempt < this.#retries ? backoff : undefined;
    }
    async #once(request) {
        const maximum = Math.min(this.#maxResponseBytes, positive(request.maxResponseBytes, this.#maxResponseBytes, "maxResponseBytes"));
        const limit = positive(request.timeoutMillis, this.#timeoutMillis, "timeoutMillis");
        const url = this.url(request.path, request.query);
        const target = url.pathname.slice(this.#prefix.length) + url.search;
        const body = request.body === undefined ? new Uint8Array() : encoder.encode(JSON.stringify(request.body));
        const headers = new Headers(this.#headers);
        headers.set("accept", request.text ? "text/plain" : "application/json");
        if (request.body !== undefined) {
            headers.set("content-type", "application/json");
        }
        const verifier = request.unsigned ? undefined : this.#verifier;
        const timeout = AbortSignal.timeout(limit);
        const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
        const interrupted = () => request.signal?.aborted ? request.signal.reason : new TenraiTimeoutError(`${request.method} ${target} took longer than ${limit} ms`);
        if (signal.aborted)
            throw interrupted();
        let nonce = "";
        if (verifier) {
            // Identity preparation is shared; cancelling this waiter must not cancel other callers.
            await untilAborted(this.#prepare(verifier), signal, interrupted);
            nonce = randomNonce();
            headers.set(NONCE_HEADER, nonce);
        }
        const lane = request.repeat === "refusals" ? this.#submissions : this.#reads;
        const release = await lane.enter(signal).catch((error) => { if (signal.aborted)
            throw interrupted(); throw error; });
        let response;
        let bytes;
        try {
            response = await this.#fetch(url, {
                method: request.method,
                headers,
                body: request.body === undefined ? null : body,
                signal,
                redirect: "error",
            });
            bytes = await untilAborted(readBody(response, maximum, signal), signal, interrupted);
            if (response.status === 429) {
                lane.refused(apiError(response, bytes).retryAfterMillis ?? 1_000);
            }
        }
        catch (error) {
            if (request.signal?.aborted) {
                throw request.signal.reason;
            }
            if (timeout.aborted) {
                throw new TenraiTimeoutError(`${request.method} ${target} took longer than ${limit} ms`);
            }
            if (error instanceof TenraiResponseError) {
                throw error;
            }
            throw new TenraiNetworkError(`${request.method} ${target} failed: ${describe(error)}`, { cause: error });
        }
        finally {
            release();
        }
        if (verifier && (response.ok || response.headers.has(SIGNATURE_HEADER))) {
            await untilAborted(Promise.resolve(verifier.verify({
                method: request.method,
                target,
                requestBody: body,
                status: response.status,
                responseBody: bytes,
                headers: response.headers,
                nonce,
            })), signal, interrupted);
        }
        if (!response.ok) {
            throw apiError(response, bytes);
        }
        if (request.text) {
            return decoder.decode(bytes);
        }
        try {
            return JSON.parse(decoder.decode(bytes));
        }
        catch {
            throw new TenraiResponseError(`${request.method} ${target} did not answer with JSON`);
        }
    }
    #prepare(verifier) {
        if (!verifier.prepare) {
            return Promise.resolve();
        }
        this.#prepared ??= verifier
            .prepare(() => this.send({ method: "GET", path: "/v1/node/identity", repeat: "reads", unsigned: true }))
            .catch((error) => {
            this.#prepared = undefined;
            throw error;
        });
        return this.#prepared;
    }
}
function untilAborted(work, signal, reason) {
    return new Promise((resolve, reject) => {
        const abort = () => { signal.removeEventListener("abort", abort); reject(reason()); };
        signal.addEventListener("abort", abort, { once: true });
        work.then((value) => { signal.removeEventListener("abort", abort); resolve(value); }, (error) => { signal.removeEventListener("abort", abort); reject(error); });
        if (signal.aborted)
            abort();
    });
}
async function readBody(response, limit, signal) {
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > limit) {
        void response.body?.cancel().catch(() => { });
        throw new TenraiResponseError(`the answer is larger than ${limit} bytes`);
    }
    if (!response.body) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > limit)
            throw new TenraiResponseError(`the answer is larger than ${limit} bytes`);
        return bytes;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    let complete = false;
    const cancel = () => { void reader.cancel().catch(() => { }); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
        for (;;) {
            if (signal.aborted)
                throw signal.reason;
            const { done, value } = await reader.read();
            if (done)
                break;
            if (!(value instanceof Uint8Array) || chunks.length >= MAX_RESPONSE_CHUNKS)
                throw new TenraiResponseError("the answer has too many or invalid stream chunks");
            total += value.byteLength;
            if (total > limit)
                throw new TenraiResponseError(`the answer is larger than ${limit} bytes`);
            chunks.push(value);
        }
        complete = true;
    }
    finally {
        signal.removeEventListener("abort", cancel);
        if (!complete)
            cancel();
        reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}
function apiError(response, bytes) {
    const retryAfter = retryAfterHeader(response.headers.get("retry-after"));
    let document;
    try {
        document = JSON.parse(decoder.decode(bytes));
    }
    catch {
        document = undefined;
    }
    const text = decoder.decode(bytes.subarray(0, 200)).replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
    return errorFrom(response.status, document, text, retryAfter);
}
/** The error an answer with this status and body stands for, over HTTP or the socket. */
export function errorFrom(status, document, text = "", retryAfterMillis) {
    if (isErrorDocument(document)) {
        const retry = document.retry_after_millis ?? retryAfterMillis;
        return new TenraiApiError(status, document.code, document.message, retry, reasonOf(status, document.reason));
    }
    return new TenraiApiError(status, statusCode(status), text || `HTTP ${status}`, retryAfterMillis);
}
const REASONS = ["already_pooled", "input_pooled", "input_missing", "note_pooled", "note_spent", "already_registered"];
/** A reason this SDK does not know, or one on another status than its own, reads as none. */
function reasonOf(status, value) {
    if (status === 404 && value === "history_not_held")
        return "history_not_held";
    return status === 409 && REASONS.includes(value) ? value : undefined;
}
function isErrorDocument(value) {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const document = value;
    return typeof document["code"] === "string" && typeof document["message"] === "string";
}
function statusCode(status) {
    switch (status) {
        case 404:
            return "not_found";
        case 409:
            return "conflict";
        case 413:
            return "payload_too_large";
        case 429:
            return "rate_limited";
        case 502:
        case 503:
        case 504:
            return "unavailable";
        default:
            return status < 500 ? "invalid_request" : "internal";
    }
}
function retryAfterHeader(value) {
    const seconds = Number(value);
    return value && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined;
}
function randomNonce() {
    const nonce = new Uint8Array(32);
    do {
        crypto.getRandomValues(nonce);
    } while (nonce.every((byte) => byte === 0));
    return Array.from(nonce, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function positive(value, fallback, name) {
    const chosen = value ?? fallback;
    if (!Number.isFinite(chosen) || chosen <= 0) {
        throw new RangeError(`${name} must be positive`);
    }
    return chosen;
}
function describe(error) {
    if (error instanceof Error) {
        const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
        return `${error.message}${cause}`;
    }
    return String(error);
}
export function sleep(millis, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason);
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", abort);
            resolve();
        }, millis);
        const abort = () => {
            clearTimeout(timer);
            reject(signal?.reason);
        };
        signal?.addEventListener("abort", abort, { once: true });
    });
}
