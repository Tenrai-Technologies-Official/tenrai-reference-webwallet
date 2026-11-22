const MAX_BYTES = 16_384 + 40;
const DB_NAME = "tenrai-private-inventory-v1";
const HEX = /^[0-9a-f]{96}$/;
let opening;
function database() {
    if (opening)
        return opening;
    const attempt = new Promise((resolve, reject) => {
        let rejected = false;
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            db.createObjectStore("objects", { keyPath: ["namespace", "id"] });
            const marks = db.createObjectStore("marks", { keyPath: ["namespace", "id"] });
            marks.createIndex("pending", ["namespace", "token", "visited", "id"]);
            db.createObjectStore("meta", { keyPath: "namespace" });
            db.createObjectStore("stats", { keyPath: "namespace" });
        };
        request.onsuccess = () => {
            const db = request.result;
            if (rejected) {
                db.close();
                return;
            }
            db.onversionchange = () => { db.close(); opening = undefined; };
            resolve(db);
        };
        request.onerror = () => { rejected = true; reject(request.error ?? new Error("Private inventory storage failed.")); };
        request.onblocked = () => { rejected = true; reject(new Error("Close the other wallet before updating private storage.")); };
    });
    opening = attempt;
    void attempt.catch(() => { if (opening === attempt)
        opening = undefined; });
    return attempt;
}
function identity(id) { if (!HEX.test(id))
    throw new Error("Invalid private inventory identity."); }
function root(root) {
    identity(root.id);
    identity(root.generation);
    if (!Number.isInteger(root.tree) || root.tree < 1 || root.tree > 4)
        throw new Error("Invalid private inventory tree.");
}
function bytes(value) {
    if (!(value instanceof Uint8Array) || value.byteLength < 40 || value.byteLength > MAX_BYTES) {
        throw new Error("Encrypted private inventory data is damaged.");
    }
    return value;
}
function rootsKey(roots) {
    return roots.map((entry) => entry.tree + ":" + entry.generation + ":" + entry.id).sort().join("|");
}
function sameRoot(first, second) {
    return first.id === second.id && first.tree === second.tree && first.generation === second.generation;
}
/** Ciphertexts only. Callers hold the account session lease across manifest I/O and collection. */
export function indexedDbPrivateInventoryStore(namespace) {
    if (!/^[a-zA-Z0-9:_-]{1,512}$/.test(namespace))
        throw new Error("Invalid private inventory namespace.");
    let closed = false;
    async function transaction(stores, mode, work) {
        if (closed)
            throw new Error("The private inventory store is closed.");
        const db = await database();
        if (closed)
            throw new Error("The private inventory store is closed.");
        return new Promise((resolve, reject) => {
            const tx = mode === "readwrite" ? db.transaction(stores, mode, { durability: "strict" }) : db.transaction(stores, mode);
            if (mode === "readwrite" && tx.durability !== "strict") {
                tx.abort();
                reject(new Error("Private inventory needs durable browser storage."));
                return;
            }
            let result;
            let ready = false;
            let failure;
            const fail = (error) => { failure = error; try {
                tx.abort();
            }
            catch { /* Preserve the failure. */ } };
            tx.oncomplete = () => ready ? resolve(result) : reject(new Error("Private inventory transaction did not finish."));
            tx.onabort = () => reject(failure ?? tx.error ?? new Error("Private inventory transaction was aborted."));
            tx.onerror = () => { failure ??= tx.error; };
            try {
                work(tx, (value) => { result = value; ready = true; }, fail);
            }
            catch (error) {
                fail(error);
            }
        });
    }
    function request(call, done, fail) {
        call.onerror = () => fail(call.error ?? new Error("Private inventory request failed."));
        call.onsuccess = () => { try {
            done(call.result);
        }
        catch (error) {
            fail(error);
        } };
    }
    function collection(tx, token, done, fail) {
        request(tx.objectStore("meta").get(namespace), (value) => {
            if (!value || value.token !== token)
                throw new Error("Private inventory collection roots changed.");
            done(value);
        }, fail);
    }
    return {
        async read(id) {
            identity(id);
            return transaction(["objects"], "readonly", (tx, done, fail) => request(tx.objectStore("objects").get([namespace, id]), (value) => done(value === undefined ? null : bytes(value.sealed)), fail));
        },
        async write(id, sealed) {
            identity(id);
            bytes(sealed);
            await transaction(["objects", "meta", "stats"], "readwrite", (tx, done, fail) => request(tx.objectStore("meta").get(namespace), (active) => {
                if (active)
                    throw new Error("Finish inventory collection before writing another generation.");
                const objects = tx.objectStore("objects");
                request(objects.get([namespace, id]), (old) => {
                    if (old !== undefined) {
                        const previous = bytes(old.sealed);
                        if (previous.byteLength !== sealed.byteLength ||
                            previous.some((value, index) => value !== sealed[index])) {
                            throw new Error("An immutable private inventory object was replaced.");
                        }
                        done();
                        return;
                    }
                    request(tx.objectStore("stats").get(namespace), (stats) => {
                        const objects = Number(stats?.objects ?? 0) + 1;
                        const sealedBytes = Number(stats?.sealedBytes ?? 0) + sealed.byteLength;
                        if (!Number.isSafeInteger(objects) || !Number.isSafeInteger(sealedBytes))
                            throw new Error("Private inventory accounting overflow.");
                        request(tx.objectStore("objects").add({ namespace, id, sealed: sealed.slice() }), () => request(tx.objectStore("stats").put({ namespace, objects, sealedBytes }), () => done(), fail), fail);
                    }, fail);
                }, fail);
            }, fail));
        },
        async usage() {
            return transaction(["stats", "meta"], "readonly", (tx, done, fail) => request(tx.objectStore("stats").get(namespace), (stats) => {
                const objects = Number(stats?.objects ?? 0);
                const sealedBytes = Number(stats?.sealedBytes ?? 0);
                if (!Number.isSafeInteger(objects) || !Number.isSafeInteger(sealedBytes) || objects < 0 || sealedBytes < 0) {
                    throw new Error("Private inventory accounting is damaged.");
                }
                request(tx.objectStore("meta").get(namespace), (meta) => done({ objects: String(objects), sealedBytes: String(sealedBytes), collecting: meta !== undefined }), fail);
            }, fail));
        },
        async beginCollection(token, roots) {
            identity(token);
            if (roots.length > 16)
                throw new Error("Too many private inventory collection roots.");
            roots.forEach(root);
            const key = rootsKey(roots);
            await transaction(["marks", "meta"], "readwrite", (tx, done, fail) => {
                const meta = tx.objectStore("meta");
                const marks = tx.objectStore("marks");
                request(meta.get(namespace), (old) => {
                    if (old?.token === token) {
                        if (old.roots !== key)
                            throw new Error("Private inventory collection roots changed.");
                        done();
                        return;
                    }
                    let index = 0;
                    const add = () => {
                        const entry = roots[index++];
                        if (!entry) {
                            request(meta.put({ namespace, token, roots: key, after: null, phase: "objects" }), () => done(), fail);
                            return;
                        }
                        request(marks.get([namespace, entry.id]), (existing) => {
                            if (existing && !sameRoot(existing, entry))
                                throw new Error("Conflicting private inventory root bindings.");
                            request(marks.put({ namespace, ...entry, token, visited: 0 }), add, fail);
                        }, fail);
                    };
                    add();
                }, fail);
            });
        },
        async pendingCollection() {
            return transaction(["marks", "meta"], "readonly", (tx, done, fail) => {
                const result = [];
                request(tx.objectStore("meta").get(namespace), (meta) => {
                    if (!meta) {
                        done(result);
                        return;
                    }
                    request(tx.objectStore("marks").index("pending").openCursor(IDBKeyRange.bound([namespace, meta.token, 0, ""], [namespace, meta.token, 0, "\uffff"])), function next(cursor) {
                        if (!cursor || result.length === 64) {
                            done(result);
                            return;
                        }
                        const entry = cursor.value;
                        root(entry);
                        result.push({ tree: entry.tree, generation: entry.generation, id: entry.id });
                        cursor.continue();
                    }, fail);
                }, fail);
            });
        },
        async markCollection(entry, children) {
            root(entry);
            if (children.length > 32)
                throw new Error("Invalid private inventory edges.");
            children.forEach(identity);
            await transaction(["marks", "meta"], "readwrite", (tx, done, fail) => {
                const marks = tx.objectStore("marks");
                request(tx.objectStore("meta").get(namespace), (meta) => {
                    if (!meta || meta.phase !== "objects")
                        throw new Error("Private inventory collection is not active.");
                    request(marks.get([namespace, entry.id]), (parent) => {
                        if (!parent || parent.token !== meta.token || parent.visited !== 0 || !sameRoot(parent, entry)) {
                            throw new Error("Private inventory collection is out of order.");
                        }
                        let index = 0;
                        const add = () => {
                            const id = children[index++];
                            if (id === undefined) {
                                request(marks.put({ ...parent, visited: 1 }), () => done(), fail);
                                return;
                            }
                            const child = { ...entry, id };
                            request(marks.get([namespace, id]), (old) => {
                                if (old && !sameRoot(old, child))
                                    throw new Error("Conflicting private inventory child bindings.");
                                if (old?.token === meta.token) {
                                    add();
                                    return;
                                }
                                request(marks.put({ namespace, ...child, token: meta.token, visited: 0 }), add, fail);
                            }, fail);
                        };
                        add();
                    }, fail);
                }, fail);
            });
        },
        async sweepCollection(token) {
            identity(token);
            return transaction(["objects", "marks", "meta", "stats"], "readwrite", (tx, done, fail) => collection(tx, token, (meta) => {
                const marks = tx.objectStore("marks");
                const objects = tx.objectStore("objects");
                request(marks.index("pending").openKeyCursor(IDBKeyRange.bound([namespace, meta.token, 0, ""], [namespace, meta.token, 0, "\uffff"])), (pending) => {
                    if (pending)
                        throw new Error("Private inventory collection has unverified branches.");
                    const from = [namespace, meta.after ?? ""];
                    const target = meta.phase === "objects" ? objects : marks;
                    let scanned = 0;
                    request(target.openCursor(IDBKeyRange.bound(from, [namespace, "\uffff"], meta.after !== null)), function next(cursor) {
                        if (!cursor) {
                            if (meta.phase === "objects") {
                                meta.phase = "marks";
                                meta.after = null;
                                request(tx.objectStore("meta").put(meta), () => done(false), fail);
                            }
                            else {
                                request(tx.objectStore("meta").delete(namespace), () => done(true), fail);
                            }
                            return;
                        }
                        if (scanned === 256) {
                            request(tx.objectStore("meta").put(meta), () => done(false), fail);
                            return;
                        }
                        const id = cursor.value.id;
                        identity(id);
                        meta.after = id;
                        scanned++;
                        const visit = (mark) => {
                            if (mark?.token === meta.token) {
                                cursor.continue();
                                return;
                            }
                            if (meta.phase === "marks") {
                                request(cursor.delete(), () => cursor.continue(), fail);
                                return;
                            }
                            const size = bytes(cursor.value.sealed).byteLength;
                            request(tx.objectStore("stats").get(namespace), (stats) => {
                                const objects = Number(stats?.objects) - 1;
                                const sealedBytes = Number(stats?.sealedBytes) - size;
                                if (!Number.isSafeInteger(objects) || !Number.isSafeInteger(sealedBytes) || objects < 0 || sealedBytes < 0) {
                                    throw new Error("Private inventory accounting is damaged.");
                                }
                                request(cursor.delete(), () => request(tx.objectStore("stats").put({ namespace, objects, sealedBytes }), () => cursor.continue(), fail), fail);
                            }, fail);
                        };
                        if (meta.phase === "marks")
                            visit(cursor.value);
                        else
                            request(marks.get([namespace, id]), visit, fail);
                    }, fail);
                }, fail);
            }, fail));
        },
        close() { closed = true; },
    };
}
