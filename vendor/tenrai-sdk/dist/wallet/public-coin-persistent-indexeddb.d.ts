import type { PublicCoinIndexedDbOptions } from "./public-coin-indexeddb.ts";
import type { PersistentPublicCoinStore } from "./public-coin-persistent-types.ts";
/** Stable per-root/chain/genesis/account generation; close never discards a completed page. */
export declare function indexedDbPersistentPublicCoinStore(namespace: string, options?: PublicCoinIndexedDbOptions): Promise<PersistentPublicCoinStore>;
