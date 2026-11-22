import type { ApiErrorCode, ApiErrorReason } from "./types/common.ts";
/** Base class of the SDK's own errors. Invalid arguments throw TypeError or RangeError before any request. */
export declare class TenraiError extends Error {
    name: string;
}
/** The server answered with an error document, or an HTTP error without one. */
export declare class TenraiApiError extends TenraiError {
    name: string;
    readonly status: number;
    readonly code: ApiErrorCode;
    readonly retryAfterMillis: number | undefined;
    /** On a refused transaction: what became of it. On `not_found`, `history_not_held`: this node just does not hold it. */
    readonly reason: ApiErrorReason | undefined;
    constructor(status: number, code: ApiErrorCode, message: string, retryAfterMillis?: number, reason?: ApiErrorReason);
    /** `rate_limited` and `unavailable`: the same request may succeed later. */
    get retryable(): boolean;
}
/** The request got no answer: connection refused, reset or DNS failure. */
export declare class TenraiNetworkError extends TenraiError {
    name: string;
}
/** No answer within `timeoutMillis`. */
export declare class TenraiTimeoutError extends TenraiError {
    name: string;
}
/** The answer does not have the shape or size the API defines. */
export declare class TenraiResponseError extends TenraiError {
    name: string;
}
/** A signature was expected and is missing or does not verify. */
export declare class TenraiSignatureError extends TenraiError {
    name: string;
}
export type WalletErrorCode = "insufficient" | "compound-needed" | "fee-ceiling" | "fee-unsettled" | "too-heavy" | "too-many-outputs" | "wrong-network" | "invalid" | "rejected" | "unconfirmed" | "history-not-held";
/** A transfer the wallet cannot build or confirm; `code` says why. */
export declare class TenraiWalletError extends TenraiError {
    name: string;
    readonly code: WalletErrorCode;
    readonly details: Record<string, unknown>;
    constructor(message: string, code: WalletErrorCode, details?: Record<string, unknown>, options?: ErrorOptions);
}
