import { attachFinalityGuard, closeFinalityGuard } from "./finality-guard.js";
import { PublicSendEvidence } from "./public-send-evidence.js";
import { PublicReservations } from "./public-reservations.js";
import { planFromSource } from "./public-coin-plan.js";
import { publicContext, resendPublic, retainPublic, submitPublic } from "./wallet-public.js";
import { WalletAddresses } from "./wallet-addresses.js";
import { burnAddress } from "../address.js";
import { formatTrai } from "../amount.js";
import { TenraiWalletError } from "../errors.js";
import * as compounding from "./compounding.js";
import { NETWORKS } from "./context.js";
import * as funds from "./funds.js";
import { DEFAULT_VALIDATOR_CONSENSUS_KEY_INDEX, KeyChain } from "./keychain.js";
import { Messenger } from "./messenger.js";
import { plan, sign, } from "./plan.js";
import { openSavedSends } from "./private-send-records.js";
import { statementScan, validateStatementSend } from "./private-send-evidence.js";
import { PrivateStoreSession } from "./private-store-session.js";
import { PublicTransferJournal, validatePublicTransfer } from "./public-transfer-journal.js";
import { PrivateNotes } from "./private-notes.js";
import { toHex } from "./protocol.js";
import { transferPayloadHex } from "./recipients.js";
import { protocolBindings } from "./runtime.js";
import * as staking from "./staking.js";
/** An HD wallet from a 24-word recovery phrase; keys never leave the protocol WASM. */
export class Wallet {
    network;
    account;
    #wasm;
    #keys;
    /** Outputs spent by transfers this wallet sent, until they leave the UTXO set or expire. */
    #reservations = new PublicReservations((key) => this.#privatelyHeld(key));
    #pending = this.#reservations.deadlines;
    /** The wallet as the staking and compounding modules see it. */
    #desk = {
        address: (index, branch) => this.address(index, branch),
        context: (client, fee) => this.#context(client, fee),
        base: (context) => this.#base(context),
        changeAddress: (context) => this.#changeAddress(context),
        steps: (client, context, plans) => this.#steps(client, context, plans),
        owner: (context, value) => this.#operationOwner(context, value),
        validatorSigner: (index, purpose) => this.#keys.validatorSigner(index, purpose),
        operate: (client, context, request) => this.#operate(client, context, request),
    };
    #privateNotes;
    #privateHolds = new Map();
    #privateRestoreFailed = false;
    #privateStore;
    #restoringPrivate;
    #privateJournal;
    #publicJournal;
    #openingPrivate;
    #closed = false;
    #closing;
    /** Transfers from `prepare` that `submit` may still send. */
    #prepared = new WeakMap();
    /** Transfers on their way, by id; `resend` sends them again while the node does not know them. */
    #open = new Map();
    #addresses;
    #publicState;
    #publicEvidence;
    constructor(wasm, root, options) {
        this.#wasm = wasm;
        attachFinalityGuard(root, options.finalityStore);
        this.network = options.network;
        this.account = options.account ?? 0;
        this.#keys = new KeyChain(wasm, root, this.network, this.account);
        this.#addresses = new WalletAddresses(this.#keys, this.network, this.account, (coin) => this.#held(coin), options, wasm, () => this.#privateStore?.genesisManifest ?? options.genesisManifest, () => this.#heldKeys());
        this.#publicState = { wasm, network: this.network, keys: this.#keys, open: this.#open, pending: this.#pending,
            assertOpen: () => this.#requirePrivateRestored(), session: () => this.#privateJournal, journal: () => this.#publicJournal,
            save: () => this.#savePublic(), beforeSubmit: until => this.#publicEvidence.ready(until), scan: (client) => this.#addresses.scan(client), openCoins: (client, found) => this.#addresses.openCoins(client, found), resend: (client) => this.resend(client),
            closed: () => this.#closed, failRestore: () => { this.#privateRestoreFailed = true; },
            claimOwned: (id, keys, until) => this.#reservations.claimOwned(id, keys, until),
            releaseOwned: (id, keys) => this.#reservations.releaseOwned(id, keys) };
        this.#publicEvidence = new PublicSendEvidence(this.#publicState, { wasm, network: this.network, account: this.account, root: () => this.#keys.root(), genesis: () => this.#privateStore?.genesisManifest ?? options.genesisManifest });
    }
    static async fromMnemonic(mnemonic, options) {
        if (!NETWORKS.includes(options.network)) {
            throw new TypeError("network must be mainnet, testnet, testnet100 or development");
        }
        const wasm = await protocolBindings();
        const words = typeof mnemonic === "string" ? mnemonic.trim().toLowerCase().split(/[\s,]+/) : [];
        if (words.length !== 24) {
            throw new TenraiWalletError("the recovery phrase must have 24 words", "invalid");
        }
        let entropy;
        try {
            entropy = wasm.mnemonicEntropy(words.join(" "));
        }
        catch {
            throw new TenraiWalletError("the recovery phrase is not a valid 24-word phrase", "invalid");
        }
        try {
            const wallet = new Wallet(wasm, new wasm.WalletRoot(entropy, options.passphrase ?? ""), options);
            try {
                if (options.privateStore)
                    await wallet.restorePrivatePending(await options.privateStore({ network: wallet.network, account: wallet.account, address: wallet.address(), fingerprint: wallet.fingerprint }));
                return wallet;
            }
            catch (error) {
                await wallet.close();
                throw error;
            }
        }
        finally {
            entropy.fill(0);
        }
    }
    /** A new wallet and its recovery phrase; store the phrase, it is the only backup. */
    static async generate(options) {
        const wasm = await protocolBindings();
        const entropy = crypto.getRandomValues(new Uint8Array(32));
        try {
            const mnemonic = wasm.mnemonicFromEntropy(entropy);
            return { wallet: await Wallet.fromMnemonic(mnemonic, options), mnemonic };
        }
        finally {
            entropy.fill(0);
        }
    }
    /** The recovery fingerprint of this wallet. */
    get fingerprint() { return this.#addresses.fingerprint; }
    /** The highest used receive/change indices, once a scan has completed. */
    get usedAddresses() { return this.#addresses.usedAddresses; }
    /** Restores the receive/change scan boundaries without lowering them. */
    rememberUsed(used) { this.#addresses.rememberUsed(used); }
    /** Hands out the next receiving address after a scan or rememberUsed. */
    newAddress() { return this.#addresses.newAddress(); }
    /** The receiving index last handed out by newAddress. */
    get lastIssued() { return this.#addresses.lastIssued; }
    /** Restores the highest receiving index already handed out. */
    rememberIssued(index) { this.#addresses.rememberIssued(index); }
    /** Scans addresses; rebuildCoinCache explicitly replaces only this account's advisory coin cache. */
    rescan(client, options = {}) { return this.#addresses.rescan(client, options); }
    /** Derives receiving or change address number index. */
    address(index = 0, branch = "receive") { return this.#addresses.address(index, branch); }
    /** Returns the public key for one wallet path. */
    multisigMemberPublicKey(index = 0, branch = "receive") { return this.#addresses.multisigMemberPublicKey(index, branch); }
    /** Returns a validator public key from its reserved derivation range. */
    validatorConsensusPublicKey(index = DEFAULT_VALIDATOR_CONSENSUS_KEY_INDEX) { return this.#addresses.validatorConsensusPublicKey(index); }
    /** Signs the exact reviewed multisig template with one wallet member key. */
    signMultisigPackage(session, bytes, reviewed, index = 0, branch = "receive") {
        return this.#addresses.signMultisigPackage(session, bytes, reviewed, index, branch);
    }
    /** Authenticate a conditional input under this wallet's local Genesis and durable finality guard. */
    reviewNativeLockSpend(session, client, request) {
        this.#requirePrivateRestored();
        return session.prepareSpend(client, request, this.#publicEvidence);
    }
    /** Signs a reviewed native-lock spend; as with `exportSigned`, its input is held in the durable journal first. */
    async signNativeLockSpend(session, review, index = 0, branch = "receive") {
        const { transactionId, wireHex, amount, fee, validUntil } = await this.exportSigned(await this.prepareNativeLockSpend(session, review, index, branch));
        return Object.freeze({ transactionId, wireHex, amount, fee, validUntil });
    }
    /** Prepares a native spend for the wallet's ordinary submission, input reservation and retry handling. */
    async prepareNativeLockSpend(session, review, index = 0, branch = "receive") {
        session.assertOwner(review, this.#publicEvidence);
        const signed = await this.#addresses.signNativeLockSpend(session, review, index, branch);
        return this.#review({
            prepared: { ...signed, change: 0n, inputs: 1 },
            spent: [{ address: review.descriptor.address, transactionId: review.outpoint.transaction_id, outputIndex: review.outpoint.output_index, amount: review.inputAmount }],
            manifest: session.transactionManifest(review),
        });
    }
    /** Whether this wallet derived the address. */
    owns(address) { return this.#addresses.owns(address); }
    /** Returns an already derived address path, if owned. */
    pathOf(address) { return this.#addresses.pathOf(address); }
    /** Scans owned addresses and returns their finalized balance. */
    balance(client) { return this.#addresses.balance(client); }
    /** Returns up to256 largest available outputs. outputPage reads a bounded canonical page. */
    outputs(client, options = {}) { return this.#addresses.outputs(client, options); }
    outputPage(client, query = {}) { return this.#addresses.outputPage(client, query); }
    /** Returns finalized address activity, newest first. */
    activity(client, options = {}) { return this.#addresses.activity(client, options); }
    /** Returns stake positions controlled by the used addresses. */
    positions(client) { return this.#addresses.positions(client); }
    /** Signs a reviewed address-proof request for an owned path. */
    proveAddress(request, options = {}) { return this.#addresses.proveAddress(request, options); }
    /** Builds and signs a transfer for review; `submit` sends exactly this transfer, `exportSigned` hands out its bytes. */
    async prepare(client, request) {
        return this.#review(await this.#payment(client, request, false));
    }
    /** Submits a transfer from `prepare` and holds its inputs back from other transfers, as `send` does. */
    async submit(client, prepared) {
        this.#requirePublicSubmission();
        this.#requirePrivateRestored();
        const built = this.#prepared.get(prepared);
        if (!built) {
            throw new TenraiWalletError("only a transfer this wallet prepared can be submitted", "invalid");
        }
        // An exported transfer holds its inputs under its own id already.
        if (this.#open.get(built.prepared.transactionId)?.exported !== true) {
            if (built.spent.some((coin) => this.#held(coin))) {
                throw new TenraiWalletError("a transfer sent since then holds these outputs; prepare it again", "rejected");
            }
            this.#reservations.claimOwned(built.prepared.transactionId, built.spent.map(funds.outpoint), built.prepared.validUntil);
        }
        const sent = await this.#submitBuilt(client, built);
        this.#prepared.delete(prepared);
        return sent;
    }
    /** Signed bytes of a prepared transfer, returned once its inputs are held in the durable journal; nothing is sent. */
    async exportSigned(prepared) {
        this.#requirePublicSubmission();
        const built = this.#prepared.get(prepared);
        if (!built) {
            throw new TenraiWalletError("only a transfer this wallet prepared can be exported", "invalid");
        }
        if (!this.#open.has(built.prepared.transactionId) && built.spent.some((coin) => this.#held(coin))) {
            throw new TenraiWalletError("a transfer sent since then holds these outputs; prepare it again", "rejected");
        }
        await retainPublic(this.#publicState, this.#entry(built));
        return Object.freeze({ ...built.prepared, manifest: built.manifest });
    }
    #review(built) {
        const { transactionId, amount, fee, change, inputs, validUntil } = built.prepared;
        const review = Object.freeze({ transactionId, amount, fee, change, inputs, validUntil });
        this.#prepared.set(review, built);
        return review;
    }
    #entry(built) {
        return { transactionId: built.prepared.transactionId, wireHex: built.prepared.wireHex, manifest: built.manifest,
            validUntil: built.prepared.validUntil, sentAt: Date.now(), spends: built.spent.map((coin) => ({ key: funds.outpoint(coin), address: coin.address })) };
    }
    /** Builds, signs and submits a transfer; a lost answer whose status cannot be read throws `unconfirmed`. */
    async send(client, request) {
        this.#requirePublicSubmission();
        return this.#submitBuilt(client, await this.#payment(client, request, true));
    }
    /** Burns `amount`: pays it to the burn address of the wallet's network. It cannot be undone. */
    async burn(client, request) {
        this.#requirePublicSubmission();
        return this.send(client, { ...request, to: burnAddress(this.network) });
    }
    /**
     * Sends transfers on their way again, unchanged, while the node does not know them and they can still
     * execute, each at most every 30 s: a node that restarts forgets what only its pool held. Every transfer
     * runs it first; call it now and then while waiting. Returns the ids the node took.
     */
    async resend(client) {
        this.#requirePrivateRestored();
        return this.#privateJournal ? this.#privateJournal.run(() => this.#resendOwned(client)) : this.#resendOwned(client);
    }
    async #savePublic() {
        await this.#publicJournal?.save(this.openTransfers());
    }
    async #resendOwned(client) {
        await this.#publicEvidence.reconcile(client).catch(() => []);
        this.#requirePrivateRestored();
        return resendPublic(this.#publicState, client);
    }
    reconcilePublic(client) { this.#requirePrivateRestored(); return this.#publicEvidence.reconcile(client); }
    unknownPublicOutcome(transactionId) { this.#requirePrivateRestored(); if (!this.#publicJournal)
        throw new TenraiWalletError("configure a durable public journal first", "rejected"); return this.#publicJournal.unknown(transactionId); }
    unknownPublicOutcomes(options = {}) { this.#requirePrivateRestored(); if (!this.#publicJournal)
        throw new TenraiWalletError("configure a durable public journal first", "rejected"); return this.#publicJournal.unknownPage(options.after, options.limit); }
    /** The transfers on their way, to keep across a restart of the program and hand to `keepOpen`. */
    openTransfers() {
        return [...this.#open.values()].map((entry) => ({ ...entry, spends: entry.spends.map((spend) => ({ ...spend })) }));
    }
    /** Takes back what `openTransfers` gave: their inputs stay held and `resend` looks after them. */
    keepOpen(transfers) {
        if (this.#publicJournal)
            throw new TenraiWalletError("the durable public journal restores this wallet; close it before explicit recovery import", "rejected");
        this.#installOpen(transfers);
    }
    #installOpen(transfers, authenticatedJournal = false) {
        if (transfers.length > 1024)
            throw new TenraiWalletError("Too many retained public transfers.", "rejected");
        const checked = transfers.map(entry => validatePublicTransfer(this.#wasm, this.network, { ...entry, validUntil: entry.validUntil.toString() }, this.#publicJournal?.chainId));
        if (new Set(checked.map(entry => entry.transactionId)).size !== checked.length)
            throw new TenraiWalletError("A retained public transfer is repeated.", "rejected");
        this.#reservations.retainMany(checked.map(entry => ({ owner: entry.transactionId,
            keys: entry.spends.map(spend => spend.key), validUntil: entry.validUntil })));
        for (const entry of checked)
            this.#open.set(entry.transactionId, { ...entry,
                needsReview: authenticatedJournal && entry.needsReview === false ? false : true });
    }
    /**
     * The most one transfer can pay to `to` (the first receiving address when left out): the largest spendable
     * outputs up to the input limit, less the fee, which a `payload` raises. 0 when they cannot pay the fee.
     */
    async maxSendable(client, request = {}) {
        return compounding.maxSendable(this.#desk, client, request);
    }
    /**
     * Compounds first when `request` needs more outputs than one transfer spends, and waits until that is final;
     * `confirm` sees every round before it goes out. At most 64 compounds per call; returns none when the payment
     * already fits and throws `insufficient` when compounding cannot make it fit.
     */
    async mergeFor(client, request, options = {}) {
        this.#requirePublicSubmission();
        return compounding.mergeFor(this.#desk, client, request, options);
    }
    /** Sends every spendable output to `to`, at most 64 transfers per call; run it again for the rest or after a failure. */
    async sweep(client, request) {
        this.#requirePublicSubmission();
        return compounding.sweep(this.#desk, client, request);
    }
    /**
     * Merges the outputs of every address that holds more than `above` of them (several, by default),
     * at most 64 transfers per call; the way out of `compound-needed`. `autoCompound` runs it on a timer.
     */
    async compound(client, options = {}) {
        this.#requirePublicSubmission();
        return compounding.compound(this.#desk, client, options);
    }
    /** Bonds `amount` to a validator after checking its finalized delegation state. */
    async bond(client, request) {
        this.#requirePublicSubmission();
        return staking.bond(this.#desk, client, request);
    }
    /** Starts unbonding a bonded position of this wallet. */
    async unbond(client, request) {
        this.#requirePublicSubmission();
        return staking.position(this.#desk, client, request, "unbond");
    }
    /** Returns the stake of a position that is `withdrawable` to the wallet. */
    async withdraw(client, request) {
        this.#requirePublicSubmission();
        return staking.position(this.#desk, client, request, "withdraw");
    }
    /** Registers a validator using a self-bond, owner signature and proof of the new consensus key. */
    async registerValidator(client, request) {
        this.#requirePublicSubmission();
        return staking.registerValidator(this.#desk, client, request);
    }
    /** Schedules the validator's exit with the current finalized owner nonce. */
    async exitValidator(client, request) {
        this.#requirePublicSubmission();
        return staking.exitValidator(this.#desk, client, request);
    }
    /** Rotates a validator key and overlay endpoint after checking the finalized registry record. */
    async rotateValidator(client, request) {
        this.#requirePublicSubmission();
        return staking.rotateValidator(this.#desk, client, request);
    }
    /** Schedules an overlay endpoint change while retaining the active consensus key. */
    async updateValidatorEndpoint(client, request) {
        this.#requirePublicSubmission();
        return staking.updateValidatorEndpoint(this.#desk, client, request);
    }
    /** Schedules a delayed validator commission change in the active rules' 10-bps grid. */
    async scheduleValidatorCommission(client, request) {
        this.#requirePublicSubmission();
        return staking.scheduleValidatorCommission(this.#desk, client, request);
    }
    /** Changes the finalized reward lock for one stake position. */
    async setStakeRewardAddress(client, request) {
        this.#requirePublicSubmission();
        return staking.setStakeRewardAddress(this.#desk, client, request);
    }
    /** Publishes one signed heartbeat for the next finalized epoch of an eligible validator. */
    async heartbeatValidator(client, request) {
        this.#requirePublicSubmission();
        return staking.heartbeatValidator(this.#desk, client, request);
    }
    /** Chats of this wallet, `protocol/messenger-v1.md`; the messenger key stays in the WASM. Keep one per wallet. */
    messenger(client) {
        return new Messenger({
            root: () => this.#keys.root(),
            owns: (address) => this.owns(address),
            activity: (target, options) => this.activity(target, options),
            outputs: (target, options) => this.outputs(target, options),
            send: (target, request) => this.send(target, request),
        }, client);
    }
    /** Stops new spending immediately; resolves after outstanding work, key cleanup and store release. */
    close() {
        if (this.#closing)
            return this.#closing;
        let resolve;
        let reject;
        this.#closing = new Promise((yes, no) => { resolve = yes; reject = no; });
        void this.#closing.catch(() => { });
        this.#closed = true;
        const notes = this.#privateNotes?.close();
        const publicEvidence = this.#publicEvidence.close();
        this.#privateJournal?.close();
        const starting = [this.#restoringPrivate, this.#openingPrivate].map((work) => work?.then(() => { }, () => { }));
        void Promise.allSettled([notes, publicEvidence, closeFinalityGuard(this.#keys.root()), this.#addresses.close(), this.#privateJournal?.closed, ...starting]).then((settled) => {
            this.#keys.close();
            const failed = settled.find((result) => result.status === "rejected");
            if (failed?.status === "rejected")
                throw failed.reason;
        }).then(resolve, reject);
        return this.#closing;
    }
    async #payment(client, request, reserve) {
        const given = request;
        if (given.payments !== undefined && (given.to !== undefined || given.amount !== undefined)) {
            throw new TenraiWalletError("pass either `to` and `amount` or `payments`", "invalid");
        }
        const payments = given.payments ?? [{ to: given.to, amount: given.amount }];
        if (!Array.isArray(payments) || payments.length === 0) {
            throw new TenraiWalletError("name at least one recipient", "invalid");
        }
        for (const payment of payments) {
            if (typeof payment?.amount !== "bigint" || payment.amount <= 0n) {
                throw new TenraiWalletError("the amount must be a positive bigint of atoms", "invalid");
            }
        }
        const context = await this.#context(client, request);
        try {
            if (payments.length > context.rules.maxOutputs - 1) {
                throw new TenraiWalletError(`one transfer pays at most ${context.rules.maxOutputs - 1} recipients next to its change`, "too-many-outputs");
            }
            const outputs = payments.map((payment) => ({ address: context.protocol.parseAddress(payment.to), amount: payment.amount }));
            if (new Set(outputs.map((output) => output.address)).size !== outputs.length) {
                throw new TenraiWalletError("a recipient appears twice", "invalid");
            }
            if ((request.include?.length ?? 0) > 8)
                throw new TenraiWalletError("At most 8 required inputs are supported.", "invalid");
            const include = await Promise.all((request.include ?? []).map(async (wanted) => {
                const coin = await context.inventory.get(wanted.transactionId + ":" + wanted.outputIndex);
                if (!coin || this.#held(coin))
                    throw new TenraiWalletError("A required input is unavailable.", "invalid");
                return coin;
            }));
            const planned = await this.#plan(context, {
                ...this.#base(context),
                include,
                payments: outputs,
                changeAddress: this.#changeAddress(context),
                payloadHex: transferPayloadHex(request.payload, payments.map((payment) => payment.payload), context.rules.maxPayloadBytes),
            });
            const amount = outputs.reduce((sum, output) => sum + output.amount, 0n);
            await this.#publicEvidence.verifyCoins(client, planned.inputs, context.rules.chainId);
            return this.#finish(context, planned, amount, outputs.length, reserve);
        }
        finally {
            await context.close();
        }
    }
    async #operate(client, context, request) {
        const { operation, authorities, reserved, released } = request;
        try {
            const planned = await this.#plan(context, {
                ...this.#base(context),
                payments: [],
                changeAddress: this.#changeAddress(context),
                payloadHex: "",
                operation,
                ...(reserved === undefined ? {} : { reserved }),
                ...(released === undefined ? {} : { released }),
            });
            await this.#publicEvidence.verifyCoins(client, planned.inputs, context.rules.chainId);
            const built = this.#finish(context, planned, reserved ?? released ?? 0n, 0, true, authorities);
            await context.close();
            return this.#submitBuilt(client, built);
        }
        finally {
            await context.close();
        }
    }
    #context(client, fee) { return publicContext(this.#publicState, client, fee); }
    /** Plans with the coins free now; when the rest waits in an unfinished transfer of this wallet, the error says so. */
    async #plan(context, request) {
        try {
            return await planFromSource(context.protocol, request, context.inventory);
        }
        catch (error) {
            if (!(error instanceof TenraiWalletError) || error.code !== "insufficient") {
                throw error;
            }
            let waiting = 0n;
            for (const key of this.#pending.keys()) {
                const coin = await context.inventory.get(key);
                if (coin)
                    waiting += coin.amount;
            }
            if (waiting === 0n) {
                throw error;
            }
            throw new TenraiWalletError(`not enough spendable funds right now: ${formatTrai(waiting)} TRAI wait in a transfer of this wallet that is not final yet; they are free again once a cut finalizes it`, "insufficient", { ...error.details, waiting });
        }
    }
    /** Plan fields every transfer shares; the coins leave out what other sends reserved while this one read the node. */
    #base(context) {
        return {
            coins: context.coins.filter((coin) => !this.#held(coin)),
            feePerMass: context.feePerMass,
            validFrom: context.validFrom,
            validUntil: context.validUntil,
            referenced: context.referenced,
        };
    }
    #changeAddress(context) {
        return this.address(context.scan.used.change + 1, "change");
    }
    /** Signs the plan; with `reserve` its inputs are held back from other transfers until they settle or expire. */
    #finish(context, planned, amount, paid, reserve, authorities = {}, claim) {
        const points = planned.inputs.map(funds.outpoint);
        if (claim)
            this.#reservations.assertOwned(claim, points);
        else
            this.#reservations.assertAvailable(points);
        const signed = sign(context.protocol, planned, (coin) => this.#keys.signer(coin.address, "spend"), authorities);
        if (reserve)
            this.#reservations.claimOwned(signed.transactionId, points, context.validUntil);
        else if (claim)
            this.#reservations.transfer(claim, signed.transactionId, points, context.validUntil);
        return {
            prepared: {
                transactionId: signed.transactionId,
                wireHex: toHex(signed.wire),
                amount,
                fee: planned.fee,
                change: planned.outputs.slice(paid).reduce((sum, output) => sum + output.amount, 0n),
                inputs: planned.inputs.length,
                validUntil: context.validUntil,
            },
            spent: planned.inputs,
            manifest: context.protocol.transactionManifest(),
        };
    }
    /**
     * Holds every step's inputs back first, so no other transfer takes them, then signs and submits one
     * step at a time; signing them all up front would block the page for as long as that takes.
     */
    async #steps(client, context, plans) {
        this.#requirePrivateRestored();
        const points = plans.flatMap(planned => planned.inputs.map(funds.outpoint));
        const claim = this.#reservations.temporary(points, context.validUntil);
        const sent = [];
        try {
            for (const planned of plans) {
                await this.#publicEvidence.verifyCoins(client, planned.inputs, context.rules.chainId);
                const built = this.#finish(context, planned, planned.outputs[0]?.amount ?? 0n, 1, false, {}, claim);
                sent.push(await this.#submitBuilt(client, built));
            }
            return sent;
        }
        catch (error) {
            if (error instanceof TenraiWalletError)
                error.details["sent"] = sent;
            throw error;
        }
        finally {
            // Signed artifacts now own their holds by TXID; only never-signed batch inputs are released.
            this.#reservations.releaseOwned(claim, points);
        }
    }
    async #submitBuilt(client, built) {
        this.#requirePrivateRestored();
        const points = built.spent.map(funds.outpoint);
        try {
            this.#reservations.assertOwned(built.prepared.transactionId, points);
        }
        catch (error) {
            this.#reservations.releaseOwned(built.prepared.transactionId, points);
            throw error;
        }
        const entry = this.#entry(built);
        try {
            return { ...built.prepared, lifecycle: await this.#submitPublic(client, entry) };
        }
        catch (error) {
            if (error instanceof TenraiWalletError && error.code === "unconfirmed")
                error.details["transfer"] = built.prepared;
            throw error;
        }
    }
    /** Relays an already signed reviewed public artifact through this wallet's durable submission path. */
    async submitSignedPublic(client, artifact) {
        this.#requirePublicSubmission();
        this.#requirePrivateRestored();
        const entry = validatePublicTransfer(this.#wasm, this.network, { ...artifact, validUntil: artifact.validUntil.toString(), sentAt: Date.now() }, this.#publicJournal?.chainId);
        const prior = this.#open.get(entry.transactionId);
        if (!prior && entry.spends.some((spend) => this.#pending.has(spend.key) || this.#privatelyHeld(spend.key)))
            throw new TenraiWalletError("another retained transfer holds a reviewed input", "rejected");
        if (prior) {
            if (prior.wireHex !== entry.wireHex)
                throw new TenraiWalletError("the retained transfer has different original bytes", "rejected");
            return { transactionId: prior.transactionId, lifecycle: await this.#submitPublic(client, prior) };
        }
        return { transactionId: entry.transactionId, lifecycle: await this.#submitPublic(client, entry) };
    }
    /** Retries the retained original bytes; it never constructs or signs a replacement transaction. */
    async retryPublic(client, transactionId) {
        this.#requirePublicSubmission();
        this.#requirePrivateRestored();
        const entry = this.#open.get(transactionId);
        if (!entry || entry.resendPaused)
            throw new TenraiWalletError("the original transfer is unavailable or needs verified reconciliation", "rejected");
        return { transactionId, lifecycle: await this.#submitPublic(client, entry) };
    }
    async #submitPublic(client, original) {
        this.#requirePrivateRestored();
        const run = () => submitPublic(this.#publicState, client, original);
        return this.#privateJournal ? this.#privateJournal.run(run) : run();
    }
    /** Whether a transfer on its way or a private statement on its way spends this output. */
    #held(coin) {
        const outpoint = funds.outpoint(coin);
        return this.#pending.has(outpoint) || this.#privatelyHeld(outpoint);
    }
    #heldKeys() {
        return new Set([...this.#pending.keys(), ...[...this.#privateHolds.values()].flat(), ...(this.#privateNotes?.heldCoinKeys() ?? [])]);
    }
    #privatelyHeld(outpoint) {
        return [...this.#privateHolds.values()].some((inputs) => inputs.includes(outpoint)) || this.#privateNotes?.holdsCoin(outpoint) === true;
    }
    #operationOwner(context, value) {
        const address = context.protocol.parseAddress(value);
        if (!this.#keys.path(address) && !this.#addresses.search(address)) {
            throw new TenraiWalletError("this wallet does not control the operation owner", "invalid");
        }
        return { address, signer: this.#keys.signer(address, "operation") };
    }
    #requirePublicSubmission() {
        this.#requirePrivateRestored();
        if (!this.#publicJournal)
            throw new TenraiWalletError("configure a durable public journal before managed submission", "rejected");
        this.#publicJournal.requireOutcomeStore();
    }
    #requirePrivateRestored() {
        if (this.#closed || this.#privateRestoreFailed || this.#restoringPrivate) {
            throw new TenraiWalletError("the stored payment journals must be restored before spending", "rejected");
        }
    }
    /** Restores pending ENTER holds only; this reads the supplied store without contacting a node or creating a proof. */
    async restorePrivatePending(options) {
        if (this.#closed)
            throw new TenraiWalletError("the wallet is closed", "rejected");
        if (this.#privateStore && (this.#privateStore.store !== options.store || this.#privateStore.genesisManifest !== options.genesisManifest || this.#privateStore.publicTransfers !== options.publicTransfers)) {
            throw new TenraiWalletError("close the wallet before switching its private journal", "rejected");
        }
        if (this.#restoringPrivate)
            return this.#restoringPrivate;
        this.#privateRestoreFailed = true;
        if (options.publicTransfers && !this.#publicJournal && this.#open.size)
            throw new TenraiWalletError("configure the durable public journal before submitting any transfers", "rejected");
        this.#privateStore = { ...options };
        const run = (async () => {
            if (!this.#privateJournal) {
                const owned = await PrivateStoreSession.acquire(options.store);
                if (this.#closed) {
                    owned.close();
                    await owned.closed;
                    throw new TenraiWalletError("the wallet closed while acquiring its private store", "rejected");
                }
                this.#privateJournal = owned;
            }
            await this.#privateJournal.drained();
            this.#privateJournal.assertOpen();
            if (this.#closed)
                throw new TenraiWalletError("the wallet closed while restoring its public journal", "rejected");
            if (options.publicTransfers && !this.#publicJournal)
                this.#publicJournal = new PublicTransferJournal(this.#wasm, this.#keys.root(), { network: this.network, manifest: options.genesisManifest, account: this.account }, options.publicTransfers, this.#privateJournal);
            const publicTransfers = await this.#publicJournal?.restore();
            const saved = await this.#privateJournal.store.read("sends");
            this.#privateJournal.assertOpen();
            if (this.#closed)
                throw new TenraiWalletError("the wallet closed while restoring its private store", "rejected");
            if (saved !== null && saved !== undefined) {
                const scan = new this.#wasm.PrivateScan(this.#keys.root(), this.network, options.genesisManifest, this.account, undefined, undefined);
                try {
                    const history = openSavedSends(saved, (bytes) => scan.openSends(bytes));
                    const framed = statementScan(scan);
                    for (const entry of history.entries)
                        validateStatementSend(framed, entry);
                    for (const entry of history.entries) {
                        if ((entry.kind === "enter" || entry.kind === "private_register"))
                            this.#privateHolds.set(entry.digest, [...entry.inputs]);
                    }
                }
                finally {
                    scan.free();
                }
            }
            this.#privateJournal.assertOpen();
            if (publicTransfers) {
                this.#open.clear();
                this.#installOpen(publicTransfers, true);
            }
            this.#privateRestoreFailed = false;
        })();
        this.#restoringPrivate = run;
        try {
            await run;
        }
        finally {
            this.#restoringPrivate = undefined;
        }
    }
    /**
     * This account's private notes, read from `client` and checked against the wallet's trust root, and
     * spent with proofs a prover on this device makes; see `localProver`.
     */
    privateNotes(client, options = this.#privateStore) {
        if (!options)
            return Promise.reject(new TenraiWalletError("provide the durable private store before opening private notes", "invalid"));
        if (this.#privateStore && (this.#privateStore.store !== options.store || this.#privateStore.genesisManifest !== options.genesisManifest || this.#privateStore.publicTransfers !== options.publicTransfers)) {
            return Promise.reject(new TenraiWalletError("close the wallet before switching its private journal", "rejected"));
        }
        if (this.#privateNotes && !this.#privateNotes.isClosed)
            return Promise.resolve(this.#privateNotes);
        if (this.#openingPrivate)
            return this.#openingPrivate;
        const run = this.#openPrivate(client, options);
        this.#openingPrivate = run;
        void run.finally(() => { this.#openingPrivate = undefined; }).catch(() => { });
        return run;
    }
    async #openPrivate(client, options) {
        for (const entry of this.#privateNotes?.onTheWay() ?? []) {
            if ((entry.kind === "enter" || entry.kind === "private_register"))
                this.#privateHolds.set(entry.digest, [...entry.inputs]);
        }
        this.#privateNotes?.close();
        this.#privateRestoreFailed = true;
        await this.#privateJournal?.drained();
        await this.restorePrivatePending(options);
        this.#privateRestoreFailed = true;
        let notes;
        try {
            notes = await PrivateNotes.open(this.#wasm, this.#keys.root(), this.network, this.account, client, options, async () => {
                const found = await this.#addresses.scan(client);
                const inventory = await this.#addresses.openCoins(client, found);
                try {
                    const coins = await inventory.largest(8);
                    if (coins.length)
                        await this.#publicEvidence.verifyCoins(client, coins, this.#publicJournal.chainId);
                    return coins
                        .filter((coin) => !this.#held(coin))
                        .flatMap(({ address, transactionId, outputIndex, amount }) => {
                        const path = this.#keys.path(address);
                        return path ? [{ transactionId, outputIndex, amount, branch: path.branch, index: path.index }] : [];
                    });
                }
                finally {
                    await inventory.close();
                }
            }, (digest) => this.#privateHolds.delete(digest), this.#privateJournal);
        }
        catch (error) {
            // Keep the spend fence and all restored holds when pending state cannot be opened.
            throw error;
        }
        if (this.#closed) {
            notes.close();
            throw new TenraiWalletError("the wallet closed while opening private notes", "rejected");
        }
        this.#privateNotes = notes;
        this.#privateRestoreFailed = false;
        return notes;
    }
}
