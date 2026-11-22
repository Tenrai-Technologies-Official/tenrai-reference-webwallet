import type { TenraiClient } from "../client.ts";
import type { AddressEvent } from "../types/address.ts";
import type { StakePositionView } from "../types/staking.ts";
import type { TransactionLifecycle } from "../types/transaction.ts";
import type { Coin } from "./plan.ts";
import type { Branch, WalletActivity } from "./types.ts";
/** Unused addresses checked past the last used one. */
export declare const GAP_LIMIT = 20;
/** A wallet scanned for the first time looks further, as a restored one may have gaps. */
export declare const RESTORE_GAP_LIMIT = 100;
export declare const RESCAN_DEPTH = 1000;
export declare const MAX_RESCAN_DEPTH = 10000;
export interface Scan {
    /** The highest used index of each branch, -1 when none is used. */
    used: Record<Branch, number>;
    held: {
        address: string;
        branch: Branch;
        index: number;
        atoms: bigint;
        utxos: number;
    }[];
    /** Every address with finalized history, spent-out change included. */
    active: string[];
    indexedHeight: number;
    /** Every scanned address and its actually observed balance head, including empty addresses. */
    observed: {
        address: string;
        height: number;
    }[];
}
export declare function outpoint(coin: Coin): string;
export interface ScanOptions {
    /** The highest used index of each branch an earlier scan found; the walk goes at least `gap` past it. */
    known?: Record<Branch, number>;
    /** Unused addresses checked past the last used one, 20 by default. */
    gap?: number;
}
/** Walks each branch until `gap` unused addresses follow the last used one. */
export declare function scan(client: TenraiClient, addressAt: (index: number, branch: Branch) => string, options?: ScanOptions): Promise<Scan>;
/** Addresses whose key the chain already knows can sign without carrying the 1952-byte public key. */
export declare function registered(client: TenraiClient, addresses: string[]): Promise<Set<string>>;
/** The newest requested transactions globally; only four pages are in flight at once. */
export declare function history(client: TenraiClient, addresses: readonly string[], most: number): Promise<AddressEvent[]>;
/**
 * One entry per transaction, grouped like the Rust wallet's `activity`: a receipt under the paying
 * transaction, a spend under its spender, a spend without a known spender under the output alone.
 */
export declare function activity(events: readonly AddressEvent[]): WalletActivity[];
export declare function positions(client: TenraiClient, owners: string[]): Promise<StakePositionView[]>;
/** Retains ambiguous submissions: a later refusal or 404 cannot disprove an earlier executable copy. */
export declare function submit(client: TenraiClient, prepared: {
    transactionId: string;
    wireHex: string;
}, options?: {
    signal?: AbortSignal;
    uncertain?: () => Promise<void>;
}): Promise<TransactionLifecycle>;
