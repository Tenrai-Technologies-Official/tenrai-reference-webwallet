import { TenraiWalletError } from "../errors.js";
import { PUBLIC_COIN_U128_MAX } from "./public-coin-store.js";
const ROWS = 262144, PAGES = 40000, PER_ADDRESS = 40;
function fail(message) { throw new TenraiWalletError(message, "rejected"); }
function group(event) {
    const transaction = event.kind === "received" ? event.outpoint.transaction_id : event.transaction_id;
    return transaction === null ? "0:" + event.outpoint.transaction_id + ":" + event.outpoint.output_index : "1:" + transaction;
}
/** Globally requested transactions, with fixed row/work budgets and bounded in-flight pages. */
export class PublicHistory {
    #groups = new Map();
    #rows = 0;
    #worstEntry;
    most;
    constructor(most) {
        this.most = most;
        if (!Number.isSafeInteger(most) || most < 1 || most > 1000)
            fail("History limit must be 1..1000 transactions.");
    }
    #rank(left, right) {
        return right[1].height - left[1].height || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0);
    }
    #worst() {
        if (this.#worstEntry)
            return this.#worstEntry;
        let worst;
        for (const entry of this.#groups)
            if (!worst || this.#rank(entry, worst) > 0)
                worst = entry;
        this.#worstEntry = worst;
        return worst;
    }
    older(height) {
        return this.#groups.size === this.most && height < (this.#worst()?.[1].height ?? 0);
    }
    take(address, event) {
        if (event.kind !== "received" && event.kind !== "spent")
            fail("Invalid history event kind.");
        const id = group(event);
        let entry = this.#groups.get(id);
        if (entry && entry.height !== event.finalized_height)
            fail("A history transaction changed its finalized height.");
        if (!entry) {
            entry = { height: event.finalized_height, rows: new Map(), received: 0n, spent: 0n };
            if (this.#groups.size === this.most) {
                const worst = this.#worst();
                if (!worst)
                    fail("Invalid history collector state.");
                if (this.#rank([id, entry], worst) >= 0)
                    return;
                this.#rows -= worst[1].rows.size;
                this.#groups.delete(worst[0]);
            }
            this.#groups.set(id, entry);
            this.#worstEntry = undefined;
        }
        const key = event.kind + ":" + event.outpoint.transaction_id + ":" + event.outpoint.output_index, old = entry.rows.get(key);
        if (old) {
            if (old.address !== address || old.event.amount !== event.amount || old.event.source !== event.source
                || old.event.transaction_id !== event.transaction_id || old.event.finalized_height !== event.finalized_height)
                fail("Repeated history rows have different immutable facts.");
            return;
        }
        if (this.#rows >= ROWS)
            fail("History exceeds the262144-row budget; request fewer transactions.");
        const amount = BigInt(event.amount);
        if (amount < 0n || amount > PUBLIC_COIN_U128_MAX)
            fail("Invalid history amount.");
        const total = event.kind === "received" ? entry.received + amount : entry.spent + amount;
        if (total > PUBLIC_COIN_U128_MAX)
            fail("History transaction totals overflow u128.");
        if (event.kind === "received")
            entry.received = total;
        else
            entry.spent = total;
        entry.rows.set(key, { address, event });
        this.#rows += 1;
    }
    finish() {
        return [...this.#groups].sort((a, b) => this.#rank(a, b)).flatMap(([, entry]) => [...entry.rows.values()].map(row => row.event));
    }
    get bufferedRows() { return this.#rows; }
    get bufferedTransactions() { return this.#groups.size; }
}
export async function collectPublicHistory(client, addresses, most) {
    if (addresses.length > 10000)
        fail("History exceeds the10000-address limit.");
    const collector = new PublicHistory(most);
    let next = 0, budget = PAGES, stopped = false;
    async function worker() {
        while (!stopped && next < addresses.length) {
            const address = addresses[next++];
            let cursor, previous, complete = false;
            for (let page = 0; page < PER_ADDRESS; page += 1) {
                if (--budget < 0)
                    fail("History page work budget exhausted.");
                const answer = await client.address.history(address, { limit: 256, ...(cursor === undefined ? {} : { cursor }) });
                if (stopped)
                    return;
                if (answer.address !== address || answer.events.length > 256 || answer.events.length === 0 && answer.next_cursor !== null)
                    fail("Invalid history page.");
                for (const event of answer.events) {
                    if (!Number.isSafeInteger(event.finalized_height) || event.finalized_height < 0 || event.finalized_height > answer.indexed_height
                        || previous !== undefined && event.finalized_height > previous)
                        fail("History rows are out of order.");
                    previous = event.finalized_height;
                    if (collector.older(event.finalized_height)) {
                        complete = true;
                        break;
                    }
                    collector.take(address, event);
                }
                if (complete || answer.next_cursor === null) {
                    complete = true;
                    break;
                }
                if (answer.next_cursor === cursor)
                    fail("History cursor did not advance.");
                cursor = answer.next_cursor;
            }
            if (!complete)
                fail("History page budget exhausted; request fewer transactions.");
        }
    }
    const workers = Array.from({ length: Math.min(4, addresses.length) }, () => worker().catch(error => { stopped = true; throw error; }));
    const results = await Promise.allSettled(workers);
    const failed = results.find(row => row.status === "rejected");
    if (failed?.status === "rejected")
        throw failed.reason;
    return collector.finish();
}
