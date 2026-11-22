import { TenraiWalletError } from "../errors.js";
/** How long a signed transfer stays valid, in cuts; the manifest may allow less. */
export const VALIDITY_CUTS = 1800n;
const MAX_FEE_ROUNDS = 12;
/** An automatic fee above this multiple of the floor needs a manual rate. */
const FEE_CEILINGS = { minimum: 1n, normal: 4n, priority: 16n };
export function feeRate(priority, estimate, rules) {
    const floor = rules.minimumFeePerMass;
    if (priority === "minimum" || !estimate) {
        return floor;
    }
    if (BigInt(estimate.minimum_fee_per_mass) !== floor
        || !Number.isSafeInteger(estimate.max_transaction_mass)
        || estimate.max_transaction_mass < 0
        || BigInt(estimate.max_transaction_mass) !== rules.maxMass) {
        throw new TenraiWalletError("the fee estimate does not match this network's rules", "rejected");
    }
    const suggested = estimate.suggestions.find((suggestion) => suggestion.priority === priority);
    const rate = suggested ? BigInt(suggested.fee_per_mass) : floor;
    const ceiling = floor * FEE_CEILINGS[priority];
    if (rate > ceiling) {
        throw new TenraiWalletError("the automatic fee is above the wallet's ceiling; pass feePerMass to pay it", "fee-ceiling", {
            rate,
            ceiling,
        });
    }
    return rate > floor ? rate : floor;
}
export function compareCoins(left, right) {
    if (left.transactionId !== right.transactionId) {
        return left.transactionId < right.transactionId ? -1 : 1;
    }
    return left.outputIndex - right.outputIndex;
}
function byAmount(left, right) {
    return left.amount < right.amount ? -1 : left.amount > right.amount ? 1 : 0;
}
function registeredFirst(left, right, referenced) {
    return Number(referenced.has(right.address)) - Number(referenced.has(left.address));
}
/** The fewest inputs that reach `target`: the largest coins, the last one swapped for the smallest that still reaches it. */
function pick(coins, target, limit, referenced) {
    const largest = coins
        .filter((coin) => coin.amount > 0n)
        .sort((a, b) => byAmount(b, a) || registeredFirst(a, b, referenced) || compareCoins(a, b));
    let total = 0n;
    let count = -1;
    for (let index = 0; index < Math.min(limit, largest.length); index += 1) {
        total += largest[index]?.amount ?? 0n;
        if (total >= target) {
            count = index;
            break;
        }
    }
    const counted = largest[count];
    if (count < 0 || !counted) {
        return undefined;
    }
    const base = total - counted.amount;
    const last = largest
        .slice(count)
        .filter((coin) => base + coin.amount >= target)
        .sort((a, b) => registeredFirst(a, b, referenced) || byAmount(a, b) || compareCoins(a, b))[0];
    return last ? [...largest.slice(0, count), last] : undefined;
}
/** Fewer inputs, then fewer inline witnesses, then less change. */
function compareChoices(left, right, referenced) {
    const inline = (coins) => coins.filter((coin) => !referenced.has(coin.address)).length;
    if (left.length !== right.length) {
        return left.length - right.length;
    }
    if (inline(left) !== inline(right)) {
        return inline(left) - inline(right);
    }
    const a = total(left);
    const b = total(right);
    if (a !== b) {
        return a < b ? -1 : 1;
    }
    const first = (coins) => [...coins].sort(compareCoins)[0];
    const [x, y] = [first(left), first(right)];
    return x && y ? compareCoins(x, y) : 0;
}
/** Pays from one address when any can, so addresses are not linked; the same rule as the Tenrai wallets. */
function withIncluded(coins, include, need, limit, referenced) {
    const own = total(include);
    if (own >= need) {
        return [...include];
    }
    const taken = new Set(include.map((coin) => `${coin.transactionId}:${coin.outputIndex}`));
    const rest = coins.filter((coin) => !taken.has(`${coin.transactionId}:${coin.outputIndex}`));
    return [...include, ...selectCoins(rest, need - own, limit - include.length, referenced)];
}
export function selectCoins(coins, target, limit, referenced) {
    const byAddress = new Map();
    for (const coin of coins) {
        byAddress.set(coin.address, [...(byAddress.get(coin.address) ?? []), coin]);
    }
    let alone;
    for (const group of byAddress.values()) {
        const chosen = pick(group, target, limit, referenced);
        if (chosen && (!alone || compareChoices(chosen, alone, referenced) < 0)) {
            alone = chosen;
        }
    }
    const chosen = alone ?? pick(coins, target, limit, referenced);
    if (chosen) {
        return chosen;
    }
    const available = coins.reduce((sum, coin) => sum + (coin.amount > 0n ? coin.amount : 0n), 0n);
    if (available >= target) {
        throw new TenraiWalletError("the amount needs more inputs than one transaction may carry", "compound-needed", {
            available,
            maxInputs: limit,
        });
    }
    throw new TenraiWalletError("not enough spendable funds", "insufficient", { available, required: target });
}
/**
 * An address with more outputs than one transaction spends also gives its smallest ones worth more than
 * their fee, so they leave with the change instead of piling up; the same rule as the Tenrai wallets.
 */
export function fillCoins(chosen, coins, limit, referenced, fees) {
    const addresses = new Set(chosen.map((coin) => coin.address));
    const held = coins.filter((coin) => addresses.has(coin.address));
    const free = limit - chosen.length;
    if (free <= 0 || held.length <= limit) {
        return chosen;
    }
    const key = (coin) => `${coin.transactionId}:${coin.outputIndex}`;
    const taken = new Set(chosen.map(key));
    const rest = held
        .filter((coin) => !taken.has(key(coin)) && coin.amount > (referenced.has(coin.address) ? fees.referenced : fees.inline))
        .sort((a, b) => byAmount(a, b) || compareCoins(a, b));
    return [...chosen, ...rest.slice(0, free)];
}
export function inputFees(protocol, request) {
    const floor = protocol.rules.minimumFeePerMass;
    const rate = request.feePerMass > floor ? request.feePerMass : floor;
    const weigh = (profiles) => protocol.quote(protocol.encodeBody({
        valid_from_height: request.validFrom.toString(),
        valid_until_height: request.validUntil.toString(),
        inputs: profiles.map((_, index) => ({ transaction_id: "00".repeat(48), output_index: String(index) })),
        outputs: [{ address: request.changeAddress, amount: "1" }],
    }), profiles).mass;
    const one = weigh(["inline"]);
    return {
        inline: (weigh(["inline", "inline"]) - one) * rate,
        referenced: (weigh(["inline", "referenced"]) - one) * rate,
    };
}
function total(coins) {
    return coins.reduce((sum, coin) => sum + coin.amount, 0n);
}
/** Inputs plus released minus outputs minus reserved is the fee; it only grows between rounds, so the loop settles. */
export function plan(protocol, request) {
    try {
        return rounds(protocol, request, false);
    }
    catch (error) {
        if (request.sweep !== undefined || !(error instanceof TenraiWalletError) || (error.code !== "insufficient" && error.code !== "compound-needed")) {
            throw error;
        }
        // Without room for a change output the rest joins the fee, as for the most a wallet can send.
        try {
            return rounds(protocol, request, true);
        }
        catch {
            throw error;
        }
    }
}
function rounds(protocol, request, withoutChange) {
    const { rules } = protocol;
    const reserved = request.reserved ?? 0n;
    const released = request.released ?? 0n;
    const paid = request.payments.reduce((sum, payment) => sum + payment.amount, 0n);
    const operationSigners = operationAuthorityCount(request.operation);
    let limit = Math.min(rules.maxInputs, rules.maxWitnesses - operationSigners);
    if (limit < 1) {
        throw new TenraiWalletError("the operation leaves no room for an input witness", "too-heavy");
    }
    const fees = request.sweep === undefined && !request.operation && !withoutChange ? inputFees(protocol, request) : undefined;
    limits: for (;;) {
        let fee = 0n;
        for (let round = 0; round < MAX_FEE_ROUNDS; round += 1) {
            let inputs;
            let outputs;
            if (request.sweep !== undefined) {
                inputs = request.coins.slice(0, limit);
                const available = total(inputs) + released;
                const required = reserved + fee;
                if (inputs.length === 0 || available <= required) {
                    throw new TenraiWalletError("these outputs do not cover the fee", "insufficient", { available, required });
                }
                outputs = [{ address: request.sweep, amount: available - required }];
            }
            else {
                const required = paid + reserved + fee;
                const need = required > released ? required - released : 0n;
                const include = request.include ?? [];
                inputs = include.length
                    ? withIncluded(request.coins, include, need, limit, request.referenced)
                    : selectCoins(request.coins, need > 0n ? need : 1n, limit, request.referenced);
                if (fees && !include.length) {
                    inputs = fillCoins(inputs, request.coins, limit, request.referenced, fees);
                }
                const change = total(inputs) + released - required;
                outputs = change > 0n && !withoutChange ? [...request.payments, { address: request.changeAddress, amount: change }] : [...request.payments];
            }
            inputs.sort(compareCoins);
            if (outputs.length > rules.maxOutputs) {
                throw new TenraiWalletError("too many recipients for one transaction", "too-many-outputs");
            }
            const body = protocol.encodeBody({
                valid_from_height: request.validFrom.toString(),
                valid_until_height: request.validUntil.toString(),
                inputs: inputs.map((coin) => ({ transaction_id: coin.transactionId, output_index: String(coin.outputIndex) })),
                outputs: outputs.map((output) => ({ address: output.address, amount: output.amount.toString() })),
                ...(request.payloadHex ? { payload_hex: request.payloadHex } : {}),
                ...(request.operation ? { operation: request.operation } : {}),
            });
            const profiles = inputs.map((coin) => (request.referenced.has(coin.address) ? "referenced" : "inline"));
            let quote;
            try {
                quote = protocol.quote(body, profiles);
            }
            catch (error) {
                // Too many bytes: fewer, larger inputs may fit, else the coins need compounding first; a sweep spends what it got.
                if (error instanceof TenraiWalletError && error.code === "too-heavy" && inputs.length > 1 && request.sweep === undefined) {
                    limit = inputs.length - 1;
                    continue limits;
                }
                throw error;
            }
            if (quote.witnesses !== inputs.length + operationSigners) {
                throw new TenraiWalletError("the protocol package counts a different number of signers", "rejected");
            }
            const byMass = quote.mass * request.feePerMass;
            const needed = byMass > quote.minimumFee ? byMass : quote.minimumFee;
            const paying = withoutChange ? total(inputs) + released - paid - reserved : fee;
            if (needed <= paying) {
                if (withoutChange && paying - needed > needed) {
                    throw new TenraiWalletError("leaving the change out would more than double the fee", "insufficient");
                }
                const view = protocol.inspectBody(body);
                const outputTotal = view.outputs.reduce((sum, output) => sum + output.amount, 0n);
                if (total(inputs) + released - outputTotal - reserved !== paying) {
                    throw new TenraiWalletError("the built transaction does not balance", "rejected");
                }
                return { body, view, quote, fee: paying, inputs, profiles, outputs, operation: request.operation };
            }
            fee = needed;
        }
        throw new TenraiWalletError("the fee did not settle", "fee-unsettled");
    }
}
/**
 * Moves coins to `destination` in as few transactions as the input limit allows: the smallest coins
 * first, with large ones added when small ones cannot pay their fee. Coins nothing can pay for are skipped.
 * Planning stops after `most` transactions; the coins left over wait for the next call.
 */
export function planCompound(protocol, request, most = Number.POSITIVE_INFINITY) {
    const { destination, ...common } = request;
    const remaining = [...request.coins].sort((a, b) => byAmount(a, b) || compareCoins(a, b));
    const limit = Math.min(protocol.rules.maxInputs, protocol.rules.maxWitnesses);
    const plans = [];
    while (remaining.length > 0 && plans.length < most) {
        let selected;
        for (let inputs = Math.min(limit, remaining.length); inputs >= 1 && !selected; inputs -= 1) {
            const most = inputs === remaining.length ? 0 : inputs;
            for (let high = 0; high <= most; high += 1) {
                const low = inputs - high;
                const group = [...remaining.slice(0, low), ...(high === 0 ? [] : remaining.slice(remaining.length - high))];
                try {
                    const planned = plan(protocol, {
                        ...common,
                        coins: group,
                        payments: [],
                        changeAddress: destination,
                        payloadHex: "",
                        sweep: destination,
                    });
                    selected = { planned, low, high };
                    break;
                }
                catch (error) {
                    if (!(error instanceof TenraiWalletError && (error.code === "insufficient" || error.code === "too-heavy"))) {
                        throw error;
                    }
                }
            }
        }
        if (!selected) {
            return { plans, skipped: remaining };
        }
        remaining.splice(0, selected.low);
        remaining.splice(remaining.length - selected.high, selected.high);
        plans.push(selected.planned);
    }
    return { plans, skipped: [] };
}
const MERGE_ROUNDS = 4;
/**
 * The compounds that let `sending` go out in one transfer: the largest outputs of each address, the addresses
 * worth most after the fees first, each into `destination` of its address; the same rule as the Tenrai wallets.
 * Throws `insufficient` when the outputs are not worth enough after their fees.
 */
export function planMerge(protocol, request, sending, destination = (address) => address, most = Number.POSITIVE_INFINITY) {
    const limit = Math.min(protocol.rules.maxInputs, protocol.rules.maxWitnesses);
    const fees = inputFees(protocol, { ...request, payments: [], payloadHex: "" });
    // The payment itself may fill every input.
    const target = sending + fees.inline * BigInt(limit + 1);
    const worth = (coin) => coin.amount - (request.referenced.has(coin.address) ? fees.referenced : fees.inline);
    let held = request.coins;
    const merge = { steps: [], outputs: 0, transfers: 0, fee: 0n };
    for (let round = 0; round < MERGE_ROUNDS; round += 1) {
        try {
            selectCoins(held, target, limit, request.referenced);
            break;
        }
        catch (error) {
            if (!(error instanceof TenraiWalletError) || error.code !== "compound-needed") {
                throw error;
            }
        }
        const remaining = most - merge.transfers;
        if (remaining <= 0) {
            return merge;
        }
        const steps = mergeRound(protocol, request, held, target, worth, destination, remaining);
        if (steps.length === 0) {
            throw new TenraiWalletError("the outputs are not worth the amount after their fees", "insufficient", {
                available: total(held),
                required: target,
            });
        }
        const key = (coin) => `${coin.transactionId}:${coin.outputIndex}`;
        const spent = new Set(steps.flatMap((step) => step.plan.inputs.map(key)));
        const retained = held.filter((coin) => !spent.has(key(coin)));
        const seen = new Set(retained.map(key));
        const created = [];
        for (const step of steps) {
            const body = protocol.inspectBody(step.plan.body);
            const output = body.outputs[0];
            if (body.outputs.length !== 1 || !output || output.address !== step.destination) {
                throw new TenraiWalletError("the compound plan has an unexpected output", "rejected");
            }
            const coin = {
                address: output.address,
                transactionId: body.transactionId,
                outputIndex: 0,
                amount: output.amount,
            };
            if (seen.has(key(coin))) {
                throw new TenraiWalletError("the compound plan reuses an output", "rejected");
            }
            seen.add(key(coin));
            created.push(coin);
        }
        held = [...retained, ...created];
        merge.transfers += steps.length;
        merge.fee = steps.reduce((fee, step) => fee + step.plan.fee, merge.fee);
        if (round === 0) {
            merge.outputs = spent.size;
            merge.steps = steps;
        }
        if (merge.transfers >= most) {
            return merge;
        }
    }
    return merge;
}
/** The largest outputs of each address until what they are worth after their fees covers `target`; none when all do not. */
function mergeRound(protocol, request, held, target, worth, destination, most) {
    const byAddress = new Map();
    for (const coin of held) {
        if (worth(coin) > 0n) {
            byAddress.set(coin.address, [...(byAddress.get(coin.address) ?? []), coin]);
        }
    }
    const value = (coins) => coins.reduce((sum, coin) => sum + worth(coin), 0n);
    const groups = [...byAddress.values()]
        .map((coins) => coins.sort((a, b) => byAmount(b, a) || compareCoins(a, b)))
        .sort((a, b) => {
        const [x, y] = [value(a), value(b)];
        const [first, second] = [a[0], b[0]];
        return x > y ? -1 : x < y ? 1 : first && second ? compareCoins(first, second) : 0;
    });
    const steps = [];
    let missing = target;
    for (const coins of groups) {
        if (missing <= 0n || steps.length >= most) {
            break;
        }
        const taken = [];
        for (const coin of coins) {
            if (missing <= 0n) {
                break;
            }
            taken.push(coin);
            missing -= worth(coin);
        }
        const first = taken[0];
        if (!first) {
            continue;
        }
        const into = destination(first.address);
        const remaining = most - steps.length;
        for (const planned of planCompound(protocol, { ...request, coins: taken, destination: into }, remaining).plans) {
            if (planned.inputs.length > 1) {
                steps.push({ plan: planned, destination: into });
            }
        }
    }
    // A bounded caller continues with the remaining addresses in a later run.
    return missing > 0n && steps.length < most ? [] : steps;
}
/** Signs every input and the operation, then decodes and verifies the result before anyone can submit it. */
export function sign(protocol, planned, signerFor, authorities = {}) {
    const byOutpoint = new Map(planned.inputs.map((coin) => [`${coin.transactionId}:${coin.outputIndex}`, coin]));
    const ordered = planned.view.inputs.map((input) => {
        const coin = byOutpoint.get(`${input.transactionId}:${input.outputIndex}`);
        if (!coin) {
            throw new TenraiWalletError("the body spends an output the wallet did not choose", "rejected");
        }
        return coin;
    });
    const witnesses = [];
    const referencedKeys = new Map();
    ordered.forEach((coin, index) => {
        const signer = signerFor(coin);
        const profile = planned.profiles[index] ?? "inline";
        const signature = signer.sign(protocol.spendMessage(planned.body, index, coin));
        witnesses.push(protocol.witness(profile, signer.publicKey, signature));
        if (profile === "referenced") {
            referencedKeys.set(coin.address, signer.publicKey);
        }
    });
    const required = operationAuthorities(planned.operation);
    if (Boolean(authorities.owner) !== required.owner || Boolean(authorities.possession) !== required.possession || Boolean(authorities.validator) !== required.validator) {
        throw new TenraiWalletError("the operation has the wrong authorization set", "rejected");
    }
    if (authorities.owner) {
        const signature = authorities.owner.signer.sign(protocol.operationMessage(planned.body));
        witnesses.push(protocol.witness("inline", authorities.owner.signer.publicKey, signature));
    }
    if (authorities.possession) {
        const signature = authorities.possession.sign(protocol.possessionMessage(planned.body));
        witnesses.push(protocol.witness("inline", authorities.possession.publicKey, signature));
    }
    if (authorities.validator) {
        const signature = authorities.validator.sign(protocol.operationMessage(planned.body));
        witnesses.push(protocol.witness("inline", authorities.validator.publicKey, signature));
    }
    const joined = new Uint8Array(witnesses.reduce((sum, witness) => sum + witness.length, 0));
    let offset = 0;
    for (const witness of witnesses) {
        joined.set(witness, offset);
        offset += witness.length;
    }
    const wire = protocol.assemble(planned.body, joined);
    const inspection = protocol.inspect(wire);
    if (inspection.transactionId !== planned.view.transactionId || inspection.mass !== planned.quote.mass) {
        throw new TenraiWalletError("the signed transaction differs from the planned one", "rejected");
    }
    protocol.verify(wire, ordered, [...referencedKeys.values()], authorities.owner?.address);
    return { wire, transactionId: inspection.transactionId };
}
export function operationAuthorityCount(operation) {
    const required = operationAuthorities(operation);
    return Number(required.owner) + Number(required.possession) + Number(required.validator);
}
function operationAuthorities(operation) {
    switch (operation?.type) {
        case undefined:
            return { owner: false, possession: false, validator: false };
        case "register":
        case "rotate":
        case "endpoint":
            return { owner: true, possession: true, validator: false };
        case "heartbeat":
            return { owner: false, possession: false, validator: true };
        case "bond":
        case "exit":
        case "unbond":
        case "withdraw":
        case "reward_lock":
        case "commission":
            return { owner: true, possession: false, validator: false };
    }
}
