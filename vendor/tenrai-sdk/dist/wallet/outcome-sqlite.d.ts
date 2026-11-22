import { type OutcomeStore } from "./outcome-store.ts";
import type { PrivateScanSqlite } from "./private-local-sqlite.ts";
interface OutcomeSqlite extends PrivateScanSqlite {
    prepare(sql: string): ReturnType<PrivateScanSqlite["prepare"]> & {
        all(...parameters: (string | number | null | Uint8Array)[]): Record<string, unknown>[];
    };
}
/** Application-owned dedicated disk SQLite connection. Reads and pages remain bounded. */
export declare function sqliteOutcomeStore(database: OutcomeSqlite, namespace: string): OutcomeStore;
export {};
