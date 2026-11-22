import { type FinalityGuardSqlite, type FinalityGuardStore } from "./finality-guard-store.ts";
/** Takes ownership of a dedicated disk connection. No account-local or in-memory fallback exists. */
export declare function sqliteFinalityGuardStore(database: FinalityGuardSqlite): FinalityGuardStore;
