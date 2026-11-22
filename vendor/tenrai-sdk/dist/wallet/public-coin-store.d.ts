/** Disposable, generation-scoped public holdings. Absence is useful only after a complete live scan. */
export interface PublicCoin {
    address: string;
    transactionId: string;
    outputIndex: number;
    amount: bigint;
    height: number;
}
/** Lowercase TXID96 followed by the eight lowercase hex digits of its output index. */
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
    /** Amount descending, then canonical outpoint key ascending; no global RAM sort. */
    largestPage(query?: PublicLargestCoinQuery): Promise<PublicLargestCoinPage>;
    /** Refuses new work, drains started transactions, then deletes/rolls back this cache and releases its lease. */
    close(): Promise<void>;
}
/** A finite disposable cache; reaching the cap refuses completion and requires a new scan. */
export interface PublicCoinStoreOptions {
    maxCoins?: number;
}
/** Disk callers choose this finite cap for their dedicated volume and monitored headroom. */
export interface PublicCoinDiskOptions {
    maxCoins: number;
}
export type PublicCoinSqliteValue = string | number;
export interface PublicCoinSqliteStatement {
    run(...parameters: PublicCoinSqliteValue[]): unknown;
    get(...parameters: PublicCoinSqliteValue[]): Record<string, unknown> | undefined;
    all(...parameters: PublicCoinSqliteValue[]): Record<string, unknown>[];
}
/** Application-owned, dedicated disk cache connection. Financial journal tables are refused. */
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
/** Serializes bounded physical requests. Close cannot release ownership while an ACK is pending. */
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
