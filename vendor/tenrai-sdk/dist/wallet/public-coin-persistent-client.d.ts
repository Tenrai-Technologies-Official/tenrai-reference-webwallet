import type { PublicCoin, PublicCoinStoreOptions, PublicCoinQuery, PublicLargestCoinQuery } from "./public-coin-store.ts";
import type { CoinScanProgress, PersistentPublicCoinStore, PublicCoinCheckpoint, PublicCoinCheckpointCodec, PublicCoinMutation } from "./public-coin-persistent-types.ts";
export interface PersistentCoinTransport {
    run(plan: Generator<unknown, unknown, unknown>, write: boolean): Promise<unknown>;
    /** Deletes at most256 positively scoped superseded rows/index entries. */
    collect(generation: string): Promise<number>;
    close(): Promise<void>;
}
/** One physical owner; incomplete scan progress never publishes a complete wallet balance. */
export declare class PersistentCoins implements PersistentPublicCoinStore {
    #private;
    constructor(namespace: string, transport: PersistentCoinTransport, options: PublicCoinStoreOptions);
    recover(codec: PublicCoinCheckpointCodec): Promise<PublicCoinCheckpoint | null>;
    reset(next: CoinScanProgress, codec: PublicCoinCheckpointCodec): Promise<PublicCoinCheckpoint>;
    commitPage(values: readonly PublicCoinMutation[], next: CoinScanProgress, codec: PublicCoinCheckpointCodec): Promise<PublicCoinCheckpoint>;
    get(key: string): Promise<PublicCoin | null>;
    page(query?: PublicCoinQuery): Promise<{
        coins: PublicCoin[];
        nextAfter: string | null;
    }>;
    largestPage(query?: PublicLargestCoinQuery): Promise<{
        coins: PublicCoin[];
        nextAfter: {
            amount: bigint;
            key: string;
        } | null;
    }>;
    close(): Promise<void>;
}
