import type { PublicCoinIndexedDbOptions } from "./public-coin-indexeddb.ts";
import type { PersistentPublicCoinStore } from "./public-coin-persistent-types.ts";
/** Retain completed pages under the scoped generation when closing. */
export declare function indexedDbPersistentPublicCoinStore(namespace: string, options?: PublicCoinIndexedDbOptions): Promise<PersistentPublicCoinStore>;
