import { TenraiWalletError } from "../errors.js";
import { protocolBindings } from "./runtime.js";
export const MAX_MULTISIG_PACKAGE_BYTES = 256 * 1024;
export const MULTISIG_PUBLIC_KEY_BYTES = 1_952;
export const MULTISIG_SIGNATURE_BYTES = 3_309;
const HASH = /^[0-9a-f]{96}$/;
const LOCK = /^[0-9a-f]{82}$/;
const PUBLIC_KEY = /^[0-9a-f]{3904}$/;
const COUNT = /^(0|[1-9][0-9]{0,38})$/;
const NETWORKS = ["mainnet", "testnet", "testnet100", "development"];
const MESSAGE_BYTES = 48;
/** Manifest-bound offline packages for transparent 2-of-3 and 3-of-5 payments. */
export class MultisigSession {
    network;
    chainId;
    maxWireBytes;
    #wasm;
    #manifest;
    constructor(wasm, manifest, network, chainId, maxWireBytes) {
        this.#wasm = wasm;
        this.#manifest = manifest;
        this.network = network;
        this.chainId = chainId;
        this.maxWireBytes = maxWireBytes;
    }
    static async fromManifest(manifest) {
        const wasm = await protocolBindings();
        let canonical;
        try {
            canonical = wasm.validateManifest(JSON.stringify(manifest));
        }
        catch (error) {
            throw rejected("the transaction manifest is invalid", error);
        }
        const view = record(json(canonical, "manifest"), "manifest");
        const network = view["network"];
        const chainId = view["chain_id"];
        const limits = record(view["transaction_limits"], "transaction limits");
        if (typeof network !== "string" || !NETWORKS.includes(network) || !hash(chainId)) {
            throw invalid("the transaction manifest is incomplete");
        }
        return new MultisigSession(wasm, canonical, network, chainId, safeNumber(limits["max_wire_bytes"], "maximum wire bytes"));
    }
    encodeBody(request) {
        let requestJson;
        try {
            requestJson = JSON.stringify(request);
        }
        catch (error) {
            throw invalid("the multisig payment request is invalid", error);
        }
        return wire(this.call("encodeTransactionBody", () => this.#wasm.encodeTransactionBody(requestJson, this.#manifest)), this.maxWireBytes);
    }
    createDescriptor(threshold, members) {
        if ((threshold !== 2 && threshold !== 3) || members.length !== (threshold === 2 ? 3 : 5)) {
            throw invalid("a multisig descriptor must be 2-of-3 or 3-of-5");
        }
        const encoded = members.map((member) => hex(member, MULTISIG_PUBLIC_KEY_BYTES, "a multisig public key"));
        return descriptor(this.call("createMultisigDescriptor", () => this.#wasm.createMultisigDescriptor(String(threshold), JSON.stringify(encoded))));
    }
    validateDescriptor(value) {
        const source = descriptorText(value);
        return descriptor(this.call("validateMultisigDescriptor", () => this.#wasm.validateMultisigDescriptor(source)));
    }
    address(value) {
        const descriptorValue = this.validateDescriptor(value);
        return this.call("multisigAddress", () => this.#wasm.multisigAddress(descriptorText(descriptorValue), this.network));
    }
    createPackage(descriptorValue, body, inputAmounts) {
        const descriptorText = descriptorTextFor(this.validateDescriptor(descriptorValue));
        const bodyBytes = wire(body, this.maxWireBytes);
        const amounts = inputAmounts.map((amount) => atoms(amount, "an input amount"));
        return packageBytes(this.call("createMultisigPackage", () => this.#wasm.createMultisigPackage(descriptorText, bodyBytes, JSON.stringify(amounts), this.#manifest)));
    }
    decodePackage(value) {
        return packageBytes(this.call("decodeMultisigPackage", () => this.#wasm.decodeMultisigPackage(packageBytes(value), this.#manifest)));
    }
    review(value) {
        const review = record(json(this.call("reviewMultisigPackage", () => this.#wasm.reviewMultisigPackage(packageBytes(value), this.#manifest)), "multisig package review"), "multisig package review");
        const checked = reviewPackage(review, this.network, this.chainId);
        if (this.address(checked.descriptor) !== checked.descriptor.address) {
            throw rejected("the protocol package returned an inconsistent multisig descriptor address");
        }
        return checked;
    }
    signingMessages(value, reviewedTemplate, publicKey) {
        const response = record(json(this.call("multisigPackageSigningMessages", () => this.#wasm.multisigPackageSigningMessages(packageBytes(value), template(reviewedTemplate), key(publicKey), this.#manifest)), "multisig signing messages"), "multisig signing messages");
        const messages = list(response["messages"], "multisig signing messages").map((entry) => bytesFromHex(entry, MESSAGE_BYTES, "a multisig signing message"));
        if (!hash(response["template_digest"]) || response["template_digest"] !== reviewedTemplate || !hash(response["transaction_id"])) {
            throw rejected("the protocol package returned an invalid multisig signing binding");
        }
        return Object.freeze({
            templateDigest: response["template_digest"],
            transactionId: response["transaction_id"],
            memberIndex: safeNumber(response["member_index"], "multisig member index"),
            messages: Object.freeze(messages),
        });
    }
    addMemberSignatures(value, reviewedTemplate, publicKey, signatures) {
        const encoded = signatures.map((signature) => hex(signature, MULTISIG_SIGNATURE_BYTES, "a multisig signature"));
        return packageBytes(this.call("addMultisigPackageSignatures", () => this.#wasm.addMultisigPackageSignatures(packageBytes(value), template(reviewedTemplate), key(publicKey), JSON.stringify(encoded), this.#manifest)));
    }
    signMember(value, reviewedTemplate, publicKey, sign) {
        if (typeof sign !== "function") {
            throw invalid("the multisig signer is invalid");
        }
        const messages = this.signingMessages(value, reviewedTemplate, publicKey);
        const signatures = messages.messages.map((message) => sign(new Uint8Array(message)));
        return this.addMemberSignatures(value, reviewedTemplate, publicKey, signatures);
    }
    combine(left, right) {
        return packageBytes(this.call("combineMultisigPackages", () => this.#wasm.combineMultisigPackages(packageBytes(left), packageBytes(right), this.#manifest)));
    }
    transactionManifest() { return this.#manifest; }
    complete(value) {
        return wire(this.call("completeMultisigPackage", () => this.#wasm.completeMultisigPackage(packageBytes(value), this.#manifest)), this.maxWireBytes);
    }
    call(method, run) {
        try {
            return run();
        }
        catch (error) {
            throw rejected(`the protocol rules refused ${method}`, error);
        }
    }
}
function reviewPackage(value, network, chainId) {
    const payload = value["payload_hex"];
    const expected = [
        "chain_id", "complete", "descriptor", "fee", "input_count", "inputs", "missing_signatures", "outputs",
        "protocol_version", "required_signatures", "rules_hash", "signatures", "template_digest", "transaction_id", "valid_from_height", "valid_until_height", "witness_profile",
    ];
    exactOptional(value, expected, "payload_hex", "multisig review");
    if (!hash(value["template_digest"]) || !hash(value["transaction_id"]) || value["chain_id"] !== chainId || !hash(value["rules_hash"]) || typeof value["complete"] !== "boolean") {
        throw rejected("the protocol package returned an invalid multisig review");
    }
    const inputs = list(value["inputs"], "multisig inputs").map((entry) => {
        const input = record(entry, "multisig input");
        exact(input, ["amount", "index", "output_index", "transaction_id"], "multisig input");
        return Object.freeze({
            index: safeNumber(input["index"], "multisig input index"),
            transactionId: hashValue(input["transaction_id"], "multisig input transaction ID"),
            outputIndex: safeNumber(input["output_index"], "multisig input output index"),
            amount: decimal(input["amount"], "multisig input amount"),
        });
    });
    const outputs = list(value["outputs"], "multisig outputs").map((entry) => {
        const output = record(entry, "multisig output");
        exact(output, ["address", "amount", "index", "lock"], "multisig output");
        const address = output["address"];
        if (typeof address !== "string" || !address.startsWith(network === "mainnet" ? "trai1" : network === "development" ? "dtrai1" : "ttrai1")) {
            throw rejected("the protocol package returned an invalid multisig output");
        }
        return Object.freeze({
            index: safeNumber(output["index"], "multisig output index"),
            address,
            amount: decimal(output["amount"], "multisig output amount"),
            lock: lock(output["lock"]),
        });
    });
    const descriptorValue = record(value["descriptor"], "multisig descriptor");
    exact(descriptorValue, ["address", "members", "threshold"], "multisig descriptor");
    const descriptorAddress = descriptorValue["address"];
    if (typeof descriptorAddress !== "string") {
        throw rejected("the protocol package returned an invalid multisig descriptor");
    }
    const parsedDescriptor = descriptor(JSON.stringify({ threshold: descriptorValue["threshold"], members: descriptorValue["members"] }));
    const witnessProfile = reviewWitnessProfile(value["witness_profile"]);
    const signatures = list(value["signatures"], "multisig signatures").map((entry) => {
        const signature = record(entry, "multisig signature");
        exact(signature, ["input_index", "member_index"], "multisig signature");
        return Object.freeze({
            inputIndex: safeNumber(signature["input_index"], "multisig signature input index"),
            memberIndex: safeNumber(signature["member_index"], "multisig signature member index"),
        });
    });
    if (payload !== undefined && (typeof payload !== "string" || !/^(?:[0-9a-f]{2})*$/.test(payload))) {
        throw rejected("the protocol package returned an invalid multisig payload");
    }
    const inputCount = safeNumber(value["input_count"], "multisig input count");
    if (inputCount !== inputs.length || !strictIndices(inputs.map((input) => input.index)) || !strictIndices(outputs.map((output) => output.index))) {
        throw rejected("the protocol package returned an inconsistent multisig review");
    }
    const requiredSignatures = safeNumber(value["required_signatures"], "required multisig signatures");
    const missingSignatures = safeNumber(value["missing_signatures"], "missing multisig signatures");
    if (!canonicalSignatures(signatures, inputs.length, parsedDescriptor.members.length)
        || requiredSignatures !== inputs.length * parsedDescriptor.threshold
        || missingSignatures !== requiredSignatures - signatures.length
        || value["complete"] !== (missingSignatures === 0)
        || inputs.reduce((sum, input) => sum + input.amount, 0n) !== outputs.reduce((sum, output) => sum + output.amount, 0n) + decimal(value["fee"], "multisig fee")) {
        throw rejected("the protocol package returned an inconsistent multisig review");
    }
    return Object.freeze({
        templateDigest: value["template_digest"],
        transactionId: value["transaction_id"],
        chainId,
        protocolVersion: safeNumber(value["protocol_version"], "multisig protocol version"),
        rulesHash: value["rules_hash"],
        validFromHeight: decimal(value["valid_from_height"], "multisig valid-from height"),
        validUntilHeight: decimal(value["valid_until_height"], "multisig valid-until height"),
        inputs: Object.freeze(inputs),
        outputs: Object.freeze(outputs),
        fee: decimal(value["fee"], "multisig fee"),
        descriptor: Object.freeze({ ...parsedDescriptor, address: descriptorAddress }),
        witnessProfile,
        signatures: Object.freeze(signatures),
        requiredSignatures,
        missingSignatures,
        complete: value["complete"],
        payloadHex: payload,
    });
}
function reviewWitnessProfile(value) {
    if (value === "threshold-ml-dsa-65-inline" || value === "threshold-ml-dsa-65-referenced") {
        return value;
    }
    throw rejected("the protocol package returned an invalid multisig witness profile");
}
function descriptor(value) {
    const source = record(json(value, "multisig descriptor"), "multisig descriptor");
    exact(source, ["members", "threshold"], "multisig descriptor");
    const threshold = source["threshold"];
    if (threshold !== "2" && threshold !== "3") {
        throw rejected("the protocol package returned an invalid multisig descriptor");
    }
    const members = list(source["members"], "multisig members").map((member) => {
        if (typeof member !== "string" || !PUBLIC_KEY.test(member)) {
            throw rejected("the protocol package returned an invalid multisig descriptor");
        }
        return member;
    });
    if (members.length !== (threshold === "2" ? 3 : 5) || members.some((member, index) => index > 0 && members[index - 1] >= member)) {
        throw rejected("the protocol package returned a noncanonical multisig descriptor");
    }
    return Object.freeze({ threshold: Number(threshold), members: Object.freeze(members) });
}
function descriptorText(value) {
    if (typeof value === "string") {
        return value;
    }
    return descriptorTextFor(value);
}
function descriptorTextFor(value) {
    return JSON.stringify({ threshold: String(value.threshold), members: value.members });
}
function packageBytes(value) {
    if (!(value instanceof Uint8Array) || value.length === 0 || value.length > MAX_MULTISIG_PACKAGE_BYTES) {
        throw invalid("the multisig package is invalid");
    }
    return new Uint8Array(value);
}
function wire(value, maximum) {
    if (!(value instanceof Uint8Array) || value.length === 0 || value.length > maximum) {
        throw rejected("the protocol package returned an invalid transaction");
    }
    return new Uint8Array(value);
}
function template(value) {
    return hashValue(value, "the reviewed multisig template");
}
function key(value) {
    if (!(value instanceof Uint8Array) || value.length !== MULTISIG_PUBLIC_KEY_BYTES) {
        throw invalid("the multisig public key is invalid");
    }
    return new Uint8Array(value);
}
function hex(value, length, label) {
    if (!(value instanceof Uint8Array) || value.length !== length) {
        throw invalid(`${label} is invalid`);
    }
    return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function bytesFromHex(value, length, label) {
    if (typeof value !== "string" || value.length !== length * 2 || !/^[0-9a-f]+$/.test(value)) {
        throw rejected(`${label} is invalid`);
    }
    const bytes = new Uint8Array(length);
    for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Number.parseInt(value.slice(index * 2, (index + 1) * 2), 16);
    }
    return bytes;
}
function json(value, label) {
    if (typeof value !== "string" || value.length === 0 || value.length > (MAX_MULTISIG_PACKAGE_BYTES * 2)) {
        throw rejected(`the protocol package returned an invalid ${label}`);
    }
    try {
        return JSON.parse(value);
    }
    catch {
        throw rejected(`the protocol package returned an invalid ${label}`);
    }
}
function record(value, label) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw rejected(`the protocol package returned an invalid ${label}`);
    }
    return value;
}
function list(value, label) {
    if (!Array.isArray(value) || value.length > 16_384) {
        throw rejected(`the protocol package returned an invalid ${label}`);
    }
    return value;
}
function exact(value, expected, label) {
    const actual = Object.keys(value).sort();
    const sorted = [...expected].sort();
    if (actual.length !== sorted.length || actual.some((keyName, index) => keyName !== sorted[index])) {
        throw rejected(`the protocol package returned an invalid ${label}`);
    }
}
function exactOptional(value, expected, optional, label) {
    const actual = Object.keys(value).sort();
    const base = [...expected].sort();
    const withOptional = [...base, optional].sort();
    const matches = (keys) => actual.length === keys.length && actual.every((keyName, index) => keyName === keys[index]);
    if (!matches(base) && !matches(withOptional)) {
        throw rejected(`the protocol package returned an invalid ${label}`);
    }
}
function hash(value) {
    return typeof value === "string" && HASH.test(value);
}
function hashValue(value, label) {
    if (!hash(value)) {
        throw rejected(`${label} is invalid`);
    }
    return value;
}
function lock(value) {
    if (typeof value !== "string" || !LOCK.test(value)) {
        throw rejected("the multisig output lock is invalid");
    }
    return value;
}
function decimal(value, label) {
    if (typeof value !== "string" || !COUNT.test(value)) {
        throw rejected(`${label} is invalid`);
    }
    return BigInt(value);
}
function atoms(value, label) {
    if (typeof value !== "bigint" || value < 0n || value > ((1n << 128n) - 1n)) {
        throw invalid(`${label} is invalid`);
    }
    return value.toString();
}
function safeNumber(value, label) {
    const number = count(value, label);
    if (number > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw rejected(`${label} is out of range`);
    }
    return Number(number);
}
function count(value, label) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
        return BigInt(value);
    }
    return decimal(value, label);
}
function strictIndices(indices) {
    return indices.every((index, expected) => index === expected);
}
function canonicalSignatures(signatures, inputCount, memberCount) {
    return signatures.every((signature, index) => {
        if (signature.inputIndex >= inputCount || signature.memberIndex >= memberCount) {
            return false;
        }
        const previous = signatures[index - 1];
        return previous === undefined
            || previous.inputIndex < signature.inputIndex
            || (previous.inputIndex === signature.inputIndex && previous.memberIndex < signature.memberIndex);
    });
}
function invalid(message, cause) {
    return new TenraiWalletError(message, "invalid", {}, cause instanceof Error ? { cause } : undefined);
}
function rejected(message, cause) {
    return new TenraiWalletError(message, "rejected", {}, cause instanceof Error ? { cause } : undefined);
}
