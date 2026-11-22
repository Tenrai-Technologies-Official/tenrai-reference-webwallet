import { indexedDbOutcomeStore } from "./outcome-store.js";
import { TenraiWalletError } from "../errors.js";
/** Owns one provider's cross-instance lease, including writes/POSTs already started at close. */
export class PrivateStoreSession {
    store;
    #ownedOutcomes;
    #lease;
    #stopped = new AbortController();
    closed;
    #resolve;
    #reject;
    #closing = false;
    #releasing = false;
    #active = 0;
    #idle = Promise.resolve();
    #becameIdle = () => { };
    constructor(store, lease) {
        this.#lease = lease;
        const outcomes = store.outcomes ?? (typeof globalThis.indexedDB !== "undefined" ? indexedDbOutcomeStore(store.id) : undefined);
        this.#ownedOutcomes = store.outcomes === undefined ? outcomes : undefined;
        this.closed = new Promise((resolve, reject) => { this.#resolve = resolve; this.#reject = reject; });
        void this.closed.catch(() => { });
        this.store = {
            id: store.id,
            ...(outcomes ? { outcomes } : {}),
            ...(store.inventoryPages ? { inventoryPages: store.inventoryPages } : {}),
            ...(store.localPages ? { localPages: store.localPages } : {}),
            read: (name) => this.run(() => store.read(name)),
            write: (name, bytes) => this.run(() => store.write(name, bytes)),
        };
    }
    static async acquire(store) {
        if (typeof store.id !== "string" || !/^[a-zA-Z0-9:_-]{1,256}$/.test(store.id))
            throw new TenraiWalletError("the private store needs a stable lease-scoped identity", "rejected");
        if (typeof store.acquireSendsLease !== "function")
            throw new TenraiWalletError("the private store must provide an exclusive account-session lease", "rejected");
        const lease = await store.acquireSendsLease();
        if (!lease || typeof lease.release !== "function")
            throw new TenraiWalletError("the private store returned no account-session lease", "invalid");
        return new PrivateStoreSession(store, lease);
    }
    get signal() { return this.#stopped.signal; }
    assertOpen() {
        if (this.#closing)
            throw new TenraiWalletError("the private store session is closed", "rejected");
    }
    async run(work) {
        this.assertOpen();
        if (this.#active === 0)
            this.#idle = new Promise((resolve) => { this.#becameIdle = resolve; });
        this.#active += 1;
        try {
            return await work();
        }
        finally {
            this.#active -= 1;
            if (this.#active === 0)
                this.#becameIdle();
            this.#releaseWhenIdle();
        }
    }
    drained() { return this.#idle; }
    close() {
        if (this.#closing)
            return;
        this.#closing = true;
        this.#stopped.abort(new TenraiWalletError("the private store session closed", "rejected"));
        this.#releaseWhenIdle();
    }
    #releaseWhenIdle() {
        if (!this.#closing || this.#active !== 0 || this.#releasing)
            return;
        this.#releasing = true;
        void Promise.resolve().then(() => { this.#ownedOutcomes?.close?.(); return this.#lease.release(); }).then(this.#resolve, this.#reject);
    }
}
