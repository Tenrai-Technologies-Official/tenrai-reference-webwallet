import { finalityGuardBytes } from "./finality-guard-store.js";
import { FINALITY_GUARD_DATABASE, FINALITY_GUARD_TABLE, FinalityGuardRuns, finalityBrowserLease, guardRecord, nextGuardRecord, sameGuardRecord, } from "./finality-guard-runtime.js";
/** Persistent default for browsers. The scope/lock/database are global across this origin's accounts. */
export function indexedDbFinalityGuardStore(options = {}) {
    const factory = options.indexedDb ?? globalThis.indexedDB;
    const manager = options.lockManager ?? globalThis.navigator?.locks;
    if (!factory || !manager?.request)
        throw new Error("Durable full-wallet finality requires IndexedDB and exclusive Web Locks, or an explicit disk SQLite provider.");
    let database, opening;
    const runs = new FinalityGuardRuns(async (scope) => {
        const lease = await finalityBrowserLease(scope, manager);
        try {
            const db = await open();
            return {
                read: () => read(db, scope),
                async save(previous, value) {
                    const bytes = finalityGuardBytes(value), next = nextGuardRecord(scope, previous, bytes);
                    await transaction(db, "readwrite", (table, done, fail) => {
                        const get = table.get(scope);
                        get.onerror = () => fail(get.error);
                        get.onsuccess = () => {
                            try {
                                const held = get.result === undefined ? null : guardRecord(get.result, scope);
                                if (!sameGuardRecord(held, previous))
                                    throw new Error("The finality guard changed outside its exclusive proof section.");
                                const put = table.put(next, scope);
                                put.onerror = () => fail(put.error);
                                put.onsuccess = () => {
                                    const check = table.get(scope);
                                    check.onerror = () => fail(check.error);
                                    check.onsuccess = () => {
                                        try {
                                            if (!sameGuardRecord(guardRecord(check.result, scope), next))
                                                throw new Error("The browser did not store the exact finality guard generation.");
                                            done();
                                        }
                                        catch (error) {
                                            fail(error);
                                        }
                                    };
                                };
                            }
                            catch (error) {
                                fail(error);
                            }
                        };
                    });
                    // Request-success and even a mocked complete event are insufficient without exact
                    // committed readback under the still-owned cross-tab lease.
                    const committed = await read(db, scope);
                    if (!sameGuardRecord(committed, next))
                        throw new Error("The strict finality guard commit was not retained.");
                    return committed;
                },
                release: () => lease.release(),
            };
        }
        catch (error) {
            await lease.release();
            throw error;
        }
    }, async () => { if (opening)
        await opening.catch(() => { }); database?.close(); database = undefined; });
    function open() {
        if (opening)
            return opening;
        opening = new Promise((resolve, reject) => {
            let refused = false;
            const request = factory.open(FINALITY_GUARD_DATABASE, 1);
            request.onupgradeneeded = () => {
                try {
                    if (!request.result.objectStoreNames.contains(FINALITY_GUARD_TABLE))
                        request.result.createObjectStore(FINALITY_GUARD_TABLE);
                }
                catch (error) {
                    refused = true;
                    try {
                        request.transaction?.abort();
                    }
                    catch { /* Preserve the schema error. */ }
                    reject(error);
                }
            };
            request.onsuccess = () => {
                const db = request.result;
                if (refused) {
                    db.close();
                    return;
                }
                if (!db.objectStoreNames.contains(FINALITY_GUARD_TABLE)) {
                    db.close();
                    reject(new Error("The durable finality guard schema is missing."));
                    return;
                }
                database = db;
                db.onversionchange = () => { runs.fail(new Error("The finality guard schema changed; reopen the durable store.")); db.close(); };
                resolve(db);
            };
            request.onerror = () => { refused = true; reject(request.error ?? new Error("The durable finality guard database is unreadable.")); };
            request.onblocked = () => { refused = true; reject(new Error("Another tab blocks the durable finality guard database.")); };
        });
        return opening;
    }
    return runs;
}
function read(database, scope) {
    return transaction(database, "readonly", (table, done, fail) => {
        const request = table.get(scope);
        request.onerror = () => fail(request.error);
        request.onsuccess = () => {
            try {
                done(request.result === undefined ? null : guardRecord(request.result, scope));
            }
            catch (error) {
                fail(error);
            }
        };
    });
}
function transaction(database, mode, work) {
    return new Promise((resolve, reject) => {
        const tx = database.transaction(FINALITY_GUARD_TABLE, mode, mode === "readwrite" ? { durability: "strict" } : undefined);
        let result, ready = false, failure;
        const fail = (error) => { failure = error ?? new Error("Finality guard transaction failed."); try {
            tx.abort();
        }
        catch {
            reject(failure);
        } };
        tx.oncomplete = () => ready && failure === undefined ? resolve(result) : reject(failure ?? new Error("Finality guard storage acknowledged no complete operation."));
        tx.onabort = () => reject(failure ?? tx.error ?? new Error("The finality guard transaction aborted."));
        tx.onerror = () => { failure ??= tx.error ?? new Error("The finality guard transaction failed."); };
        if (mode === "readwrite" && tx.durability !== "strict") {
            fail(new Error("Finality guard persistence requires strict browser durability."));
            return;
        }
        try {
            work(tx.objectStore(FINALITY_GUARD_TABLE), (value) => { result = value; ready = true; }, fail);
        }
        catch (error) {
            fail(error);
        }
    });
}
