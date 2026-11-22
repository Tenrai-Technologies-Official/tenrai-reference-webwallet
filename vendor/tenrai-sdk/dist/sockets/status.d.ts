import { type TenraiError } from "../errors.ts";
import type { Transport } from "../http.ts";
import type { TransactionStatus } from "../types/transaction.ts";
import { type CloseInfo, Emitter, type ReconnectOptions, type WebSocketConstructor } from "./socket.ts";
export declare const TRANSACTION_STATUS_PROTOCOL = "tenrai.transaction-status.v1";
/** The node's rule: finalized, or failed for good in a finalized cut. */
export declare function isFinal(status: TransactionStatus): boolean;
export interface StatusStreamOptions {
    reconnect?: ReconnectOptions;
    idleTimeoutMillis?: number;
}
export type StatusStreamEvents = {
    status: [TransactionStatus];
    final: [TransactionStatus];
    open: [];
    close: [CloseInfo];
    error: [TenraiError];
};
/** One transaction's status until it is final; a new snapshot follows every reconnect. */
export declare class StatusStream extends Emitter<StatusStreamEvents> {
    #private;
    /** @internal */
    constructor(http: Transport, factory: WebSocketConstructor, transactionId: string, options?: StatusStreamOptions);
    /** The last status received. */
    get latest(): TransactionStatus | undefined;
    close(): void;
}
