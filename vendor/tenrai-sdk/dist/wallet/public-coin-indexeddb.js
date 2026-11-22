import { PublicCoinOperations, publicCoinBudget, publicCoinCapacity, publicCoin, publicCoinAddress, publicCoinCursor, publicCoinGeneration, publicCoinInverseAmount, publicCoinKey, publicCoinKeys, publicCoinQuery, publicCoinRows, publicCoinScope, publicLargestCoinQuery, samePublicCoin, } from "./public-coin-store.js";
const DATABASE = "tenrai-public-coin-cache-v1";
const TABLE = "coins";
async function lease(scope, manager) {
    if (!manager?.request)
        throw new Error("Exclusive public coin cache ownership is unavailable.");
    let acquired, refused, unlock;
    const ready = new Promise((yes, no) => { acquired = yes; refused = no; });
    const held = new Promise((resolve) => { unlock = resolve; });
    const running = manager.request(`tenrai/public-coins/v1/${scope}`, { mode: "exclusive", ifAvailable: true }, async (lock) => {
        if (!lock) {
            refused(new Error("The public coin cache is already in use."));
            return;
        }
        let released;
        acquired({ release: () => released ??= Promise.resolve().then(() => { unlock(); }).then(() => running) });
        await held;
    });
    void running.catch(refused);
    return ready;
}
function open(factory) {
    return new Promise((resolve, reject) => {
        let failed = false;
        const request = factory.open(DATABASE, 1);
        request.onupgradeneeded = () => {
            const store = request.result.createObjectStore(TABLE, { keyPath: ["scope", "generation", "key"] });
            store.createIndex("address_key", ["scope", "generation", "address", "key"]);
            store.createIndex("amount_key", ["scope", "generation", "inverseAmount", "key"]);
            store.createIndex("address_amount", ["scope", "generation", "address", "inverseAmount", "key"]);
        };
        request.onsuccess = () => { if (failed)
            request.result.close();
        else
            resolve(request.result); };
        request.onerror = () => { failed = true; reject(request.error ?? new Error("The public coin cache could not open.")); };
        request.onblocked = () => { failed = true; reject(new Error("The public coin cache upgrade is blocked.")); };
    });
}
function transaction(database, mode, action) {
    return new Promise((resolve, reject) => {
        let result, error;
        const tx = database.transaction(TABLE, mode, mode === "readwrite" ? { durability: "strict" } : undefined);
        tx.oncomplete = () => error === undefined ? resolve(result) : reject(error);
        tx.onabort = () => reject(error ?? tx.error ?? new Error("The public coin cache transaction aborted."));
        tx.onerror = () => { error ??= tx.error ?? new Error("The public coin cache transaction failed."); };
        const fail = (caught) => {
            error = caught ?? new Error("The public coin cache operation failed.");
            try {
                tx.abort();
            }
            catch {
                reject(error);
            }
        };
        try {
            if (mode === "readwrite" && tx.durability !== "strict")
                throw new Error("Strict public cache transaction completion is unavailable.");
            action(tx.objectStore(TABLE), (value) => { result = value; }, fail);
        }
        catch (caught) {
            fail(caught);
        }
    });
}
function row(coin, scope, generation) {
    return { ...coin, scope, generation, key: publicCoinCursor(coin), amount: coin.amount.toString(), inverseAmount: publicCoinInverseAmount(coin.amount) };
}
function decode(value, scope, generation) {
    if (!value || value.scope !== scope || value.generation !== generation || typeof value.amount !== "string"
        || !/^[1-9][0-9]{0,38}$/.test(value.amount))
        throw new Error("Malformed public coin cache record.");
    const coin = publicCoin({ ...value, amount: BigInt(value.amount) });
    if (value.key !== publicCoinCursor(coin) || value.inverseAmount !== publicCoinInverseAmount(coin.amount))
        throw new Error("Malformed public coin cache indexes.");
    return coin;
}
async function clear(database, range) {
    let more = true;
    while (more) {
        more = await transaction(database, "readwrite", (store, set, fail) => {
            let count = 0;
            const request = store.openCursor(range);
            request.onsuccess = () => {
                try {
                    const cursor = request.result;
                    if (!cursor) {
                        set(false);
                        return;
                    }
                    if (count === 256) {
                        set(true);
                        return;
                    }
                    cursor.delete();
                    count += 1;
                    cursor.continue();
                }
                catch (error) {
                    fail(error);
                }
            };
        });
    }
}
/** Creates a fresh disposable generation under a cross-tab account lease. */
export async function indexedDbPublicCoinStore(scope, options = {}) {
    publicCoinScope(scope);
    const maximum = publicCoinBudget(options);
    const factory = options.indexedDb ?? globalThis.indexedDB, keyRange = options.keyRange ?? globalThis.IDBKeyRange;
    if (!factory || !keyRange)
        throw new Error("Persistent public coin caching is unavailable.");
    const owned = await lease(scope, options.lockManager ?? globalThis.navigator?.locks);
    let database;
    try {
        database = await open(factory);
        if (!database.objectStoreNames.contains(TABLE))
            throw new Error("The public coin cache schema is missing.");
        const scopeRange = keyRange.bound([scope], [scope, []]);
        await clear(database, scopeRange);
        return new IndexedCoins(database, keyRange, scope, publicCoinGeneration(), owned, maximum);
    }
    catch (error) {
        database?.close();
        await owned.release();
        throw error;
    }
}
class IndexedCoins {
    #db;
    #ranges;
    #scope;
    #generation;
    #operations;
    #maximum;
    #count = 0;
    constructor(database, ranges, scope, generation, owned, maximum) {
        this.#db = database;
        this.#ranges = ranges;
        this.#scope = scope;
        this.#generation = generation;
        this.#maximum = maximum;
        this.#operations = new PublicCoinOperations(async () => {
            try {
                await clear(this.#db, this.#ranges.bound(this.#prefix(), [...this.#prefix(), []]));
            }
            finally {
                this.#db.close();
                await owned.release();
            }
        });
        this.#db.onversionchange = () => { this.#operations.fail(new Error("The public coin cache schema changed.")); this.#db.close(); };
    }
    #prefix() { return [this.#scope, this.#generation]; }
    async clearAddress(address) {
        const checked = this.#operations.snapshot(() => publicCoinAddress(address));
        await this.#operations.run(async () => {
            let more = true;
            while (more) {
                const result = await transaction(this.#db, "readwrite", (store, set, fail) => {
                    const prefix = [...this.#prefix(), checked];
                    let removed = 0;
                    const request = store.index("address_key").openCursor(this.#ranges.bound(prefix, [...prefix, []]));
                    request.onsuccess = () => {
                        const cursor = request.result;
                        if (!cursor || removed === 256) {
                            set({ more: cursor !== null, removed });
                            return;
                        }
                        try {
                            decode(cursor.value, this.#scope, this.#generation);
                            publicCoinCapacity(this.#count - removed - 1, this.#maximum);
                            cursor.delete();
                            removed += 1;
                            cursor.continue();
                        }
                        catch (error) {
                            fail(error);
                        }
                    };
                });
                this.#count -= result.removed;
                more = result.more;
            }
        });
    }
    async putPage(rows) {
        const checked = this.#operations.snapshot(() => publicCoinRows(rows));
        await this.#operations.run(async () => {
            const inserted = await transaction(this.#db, "readwrite", (store, set, fail) => {
                let added = 0;
                set(0);
                for (const coin of checked) {
                    const request = store.get([...this.#prefix(), publicCoinCursor(coin)]);
                    request.onsuccess = () => {
                        try {
                            const previous = request.result;
                            if (previous && !samePublicCoin(decode(previous, this.#scope, this.#generation), coin))
                                throw new Error("An immutable public coin changed inside the cache generation.");
                            if (!previous) {
                                publicCoinCapacity(this.#count + added + 1, this.#maximum);
                                store.put(row(coin, this.#scope, this.#generation));
                                added += 1;
                                set(added);
                            }
                        }
                        catch (error) {
                            fail(error);
                        }
                    };
                }
            });
            this.#count += inserted;
        });
    }
    async removePage(keys) {
        const checked = this.#operations.snapshot(() => publicCoinKeys(keys));
        await this.#operations.run(async () => {
            const removed = await transaction(this.#db, "readwrite", (store, set, fail) => {
                let count = 0;
                set(0);
                for (const key of checked) {
                    const request = store.get([...this.#prefix(), key]);
                    request.onsuccess = () => {
                        try {
                            if (request.result !== undefined) {
                                decode(request.result, this.#scope, this.#generation);
                                publicCoinCapacity(this.#count - count - 1, this.#maximum);
                                store.delete([...this.#prefix(), key]);
                                count += 1;
                                set(count);
                            }
                        }
                        catch (error) {
                            fail(error);
                        }
                    };
                }
            });
            this.#count -= removed;
        });
    }
    async get(key) {
        const checked = this.#operations.snapshot(() => publicCoinKey(key));
        return this.#operations.run(() => transaction(this.#db, "readonly", (store, set, fail) => {
            const request = store.get([...this.#prefix(), checked]);
            request.onsuccess = () => {
                try {
                    set(request.result === undefined ? null : decode(request.result, this.#scope, this.#generation));
                }
                catch (error) {
                    fail(error);
                }
            };
        }));
    }
    async page(query = {}) {
        const checked = this.#operations.snapshot(() => publicCoinQuery(query));
        return this.#operations.run(() => transaction(this.#db, "readonly", (store, set, fail) => {
            const prefix = [...this.#prefix(), ...(checked.address === undefined ? [] : [checked.address])];
            const lower = checked.after === undefined ? prefix : [...prefix, checked.after];
            const range = this.#ranges.bound(lower, [...prefix, []], checked.after !== undefined);
            const source = checked.address === undefined ? store : store.index("address_key");
            const coins = [];
            let previous = checked.after;
            const request = source.openCursor(range);
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    set({ coins, nextAfter: null });
                    return;
                }
                try {
                    const coin = decode(cursor.value, this.#scope, this.#generation), key = publicCoinCursor(coin);
                    if (checked.address !== undefined && coin.address !== checked.address || previous !== undefined && key <= previous)
                        throw new Error("Malformed public coin cache key order.");
                    if (coins.length === checked.limit) {
                        set({ coins, nextAfter: publicCoinCursor(coins[coins.length - 1]) });
                        return;
                    }
                    coins.push(coin);
                    previous = key;
                    cursor.continue();
                }
                catch (error) {
                    fail(error);
                }
            };
        }));
    }
    async largestPage(query = {}) {
        const checked = this.#operations.snapshot(() => publicLargestCoinQuery(query));
        return this.#operations.run(() => transaction(this.#db, "readonly", (store, set, fail) => {
            const prefix = [...this.#prefix(), ...(checked.address === undefined ? [] : [checked.address])];
            const lower = checked.after === undefined ? prefix : [...prefix, publicCoinInverseAmount(checked.after.amount), checked.after.key];
            const range = this.#ranges.bound(lower, [...prefix, []], checked.after !== undefined);
            const source = store.index(checked.address === undefined ? "amount_key" : "address_amount");
            const coins = [];
            let previous = checked.after;
            const request = source.openCursor(range);
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    set({ coins, nextAfter: null });
                    return;
                }
                try {
                    const coin = decode(cursor.value, this.#scope, this.#generation), key = publicCoinCursor(coin);
                    if (checked.address !== undefined && coin.address !== checked.address
                        || previous && (coin.amount > previous.amount || coin.amount === previous.amount && key <= previous.key))
                        throw new Error("Malformed public coin cache amount order.");
                    const last = coins[coins.length - 1];
                    if (coins.length === checked.limit && last) {
                        set({ coins, nextAfter: { amount: last.amount, key: publicCoinCursor(last) } });
                        return;
                    }
                    coins.push(coin);
                    previous = { amount: coin.amount, key };
                    cursor.continue();
                }
                catch (error) {
                    fail(error);
                }
            };
        }));
    }
    close() { return this.#operations.close(); }
}
