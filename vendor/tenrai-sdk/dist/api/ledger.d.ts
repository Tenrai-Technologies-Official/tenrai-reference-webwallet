import type { CallOptions, Transport } from "../http.ts";
import type { CutAddresses, CutChanges } from "../types/address.ts";
import type { BlockList, BlockView, CutBlocks, CutList, CutTransactions, CutView } from "../types/ledger.ts";
export interface RecentOptions extends CallOptions {
    limit?: number;
}
export declare class BlocksApi {
    #private;
    /** @internal */
    constructor(http: Transport);
    /** `GET /v1/blocks/recent`: the blocks this node accepted last, newest first. */
    recent(options?: RecentOptions): Promise<BlockList>;
    /** `GET /v1/blocks/{id}`: one block, from the pool or from finalized history. */
    get(blockId: string, options?: CallOptions): Promise<BlockView>;
}
export interface CutListOptions extends CallOptions {
    /** Only cuts below this height; pass the previous page's `next_before`. */
    before?: number;
    limit?: number;
}
export interface CutTransactionOptions extends CallOptions {
    cursor?: string;
    limit?: number;
}
export interface CutChangeOptions extends CallOptions {
    cursor?: number;
    limit?: number;
}
export declare class CutsApi {
    #private;
    /** @internal */
    constructor(http: Transport);
    /** `GET /v1/cuts`: finalized cuts, newest first, at most 100 per page. */
    list(options?: CutListOptions): Promise<CutList>;
    /** `GET /v1/cuts/{height}`: one finalized cut with the blocks it registered and executed. */
    get(height: number, options?: CallOptions): Promise<CutView>;
    /** `GET /v1/cuts/{height}/addresses`: addresses the cut paid or spent from. Only recent cuts; use `changes` for older ones. */
    addresses(height: number, options?: CallOptions): Promise<CutAddresses>;
    /** `GET /v1/cuts/{height}/changes`: every output the cut created or spent, paged by `next_cursor`. */
    changes(height: number, options?: CutChangeOptions): Promise<CutChanges>;
    /** `GET /v1/cuts/{height}/transactions`: the transactions the cut executed, paged by `next_cursor`. */
    transactions(height: number, options?: CutTransactionOptions): Promise<CutTransactions>;
    /** `GET /v1/cuts/{height}/blocks`: the blocks the cut executed. */
    blocks(height: number, options?: CallOptions): Promise<CutBlocks>;
}
