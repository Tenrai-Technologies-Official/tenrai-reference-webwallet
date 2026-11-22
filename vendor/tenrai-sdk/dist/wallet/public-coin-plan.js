import { TenraiWalletError } from "../errors.js";
import { compareCoins, inputFees, operationAuthorityCount } from "./plan.js";
import { checkedCoinTotal } from "./public-coin-source.js";
import { firstFromSource, selectFromSource, fillFromSource, includedFromSource } from "./public-coin-selection.js";
const MAX_FEE_ROUNDS = 12;
const total = (rows) => rows.reduce((sum, coin) => checkedCoinTotal(sum, coin.amount), 0n);
export async function planFromSource(protocol, request, source) {
    try {
        return await rounds(protocol, request, false, source);
    }
    catch (error) {
        if (request.sweep !== undefined || !(error instanceof TenraiWalletError) || (error.code !== "insufficient" && error.code !== "compound-needed"))
            throw error;
        try {
            return await rounds(protocol, request, true, source);
        }
        catch {
            throw error;
        }
    }
}
async function rounds(protocol, request, withoutChange, source) {
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
                inputs = await firstFromSource(source, limit);
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
                    ? await includedFromSource(source, include, need, limit, request.referenced)
                    : await selectFromSource(source, need > 0n ? need : 1n, limit, request.referenced);
                if (fees && !include.length) {
                    inputs = await fillFromSource(source, inputs, limit, request.referenced, fees);
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
