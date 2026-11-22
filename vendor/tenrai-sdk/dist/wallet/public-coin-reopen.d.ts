import { ResumableCoinInventory, type CoinObservation, type CoinScanSource } from "./public-coin-resume.ts";
import type { PersistentPublicCoinStore, PublicCoinCheckpointCodec } from "./public-coin-persistent-types.ts";
import type { PublicCoin } from "./public-coin-store.ts";
interface RecoveryOptions {
    rebuild?: boolean;
    previous?: ResumableCoinInventory;
    source: CoinScanSource;
    observed: CoinObservation[];
    factory: () => Promise<PersistentPublicCoinStore>;
    codec: PublicCoinCheckpointCodec;
    observe: (tracked: CoinObservation[]) => Promise<CoinObservation[]>;
    held: (coin: PublicCoin) => boolean;
    restore: (row: CoinObservation) => void;
    budget: number;
    cancelled: () => boolean;
}
/** An expired advisory range permits one fresh owned generation, never an authoritative journal reset. */
export declare function reopenPublicCoins(options: RecoveryOptions): Promise<ResumableCoinInventory>;
export {};
