import { TenraiWalletError } from "../errors.js";
export const PUBLIC_KEY_BYTES = 1952;
export const SIGNATURE_BYTES = 3309;
const MESSAGE_BYTES = 48;
const HASH = /^[0-9a-f]{96}$/;
const COUNT = /^(0|[1-9][0-9]{0,38})$/;
const MAX_JSON_CHARS = 256 * 1024;
/** The Rust transaction rules bound to one node's manifest; every answer is checked again. */
export class ProtocolRules {
    rules;
    #wasm;
    #manifest;
    constructor(wasm, manifest) {
        this.#wasm = wasm;
        this.#manifest = call("validateManifest", () => wasm.validateManifest(JSON.stringify(manifest)));
        this.rules = rules(parse(this.#manifest, "manifest"));
    }
    transactionManifest() { return this.#manifest; }
    parseAddress(text, network = this.rules.network) {
        if (typeof text !== "string" || text.length === 0 || text.length > 128) {
            throw new TenraiWalletError("the address is invalid", "invalid");
        }
        return call("parseAddress", () => this.#wasm.parseAddress(text.trim(), network));
    }
    encodeBody(request) {
        const body = call("encodeTransactionBody", () => this.#wasm.encodeTransactionBody(JSON.stringify(request), this.#manifest));
        if (body.length === 0 || body.length > this.rules.maxWireBytes) {
            throw new TenraiWalletError("the transaction body is too large", "too-heavy");
        }
        return body;
    }
    inspectBody(body) {
        const view = parse(call("inspectTransactionBody", () => this.#wasm.inspectTransactionBody(body, this.#manifest)), "body");
        if (hash(view["chain_id"]) !== this.rules.chainId || !Array.isArray(view["inputs"]) || !Array.isArray(view["outputs"])) {
            throw new TenraiWalletError("the protocol package built a body for another chain", "rejected");
        }
        return {
            transactionId: hash(view["transaction_id"]),
            inputs: view["inputs"].map((input) => ({
                transactionId: hash(input["transaction_id"]),
                outputIndex: Number(count(input["output_index"])),
            })),
            outputs: view["outputs"].map((output) => ({
                address: String(output["address"]),
                amount: count(output["amount"]),
            })),
        };
    }
    /** The protocol package refuses to quote a transaction over the limits, which counts as too heavy. */
    quote(body, profiles) {
        let text;
        try {
            text = profiles.includes("referenced")
                ? this.#wasm.quoteTransactionWithInputProfiles(body, JSON.stringify(profiles), this.#manifest)
                : this.#wasm.quoteTransaction(body, this.#manifest);
        }
        catch {
            throw new TenraiWalletError("the transaction is heavier than the node accepts", "too-heavy");
        }
        const quote = parse(text, "quote");
        const mass = count(quote["mass"]);
        if (mass > this.rules.maxMass) {
            throw new TenraiWalletError("the transaction is heavier than the node accepts", "too-heavy");
        }
        return { mass, minimumFee: count(quote["minimum_fee"]), witnesses: Number(count(quote["witnesses"])) };
    }
    spendMessage(body, index, previous) {
        const message = call("spendMessage", () => this.#wasm.spendMessage(body, String(index), JSON.stringify({ address: previous.address, amount: previous.amount.toString() }), this.#manifest));
        return sized(message, MESSAGE_BYTES, "spend message");
    }
    operationMessage(body) {
        const message = call("operationMessage", () => this.#wasm.operationMessage(body, this.#manifest));
        return sized(message, MESSAGE_BYTES, "operation message");
    }
    possessionMessage(body) {
        const message = call("possessionMessage", () => this.#wasm.possessionMessage(body, this.#manifest));
        return sized(message, MESSAGE_BYTES, "possession message");
    }
    witness(profile, publicKey, signature) {
        return profile === "inline"
            ? call("encodeWitness", () => this.#wasm.encodeWitness(publicKey, signature))
            : call("encodeWitnessWithProfile", () => this.#wasm.encodeWitnessWithProfile("referenced", null, signature));
    }
    assemble(body, witnesses) {
        const wire = call("assembleTransaction", () => this.#wasm.assembleTransaction(body, witnesses, this.#manifest));
        if (wire.length > this.rules.maxWireBytes) {
            throw new TenraiWalletError("the signed transaction is too large", "too-heavy");
        }
        return wire;
    }
    inspect(wire) {
        const view = parse(call("inspectTransaction", () => this.#wasm.inspectTransaction(wire, this.#manifest)), "transaction");
        return { transactionId: hash(view["transaction_id"]), mass: count(view["mass"]) };
    }
    /** Throws unless every input, and the owner of an operation, signed exactly this transaction. */
    verify(wire, previous, referenced, owner) {
        const outputs = JSON.stringify(previous.map((output) => ({ address: output.address, amount: output.amount.toString() })));
        if (referenced.length === 0) {
            call("verifyTransaction", () => this.#wasm.verifyTransaction(wire, outputs, owner, this.#manifest));
            return;
        }
        const keys = JSON.stringify(referenced.map(toHex));
        call("verifyTransactionWithReferencedKeys", () => this.#wasm.verifyTransactionWithReferencedKeys(wire, outputs, owner, keys, this.#manifest));
    }
}
export function toHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function call(method, run) {
    try {
        return run();
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new TenraiWalletError(`the protocol rules refused ${method}: ${reason}`, "rejected");
    }
}
function parse(text, label) {
    if (typeof text !== "string" || text.length === 0 || text.length > MAX_JSON_CHARS) {
        throw new TenraiWalletError(`the protocol package returned an invalid ${label}`, "rejected");
    }
    const value = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new TenraiWalletError(`the protocol package returned an invalid ${label}`, "rejected");
    }
    return value;
}
function count(value) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
        return BigInt(value);
    }
    if (typeof value !== "string" || !COUNT.test(value)) {
        throw new TenraiWalletError("the protocol package returned an invalid number", "rejected");
    }
    return BigInt(value);
}
function hash(value) {
    if (typeof value !== "string" || !HASH.test(value)) {
        throw new TenraiWalletError("the protocol package returned an invalid id", "rejected");
    }
    return value;
}
function sized(bytes, length, label) {
    if (bytes.length !== length) {
        throw new TenraiWalletError(`the protocol package returned a ${label} of the wrong length`, "rejected");
    }
    return bytes;
}
function rules(manifest) {
    const limits = manifest["transaction_limits"];
    const finalized = manifest["finalized"];
    const network = manifest["network"];
    if (!limits || !finalized || typeof network !== "string") {
        throw new TenraiWalletError("the manifest is incomplete", "rejected");
    }
    const small = (value) => {
        const number = count(value);
        if (number > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new TenraiWalletError("the manifest holds an out-of-range limit", "rejected");
        }
        return Number(number);
    };
    return {
        network: network,
        chainId: hash(manifest["chain_id"]),
        finalizedHeight: count(finalized["height"]),
        maxInputs: small(limits["max_inputs"]),
        maxOutputs: small(limits["max_outputs"]),
        maxWitnesses: small(limits["max_witnesses"]),
        maxWireBytes: small(limits["max_wire_bytes"]),
        minimumFeePerMass: count(manifest["minimum_fee_per_mass"]),
        maxMass: count(manifest["max_transaction_mass"]),
        maxPayloadBytes: small(manifest["max_transparent_payload_bytes"]),
        maxValidityCuts: count(manifest["max_validity_cuts"]),
    };
}
