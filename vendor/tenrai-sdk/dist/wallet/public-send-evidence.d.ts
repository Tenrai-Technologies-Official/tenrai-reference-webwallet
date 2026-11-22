import type { TenraiClient } from "../client.ts";
import type { Network, OutPoint, UtxoSource } from "../types/common.ts";
import { type OutcomeAnchor } from "./unknown-outcome.ts";
import type { Bindings } from "./runtime.ts";
import type { Coin } from "./plan.ts";
import type { PublicWalletState } from "./wallet-public.ts";
interface Context {
    wasm: Bindings;
    network: Network;
    account: number;
    root(): InstanceType<Bindings["WalletRoot"]>;
    genesis(): string | undefined;
}
declare const nativeInputBrand: unique symbol;
export interface VerifiedNativeInput {
    readonly [nativeInputBrand]: true;
}
export interface NativeInputFacts {
    readonly address: string;
    readonly outpoint: Readonly<OutPoint>;
    readonly amount: bigint;
    readonly createdHeight: bigint;
    readonly source: UtxoSource;
    readonly anchor: OutcomeAnchor;
}
export declare function nativeInputFacts(input: VerifiedNativeInput, owner: PublicSendEvidence): NativeInputFacts;
/** A separate public finality context works while private note recovery and its UI are inactive. */
export declare class PublicSendEvidence {
    #private;
    readonly state: PublicWalletState;
    readonly context: Context;
    constructor(state: PublicWalletState, context: Context);
    reconcile(client: TenraiClient): Promise<string[]>;
    ready(until: bigint): Promise<void>;
    /** Cached facts are advisory: genuine current-QC presence must bind every selected input before signing. */
    verifyCoins(client: TenraiClient, coins: readonly Coin[], chain: string): Promise<void>;
    /** Conditional outputs use the same current-QC verifier and canonical Rust record decoder. */
    readNativeInput(client: TenraiClient, address: string, outpoint: OutPoint, chain: string): Promise<VerifiedNativeInput>;
    close(): Promise<void>;
}
export {};
