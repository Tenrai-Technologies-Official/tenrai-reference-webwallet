import type { ChainHead } from "../types/chain.ts";
import type { TransactionStatus, TransactionStatusBatch } from "../types/transaction.ts";
import type { LiveSocket } from "./live.ts";
export interface WaiterSource {
    /** Missing when the runtime has no WebSocket. */
    open: (() => LiveSocket) | undefined;
    statuses(ids: string[]): Promise<TransactionStatusBatch>;
    head(): Promise<ChainHead>;
}
/** Every `waitForFinal` of one client: shared sockets for updates, one batched status poll for all. */
export declare class Waiters {
    #private;
    constructor(source: WaiterSource);
    /** Calls `settle` once, with a final or expired status; returns the function that stops following. */
    follow(first: TransactionStatus, validUntil: number | undefined, pollMillis: number, settle: (status: TransactionStatus) => void): () => void;
}
