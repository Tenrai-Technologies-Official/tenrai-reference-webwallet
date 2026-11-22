import type { PublicCoinStore, PublicCoinStoreOptions } from "./public-coin-store.ts";
export interface PublicCoinIndexedDbOptions extends PublicCoinStoreOptions {
    indexedDb?: IDBFactory;
    lockManager?: LockManager;
    keyRange?: typeof IDBKeyRange;
}
/** Creates a fresh disposable generation under a cross-tab account lease. */
export declare function indexedDbPublicCoinStore(scope: string, options?: PublicCoinIndexedDbOptions): Promise<PublicCoinStore>;
