import { isFinal } from "./status.js";
/** Leaves room below a socket's 64 subscriptions for the cuts all its waiters share. */
const PER_SOCKET = 60;
const STATUS_BATCH = 1_024;
/** With sockets carrying the updates, polling only covers one that went quiet. */
const SOCKET_POLL_MILLIS = 30_000;
/** Every `waitForFinal` of one client: shared sockets for updates, one batched status poll for all. */
export class Waiters {
    #source;
    #waiters = new Set();
    #slots = new Set();
    #height = 0;
    #round = 0;
    #polling = false;
    #again = false;
    #timer;
    constructor(source) {
        this.#source = source;
    }
    /** Calls `settle` once, with a final or expired status; returns the function that stops following. */
    follow(first, validUntil, pollMillis, settle) {
        const waiter = {
            id: first.transaction_id,
            validUntil,
            pollMillis,
            latest: first,
            past: undefined,
            settle,
            unlisten: () => { },
        };
        this.#waiters.add(waiter);
        if (this.#source.open) {
            waiter.unlisten = this.#listen(waiter, this.#source.open);
        }
        if (validUntil === undefined) {
            this.#schedule();
        }
        else {
            void this.#poll();
        }
        return () => this.#drop(waiter);
    }
    #listen(waiter, open) {
        let slot = [...this.#slots].find((entry) => entry.waiters < PER_SOCKET);
        if (!slot) {
            slot = { live: open(), waiters: 0 };
            this.#slots.add(slot);
        }
        const held = slot;
        const subscriptions = [
            held.live.subscribe({
                topic: "transaction",
                transactionId: waiter.id,
                onEvent: (event) => {
                    if (event.data.transaction_id !== waiter.id) {
                        return;
                    }
                    waiter.latest = event.data;
                    if (isFinal(event.data)) {
                        this.#settle(waiter, event.data);
                    }
                },
                onResync: () => void this.#poll(),
                onError: () => void this.#poll(),
            }),
        ];
        if (waiter.validUntil !== undefined) {
            subscriptions.push(held.live.subscribe({ topic: "cuts", onEvent: (event) => this.#seen(event.data.cut.height), onError: () => { } }));
        }
        held.waiters += 1;
        return () => {
            for (const subscription of subscriptions) {
                subscription.close();
            }
            held.waiters -= 1;
            if (held.waiters === 0) {
                this.#slots.delete(held);
                held.live.close();
            }
        };
    }
    #drop(waiter) {
        if (!this.#waiters.delete(waiter)) {
            return;
        }
        waiter.unlisten();
        if (this.#waiters.size === 0) {
            clearTimeout(this.#timer);
            this.#timer = undefined;
        }
    }
    #settle(waiter, status) {
        if (this.#waiters.has(waiter)) {
            this.#drop(waiter);
            waiter.settle(status);
        }
    }
    #seen(height) {
        this.#height = Math.max(this.#height, height);
        let crossed = false;
        for (const waiter of this.#waiters) {
            if (waiter.past === undefined && waiter.validUntil !== undefined && this.#height > waiter.validUntil) {
                waiter.past = this.#round;
                crossed = true;
            }
        }
        if (crossed) {
            void this.#poll();
        }
    }
    async #poll() {
        if (this.#polling) {
            this.#again = true;
            return;
        }
        if (this.#waiters.size === 0) {
            return;
        }
        this.#polling = true;
        this.#again = false;
        clearTimeout(this.#timer);
        this.#timer = undefined;
        this.#round += 1;
        const round = this.#round;
        const waiters = [...this.#waiters];
        const ids = [...new Set(waiters.map((waiter) => waiter.id))];
        const parts = Array.from({ length: Math.ceil(ids.length / STATUS_BATCH) }, (_, index) => ids.slice(index * STATUS_BATCH, (index + 1) * STATUS_BATCH));
        const bounded = waiters.some((waiter) => waiter.validUntil !== undefined);
        const [batches, head] = await Promise.allSettled([
            Promise.all(parts.map((part) => this.#source.statuses(part))),
            bounded ? this.#source.head() : Promise.resolve(undefined),
        ]);
        this.#polling = false;
        const known = new Map();
        const unknown = new Set();
        for (const batch of batches.status === "fulfilled" ? batches.value : []) {
            for (const status of batch.statuses) {
                known.set(status.transaction_id, status);
            }
            for (const id of batch.unknown) {
                unknown.add(id);
            }
        }
        for (const waiter of waiters) {
            const status = known.get(waiter.id);
            if (status) {
                waiter.latest = status;
            }
            if (isFinal(waiter.latest)) {
                this.#settle(waiter, waiter.latest);
            }
            else if (waiter.past !== undefined && waiter.past < round && (status || unknown.has(waiter.id))) {
                this.#settle(waiter, expired(waiter.latest));
            }
        }
        if (head.status === "fulfilled" && head.value) {
            this.#seen(head.value.height);
        }
        if (this.#again) {
            void this.#poll();
        }
        else {
            this.#schedule();
        }
    }
    #schedule() {
        if (this.#polling || this.#timer !== undefined || this.#waiters.size === 0) {
            return;
        }
        const every = this.#source.open
            ? SOCKET_POLL_MILLIS
            : Math.min(...[...this.#waiters].map((waiter) => waiter.pollMillis));
        this.#timer = setTimeout(() => {
            this.#timer = undefined;
            void this.#poll();
        }, every);
    }
}
/** How a transaction ends that the chain can no longer execute: failed, with the node's reason or `expired`. */
function expired(status) {
    if (status.lifecycle === "failed") {
        return status;
    }
    return { ...status, lifecycle: "failed", finalized_cut: null, failure: "expired" };
}
