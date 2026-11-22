import { TenraiWalletError } from "../errors.js";
import { compareCoins, plan, planCompound, planMerge } from "./plan.js";
import { transferPayloadHex } from "./recipients.js";
/** Transfers one `sweep` or `compound` call sends; a wallet with thousands of outputs goes in rounds. */
const MAX_STEPS = 64;
const MERGE_ROUNDS = 4;
const MERGE_WAIT_MILLIS = 600_000;
/** What an address holds besides its largest output: what a compound would gather into it. */
function besidesLargest(coins) {
    let total = 0n;
    let largest = 0n;
    for (const coin of coins) {
        total += coin.amount;
        largest = coin.amount > largest ? coin.amount : largest;
    }
    return total - largest;
}
export async function maxSendable(desk, client, request = {}) {
    const context = await desk.context(client, request);
    await context.close();
    const base = desk.base(context);
    const coins = [...base.coins].sort((a, b) => (a.amount === b.amount ? compareCoins(a, b) : a.amount > b.amount ? -1 : 1));
    const limit = Math.min(coins.length, context.rules.maxInputs, context.rules.maxWitnesses);
    const payloadHex = transferPayloadHex(request.payload, [], context.rules.maxPayloadBytes);
    const sweep = request.to === undefined ? desk.address(0) : context.protocol.parseAddress(request.to);
    let most = 0n;
    // An output worth less than the fee for spending it lowers the total, so every count of the largest is tried.
    for (let count = 1; count <= limit; count += 1) {
        try {
            const planned = plan(context.protocol, {
                ...base,
                coins: coins.slice(0, count),
                payments: [],
                changeAddress: desk.changeAddress(context),
                payloadHex,
                sweep,
            });
            const amount = planned.outputs[0]?.amount ?? 0n;
            if (amount > most) {
                most = amount;
            }
        }
        catch (error) {
            if (!(error instanceof TenraiWalletError && error.code === "insufficient")) {
                throw error;
            }
        }
    }
    return most;
}
export async function mergeFor(desk, client, request, options = {}) {
    const given = request;
    const payments = given.payments ?? [{ to: given.to, amount: given.amount }];
    let sending = 0n;
    for (const payment of payments) {
        if (typeof payment?.amount !== "bigint" || payment.amount <= 0n) {
            throw new TenraiWalletError("the amount must be a positive bigint of atoms", "invalid");
        }
        sending += payment.amount;
    }
    const sent = [];
    for (let round = 0; round < MERGE_ROUNDS; round += 1) {
        const context = await desk.context(client, request);
        try {
            const window = await context.inventory.consolidation();
            if (window.length)
                context.coins = window;
        }
        finally {
            await context.close();
        }
        const change = desk.changeAddress(context);
        const remaining = MAX_STEPS - sent.length;
        if (remaining <= 0) {
            return sent;
        }
        let merge;
        try {
            merge = planMerge(context.protocol, { ...desk.base(context), changeAddress: change }, sending, (address) => address, remaining);
        }
        catch (error) {
            const complete = context.scan.held.reduce((sum, entry) => sum + entry.atoms, 0n);
            if (!(error instanceof TenraiWalletError) || error.code !== "insufficient" || complete < sending)
                throw error;
            const selected = [];
            const groups = new Map();
            for (const coin of desk.base(context).coins) {
                const group = groups.get(coin.address) ?? [];
                group.push(coin);
                groups.set(coin.address, group);
            }
            for (const [address, coins] of groups) {
                if (selected.length >= remaining)
                    break;
                const batch = planCompound(context.protocol, { ...desk.base(context), coins, destination: address }, remaining - selected.length);
                selected.push(...batch.plans.filter(plan => plan.inputs.length > 1));
            }
            if (!selected.length)
                throw error;
            merge = { steps: selected.map(plan => ({ plan, destination: plan.outputs[0].address })) };
        }
        if (merge.steps.length === 0) {
            return sent;
        }
        const selected = merge.steps;
        const summary = {
            outputs: selected.reduce((count, step) => count + step.plan.inputs.length, 0),
            transfers: selected.length,
            fee: selected.reduce((total, step) => total + step.plan.fee, 0n),
        };
        if (round === 0 && options.confirm && !(await options.confirm(summary))) {
            return sent;
        }
        const steps = await desk.steps(client, context, selected.map((step) => step.plan));
        sent.push(...steps);
        for (const step of steps) {
            const status = await client.transactions.waitForFinal(step.transactionId, {
                validUntil: step.validUntil,
                wireHex: step.wireHex,
                timeoutMillis: options.timeoutMillis ?? MERGE_WAIT_MILLIS,
            });
            if (status.lifecycle !== "finalized") {
                throw new TenraiWalletError(`the compound ${step.transactionId} failed; nothing else was sent`, "rejected", { sent });
            }
        }
        if (sent.length === MAX_STEPS) {
            return sent;
        }
    }
    return sent;
}
export async function sweep(desk, client, request) {
    const context = await desk.context(client, request);
    await context.close();
    const destination = context.protocol.parseAddress(request.to);
    const { plans } = planCompound(context.protocol, { ...desk.base(context), destination }, MAX_STEPS);
    if (plans.length === 0) {
        throw new TenraiWalletError("no output is worth more than its fee", "insufficient");
    }
    return desk.steps(client, context, plans);
}
export async function compound(desk, client, options = {}) {
    const { above = 1, atLeast, ...fee } = options;
    if (!Number.isSafeInteger(above) || above < 1) {
        throw new TenraiWalletError("compound needs a limit of at least 1 output", "invalid");
    }
    if (atLeast !== undefined && (typeof atLeast !== "bigint" || atLeast <= 0n)) {
        throw new TenraiWalletError("atLeast must be a positive bigint of atoms", "invalid");
    }
    const context = await desk.context(client, fee);
    try {
        context.coins = await context.inventory.consolidation(above);
    }
    finally {
        await context.close();
    }
    const base = desk.base(context);
    const byAddress = new Map();
    for (const coin of base.coins) {
        const held = byAddress.get(coin.address);
        if (held) {
            held.push(coin);
        }
        else {
            byAddress.set(coin.address, [coin]);
        }
    }
    const plans = [];
    for (const [address, coins] of byAddress) {
        if ((context.scan.held.find(entry => entry.address === address)?.utxos ?? 0) > Math.max(1, above) && (atLeast === undefined || besidesLargest(coins) >= atLeast) && plans.length < MAX_STEPS) {
            const found = planCompound(context.protocol, { ...base, coins, destination: address }, MAX_STEPS - plans.length);
            plans.push(...found.plans.filter((step) => step.inputs.length > 1));
        }
    }
    return desk.steps(client, context, plans);
}
