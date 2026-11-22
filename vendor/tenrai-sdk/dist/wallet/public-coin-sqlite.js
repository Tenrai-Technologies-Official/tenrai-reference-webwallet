import { PublicCoinOperations, publicCoinGeneration, publicCoinBudget, publicCoinCapacity, publicCoin, publicCoinAddress, publicCoinCursor, publicCoinInverseAmount, publicCoinKey, publicCoinKeys, publicCoinQuery, publicCoinRows, publicCoinScope, publicLargestCoinQuery, samePublicCoin, } from "./public-coin-store.js";
const TABLE = "tenrai_public_coin_cache";
const SELECT = "coin_key,address,transaction_id,output_index,amount_atoms,created_height,inverse_amount";
function decode(row) {
    const amount = row["amount_atoms"];
    if (typeof amount !== "string" || !/^[1-9][0-9]{0,38}$/.test(amount))
        throw new Error("Malformed public coin cache amount.");
    const coin = publicCoin({ address: row["address"], transactionId: row["transaction_id"],
        outputIndex: row["output_index"], amount: BigInt(amount), height: row["created_height"] });
    if (row["coin_key"] !== publicCoinCursor(coin) || row["inverse_amount"] !== publicCoinInverseAmount(coin.amount))
        throw new Error("Malformed public coin cache indexes.");
    return coin;
}
/** Holds a dedicated cache-only SQLite write lease; its rows never become financial journal state. */
export async function sqlitePublicCoinStore(database, scope, options) {
    publicCoinScope(scope);
    if (!options || options.maxCoins === undefined)
        throw new Error("Choose an explicit finite public coin cache row budget for this dedicated disk volume and monitor its storage headroom.");
    const maximum = publicCoinBudget(options);
    let leased = false, owned = false;
    try {
        const locations = database.prepare("PRAGMA database_list").all();
        if (locations.some((row) => row["name"] !== "main" && row["name"] !== "temp"))
            throw new Error("Attached databases cannot share the public coin cache connection.");
        const main = locations.find((row) => row["name"] === "main");
        if (!main || typeof main["file"] !== "string" || !main["file"].length)
            throw new Error("The public coin cache requires a dedicated disk SQLite file.");
        const other = database.prepare("SELECT name FROM sqlite_master WHERE name NOT IN (?,?,?,?) AND name NOT GLOB 'sqlite_*' LIMIT 1").get(TABLE, "public_coin_address", "public_coin_amount", "public_coin_address_amount");
        if (other)
            throw new Error("A financial or unrelated SQLite database cannot be used as a public coin cache.");
        owned = true;
        // These settings apply only after the dedicated cache schema check, never to journals.
        database.exec("PRAGMA busy_timeout=0; PRAGMA cache_size=-8192; PRAGMA mmap_size=0; PRAGMA temp_store=FILE;");
        database.exec(`CREATE TABLE IF NOT EXISTS ${TABLE}(
      scope TEXT NOT NULL,generation TEXT NOT NULL,coin_key TEXT NOT NULL,address TEXT NOT NULL,
      transaction_id TEXT NOT NULL,output_index INTEGER NOT NULL,amount_atoms TEXT NOT NULL,
      created_height INTEGER NOT NULL,inverse_amount TEXT NOT NULL,
      PRIMARY KEY(scope,generation,coin_key)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS public_coin_address ON ${TABLE}(scope,generation,address,coin_key);
      CREATE INDEX IF NOT EXISTS public_coin_amount ON ${TABLE}(scope,generation,inverse_amount,coin_key);
      CREATE INDEX IF NOT EXISTS public_coin_address_amount ON ${TABLE}(scope,generation,address,inverse_amount,coin_key);`);
        // The operation spans network rebuild and every selection pass; a second process fails busy.
        database.exec("BEGIN IMMEDIATE");
        leased = true;
        const generation = publicCoinGeneration();
        database.prepare(`DELETE FROM ${TABLE} WHERE scope=?`).run(scope);
        return new SqliteCoins(database, scope, generation, maximum);
    }
    catch (error) {
        if (leased) {
            try {
                database.exec("ROLLBACK");
            }
            catch { /* Original failure is retained. */ }
        }
        if (owned)
            database.close();
        throw error;
    }
}
class SqliteCoins {
    #db;
    #scope;
    #generation;
    #operations;
    #maximum;
    #count = 0;
    constructor(database, scope, generation, maximum) {
        this.#db = database;
        this.#scope = scope;
        this.#generation = generation;
        this.#maximum = maximum;
        this.#operations = new PublicCoinOperations(async () => {
            try {
                this.#db.exec("ROLLBACK");
            }
            finally {
                this.#db.close();
            }
        });
    }
    #parameters() { return [this.#scope, this.#generation]; }
    #get(key) {
        const row = this.#db.prepare(`SELECT ${SELECT} FROM ${TABLE} WHERE scope=? AND generation=? AND coin_key=?`).get(...this.#parameters(), key);
        return row ? decode(row) : null;
    }
    async clearAddress(address) {
        const value = this.#operations.snapshot(() => publicCoinAddress(address));
        await this.#operations.run(() => {
            const count = this.#db.prepare(`SELECT COUNT(*) AS count FROM ${TABLE} WHERE scope=? AND generation=? AND address=?`).get(...this.#parameters(), value)?.["count"];
            if (typeof count !== "number" || !Number.isSafeInteger(count))
                throw new Error("Malformed public coin cache row count.");
            publicCoinCapacity(this.#count - count, this.#maximum);
            this.#db.prepare(`DELETE FROM ${TABLE} WHERE scope=? AND generation=? AND address=?`).run(...this.#parameters(), value);
            this.#count -= count;
        });
    }
    async putPage(rows) {
        const checked = this.#operations.snapshot(() => publicCoinRows(rows));
        await this.#operations.run(() => {
            const statement = this.#db.prepare(`INSERT INTO ${TABLE}(scope,generation,coin_key,address,transaction_id,output_index,amount_atoms,created_height,inverse_amount) VALUES(?,?,?,?,?,?,?,?,?)`);
            const fresh = checked.filter((coin) => {
                const previous = this.#get(publicCoinCursor(coin));
                if (previous && !samePublicCoin(previous, coin))
                    throw new Error("An immutable public coin changed inside the cache generation.");
                return previous === null;
            });
            publicCoinCapacity(this.#count + fresh.length, this.#maximum);
            for (const coin of fresh) {
                const key = publicCoinCursor(coin);
                statement.run(...this.#parameters(), key, coin.address, coin.transactionId, coin.outputIndex, coin.amount.toString(), coin.height, publicCoinInverseAmount(coin.amount));
            }
            this.#count += fresh.length;
        });
    }
    async removePage(keys) {
        const checked = this.#operations.snapshot(() => publicCoinKeys(keys));
        await this.#operations.run(() => {
            const statement = this.#db.prepare(`DELETE FROM ${TABLE} WHERE scope=? AND generation=? AND coin_key=?`);
            const existing = checked.filter((key) => this.#get(key) !== null);
            publicCoinCapacity(this.#count - existing.length, this.#maximum);
            for (const key of existing)
                statement.run(...this.#parameters(), key);
            this.#count -= existing.length;
        });
    }
    async get(key) {
        const checked = this.#operations.snapshot(() => publicCoinKey(key));
        return this.#operations.run(() => this.#get(checked));
    }
    async page(query = {}) {
        const checked = this.#operations.snapshot(() => publicCoinQuery(query));
        return this.#operations.run(() => {
            let sql = `SELECT ${SELECT} FROM ${TABLE} WHERE scope=? AND generation=?`;
            const values = this.#parameters();
            if (checked.address !== undefined) {
                sql += " AND address=?";
                values.push(checked.address);
            }
            if (checked.after !== undefined) {
                sql += " AND coin_key>?";
                values.push(checked.after);
            }
            sql += " ORDER BY coin_key ASC LIMIT ?";
            values.push(checked.limit + 1);
            const rows = this.#db.prepare(sql).all(...values);
            if (rows.length > checked.limit + 1)
                throw new Error("The public coin cache returned an oversized page.");
            const all = rows.map(decode);
            this.#checkPage(all, checked.address, checked.after);
            const coins = all.slice(0, checked.limit);
            return { coins, nextAfter: all.length > checked.limit ? publicCoinCursor(coins[coins.length - 1]) : null };
        });
    }
    async largestPage(query = {}) {
        const checked = this.#operations.snapshot(() => publicLargestCoinQuery(query));
        return this.#operations.run(() => {
            let sql = `SELECT ${SELECT} FROM ${TABLE} INDEXED BY ${checked.address === undefined ? "public_coin_amount" : "public_coin_address_amount"} WHERE scope=? AND generation=?`;
            const values = this.#parameters();
            if (checked.address !== undefined) {
                sql += " AND address=?";
                values.push(checked.address);
            }
            if (checked.after !== undefined) {
                sql += " AND (inverse_amount,coin_key)>(?,?)";
                const amount = publicCoinInverseAmount(checked.after.amount);
                values.push(amount, checked.after.key);
            }
            sql += " ORDER BY inverse_amount ASC,coin_key ASC LIMIT ?";
            values.push(checked.limit + 1);
            const rows = this.#db.prepare(sql).all(...values);
            if (rows.length > checked.limit + 1)
                throw new Error("The public coin cache returned an oversized page.");
            const all = rows.map(decode);
            let previous = checked.after;
            for (const coin of all) {
                const key = publicCoinCursor(coin);
                if (checked.address !== undefined && checked.address !== coin.address
                    || previous && (coin.amount > previous.amount || coin.amount === previous.amount && key <= previous.key))
                    throw new Error("The public coin cache amount order is malformed.");
                previous = { amount: coin.amount, key };
            }
            const coins = all.slice(0, checked.limit), last = coins[coins.length - 1];
            return { coins, nextAfter: all.length > checked.limit && last ? { amount: last.amount, key: publicCoinCursor(last) } : null };
        });
    }
    #checkPage(coins, address, after) {
        let previous = after;
        for (const coin of coins) {
            const key = publicCoinCursor(coin);
            if (address !== undefined && coin.address !== address || previous !== undefined && key <= previous)
                throw new Error("The public coin cache key order is malformed.");
            previous = key;
        }
    }
    close() { return this.#operations.close(); }
}
