import { finalityGuardBytes } from "./finality-guard-store.js";
import { FinalityGuardBusyError, FinalityGuardRuns, guardRecord, nextGuardRecord, sameGuardRecord } from "./finality-guard-runtime.js";
const TABLE = "tenrai_wallet_finality_guard_v1";
const connections = new WeakSet();
/** Supplement SQLite's physical lock for aliases of a single connection in this process. */
const activeFiles = new Map();
const busy = (error) => error instanceof Error && /SQLITE_BUSY|SQLITE_LOCKED|database (?:is )?(?:locked|busy)/i.test(error.message);
/** Takes ownership of a dedicated disk connection. No account-local or in-memory fallback exists. */
export function sqliteFinalityGuardStore(database) {
    if (connections.has(database))
        throw new Error("This SQLite connection already has a finality guard owner.");
    if (typeof database.isTransaction !== "boolean" || database.isTransaction)
        throw new Error("Finality guard SQLite requires native transaction-state reporting and an idle dedicated connection.");
    const locations = database.prepare("PRAGMA database_list").all();
    if (locations.some((row) => row["name"] !== "main" && row["name"] !== "temp"))
        throw new Error("Attached databases cannot share a finality guard connection.");
    const file = locations.find((row) => row["name"] === "main")?.["file"];
    if (typeof file !== "string" || file.length === 0)
        throw new Error("The finality guard requires a dedicated disk SQLite file.");
    const other = database.prepare("SELECT name FROM main.sqlite_master WHERE name<>? AND name NOT GLOB 'sqlite_*' LIMIT 1").get(TABLE);
    if (other)
        throw new Error("A financial journal, cache or unrelated database cannot be used as the finality guard store.");
    connections.add(database);
    let closed = false;
    const fileKey = /^[a-zA-Z]:[\\/]/.test(file) ? file.replaceAll("\\", "/").toLowerCase() : file;
    let owned;
    const forceClose = () => {
        try {
            if (!closed) {
                database.close();
                closed = true;
                connections.delete(database);
            }
        }
        finally {
            if (owned !== undefined && activeFiles.get(fileKey) === owned)
                activeFiles.delete(fileKey);
            owned = undefined;
        }
    };
    const statements = (() => {
        try {
            // Only this dedicated, schema-checked connection is configured. EXTRA+DELETE includes
            // durable rollback-journal removal; no TEMP store or financial journal is changed.
            database.exec("PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA cache_size=-1024; PRAGMA mmap_size=0;");
            database.exec(`CREATE TABLE IF NOT EXISTS main.${TABLE}(scope TEXT PRIMARY KEY NOT NULL,format INTEGER NOT NULL,revision TEXT NOT NULL,sealed BLOB NOT NULL) WITHOUT ROWID`);
            const columns = database.prepare(`PRAGMA main.table_info(${TABLE})`).all();
            if (columns.length !== 4 || columns.map((row) => row["name"]).join(",") !== "scope,format,revision,sealed"
                || Number(columns[0]?.["pk"]) !== 1 || columns.slice(1).some((row) => Number(row["pk"]) !== 0)
                || columns.some((row) => Number(row["notnull"]) !== 1)
                || columns.map((row) => String(row["type"]).toUpperCase()).join(",") !== "TEXT,INTEGER,TEXT,BLOB")
                throw new Error("The finality guard SQLite schema is damaged.");
            settings();
            normal();
            return {
                select: database.prepare(`SELECT scope,format,revision,sealed FROM main.${TABLE} WHERE scope=?`),
                put: database.prepare(`INSERT INTO main.${TABLE}(scope,format,revision,sealed) VALUES(?,1,?,?) ON CONFLICT(scope) DO UPDATE SET format=excluded.format,revision=excluded.revision,sealed=excluded.sealed`),
            };
        }
        catch (error) {
            forceClose();
            throw error;
        }
    })();
    const read = (scope) => {
        const row = statements.select.get(scope);
        return row === undefined ? null : guardRecord(row, scope);
    };
    function settings() {
        if (database.prepare("PRAGMA main.journal_mode").get()?.["journal_mode"] !== "delete"
            || Number(database.prepare("PRAGMA main.synchronous").get()?.["synchronous"]) !== 3) {
            throw new Error("Finality guard storage requires durable SQLite DELETE/EXTRA transactions.");
        }
    }
    function committed() {
        if (database.isTransaction !== false)
            throw new Error("SQLite acknowledged no completed finality guard COMMIT.");
    }
    function begin(sql) {
        committed();
        database.exec(sql);
        if (database.isTransaction !== true)
            throw new Error("SQLite acknowledged no physical finality guard transaction.");
    }
    function rollback() {
        if (database.isTransaction)
            database.exec("ROLLBACK");
        committed();
    }
    /** NORMAL alone changes policy; completing a real read ends the pager lock as well. */
    function normal() {
        rollback();
        if (database.prepare("PRAGMA main.locking_mode=NORMAL").get()?.["locking_mode"] !== "normal")
            throw new Error("SQLite did not leave the finality guard's exclusive locking mode.");
        try {
            begin("BEGIN");
            database.prepare(`SELECT scope FROM main.${TABLE} LIMIT 1`).get();
            database.exec("COMMIT");
            committed();
        }
        catch (error) {
            rollback();
            // Another process may have obtained EXCLUSIVE after ours was dropped. With NORMAL,
            // autocommit and all native .get() statements reset, this connection holds no pages.
            if (!busy(error))
                throw error;
        }
    }
    const runs = new FinalityGuardRuns(async (scope) => {
        if (closed)
            throw new Error("The finality guard SQLite connection is closed.");
        if (activeFiles.has(fileKey))
            throw new FinalityGuardBusyError();
        owned = Symbol("finality guard SQLite proof section");
        activeFiles.set(fileKey, owned);
        let entered = false;
        try {
            settings();
            if (database.prepare("PRAGMA main.locking_mode=EXCLUSIVE").get()?.["locking_mode"] !== "exclusive")
                throw new Error("SQLite cannot exclusively own the finality guard file.");
            begin("BEGIN EXCLUSIVE");
            entered = true;
            database.exec("COMMIT");
            committed();
            // EXCLUSIVE mode deliberately retains its OS file lock across every subsequent COMMIT.
        }
        catch (error) {
            try {
                normal();
            }
            catch (releaseError) {
                forceClose();
                throw releaseError;
            }
            if (owned !== undefined && activeFiles.get(fileKey) === owned)
                activeFiles.delete(fileKey);
            owned = undefined;
            if (!entered && busy(error))
                throw new FinalityGuardBusyError();
            throw error;
        }
        return {
            async read() { return read(scope); },
            async save(previous, value) {
                if (closed || owned === undefined || activeFiles.get(fileKey) !== owned)
                    throw new Error("The SQLite finality guard no longer owns its proof section.");
                const bytes = finalityGuardBytes(value), next = nextGuardRecord(scope, previous, bytes);
                begin("BEGIN IMMEDIATE");
                try {
                    if (!sameGuardRecord(read(scope), previous))
                        throw new Error("The finality guard changed outside its exclusive proof section.");
                    if (Number(statements.put.run(scope, next.revision, bytes).changes) !== 1)
                        throw new Error("SQLite did not store the finality guard generation.");
                    if (!sameGuardRecord(read(scope), next))
                        throw new Error("SQLite did not store the exact finality guard bytes.");
                    database.exec("COMMIT");
                    committed();
                    const durable = read(scope);
                    if (!sameGuardRecord(durable, next))
                        throw new Error("The committed SQLite finality guard changed.");
                    return durable;
                }
                catch (error) {
                    rollback();
                    throw error;
                }
            },
            async release() {
                try {
                    normal();
                }
                catch (error) {
                    forceClose();
                    throw error;
                }
                if (owned !== undefined && activeFiles.get(fileKey) === owned)
                    activeFiles.delete(fileKey);
                owned = undefined;
            },
        };
    }, async () => { forceClose(); });
    return runs;
}
