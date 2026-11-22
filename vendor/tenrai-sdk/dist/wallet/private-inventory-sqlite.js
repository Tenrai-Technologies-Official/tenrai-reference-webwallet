const OBJECTS = "tenrai_private_inventory_objects_v1";
const MARKS = "tenrai_private_inventory_marks_v1";
const STATS = "tenrai_private_inventory_stats_v1";
const META = "tenrai_private_inventory_meta_v1";
const HEX = /^[0-9a-f]{96}$/;
const MAX_BYTES = 16_384 + 40;
const yieldTurn = () => new Promise((resolve) => setTimeout(resolve, 0));
function identity(id) { if (!HEX.test(id))
    throw new Error("Invalid private inventory identity."); }
function root(entry) {
    identity(entry.id);
    identity(entry.generation);
    if (!Number.isInteger(entry.tree) || entry.tree < 1 || entry.tree > 4)
        throw new Error("Invalid private inventory tree.");
}
function binding(row, entry) {
    if (row.tree !== entry.tree || row.generation !== entry.generation)
        throw new Error("Conflicting private inventory bindings.");
}
function bytes(value) {
    if (!(value instanceof Uint8Array) || value.byteLength < 40 || value.byteLength > MAX_BYTES) {
        throw new Error("Encrypted private inventory data is damaged.");
    }
    return value;
}
/** Ciphertext objects on an application-owned dedicated disk connection; imports no native module. */
export function sqlitePrivateInventoryStore(database, namespace) {
    if (!/^[a-zA-Z0-9:_-]{1,512}$/.test(namespace))
        throw new Error("Invalid private inventory namespace.");
    const file = database.prepare("PRAGMA database_list").get()?.file;
    if (typeof file !== "string" || !file)
        throw new Error("Private inventory requires a disk database.");
    database.exec("PRAGMA auto_vacuum=INCREMENTAL;PRAGMA journal_mode=DELETE;PRAGMA synchronous=EXTRA;PRAGMA cache_size=-4096;PRAGMA mmap_size=0");
    if (Number(database.prepare("PRAGMA auto_vacuum").get()?.auto_vacuum) !== 2 ||
        Number(database.prepare("PRAGMA synchronous").get()?.synchronous) !== 3 ||
        database.prepare("PRAGMA journal_mode").get()?.journal_mode !== "delete") {
        throw new Error("Use a dedicated incremental-vacuum disk database with durable transactions.");
    }
    database.exec("CREATE TABLE IF NOT EXISTS " + OBJECTS +
        "(namespace TEXT NOT NULL,id TEXT NOT NULL,sealed BLOB NOT NULL CHECK(length(sealed) BETWEEN 40 AND 16424),PRIMARY KEY(namespace,id)) WITHOUT ROWID;" +
        "CREATE TABLE IF NOT EXISTS " + MARKS +
        "(namespace TEXT NOT NULL,id TEXT NOT NULL,tree INTEGER NOT NULL,generation TEXT NOT NULL,token TEXT NOT NULL,visited INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(namespace,id)) WITHOUT ROWID;" +
        "CREATE INDEX IF NOT EXISTS " + MARKS + "_pending ON " + MARKS + "(namespace,token,visited,id);" +
        "CREATE TABLE IF NOT EXISTS " + META +
        "(namespace TEXT PRIMARY KEY,token TEXT NOT NULL,roots TEXT NOT NULL,phase TEXT NOT NULL,after_id TEXT NOT NULL) WITHOUT ROWID;" +
        "CREATE TABLE IF NOT EXISTS " + STATS +
        "(namespace TEXT PRIMARY KEY,objects INTEGER NOT NULL CHECK(objects>=0),sealed_bytes INTEGER NOT NULL CHECK(sealed_bytes>=0)) WITHOUT ROWID");
    let closed = false;
    const get = (sql, ...parameters) => database.prepare(sql).get(...parameters);
    const run = (sql, ...parameters) => database.prepare(sql).run(...parameters);
    function open() { if (closed)
        throw new Error("The private inventory store is closed."); }
    function transaction(work) {
        open();
        database.exec("BEGIN IMMEDIATE");
        try {
            const result = work();
            database.exec("COMMIT");
            return result;
        }
        catch (error) {
            try {
                database.exec("ROLLBACK");
            }
            catch { /* Preserve the failure. */ }
            throw error;
        }
    }
    function meta(token) {
        const value = get("SELECT token,roots,phase,after_id FROM " + META + " WHERE namespace=?", namespace);
        if (!value || (token !== undefined && value.token !== token))
            throw new Error("Private inventory collection roots changed.");
        return value;
    }
    function mark(entry, token) {
        const old = get("SELECT tree,generation,token FROM " + MARKS + " WHERE namespace=? AND id=?", namespace, entry.id);
        if (old)
            binding(old, entry);
        if (old?.token === token)
            return;
        run("INSERT OR REPLACE INTO " + MARKS + " VALUES(?,?,?,?,?,0)", namespace, entry.id, entry.tree, entry.generation, token);
    }
    run("INSERT OR IGNORE INTO " + STATS + " VALUES(?,0,0)", namespace);
    return {
        async read(id) {
            open();
            identity(id);
            const row = get("SELECT length(sealed) AS bytes FROM " + OBJECTS + " WHERE namespace=? AND id=?", namespace, id);
            if (!row)
                return null;
            if (typeof row.bytes !== "number" || row.bytes < 40 || row.bytes > MAX_BYTES)
                throw new Error("Encrypted private inventory data is damaged.");
            return bytes(get("SELECT sealed FROM " + OBJECTS + " WHERE namespace=? AND id=?", namespace, id)?.sealed);
        },
        async write(id, sealed) {
            identity(id);
            bytes(sealed);
            transaction(() => {
                if (get("SELECT token FROM " + META + " WHERE namespace=?", namespace))
                    throw new Error("Finish inventory collection before writing another generation.");
                const old = get("SELECT length(sealed) AS bytes,sealed=? AS same FROM " + OBJECTS + " WHERE namespace=? AND id=?", sealed, namespace, id);
                if (old) {
                    if (old.same !== 1)
                        throw new Error("An immutable private inventory object was replaced.");
                    return;
                }
                run("INSERT INTO " + OBJECTS + " VALUES(?,?,?)", namespace, id, sealed);
                run("UPDATE " + STATS + " SET objects=objects+1,sealed_bytes=sealed_bytes+? WHERE namespace=?", sealed.byteLength, namespace);
            });
        },
        async usage() {
            open();
            const row = get("SELECT objects,sealed_bytes FROM " + STATS + " WHERE namespace=?", namespace);
            const objects = Number(row?.objects);
            const sealedBytes = Number(row?.sealed_bytes);
            if (!Number.isSafeInteger(objects) || !Number.isSafeInteger(sealedBytes) || objects < 0 || sealedBytes < 0) {
                throw new Error("Private inventory accounting is damaged.");
            }
            return { objects: String(objects), sealedBytes: String(sealedBytes),
                collecting: get("SELECT token FROM " + META + " WHERE namespace=?", namespace) !== undefined };
        },
        async beginCollection(token, roots) {
            identity(token);
            if (roots.length > 16)
                throw new Error("Too many private inventory collection roots.");
            roots.forEach(root);
            const key = roots.map((entry) => entry.tree + ":" + entry.generation + ":" + entry.id).sort().join("|");
            transaction(() => {
                const old = get("SELECT token,roots FROM " + META + " WHERE namespace=?", namespace);
                if (old?.token === token) {
                    if (old.roots !== key)
                        throw new Error("Private inventory collection roots changed.");
                    return;
                }
                for (const entry of roots) {
                    const oldMark = get("SELECT tree,generation FROM " + MARKS + " WHERE namespace=? AND id=?", namespace, entry.id);
                    if (oldMark)
                        binding(oldMark, entry);
                    run("INSERT OR REPLACE INTO " + MARKS + " VALUES(?,?,?,?,?,0)", namespace, entry.id, entry.tree, entry.generation, token);
                }
                run("INSERT OR REPLACE INTO " + META + " VALUES(?,?,?,'objects','')", namespace, token, key);
            });
        },
        async pendingCollection() {
            open();
            const current = get("SELECT token FROM " + META + " WHERE namespace=?", namespace);
            if (!current)
                return [];
            const result = [];
            let after = "";
            for (let index = 0; index < 64; index++) {
                const row = get("SELECT tree,generation,id FROM " + MARKS + " WHERE namespace=? AND token=? AND visited=0 AND id>? ORDER BY id LIMIT 1", namespace, String(current.token), after);
                if (!row)
                    break;
                const entry = { tree: row.tree, generation: row.generation, id: row.id };
                root(entry);
                result.push(entry);
                after = entry.id;
            }
            return result;
        },
        async markCollection(entry, children) {
            root(entry);
            if (children.length > 32)
                throw new Error("Invalid private inventory edges.");
            children.forEach(identity);
            transaction(() => {
                const current = meta();
                if (current.phase !== "objects")
                    throw new Error("Private inventory collection is not marking objects.");
                const parent = get("SELECT tree,generation,token,visited FROM " + MARKS + " WHERE namespace=? AND id=?", namespace, entry.id);
                if (!parent || parent.token !== current.token || parent.visited !== 0)
                    throw new Error("Private inventory collection is out of order.");
                binding(parent, entry);
                for (const id of children)
                    mark({ ...entry, id }, String(current.token));
                run("UPDATE " + MARKS + " SET visited=1 WHERE namespace=? AND id=?", namespace, entry.id);
            });
        },
        async sweepCollection(token) {
            identity(token);
            const complete = transaction(() => {
                const current = meta(token);
                if (get("SELECT id FROM " + MARKS + " WHERE namespace=? AND token=? AND visited=0 LIMIT 1", namespace, token)) {
                    throw new Error("Private inventory collection has unverified branches.");
                }
                if (current.phase === "vacuum")
                    return true;
                if (current.phase !== "objects" && current.phase !== "marks")
                    throw new Error("Invalid private inventory collection phase.");
                const table = current.phase === "objects" ? OBJECTS : MARKS;
                let after = String(current.after_id);
                for (let index = 0; index < 256; index++) {
                    const row = get("SELECT id FROM " + table + " WHERE namespace=? AND id>? ORDER BY id LIMIT 1", namespace, after);
                    if (!row) {
                        if (current.phase === "objects") {
                            run("UPDATE " + META + " SET phase='marks',after_id='' WHERE namespace=?", namespace);
                            return false;
                        }
                        run("UPDATE " + META + " SET phase='vacuum',after_id='' WHERE namespace=?", namespace);
                        return false;
                    }
                    const id = String(row.id);
                    identity(id);
                    after = id;
                    if (!get("SELECT id FROM " + MARKS + " WHERE namespace=? AND id=? AND token=?", namespace, id, token)) {
                        if (current.phase === "objects") {
                            const size = Number(get("SELECT length(sealed) AS bytes FROM " + OBJECTS + " WHERE namespace=? AND id=?", namespace, id)?.bytes);
                            if (!Number.isSafeInteger(size) || size < 40 || size > MAX_BYTES)
                                throw new Error("Private inventory object is damaged.");
                            run("UPDATE " + STATS + " SET objects=objects-1,sealed_bytes=sealed_bytes-? WHERE namespace=?", size, namespace);
                        }
                        run("DELETE FROM " + table + " WHERE namespace=? AND id=?", namespace, id);
                    }
                }
                run("UPDATE " + META + " SET after_id=? WHERE namespace=?", after, namespace);
                return false;
            });
            database.exec("PRAGMA incremental_vacuum(256)");
            if (complete) {
                const free = Number(get("PRAGMA freelist_count")?.freelist_count);
                if (!Number.isSafeInteger(free) || free < 0)
                    throw new Error("Private inventory free-page accounting is damaged.");
                if (free === 0) {
                    transaction(() => { meta(token); run("DELETE FROM " + META + " WHERE namespace=?", namespace); });
                    return true;
                }
            }
            await yieldTurn();
            return false;
        },
        close() { closed = true; },
    };
}
