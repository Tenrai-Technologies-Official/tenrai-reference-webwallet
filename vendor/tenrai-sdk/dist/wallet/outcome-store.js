export const MAX_OUTCOME_SEALED_BYTES = 5 * 1024 * 1024;
const HASH = /^[0-9a-f]{96}$/;
export function outcomeIdentity(kind, digest) {
    if ((kind !== "public" && kind !== "private") || !HASH.test(digest))
        throw new Error("Invalid retained outcome identity.");
}
export function outcomeBytes(value) {
    if (!(value instanceof Uint8Array) || value.byteLength < 40 || value.byteLength > MAX_OUTCOME_SEALED_BYTES) {
        throw new Error("The retained outcome is damaged; its original record was preserved.");
    }
    return value;
}
export function outcomeLimit(limit) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128)
        throw new Error("Request between one and 128 retained outcome identities.");
}
const DATABASE = "tenrai-wallet-outcomes-v1";
let opening;
function database() {
    if (opening)
        return opening;
    const attempt = new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        let rejected = false;
        request.onupgradeneeded = () => request.result.createObjectStore("records");
        request.onsuccess = () => {
            const db = request.result;
            if (rejected) {
                db.close();
                return;
            }
            db.onversionchange = () => { db.close(); opening = undefined; };
            resolve(db);
        };
        request.onerror = () => reject(request.error ?? new Error("Retained outcome storage is unavailable."));
        request.onblocked = () => { rejected = true; reject(new Error("Close the other wallet before opening retained outcomes.")); };
    });
    opening = attempt;
    void attempt.catch(() => { if (opening === attempt)
        opening = undefined; });
    return attempt;
}
/** Immutable per-digest records survive rotation of the bounded active journal. */
export function indexedDbOutcomeStore(namespace) {
    if (!/^[a-zA-Z0-9:_-]{1,512}$/.test(namespace))
        throw new Error("Invalid outcome-store namespace.");
    let closed = false;
    const prefix = namespace.length + ":" + namespace + ":";
    const key = (kind, digest) => { outcomeIdentity(kind, digest); return prefix + kind + ":" + digest; };
    async function transaction(mode, work) {
        if (closed)
            throw new Error("The outcome store is closed.");
        const db = await database();
        if (closed)
            throw new Error("The outcome store is closed.");
        return new Promise((resolve, reject) => {
            const tx = mode === "readwrite" ? db.transaction("records", mode, { durability: "strict" }) : db.transaction("records", mode);
            if (mode === "readwrite" && tx.durability !== "strict") {
                tx.abort();
                reject(new Error("Outcomes require strict durable browser storage."));
                return;
            }
            let result;
            let ready = false;
            let failure;
            const fail = (error) => { failure = error; try {
                tx.abort();
            }
            catch { /* Preserve the original failure. */ } };
            tx.oncomplete = () => ready ? resolve(result) : reject(new Error("The outcome transaction did not finish."));
            tx.onabort = () => reject(failure ?? tx.error ?? new Error("The outcome transaction was aborted."));
            tx.onerror = () => { failure ??= tx.error; };
            try {
                work(tx.objectStore("records"), (value) => { result = value; ready = true; }, fail);
            }
            catch (error) {
                fail(error);
            }
        });
    }
    return {
        async read(kind, digest) {
            const id = key(kind, digest);
            return transaction("readonly", (table, done, fail) => {
                const request = table.get(id);
                request.onsuccess = () => { try {
                    done(request.result === undefined ? null : outcomeBytes(request.result));
                }
                catch (error) {
                    fail(error);
                } };
                request.onerror = () => fail(request.error);
            });
        },
        async write(kind, digest, sealed) {
            const id = key(kind, digest);
            outcomeBytes(sealed);
            await transaction("readwrite", (table, done, fail) => {
                const request = table.get(id);
                request.onerror = () => fail(request.error);
                request.onsuccess = () => {
                    try {
                        if (request.result !== undefined) {
                            const previous = outcomeBytes(request.result);
                            if (previous.byteLength !== sealed.byteLength || previous.some((byte, index) => byte !== sealed[index]))
                                throw new Error("An immutable retained outcome was replaced.");
                            done();
                            return;
                        }
                        const put = table.add(sealed.slice(), id);
                        put.onsuccess = () => done();
                        put.onerror = () => fail(put.error);
                    }
                    catch (error) {
                        fail(error);
                    }
                };
            });
        },
        async page(kind, after, limit = 128) {
            outcomeLimit(limit);
            outcomeIdentity(kind, after ?? "0".repeat(96));
            const start = prefix + kind + ":";
            const range = IDBKeyRange.bound(start + (after ?? ""), start + "\uffff", after !== undefined, false);
            return transaction("readonly", (table, done, fail) => {
                const ids = [];
                const request = table.openKeyCursor(range);
                request.onerror = () => fail(request.error);
                request.onsuccess = () => {
                    try {
                        const row = request.result;
                        if (!row) {
                            done({ ids, next: null });
                            return;
                        }
                        const digest = String(row.key).slice(start.length);
                        outcomeIdentity(kind, digest);
                        if (ids.length === limit) {
                            done({ ids, next: ids[ids.length - 1] });
                            return;
                        }
                        ids.push(digest);
                        row.continue();
                    }
                    catch (error) {
                        fail(error);
                    }
                };
            });
        },
        close() { closed = true; },
    };
}
