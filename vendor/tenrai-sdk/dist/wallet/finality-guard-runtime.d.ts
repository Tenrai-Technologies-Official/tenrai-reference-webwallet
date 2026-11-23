import { type FinalityGuardStore } from "./finality-guard-store.ts";
export declare const FINALITY_GUARD_DATABASE = "tenrai-wallet-finality-v1";
export declare const FINALITY_GUARD_TABLE = "guards";
export declare const finalityGuardLock: (scope: string) => string;
export interface GuardRecord {
    format: 1;
    scope: string;
    revision: string;
    sealed: Uint8Array;
}
export interface GuardLease {
    read(): Promise<GuardRecord | null>;
    save(previous: GuardRecord | null, bytes: Uint8Array): Promise<GuardRecord>;
    release(): Promise<void>;
}
export declare class FinalityGuardBusyError extends Error {
    constructor();
}
export declare function sameGuardBytes(a: Uint8Array, b: Uint8Array): boolean;
export declare function guardRecord(value: unknown, scope: string): GuardRecord;
export declare function sameGuardRecord(a: GuardRecord | null, b: GuardRecord | null): boolean;
export declare function nextGuardRecord(scope: string, previous: GuardRecord | null, bytes: Uint8Array): GuardRecord;
/** Bound local scheduling. The backend lease coordinates instances. */
export declare class FinalityGuardRuns implements FinalityGuardStore {
    #private;
    constructor(begin: (scope: string) => Promise<GuardLease>, cleanup: () => Promise<void>);
    fail(error: unknown): void;
    run<T>(scope: string, work: (sealed: Uint8Array | null, saveExact: (bytes: Uint8Array) => Promise<void>) => Promise<T>): Promise<T>;
    close(): Promise<void>;
}
/** Hold the Web Lock until verification and persistence finish. */
export declare function finalityBrowserLease(scope: string, manager: LockManager): Promise<{
    release(): Promise<void>;
}>;
