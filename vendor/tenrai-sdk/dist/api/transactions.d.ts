import type { CallOptions, Transport } from "../http.ts";
import type { ReconnectOptions, WebSocketConstructor } from "../sockets/socket.ts";
import { StatusStream, type StatusStreamOptions } from "../sockets/status.ts";
import type { CompactTransactionView, TransactionList, TransactionManifest, TransactionStatus, TransactionStatusBatch, TransactionSubmissionReceipt, TransactionView } from "../types/transaction.ts";
import type { RecentOptions } from "./ledger.ts";
export declare const MAX_STATUS_BATCH = 1024;
export interface SocketContext {
    factory(): WebSocketConstructor | undefined;
    reconnect: ReconnectOptions | undefined;
}
export interface WaitOptions extends CallOptions {
    timeoutMillis?: number;
    /** Final executable cut, inferred from the node when omitted. */
    validUntil?: number | bigint;
    /** Polling interval without WebSocket support. Defaults to 2,000 ms. */
    pollMillis?: number;
    /** Retry these exact signed bytes at most every 30 seconds when status is unknown. */
    wireHex?: string;
}
export declare class TransactionsApi {
    #private;
    /** @internal */
    constructor(http: Transport, sockets: SocketContext);
    /** `POST /v1/transactions`. Retry only after an explicit 429 or 503. */
    submit(wireHex: string, options?: CallOptions): Promise<TransactionSubmissionReceipt>;
    /** `POST /v1/transactions/status`. Up to 1,024 IDs, with missing IDs in `unknown`. */
    statuses(transactionIds: readonly string[], options?: CallOptions): Promise<TransactionStatusBatch>;
    /** `GET /v1/transactions/manifest`. Active transaction limits, mass rules and fee floor. */
    manifest(options?: CallOptions): Promise<TransactionManifest>;
    /** `GET /v1/transactions/recent`. Newest first. */
    recent(options?: RecentOptions): Promise<TransactionList>;
    /** `GET /v1/transactions/{id}`: the full transaction with inputs, outputs, fee and status. */
    get(transactionId: string, options?: CallOptions): Promise<TransactionView>;
    /** Retained display data without canonical witness bytes. */
    compact(transactionId: string, options?: CallOptions): Promise<CompactTransactionView>;
    /** `GET /v1/transactions/{id}/status`. */
    status(transactionId: string, options?: CallOptions): Promise<TransactionStatus>;
    /** `WS /v1/transactions/{id}/status/stream`: every status change until the transaction is final. */
    watch(transactionId: string, options?: StatusStreamOptions): StatusStream;
    /**
     * Wait for a terminal status, including expiry after `validUntil`.
     * Waiters share the client's sockets and batched polling.
     */
    waitForFinal(transactionId: string, options?: WaitOptions): Promise<TransactionStatus>;
}
