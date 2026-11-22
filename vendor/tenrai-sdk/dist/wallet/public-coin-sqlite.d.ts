import type { PublicCoinSqlite, PublicCoinStore, PublicCoinDiskOptions } from "./public-coin-store.ts";
/** Holds a dedicated cache-only SQLite write lease; its rows never become financial journal state. */
export declare function sqlitePublicCoinStore(database: PublicCoinSqlite, scope: string, options: PublicCoinDiskOptions): Promise<PublicCoinStore>;
