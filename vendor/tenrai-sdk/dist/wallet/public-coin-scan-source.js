import { publicCoin, PUBLIC_COIN_U128_MAX } from "./public-coin-store.js";
/** Normalizes advisory reads; certified input proofs remain a separate signing boundary. */
export function publicCoinScanSource(client) {
    return {
        async base(address, after, limit) {
            const page = await client.address.utxos(address, { limit, ...(after === undefined ? {} : { after }) });
            return { address: page.address, anchor: { height: page.anchor.height, cutId: page.anchor.cut_id, stateRoot: page.anchor.state_root },
                coins: page.utxos.map(row => publicCoin({ address: page.address, transactionId: row.outpoint.transaction_id,
                    outputIndex: row.outpoint.output_index, amount: BigInt(row.amount), height: row.created_finalized_height })), more: page.next_cursor !== null };
        },
        async history(entries, target, cursor, limit) {
            const page = await client.address.historyRanges(entries.map(row => ({ address: row.address, after_height: row.afterHeight })), target, { limit, ...(cursor === undefined ? {} : { cursor }) });
            return { atHeight: page.at_height, indexedHeight: page.indexed_height, historyFrom: page.history_from, completed: page.completed, nextCursor: page.next_cursor,
                events: page.events.map(event => ({ address: event.address, height: event.finalized_height, kind: event.kind,
                    coin: publicCoin({ address: event.address, transactionId: event.outpoint.transaction_id, outputIndex: event.outpoint.output_index,
                        amount: BigInt(event.amount), height: event.finalized_height }) })) };
        },
    };
}
export async function freshPublicCoinObservations(client, tracked) {
    const observed = [];
    for (let at = 0; at < tracked.length; at += 64) {
        const group = tracked.slice(at, at + 64), expected = new Map(group.map(row => [row.address, row])), page = await client.address.balances([...expected.keys()]);
        if (!Number.isSafeInteger(page.indexed_height) || page.indexed_height < 0 || page.balances.length !== group.length)
            throw new Error("Invalid rebuilt public address coverage.");
        for (const row of page.balances) {
            const path = expected.get(row.address), amount = BigInt(row.balance);
            if (!path || !expected.delete(row.address) || amount < 0n || amount > PUBLIC_COIN_U128_MAX || !Number.isSafeInteger(row.utxos) || row.utxos < 0
                || (amount === 0n) !== (row.utxos === 0) || BigInt(row.utxos) > amount)
                throw new Error("Invalid rebuilt public balance.");
            observed.push({ ...path, height: page.indexed_height, funded: row.utxos > 0, used: path.used || row.utxos > 0 });
        }
    }
    return observed;
}
