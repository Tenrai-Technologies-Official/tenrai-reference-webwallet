import type { PublicCoin, PublicCoinStore } from "./public-coin-store.ts";
/** Opaque JSON for the controller phase/address watermarks, never a financial authority. */
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
/** Synchronous crypto hooks: no network, prover, Promise, or raw key may enter an IDB transaction. */
export interface PublicCoinCheckpointCodec {
    readonly scope: string;
    /** Rejects wrong wallet/chain/genesis/account/format and malformed bounded metadata. */
    open(sealed: Uint8Array): PublicCoinCheckpoint;
    seal(checkpoint: PublicCoinCheckpoint): Uint8Array;
    /** CC-secret standard-MAC assignment: first20bits as exactly5 lowercase hex characters. */
    bucket(key: string): string;
    hash(domain: PublicCoinHashDomain, bytes: Uint8Array): string;
}
export interface PersistentPublicCoinStore extends Pick<PublicCoinStore, "get" | "page" | "largestPage"> {
    /** Full streamed row/index integrity check once per open, including actual keyed bucket assignment. */
    recover(codec: PublicCoinCheckpointCodec): Promise<PublicCoinCheckpoint | null>;
    /** Atomic ordered rows+affected authenticated hash paths+sealed progress, <=256 mutations. */
    commitPage(mutations: readonly PublicCoinMutation[], progress: CoinScanProgress, codec: PublicCoinCheckpointCodec): Promise<PublicCoinCheckpoint>;
    /** Fresh owned generation/empty digest. Only superseded positively owned data may be collected. */
    reset(progress: CoinScanProgress, codec: PublicCoinCheckpointCodec): Promise<PublicCoinCheckpoint>;
    /** Drain writes/release physical lease; preserve stable resumable generation and checkpoint. */
    close(): Promise<void>;
}
export declare const MAX_PUBLIC_COIN_PROGRESS_BYTES: number;
export declare const MAX_PUBLIC_COIN_CHECKPOINT_BYTES: number;
