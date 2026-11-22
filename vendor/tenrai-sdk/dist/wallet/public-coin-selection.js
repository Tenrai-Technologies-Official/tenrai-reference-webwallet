import { TenraiWalletError } from "../errors.js";
import { compareCoins } from "./plan.js";
import { checkedCoinTotal } from "./public-coin-source.js";
const MAX_INPUTS = 8, MAX_ADDRESSES = 10_000;
function key(coin) { return coin.transactionId + coin.outputIndex.toString(16).padStart(8, "0"); }
const byAmount = (left, right) => left.amount < right.amount ? -1 : left.amount > right.amount ? 1 : 0;
const registered = (left, right, known) => Number(known.has(right.address)) - Number(known.has(left.address));
function order(left, right, known) { return byAmount(right, left) || registered(left, right, known) || compareCoins(left, right); }
function top(rows, coin, limit, known) {
    let at = 0;
    while (at < rows.length && order(rows[at], coin, known) < 0)
        at += 1;
    if (at < limit) {
        rows.splice(at, 0, coin);
        if (rows.length > limit)
            rows.pop();
    }
}
async function visit(source, take) {
    let previous;
    await source.visit(coin => {
        const next = key(coin);
        if (coin.amount <= 0n || previous !== undefined && next <= previous)
            throw new TenraiWalletError("The local public coin source is inconsistent.", "rejected");
        previous = next;
        take(coin);
    });
}
class Pick {
    prefix;
    last;
    needed;
    constructor(prefix, last, needed) { this.prefix = prefix; this.last = last; this.needed = needed; }
    static from(rows, target) {
        let sum = 0n;
        for (const [index, coin] of rows.entries()) {
            sum = checkedCoinTotal(sum, coin.amount);
            if (sum >= target)
                return new Pick(rows.slice(0, index), coin, target - (sum - coin.amount));
        }
        return undefined;
    }
    take(coin, known) {
        if (coin.amount < this.needed || this.prefix.some(row => key(row) === key(coin)))
            return;
        if ((registered(coin, this.last, known) || byAmount(coin, this.last) || compareCoins(coin, this.last)) < 0)
            this.last = coin;
    }
    finish() { return [...this.prefix, this.last]; }
}
function rank(left, right, known) {
    const inline = (rows) => rows.filter(row => !known.has(row.address)).length;
    const sum = (rows) => rows.reduce((sum, row) => checkedCoinTotal(sum, row.amount), 0n);
    const a = sum(left), b = sum(right);
    return left.length - right.length || inline(left) - inline(right) || (a < b ? -1 : a > b ? 1 : 0)
        || compareCoins([...left].sort(compareCoins)[0], [...right].sort(compareCoins)[0]);
}
export async function selectFromSource(source, target, limit, known) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_INPUTS)
        throw new TenraiWalletError("Invalid public input limit.", "rejected");
    if (source.largest && source.available) {
        const rows = await source.largest(limit);
        if (rows.length > limit || new Set(rows.map(key)).size !== rows.length || rows.some(coin => coin.amount <= 0n))
            throw new TenraiWalletError("The indexed public selection is inconsistent.", "rejected");
        rows.sort((left, right) => order(left, right, known));
        const chosen = Pick.from(rows, target);
        if (chosen)
            return chosen.finish();
        const available = checkedCoinTotal(0n, await source.available());
        if (available < 0n)
            throw new TenraiWalletError("The indexed available balance is invalid.", "rejected");
        if (available >= target)
            throw new TenraiWalletError("The amount needs compounding first.", "compound-needed", { available, maxInputs: limit });
        throw new TenraiWalletError("Not enough spendable funds.", "insufficient", { available, required: target });
    }
    const groups = new Map(), global = [];
    let available = 0n;
    await visit(source, coin => {
        available = checkedCoinTotal(available, coin.amount);
        let group = groups.get(coin.address);
        if (!group) {
            if (groups.size >= MAX_ADDRESSES)
                throw new TenraiWalletError("The public inventory exceeds 10000 addresses.", "rejected");
            group = [];
            groups.set(coin.address, group);
        }
        top(group, coin, limit, known);
        top(global, coin, limit, known);
    });
    const all = Pick.from(global, target), picks = new Map();
    for (const [address, rows] of groups) {
        const pick = Pick.from(rows, target);
        if (pick)
            picks.set(address, pick);
    }
    groups.clear();
    await visit(source, coin => { all?.take(coin, known); picks.get(coin.address)?.take(coin, known); });
    let alone;
    for (const pick of picks.values()) {
        const rows = pick.finish();
        if (!alone || rank(rows, alone, known) < 0)
            alone = rows;
    }
    const chosen = alone ?? all?.finish();
    if (chosen)
        return chosen;
    if (available >= target)
        throw new TenraiWalletError("The amount needs compounding first.", "compound-needed", { available, maxInputs: limit });
    throw new TenraiWalletError("Not enough spendable funds.", "insufficient", { available, required: target });
}
export async function fillFromSource(source, chosen, limit, known, fees) {
    // Managed disk inventories keep the minimal payment set; dust merging is an explicit indexed operation.
    if (source.largest && source.available)
        return chosen;
    const free = limit - chosen.length;
    if (free <= 0)
        return chosen;
    const addresses = new Set(chosen.map(coin => coin.address)), taken = new Set(chosen.map(key)), extra = [];
    let count = 0;
    await visit(source, coin => {
        if (!addresses.has(coin.address))
            return;
        if (!Number.isSafeInteger(++count))
            throw new TenraiWalletError("Public output count overflow.", "rejected");
        if (taken.has(key(coin)) || coin.amount <= (known.has(coin.address) ? fees.referenced : fees.inline))
            return;
        let at = 0;
        while (at < extra.length && (byAmount(extra[at], coin) || compareCoins(extra[at], coin)) < 0)
            at += 1;
        if (at < free) {
            extra.splice(at, 0, coin);
            if (extra.length > free)
                extra.pop();
        }
    });
    return count > limit ? [...chosen, ...extra] : chosen;
}
export async function firstFromSource(source, limit) {
    if (source.largest && source.available)
        return limit > 0 ? source.largest(limit) : [];
    const rows = [];
    if (limit <= 0)
        return rows;
    await source.visit(coin => { rows.push(coin); return rows.length < limit; });
    return rows;
}
export async function includedFromSource(source, include, need, limit, known) {
    if (include.length > limit || new Set(include.map(key)).size !== include.length)
        throw new TenraiWalletError("Invalid required inputs.", "invalid");
    const amount = include.reduce((sum, coin) => checkedCoinTotal(sum, coin.amount), 0n);
    if (amount >= need)
        return [...include];
    const taken = new Set(include.map(key));
    const remainder = { get: value => source.get(value), visit: take => source.visit(coin => taken.has(key(coin)) ? undefined : take(coin)) };
    if (source.largest && source.available) {
        const largest = source.largest.bind(source), available = source.available.bind(source);
        remainder.largest = async (count) => (await largest(count + taken.size)).filter(coin => !taken.has(key(coin))).slice(0, count);
        remainder.available = async () => { const total = await available(); if (total < amount)
            throw new TenraiWalletError("Required inputs exceed the indexed balance.", "rejected"); return total - amount; };
    }
    return [...include, ...await selectFromSource(remainder, need - amount, limit - include.length, known)];
}
