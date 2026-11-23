import type { PublicCoinDiskOptions } from "./public-coin-store.ts";
import type { FinalityGuardSqlite } from "./finality-guard-store.ts";
import type { PersistentPublicCoinStore } from "./public-coin-persistent-types.ts";
/** Hold an exclusive SQLite lease across durable page commits. */
export declare function sqlitePersistentPublicCoinStore(database: FinalityGuardSqlite, namespace: string, options: PublicCoinDiskOptions): Promise<PersistentPublicCoinStore>;
