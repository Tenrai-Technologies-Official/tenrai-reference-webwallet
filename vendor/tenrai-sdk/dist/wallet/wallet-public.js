import { UnknownOutcomeError } from "./unknown-outcome.js";
import { TenraiApiError, TenraiWalletError } from "../errors.js";
import { isFinal } from "../sockets/status.js";
import * as funds from "./funds.js";
import { VALIDITY_CUTS, feeRate } from "./plan.js";
import { validatePublicTransfer } from "./public-transfer-journal.js";
import { ProtocolRules } from "./protocol.js";
const PRIORITIES = ["minimum", "normal", "priority"];
const RESEND_MILLIS = 30_000;
export async function resendPublic(state, client) {
    state.assertOpen();
    if (state.open.size === 0) {
        return [];
    }
    const journal = state.journal();
    if (!journal)
        throw new TenraiWalletError("configure a durable public journal before managed submission", "rejected");
    const { finalized } = await client.node.info({ signal: state.session()?.signal });
    state.assertOpen();
    if (!Number.isSafeInteger(finalized.height) || finalized.height < 0)
        throw new TenraiWalletError("invalid reported finalized height", "invalid");
    const now = Date.now();
    const taken = [];
    for (const [transactionId, entry] of state.open) {
        const unknown = await journal.unknown(transactionId);
        state.assertOpen();
        if (unknown) {
            entry.needsReview = true;
            entry.resendPaused = true;
            continue;
        }
        if (BigInt(finalized.height) >= entry.validUntil) {
            entry.needsReview = true;
            entry.resendPaused = true;
            continue;
        }
        if (entry.resendPaused || entry.exported)
            continue;
        if (now - entry.sentAt < RESEND_MILLIS) {
            continue;
        }
        entry.sentAt = now;
        const status = await client.transactions.status(transactionId, { signal: state.session()?.signal }).then((known) => known, (error) => (error instanceof TenraiApiError && error.code === "not_found" ? null : undefined));
        state.assertOpen();
        if (status && isFinal(status)) {
            entry.needsReview = true;
            entry.resendPaused = true;
        }
        else if (status === null) {
            const alreadyUncertain = entry.needsReview === true;
            entry.needsReview = true;
            await state.save();
            state.assertOpen();
            await state.beforeSubmit(entry.validUntil);
            state.assertOpen();
            const receipt = await client.transactions.submit(entry.wireHex, { signal: state.session()?.signal }).catch(() => undefined);
            state.assertOpen();
            if (receipt?.transaction_id === transactionId) {
                taken.push(transactionId);
                if (!alreadyUncertain)
                    entry.needsReview = false;
            }
        }
    }
    await state.save();
    return taken;
}
export async function publicContext(state, client, fee) {
    state.assertOpen();
    if (fee.feePerMass !== undefined && (typeof fee.feePerMass !== "bigint" || fee.feePerMass <= 0n)) {
        throw new TenraiWalletError("feePerMass must be a positive bigint of atoms", "invalid");
    }
    if (fee.priority !== undefined && !PRIORITIES.includes(fee.priority)) {
        throw new TenraiWalletError("priority must be minimum, normal or priority", "invalid");
    }
    await state.resend(client).catch(() => []);
    const [manifest, firstEstimate, found] = await Promise.all([
        client.transactions.manifest(),
        fee.feePerMass === undefined && fee.priority !== "minimum" ? client.fees.estimate() : undefined,
        state.scan(client),
    ]);
    let protocol = new ProtocolRules(state.wasm, manifest);
    let { rules } = protocol;
    if (rules.network !== state.network) {
        throw new TenraiWalletError(`this wallet is for ${state.network}, the node runs ${rules.network}`, "wrong-network");
    }
    const inventory = await state.openCoins(client, found);
    try {
        const latest = await client.transactions.manifest();
        if (latest.chain_id !== manifest.chain_id || latest.network !== manifest.network || latest.params_hash !== manifest.params_hash)
            throw new TenraiWalletError("The network changed during public coin recovery.", "wrong-network");
        protocol = new ProtocolRules(state.wasm, latest);
        rules = protocol.rules;
        const estimate = firstEstimate === undefined ? undefined : await client.fees.estimate();
        const present = new Set();
        // Check only the inputs in the retained journal.
        for (const key of new Set([...state.pending.keys(), ...[...state.open.values()].flatMap(entry => entry.spends.map(spend => spend.key))])) {
            if (await inventory.get(key))
                present.add(key);
        }
        // Verified reconciliation releases the original transaction's reservations.
        // A missing indexed input can pause retries. Keep the original artifact.
        let publicChanged = false;
        for (const entry of state.open.values()) {
            if (entry.spends.some((spend) => state.keys.path(spend.address) !== undefined && !present.has(spend.key))) {
                if (entry.needsReview) {
                    if (!entry.resendPaused)
                        publicChanged = true;
                    entry.resendPaused = true;
                }
                else {
                    entry.needsReview = true;
                    entry.resendPaused = true;
                    publicChanged = true;
                }
            }
        }
        if (publicChanged)
            await state.save();
        state.assertOpen();
        const referenced = await funds.registered(client, found.held.map(entry => entry.address));
        const floor = rules.minimumFeePerMass;
        const feePerMass = fee.feePerMass === undefined
            ? feeRate(fee.priority ?? "normal", estimate, rules)
            : fee.feePerMass > floor
                ? fee.feePerMass
                : floor;
        const window = VALIDITY_CUTS < rules.maxValidityCuts ? VALIDITY_CUTS : rules.maxValidityCuts;
        return {
            protocol,
            rules,
            scan: found,
            coins: await inventory.largest(512),
            inventory,
            close: () => inventory.close(),
            referenced,
            feePerMass,
            validFrom: rules.finalizedHeight,
            validUntil: rules.finalizedHeight + window,
        };
    }
    catch (error) {
        await inventory.close().catch(() => { });
        throw error;
    }
}
/** Commit the input reservations before exporting the signed bytes. */
export async function retainPublic(state, original) {
    state.assertOpen();
    const journal = state.journal();
    if (!journal)
        throw new TenraiWalletError("configure a durable public journal before signed bytes leave the wallet", "rejected");
    const checked = validatePublicTransfer(state.wasm, state.network, { ...original, validUntil: original.validUntil.toString() }, journal.chainId);
    const archived = await journal.unknown(checked.transactionId);
    state.assertOpen();
    if (archived)
        throw new UnknownOutcomeError(checked.transactionId, archived.closedAt.height);
    const prior = state.open.get(checked.transactionId);
    if (prior) {
        if (prior.wireHex !== checked.wireHex || prior.manifest !== checked.manifest || prior.validUntil !== checked.validUntil
            || JSON.stringify(prior.spends) !== JSON.stringify(checked.spends))
            throw new TenraiWalletError("the retained transfer has different immutable bytes", "rejected");
        return;
    }
    const entry = { ...checked, needsReview: true, exported: true };
    state.claimOwned(entry.transactionId, entry.spends.map(spend => spend.key), entry.validUntil);
    state.open.set(entry.transactionId, entry);
    try {
        await state.save();
    }
    catch (cause) {
        // Preserve the hold until the journal is reopened.
        state.failRestore();
        throw new TenraiWalletError("the signed transfer could not be held durably; its bytes stay in the wallet", "unconfirmed", { transactionId: entry.transactionId }, { cause });
    }
    state.assertOpen();
}
export async function submitPublic(state, client, original) {
    state.assertOpen();
    const journal = state.journal();
    if (!journal)
        throw new TenraiWalletError("configure a durable public journal before managed submission", "rejected");
    const checked = validatePublicTransfer(state.wasm, state.network, { ...original, validUntil: original.validUntil.toString() }, journal.chainId);
    const archived = await journal.unknown(checked.transactionId);
    state.assertOpen();
    if (archived)
        throw new UnknownOutcomeError(checked.transactionId, archived.closedAt.height);
    const prior = state.open.get(checked.transactionId);
    if (prior && (prior.wireHex !== checked.wireHex || prior.manifest !== checked.manifest || prior.validUntil !== checked.validUntil
        || JSON.stringify(prior.spends) !== JSON.stringify(checked.spends)))
        throw new TenraiWalletError("the retained transfer has different immutable bytes", "rejected");
    const alreadyUncertain = prior?.needsReview === true || checked.needsReview === true;
    const entry = prior ?? checked;
    entry.needsReview = true;
    delete entry.exported;
    state.claimOwned(entry.transactionId, entry.spends.map(spend => spend.key), entry.validUntil);
    state.open.set(entry.transactionId, entry);
    let uncertain = false;
    try {
        await state.save();
        state.assertOpen();
        const current = state.journal() ? await client.node.info({ signal: state.session()?.signal }) : undefined;
        state.assertOpen();
        if (current && (!Number.isSafeInteger(current.finalized.height) || current.finalized.height < 0))
            throw new Error("Invalid reported finalized height.");
        if (entry.resendPaused || current && BigInt(current.finalized.height) >= entry.validUntil) {
            entry.resendPaused = true;
            await state.save();
            throw new TenraiWalletError("the retained transfer needs verified reconciliation before submission", "unconfirmed", { transactionId: entry.transactionId, wireHex: entry.wireHex });
        }
        await state.beforeSubmit(entry.validUntil);
        state.assertOpen();
        const lifecycle = await funds.submit(client, entry, { signal: state.session()?.signal,
            uncertain: async () => { uncertain = true; entry.needsReview = true; await state.save(); } });
        state.assertOpen();
        if (!uncertain && !alreadyUncertain)
            entry.needsReview = false;
        await state.save();
        return lifecycle;
    }
    catch (cause) {
        entry.needsReview = true;
        if (!state.closed()) {
            try {
                await state.save();
            }
            catch {
                state.failRestore();
            }
        }
        if (cause instanceof TenraiWalletError && cause.code === "unconfirmed")
            throw cause;
        throw new TenraiWalletError("the original public transfer was retained; resolve its storage or execution status before creating another payment", "unconfirmed", { transactionId: entry.transactionId, wireHex: entry.wireHex }, { cause });
    }
}
