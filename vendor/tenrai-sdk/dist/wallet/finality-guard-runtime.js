import { finalityGuardBytes, finalityGuardScope } from "./finality-guard-store.js";
export const FINALITY_GUARD_DATABASE = "tenrai-wallet-finality-v1";
export const FINALITY_GUARD_TABLE = "guards";
export const finalityGuardLock = (scope) => `tenrai/wallet-finality/v1/${scope}`;
const MAX_PENDING_RUNS = 8;
const MAX_PENDING_SAVES = 8;
const MAX_REVISION = 0xffffffffffffffffn;
export class FinalityGuardBusyError extends Error {
    constructor() { super("The full-wallet finality guard is in use; retry this short proof section."); this.name = "FinalityGuardBusyError"; }
}
export function sameGuardBytes(a, b) {
    return a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);
}
export function guardRecord(value, scope) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("The stored finality guard envelope is damaged.");
    const row = value;
    if (Object.keys(row).length !== 4 || row["format"] !== 1 || row["scope"] !== scope || typeof row["revision"] !== "string"
        || !/^[1-9][0-9]{0,19}$/.test(row["revision"]) || BigInt(row["revision"]) > MAX_REVISION) {
        throw new Error("The stored finality guard changed its scope or generation.");
    }
    return { format: 1, scope, revision: row["revision"], sealed: finalityGuardBytes(row["sealed"]) };
}
export function sameGuardRecord(a, b) {
    return a === null || b === null ? a === b : a.scope === b.scope && a.revision === b.revision && sameGuardBytes(a.sealed, b.sealed);
}
export function nextGuardRecord(scope, previous, bytes) {
    const revision = BigInt(previous?.revision ?? "0") + 1n;
    if (revision > MAX_REVISION)
        throw new Error("The finality guard generation is exhausted.");
    return { format: 1, scope, revision: revision.toString(), sealed: finalityGuardBytes(bytes) };
}
/** Bounded local scheduling; the backend lease is the actual cross-instance/process authority. */
export class FinalityGuardRuns {
    #begin;
    #cleanup;
    #tail = Promise.resolve();
    #pending = 0;
    #closing = false;
    #closed;
    #failure;
    constructor(begin, cleanup) { this.#begin = begin; this.#cleanup = cleanup; }
    fail(error) { this.#failure ??= error ?? new Error("Finality guard storage failed."); }
    #open() {
        if (this.#closing)
            throw new Error("The finality guard store is closed.");
        if (this.#failure !== undefined)
            throw new Error("Finality guard persistence is uncertain; close and reopen its durable store before continuing.", { cause: this.#failure });
    }
    run(scope, work) {
        try {
            this.#open();
            finalityGuardScope(scope);
            if (typeof work !== "function")
                throw new Error("A finality guard run needs its proof callback.");
        }
        catch (error) {
            return Promise.reject(error);
        }
        if (this.#pending >= MAX_PENDING_RUNS)
            return Promise.reject(new Error("The bounded finality guard queue is full."));
        this.#pending += 1;
        const result = this.#tail.then(async () => {
            this.#open();
            let lease;
            try {
                lease = await this.#begin(scope);
            }
            catch (error) {
                if (!(error instanceof FinalityGuardBusyError))
                    this.fail(error);
                throw error;
            }
            try {
                this.#open();
                return await this.#owned(scope, lease, work);
            }
            finally {
                try {
                    await lease.release();
                }
                catch (error) {
                    this.fail(error);
                    throw error;
                }
            }
        });
        const finished = result.finally(() => { this.#pending -= 1; });
        this.#tail = finished.then(() => { }, () => { });
        return finished;
    }
    async #owned(scope, lease, work) {
        let current;
        try {
            const read = await lease.read();
            current = read === null ? null : guardRecord(read, scope);
        }
        catch (error) {
            this.fail(error);
            throw error;
        }
        let accepting = true, pending = 0;
        let writes = Promise.resolve();
        let failure;
        const saveExact = (value) => {
            let bytes;
            try {
                if (!accepting)
                    throw new Error("The finality guard proof section no longer owns its lease.");
                if (pending >= MAX_PENDING_SAVES)
                    throw new Error("The bounded finality guard save queue is full.");
                bytes = finalityGuardBytes(value);
            }
            catch (error) {
                if (accepting) {
                    failure = error ?? new Error("Finality guard save validation failed.");
                    this.fail(failure);
                }
                const refused = Promise.reject(error);
                void refused.catch(() => { });
                return refused;
            }
            pending += 1;
            const writing = writes.then(async () => {
                if (failure !== undefined)
                    throw failure;
                try {
                    const saved = guardRecord(await lease.save(current, bytes), scope);
                    if (!sameGuardBytes(saved.sealed, bytes))
                        throw new Error("The durable finality guard acknowledgement changed its exact sealed bytes.");
                    current = saved;
                }
                catch (error) {
                    failure = error ?? new Error("Finality guard save failed.");
                    this.fail(failure);
                    throw failure;
                }
            }).finally(() => { pending -= 1; });
            writes = writing.then(() => { }, () => { });
            void writing.catch(() => { }); // An ignored caller promise still drains and fails the whole run.
            return writing;
        };
        let value, workError, refused = false;
        try {
            value = await work(current === null ? null : finalityGuardBytes(current.sealed), saveExact);
        }
        catch (error) {
            refused = true;
            workError = error;
        }
        accepting = false;
        await writes;
        if (failure !== undefined)
            throw failure;
        if (refused)
            throw workError; // A durably saved genuine halt is never rolled back by this error.
        return value;
    }
    close() {
        this.#closing = true;
        return this.#closed ??= this.#tail.then(this.#cleanup);
    }
}
/** Web Locks own the real short lease; no timer permits a second owner while work remains. */
export async function finalityBrowserLease(scope, manager) {
    const name = finalityGuardLock(scope);
    let acquired, rejected, unlock;
    const ready = new Promise((yes, no) => { acquired = yes; rejected = no; });
    const held = new Promise((resolve) => { unlock = resolve; });
    let entered = false;
    const running = manager.request(name, { mode: "exclusive", ifAvailable: true }, async (lock) => {
        entered = true;
        if (!lock) {
            rejected(new FinalityGuardBusyError());
            return;
        }
        if (lock.name !== name || lock.mode !== "exclusive") {
            rejected(new Error("The finality guard acquired another scope or a nonexclusive lease."));
            return;
        }
        let released;
        acquired({ release: () => released ??= Promise.resolve().then(() => { unlock(); }).then(() => running) });
        await held;
    });
    void running.then(() => { if (!entered)
        rejected(new Error("The finality guard provider acknowledged no physical lease.")); }, rejected);
    return ready;
}
