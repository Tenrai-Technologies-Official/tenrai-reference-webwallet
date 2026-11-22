import { publicCoinBudget, publicCoinInverseAmount } from "./public-coin-store.js";
import { PersistentCoins } from "./public-coin-persistent-client.js";
import { sameBytes, scope } from "./public-coin-persistent-core.js";
const DATABASE = "tenrai-public-coins-persistent-v1", COINS = "coins", META = "meta", NODES = "nodes";
async function lease(namespace, manager) {
    if (!manager?.request)
        throw new Error("Persistent public coins require exclusive Web Locks.");
    const name = `tenrai/public-coins/persistent-v1/${namespace}`;
    let yes, no, unlock, entered = false;
    const ready = new Promise((resolve, reject) => { yes = resolve; no = reject; }), held = new Promise((resolve) => { unlock = resolve; });
    const running = manager.request(name, { mode: "exclusive", ifAvailable: true }, async (lock) => {
        entered = true;
        if (!lock) {
            no(new Error("The persistent public coin cache is already in use."));
            return;
        }
        if (lock.name !== name || lock.mode !== "exclusive") {
            no(new Error("Persistent public coins acquired another scope or nonexclusive lock."));
            return;
        }
        let released;
        yes({ release: () => released ??= Promise.resolve().then(() => unlock()).then(() => running) });
        await held;
    });
    void running.then(() => { if (!entered)
        no(new Error("No physical public coin lease was acquired.")); }, no);
    return ready;
}
function open(factory) {
    return new Promise((resolve, reject) => {
        let failed = false;
        const request = factory.open(DATABASE, 1);
        request.onupgradeneeded = () => {
            try {
                const db = request.result, coins = db.createObjectStore(COINS, { keyPath: ["scope", "generation", "key"] });
                coins.createIndex("bucket_key", ["scope", "generation", "bucket", "key"]);
                coins.createIndex("address_key", ["scope", "generation", "address", "key"]);
                coins.createIndex("amount_key", ["scope", "generation", "inverseAmount", "key"]);
                coins.createIndex("address_amount", ["scope", "generation", "address", "inverseAmount", "key"]);
                db.createObjectStore(META, { keyPath: "scope" });
                db.createObjectStore(NODES, { keyPath: ["scope", "generation", "id"] });
            }
            catch (error) {
                failed = true;
                try {
                    request.transaction?.abort();
                }
                catch { }
                reject(error);
            }
        };
        request.onsuccess = () => { if (failed)
            request.result.close();
        else
            resolve(request.result); };
        request.onerror = () => { failed = true; reject(request.error ?? new Error("Persistent public coin storage is unreadable.")); };
        request.onblocked = () => { failed = true; reject(new Error("Persistent public coin storage is blocked by another tab.")); };
    });
}
/** Stable per-root/chain/genesis/account generation; close never discards a completed page. */
export async function indexedDbPersistentPublicCoinStore(namespace, options = {}) {
    scope(namespace);
    publicCoinBudget(options);
    const factory = options.indexedDb ?? globalThis.indexedDB, ranges = options.keyRange ?? globalThis.IDBKeyRange;
    if (!factory || !ranges)
        throw new Error("Persistent public coins require IndexedDB; no memory fallback exists.");
    const owned = await lease(namespace, options.lockManager ?? globalThis.navigator?.locks);
    let db;
    try {
        db = await open(factory);
        if (![COINS, META, NODES].every((name) => db.objectStoreNames.contains(name)))
            throw new Error("Persistent public coin schema is missing.");
        const database = db;
        let store;
        async function execute(plan, write) {
            let expected;
            const result = await new Promise((resolve, reject) => {
                const tx = database.transaction([COINS, META, NODES], write ? "readwrite" : "readonly", write ? { durability: "strict" } : undefined);
                let value, ready = false, error;
                const fail = (caught) => { error = caught ?? new Error("Persistent public coin transaction failed."); try {
                    tx.abort();
                }
                catch {
                    reject(error);
                } };
                tx.oncomplete = () => ready && error === undefined ? resolve(value) : reject(error ?? new Error("No complete public coin transaction was acknowledged."));
                tx.onabort = () => reject(error ?? tx.error ?? new Error("Persistent public coin transaction aborted."));
                tx.onerror = () => { error ??= tx.error ?? new Error("Persistent public coin transaction failed."); };
                if (write && tx.durability !== "strict") {
                    fail(new Error("Strict persistent public coin durability is unavailable."));
                    return;
                }
                const coins = tx.objectStore(COINS), meta = tx.objectStore(META), nodes = tx.objectStore(NODES);
                function take(request, done) { request.onerror = () => fail(request.error); request.onsuccess = () => { try {
                    done(request.result);
                }
                catch (caught) {
                    fail(caught);
                } }; }
                function cursor(source, range, limit, done) {
                    const rows = [], request = source.openCursor(range);
                    request.onerror = () => fail(request.error);
                    request.onsuccess = () => { try {
                        const held = request.result;
                        if (!held) {
                            done(rows);
                            return;
                        }
                        rows.push(held.value);
                        if (rows.length === limit)
                            done(rows);
                        else
                            held.continue();
                    }
                    catch (caught) {
                        fail(caught);
                    } };
                }
                function step(input) {
                    try {
                        const next = plan.next(input);
                        if (next.done) {
                            value = next.value;
                            ready = true;
                            return;
                        }
                        const request = next.value, generation = request.generation, prefix = [namespace, generation];
                        switch (request.kind) {
                            case "metaGet":
                                take(meta.get(namespace), (row) => step(row ?? null));
                                break;
                            case "metaPut":
                                if (request.row.scope !== namespace)
                                    throw new Error("Wrong public coin metadata scope.");
                                expected = request.row;
                                take(meta.put(request.row), () => step(null));
                                break;
                            case "coinGet":
                                take(coins.get([...prefix, request.key]), (row) => step(row ?? null));
                                break;
                            case "coinPut":
                                if (request.row.scope !== namespace)
                                    throw new Error("Wrong public coin row scope.");
                                take(coins.put(request.row), () => step(null));
                                break;
                            case "coinRemove":
                                take(coins.delete([...prefix, request.key]), () => step(null));
                                break;
                            case "nodeGet":
                                take(nodes.get([...prefix, request.id]), (row) => { if (row && (row.scope !== namespace || row.generation !== generation || row.id !== request.id))
                                    throw new Error("Wrong public coin node scope."); step(row?.digest ?? null); });
                                break;
                            case "nodePut":
                                take(request.digest === null ? nodes.delete([...prefix, request.id]) : nodes.put({ scope: namespace, generation, id: request.id, digest: request.digest }), () => step(null));
                                break;
                            case "nodeCount":
                                take(nodes.count(ranges.bound(prefix, [...prefix, []])), step);
                                break;
                            case "children":
                                cursor(nodes, ranges.bound([...prefix, request.prefix], [...prefix, request.prefix + "g"], false, true), 257, (rows) => { for (const row of rows)
                                    if (row.scope !== namespace || row.generation !== generation)
                                        throw new Error("Wrong public coin hash node scope."); step(rows.map((row) => ({ id: row.id, digest: row.digest }))); });
                                break;
                            case "scan": {
                                const base = request.bucket === undefined ? prefix : [...prefix, request.bucket];
                                const lower = request.after === null ? base : [...prefix, ...request.after];
                                cursor(coins.index("bucket_key"), ranges.bound(lower, [...base, []], request.after !== null), 256, step);
                                break;
                            }
                            case "select": {
                                const query = request.query, base = query.address === undefined ? prefix : [...prefix, query.address];
                                const after = query.after === undefined ? [] : request.largest ? [publicCoinInverseAmount(query.after.amount), query.after.key] : [query.after];
                                const source = request.largest ? coins.index(query.address === undefined ? "amount_key" : "address_amount") : query.address === undefined ? coins : coins.index("address_key");
                                cursor(source, ranges.bound([...base, ...after], [...base, []], query.after !== undefined), query.limit + 1, step);
                                break;
                            }
                            default: throw new Error("Unknown persistent public coin transaction operation.");
                        }
                    }
                    catch (caught) {
                        fail(caught);
                    }
                }
                step();
            });
            if (expected) {
                function* check() {
                    return yield { kind: "metaGet" };
                }
                const actual = await execute(check(), false);
                if (!actual || actual.generation !== expected.generation || !sameBytes(actual.sealed, expected.sealed))
                    throw new Error("Public coin commit did not retain its exact sealed progress.");
            }
            return result;
        }
        async function collect(keep) {
            return new Promise((resolve, reject) => {
                const tx = database.transaction([COINS, NODES], "readwrite", { durability: "strict" });
                let count = 0, error, ready = false;
                const fail = (caught) => { error = caught ?? new Error("Persistent coin collection failed."); try {
                    tx.abort();
                }
                catch {
                    reject(error);
                } };
                tx.oncomplete = () => ready && error === undefined ? resolve(count) : reject(error ?? new Error("Incomplete public coin collection."));
                tx.onabort = () => reject(error ?? tx.error);
                tx.onerror = () => { error ??= tx.error; };
                if (tx.durability !== "strict") {
                    fail(new Error("Strict persistent coin collection is unavailable."));
                    return;
                }
                function walk(name, done) {
                    const request = tx.objectStore(name).openCursor(ranges.bound([namespace], [namespace, []]));
                    request.onerror = () => fail(request.error);
                    request.onsuccess = () => {
                        try {
                            const held = request.result;
                            if (!held || count === 256) {
                                done();
                                return;
                            }
                            const row = held.value;
                            if (row.scope !== namespace || typeof row.generation !== "string" || !/^[0-9a-f]{32}$/.test(row.generation))
                                throw new Error("Refusing to collect an unowned public coin row.");
                            if (row.generation === keep) {
                                held.continue([namespace, keep, []]);
                                return;
                            }
                            const removing = held.delete();
                            removing.onerror = () => fail(removing.error);
                            count++;
                            held.continue();
                        }
                        catch (caught) {
                            fail(caught);
                        }
                    };
                }
                walk(COINS, () => walk(NODES, () => { ready = true; }));
            });
        }
        const transport = { run: execute, collect, async close() {
                database.close();
                await owned.release();
            } };
        store = new PersistentCoins(namespace, transport, options);
        database.onversionchange = () => {
            void store.close();
        };
        return store;
    }
    catch (error) {
        db?.close();
        await owned.release();
        throw error;
    }
}
