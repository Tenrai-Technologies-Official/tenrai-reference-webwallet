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
    /** The last cut height the transaction can execute at, such as `SentTransfer.validUntil`; read from the node when missing. */
    validUntil?: number | bigint;
    /** Status polling interval when the runtime has no WebSocket, 2000 by default. */
    pollMillis?: number;
    /**
     * The signed transaction, such as `SentTransfer.wireHex`: while the node does not know it, it goes out again
     * unchanged, at most every 30 s, as a node that restarts forgets what only its pool held.
     */
    wireHex?: string;
}
export declare class TransactionsApi {
    #private;
    /** @internal */
    constructor(http: Transport, sockets: SocketContext);
    /** `POST /v1/transactions`: submits a signed transaction. Repeated only after an explicit 429 or 503, so a lost answer never submits twice. */
    submit(wireHex: string, options?: CallOptions): Promise<TransactionSubmissionReceipt>;
    /** `POST /v1/transactions/status`: statuses of up to 1024 transactions; ids the node does not know come back in `unknown`. */
    statuses(transactionIds: readonly string[], options?: CallOptions): Promise<TransactionStatusBatch>;
    /** `GET /v1/transactions/manifest`: limits, mass rules and fee floor a transaction must meet. */
    manifest(options?: CallOptions): Promise<TransactionManifest>;
    /** `GET /v1/transactions/recent`: the transactions this node saw last, newest first. */
    recent(options?: RecentOptions): Promise<TransactionList>;
    /** `GET /v1/transactions/{id}`: the full transaction with inputs, outputs, fee and status. */
    get(transactionId: string, options?: CallOptions): Promise<TransactionView>;
    /** Compact display data with explicit local provenance; no canonical witness bytes. */
    compact(transactionId: string, options?: CallOptions): Promise<CompactTransactionView>;
    /** `GET /v1/transactions/{id}/status`: where the transaction is in its lifecycle. */
    status(transactionId: string, options?: CallOptions): Promise<TransactionStatus>;
    /** `WS /v1/transactions/{id}/status/stream`: every status change until the transaction is final. */
    watch(transactionId: string, options?: StatusStreamOptions): StatusStream;
    /**
     * Resolves with the final status, see `isFinal`, or as `failed` with the node's reason or `expired` once the
     * chain passed `validUntil` without executing it. All waits of a client share sockets and one batched poll.
     */
    waitForFinal(transactionId: string, options?: WaitOptions): Promise<TransactionStatus>;
}
