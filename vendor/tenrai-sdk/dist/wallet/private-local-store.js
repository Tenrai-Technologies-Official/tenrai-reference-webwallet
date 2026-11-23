const DATABASE = "tenrai-private-scan-pages";
const TABLE = "pages";
const MAX_PAGE_BYTES = 4 + 256 * 56 + 40;
function address(generation, page) {
    if (!/^[0-9a-f]{96}$/.test(generation))
        throw new Error("Invalid private recovery generation.");
    if (page !== undefined) {
        const match = /^([12])-(0|[1-9][0-9]{0,4})-(0|[1-9][0-9]{0,19})$/.exec(page);
        if (!match || Number(match[2]) > 65535 || BigInt(match[3]) > 0xffffffffffffffffn) {
            throw new Error("Invalid private recovery page.");
        }
    }
}
/** Store ciphertexts while the caller holds the account lease. */
export function browserPrivateLocalScanStore(namespace) {
    if (!/^[a-zA-Z0-9:_-]{1,512}$/.test(namespace))
        throw new Error("Invalid private scan store namespace.");
    const prefix = namespace.length + ":" + namespace + ":recovery:";
    let opened;
    let closed = false;
    function database() {
        if (closed)
            return Promise.reject(new Error("The private scan store is closed."));
        opened ??= new Promise((resolve, reject) => {
            const request = indexedDB.open(DATABASE, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(TABLE);
            request.onsuccess = () => {
                request.result.onversionchange = () => { request.result.close(); opened = undefined; };
                resolve(request.result);
            };
            request.onerror = () => reject(request.error ?? new Error("Private recovery storage is unavailable."));
        }).catch((error) => { opened = undefined; throw error; });
        return opened;
    }
    async function transaction(mode, work) {
        const connection = await database();
        if (closed)
            throw new Error("The private scan store is closed.");
        return new Promise((resolve, reject) => {
            let tx;
            try {
                tx = connection.transaction(TABLE, mode, mode === "readwrite" ? { durability: "strict" } : undefined);
                if (mode === "readwrite" && tx.durability !== "strict") {
                    tx.abort();
                    throw new Error("Private recovery needs durable browser storage.");
                }
                const active = tx;
                const request = work(active.objectStore(TABLE));
                active.oncomplete = () => resolve(request.result);
                active.onerror = active.onabort = () => reject(active.error ?? new Error("Private recovery storage failed."));
            }
            catch (error) {
                try {
                    tx?.abort();
                }
                catch { /* Already inactive. */ }
                reject(error);
            }
        });
    }
    async function removeRange(range) {
        for (;;) {
            const connection = await database();
            if (closed)
                throw new Error("The private scan store is closed.");
            const more = await new Promise((resolve, reject) => {
                const tx = connection.transaction(TABLE, "readwrite", { durability: "strict" });
                if (tx.durability !== "strict") {
                    tx.abort();
                    reject(new Error("Private recovery needs durable browser storage."));
                    return;
                }
                let count = 0;
                let exhausted = false;
                const cursor = tx.objectStore(TABLE).openCursor(range);
                cursor.onsuccess = () => {
                    const row = cursor.result;
                    if (!row) {
                        exhausted = true;
                        return;
                    }
                    if (count === 256)
                        return;
                    count++;
                    row.delete();
                    row.continue();
                };
                tx.oncomplete = () => resolve(!exhausted);
                tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Private recovery cleanup failed."));
            });
            if (!more)
                return;
        }
    }
    const remove = (part) => removeRange(IDBKeyRange.bound(part, part + "\uffff"));
    return {
        async read(generation, page) {
            address(generation, page);
            const value = await transaction("readonly", (table) => table.get(prefix + generation + ":" + page));
            if (value === undefined)
                return null;
            if (!(value instanceof Uint8Array) || value.byteLength < 40 || value.byteLength > MAX_PAGE_BYTES) {
                throw new Error("Encrypted private recovery data is damaged.");
            }
            return value;
        },
        async write(generation, page, sealed) {
            address(generation, page);
            if (!(sealed instanceof Uint8Array) || sealed.byteLength < 40 || sealed.byteLength > MAX_PAGE_BYTES) {
                throw new Error("Invalid encrypted private recovery page.");
            }
            await transaction("readwrite", (table) => table.put(sealed, prefix + generation + ":" + page));
            const [order, pass] = page.split("-");
            if (Number(pass) >= 2)
                await remove(prefix + generation + ":" + order + "-" + (Number(pass) - 2) + "-");
            if (order === "2" && pass === "1")
                await remove(prefix + generation + ":1-");
        },
        clear(generation) { address(generation); return remove(prefix + generation + ":"); },
        clearRecovery() { return remove(prefix); },
        async clearExcept(generation) {
            if (generation === null) {
                await remove(prefix);
                return;
            }
            address(generation);
            const keep = prefix + generation + ":";
            await removeRange(IDBKeyRange.bound(prefix, keep, false, true));
            await removeRange(IDBKeyRange.bound(keep + "\uffff", prefix + "\uffff", true, false));
        },
        close() { closed = true; void opened?.then((database) => database.close()).catch(() => { }); },
    };
}
