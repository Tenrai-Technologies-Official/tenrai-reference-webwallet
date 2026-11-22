const MAX_PAGE_BYTES = 4 + 256 * 56 + 40;
const TABLE = "tenrai_private_scan_pages_v1";
const yieldTurn = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Wraps an application-provided SQLite connection; it imports no native database package. */
export function sqlitePrivateLocalScanStore(database, namespace) {
    if (!/^[a-zA-Z0-9:_-]{1,512}$/.test(namespace))
        throw new Error("Invalid private scan store namespace.");
    const file = database.prepare("PRAGMA database_list").get()?.file;
    if (typeof file !== "string" || file.length === 0)
        throw new Error("Private recovery requires a disk database.");
    database.exec("PRAGMA auto_vacuum=INCREMENTAL; PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA cache_size=-4096");
    if (Number(database.prepare("PRAGMA auto_vacuum").get()?.auto_vacuum) !== 2 ||
        Number(database.prepare("PRAGMA synchronous").get()?.synchronous) !== 3 ||
        database.prepare("PRAGMA journal_mode").get()?.journal_mode !== "delete") {
        throw new Error("Use a dedicated incremental-vacuum SQLite database with durable transactions.");
    }
    database.exec("CREATE TABLE IF NOT EXISTS " + TABLE +
        " (namespace TEXT NOT NULL, generation TEXT NOT NULL, ord INTEGER NOT NULL, pass INTEGER NOT NULL," +
        " page TEXT NOT NULL, sealed BLOB NOT NULL, PRIMARY KEY(namespace,generation,ord,pass,page))");
    const read = database.prepare("SELECT sealed FROM " + TABLE +
        " WHERE namespace=? AND generation=? AND ord=? AND pass=? AND page=?");
    const put = database.prepare("INSERT OR REPLACE INTO " + TABLE + " VALUES(?,?,?,?,?,?)");
    const remove = database.prepare("DELETE FROM " + TABLE + " WHERE rowid IN (SELECT rowid FROM " + TABLE +
        " WHERE namespace=? AND (? IS NULL OR generation=?) AND (? IS NULL OR ord=?)" +
        " AND (? IS NULL OR pass=?) LIMIT 256)");
    const free = database.prepare("PRAGMA freelist_count");
    let closed = false;
    function identity(generation, page) {
        if (closed)
            throw new Error("The private scan store is closed.");
        if (!/^[0-9a-f]{96}$/.test(generation))
            throw new Error("Invalid private recovery generation.");
        if (page === undefined)
            return undefined;
        const match = /^([12])-(0|[1-9][0-9]{0,4})-(0|[1-9][0-9]{0,19})$/.exec(page);
        if (!match || Number(match[2]) > 65535 || BigInt(match[3]) > 0xffffffffffffffffn) {
            throw new Error("Invalid private recovery page.");
        }
        return { order: Number(match[1]), pass: Number(match[2]), index: match[3] };
    }
    function transaction(work) {
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
            catch { /* Keep the original failure. */ }
            throw error;
        }
    }
    function removeBatch(generation, order, pass) {
        return Number(transaction(() => remove.run(namespace, generation, generation, order, order, pass, pass).changes));
    }
    async function vacuum() {
        while (Number(free.get()?.freelist_count ?? 0) > 0) {
            database.exec("PRAGMA incremental_vacuum(256)");
            await yieldTurn();
        }
    }
    async function clear(generation) {
        if (closed)
            throw new Error("The private scan store is closed.");
        if (generation !== null)
            identity(generation);
        while (removeBatch(generation, null, null) > 0)
            await yieldTurn();
        await vacuum();
    }
    async function clearExcept(generation) {
        if (generation === null)
            return clear(null);
        identity(generation);
        const query = database.prepare("DELETE FROM " + TABLE + " WHERE rowid IN(SELECT rowid FROM " + TABLE +
            " WHERE namespace=? AND generation<>? LIMIT 256)");
        while (Number(transaction(() => query.run(namespace, generation).changes)) > 0)
            await yieldTurn();
        await vacuum();
    }
    return {
        async read(generation, page) {
            const id = identity(generation, page);
            const value = read.get(namespace, generation, id.order, id.pass, id.index)?.sealed;
            if (value === undefined)
                return null;
            if (!(value instanceof Uint8Array) || value.byteLength < 40 || value.byteLength > MAX_PAGE_BYTES) {
                throw new Error("Encrypted private recovery data is damaged.");
            }
            return value;
        },
        async write(generation, page, sealed) {
            const id = identity(generation, page);
            if (!(sealed instanceof Uint8Array) || sealed.byteLength < 40 || sealed.byteLength > MAX_PAGE_BYTES) {
                throw new Error("Invalid encrypted private recovery page.");
            }
            transaction(() => put.run(namespace, generation, id.order, id.pass, id.index, sealed));
            if (id.pass >= 2)
                removeBatch(generation, id.order, id.pass - 2);
            if (id.order === 2 && id.pass === 1)
                removeBatch(generation, 1, null);
            database.exec("PRAGMA incremental_vacuum(256)");
        },
        clear, clearExcept,
        clearRecovery() { return clear(null); },
        close() { closed = true; }, // The application owns the supplied connection.
    };
}
