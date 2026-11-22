import { checkedCoinTotal } from "./public-coin-source.js";
import { ResumableCoinInventory } from "./public-coin-resume.js";
import { publicCoinScanSource, freshPublicCoinObservations } from "./public-coin-scan-source.js";
import { publicCoinCodec } from "./public-coin-codec.js";
import { reopenPublicCoins } from "./public-coin-reopen.js";
import { indexedDbPersistentPublicCoinStore } from "./public-coin-persistent-indexeddb.js";
import {} from "./public-coin-source.js";
import { readAddressProofRequest } from "../address.js";
import { TenraiWalletError } from "../errors.js";
import * as funds from "./funds.js";
import { DEFAULT_VALIDATOR_CONSENSUS_KEY_INDEX } from "./keychain.js";
function usedIndex(value) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < -1 || value > 0x7fff_ffff) {
        throw new TenraiWalletError("used indices must be whole numbers from -1 to 2147483647", "invalid");
    }
    return value;
}
/** Account address discovery and signatures share the wallet's single keychain. */
export class WalletAddresses {
    #used;
    #issued = 0;
    #closed = false;
    #coinTail = Promise.resolve();
    #coinWorking = new Set();
    #coinRelease;
    #coinInventory;
    #coinCodec;
    #coinChain;
    #keys;
    coinOptions;
    wasm;
    genesis;
    heldKeys;
    #held;
    network;
    account;
    constructor(keys, network, account, held, coinOptions = {}, wasm, genesis = () => undefined, heldKeys = () => new Set()) {
        this.heldKeys = heldKeys;
        this.coinOptions = coinOptions;
        this.wasm = wasm;
        this.genesis = genesis;
        this.#keys = keys;
        this.#held = held;
        this.network = network;
        this.account = account;
    }
    get fingerprint() {
        return this.#keys.root().fingerprint();
    }
    /** The highest used index of each branch found so far, to keep with the wallet; undefined before the first scan. */
    get usedAddresses() {
        return this.#used === undefined ? undefined : { ...this.#used };
    }
    /** Hands back what an earlier session found, so the next scan looks 20 past it instead of 100 from the start. */
    rememberUsed(used) {
        const checked = { receive: usedIndex(used?.receive), change: usedIndex(used?.change) };
        this.#used = {
            receive: Math.max(this.#used?.receive ?? -1, checked.receive),
            change: Math.max(this.#used?.change ?? -1, checked.change),
        };
    }
    /**
     * Hands out the receiving address after every used and handed-out one, so no earlier call returned it;
     * scans keep looking 20 past it. Needs a scan or `rememberUsed` first.
     */
    newAddress() {
        if (this.#used === undefined) {
            throw new TenraiWalletError("scan the wallet first, with balance, activity or rescan", "invalid");
        }
        const index = this.floor("receive") + 1;
        const address = this.address(index);
        this.#issued = index;
        return { index, address };
    }
    /** The receiving index `newAddress` handed out last, 0 (the main address) before; keep it with the wallet. */
    get lastIssued() {
        return this.#issued;
    }
    /** Hands back `lastIssued` from an earlier session, so scans keep covering the addresses handed out. */
    rememberIssued(index) {
        if (!Number.isSafeInteger(index) || index < 0 || index > 0x7fff_ffff) {
            throw new TenraiWalletError("the issued index must be a whole number from 0 to 2147483647", "invalid");
        }
        this.#issued = Math.max(this.#issued, index);
    }
    /**
     * Checks `depth` addresses (1000 by default, at most 10000) past the last used one on both branches,
     * for coins sent to addresses far beyond it, such as by another wallet holding the same phrase.
     * Returns the highest used index of each branch.
     */
    async rescan(client, options = {}) {
        const depth = options.depth ?? funds.RESCAN_DEPTH;
        if (!Number.isSafeInteger(depth) || depth < 1 || depth > funds.MAX_RESCAN_DEPTH) {
            throw new TenraiWalletError(`depth must be a whole number from 1 to ${funds.MAX_RESCAN_DEPTH}`, "invalid");
        }
        const found = await this.scan(client, depth);
        if (options.rebuildCoinCache === true) {
            const inventory = await this.openCoins(client, found, true);
            await inventory.close();
        }
        return { ...(this.#used ?? { receive: -1, change: -1 }) };
    }
    async scan(client, gap) {
        const found = await funds.scan(client, (index, branch) => this.address(index, branch), {
            known: { receive: this.floor("receive"), change: this.floor("change") },
            gap: gap ?? (this.#used === undefined ? funds.RESTORE_GAP_LIMIT : funds.GAP_LIMIT),
        });
        this.#used = {
            receive: Math.max(this.#used?.receive ?? -1, found.used.receive),
            change: Math.max(this.#used?.change ?? -1, found.used.change),
        };
        return found;
    }
    /** Receiving address number `index`; 0 is the wallet's first address. */
    address(index = 0, branch = "receive") {
        return this.#keys.key(branch, index).address;
    }
    /** Public key for one derived address, suitable for a threshold descriptor. */
    multisigMemberPublicKey(index = 0, branch = "receive") {
        return new Uint8Array(this.#keys.key(branch, index).publicKey);
    }
    /** Public ML-DSA key at a reserved change index for validator registration or rotation. */
    validatorConsensusPublicKey(index = DEFAULT_VALIDATOR_CONSENSUS_KEY_INDEX) {
        return new Uint8Array(this.#keys.validatorSigner(index, "validator").publicKey);
    }
    /** Adds this wallet's signatures after the caller reviewed the exact package template. */
    signMultisigPackage(session, packageBytes, reviewedTemplate, index = 0, branch = "receive") {
        if (session.network !== this.network) {
            throw new TenraiWalletError("the multisig package is for another network", "wrong-network");
        }
        const member = this.#keys.key(branch, index);
        return session.signMember(packageBytes, reviewedTemplate, member.publicKey, (message) => this.#keys.root().sign(String(this.account), branch, String(index), message, "spend"));
    }
    /** Signs the exact native lock spend the caller has reviewed. No private key leaves the WASM. */
    async signNativeLockSpend(session, review, index = 0, branch = "receive") {
        if (session.network !== this.network)
            throw new TenraiWalletError("the native lock is for another network", "wrong-network");
        const key = this.#keys.key(branch, index);
        return session.signSpend(review, key.publicKey, (message) => this.#keys.root().sign(String(this.account), branch, String(index), message, "spend"));
    }
    /** Whether the address is one of this wallet's that a scan, `address` or `newAddress` derived. */
    owns(address) {
        return this.#keys.path(address) !== undefined;
    }
    /** Branch and index of one of this wallet's addresses, as for `owns`; undefined for any other. */
    pathOf(address) {
        const path = this.#keys.path(address);
        return path && { branch: path.branch, index: path.index };
    }
    /**
     * Scans receive and change addresses and sums their finalized balances. The first scan checks 100
     * addresses past the last used one, later ones 20 past the highest used address found so far.
     */
    async balance(client) {
        const found = await this.scan(client), inventory = await this.openCoins(client, found);
        try {
            const summaries = this.#coinInventory.summaries();
            let atoms = 0n, outputs = 0;
            for (const row of summaries) {
                atoms = checkedCoinTotal(atoms, row.atoms);
                outputs += row.outputs;
                if (!Number.isSafeInteger(outputs))
                    throw new TenraiWalletError("Public output count overflow.", "rejected");
            }
            const totals = new Map(summaries.map(row => [row.address, { atoms: row.atoms, outputs: row.outputs }]));
            return { atoms, outputs, indexedHeight: inventory.finalizedHeight,
                addresses: [...totals].map(([address, total]) => {
                    const path = this.#keys.path(address);
                    if (!path)
                        throw new TenraiWalletError("A public holding has no owned derivation path.", "rejected");
                    return { address, branch: path.branch, index: path.index, atoms: total.atoms, outputs: total.outputs };
                }) };
        }
        finally {
            await inventory.close();
        }
    }
    openCoins(client, found, rebuild = false) {
        return this.#trackCoins(this.#openCoins(client, found, rebuild));
    }
    async #trackCoins(work) {
        this.#coinWorking.add(work);
        try {
            return await work;
        }
        finally {
            this.#coinWorking.delete(work);
        }
    }
    async #openCoins(client, found, rebuild = false) {
        if (this.#closed)
            throw new TenraiWalletError("The wallet is closed.", "rejected");
        const previous = this.#coinTail;
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        this.#coinTail = previous.then(() => gate);
        await previous;
        if (this.#closed) {
            release();
            throw new TenraiWalletError("The wallet is closed.", "rejected");
        }
        let active = true;
        const stop = () => { if (active) {
            active = false;
            this.#coinRelease = undefined;
            release();
        } };
        this.#coinRelease = stop;
        const assert = () => { if (!active || this.#closed)
            throw new TenraiWalletError("The public coin selection lease closed.", "rejected"); };
        try {
            const info = await client.node.info();
            assert();
            if (!/^[0-9a-f]{96}$/.test(info.chain_id))
                throw new TenraiWalletError("Invalid public cache chain identity.", "rejected");
            if (this.#coinInventory && this.#coinChain !== info.chain_id) {
                await this.#coinInventory.close();
                this.#coinInventory = undefined;
                this.#coinCodec?.close();
                this.#coinCodec = undefined;
            }
            const observed = found ?? await this.scan(client);
            assert();
            const funded = new Set(observed.held.map(row => row.address)), used = new Set(observed.active);
            const observations = observed.observed.map(row => {
                const path = this.#keys.path(row.address);
                if (!path)
                    throw new TenraiWalletError("A public observation has no derivation path.", "rejected");
                return { ...row, ...path, funded: funded.has(row.address), used: used.has(row.address) };
            });
            const restore = (row) => {
                if (this.address(row.index, row.branch) !== row.address)
                    throw new TenraiWalletError("The retained public path does not belong to this wallet.", "rejected");
                if (row.used)
                    this.rememberUsed({ receive: row.branch === "receive" ? row.index : -1, change: row.branch === "change" ? row.index : -1 });
            };
            const eventLimit = this.coinOptions.publicCoinEventLimit ?? 200_065_536;
            if (!this.#coinCodec) {
                if (!this.wasm)
                    throw new TenraiWalletError("The public checkpoint codec is unavailable.", "invalid");
                this.#coinCodec = publicCoinCodec(this.wasm, this.#keys.root(), this.network, this.genesis(), this.account);
            }
            const codec = this.#coinCodec;
            if (codec.chainId !== info.chain_id)
                throw new TenraiWalletError("The public cache chain differs from the local Genesis.", "wrong-network");
            const factory = () => this.coinOptions.publicCoinStore ? this.coinOptions.publicCoinStore(codec.scope)
                : indexedDbPersistentPublicCoinStore(codec.scope, { ...(this.coinOptions.publicCoinMaxCoins === undefined ? {} : { maxCoins: this.coinOptions.publicCoinMaxCoins }) });
            this.#coinInventory = await reopenPublicCoins({ rebuild, previous: this.#coinInventory, source: publicCoinScanSource(client), observed: observations, factory, codec,
                observe: tracked => freshPublicCoinObservations(client, tracked), held: this.#held, restore, budget: eventLimit, cancelled: () => this.#closed });
            this.#coinChain = info.chain_id;
            // Restored far-ahead paths also constrain the change index of this exact planning context.
            if (this.#used)
                for (const branch of ["receive", "change"])
                    observed.used[branch] = Math.max(observed.used[branch], this.#used[branch]);
            assert();
            const inventory = this.#coinInventory;
            const call = (work) => this.#trackCoins((async () => { assert(); const value = await work(); assert(); return value; })());
            return { get finalizedHeight() { assert(); return inventory.finalizedHeight; },
                get addresses() { assert(); return inventory.addresses; },
                available: () => call(() => inventory.available(this.heldKeys())), get: key => call(() => inventory.get(key)), visit: take => call(() => inventory.visit(take)),
                largest: (count, address) => call(() => inventory.largest(count, address)), consolidation: above => call(() => inventory.consolidation(above)),
                page: query => call(() => inventory.page(query)), close: async () => { stop(); } };
        }
        catch (error) {
            const cache = this.#coinInventory;
            this.#coinInventory = undefined;
            this.#coinChain = undefined;
            await cache?.close().catch(() => { });
            this.#coinCodec?.close();
            this.#coinCodec = undefined;
            stop();
            throw error;
        }
    }
    async close() {
        this.#closed = true;
        this.#coinRelease?.();
        await this.#coinTail;
        await Promise.allSettled([...this.#coinWorking]);
        const cache = this.#coinInventory;
        this.#coinInventory = undefined;
        try {
            await cache?.close();
        }
        finally {
            this.#coinCodec?.close();
            this.#coinCodec = undefined;
        }
    }
    /** The largest available outputs, at most 256. Use outputPage to traverse the complete inventory. */
    async outputs(client, options = {}) {
        const limit = options.limit ?? 256;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256)
            throw new TenraiWalletError("Output limit must be 1..256.", "invalid");
        const inventory = await this.openCoins(client);
        try {
            return (await inventory.largest(limit, options.address)).map(coin => ({ ...coin, height: coin.height ?? 0 }));
        }
        finally {
            await inventory.close();
        }
    }
    /** One bounded canonical outpoint page after reconciling the retained account cache. */
    async outputPage(client, query = {}) {
        const inventory = await this.openCoins(client);
        try {
            return { ...await inventory.page(query), indexedHeight: inventory.finalizedHeight };
        }
        finally {
            await inventory.close();
        }
    }
    /** Finalized activity of every used address, newest first, one entry per transaction. */
    async activity(client, options = {}) {
        const limit = options.limit ?? 50;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
            throw new TenraiWalletError("limit must be a whole number from 1 to 1000", "invalid");
        }
        const found = await this.scan(client);
        const events = await funds.history(client, found.active, limit);
        return funds.activity(events).slice(0, limit);
    }
    /** Stake positions owned by the wallet's used addresses. */
    async positions(client) {
        const found = await this.scan(client);
        const owners = new Set([this.address(0)]);
        for (const branch of ["receive", "change"]) {
            for (let index = 0; index <= found.used[branch]; index += 1) {
                owners.add(this.address(index, branch));
            }
        }
        return funds.positions(client, [...owners]);
    }
    /**
     * Answers an address proof request with the key of the requested address, which must be one this
     * wallet derived, such as during a scan. Show the user the address before calling this.
     */
    async proveAddress(request, options = {}) {
        let fields;
        try {
            fields = readAddressProofRequest(request);
        }
        catch (error) {
            throw new TenraiWalletError(error instanceof Error ? error.message : "the request is unreadable", "invalid");
        }
        const now = options.now ?? Math.floor(Date.now() / 1000);
        if (!Number.isSafeInteger(now) || now < 0) {
            throw new TenraiWalletError("now must be whole Unix seconds", "invalid");
        }
        const path = this.#keys.path(fields.address) ?? this.search(fields.address);
        if (!path) {
            throw new TenraiWalletError("the address does not belong to this wallet, or lies past the addresses it has scanned", "invalid");
        }
        try {
            const proof = this.#keys.root().proveAddress(String(this.account), path.branch, String(path.index), JSON.stringify(fields), String(now));
            return JSON.parse(proof);
        }
        catch (error) {
            if (error instanceof TenraiWalletError) {
                throw error;
            }
            throw new TenraiWalletError(error instanceof Error ? error.message : "the proof could not be signed", "invalid");
        }
    }
    /** The highest used index of a branch; for receive, the last handed-out one when that is higher. */
    floor(branch) {
        const used = this.#used?.[branch] ?? -1;
        return branch === "receive" ? Math.max(used, this.#issued) : used;
    }
    /** Derives addresses up to 100 past the highest used or handed-out index of each branch, looking for `address`. */
    search(address) {
        for (const branch of ["receive", "change"]) {
            const last = this.floor(branch) + funds.RESTORE_GAP_LIMIT;
            for (let index = 0; index <= last; index += 1) {
                if (this.address(index, branch) === address) {
                    return { branch, index };
                }
            }
        }
        return undefined;
    }
}
