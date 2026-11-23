import type { ApiErrorCode, ApiErrorReason } from "./types/common.ts";
/** Base SDK error. Invalid arguments throw TypeError or RangeError before I/O. */
export declare class TenraiError extends Error {
    name: string;
}
/** HTTP or node API error. */
export declare class TenraiApiError extends TenraiError {
    name: string;
    readonly status: number;
    readonly code: ApiErrorCode;
    readonly retryAfterMillis: number | undefined;
    /** Specific API reason, including `history_not_held` on a 404. */
    readonly reason: ApiErrorReason | undefined;
    constructor(status: number, code: ApiErrorCode, message: string, retryAfterMillis?: number, reason?: ApiErrorReason);
    /** Whether the server reports a retryable status. */
    get retryable(): boolean;
}
/** The request failed before receiving a response. */
export declare class TenraiNetworkError extends TenraiError {
    name: string;
}
export declare class TenraiTimeoutError extends TenraiError {
    name: string;
}
/** The response exceeds its size limit or has an invalid shape. */
export declare class TenraiResponseError extends TenraiError {
    name: string;
}
/** The expected response signature is missing or invalid. */
export declare class TenraiSignatureError extends TenraiError {
    name: string;
}
export type WalletErrorCode = "insufficient" | "compound-needed" | "fee-ceiling" | "fee-unsettled" | "too-heavy" | "too-many-outputs" | "wrong-network" | "invalid" | "rejected" | "unconfirmed" | "history-not-held";
export declare class TenraiWalletError extends TenraiError {
    name: string;
    readonly code: WalletErrorCode;
    readonly details: Record<string, unknown>;
    constructor(message: string, code: WalletErrorCode, details?: Record<string, unknown>, options?: ErrorOptions);
}
