import type { PublicCoin, PublicCoinStore } from "./public-coin-store.ts";
/** Opaque controller phase and address watermarks. */
export type CoinScanProgress = string;
export interface PublicCoinCheckpoint {
    generation: string;
    root: string;
    coinCount: number;
    totalAtoms: string;
    progress: CoinScanProgress;
}
export type PublicCoinMutation = {
    kind: "put";
    coin: PublicCoin;
} | {
    kind: "remove";
    key: string;
    address: string;
};
export type PublicCoinHashDomain = "coin_row" | "coin_chain" | "coin_end" | "coin_branch" | "coin_root";
/** Synchronous crypto hooks for IndexedDB transactions. */
export interface PublicCoinCheckpointCodec {
    readonly scope: string;
    /** Validate bounded metadata and its wallet, chain, genesis and account scope. */
    open(sealed: Uint8Array): PublicCoinCheckpoint;
    seal(checkpoint: PublicCoinCheckpoint): Uint8Array;
    /** Encode the first 20 bits of the keyed bucket MAC as five lowercase hex digits. */
    bucket(key: string): string;
    hash(domain: PublicCoinHashDomain, bytes: Uint8Array): string;
}
export interface PersistentPublicCoinStore extends Pick<PublicCoinStore, "get" | "page" | "largestPage"> {
    /** Stream rows and verify their indexes and keyed buckets when opening. */
    recover(codec: PublicCoinCheckpointCodec): Promise<PublicCoinCheckpoint | null>;
    /** Atomically persist up to 256 row mutations, their hash paths and sealed progress. */
    commitPage(mutations: readonly PublicCoinMutation[], progress: CoinScanProgress, codec: PublicCoinCheckpointCodec): Promise<PublicCoinCheckpoint>;
    /** Start an empty owned generation. Collect only owned superseded data. */
    reset(progress: CoinScanProgress, codec: PublicCoinCheckpointCodec): Promise<PublicCoinCheckpoint>;
    /** Drain writes, release the lease and retain the checkpoint for resume. */
    close(): Promise<void>;
}
export declare const MAX_PUBLIC_COIN_PROGRESS_BYTES: number;
export declare const MAX_PUBLIC_COIN_CHECKPOINT_BYTES: number;
