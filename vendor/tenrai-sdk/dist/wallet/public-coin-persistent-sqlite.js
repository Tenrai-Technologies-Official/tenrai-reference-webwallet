import { publicCoinBudget, publicCoinInverseAmount } from "./public-coin-store.js";
import { PersistentCoins } from "./public-coin-persistent-client.js";
import { sameBytes, scope } from "./public-coin-persistent-core.js";
const COINS = "coin_persistent_rows_v1", META = "coin_persistent_meta_v1", NODES = "coin_persistent_nodes_v1";
const OWNED = new WeakSet();
const OWNED_FILES = new Set();
/** A dedicated disk file. Its lifetime EXCLUSIVE pager lease survives each durable page COMMIT. */
export async function sqlitePersistentPublicCoinStore(database, namespace, options) {
    scope(namespace);
    if (!options || options.maxCoins === undefined)
        throw new Error("Choose an explicit persistent public coin disk row budget and monitor volume headroom.");
    publicCoinBudget(options);
    if (OWNED.has(database) || typeof database.isTransaction !== "boolean" || database.isTransaction)
        throw new Error("The persistent coin provider needs an idle dedicated native SQLite connection.");
    const locations = database.prepare("PRAGMA database_list").all();
    if (locations.some((row) => row["name"] !== "main" && row["name"] !== "temp"))
        throw new Error("Attached SQLite files cannot share the public coin provider.");
    const file = locations.find((row) => row["name"] === "main")?.["file"];
    if (typeof file !== "string" || !file.length)
        throw new Error("Persistent public coins require a dedicated disk SQLite file.");
    const fileKey = /^[a-zA-Z]:[\\/]/.test(file) ? file.replaceAll("\\", "/").toLowerCase() : file;
    if (OWNED_FILES.has(fileKey))
        throw new Error("The persistent public coin file is already owned in this process.");
    const names = [COINS, META, NODES, "coin_persistent_bucket", "coin_persistent_address", "coin_persistent_amount", "coin_persistent_address_amount"];
    if (database.prepare(`SELECT name FROM main.sqlite_master WHERE name NOT IN (${names.map(() => "?").join(",")}) AND name NOT GLOB 'sqlite_*' LIMIT 1`).get(...names))
        throw new Error("A financial journal or unrelated file cannot be used as a public coin cache.");
    OWNED.add(database);
    OWNED_FILES.add(fileKey);
    let closed = false;
    function committed() {
        if (database.isTransaction !== false)
            throw new Error("No physical public coin COMMIT was acknowledged.");
    }
    function begin(write) {
        committed();
        database.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
        if (database.isTransaction !== true)
            throw new Error("No physical public coin transaction was opened.");
    }
    function rollback() {
        if (database.isTransaction)
            database.exec("ROLLBACK");
        committed();
    }
    function close() {
        if (!closed) {
            database.close();
            closed = true;
            OWNED.delete(database);
            OWNED_FILES.delete(fileKey);
        }
    }
    function all(sql, values = []) {
        return database.prepare(sql).all(...values);
    }
    function get(sql, values = []) {
        return database.prepare(sql).get(...values);
    }
    function run(sql, values = []) {
        database.prepare(sql).run(...values);
    }
    function payload(row) {
        const text = row["payload"];
        if (typeof text !== "string" || text.length > 2048)
            throw new Error("Malformed persistent public coin payload.");
        const value = JSON.parse(text);
        if (!value || value.scope !== row["scope"] || value.generation !== row["generation"] || value.key !== row["coin_key"] || value.bucket !== row["bucket"] || value.address !== row["address"] || value.inverseAmount !== row["inverse_amount"])
            throw new Error("Persistent public coin SQLite indexes changed.");
        return value;
    }
    const select = `SELECT scope,generation,coin_key,bucket,address,inverse_amount,payload FROM ${COINS}`;
    function perform(request) {
        const generation = request.generation;
        switch (request.kind) {
            case "metaGet": return get(`SELECT scope,generation,sealed FROM ${META} WHERE scope=?`, [namespace]) ?? null;
            case "metaPut": {
                const row = request.row;
                if (row.scope !== namespace)
                    throw new Error("Wrong public coin metadata scope.");
                run(`INSERT INTO ${META}(scope,generation,sealed) VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET generation=excluded.generation,sealed=excluded.sealed`, [namespace, row.generation, row.sealed]);
                return null;
            }
            case "coinGet": {
                const row = get(select + " WHERE scope=? AND generation=? AND coin_key=?", [namespace, generation, request.key]);
                return row ? payload(row) : null;
            }
            case "coinPut": {
                const row = request.row;
                if (row.scope !== namespace)
                    throw new Error("Wrong public coin row scope.");
                run(`INSERT INTO ${COINS}(scope,generation,coin_key,bucket,address,inverse_amount,payload) VALUES(?,?,?,?,?,?,?)`, [namespace, row.generation, row.key, row.bucket, row.address, row.inverseAmount, JSON.stringify(row)]);
                return null;
            }
            case "coinRemove":
                run(`DELETE FROM ${COINS} WHERE scope=? AND generation=? AND coin_key=?`, [namespace, generation, request.key]);
                return null;
            case "scan": {
                // Without the forced index SQLite scans the whole generation for one bucket, once per changed coin.
                let sql = select + " INDEXED BY coin_persistent_bucket WHERE scope=? AND generation=?";
                const values = [namespace, generation];
                if (request.bucket !== undefined) {
                    sql += " AND bucket=?";
                    values.push(request.bucket);
                }
                if (request.after !== null) {
                    sql += " AND (bucket,coin_key)>(?,?)";
                    values.push(request.after[0], request.after[1]);
                }
                sql += " ORDER BY bucket,coin_key LIMIT 256";
                const rows = all(sql, values);
                if (rows.length > 256)
                    throw new Error("Oversized persistent public coin disk page.");
                return rows.map(payload);
            }
            case "nodeGet": return get(`SELECT digest FROM ${NODES} WHERE scope=? AND generation=? AND node_key=?`, [namespace, generation, request.id])?.["digest"] ?? null;
            case "nodePut": {
                if (request.digest === null)
                    run(`DELETE FROM ${NODES} WHERE scope=? AND generation=? AND node_key=?`, [namespace, generation, request.id]);
                else
                    run(`INSERT INTO ${NODES}(scope,generation,node_key,digest) VALUES(?,?,?,?) ON CONFLICT(scope,generation,node_key) DO UPDATE SET digest=excluded.digest`, [namespace, generation, request.id, request.digest]);
                return null;
            }
            case "children": return all(`SELECT node_key AS id,digest FROM ${NODES} WHERE scope=? AND generation=? AND node_key>=? AND node_key<? ORDER BY node_key LIMIT 257`, [namespace, generation, request.prefix, request.prefix + "g"]);
            case "nodeCount": return get(`SELECT COUNT(*) AS count FROM ${NODES} WHERE scope=? AND generation=?`, [namespace, generation])?.["count"];
            case "select": {
                const query = request.query;
                const index = request.largest ? (query.address === undefined ? " INDEXED BY coin_persistent_amount" : " INDEXED BY coin_persistent_address_amount") : "";
                let sql = select + index + " WHERE scope=? AND generation=?";
                const values = [namespace, generation];
                if (query.address !== undefined) {
                    sql += " AND address=?";
                    values.push(query.address);
                }
                if (query.after !== undefined) {
                    if (request.largest) {
                        sql += " AND (inverse_amount,coin_key)>(?,?)";
                        const amount = publicCoinInverseAmount(query.after.amount);
                        values.push(amount, query.after.key);
                    }
                    else {
                        sql += " AND coin_key>?";
                        values.push(query.after);
                    }
                }
                sql += request.largest ? " ORDER BY inverse_amount,coin_key LIMIT ?" : " ORDER BY coin_key LIMIT ?";
                values.push(query.limit + 1);
                const rows = all(sql, values);
                if (rows.length > query.limit + 1)
                    throw new Error("Oversized public coin disk selection.");
                return rows.map(payload);
            }
            default: throw new Error("Unknown persistent public coin transaction operation.");
        }
    }
    try {
        database.exec("PRAGMA busy_timeout=0;PRAGMA journal_mode=DELETE;PRAGMA synchronous=EXTRA;PRAGMA cache_size=-8192;PRAGMA mmap_size=0;PRAGMA temp_store=FILE;");
        if (get("PRAGMA main.journal_mode")?.["journal_mode"] !== "delete" || Number(get("PRAGMA main.synchronous")?.["synchronous"]) !== 3)
            throw new Error("Durable public coin disk commits are unavailable.");
        if (get("PRAGMA main.locking_mode=EXCLUSIVE")?.["locking_mode"] !== "exclusive")
            throw new Error("Public coin disk ownership is unavailable.");
        database.exec("BEGIN EXCLUSIVE");
        if (!database.isTransaction)
            throw new Error("No exclusive disk lease was acquired.");
        database.exec(`CREATE TABLE IF NOT EXISTS ${COINS}(scope TEXT NOT NULL,generation TEXT NOT NULL,coin_key TEXT NOT NULL,bucket TEXT NOT NULL,address TEXT NOT NULL,inverse_amount TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,generation,coin_key)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS coin_persistent_bucket ON ${COINS}(scope,generation,bucket,coin_key);
      CREATE INDEX IF NOT EXISTS coin_persistent_address ON ${COINS}(scope,generation,address,coin_key);
      CREATE INDEX IF NOT EXISTS coin_persistent_amount ON ${COINS}(scope,generation,inverse_amount,coin_key);
      CREATE INDEX IF NOT EXISTS coin_persistent_address_amount ON ${COINS}(scope,generation,address,inverse_amount,coin_key);
      CREATE TABLE IF NOT EXISTS ${META}(scope TEXT PRIMARY KEY NOT NULL,generation TEXT NOT NULL,sealed BLOB NOT NULL) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS ${NODES}(scope TEXT NOT NULL,generation TEXT NOT NULL,node_key TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(scope,generation,node_key)) WITHOUT ROWID;`);
        database.exec("COMMIT");
        committed();
        const transport = {
            async run(plan, write) {
                begin(write);
                let expected;
                try {
                    let step = plan.next();
                    while (!step.done) {
                        const request = step.value;
                        if (request.kind === "metaPut")
                            expected = request.row;
                        step = plan.next(perform(request));
                    }
                    database.exec("COMMIT");
                    committed();
                    if (expected) {
                        const actual = perform({ kind: "metaGet" });
                        if (!actual || actual.generation !== expected.generation || !sameBytes(actual.sealed, expected.sealed))
                            throw new Error("Public coin checkpoint COMMIT did not retain exact sealed progress.");
                    }
                    return step.value;
                }
                catch (error) {
                    rollback();
                    throw error;
                }
            },
            async collect(keep) {
                begin(true);
                try {
                    const coins = all(`SELECT generation,coin_key FROM ${COINS} WHERE scope=? AND generation<>? ORDER BY generation,coin_key LIMIT 256`, [namespace, keep]);
                    for (const row of coins)
                        run(`DELETE FROM ${COINS} WHERE scope=? AND generation=? AND coin_key=?`, [namespace, row["generation"], row["coin_key"]]);
                    const nodes = all(`SELECT generation,node_key FROM ${NODES} WHERE scope=? AND generation<>? ORDER BY generation,node_key LIMIT ?`, [namespace, keep, 256 - coins.length]);
                    for (const row of nodes)
                        run(`DELETE FROM ${NODES} WHERE scope=? AND generation=? AND node_key=?`, [namespace, row["generation"], row["node_key"]]);
                    database.exec("COMMIT");
                    committed();
                    return coins.length + nodes.length;
                }
                catch (error) {
                    rollback();
                    throw error;
                }
            },
            async close() {
                try {
                    if (database.isTransaction)
                        rollback();
                }
                finally {
                    close();
                }
            },
        };
        return new PersistentCoins(namespace, transport, options);
    }
    catch (error) {
        try {
            rollback();
        }
        finally {
            close();
        }
        throw error;
    }
}
