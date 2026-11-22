/** Scope is returned by the full wallet root's finalityScope; it never contains an HD account. */
export interface FinalityGuardStore {
    /** Owns a short global proof/persistence section across instances and processes/tabs. */
    run<T>(scope: string, work: (sealed: Uint8Array | null, saveExact: (bytes: Uint8Array) => Promise<void>) => Promise<T>): Promise<T>;
    /** Stops new runs and waits for physical writes and their leases before releasing resources. */
    close(): void | Promise<void>;
}
/** A dedicated disk connection transferred to the provider; close() owns its final close. */
export interface FinalityGuardSqlite {
    /** Native sqlite3_get_autocommit state; needed to reject a missing/no-op COMMIT. */
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
/** The scope is opaque here; only the native root authenticates its wallet/chain/genesis binding. */
export declare function finalityGuardScope(value: unknown): string;
/** Copy even Node Buffers; Buffer.slice() would retain a caller-owned mutable alias. */
export declare function finalityGuardBytes(value: unknown): Uint8Array;
