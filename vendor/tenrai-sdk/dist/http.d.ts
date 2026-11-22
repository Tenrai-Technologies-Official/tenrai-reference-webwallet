import { TenraiApiError } from "./errors.ts";
import type { NodeIdentity } from "./types/node.ts";
export declare const DEFAULT_URL = "https://api.tenrai-technologies.org";
export declare const NONCE_HEADER = "x-tenrai-request-nonce";
export declare const SIGNATURE_HEADER = "x-tenrai-signature";
/** `api` is the Tenrai API service (tenrai-api), `node` a node's own API. */
export type Target = "api" | "node";
/** One request and its answer, as the response signature covers them. */
export interface SignedExchange {
    method: string;
    target: string;
    requestBody: Uint8Array;
    status: number;
    responseBody: Uint8Array;
    headers: Headers;
    nonce: string;
}
/** Asks for signed answers and checks them; `signedResponses` from `@tenrai/sdk/verify` implements it. */
export interface ResponseVerifier {
    prepare?(readIdentity: () => Promise<NodeIdentity>): Promise<void>;
    verify(exchange: SignedExchange): void | Promise<void>;
}
export interface TransportOptions {
    /** Node or gateway base URL; defaults to https://api.tenrai-technologies.org. */
    url?: string | URL;
    /** What `url` points at, `api` by default; the request limits follow it. */
    target?: Target;
    fetch?: typeof fetch;
    /** Per request, 15000 by default. */
    timeoutMillis?: number;
    /** Repeats of a read after a network error, a timeout, 429 or 503. */
    retries?: number;
    headers?: Record<string, string>;
    /** Larger answers are refused; 32 MiB by default. */
    maxResponseBytes?: number;
    verify?: ResponseVerifier;
    /** Requests started per second, bursts of twice that: 10 for `api`, no limit for `node`. 0 turns it off. */
    requestsPerSecond?: number;
    /** Requests waiting on an answer at once: 4 for `api`, no limit for `node`. */
    maxConcurrent?: number;
}
export interface CallOptions {
    signal?: AbortSignal;
    /** This call's limit instead of the client's, as for a large upload. */
    timeoutMillis?: number;
    /** This response's byte limit, also bounded by the client's configured limit. */
    maxResponseBytes?: number;
}
export type Query = Record<string, string | number | undefined>;
interface Request {
    method: "GET" | "POST";
    path: string;
    query?: Query | undefined;
    body?: unknown;
    /** Submissions repeat only after an explicit refusal, never after a lost answer. */
    repeat: "reads" | "refusals";
    signal?: AbortSignal | undefined;
    timeoutMillis?: number | undefined;
    maxResponseBytes?: number | undefined;
    text?: boolean;
    unsigned?: boolean;
}
export declare class Transport {
    #private;
    readonly base: URL;
    readonly target: Target;
    constructor(options?: TransportOptions);
    url(path: string, query?: Query): URL;
    socketUrl(path: string, query?: Query): string;
    get<T>(path: string, query?: Query, options?: CallOptions): Promise<T>;
    post<T>(path: string, body: unknown, query?: Query, options?: CallOptions): Promise<T>;
    submit<T>(path: string, body: unknown, options?: CallOptions): Promise<T>;
    text(path: string, options?: CallOptions): Promise<string>;
    send<T>(request: Request): Promise<T>;
}
/** The error an answer with this status and body stands for, over HTTP or the socket. */
export declare function errorFrom(status: number, document: unknown, text?: string, retryAfterMillis?: number): TenraiApiError;
export declare function sleep(millis: number, signal?: AbortSignal): Promise<void>;
export {};
