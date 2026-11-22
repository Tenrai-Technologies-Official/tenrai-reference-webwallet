import { publicCoin, publicCoinCursor, samePublicCoin, PUBLIC_COIN_U128_MAX } from "./public-coin-store.js";
const PAGE = 256, MAINTENANCE = 4096;
const safe = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const hash = (value) => typeof value === "string" && /^[0-9a-f]{96}$/.test(value);
const point = (value) => typeof value === "string" && /^[0-9a-f]{104}$/.test(value);
function fail(message) { throw new Error(message); }
function checked(amount) {
    if (amount < 0n || amount > PUBLIC_COIN_U128_MAX)
        fail("Public cache amount overflow.");
    return amount;
}
function initial() {
    return { version: 1, addresses: [], mode: "scan", scanIndex: 0, base: null, maintenance: null, range: null, target: 0, cohortIndex: 0,
        height: 0, maxObserved: 0, atoms: "0", coins: 0 };
}
function decoded(text) {
    const value = JSON.parse(text);
    if (value?.version !== 1 || !Array.isArray(value.addresses) || value.addresses.length > 10000
        || !["scan", "cohort", "ready"].includes(value.mode) || !safe(value.scanIndex) || !safe(value.cohortIndex)
        || !safe(value.target) || !safe(value.height) || !safe(value.maxObserved) || !safe(value.coins)
        || typeof value.atoms !== "string" || !/^(0|[1-9][0-9]*)$/.test(value.atoms))
        fail("Invalid resumable public checkpoint.");
    checked(BigInt(value.atoms));
    let amount = 0n, coins = 0;
    const names = new Set();
    for (const row of value.addresses) {
        if (typeof row.address !== "string" || row.address.length < 1 || row.address.length > 128 || names.has(row.address) || !["receive", "change"].includes(row.branch)
            || !safe(row.index) || row.index > 0x7fffffff || !safe(row.height) || row.completeHeight !== null && !safe(row.completeHeight)
            || typeof row.used !== "boolean" || typeof row.funded !== "boolean" || !safe(row.coins)
            || typeof row.atoms !== "string" || !/^(0|[1-9][0-9]*)$/.test(row.atoms))
            fail("Invalid saved public address.");
        names.add(row.address);
        amount = checked(amount + BigInt(row.atoms));
        coins += row.coins;
        if (!Number.isSafeInteger(coins))
            fail("Public cache count overflow.");
    }
    if (amount !== BigInt(value.atoms) || coins !== value.coins)
        fail("Saved public totals disagree.");
    if (value.base) {
        const base = value.base;
        if (!safe(base.index) || base.index >= value.addresses.length || base.after !== null && !point(base.after)
            || !safe(base.pages) || base.pages > 64 || typeof base.eof !== "boolean"
            || base.watermark !== null && !safe(base.watermark))
            fail("Invalid saved public base cursor.");
        if (base.anchor && (!safe(base.anchor.height) || !hash(base.anchor.cutId) || !hash(base.anchor.stateRoot)))
            fail("Invalid saved public anchor.");
    }
    if (value.maintenance && (!safe(value.maintenance.target) || !safe(value.maintenance.nextIndex) || value.maintenance.nextIndex > value.addresses.length))
        fail("Invalid saved public maintenance cursor.");
    if (value.range) {
        const range = value.range;
        if (!Array.isArray(range.entries) || !range.entries.length || range.entries.length > 64 || !safe(range.target)
            || !safe(range.completed) || range.completed > range.entries.length || !["own", "maintenance", "cohort"].includes(range.reason)
            || range.cursor !== null && (typeof range.cursor !== "string" || !/^[0-9a-f]{224}$/.test(range.cursor)))
            fail("Invalid saved public history cursor.");
        const seen = new Set();
        for (const row of range.entries) {
            if (!safe(row.index) || row.index >= value.addresses.length || seen.has(row.index) || !safe(row.after) || row.after > range.target)
                fail("Invalid saved public range.");
            seen.add(row.index);
        }
        if (range.last && (!Array.isArray(range.last) || range.last.length !== 4 || !safe(range.last[0]) || range.last[0] >= range.entries.length
            || !safe(range.last[1]) || ![0, 1].includes(range.last[2]) || !point(range.last[3])))
            fail("Invalid saved public history order.");
    }
    const count = value.addresses.length;
    if (!count || value.scanIndex > count || value.cohortIndex > count || value.height > value.maxObserved
        || value.mode === "ready" && (value.height !== value.target || value.maxObserved !== value.target)
        || value.mode !== "scan" && value.base !== null || value.mode === "scan" && value.base && value.base.index !== value.scanIndex)
        fail("Saved public scan phases disagree.");
    for (const row of value.addresses) {
        if (row.completeHeight !== null && row.completeHeight > value.maxObserved
            || (row.coins === 0) !== (row.atoms === "0") || BigInt(row.coins) > BigInt(row.atoms))
            fail("Saved public address counters or coverage disagree.");
    }
    if (value.base) {
        const base = value.base;
        if (value.addresses[base.index].completeHeight !== null
            || (base.anchor === null) !== (base.watermark === null)
            || base.anchor && base.watermark > base.anchor.height
            || base.anchor && base.anchor.height > value.maxObserved
            || !base.anchor && (base.after !== null || base.pages !== 0 || base.eof)
            || (base.eof || base.pages === 64) && value.range?.reason !== "own")
            fail("Saved public base coverage disagrees.");
    }
    if (value.range) {
        const range = value.range;
        if (range.target > value.maxObserved || range.completed === range.entries.length
            || range.reason === "own" && (!value.base || range.entries.length !== 1 || range.entries[0].index !== value.base.index
                || range.entries[0].after !== value.base.watermark || range.target !== value.base.anchor?.height)
            || range.reason === "maintenance" && !value.maintenance
            || range.reason === "cohort" && (value.mode !== "cohort" || range.target !== value.target)
            || range.last && (range.last[0] > range.completed || range.last[1] <= range.entries[range.last[0]].after || range.last[1] > range.target))
            fail("Saved public range phases disagree.");
    }
    if (value.mode === "ready" && (value.base || value.range || value.maintenance || value.addresses.some(row => row.completeHeight !== value.height)))
        fail("Incomplete public cache cannot be ready.");
    return value;
}
/** Only authenticated-cache path hints; callers re-derive ownership and fetch fresh balance heads. */
export function publicCoinRecoveryObservations(checkpoint) {
    const state = decoded(checkpoint.progress);
    if (state.coins !== checkpoint.coinCount || state.atoms !== checkpoint.totalAtoms)
        fail("Saved public cache counters disagree.");
    return state.addresses.map(row => ({ address: row.address, branch: row.branch, index: row.index, height: row.height,
        funded: row.funded || row.coins > 0, used: row.used || row.coins > 0 }));
}
export class PublicCoinHistoryGap extends Error {
    tracked;
    constructor(tracked) { super("The complete public history interval is no longer held."); this.tracked = tracked; }
}
/** Durable page progress is advisory; only a completed cohort is exposed to planners. */
export class ResumableCoinInventory {
    #store;
    #codec;
    #source;
    #state;
    #checkpoint = null;
    #held;
    #cancelled;
    #restore;
    #budget;
    #ready = false;
    #closed = false;
    #broken = false;
    #closing;
    #index = new Map();
    constructor(source, store, codec, held, restore, budget, cancelled) {
        if (!safe(budget) || budget < 1)
            fail("Choose a positive finite public coin event budget.");
        this.#source = source;
        this.#store = store;
        this.#codec = codec;
        this.#held = held;
        this.#restore = restore;
        this.#budget = budget;
        this.#cancelled = cancelled;
        this.#state = initial();
    }
    static async open(source, observed, store, codec, held, restore, budget = 200065536, cancelled = () => false, reset = false) {
        const inventory = new ResumableCoinInventory(source, store, codec, held, restore, budget, cancelled);
        try {
            const checkpoint = reset ? null : await store.recover(codec);
            inventory.#live();
            if (checkpoint) {
                inventory.#state = decoded(checkpoint.progress);
                inventory.#checkpoint = checkpoint;
                inventory.#stats(checkpoint);
                for (const row of inventory.#state.addresses)
                    restore(row);
            }
            inventory.#merge(observed);
            if (!checkpoint) {
                const progress = JSON.stringify(inventory.#state), created = await store.reset(progress, codec);
                if (created.progress !== progress || !/^[0-9a-f]{32}$/.test(created.generation))
                    fail("The initial public checkpoint ACK changed its state.");
                inventory.#stats(created);
                inventory.#checkpoint = created;
            }
            else
                await inventory.#save([]);
            await inventory.#drive();
            return inventory;
        }
        catch (error) {
            await inventory.close().catch(() => { });
            if (error instanceof PublicCoinHistoryGap)
                throw error;
            throw new Error("Public coin recovery is incomplete; retry the node or explicitly rebuild this account's advisory coin cache.", { cause: error });
        }
    }
    #live() { if (this.#closed || this.#broken || this.#cancelled())
        fail("The resumable public scan closed or was interrupted."); }
    #complete() { this.#live(); if (!this.#ready || this.#state.mode !== "ready")
        fail("The public coin cohort is incomplete."); }
    get finalizedHeight() { this.#complete(); return this.#state.height; }
    get addresses() { this.#complete(); return this.#state.addresses.map(row => ({ address: row.address, utxos: row.coins })); }
    summaries() { this.#complete(); return this.#state.addresses.map(row => ({ address: row.address, atoms: BigInt(row.atoms), outputs: row.coins })); }
    #stats(checkpoint) {
        if (checkpoint.coinCount !== this.#state.coins || checkpoint.totalAtoms !== this.#state.atoms)
            fail("Authenticated public cache counters disagree.");
    }
    #merge(observed) {
        this.#ready = false;
        if (!observed.length || observed.length > 10000)
            fail("A public scan must name every tracked address.");
        this.#index.clear();
        this.#state.addresses.forEach((row, index) => this.#index.set(row.address, index));
        const seen = new Set();
        for (const value of observed) {
            if (typeof value.address !== "string" || value.address.length < 1 || value.address.length > 128 || seen.has(value.address) || !safe(value.index) || value.index > 0x7fffffff
                || !["receive", "change"].includes(value.branch) || !safe(value.height) || typeof value.funded !== "boolean" || typeof value.used !== "boolean")
                fail("Invalid current public address observation.");
            seen.add(value.address);
            this.#restore(value);
            this.#state.maxObserved = Math.max(this.#state.maxObserved, value.height);
            const at = this.#index.get(value.address);
            if (at === undefined) {
                if (this.#state.addresses.length >= 10000)
                    fail("The public wallet exceeds10000 tracked addresses.");
                if (value.funded && this.#state.mode === "cohort") {
                    this.#state.mode = "scan";
                    this.#state.scanIndex = 0;
                    if (this.#state.range?.reason === "cohort") {
                        this.#state.range.reason = "maintenance";
                        this.#state.maintenance = { target: this.#state.range.target, nextIndex: this.#state.addresses.length };
                    }
                }
                this.#index.set(value.address, this.#state.addresses.length);
                this.#state.addresses.push({ ...value, completeHeight: value.funded ? null : value.height, atoms: "0", coins: 0 });
            }
            else {
                const row = this.#state.addresses[at];
                if (row.index !== value.index || row.branch !== value.branch)
                    fail("A cached address changed derivation path.");
                row.height = Math.max(row.height, value.height);
                row.used ||= value.used;
                row.funded ||= value.funded;
            }
        }
        if (this.#state.mode === "ready") {
            this.#state.mode = "scan";
            this.#state.scanIndex = 0;
        }
    }
    async refresh(observed, budget = 200065536) {
        this.#complete();
        if (!safe(budget) || budget < 1)
            fail("Choose a positive finite public coin event budget.");
        this.#budget = budget;
        try {
            this.#merge(observed);
            await this.#save([]);
            await this.#drive();
        }
        catch (error) {
            this.#ready = false;
            this.#broken = true;
            throw error;
        }
    }
    async #save(mutations) {
        this.#live();
        if (mutations.length > PAGE)
            fail("A resumable public mutation page exceeds256 events.");
        const overlay = new Map();
        const adjust = (address, amount, count) => {
            const at = this.#index.get(address);
            if (at === undefined)
                fail("A cached public coin belongs to an untracked address.");
            const row = this.#state.addresses[at];
            row.atoms = checked(BigInt(row.atoms) + amount).toString();
            row.coins += count;
            this.#state.atoms = checked(BigInt(this.#state.atoms) + amount).toString();
            this.#state.coins += count;
            if (!safe(row.coins) || !safe(this.#state.coins))
                fail("Public cache count underflow or overflow.");
        };
        for (const mutation of mutations) {
            const key = mutation.kind === "put" ? publicCoinCursor(mutation.coin) : mutation.key;
            const old = overlay.has(key) ? overlay.get(key) : await this.#store.get(key);
            if (mutation.kind === "put") {
                const coin = publicCoin(mutation.coin);
                if (old) {
                    if (!samePublicCoin(old, coin))
                        fail("A public outpoint changed immutable cached facts.");
                }
                else
                    adjust(coin.address, coin.amount, 1);
                overlay.set(key, coin);
            }
            else {
                if (old) {
                    if (old.address !== mutation.address)
                        fail("Public history tried to spend another address's output.");
                    adjust(old.address, -old.amount, -1);
                }
                overlay.set(key, null);
            }
        }
        const progress = JSON.stringify(this.#state), checkpoint = await this.#store.commitPage(mutations, progress, this.#codec);
        this.#live();
        if (checkpoint.progress !== progress || this.#checkpoint && checkpoint.generation !== this.#checkpoint.generation)
            fail("Public checkpoint ACK changed generation or progress.");
        this.#stats(checkpoint);
        this.#checkpoint = checkpoint;
    }
    #range(entries, target, reason) {
        this.#state.range = { entries, target, cursor: null, completed: 0, last: null, reason };
    }
    async #drive() {
        while (true) {
            this.#live();
            const state = this.#state;
            if (state.range) {
                await this.#readRange();
                continue;
            }
            if (state.maintenance) {
                const task = state.maintenance, entries = [];
                while (task.nextIndex < state.addresses.length && entries.length < 64) {
                    const index = task.nextIndex++, height = state.addresses[index].completeHeight;
                    if (height !== null && task.target - height >= MAINTENANCE)
                        entries.push({ index, after: height });
                }
                if (entries.length)
                    this.#range(entries, task.target, "maintenance");
                else
                    state.maintenance = null;
                await this.#save([]);
                continue;
            }
            if (state.mode === "scan") {
                if (state.base) {
                    await this.#readBase();
                    continue;
                }
                while (state.scanIndex < state.addresses.length && state.addresses[state.scanIndex].completeHeight !== null)
                    state.scanIndex++;
                if (state.scanIndex < state.addresses.length) {
                    state.base = { index: state.scanIndex, after: null, anchor: null, watermark: null, pages: 0, eof: false };
                    await this.#save([]);
                    continue;
                }
                state.mode = "cohort";
                state.cohortIndex = 0;
                state.target = state.addresses.reduce((height, row) => Math.max(height, row.completeHeight ?? 0), state.maxObserved);
                await this.#save([]);
                continue;
            }
            if (state.mode === "cohort") {
                const entries = [];
                while (state.cohortIndex < state.addresses.length && entries.length < 64) {
                    const index = state.cohortIndex++, height = state.addresses[index].completeHeight;
                    if (height === null || height > state.target)
                        fail("The public cohort lacks a complete base.");
                    if (height < state.target)
                        entries.push({ index, after: height });
                }
                if (entries.length) {
                    this.#range(entries, state.target, "cohort");
                    await this.#save([]);
                    continue;
                }
                if (state.cohortIndex < state.addresses.length) {
                    await this.#save([]);
                    continue;
                }
                if (state.maxObserved > state.target) {
                    state.target = state.maxObserved;
                    state.cohortIndex = 0;
                    await this.#save([]);
                    continue;
                }
                if (state.addresses.some(row => row.completeHeight !== state.target))
                    fail("Public wallet completion has mixed heads.");
                state.height = state.target;
                state.mode = "ready";
                await this.#save([]);
                this.#ready = true;
                return;
            }
            this.#ready = true;
            return;
        }
    }
    async #readBase() {
        const state = this.#state, base = state.base, owner = state.addresses[base.index];
        const page = await this.#source.base(owner.address, base.after ?? undefined, PAGE);
        this.#live();
        if (page.address !== owner.address || !safe(page.anchor.height) || !hash(page.anchor.cutId) || !hash(page.anchor.stateRoot)
            || !Array.isArray(page.coins) || page.coins.length > PAGE || typeof page.more !== "boolean" || !page.coins.length && page.more)
            fail("Invalid moving public page.");
        if (base.anchor && (page.anchor.height < base.anchor.height || page.anchor.height === base.anchor.height
            && (page.anchor.cutId !== base.anchor.cutId || page.anchor.stateRoot !== base.anchor.stateRoot)))
            fail("Moving public anchor went backwards or conflicted.");
        if (page.anchor.height < owner.height)
            fail("The public base is behind its address observation.");
        let last = base.after;
        const mutations = [];
        for (const value of page.coins) {
            const coin = publicCoin(value), key = publicCoinCursor(coin);
            if (coin.address !== owner.address || last !== null && key <= last || coin.height > page.anchor.height)
                fail("Moving public outputs repeat, belong elsewhere, or were created too late.");
            last = key;
            mutations.push({ kind: "put", coin });
        }
        base.after = last;
        base.anchor = page.anchor;
        base.watermark ??= page.anchor.height;
        base.pages++;
        base.eof = !page.more;
        state.maxObserved = Math.max(state.maxObserved, page.anchor.height);
        if (base.eof || base.pages >= 64 || page.anchor.height - base.watermark >= 64)
            this.#range([{ index: base.index, after: base.watermark }], page.anchor.height, "own");
        await this.#save(mutations);
    }
    #historyGap() {
        return new PublicCoinHistoryGap(this.#state.addresses.map(row => ({
            address: row.address, branch: row.branch, index: row.index, height: row.height, funded: row.funded || row.coins > 0, used: row.used || row.coins > 0
        })));
    }
    async #readRange() {
        const state = this.#state, range = state.range;
        const requested = range.entries.map(entry => ({ address: state.addresses[entry.index].address, afterHeight: entry.after }));
        const page = await this.#source.history(requested, range.target, range.cursor ?? undefined, PAGE).catch((error) => {
            if (error && typeof error === "object" && "status" in error && error.status === 404 && "reason" in error && error.reason === "history_not_held")
                throw this.#historyGap();
            throw error;
        });
        this.#live();
        if (page.atHeight !== range.target || !safe(page.indexedHeight) || page.indexedHeight < range.target || !safe(page.historyFrom)
            || !Array.isArray(page.events) || page.events.length > PAGE || !Array.isArray(page.completed) || page.completed.length > requested.length
            || page.completed.length < range.completed)
            fail("Invalid finite public history coverage.");
        requested.forEach((row, index) => {
            if (row.afterHeight < range.target && page.historyFrom > row.afterHeight + 1)
                (() => { throw this.#historyGap(); })();
            if (index < page.completed.length && page.completed[index] !== row.address)
                fail("Public history completion changed its request prefix.");
        });
        const positions = new Map(requested.map((row, index) => [row.address, index]));
        const mutations = [];
        let previous = range.last;
        for (const event of page.events) {
            if (--this.#budget < 0)
                fail("The resumable public history exceeds its configured event budget.");
            const index = positions.get(event.address);
            if (index === undefined || index < range.completed || index > page.completed.length)
                fail("Public history skipped or repeated an address.");
            const kind = event.kind === "received" ? 0 : event.kind === "spent" ? 1 : fail("Invalid public history kind.");
            const coin = publicCoin(event.coin), key = publicCoinCursor(coin);
            const order = [index, event.height, kind, key];
            if (coin.address !== event.address || kind === 0 && coin.height !== event.height || !safe(event.height) || event.height <= requested[index].afterHeight || event.height > range.target)
                fail("Public history event lies outside its fixed owner interval.");
            if (previous && (order[0] < previous[0] || order[0] === previous[0] && (order[1] < previous[1]
                || order[1] === previous[1] && (order[2] < previous[2] || order[2] === previous[2] && order[3] <= previous[3]))))
                fail("Forward public history order regressed.");
            previous = order;
            mutations.push(kind === 0 ? { kind: "put", coin } : { kind: "remove", key, address: event.address });
        }
        const completed = page.completed.length;
        if (!page.events.length && completed === range.completed && page.nextCursor !== null)
            fail("Public history made no finite progress.");
        if (page.nextCursor !== null && (!/^[0-9a-f]{224}$/.test(page.nextCursor) || page.nextCursor === range.cursor || completed === requested.length))
            fail("Public history continuation is invalid.");
        if (page.nextCursor === null && completed !== requested.length)
            fail("Public history ended before completing every owner.");
        if (range.reason !== "own")
            for (let at = range.completed; at < completed; at++)
                state.addresses[range.entries[at].index].completeHeight = range.target;
        range.last = previous;
        range.completed = completed;
        range.cursor = page.nextCursor;
        if (page.nextCursor === null) {
            if (range.reason === "own") {
                const base = state.base;
                base.watermark = range.target;
                base.pages = 0;
                if (base.eof) {
                    state.addresses[base.index].completeHeight = range.target;
                    state.scanIndex = base.index + 1;
                    state.base = null;
                }
                state.maintenance = { target: range.target, nextIndex: 0 };
            }
            state.range = null;
        }
        await this.#save(mutations);
    }
    async get(key) {
        this.#complete();
        if (!point(key)) {
            const match = /^([0-9a-f]{96}):(0|[1-9][0-9]*)$/.exec(key);
            if (!match || Number(match[2]) > 0xffffffff)
                fail("Invalid public outpoint.");
            key = match[1] + Number(match[2]).toString(16).padStart(8, "0");
        }
        return this.#store.get(key);
    }
    async available(heldKeys) {
        this.#complete();
        if (heldKeys.size > 4096)
            fail("Reconcile retained input holds before another public selection.");
        let available = BigInt(this.#state.atoms);
        for (const key of heldKeys) {
            const row = await this.get(key);
            this.#complete();
            if (row)
                available = checked(available - row.amount);
        }
        return available;
    }
    async page(query = {}) { this.#complete(); return this.#store.page(query); }
    async visit(take) {
        this.#complete();
        let after;
        for (;;) {
            const page = await this.#store.page({ after, limit: PAGE });
            this.#complete();
            for (const coin of page.coins)
                if (!this.#held(coin) && take(coin) === false)
                    return;
            if (page.nextAfter === null)
                return;
            if (after !== undefined && page.nextAfter <= after)
                fail("Local public cursor did not progress.");
            after = page.nextAfter;
        }
    }
    async largest(limit, address) {
        this.#complete();
        if (!safe(limit) || limit < 1 || limit > 512)
            fail("Public selection limit must be1..512.");
        const rows = [];
        let after;
        for (;;) {
            const page = await this.#store.largestPage({ after, address, limit: PAGE });
            this.#complete();
            for (const coin of page.coins)
                if (!this.#held(coin)) {
                    rows.push(coin);
                    if (rows.length === limit)
                        return rows;
                }
            if (page.nextAfter === null)
                return rows;
            after = page.nextAfter;
        }
    }
    async consolidation(above = 1) {
        const rows = [];
        for (const row of this.addresses) {
            if (row.utxos <= above)
                continue;
            const group = await this.largest(512 - rows.length, row.address);
            if (group.length > 1)
                rows.push(...group);
            if (rows.length >= 511)
                break;
        }
        return rows;
    }
    close() { if (!this.#closing) {
        this.#closed = true;
        this.#ready = false;
        this.#closing = this.#store.close();
    } return this.#closing; }
}
