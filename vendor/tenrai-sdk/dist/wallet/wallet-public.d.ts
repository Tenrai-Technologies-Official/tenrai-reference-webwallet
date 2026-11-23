import type { PublicCoinView } from "./public-coin-source.ts";
import type { TenraiClient } from "../client.ts";
import type { Network } from "../types/common.ts";
import type { TransactionLifecycle } from "../types/transaction.ts";
import type { Context } from "./context.ts";
import * as funds from "./funds.ts";
import type { KeyChain } from "./keychain.ts";
import type { PrivateStoreSession } from "./private-store-session.ts";
import { type PublicTransferJournal } from "./public-transfer-journal.ts";
import type { Bindings } from "./runtime.ts";
import type { FeeOptions } from "./types.ts";
import type { OpenTransfer } from "./wallet.ts";
export interface PublicWalletState {
    readonly wasm: Bindings;
    readonly network: Network;
    readonly keys: KeyChain;
    readonly open: Map<string, OpenTransfer>;
    readonly pending: ReadonlyMap<string, bigint>;
    claimOwned(transactionId: string, keys: readonly string[], validUntil: bigint): void;
    releaseOwned(transactionId: string, keys: readonly string[]): void;
    assertOpen(): void;
    session(): PrivateStoreSession | undefined;
    journal(): PublicTransferJournal | undefined;
    save(): Promise<void>;
    beforeSubmit(until: bigint): Promise<void>;
    scan(client: TenraiClient): Promise<funds.Scan>;
    openCoins(client: TenraiClient, found: funds.Scan): Promise<PublicCoinView>;
    resend(client: TenraiClient): Promise<string[]>;
    closed(): boolean;
    failRestore(): void;
}
export declare function resendPublic(state: PublicWalletState, client: TenraiClient): Promise<string[]>;
export declare function publicContext(state: PublicWalletState, client: TenraiClient, fee: FeeOptions): Promise<Context>;
/** Commit the input reservations before exporting the signed bytes. */
export declare function retainPublic(state: PublicWalletState, original: OpenTransfer): Promise<void>;
export declare function submitPublic(state: PublicWalletState, client: TenraiClient, original: OpenTransfer): Promise<TransactionLifecycle>;
