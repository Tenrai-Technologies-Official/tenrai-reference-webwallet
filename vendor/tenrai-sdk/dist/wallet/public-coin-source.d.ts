import type { TenraiClient } from "../client.ts";
import type { Coin } from "./plan.ts";
import { type Scan } from "./funds.ts";
import { type PublicCoinStore, type PublicCoinQuery, type PublicCoinPage } from "./public-coin-store.ts";
export interface CoinSource {
    visit(take: (coin: Coin) => boolean | void): Promise<void>;
    get(key: string): Promise<Coin | null>;
    largest?(limit: number, address?: string): Promise<Coin[]>;
    available?(): Promise<bigint>;
}
export interface PublicCoinFactory {
    (): Promise<PublicCoinStore>;
}
/** A scoped read/selection lease; releasing it leaves the owner's reconstructible cache intact. */
export type PublicCoinView = Pick<PublicCoinInventory, "finalizedHeight" | "addresses" | "get" | "visit" | "largest" | "consolidation" | "page"> & {
    available(): Promise<bigint>;
    close(): Promise<void>;
};
/** One complete advisory generation, updated under its owner's operation lease. */
export declare class PublicCoinInventory implements CoinSource {
    #private;
    readonly store: PublicCoinStore;
    readonly held: (coin: Coin) => boolean;
    readonly addresses: {
        address: string;
        utxos: number;
    }[];
    readonly cancelled: () => boolean;
    constructor(store: PublicCoinStore, held: (coin: Coin) => boolean, addresses?: {
        address: string;
        utxos: number;
    }[], cancelled?: () => boolean);
    get finalizedHeight(): number;
    static open(client: TenraiClient, found: Scan, factory: PublicCoinFactory, held: (coin: Coin) => boolean, eventLimit: number, cancelled?: () => boolean): Promise<PublicCoinInventory>;
    /** Reconcile retained holdings through finite history; only newly discovered addresses need a base walk. */
    refresh(client: TenraiClient, found: Scan, eventLimit: number): Promise<void>;
    close(): Promise<void>;
    get(key: string): Promise<Coin | null>;
    visit(take: (coin: Coin) => boolean | void): Promise<void>;
    largest(limit: number, address?: string): Promise<Coin[]>;
    consolidation(above?: number): Promise<Coin[]>;
    page(query?: PublicCoinQuery): Promise<PublicCoinPage>;
}
export declare function checkedCoinTotal(total: bigint, amount: bigint): bigint;
