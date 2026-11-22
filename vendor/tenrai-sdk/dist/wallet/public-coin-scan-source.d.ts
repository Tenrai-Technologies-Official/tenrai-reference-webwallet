import type { TenraiClient } from "../client.ts";
import type { CoinObservation, CoinScanSource } from "./public-coin-resume.ts";
/** Normalizes advisory reads; certified input proofs remain a separate signing boundary. */
export declare function publicCoinScanSource(client: TenraiClient): CoinScanSource;
export declare function freshPublicCoinObservations(client: TenraiClient, tracked: CoinObservation[]): Promise<CoinObservation[]>;
