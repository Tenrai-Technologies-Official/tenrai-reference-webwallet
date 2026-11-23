/** Finality scope is bound to the full wallet root and shared across accounts. */
export interface FinalityGuardStore {
    /** Acquire the backend lease for verification and persistence. */
    run<T>(scope: string, work: (sealed: Uint8Array | null, saveExact: (bytes: Uint8Array) => Promise<void>) => Promise<T>): Promise<T>;
    /** Drain physical writes and release their leases on close. */
    close(): void | Promise<void>;
}
/** Dedicated SQLite connection owned by the provider. */
export interface FinalityGuardSqlite {
    /** Use SQLite's autocommit state to confirm that COMMIT completed. */
    readonly isTransaction: boolean;
    exec(sql: string): unknown;
    prepare(sql: string): {
        get(...parameters: (string | number | null | Uint8Array)[]): Record<string, unknown> | undefined;
        all(...parameters: (string | number | null | Uint8Array)[]): Record<string, unknown>[];
        run(...parameters: (string | number | null | Uint8Array)[]): {
            changes: number | bigint;
        };
    };
    close(): void;
}
export interface FinalityGuardIndexedDbOptions {
    indexedDb?: IDBFactory;
    lockManager?: LockManager;
}
export declare const MAX_FINALITY_GUARD_SEALED_BYTES = 65536;
/** The native root authenticates the wallet, chain and genesis binding. */
export declare function finalityGuardScope(value: unknown): string;
/** Copy Node Buffers too. Buffer.slice() aliases caller-owned memory. */
export declare function finalityGuardBytes(value: unknown): Uint8Array;
