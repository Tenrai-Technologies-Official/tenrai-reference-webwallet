import type { PublicCoinDiskOptions } from "./public-coin-store.ts";
import type { FinalityGuardSqlite } from "./finality-guard-store.ts";
import type { PersistentPublicCoinStore } from "./public-coin-persistent-types.ts";
/** A dedicated disk file. Its lifetime EXCLUSIVE pager lease survives each durable page COMMIT. */
export declare function sqlitePersistentPublicCoinStore(database: FinalityGuardSqlite, namespace: string, options: PublicCoinDiskOptions): Promise<PersistentPublicCoinStore>;
