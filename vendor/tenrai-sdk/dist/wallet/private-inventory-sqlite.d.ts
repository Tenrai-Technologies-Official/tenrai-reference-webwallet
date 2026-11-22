import type { PrivateScanSqlite } from "./private-local-sqlite.ts";
import type { PrivateInventoryStore } from "./private-inventory-store.ts";
/** Ciphertext objects on an application-owned dedicated disk connection; imports no native module. */
export declare function sqlitePrivateInventoryStore(database: PrivateScanSqlite, namespace: string): PrivateInventoryStore;
