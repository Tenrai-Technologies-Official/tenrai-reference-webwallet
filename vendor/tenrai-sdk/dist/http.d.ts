import { TenraiApiError } from "./errors.ts";
import type { NodeIdentity } from "./types/node.ts";
export declare const DEFAULT_URL = "https://api.tenrai-technologies.org";
export declare const NONCE_HEADER = "x-tenrai-request-nonce";
export declare const SIGNATURE_HEADER = "x-tenrai-signature";
/** Rate-limit profile for a gateway or a node. */
export type Target = "api" | "node";
/** Request and response fields covered by the signature. */
export interface SignedExchange {
    method: string;
    target: string;
    requestBody: Uint8Array;
    status: number;
    responseBody: Uint8Array;
    headers: Headers;
    nonce: string;
}
/** Verifier for signed responses. See `signedResponses`. */
export interface ResponseVerifier {
    prepare?(readIdentity: () => Promise<NodeIdentity>): Promise<void>;
    verify(exchange: SignedExchange): void | Promise<void>;
}
export interface TransportOptions {
    /** Node or gateway base URL; defaults to https://api.tenrai-technologies.org. */
    url?: string | URL;
    /** Controls request limits. Defaults to `api`. */
    target?: Target;
    fetch?: typeof fetch;
    /** Per-request timeout. Defaults to 15,000 ms. */
    timeoutMillis?: number;
    /** Retries for reads after network errors, timeouts, 429 or 503. */
    retries?: number;
    headers?: Record<string, string>;
    /** Maximum response size. Defaults to 32 MiB. */
    maxResponseBytes?: number;
    verify?: ResponseVerifier;
    /** Request rate with a burst of twice the rate. Zero disables it. */
    requestsPerSecond?: number;
    /** Concurrent request cap. Defaults to four for `api`, unlimited for `node`. */
    maxConcurrent?: number;
}
export interface CallOptions {
    signal?: AbortSignal;
    /** Override the request timeout for this call. */
    timeoutMillis?: number;
    /** Response byte limit for this call, within the client cap. */
    maxResponseBytes?: number;
}
export type Query = Record<string, string | number | undefined>;
interface Request {
    method: "GET" | "POST";
    path: string;
    query?: Query | undefined;
    body?: unknown;
    /** Submission retries require an explicit 429 or 503 response. */
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
/** Decode an API error from an HTTP or WebSocket response. */
export declare function errorFrom(status: number, document: unknown, text?: string, retryAfterMillis?: number): TenraiApiError;
export declare function sleep(millis: number, signal?: AbortSignal): Promise<void>;
export {};
