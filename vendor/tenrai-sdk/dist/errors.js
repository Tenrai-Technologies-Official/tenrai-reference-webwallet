/** Base class of the SDK's own errors. Invalid arguments throw TypeError or RangeError before any request. */
export class TenraiError extends Error {
    name = "TenraiError";
}
/** The server answered with an error document, or an HTTP error without one. */
export class TenraiApiError extends TenraiError {
    name = "TenraiApiError";
    status;
    code;
    retryAfterMillis;
    /** On a refused transaction: what became of it. On `not_found`, `history_not_held`: this node just does not hold it. */
    reason;
    constructor(status, code, message, retryAfterMillis, reason) {
        super(message);
        this.status = status;
        this.code = code;
        this.retryAfterMillis = retryAfterMillis;
        this.reason = reason;
    }
    /** `rate_limited` and `unavailable`: the same request may succeed later. */
    get retryable() {
        return this.code === "rate_limited" || this.code === "unavailable";
    }
}
/** The request got no answer: connection refused, reset or DNS failure. */
export class TenraiNetworkError extends TenraiError {
    name = "TenraiNetworkError";
}
/** No answer within `timeoutMillis`. */
export class TenraiTimeoutError extends TenraiError {
    name = "TenraiTimeoutError";
}
/** The answer does not have the shape or size the API defines. */
export class TenraiResponseError extends TenraiError {
    name = "TenraiResponseError";
}
/** A signature was expected and is missing or does not verify. */
export class TenraiSignatureError extends TenraiError {
    name = "TenraiSignatureError";
}
/** A transfer the wallet cannot build or confirm; `code` says why. */
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
