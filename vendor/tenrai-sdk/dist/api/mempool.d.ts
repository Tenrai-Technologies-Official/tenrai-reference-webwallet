import type { CallOptions, Transport } from "../http.ts";
import type { MempoolEntries, PendingPayments } from "../types/mempool.ts";
import type { MempoolInfo } from "../types/node.ts";
export declare class MempoolApi {
    #private;
    /** @internal */
    constructor(http: Transport);
    /** `GET /v1/mempool`: size and limits of the transaction pool. */
    info(options?: CallOptions): Promise<MempoolInfo>;
    /** `GET /v1/mempool/transactions`: pooled transactions in the pool's priority order. */
    transactions(options?: CallOptions & {
        limit?: number;
    }): Promise<MempoolEntries>;
    /** `POST /v1/mempool/pending`: payments to these addresses still in the pool. Pending, never part of a balance. */
    pending(owners: readonly string[], options?: CallOptions): Promise<PendingPayments>;
}
