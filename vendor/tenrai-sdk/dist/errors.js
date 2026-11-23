/** Base SDK error. Invalid arguments throw TypeError or RangeError before I/O. */
export class TenraiError extends Error {
    name = "TenraiError";
}
/** HTTP or node API error. */
export class TenraiApiError extends TenraiError {
    name = "TenraiApiError";
    status;
    code;
    retryAfterMillis;
    /** Specific API reason, including `history_not_held` on a 404. */
    reason;
    constructor(status, code, message, retryAfterMillis, reason) {
        super(message);
        this.status = status;
        this.code = code;
        this.retryAfterMillis = retryAfterMillis;
        this.reason = reason;
    }
    /** Whether the server reports a retryable status. */
    get retryable() {
        return this.code === "rate_limited" || this.code === "unavailable";
    }
}
/** The request failed before receiving a response. */
export class TenraiNetworkError extends TenraiError {
    name = "TenraiNetworkError";
}
export class TenraiTimeoutError extends TenraiError {
    name = "TenraiTimeoutError";
}
/** The response exceeds its size limit or has an invalid shape. */
export class TenraiResponseError extends TenraiError {
    name = "TenraiResponseError";
}
/** The expected response signature is missing or invalid. */
export class TenraiSignatureError extends TenraiError {
    name = "TenraiSignatureError";
}
export class TenraiWalletError extends TenraiError {
    name = "TenraiWalletError";
    code;
    details;
    constructor(message, code, details = {}, options) {
        super(message, options);
        this.code = code;
        this.details = details;
    }
}
