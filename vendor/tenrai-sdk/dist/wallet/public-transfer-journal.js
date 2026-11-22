import { OutcomeArchive } from "./unknown-outcome.js";
import { TenraiWalletError } from "../errors.js";
const HASH = /^[0-9a-f]{96}$/;
const POINT = /^([0-9a-f]{96}):(0|[1-9][0-9]{0,9})$/;
const LIMIT = 32 * 1024 * 1024;
const RECORD_ID = "tenrai_public_transfers";
function damaged() { throw new TenraiWalletError("the retained public transfer journal is damaged; spending is stopped and its original bytes were preserved", "rejected"); }
function object(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        damaged();
    return value;
}
function count(value) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
        return BigInt(value);
    if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value))
        damaged();
    const number = BigInt(value);
    if (number > 0xffffffffffffffffn)
        damaged();
    return number;
}
/** Native canonical codecs bind the exact original chain, TXID, inputs and validity. */
export function validatePublicTransfer(wasm, network, value, chainId) {
    const row = object(value);
    const id = row["transactionId"], wire = row["wireHex"], manifest = row["manifest"];
    if (typeof id !== "string" || !HASH.test(id) || typeof wire !== "string" || !wire.length || wire.length > 2 * 1024 * 1024 || !/^(?:[0-9a-f]{2})+$/.test(wire)
        || typeof manifest !== "string" || manifest.length > 256 * 1024 || typeof row["sentAt"] !== "number" || !Number.isSafeInteger(row["sentAt"]) || Number(row["sentAt"]) < 0)
        damaged();
    if (new TextEncoder().encode(manifest).byteLength > 256 * 1024)
        damaged();
    const canonical = wasm.validateManifest(manifest);
    const rules = object(JSON.parse(canonical));
    const limits = object(rules["transaction_limits"]);
    if (rules["network"] !== network || (chainId !== undefined && rules["chain_id"] !== chainId)
        || wire.length > 2 * Number(count(limits["max_wire_bytes"])))
        damaged();
    const bytes = Uint8Array.from(wire.match(/../g), (byte) => Number.parseInt(byte, 16));
    const inspected = object(JSON.parse(wasm.inspectTransaction(bytes, canonical)));
    const body = object(inspected["body"]);
    const until = count(row["validUntil"]);
    if (inspected["transaction_id"] !== id || body["transaction_id"] !== id || body["chain_id"] !== rules["chain_id"] || count(body["valid_until_height"]) !== until)
        damaged();
    const points = body["inputs"], spends = row["spends"];
    if (!Array.isArray(points) || !points.length || points.length > 8 || !Array.isArray(spends) || spends.length !== points.length)
        damaged();
    const exact = points.map((point) => {
        const p = object(point);
        const tx = p["transaction_id"];
        const index = count(p["output_index"]);
        if (typeof tx !== "string" || !HASH.test(tx) || index > 0xffffffffn)
            damaged();
        return `${tx}:${index}`;
    }).sort();
    const owned = spends.map((spend) => {
        const s = object(spend);
        const key = s["key"], address = s["address"];
        if (typeof key !== "string" || !POINT.test(key) || BigInt(key.slice(97)) > 0xffffffffn || typeof address !== "string" || !/^[a-z0-9]{1,128}$/.test(address))
            damaged();
        return { key, address };
    });
    if (new Set(exact).size !== exact.length || JSON.stringify(exact) !== JSON.stringify(owned.map((point) => point.key).sort()))
        damaged();
    for (const flag of ["needsReview", "resendPaused", "exported"])
        if (row[flag] !== undefined && typeof row[flag] !== "boolean")
            damaged();
    return { transactionId: id, wireHex: wire, manifest: canonical, validUntil: until, sentAt: Number(row["sentAt"]), spends: owned,
        ...(row["needsReview"] === undefined ? {} : { needsReview: row["needsReview"] }), ...(row["resendPaused"] === undefined ? {} : { resendPaused: row["resendPaused"] }),
        ...(row["exported"] === undefined ? {} : { exported: row["exported"] }) };
}
export class PublicTransferJournal {
    #root;
    #source;
    #owner;
    #session;
    #wasm;
    #archive;
    #writing = Promise.resolve();
    constructor(wasm, root, owner, source, session) {
        const codec = root;
        if (typeof codec?.sealStoreRecord !== "function" || typeof codec?.openStoreRecord !== "function" || typeof source.chainId !== "string" || !HASH.test(source.chainId)
            || typeof source.read !== "function" || typeof source.write !== "function" || !["mainnet", "testnet", "testnet100", "development"].includes(owner.network)
            || !Number.isSafeInteger(owner.account) || owner.account < 0 || owner.account > 0x7fff_ffff
            || owner.manifest !== undefined && (typeof owner.manifest !== "string" || new TextEncoder().encode(owner.manifest).byteLength > 2 * 1024 * 1024))
            damaged();
        this.#root = codec;
        this.#owner = owner;
        this.#session = session;
        this.#wasm = wasm;
        this.#archive = session.store.outcomes ? new OutcomeArchive(session.store.outcomes, {
            seal: (id, plain) => codec.sealStoreRecord(owner.network, owner.manifest, owner.account, id, plain),
            open: (id, sealed) => codec.openStoreRecord(owner.network, owner.manifest, owner.account, id, sealed),
        }) : undefined;
        this.#source = { chainId: source.chainId, read: source.read.bind(source), write: source.write.bind(source),
            ...(source.checkAbsent ? { checkAbsent: source.checkAbsent.bind(source) } : {}),
            ...(source.exportRecovery ? { exportRecovery: source.exportRecovery.bind(source) } : {}),
            ...(source.markPresent ? { markPresent: source.markPresent.bind(source) } : {}) };
    }
    get chainId() { return this.#source.chainId; }
    /** @internal Managed submission cannot bypass an unavailable ambiguity fence. */
    requireOutcomeStore() { this.#session.assertOpen(); if (!this.#archive)
        throw new TenraiWalletError("configure a durable outcome store before managed submission", "rejected"); }
    #validateOutcome(value) {
        const row = object(value);
        return validatePublicTransfer(this.#wasm, this.#owner.network, { ...row, validUntil: typeof row.validUntil === "bigint" ? row.validUntil.toString() : row.validUntil }, this.chainId);
    }
    async unknown(transactionId) {
        if (!this.#archive)
            throw new TenraiWalletError("configure a durable outcome store before reading ambiguous payments", "rejected");
        return this.#session.run(() => this.#archive.read("public", transactionId, (value) => this.#validateOutcome(value)));
    }
    async unknownPage(after, limit = 128) {
        if (!this.#archive)
            throw new TenraiWalletError("configure a durable outcome store before reading ambiguous payments", "rejected");
        return this.#session.run(() => this.#archive.store.page("public", after, limit));
    }
    async retainUnknown(entry, anchor) {
        if (!this.#archive)
            throw new TenraiWalletError("configure a durable outcome store before closing an ambiguous payment", "rejected");
        if (BigInt(anchor.height) <= entry.validUntil)
            throw new TenraiWalletError("the original signed validity window is not closed", "rejected");
        await this.#session.run(() => this.#archive.retain("public", entry.transactionId, anchor, entry, (value) => this.#validateOutcome(value), (left, right) => left.transactionId === right.transactionId && left.wireHex === right.wireHex && left.manifest === right.manifest && left.validUntil === right.validUntil && JSON.stringify(left.spends) === JSON.stringify(right.spends)));
    }
    async restore() {
        return this.#session.run(async () => {
            const sealed = await this.#source.read();
            this.#session.assertOpen();
            if (sealed === null || sealed === undefined) {
                await this.#source.checkAbsent?.();
                this.#session.assertOpen();
                await this.save([]);
                return [];
            }
            try {
                if (!(sealed instanceof Uint8Array) || sealed.byteLength < 40 || sealed.byteLength > LIMIT + 40)
                    damaged();
                const { network, manifest, account } = this.#owner;
                const plain = this.#root.openStoreRecord(network, manifest, account, RECORD_ID, sealed);
                try {
                    if (!(plain instanceof Uint8Array) || plain.byteLength > LIMIT)
                        damaged();
                    const record = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain)));
                    const entries = record["entries"];
                    if (record["format"] !== 1 || !Array.isArray(entries) || entries.length > 1024)
                        damaged();
                    if (entries.some((value) => typeof object(value)["needsReview"] !== "boolean"))
                        damaged();
                    const restored = entries.map((value) => validatePublicTransfer(this.#wasm, network, value, this.#source.chainId));
                    if (new Set(restored.map((entry) => entry.transactionId)).size !== restored.length)
                        damaged();
                    this.#session.assertOpen();
                    await this.#source.markPresent?.();
                    this.#session.assertOpen();
                    return restored;
                }
                finally {
                    plain.fill(0);
                }
            }
            catch (cause) {
                const error = new TenraiWalletError("the retained public transfer journal cannot be authenticated; spending is stopped and its original bytes were preserved", "rejected", {}, { cause });
                if (this.#source.exportRecovery)
                    Object.defineProperty(error, "exportRecovery", { value: this.#source.exportRecovery.bind(this.#source) });
                throw error;
            }
        });
    }
    async save(entries) {
        this.#session.assertOpen();
        if (entries.length > 1024)
            throw new TenraiWalletError("resolve retained public transfers before creating another", "rejected");
        let minimum = 32;
        for (const entry of entries) {
            minimum += entry.wireHex.length + (entry.manifest?.length ?? 0) + entry.spends.length * 128;
            if (minimum > LIMIT)
                throw new TenraiWalletError("the retained public transfer journal exceeds its storage limit", "rejected");
        }
        const plain = new TextEncoder().encode(JSON.stringify({ format: 1, entries: entries.map((entry) => ({ ...entry, validUntil: entry.validUntil.toString() })) }));
        if (plain.byteLength > LIMIT) {
            plain.fill(0);
            throw new TenraiWalletError("the retained public transfer journal exceeds its storage limit", "rejected");
        }
        const writing = this.#writing.then(() => this.#session.run(async () => {
            this.#session.assertOpen();
            const { network, manifest, account } = this.#owner;
            const sealed = this.#root.sealStoreRecord(network, manifest, account, RECORD_ID, plain);
            if (!(sealed instanceof Uint8Array) || sealed.byteLength < 40 || sealed.byteLength > LIMIT + 40)
                damaged();
            this.#session.assertOpen();
            await this.#source.write(sealed);
            this.#session.assertOpen();
        })).finally(() => plain.fill(0));
        this.#writing = writing.catch(() => { });
        await writing;
    }
}
