import type { Bindings } from "./runtime.ts";
import { type PublicCoinView } from "./public-coin-source.ts";
import type { WalletOptions } from "./types.ts";
import { type AddressProofDocument, type AddressProofRequest } from "../address.ts";
import type { TenraiClient } from "../client.ts";
import type { Network } from "../types/common.ts";
import type { StakePositionView } from "../types/staking.ts";
import * as funds from "./funds.ts";
import { type KeyChain } from "./keychain.ts";
import type { MultisigSession } from "./multisig.ts";
import type { NativeLockSession, NativeLockSpendReview, SignedNativeLockSpend } from "./native-locks.ts";
import type { Coin } from "./plan.ts";
import type { ActivityOptions, Branch, WalletActivity, WalletBalance, WalletOutput } from "./types.ts";
/** Account address discovery and signatures share the wallet's single keychain. */
export declare class WalletAddresses {
    #private;
    readonly coinOptions: Pick<WalletOptions, "publicCoinStore" | "publicCoinMaxCoins" | "publicCoinEventLimit">;
    readonly wasm: Bindings | undefined;
    readonly genesis: () => string | undefined;
    readonly heldKeys: () => ReadonlySet<string>;
    readonly network: Network;
    readonly account: number;
    constructor(keys: KeyChain, network: Network, account: number, held: (coin: Coin) => boolean, coinOptions?: Pick<WalletOptions, "publicCoinStore" | "publicCoinMaxCoins" | "publicCoinEventLimit">, wasm?: Bindings, genesis?: () => string | undefined, heldKeys?: () => ReadonlySet<string>);
    get fingerprint(): string;
    /** The highest used index of each branch found so far, to keep with the wallet; undefined before the first scan. */
    get usedAddresses(): Readonly<Record<Branch, number>> | undefined;
    /** Hands back what an earlier session found, so the next scan looks 20 past it instead of 100 from the start. */
    rememberUsed(used: Record<Branch, number>): void;
    /**
     * Hands out the receiving address after every used and handed-out one, so no earlier call returned it;
     * scans keep looking 20 past it. Needs a scan or `rememberUsed` first.
     */
    newAddress(): {
        index: number;
        address: string;
    };
    /** The receiving index `newAddress` handed out last, 0 (the main address) before; keep it with the wallet. */
    get lastIssued(): number;
    /** Hands back `lastIssued` from an earlier session, so scans keep covering the addresses handed out. */
    rememberIssued(index: number): void;
    /**
     * Checks `depth` addresses (1000 by default, at most 10000) past the last used one on both branches,
     * for coins sent to addresses far beyond it, such as by another wallet holding the same phrase.
     * Returns the highest used index of each branch.
     */
    rescan(client: TenraiClient, options?: {
        depth?: number;
        rebuildCoinCache?: boolean;
    }): Promise<Readonly<Record<Branch, number>>>;
    scan(client: TenraiClient, gap?: number): Promise<funds.Scan>;
    /** Receiving address number `index`; 0 is the wallet's first address. */
    address(index?: number, branch?: Branch): string;
    /** Public key for one derived address, suitable for a threshold descriptor. */
    multisigMemberPublicKey(index?: number, branch?: Branch): Uint8Array;
    /** Public ML-DSA key at a reserved change index for validator registration or rotation. */
    validatorConsensusPublicKey(index?: number): Uint8Array;
    /** Adds this wallet's signatures after the caller reviewed the exact package template. */
    signMultisigPackage(session: MultisigSession, packageBytes: Uint8Array, reviewedTemplate: string, index?: number, branch?: Branch): Uint8Array;
    /** Signs the exact native lock spend the caller has reviewed. No private key leaves the WASM. */
    signNativeLockSpend(session: NativeLockSession, review: NativeLockSpendReview, index?: number, branch?: Branch): Promise<SignedNativeLockSpend>;
    /** Whether the address is one of this wallet's that a scan, `address` or `newAddress` derived. */
    owns(address: string): boolean;
    /** Branch and index of one of this wallet's addresses, as for `owns`; undefined for any other. */
    pathOf(address: string): Readonly<{
        branch: Branch;
        index: number;
    }> | undefined;
    /**
     * Scans receive and change addresses and sums their finalized balances. The first scan checks 100
     * addresses past the last used one, later ones 20 past the highest used address found so far.
     */
    balance(client: TenraiClient): Promise<WalletBalance>;
    openCoins(client: TenraiClient, found?: funds.Scan, rebuild?: boolean): Promise<PublicCoinView>;
    close(): Promise<void>;
    /** The largest available outputs, at most 256. Use outputPage to traverse the complete inventory. */
    outputs(client: TenraiClient, options?: {
        limit?: number;
        address?: string;
    }): Promise<WalletOutput[]>;
    /** One bounded canonical outpoint page after reconciling the retained account cache. */
    outputPage(client: TenraiClient, query?: import("./public-coin-store.ts").PublicCoinQuery): Promise<import("./public-coin-store.ts").PublicCoinPage & {
        indexedHeight: number;
    }>;
    /** Finalized activity of every used address, newest first, one entry per transaction. */
    activity(client: TenraiClient, options?: ActivityOptions): Promise<WalletActivity[]>;
    /** Stake positions owned by the wallet's used addresses. */
    positions(client: TenraiClient): Promise<StakePositionView[]>;
    /**
     * Answers an address proof request with the key of the requested address, which must be one this
     * wallet derived, such as during a scan. Show the user the address before calling this.
     */
    proveAddress(request: AddressProofRequest | string, options?: {
        now?: number;
    }): Promise<AddressProofDocument>;
    /** The highest used index of a branch; for receive, the last handed-out one when that is higher. */
    floor(branch: Branch): number;
    /** Derives addresses up to 100 past the highest used or handed-out index of each branch, looking for `address`. */
    search(address: string): {
        branch: Branch;
        index: number;
    } | undefined;
}
