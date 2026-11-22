import { type FinalityGuardIndexedDbOptions, type FinalityGuardStore } from "./finality-guard-store.ts";
/** Persistent default for browsers. The scope/lock/database are global across this origin's accounts. */
export declare function indexedDbFinalityGuardStore(options?: FinalityGuardIndexedDbOptions): FinalityGuardStore;
