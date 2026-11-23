import { nativeInputFacts } from "./public-send-evidence.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ProtocolRules, toHex } from "./protocol.js";
import { protocolBindings } from "./runtime.js";
const U64 = (1n << 64n) - 1n;
const HEX = /^(?:[0-9a-f]{2})*$/;
const NETWORKS = ["mainnet", "testnet", "testnet100", "development"];
function uint(value) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
        return BigInt(value);
    if (typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= U64)
        return BigInt(value);
    throw new TypeError("expected an unsigned 64-bit integer");
}
function atoms(value) {
    if (typeof value === "string" && /^(0|[1-9][0-9]{0,38})$/.test(value) && BigInt(value) <= (1n << 128n) - 1n)
        return BigInt(value);
    throw new TypeError("expected an unsigned 128-bit atom amount");
}
function hex(value, maxBytes, minBytes = 0) {
    if (typeof value !== "string" || !HEX.test(value) || value.length < minBytes * 2 || value.length > maxBytes * 2) {
        throw new TypeError("expected bounded canonical lowercase hex");
    }
    return value;
}
function object(text) {
    if (typeof text !== "string" || text.length > 256 * 1024)
        throw new TypeError("invalid protocol response");
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new TypeError("invalid protocol response");
    return value;
}
/** Manifest-bound native locks. The protocol WASM validates every descriptor, witness and signature. */
export class NativeLockSession {
    network;
    #wasm;
    #native;
    #manifest;
    #rules;
    #prepared = new WeakMap();
    constructor(wasm, manifest) {
        if (!NETWORKS.includes(manifest.network) || manifest.protocol_version < 2)
            throw new TypeError("native locks require protocol 2");
        this.#wasm = wasm;
        this.#native = wasm;
        for (const name of ["createNativeLock", "inspectNativeLock", "nativeLockAddress", "encodeNativeWitness", "quoteNativeTransaction", "nativeLockSigningMessage", "readFinalizedUtxoSelection"]) {
            if (typeof this.#native[name] !== "function")
                throw new TypeError("the protocol WASM does not support native locks");
        }
        this.#manifest = wasm.validateManifest(JSON.stringify(manifest));
        this.#rules = new ProtocolRules(wasm, manifest);
        this.network = manifest.network;
    }
    static async fromManifest(manifest) {
        return new NativeLockSession(await protocolBindings(), manifest);
    }
    create(request) {
        const created = object(this.#native.createNativeLock(JSON.stringify(request), this.network));
        return this.inspect(hex(created["descriptor_hex"], 124, 2));
    }
    inspect(descriptorHex) {
        const checked = hex(descriptorHex, 124, 2);
        const value = object(this.#native.inspectNativeLock(checked, this.network));
        if (value["descriptor_hex"] !== checked || !["timelock", "hashlock", "htlc"].includes(String(value["type"])))
            throw new TypeError("invalid native lock descriptor");
        const address = this.#rules.parseAddress(String(value["address"]));
        if (address !== this.#native.nativeLockAddress(checked, this.network))
            throw new TypeError("native lock address mismatch");
        const lock = hex(value["lock_hex"], 41, 41);
        if (!lock.startsWith("03"))
            throw new TypeError("invalid native lock profile");
        const type = value["type"];
        const base = { descriptor_hex: checked, lock_hex: lock, address, type };
        if (type === "timelock")
            return Object.freeze({ ...base, owner_address: this.#rules.parseAddress(String(value["owner_address"])), unlock_height: uint(value["unlock_height"]).toString() });
        const hash = hex(value["hash_hex"], 32, 32);
        if (type === "hashlock")
            return Object.freeze({ ...base, owner_address: this.#rules.parseAddress(String(value["owner_address"])), hash_hex: hash });
        return Object.freeze({ ...base, claim_address: this.#rules.parseAddress(String(value["claim_address"])), refund_address: this.#rules.parseAddress(String(value["refund_address"])), hash_hex: hash, refund_height: uint(value["refund_height"]).toString() });
    }
    /** Hashes raw bytes. A claim publishes these bytes on chain. */
    hash(preimageHex) {
        const value = hex(preimageHex, 64, 1);
        return toHex(sha256(Uint8Array.from(value.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16))));
    }
    /** A bounded, consistent finalized snapshot; locked funds are kept separate from ordinary spendable balance. */
    async watch(client, descriptorHex) {
        const descriptor = this.inspect(descriptorHex);
        let cursor;
        let anchor;
        const records = new Map();
        const seen = new Set();
        for (let index = 0; index < 64; index += 1) {
            const page = await client.address.utxos(descriptor.address, cursor === undefined ? { limit: 100 } : { limit: 100, cursor });
            if (page.address !== descriptor.address || page.network !== this.network || !Array.isArray(page.utxos) || page.utxos.length > 100)
                throw new TypeError("native lock UTXO response mismatch");
            const current = JSON.stringify(page.anchor);
            if (anchor !== undefined && current !== anchor)
                throw new TypeError("native lock UTXO snapshot changed; refresh");
            anchor = current;
            for (const record of page.utxos) {
                if (!/^[0-9a-f]{96}$/.test(record.outpoint.transaction_id) || !Number.isSafeInteger(record.outpoint.output_index) || record.outpoint.output_index < 0 || record.outpoint.output_index > 0xffff_ffff)
                    throw new TypeError("invalid native lock outpoint");
                atoms(record.amount);
                uint(record.created_finalized_height);
                const key = `${record.outpoint.transaction_id}:${record.outpoint.output_index}`;
                if (records.has(key))
                    throw new TypeError("duplicate native lock outpoint");
                records.set(key, Object.freeze({ ...record, outpoint: Object.freeze({ ...record.outpoint }) }));
            }
            if (page.next_cursor === null)
                return Object.freeze([...records.values()]);
            cursor = page.next_cursor;
            if (typeof cursor !== "string" || cursor.length > 4096 || seen.has(cursor))
                throw new TypeError("invalid native lock pagination");
            seen.add(cursor);
        }
        throw new RangeError("too many native lock outputs; use a dedicated integration");
    }
    /** @internal Use `Wallet.reviewNativeLockSpend` to supply the wallet's verification context. */
    async prepareSpend(client, request, owner) {
        if (!owner)
            throw new TypeError("Use wallet.reviewNativeLockSpend to authenticate a conditional input before signing.");
        const descriptor = this.inspect(request.descriptorHex);
        if (request.branch !== "claim" && request.branch !== "refund")
            throw new TypeError("invalid native lock branch");
        if (request.branch === "refund" && descriptor.type !== "htlc")
            throw new TypeError("only an HTLC has a refund branch");
        const preimage = hex(request.preimageHex ?? "", 64);
        const needsHash = request.branch === "claim" && descriptor.type !== "timelock";
        if (needsHash && descriptor.type === "htlc" && preimage.length !== 64)
            throw new TypeError("HTLC claims require exactly 32 bytes of preimage");
        if (needsHash ? this.hash(preimage) !== descriptor.hash_hex : preimage !== "")
            throw new TypeError("the preimage does not satisfy this branch");
        let latest = await client.transactions.manifest();
        const original = object(this.#manifest);
        if (latest.network !== this.network || latest.chain_id !== original["chain_id"] || latest.params_hash !== original["params_hash"] || latest.ledger_rules_hash !== original["ledger_rules_hash"] || latest.protocol_version !== original["protocol_version"])
            throw new TypeError("the chain rules changed; reopen native locks");
        const input = await owner.readNativeInput(client, descriptor.address, request.outpoint, latest.chain_id);
        const certified = nativeInputFacts(input, owner);
        latest = { ...latest, finalized: certified.anchor };
        const protocol = new ProtocolRules(this.#wasm, latest);
        const from = uint(latest.finalized.height) + 1n;
        if (from > U64)
            throw new RangeError("finalized height overflow");
        let until = from + protocol.rules.maxValidityCuts - 1n;
        if (until > U64)
            until = U64;
        if (descriptor.type === "timelock" && from < uint(descriptor.unlock_height))
            throw new RangeError("this timelock is not open at the next finalized cut");
        if (descriptor.type === "htlc") {
            const timeout = uint(descriptor.refund_height);
            if (request.branch === "claim") {
                if (from >= timeout)
                    throw new RangeError("the HTLC claim window has ended");
                if (until >= timeout)
                    until = timeout - 1n;
            }
            else if (from < timeout)
                throw new RangeError("the HTLC refund window has not opened");
        }
        const destination = protocol.parseAddress(request.destination);
        const outpoint = { ...request.outpoint };
        if (!/^[0-9a-f]{96}$/.test(outpoint.transaction_id) || !Number.isSafeInteger(outpoint.output_index) || outpoint.output_index < 0 || outpoint.output_index > 0xffff_ffff)
            throw new TypeError("invalid native lock outpoint");
        const inputAmount = certified.amount, provedHeight = certified.createdHeight;
        if (provedHeight >= from)
            throw new TypeError("The output is not spendable at this certified height.");
        let fee = 0n;
        for (let attempt = 0; attempt < 5; attempt += 1) {
            if (fee >= inputAmount)
                throw new RangeError("the locked output does not cover its fee");
            const body = protocol.encodeBody({ valid_from_height: from.toString(), valid_until_height: until.toString(), inputs: [{ transaction_id: outpoint.transaction_id, output_index: String(outpoint.output_index) }], outputs: [{ address: destination, amount: (inputAmount - fee).toString() }] });
            const quote = object(this.#native.quoteNativeTransaction(body, JSON.stringify([{ descriptor_hex: descriptor.descriptor_hex, branch: request.branch, preimage_hex: preimage }]), JSON.stringify(latest)));
            const required = atoms(quote["minimum_fee"]);
            const mass = uint(quote["mass"]);
            if (mass > protocol.rules.maxMass || uint(quote["witnesses"]) !== 1n)
                throw new RangeError("the native transaction exceeds chain limits");
            if (request.maxFee !== undefined && (request.maxFee < 0n || required > request.maxFee))
                throw new RangeError("the native transaction fee exceeds the requested maximum");
            if (fee < required) {
                fee = required;
                continue;
            }
            const review = Object.freeze({ transactionId: protocol.inspectBody(body).transactionId, descriptor, branch: request.branch, authorityAddress: (request.branch === "refund" ? descriptor.refund_address : descriptor.type === "htlc" ? descriptor.claim_address : descriptor.owner_address), destination, outpoint: Object.freeze(outpoint), inputAmount, amount: inputAmount - fee, fee, validFrom: from, validUntil: until, preimageBytes: preimage.length / 2 });
            this.#prepared.set(review, { body, preimage, mass, manifest: JSON.stringify(latest), protocol, input, owner, client });
            return review;
        }
        throw new RangeError("native transaction fee did not converge");
    }
    transactionManifest(review) {
        const prepared = this.#prepared.get(review);
        if (!prepared)
            throw new TypeError("review this native transaction in this session first");
        return prepared.protocol.transactionManifest();
    }
    /** @internal Bind a spend review to the wallet that prepared it. */
    assertOwner(review, owner) {
        const prepared = this.#prepared.get(review);
        if (!prepared || prepared.owner !== owner)
            throw new TypeError("The native review belongs to another wallet proof context.");
        nativeInputFacts(prepared.input, owner);
    }
    /** Signs only a review produced by this session, with the exact key named by the selected branch; a repeat must sign validly again. */
    async signSpend(review, publicKey, sign) {
        const prepared = this.#prepared.get(review);
        if (!prepared)
            throw new TypeError("review this native transaction in this session first");
        if (publicKey.length !== 1952 || this.#native.addressFromPublicKey(publicKey, this.network) !== review.authorityAddress)
            throw new TypeError("the selected wallet key does not own this branch");
        const original = nativeInputFacts(prepared.input, prepared.owner);
        if (prepared.signed) {
            this.#signed(prepared, review, publicKey, sign);
            await prepared.owner.ready(review.validUntil);
            return prepared.signed;
        }
        const current = await prepared.owner.readNativeInput(prepared.client, review.descriptor.address, review.outpoint, String(object(prepared.manifest)["chain_id"]));
        const checked = nativeInputFacts(current, prepared.owner);
        if (checked.amount !== original.amount || checked.createdHeight !== original.createdHeight || checked.source !== original.source
            || BigInt(checked.anchor.height) >= review.validUntil)
            throw new TypeError("The reviewed native input or certified validity changed.");
        await prepared.owner.ready(review.validUntil);
        prepared.input = current;
        nativeInputFacts(current, prepared.owner);
        const wire = this.#signed(prepared, review, publicKey, sign);
        prepared.signed = Object.freeze({ transactionId: review.transactionId, wireHex: toHex(wire), amount: review.amount, fee: review.fee, validUntil: review.validUntil });
        return prepared.signed;
    }
    #signed(prepared, review, publicKey, sign) {
        const previous = JSON.stringify({ address: review.descriptor.address, amount: review.inputAmount.toString() });
        const message = this.#native.nativeLockSigningMessage(prepared.body, "0", previous, review.descriptor.descriptor_hex, review.branch, prepared.preimage, prepared.manifest);
        if (!(message instanceof Uint8Array) || message.length !== 48)
            throw new TypeError("invalid native signing message");
        const signature = sign(new Uint8Array(message));
        if (!(signature instanceof Uint8Array) || signature.length !== 3309)
            throw new TypeError("invalid native signature");
        const witness = this.#native.encodeNativeWitness(review.descriptor.descriptor_hex, review.branch, prepared.preimage, publicKey, signature);
        const wire = prepared.protocol.assemble(prepared.body, witness);
        const inspected = prepared.protocol.inspect(wire);
        if (inspected.transactionId !== review.transactionId || inspected.mass !== prepared.mass)
            throw new TypeError("native transaction changed after review");
        prepared.protocol.verify(wire, [{ address: review.descriptor.address, amount: review.inputAmount }], []);
        return wire;
    }
}
