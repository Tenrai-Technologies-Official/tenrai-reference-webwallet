import { TenraiApiError, TenraiWalletError } from "../errors.js";
import {} from "./funds.js";
import { PUBLIC_COIN_U128_MAX, publicCoin, publicCoinCursor } from "./public-coin-store.js";
const PAGE = 256;
function fail(message) { throw new TenraiWalletError(message, "rejected"); }
function safe(value) { return Number.isSafeInteger(value) && value >= 0; }
function fromRecord(address, row) {
    return publicCoin({ address, transactionId: row.outpoint.transaction_id, outputIndex: row.outpoint.output_index,
        amount: BigInt(row.amount), height: row.created_finalized_height });
}
/** One complete advisory generation, updated under its owner's operation lease. */
export class PublicCoinInventory {
    #ready = false;
    #closed = false;
    #closing;
    #height = 0;
    #heads = new Map();
    store;
    held;
    addresses;
    cancelled;
    constructor(store, held, addresses = [], cancelled = () => false) {
        this.store = store;
        this.held = held;
        this.addresses = addresses;
        this.cancelled = cancelled;
    }
    get finalizedHeight() { this.#assert(); return this.#height; }
    static async open(client, found, factory, held, eventLimit, cancelled = () => false) {
        if (!Number.isSafeInteger(eventLimit) || eventLimit < 1)
            fail("Choose a finite positive publicCoinEventLimit.");
        if (!Array.isArray(found.observed) || !found.observed.length || found.observed.length > 10_000)
            fail("A public scan must identify every observed address head.");
        const heads = new Map();
        for (const entry of found.observed) {
            if (typeof entry.address !== "string" || heads.has(entry.address) || !safe(entry.height))
                fail("Invalid public address observations.");
            heads.set(entry.address, entry.height);
        }
        const inventory = new PublicCoinInventory(await factory(), held, [], cancelled);
        try {
            const budget = { remaining: eventLimit }, addresses = found.held.map(entry => entry.address), funded = new Set();
            for (const entry of found.held) {
                if (!heads.has(entry.address) || funded.has(entry.address))
                    fail("Public funding summaries do not match the complete address observations.");
                funded.add(entry.address);
            }
            const incomplete = new Set(addresses);
            const maintain = async (target) => {
                for (const [address, after] of heads) {
                    if (incomplete.has(address) || target - after < 4096)
                        continue;
                    await inventory.#advance(client, address, after, target, budget);
                    heads.set(address, target);
                }
            };
            for (let at = 0; at < addresses.length; at += 64) {
                inventory.#building();
                const group = addresses.slice(at, at + 64), expected = new Set(group), batch = await client.address.utxoBatch(group);
                if (!safe(batch.indexed_height) || batch.addresses.length !== group.length)
                    fail("Invalid public UTXO batch coverage.");
                for (const entry of batch.addresses) {
                    if (!expected.delete(entry.address) || entry.utxos.length > PAGE || batch.indexed_height < heads.get(entry.address))
                        fail("Invalid public UTXO batch.");
                    if (entry.truncated) {
                        const height = await inventory.#read(client, entry.address, budget, maintain);
                        if (height < heads.get(entry.address) || height < batch.indexed_height)
                            fail("The public history index moved behind its balance observation or UTXO batch.");
                        heads.set(entry.address, height);
                        incomplete.delete(entry.address);
                        await maintain(height);
                        continue;
                    }
                    const rows = entry.utxos.map(value => fromRecord(entry.address, value));
                    if (rows.some(row => row.height > batch.indexed_height))
                        fail("A public UTXO was created after its batch.");
                    await inventory.store.putPage(rows);
                    heads.set(entry.address, batch.indexed_height);
                    incomplete.delete(entry.address);
                    await maintain(batch.indexed_height);
                }
            }
            let target = 0;
            for (const height of heads.values())
                target = Math.max(target, height);
            // Every address, including one whose earlier balance was zero, reaches the same fixed cut.
            // Ignore later events instead of chasing a moving global head during a cold scan.
            for (const [address, after] of heads) {
                if (after === target)
                    continue;
                await inventory.#advance(client, address, after, target, budget);
            }
            await inventory.#publish(target, heads);
            return inventory;
        }
        catch (cause) {
            await inventory.close().catch(() => { });
            throw cause;
        }
    }
    /** Reconcile retained holdings through finite history; only newly discovered addresses need a base walk. */
    async refresh(client, found, eventLimit) {
        this.#assert();
        this.#ready = false;
        if (!Number.isSafeInteger(eventLimit) || eventLimit < 1)
            fail("Choose a finite positive publicCoinEventLimit.");
        const heads = new Map(this.#heads), observed = new Map(), funded = new Set();
        for (const row of found.observed) {
            if (typeof row.address !== "string" || observed.has(row.address) || !safe(row.height))
                fail("Invalid public address observations.");
            observed.set(row.address, row.height);
        }
        if (!observed.size || observed.size > 10_000)
            fail("Invalid public address observation coverage.");
        for (const row of found.held) {
            if (!observed.has(row.address) || funded.has(row.address))
                fail("Public funding summaries do not match address observations.");
            funded.add(row.address);
        }
        const fresh = [...observed.keys()].filter(address => !heads.has(address)), incomplete = new Set(fresh.filter(address => funded.has(address)));
        if (heads.size + fresh.length > 10_000)
            fail("The retained public cache exceeds the tracked-address limit.");
        for (const address of fresh)
            if (!funded.has(address))
                heads.set(address, observed.get(address));
        const budget = { remaining: eventLimit }, maintain = async (target) => {
            for (const [address, after] of heads) {
                if (incomplete.has(address) || target - after < 4096)
                    continue;
                await this.#advance(client, address, after, target, budget);
                heads.set(address, target);
            }
        };
        const base = fresh.filter(address => funded.has(address));
        for (let at = 0; at < base.length; at += 64) {
            this.#building();
            const group = base.slice(at, at + 64), expected = new Set(group), batch = await client.address.utxoBatch(group);
            if (!safe(batch.indexed_height) || batch.addresses.length !== group.length)
                fail("Invalid public UTXO batch coverage.");
            for (const entry of batch.addresses) {
                if (!expected.delete(entry.address) || entry.utxos.length > PAGE || batch.indexed_height < observed.get(entry.address))
                    fail("Invalid new public address snapshot.");
                let height = batch.indexed_height;
                if (entry.truncated)
                    height = await this.#read(client, entry.address, budget, maintain);
                else {
                    const rows = entry.utxos.map(row => fromRecord(entry.address, row));
                    if (rows.some(row => row.height > height))
                        fail("A public UTXO was created after its batch.");
                    await this.store.clearAddress(entry.address);
                    await this.store.putPage(rows);
                }
                if (height < batch.indexed_height)
                    fail("A public base snapshot moved backwards.");
                heads.set(entry.address, height);
                incomplete.delete(entry.address);
                await maintain(height);
            }
        }
        let target = this.#height;
        for (const height of [...heads.values(), ...observed.values()])
            target = Math.max(target, height);
        for (const [address, after] of heads)
            if (after < target)
                await this.#advance(client, address, after, target, budget);
        await this.#publish(target, heads);
    }
    async #publish(target, heads) {
        const counts = new Map();
        let amount = 0n, count = 0, after;
        for (;;) {
            this.#building();
            const page = await this.store.page({ limit: PAGE, ...(after === undefined ? {} : { after }) });
            for (const row of page.coins) {
                if (!heads.has(row.address) || row.height > target)
                    fail("A cached public coin is outside the completed account cohort.");
                amount = checkedCoinTotal(amount, row.amount);
                if (!Number.isSafeInteger(++count))
                    fail("Public output count overflow.");
                const n = (counts.get(row.address) ?? 0) + 1;
                if (!Number.isSafeInteger(n))
                    fail("Public address output count overflow.");
                counts.set(row.address, n);
            }
            if (page.nextAfter === null)
                break;
            if (after !== undefined && page.nextAfter <= after)
                fail("The public coin cache cursor did not advance.");
            after = page.nextAfter;
        }
        this.addresses.splice(0);
        this.#heads.clear();
        for (const address of heads.keys()) {
            this.addresses.push({ address, utxos: counts.get(address) ?? 0 });
            this.#heads.set(address, target);
        }
        this.#height = target;
        this.#ready = true;
    }
    #building() { if (this.#closed || this.cancelled())
        fail("The public coin scan was cancelled."); }
    #assert() { this.#building(); if (!this.#ready || this.#closed)
        fail("The public coin inventory is incomplete; reopen and rescan before spending."); }
    close() {
        if (!this.#closing) {
            this.#closed = true;
            this.#ready = false;
            this.#closing = this.store.close();
            void this.#closing.catch(() => { });
        }
        return this.#closing;
    }
    async get(key) {
        this.#assert();
        const match = /^([0-9a-f]{96}):(0|[1-9][0-9]*)$/.exec(key);
        if (!match || Number(match[2]) > 0xffff_ffff)
            fail("Invalid public outpoint.");
        return this.store.get(match[1] + Number(match[2]).toString(16).padStart(8, "0"));
    }
    async visit(take) {
        this.#assert();
        let after;
        for (;;) {
            const page = await this.store.page({ ...(after === undefined ? {} : { after }), limit: PAGE });
            for (const coin of page.coins) {
                if (!this.held(coin) && take(coin) === false)
                    return;
            }
            if (page.nextAfter === null)
                return;
            if (after !== undefined && page.nextAfter <= after)
                fail("The local public coin cursor did not advance.");
            after = page.nextAfter;
        }
    }
    async largest(limit, address) {
        this.#assert();
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 512)
            fail("A public selection window is at most 512 outputs.");
        const rows = [];
        let after;
        for (;;) {
            const page = await this.store.largestPage({ limit: PAGE, ...(after === undefined ? {} : { after }), ...(address === undefined ? {} : { address }) });
            for (const row of page.coins)
                if (!this.held(row)) {
                    rows.push(row);
                    if (rows.length === limit)
                        return rows;
                }
            if (page.nextAfter === null)
                return rows;
            after = page.nextAfter;
        }
    }
    async consolidation(above = 1) {
        this.#assert();
        const rows = [];
        for (const entry of this.addresses) {
            if (entry.utxos <= above)
                continue;
            const group = await this.largest(Math.min(512 - rows.length, 512), entry.address);
            if (group.length > 1)
                rows.push(...group);
            if (rows.length >= 511)
                break;
        }
        return rows;
    }
    async page(query = {}) {
        this.#assert();
        return this.store.page(query);
    }
    async #read(client, address, budget, maintain) {
        this.#building();
        await this.store.clearAddress(address);
        let page = await client.address.utxos(address, { limit: PAGE }), anchor = page.anchor, last, pages = 0;
        let watermark = anchor.height;
        for (;;) {
            this.#building();
            if (page.address !== address || !safe(page.anchor.height) || page.utxos.length > PAGE)
                fail("Invalid public UTXO page.");
            if (page.anchor.height < anchor.height || page.anchor.height === anchor.height
                && (page.anchor.cut_id !== anchor.cut_id || page.anchor.state_root !== anchor.state_root))
                fail("The public UTXO anchor moved backwards or conflicted.");
            anchor = page.anchor;
            const rows = page.utxos.map(row => fromRecord(address, row));
            if (!rows.length && page.next_cursor !== null)
                fail("An empty public UTXO page cannot advance.");
            for (const row of rows) {
                const key = publicCoinCursor(row);
                if (last !== undefined && key <= last)
                    fail("Public UTXOs repeat or go backwards.");
                last = key;
                if (row.height > anchor.height)
                    fail("A public UTXO was created after its page anchor.");
            }
            await this.store.putPage(rows);
            pages++;
            if (pages >= 64 || anchor.height - watermark >= 64) {
                await this.#advance(client, address, watermark, anchor.height, budget);
                watermark = anchor.height;
                pages = 0;
                await maintain(anchor.height);
            }
            if (page.next_cursor === null)
                break;
            if (last === undefined)
                fail("A moving page has no validated last outpoint.");
            page = await client.address.utxos(address, { after: last, limit: PAGE });
        }
        await this.#advance(client, address, watermark, anchor.height, budget);
        return anchor.height;
    }
    async #advance(client, address, after, target, budget) {
        if (!safe(after) || !safe(target) || target < after)
            fail("Invalid public history range.");
        if (target === after)
            return;
        let cursor, previous;
        for (;;) {
            this.#building();
            let page;
            try {
                page = await client.address.historyRange(address, after, target, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) });
            }
            catch (error) {
                if (error instanceof TenraiApiError && error.status === 404 && error.reason === "history_not_held")
                    fail("The complete public history range is unavailable; the partial cache cannot be spent.");
                throw error;
            }
            if (page.address !== address || !safe(page.indexed_height) || page.indexed_height < target
                || !safe(page.history_from) || page.history_from > after + 1 || page.events.length > PAGE)
                fail("Public history no longer covers this complete range.");
            if (!page.events.length && page.next_cursor !== null)
                fail("An empty public event page cannot advance.");
            const puts = [], removes = [];
            const flushPuts = async () => { if (puts.length) {
                await this.store.putPage(puts.splice(0));
            } };
            const flushRemoves = async () => { if (removes.length) {
                await this.store.removePage(removes.splice(0));
            } };
            for (const event of page.events) {
                if (--budget.remaining < 0)
                    fail("Public history exceeds the explicit event limit.");
                const kind = event.kind === "received" ? 0 : event.kind === "spent" ? 1 : fail("Invalid public event kind.");
                const row = fromRecord(address, { outpoint: event.outpoint, amount: event.amount, created_finalized_height: event.finalized_height, source: event.source });
                const key = publicCoinCursor(row), order = [event.finalized_height, kind, key];
                if (!safe(order[0]) || order[0] <= after || order[0] > target || previous &&
                    (order[0] < previous[0] || order[0] === previous[0] && (order[1] < previous[1] || order[1] === previous[1] && order[2] <= previous[2])))
                    fail("Forward public history is outside its range or out of order.");
                previous = order;
                if (kind === 0) {
                    await flushRemoves();
                    puts.push(row);
                }
                else {
                    await flushPuts();
                    const known = await this.store.get(key);
                    if (known && known.address !== address)
                        fail("Public spend belongs to another cached address.");
                    removes.push(key);
                }
            }
            await flushPuts();
            await flushRemoves();
            if (page.next_cursor === null)
                return;
            if (page.next_cursor === cursor)
                fail("The finite public history cursor did not advance.");
            cursor = page.next_cursor;
        }
    }
}
export function checkedCoinTotal(total, amount) {
    const next = total + amount;
    if (amount < 0n || next > PUBLIC_COIN_U128_MAX)
        fail("Public coin amounts overflow u128.");
    return next;
}
