import { addresses as checkAddresses, hash384 } from "../validate.js";
import { invoke } from "./socket.js";
const MAX_SUBSCRIPTIONS = 64;
const MAX_ADDRESSES_PER_SUBSCRIPTION = 64;
const MAX_ADDRESSES = 512;
const MAX_RESUBSCRIBE_MILLIS = 30_000;
/** The subscriptions of one `/v1/ws` socket; equal ones share a group and one subscription on the server. */
export class Subscriptions {
    #link;
    #groups = new Map();
    #byServer = new Map();
    constructor(link) {
        this.#link = link;
    }
    add(options) {
        const given = options;
        const transactionId = options.topic === "transaction" ? hash384(given.transactionId ?? "", "transactionId") : undefined;
        const addresses = options.topic === "addresses"
            ? [...new Set(checkAddresses(given.addresses ?? [], MAX_ADDRESSES_PER_SUBSCRIPTION))].sort()
            : undefined;
        const key = [options.topic, transactionId ?? "", ...(addresses ?? [])].join(" ");
        const group = this.#groups.get(key) ?? this.#create(key, options.topic, transactionId, addresses);
        const subscriber = {
            onEvent: options.onEvent,
            onResync: options.onResync,
            onError: options.onError,
        };
        group.subscribers.add(subscriber);
        const latest = group.latest;
        if (latest !== undefined) {
            queueMicrotask(() => {
                if (group.subscribers.has(subscriber)) {
                    invoke(subscriber.onEvent, latest);
                }
            });
        }
        return { topic: group.topic, close: () => this.#leave(group, subscriber) };
    }
    /** Subscribes every group the server does not hold, after the socket opened. */
    renew(reopened) {
        for (const group of this.#groups.values()) {
            if (group.server === undefined && group.pending === undefined) {
                this.#subscribe(group, reopened);
            }
        }
    }
    /** The socket closed, and with it every subscription on the server. */
    reset() {
        this.#byServer.clear();
        for (const group of this.#groups.values()) {
            clearTimeout(group.retry);
            group.retry = undefined;
            group.server = undefined;
            group.pending = undefined;
            if (group.subscribers.size === 0) {
                this.#groups.delete(group.key);
            }
        }
    }
    clear() {
        this.reset();
        this.#groups.clear();
    }
    subscribed(group, subscription, resync) {
        group.pending = undefined;
        if (group.subscribers.size === 0 || this.#groups.get(group.key) !== group) {
            if (this.#groups.get(group.key) === group) {
                this.#groups.delete(group.key);
            }
            this.#link.send({ type: "unsubscribe", data: { id: this.#link.nextId(), subscription } });
            return;
        }
        group.server = subscription;
        group.attempts = 0;
        this.#byServer.set(subscription, group);
        if (resync) {
            this.#tell(group, "stream_restarted");
        }
    }
    refused(group, error) {
        group.pending = undefined;
        if (this.#groups.get(group.key) !== group) {
            return;
        }
        if (group.subscribers.size === 0) {
            this.#groups.delete(group.key);
            return;
        }
        if (error.retryable) {
            const delay = Math.min(MAX_RESUBSCRIBE_MILLIS, Math.max(error.retryAfterMillis ?? 0, 1_000 * 2 ** group.attempts));
            group.attempts += 1;
            group.retry = setTimeout(() => {
                group.retry = undefined;
                if (this.#groups.get(group.key) === group && group.server === undefined && group.pending === undefined) {
                    this.#subscribe(group, true);
                }
            }, delay);
            return;
        }
        this.#groups.delete(group.key);
        let unheard = false;
        for (const subscriber of [...group.subscribers]) {
            if (subscriber.onError) {
                invoke(subscriber.onError, error);
            }
            else {
                unheard = true;
            }
        }
        if (unheard) {
            this.#link.report(error);
        }
    }
    notify(subscription, event) {
        const group = this.#byServer.get(subscription);
        if (!group) {
            return;
        }
        if (group.topic === "transaction") {
            group.latest = event;
        }
        for (const subscriber of [...group.subscribers]) {
            invoke(subscriber.onEvent, event);
        }
    }
    resync(subscription, reason) {
        const group = this.#byServer.get(subscription);
        if (!group) {
            return;
        }
        this.#tell(group, reason);
        if (group.topic === "transaction") {
            // A node stops a transaction watch after a resync; a new subscribe starts one with the current status.
            this.#byServer.delete(subscription);
            group.server = undefined;
            this.#link.send({ type: "unsubscribe", data: { id: this.#link.nextId(), subscription } });
            this.#subscribe(group, false);
        }
    }
    #create(key, topic, transactionId, addresses) {
        if (this.#groups.size >= MAX_SUBSCRIPTIONS) {
            throw new RangeError(`one socket holds at most ${MAX_SUBSCRIPTIONS} subscriptions`);
        }
        const watched = [...this.#groups.values()].reduce((total, group) => total + (group.addresses?.length ?? 0), 0);
        if (watched + (addresses?.length ?? 0) > MAX_ADDRESSES) {
            throw new RangeError(`one socket watches at most ${MAX_ADDRESSES} addresses`);
        }
        const group = {
            key,
            topic,
            transactionId,
            addresses,
            subscribers: new Set(),
            server: undefined,
            pending: undefined,
            retry: undefined,
            attempts: 0,
            latest: undefined,
        };
        this.#groups.set(key, group);
        this.#subscribe(group, false);
        return group;
    }
    /** A group whose subscribe is unanswered stays until the answer, so an equal subscribe can still join it. */
    #leave(group, subscriber) {
        if (!group.subscribers.delete(subscriber) || group.subscribers.size > 0 || this.#groups.get(group.key) !== group) {
            return;
        }
        clearTimeout(group.retry);
        group.retry = undefined;
        if (group.server !== undefined) {
            this.#byServer.delete(group.server);
            this.#link.send({ type: "unsubscribe", data: { id: this.#link.nextId(), subscription: group.server } });
            this.#groups.delete(group.key);
        }
        else if (group.pending === undefined) {
            this.#groups.delete(group.key);
        }
    }
    #subscribe(group, resync) {
        const id = this.#link.expect(group, resync);
        const data = { id, topic: group.topic };
        if (group.transactionId !== undefined) {
            data.transaction_id = group.transactionId;
        }
        if (group.addresses !== undefined) {
            data.addresses = group.addresses;
        }
        if (this.#link.send({ type: "subscribe", data })) {
            group.pending = id;
        }
        else {
            this.#link.forget(id);
        }
    }
    #tell(group, reason) {
        for (const subscriber of [...group.subscribers]) {
            if (subscriber.onResync) {
                invoke(subscriber.onResync, reason);
            }
        }
    }
}
