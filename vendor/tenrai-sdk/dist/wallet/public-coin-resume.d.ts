import type { PublicCoin, PublicCoinQuery, PublicCoinPage } from "./public-coin-store.ts";
import type { PersistentPublicCoinStore, PublicCoinCheckpoint, PublicCoinCheckpointCodec } from "./public-coin-persistent-types.ts";
export interface CoinObservation {
    address: string;
    branch: "receive" | "change";
    index: number;
    height: number;
    funded: boolean;
    used: boolean;
}
export interface CoinAnchor {
    height: number;
    cutId: string;
    stateRoot: string;
}
export interface CoinBatchEntry {
    address: string;
    afterHeight: number;
}
export interface CoinRangeEvent {
    address: string;
    height: number;
    kind: "received" | "spent";
    coin: PublicCoin;
}
export interface CoinScanSource {
    base(address: string, after: string | undefined, limit: number): Promise<{
        address: string;
        anchor: CoinAnchor;
        coins: PublicCoin[];
        more: boolean;
    }>;
    history(entries: readonly CoinBatchEntry[], target: number, cursor: string | undefined, limit: number): Promise<{
        atHeight: number;
        indexedHeight: number;
        historyFrom: number;
        events: CoinRangeEvent[];
        completed: string[];
        nextCursor: string | null;
    }>;
}
/** Only authenticated-cache path hints; callers re-derive ownership and fetch fresh balance heads. */
export declare function publicCoinRecoveryObservations(checkpoint: PublicCoinCheckpoint): {
    address: string;
    branch: "receive" | "change";
    index: number;
    height: number;
    funded: boolean;
    used: boolean;
}[];
export declare class PublicCoinHistoryGap extends Error {
    tracked: CoinObservation[];
    constructor(tracked: CoinObservation[]);
}
/** Durable page progress is advisory; only a completed cohort is exposed to planners. */
export declare class ResumableCoinInventory {
    #private;
    constructor(source: CoinScanSource, store: PersistentPublicCoinStore, codec: PublicCoinCheckpointCodec, held: (coin: PublicCoin) => boolean, restore: (row: CoinObservation) => void, budget: number, cancelled: () => boolean);
    static open(source: CoinScanSource, observed: readonly CoinObservation[], store: PersistentPublicCoinStore, codec: PublicCoinCheckpointCodec, held: (coin: PublicCoin) => boolean, restore: (row: CoinObservation) => void, budget?: number, cancelled?: () => boolean, reset?: boolean): Promise<ResumableCoinInventory>;
    get finalizedHeight(): number;
    get addresses(): {
        address: string;
        utxos: number;
    }[];
    summaries(): {
        address: string;
        atoms: bigint;
        outputs: number;
    }[];
    refresh(observed: readonly CoinObservation[], budget?: number): Promise<void>;
    get(key: string): Promise<PublicCoin | null>;
    available(heldKeys: ReadonlySet<string>): Promise<bigint>;
    page(query?: PublicCoinQuery): Promise<PublicCoinPage>;
    visit(take: (coin: PublicCoin) => boolean | void): Promise<void>;
    largest(limit: number, address?: string): Promise<PublicCoin[]>;
    consolidation(above?: number): Promise<PublicCoin[]>;
    close(): Promise<void>;
}
