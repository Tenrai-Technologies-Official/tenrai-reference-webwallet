/** Generation-scoped public coin cache. Trust absence only after a complete scan. */
export interface PublicCoin {
    address: string;
    transactionId: string;
    outputIndex: number;
    amount: bigint;
    height: number;
}
/** Lowercase 96-digit transaction ID followed by the eight hex digits of the output index. */
export type PublicCoinCursor = string;
export interface PublicAmountCursor {
    amount: bigint;
    key: PublicCoinCursor;
}
export interface PublicCoinPage {
    coins: PublicCoin[];
    nextAfter: PublicCoinCursor | null;
}
export interface PublicLargestCoinPage {
    coins: PublicCoin[];
    nextAfter: PublicAmountCursor | null;
}
export interface PublicCoinQuery {
    after?: PublicCoinCursor;
    limit?: number;
    address?: string;
}
export interface PublicLargestCoinQuery {
    after?: PublicAmountCursor;
    limit?: number;
    address?: string;
}
export interface PublicCoinStore {
    clearAddress(address: string): Promise<void>;
    putPage(rows: readonly PublicCoin[]): Promise<void>;
    removePage(keys: readonly PublicCoinCursor[]): Promise<void>;
    get(key: PublicCoinCursor): Promise<PublicCoin | null>;
    page(query?: PublicCoinQuery): Promise<PublicCoinPage>;
    /** Amount descending, then canonical outpoint ascending. */
    largestPage(query?: PublicLargestCoinQuery): Promise<PublicLargestCoinPage>;
    /** Drain started transactions before dropping this cache and releasing the lease. */
    close(): Promise<void>;
}
/** The row cap blocks scan completion until the cache is rebuilt. */
export interface PublicCoinStoreOptions {
    maxCoins?: number;
}
/** Dedicated disk cache capacity. */
export interface PublicCoinDiskOptions {
    maxCoins: number;
}
export type PublicCoinSqliteValue = string | number;
export interface PublicCoinSqliteStatement {
    run(...parameters: PublicCoinSqliteValue[]): unknown;
    get(...parameters: PublicCoinSqliteValue[]): Record<string, unknown> | undefined;
    all(...parameters: PublicCoinSqliteValue[]): Record<string, unknown>[];
}
/** SQLite connection owned by the cache. Use a dedicated file. */
export interface PublicCoinSqlite {
    exec(sql: string): unknown;
    prepare(sql: string): PublicCoinSqliteStatement;
    close(): void;
}
export declare const PUBLIC_COIN_PAGE = 256;
export declare const PUBLIC_COIN_U128_MAX: bigint;
export declare function publicCoinScope(value: string): string;
export declare function publicCoinAddress(value: string): string;
export declare function publicCoinKey(value: PublicCoinCursor): PublicCoinCursor;
export declare function publicCoinAmount(value: bigint): bigint;
export declare function publicCoin(row: PublicCoin): PublicCoin;
export declare function publicCoinCursor(row: PublicCoin): PublicCoinCursor;
export declare function publicCoinInverseAmount(amount: bigint): string;
export declare function publicCoinRows(rows: readonly PublicCoin[]): PublicCoin[];
export declare function publicCoinKeys(keys: readonly PublicCoinCursor[]): PublicCoinCursor[];
export declare function publicCoinQuery(query?: PublicCoinQuery): Required<Pick<PublicCoinQuery, "limit">> & Omit<PublicCoinQuery, "limit">;
export declare function publicLargestCoinQuery(query?: PublicLargestCoinQuery): PublicLargestCoinQuery & {
    limit: number;
};
export declare function samePublicCoin(left: PublicCoin, right: PublicCoin): boolean;
/** Serialize requests and hold ownership until outstanding writes settle. */
export declare class PublicCoinOperations {
    #private;
    constructor(cleanup: () => Promise<void>);
    assertOpen(): void;
    snapshot<T>(read: () => T): T;
    fail(error: unknown): void;
    run<T>(work: () => Promise<T> | T): Promise<T>;
    close(): Promise<void>;
}
export declare function publicCoinGeneration(): string;
export declare function publicCoinBudget(options?: PublicCoinStoreOptions): number;
export declare function publicCoinCapacity(count: number, maximum: number): void;
