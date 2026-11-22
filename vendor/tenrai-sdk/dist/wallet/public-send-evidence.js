import { withFinalityProof } from "./finality-guard.js";
import { TenraiWalletError } from "../errors.js";
import { registrationHead } from "./private-registration-context.js";
import { outcomeAnchor } from "./unknown-outcome.js";
import { validatePublicTransfer } from "./public-transfer-journal.js";
function head(scan, context, chain) {
    const text = scan.registrationVerifiedHead();
    if (typeof text !== "string" || text.length > 2048)
        throw new TypeError("invalid verified public reconciliation head");
    const value = JSON.parse(text);
    if (value.chain_id !== chain || value.network !== context.network)
        throw new TypeError("public reconciliation belongs to another chain");
    return { chain_id: chain, network: context.network, finalized: outcomeAnchor(value.finalized) };
}
const nativeInputs = new WeakMap();
export function nativeInputFacts(input, owner) {
    owner.state.assertOpen();
    const checked = nativeInputs.get(input);
    if (!checked || checked.owner !== owner)
        throw new TypeError("The native input lacks this wallet's certified proof.");
    return checked.facts;
}
/** A separate public finality context works while private note recovery and its UI are inactive. */
export class PublicSendEvidence {
    #scan;
    #running;
    #closing = false;
    #cursor = 0;
    #turn = Promise.resolve();
    #queued = 0;
    #stopped = new AbortController();
    state;
    context;
    constructor(state, context) { this.state = state; this.context = context; }
    reconcile(client) {
        if (this.#closing)
            return Promise.reject(new Error("the public reconciliation context is closed"));
        if (this.#running)
            return this.#running;
        const session = this.state.session();
        const work = () => this.#exclusive(() => this.#reconcile(client));
        const run = session ? session.run(work) : work();
        this.#running = run;
        void run.finally(() => { if (this.#running === run)
            this.#running = undefined; if (this.#closing) {
            this.#scan?.free();
            this.#scan = undefined;
        } }).catch(() => { });
        return run;
    }
    ready(until) {
        return withFinalityProof(this.context.root(), this.context.network, this.context.genesis(), height => { if (height >= until)
            throw new Error("The certified signed validity window is closed."); });
    }
    #exclusive(work) {
        if (this.#closing || this.#queued >= 16)
            return Promise.reject(new Error("the public proof context is closed or busy"));
        this.#queued++;
        const run = this.#turn.then(() => { if (this.#closing)
            throw new Error("the public proof context is closed"); return work(); });
        this.#turn = run.then(() => { }, () => { });
        void run.finally(() => { this.#queued--; }).catch(() => { });
        return run;
    }
    /** Cached facts are advisory: genuine current-QC presence must bind every selected input before signing. */
    verifyCoins(client, coins, chain) {
        return this.#exclusive(async () => {
            this.state.assertOpen();
            if (coins.length === 0)
                return;
            if (coins.length > 8)
                throw new TypeError("select one to eight public inputs");
            const ordered = [...coins].sort((a, b) => a.transactionId === b.transactionId ? a.outputIndex - b.outputIndex : a.transactionId < b.transactionId ? -1 : 1);
            const expected = ordered.map(coin => {
                if (coin.height === undefined || !Number.isSafeInteger(coin.height) || coin.height < 0)
                    throw new TypeError("selected input has no canonical creation height");
                return { outpoint: { transaction_id: coin.transactionId, output_index: coin.outputIndex },
                    address: coin.address, amount: coin.amount.toString(), created_finalized_height: coin.height };
            });
            if (new Set(expected.map(row => row.outpoint.transaction_id + ":" + row.outpoint.output_index)).size !== expected.length)
                throw new TypeError("selected public inputs repeat");
            const signal = AbortSignal.any([AbortSignal.timeout(12_000), this.#stopped.signal, ...(this.state.session() ? [this.state.session().signal] : [])]);
            this.#scan ??= new this.context.wasm.PrivateScan(this.context.root(), this.context.network, this.context.genesis(), this.context.account, undefined, undefined);
            this.#scan = await registrationHead(this.context.wasm, this.context.root(), this.context.network, this.context.account, this.context.genesis(), client, { signal }, this.#scan);
            this.state.assertOpen();
            const before = head(this.#scan, this.context, chain), outpoints = expected.map(row => row.outpoint);
            const request = { api_version: 1, anchor: before.finalized, outpoints };
            const answer = await client.proofs.utxoPresence(before.finalized, outpoints, { signal, maxResponseBytes: 1024 * 1024 });
            signal.throwIfAborted();
            this.state.assertOpen();
            await withFinalityProof(this.context.root(), this.context.network, this.context.genesis(), () => this.context.wasm.verifyFinalizedUtxoSelection(JSON.stringify(request), JSON.stringify(answer), JSON.stringify({ chain_id: chain, network: this.context.network, coins: expected })));
            if (JSON.stringify(head(this.#scan, this.context, chain)) !== JSON.stringify(before))
                throw new TypeError("selected input proof head changed");
        });
    }
    /** Conditional outputs use the same current-QC verifier and canonical Rust record decoder. */
    readNativeInput(client, address, outpoint, chain) {
        return this.#exclusive(async () => {
            this.state.assertOpen();
            const signal = AbortSignal.any([AbortSignal.timeout(12_000), this.#stopped.signal, ...(this.state.session() ? [this.state.session().signal] : [])]);
            this.#scan ??= new this.context.wasm.PrivateScan(this.context.root(), this.context.network, this.context.genesis(), this.context.account, undefined, undefined);
            this.#scan = await registrationHead(this.context.wasm, this.context.root(), this.context.network, this.context.account, this.context.genesis(), client, { signal }, this.#scan);
            this.state.assertOpen();
            const before = head(this.#scan, this.context, chain), request = { api_version: 1, anchor: before.finalized, outpoints: [outpoint] };
            const answer = await client.proofs.utxoPresence(before.finalized, [outpoint], { signal, maxResponseBytes: 1024 * 1024 });
            signal.throwIfAborted();
            this.state.assertOpen();
            const text = await withFinalityProof(this.context.root(), this.context.network, this.context.genesis(), () => this.context.wasm.readFinalizedUtxoSelection(JSON.stringify(request), JSON.stringify(answer), JSON.stringify({
                chain_id: chain, network: this.context.network, coins: [{ outpoint, address }]
            })));
            if (JSON.stringify(head(this.#scan, this.context, chain)) !== JSON.stringify(before) || text.length > 4096)
                throw new TypeError("The certified native input head changed.");
            const rows = JSON.parse(text);
            const row = rows[0];
            if (rows.length !== 1 || !row || row.address !== address || row.outpoint.transaction_id !== outpoint.transaction_id || row.outpoint.output_index !== outpoint.output_index
                || !/^[1-9][0-9]{0,38}$/.test(row.amount) || BigInt(row.amount) > (1n << 128n) - 1n
                || !/^(0|[1-9][0-9]{0,19})$/.test(row.created_finalized_height) || BigInt(row.created_finalized_height) > BigInt(before.finalized.height))
                throw new TypeError("The canonical native input response is inconsistent.");
            const token = Object.freeze({});
            nativeInputs.set(token, { owner: this, facts: Object.freeze({ address, outpoint: Object.freeze({ ...outpoint }), amount: BigInt(row.amount),
                    createdHeight: BigInt(row.created_finalized_height), source: row.source, anchor: Object.freeze({ ...before.finalized }) }) });
            return token;
        });
    }
    async #reconcile(client) {
        const state = this.state;
        state.assertOpen();
        const journal = state.journal();
        if (!journal || state.open.size === 0)
            return [];
        const timeout = AbortSignal.timeout(12_000);
        const signal = AbortSignal.any([timeout, this.#stopped.signal, ...(state.session() ? [state.session().signal] : [])]);
        this.#scan ??= new this.context.wasm.PrivateScan(this.context.root(), this.context.network, this.context.genesis(), this.context.account, undefined, undefined);
        this.#scan = await registrationHead(this.context.wasm, this.context.root(), this.context.network, this.context.account, this.context.genesis(), client, { signal }, this.#scan);
        state.assertOpen();
        const before = head(this.#scan, this.context, journal.chainId);
        const expired = [...state.open.values()].filter((entry) => BigInt(before.finalized.height) > entry.validUntil);
        if (!expired.length)
            return [];
        const start = this.#cursor % expired.length;
        const selected = [...expired.slice(start), ...expired.slice(0, start)].slice(0, 8);
        this.#cursor = (start + selected.length) % expired.length;
        const closed = [];
        for (const original of selected) {
            signal.throwIfAborted();
            state.assertOpen();
            const entry = validatePublicTransfer(state.wasm, state.network, { ...original, validUntil: original.validUntil.toString() }, journal.chainId);
            const outpoints = entry.spends.map(({ key }) => { const [transaction_id, index] = key.split(":"); return { transaction_id: transaction_id, output_index: Number(index) }; })
                .sort((a, b) => a.transaction_id === b.transaction_id ? a.output_index - b.output_index : a.transaction_id < b.transaction_id ? -1 : 1);
            const request = { api_version: 1, anchor: before.finalized, outpoints };
            const answer = await client.proofs.utxoPresence(before.finalized, outpoints, { signal, maxResponseBytes: 1024 * 1024 });
            signal.throwIfAborted();
            state.assertOpen();
            await withFinalityProof(this.context.root(), this.context.network, this.context.genesis(), () => state.wasm.verifyFinalizedUtxoPresence(JSON.stringify(request), JSON.stringify(answer)));
            if (answer.chain_id !== before.chain_id || answer.network !== before.network || answer.proofs.length !== outpoints.length || JSON.stringify(head(this.#scan, this.context, journal.chainId)) !== JSON.stringify(before) || state.open.get(entry.transactionId) !== original)
                throw new TypeError("the source coverage or original artifact changed");
            if (answer.proofs.some((proof) => proof.record === null)) {
                try {
                    await journal.retainUnknown(entry, before.finalized);
                }
                catch (error) {
                    state.failRestore();
                    throw error;
                }
            }
            state.assertOpen();
            signal.throwIfAborted();
            if (JSON.stringify(head(this.#scan, this.context, journal.chainId)) !== JSON.stringify(before) || state.open.get(entry.transactionId) !== original)
                throw new TypeError("the source coverage changed during outcome persistence");
            state.open.delete(entry.transactionId);
            try {
                await state.save();
            }
            catch (cause) {
                state.open.set(entry.transactionId, original);
                state.failRestore();
                throw new TenraiWalletError("the expired payment closure write is uncertain; reopen its retained journal", "unconfirmed", { transactionId: entry.transactionId }, { cause });
            }
            state.releaseOwned(entry.transactionId, entry.spends.map((spend) => spend.key));
            closed.push(entry.transactionId);
        }
        return closed;
    }
    close() {
        if (!this.#closing) {
            this.#closing = true;
            this.#stopped.abort(new Error("the public reconciliation context closed"));
        }
        return Promise.allSettled([this.#running, this.#turn]).then(() => { this.#scan?.free(); this.#scan = undefined; });
    }
}
