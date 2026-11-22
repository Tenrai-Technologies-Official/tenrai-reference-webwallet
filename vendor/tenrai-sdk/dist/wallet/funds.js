import { collectPublicHistory } from "./public-history.js";
import { PUBLIC_COIN_U128_MAX } from "./public-coin-store.js";
import { TenraiApiError, TenraiWalletError } from "../errors.js";
/** Unused addresses checked past the last used one. */
export const GAP_LIMIT = 20;
/** A wallet scanned for the first time looks further, as a restored one may have gaps. */
export const RESTORE_GAP_LIMIT = 100;
export const RESCAN_DEPTH = 1_000;
export const MAX_RESCAN_DEPTH = 10_000;
const BATCH = 64;
export function outpoint(coin) {
    return `${coin.transactionId}:${coin.outputIndex}`;
}
/** Walks each branch until `gap` unused addresses follow the last used one. */
export async function scan(client, addressAt, options = {}) {
    const gap = options.gap ?? GAP_LIMIT;
    if (!Number.isSafeInteger(gap) || gap < 1 || gap > 10_000)
        throw new TenraiWalletError("Invalid address scan gap.", "invalid");
    let scanned = 0, totalAtoms = 0n, totalOutputs = 0;
    const found = { used: { receive: -1, change: -1 }, held: [], active: [], indexedHeight: 0, observed: [] };
    for (const branch of ["receive", "change"]) {
        const known = options.known?.[branch] ?? -1;
        const end = () => Math.max(known, found.used[branch]) + gap;
        let index = 0;
        while (index <= end()) {
            const window = [];
            for (; window.length < BATCH && index <= end(); index += 1) {
                if (++scanned > 10_000)
                    throw new TenraiWalletError("Address discovery exceeds the 10000-address wallet limit; use another account.", "rejected");
                window.push({ address: addressAt(index, branch), index });
            }
            const list = window.map((entry) => entry.address);
            const [history, balances] = await Promise.all([client.address.changes(list, 0), client.address.balances(list)]);
            const requested = new Set(list), seen = new Set();
            if (balances.balances.length !== list.length || !Number.isSafeInteger(balances.indexed_height) || balances.indexed_height < 0
                || history.changes.some(change => !requested.has(change.address)) || history.resync.some(address => !requested.has(address)))
                throw new TenraiWalletError("Invalid address batch coverage.", "rejected");
            for (const entry of balances.balances) {
                const atoms = BigInt(entry.balance);
                if (!requested.has(entry.address) || seen.has(entry.address) || !Number.isSafeInteger(entry.utxos) || entry.utxos < 0
                    || atoms < 0n || atoms > PUBLIC_COIN_U128_MAX || (atoms === 0n) !== (entry.utxos === 0) || BigInt(entry.utxos) > atoms)
                    throw new TenraiWalletError("Invalid address balance.", "rejected");
                seen.add(entry.address);
                totalAtoms += atoms;
                totalOutputs += entry.utxos;
                if (totalAtoms > PUBLIC_COIN_U128_MAX || !Number.isSafeInteger(totalOutputs))
                    throw new TenraiWalletError("Account totals overflow the supported range.", "rejected");
            }
            const active = new Set([...history.changes.map((change) => change.address), ...history.resync]);
            const held = new Map(balances.balances.map((entry) => [entry.address, entry]));
            found.indexedHeight = Math.max(found.indexedHeight, balances.indexed_height);
            for (const entry of window) {
                found.observed.push({ address: entry.address, height: balances.indexed_height });
                const balance = held.get(entry.address);
                if (balance && balance.utxos > 0) {
                    active.add(entry.address);
                    found.held.push({ ...entry, branch, atoms: BigInt(balance.balance), utxos: balance.utxos });
                }
                if (active.has(entry.address)) {
                    found.used[branch] = Math.max(found.used[branch], entry.index);
                    found.active.push(entry.address);
                }
            }
        }
    }
    return found;
}
/** Addresses whose key the chain already knows can sign without carrying the 1952-byte public key. */
export async function registered(client, addresses) {
    const usable = new Set();
    for (let start = 0; start < addresses.length; start += BATCH) {
        let answer;
        try {
            answer = await client.keys.registered(addresses.slice(start, start + BATCH));
        }
        catch (error) {
            // A server without the key registry route still takes inline keys; they only cost more.
            if (error instanceof TenraiApiError && error.code === "not_found") {
                return new Set();
            }
            throw error;
        }
        for (const entry of answer.registrations) {
            if (entry.usable_at_admission_anchor) {
                usable.add(entry.address);
            }
        }
    }
    return usable;
}
/** The newest requested transactions globally; only four pages are in flight at once. */
export async function history(client, addresses, most) {
    return collectPublicHistory(client, addresses, most);
}
function transactionOf(event) {
    return event.kind === "received" ? event.outpoint.transaction_id : event.transaction_id;
}
function groupOf(event) {
    return transactionOf(event) ?? `${event.outpoint.transaction_id}:${event.outpoint.output_index}`;
}
/**
 * One entry per transaction, grouped like the Rust wallet's `activity`: a receipt under the paying
 * transaction, a spend under its spender, a spend without a known spender under the output alone.
 */
export function activity(events) {
    const groups = new Map();
    const seen = new Set();
    for (const event of events) {
        const output = `${event.outpoint.transaction_id}:${event.outpoint.output_index}`;
        if (seen.has(`${event.kind} ${output}`)) {
            continue;
        }
        seen.add(`${event.kind} ${output}`);
        const transactionId = transactionOf(event);
        const key = groupOf(event);
        let group = groups.get(key);
        if (!group) {
            group = { transactionId, height: event.finalized_height, received: 0n, spent: 0n, sources: [] };
            groups.set(key, group);
        }
        if (event.kind === "received") {
            group.received += BigInt(event.amount);
            if (group.received > PUBLIC_COIN_U128_MAX)
                throw new TenraiWalletError("History received total overflows u128.", "rejected");
        }
        else {
            group.spent += BigInt(event.amount);
            if (group.spent > PUBLIC_COIN_U128_MAX)
                throw new TenraiWalletError("History spent total overflows u128.", "rejected");
        }
        group.height = Math.max(group.height, event.finalized_height);
        if (!group.sources.includes(event.source)) {
            group.sources.push(event.source);
        }
    }
    const rows = [...groups.values()];
    for (const row of rows) {
        row.sources.sort();
    }
    return rows.sort((left, right) => right.height - left.height || order(left.transactionId, right.transactionId));
}
function order(left, right) {
    if (left === right) {
        return 0;
    }
    if (left === null || right === null) {
        return left === null ? -1 : 1;
    }
    return left < right ? -1 : 1;
}
export async function positions(client, owners) {
    if (owners.length > 10000)
        throw new TenraiWalletError("Position queries exceed the10000-owner wallet limit.", "rejected");
    const found = new Map();
    let pages = 4096;
    for (let start = 0; start < owners.length; start += BATCH) {
        const batch = owners.slice(start, start + BATCH), expected = new Set(batch);
        let cursor;
        const seen = new Set();
        do {
            if (--pages < 0)
                throw new TenraiWalletError("Position page work budget exhausted.", "rejected");
            const page = await client.staking.positions(batch, cursor === undefined ? {} : { cursor });
            if (page.positions.length > 256)
                throw new TenraiWalletError("A position page exceeds256 rows.", "rejected");
            for (const position of page.positions) {
                if (!expected.has(position.owner_address) || found.has(position.position_id) || found.size >= 65536)
                    throw new TenraiWalletError("Invalid, repeated or excessive stake positions.", "rejected");
                found.set(position.position_id, position);
            }
            const next = page.next_cursor ?? undefined;
            if (next !== undefined) {
                if (seen.has(next))
                    throw new TenraiWalletError("The position cursor repeated.", "rejected");
                seen.add(next);
            }
            cursor = next;
        } while (cursor !== undefined);
    }
    return [...found.values()].sort((a, b) => a.position_id < b.position_id ? -1 : a.position_id > b.position_id ? 1 : 0);
}
/** Retains ambiguous submissions: a later refusal or 404 cannot disprove an earlier executable copy. */
export async function submit(client, prepared, options = {}) {
    let failure;
    try {
        const receipt = await client.transactions.submit(prepared.wireHex, { signal: options.signal });
        if (receipt.transaction_id !== prepared.transactionId) {
            throw new TenraiWalletError("the node accepted a different transaction id", "rejected");
        }
        return receipt.lifecycle;
    }
    catch (error) {
        failure = error;
        await options.uncertain?.();
    }
    try {
        const known = await client.transactions.status(prepared.transactionId, { signal: options.signal });
        if (known.transaction_id !== prepared.transactionId || !["processing", "receiving", "registered"].includes(known.lifecycle)) {
            throw new TenraiWalletError("the reported terminal status requires verified reconciliation", "unconfirmed");
        }
        return known.lifecycle;
    }
    catch {
        throw new TenraiWalletError("the node did not confirm the transfer; retain its original bytes and check its status before sending again", "unconfirmed", { transactionId: prepared.transactionId, wireHex: prepared.wireHex }, { cause: failure });
    }
}
