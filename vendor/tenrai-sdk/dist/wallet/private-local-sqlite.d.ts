import type { PrivateLocalScanStore } from "./private-local-store.ts";
/** A dedicated disk SQLite connection; BLOB parameters and results use Uint8Array. */
export interface PrivateScanSqlite {
    exec(sql: string): unknown;
    prepare(sql: string): {
        get(...parameters: (string | number | null | Uint8Array)[]): Record<string, unknown> | undefined;
        run(...parameters: (string | number | null | Uint8Array)[]): {
            changes: number | bigint;
        };
    };
}
/** Wraps an application-provided SQLite connection; it imports no native database package. */
export declare function sqlitePrivateLocalScanStore(database: PrivateScanSqlite, namespace: string): PrivateLocalScanStore;
