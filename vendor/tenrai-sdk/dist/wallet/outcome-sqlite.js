import { outcomeBytes, outcomeIdentity, outcomeLimit } from "./outcome-store.js";
/** Application-owned dedicated disk SQLite connection. Reads and pages remain bounded. */
export function sqliteOutcomeStore(database, namespace) {
    if (!/^[a-zA-Z0-9:_-]{1,512}$/.test(namespace))
        throw new Error("Invalid outcome-store namespace.");
    const file = database.prepare("PRAGMA database_list").get()?.file;
    if (typeof file !== "string" || !file)
        throw new Error("Retained outcomes require a disk database.");
    database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA cache_size=-4096");
    if (database.prepare("PRAGMA journal_mode").get()?.journal_mode !== "delete" || Number(database.prepare("PRAGMA synchronous").get()?.synchronous) !== 3)
        throw new Error("Outcomes require durable SQLite transactions.");
    database.exec("CREATE TABLE IF NOT EXISTS tenrai_outcomes_v1(namespace TEXT NOT NULL,kind TEXT NOT NULL,digest TEXT NOT NULL,sealed BLOB NOT NULL,PRIMARY KEY(namespace,kind,digest)) WITHOUT ROWID");
    const get = database.prepare("SELECT sealed FROM tenrai_outcomes_v1 WHERE namespace=? AND kind=? AND digest=?");
    const put = database.prepare("INSERT INTO tenrai_outcomes_v1 VALUES(?,?,?,?)");
    const page = database.prepare("SELECT digest FROM tenrai_outcomes_v1 WHERE namespace=? AND kind=? AND digest>? ORDER BY digest LIMIT ?");
    let closed = false;
    const open = () => { if (closed)
        throw new Error("The outcome store is closed."); };
    return {
        async read(kind, digest) { open(); outcomeIdentity(kind, digest); const row = get.get(namespace, kind, digest); return row === undefined ? null : outcomeBytes(row.sealed); },
        async write(kind, digest, sealed) {
            open();
            outcomeIdentity(kind, digest);
            outcomeBytes(sealed);
            database.exec("BEGIN IMMEDIATE");
            try {
                const old = get.get(namespace, kind, digest);
                if (old !== undefined) {
                    const bytes = outcomeBytes(old.sealed);
                    if (bytes.byteLength !== sealed.byteLength || bytes.some((byte, index) => byte !== sealed[index]))
                        throw new Error("An immutable retained outcome was replaced.");
                }
                else
                    put.run(namespace, kind, digest, sealed);
                database.exec("COMMIT");
            }
            catch (error) {
                try {
                    database.exec("ROLLBACK");
                }
                catch { /* Preserve the original failure. */ }
                throw error;
            }
        },
        async page(kind, after, limit = 128) {
            open();
            outcomeLimit(limit);
            outcomeIdentity(kind, after ?? "0".repeat(96));
            const rows = page.all(namespace, kind, after ?? "", limit + 1);
            const ids = rows.slice(0, limit).map((row) => { if (typeof row.digest !== "string")
                throw new Error("Invalid outcome identity."); outcomeIdentity(kind, row.digest); return row.digest; });
            return { ids, next: rows.length > limit ? ids[ids.length - 1] : null };
        },
        close() { closed = true; },
    };
}
