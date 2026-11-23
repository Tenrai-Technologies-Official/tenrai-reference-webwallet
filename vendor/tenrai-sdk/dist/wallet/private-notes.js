import { attachFinalityGuard, withFinalityProof } from "./finality-guard.js";
import { indexedDbPrivateInventoryStore } from "./private-inventory-store.js";
import { collectInventory, inventoryNotePage, inventoryQuery } from "./private-inventory-runtime.js";
import { answerPrivateScan } from "./private-scan-driver.js";
import { browserPrivateLocalScanStore } from "./private-local-store.js";
import { TenraiApiError, TenraiNetworkError, TenraiTimeoutError, TenraiWalletError } from "../errors.js";
import { privateTransfersUsable } from "../private.js";
import { PrivateSends } from "./private-sends.js";
import { privateSendEvidence, statementScan } from "./private-send-evidence.js";
import { PrivateStoreSession } from "./private-store-session.js";
import { registrationQuote, registrationRequest, sameRegistration } from "./private-registration.js";
import { behindFinality, registrationContext, registrationHead, registrationHeight } from "./private-registration-context.js";
// The WASM reports this when another wallet path has advanced finality.
const STALE_CONTEXT = "refresh this money context to the already verified wallet head";
const staleContext = (error) => String(error instanceof Error ? error.message : error).includes(STALE_CONTEXT) || behindFinality(error);
const PAGE = 512;
/**
 * Verify the finalized head and rebuild the note and nullifier roots in WASM.
 * Keep the verified scan state sealed under the account key for incremental refresh.
 */
export class PrivateNotes {
    #scan;
    #client;
    #store;
    #wasm;
    #root;
    #network;
    #account;
    #coins;
    #sends;
    #resolved;
    #journal;
    #localPages;
    #ownsLocalPages;
    #inventoryPages;
    #ownsInventoryPages;
    #lastSaved;
    #ownsJournal;
    #genesis;
    #closed = false;
    #storageFailed = false;
    #closing;
    #stopped = new AbortController();
    #turn = Promise.resolve();
    /** Input reservations by statement digest while a proof is running. */
    #proving = new Map();
    /** Durable public holds captured at close, if the journal was readable. */
    #retainedInputs;
    #registrationQuotes = new Map();
    #registrationStatusScan;
    #registrationPlanScan;
    constructor(scan, client, store, context) {
        this.#scan = scan;
        this.#client = client;
        this.#store = store;
        this.#wasm = context.wasm;
        this.#root = context.root;
        this.#network = context.network;
        this.#account = context.account;
        this.#coins = context.coins;
        this.#sends = context.sends;
        this.#resolved = context.resolved;
        this.#journal = context.journal;
        this.#localPages = context.localPages;
        this.#ownsLocalPages = context.ownsLocalPages;
        this.#inventoryPages = context.inventoryPages;
        this.#ownsInventoryPages = context.ownsInventoryPages;
        this.#lastSaved = context.sealed;
        this.#ownsJournal = context.ownsJournal;
        this.#genesis = context.genesis;
        const evidence = privateSendEvidence(statementScan(scan), client, context.wasm, () => {
            if (!this.#registrationStatusScan)
                throw new Error("Refresh the public registration context first.");
            return statementScan(this.#registrationStatusScan);
        }, async (entry) => {
            scan.beginSources(JSON.stringify(entry.sources), true);
            await inventoryQuery(scan, this.#inventoryPages, () => this.#journal.assertOpen(), { signal: this.#journal.signal });
            return scan.statementSourcesUnspent(entry.frameHex, JSON.stringify(entry.sources));
        }, work => withFinalityProof(this.#root, this.#network, this.#genesis, work));
        this.#sends.useEvidence({ ...evidence, idle: () => this.#inTurn(async () => { }) });
    }
    /** @internal */
    static async open(wasm, root, network, account, client, options, coins = async () => [], resolved = () => { }, existingJournal) {
        attachFinalityGuard(root, options.finalityStore);
        const journal = existingJournal ?? await PrivateStoreSession.acquire(options.store);
        let scan;
        try {
            const sealed = (await journal.store.read("state")) ?? undefined;
            const mark = (await journal.store.read("mark")) ?? undefined;
            journal.assertOpen();
            scan = new wasm.PrivateScan(root, network, options.genesisManifest, account, sealed, mark);
            const sends = await PrivateSends.open(client, journal.store, scan, journal);
            journal.assertOpen();
            const namespace = journal.store.id.length + ":" + journal.store.id + ":" + network + ":" + account + ":" + scan.privateAddress();
            const browser = typeof globalThis.indexedDB !== "undefined";
            const ownsInventoryPages = options.store.inventoryPages === undefined && browser;
            const inventoryPages = options.store.inventoryPages ?? (ownsInventoryPages ? indexedDbPrivateInventoryStore(namespace) : undefined);
            const ownsLocalPages = options.store.localPages === undefined && browser;
            const localPages = options.store.localPages ?? (ownsLocalPages
                ? browserPrivateLocalScanStore(namespace) : undefined);
            return new PrivateNotes(scan, client, journal.store, { wasm, root, network, account, coins, sends, resolved, journal,
                ownsJournal: existingJournal === undefined, localPages, ownsLocalPages, inventoryPages, ownsInventoryPages, sealed, genesis: options.genesisManifest });
        }
        catch (error) {
            scan?.free();
            if (existingJournal === undefined) {
                journal.close();
                await journal.closed;
            }
            throw error;
        }
    }
    /** True after the scan releases its keys. Pending ENTER holds remain available. */
    get isClosed() { return this.#closed; }
    get address() {
        return this.#scan.privateAddress();
    }
    /** True when unreadable scan state was discarded for recovery. */
    get savedStateDamaged() {
        return this.#scan.damaged();
    }
    /** Rollback marker. Recovery verifies forward and requires a head at least this recent. */
    get rolledBackFrom() {
        const height = this.#scan.rolledBackFrom();
        return height === undefined ? undefined : Number(height);
    }
    /** Wait for the active refresh before using verified inventory. */
    #inTurn(work) {
        const run = this.#turn.then(() => {
            if (this.#closed || this.#storageFailed)
                throw new TenraiWalletError("reopen the private scan after a close or uncertain storage commit", "rejected");
            return this.#journal.run(work);
        });
        this.#turn = run.catch(() => { });
        return run;
    }
    /**
     * Verify and save new chain data. `rescan` replays the compact recovery log.
     * Publish the result only after verifying the finalized state.
     */
    refresh(options = {}) {
        return this.#inTurn(() => this.#refresh(options));
    }
    async #refresh(options) {
        const scan = this.#scan;
        if (this.#sends.pendingProof()) {
            const outcomes = await this.#sends.check(JSON.parse(scan.summary()).height);
            for (const outcome of outcomes)
                if (outcome.outcome === "final" || outcome.outcome === "expired" || outcome.outcome === "unknown")
                    this.#resolved(outcome.send.digest);
            if (this.#sends.pendingProof())
                throw new TenraiWalletError("statement finality history continues on the next check; the verified scan is retained", "rejected");
        }
        const call = { ...options, signal: options.signal ? AbortSignal.any([options.signal, this.#stopped.signal, this.#journal.signal]) : AbortSignal.any([this.#stopped.signal, this.#journal.signal]) };
        try {
            await withFinalityProof(this.#root, this.#network, this.#genesis, () => scan.start(options.rescan ?? false));
            // Restore provisional roots before collecting superseded data.
            if (options.rescan || !this.#lastSaved)
                await this.#save();
            if (this.#lastSaved)
                await collectInventory(scan, this.#inventoryPages, this.#lastSaved, () => this.#journal.assertOpen(), call);
            for (;;) {
                const request = JSON.parse(await withFinalityProof(this.#root, this.#network, this.#genesis, () => scan.next()));
                if (request.kind === "done")
                    break;
                await answerPrivateScan({ proof: work => withFinalityProof(this.#root, this.#network, this.#genesis, work), scan, client: this.#client, localPages: this.#localPages, inventoryPages: this.#inventoryPages,
                    assertOpen: () => this.#journal.assertOpen(), readRecords: (at) => this.#readRecords(at), save: () => this.#save() }, request, call);
            }
            const sealed = await this.#save();
            await this.#localPages?.clearExcept(null);
            await collectInventory(scan, this.#inventoryPages, sealed, () => this.#journal.assertOpen(), call);
            const summary = JSON.parse(scan.summary());
            const page = await inventoryNotePage(scan, this.#inventoryPages, undefined, 128, () => this.#journal.assertOpen(), call);
            const received = [];
            const cursor = await this.#sends.noteArrivalCursor(summary.note_cursor);
            if (cursor !== null) {
                let after = BigInt(cursor) === 0n ? undefined : (BigInt(cursor) - 1n).toString();
                for (;;) {
                    const rows = await inventoryNotePage(scan, this.#inventoryPages, after, 128, () => this.#journal.assertOpen(), call);
                    received.push(...await this.#sends.noteArrivals(summary.height, rows.notes));
                    if (received.length > 128)
                        received.splice(0, received.length - 128);
                    if (rows.nextNote === null)
                        break;
                    after = String(rows.nextNote);
                }
                await this.#sends.finishNoteArrivals(summary.note_cursor, summary.height);
            }
            let reservedAtoms = 0n;
            let reservedNoteCount = 0n;
            const held = this.#reservedNotes();
            if (held.length > 512)
                throw new TenraiWalletError("Too many local private source reservations.", "rejected");
            for (const leaf of new Set(held)) {
                const one = await inventoryNotePage(scan, this.#inventoryPages, leaf === 0 ? undefined : String(leaf - 1), 1, () => this.#journal.assertOpen(), call);
                if (one.notes[0]?.note === leaf) {
                    reservedAtoms += one.notes[0].valueAtoms;
                    reservedNoteCount++;
                }
            }
            if (reservedAtoms > BigInt(summary.balance_atoms))
                throw new TenraiWalletError("Private reservation accounting is invalid.", "invalid");
            return { height: summary.height, balanceAtoms: BigInt(summary.balance_atoms), reservedAtoms, reservedNoteCount, notes: page.notes,
                noteCount: BigInt(summary.note_count), noteCursor: BigInt(summary.note_cursor), nextNote: page.nextNote, received };
        }
        catch (error) {
            throw refusal(error);
        }
    }
    /** Read up to 128 verified notes from local storage. */
    page(options = {}) {
        return this.#inTurn(() => inventoryNotePage(this.#scan, this.#inventoryPages, options.after === undefined ? undefined : String(options.after), options.limit ?? 128, () => this.#journal.assertOpen(), options));
    }
    /** Verified recipient records used to check a statement's anchor. */
    async #readRecords(call, addresses = []) {
        this.#scan.beginRecords(JSON.stringify(addresses));
        call = { ...call, signal: call.signal ? AbortSignal.any([call.signal, this.#stopped.signal, this.#journal.signal]) : AbortSignal.any([this.#stopped.signal, this.#journal.signal]) };
        for (;;) {
            const from = this.#scan.recordsFrom();
            if (from === undefined)
                return;
            const page = await this.#client.privateTransfers.records({ ...call, from: Number(from), limit: PAGE });
            this.#scan.takeRecords(JSON.stringify(page));
        }
    }
    /** Check recipient registration at the last verified cut. Defaults to this account. */
    registered(address, options = {}) {
        return this.#inTurn(async () => {
            await this.#readRecords(options, address === undefined ? [] : [address]);
            return this.#scan.registered(address);
        });
    }
    /** Export owner authorization without funding or publishing a registration. */
    registrationAuthorization() {
        return this.#inTurn(async () => {
            await this.#advanceRegistrationHead();
            return this.#registrationStatusScan.registration();
        });
    }
    /** Check registration using a separate finality context. */
    registrationStatus(options = {}) {
        return this.#inTurn(async () => {
            const signal = AbortSignal.any([this.#stopped.signal, this.#journal.signal, ...(options.signal ? [options.signal] : [])]);
            const scan = this.#registrationStatusScan ??= new this.#wasm.PrivateScan(this.#root, this.#network, this.#genesis, this.#account, undefined, undefined);
            await registrationContext(this.#wasm, this.#root, this.#network, this.#account, this.#genesis, this.#client, undefined, { ...options, signal }, scan);
            return scan.registered(scan.privateAddress());
        });
    }
    /** Quote public inputs, fee, change and validity before sponsor signing. */
    planRegistration(request, options = {}) {
        return this.#inTurn(async () => {
            await this.#requireUsable();
            if (this.#registrationQuotes.size >= 8)
                throw new TenraiWalletError("cancel an unused registration quote before creating another", "rejected");
            const signal = AbortSignal.any([this.#stopped.signal, this.#journal.signal, ...(options.signal ? [options.signal] : [])]);
            const scan = this.#registrationPlanScan ??= new this.#wasm.PrivateScan(this.#root, this.#network, this.#genesis, this.#account, undefined, undefined);
            {
                // Input proofs can advance finality. Read the registration context after them.
                const held = this.#reservedInputs();
                const available = (await this.#coins()).filter((coin) => !held.has(`${coin.transactionId}:${coin.outputIndex}`));
                const requestText = registrationRequest(request, available, this.#account);
                const manifest = JSON.stringify(await this.#client.transactions.manifest({ ...options, signal }));
                let summary;
                for (let attempt = 0;; attempt += 1) {
                    try {
                        await registrationContext(this.#wasm, this.#root, this.#network, this.#account, this.#genesis, this.#client, request.ownerAuthorization, { ...options, signal }, scan);
                        this.#journal.assertOpen();
                        signal.throwIfAborted();
                        summary = scan.planRegistration(this.#root, manifest, requestText);
                        break;
                    }
                    catch (error) {
                        if (attempt >= 2 || !staleContext(error))
                            throw error;
                    }
                }
                const quote = registrationQuote(summary);
                const authorization = JSON.parse(summary).owner_authorization;
                const boundRequest = JSON.stringify({ ...JSON.parse(requestText), owner_authorization: authorization });
                this.#registrationQuotes.set(quote, { request: boundRequest, manifest, summary, scan });
                this.#registrationPlanScan = undefined;
                return quote;
            }
        });
    }
    /** Discard the quote and release its verification context. */
    cancelRegistration(quote) {
        const reviewed = this.#registrationQuotes.get(quote);
        if (reviewed) {
            this.#registrationQuotes.delete(quote);
            reviewed.scan.free();
        }
    }
    /** Sign the issued quote, commit its original frame and submit it. */
    register(quote) {
        this.#sends.requireOutcomeStore();
        return this.#inTurn(async () => {
            const reviewed = this.#registrationQuotes.get(quote);
            if (!reviewed)
                throw new TenraiWalletError("review a registration quote from this wallet before signing", "rejected");
            // Hold the context across signing even if the dialog closes.
            this.#registrationQuotes.delete(quote);
            try {
                if (this.#sends.list().some((send) => send.kind === "private_register" && send.to === quote.owner)) {
                    throw new TenraiWalletError("this owner's original registration is still reserved; reconcile or retry it", "rejected");
                }
                const held = this.#reservedInputs();
                const available = new Map((await this.#coins()).map((coin) => [`${coin.transactionId}:${coin.outputIndex}`, coin.amount]));
                this.#journal.assertOpen();
                this.#stopped.signal.throwIfAborted();
                if (quote.inputs.some((input) => held.has(`${input.transactionId}:${input.outputIndex}`)
                    || available.get(`${input.transactionId}:${input.outputIndex}`) !== input.amountAtoms)) {
                    throw new TenraiWalletError("a reviewed registration input is now unavailable or reserved", "rejected");
                }
                const { signed, prepared } = await this.#registrationAtNewestHead(reviewed, quote);
                try {
                    const summary = JSON.parse(signed);
                    const frameHex = toHex(prepared.frame());
                    const metadata = { input_amount_atoms: summary.input_amount_atoms, maximum_fee_atoms: summary.maximum_fee_atoms };
                    const inspected = JSON.parse(reviewed.scan.registrationFrameInfo(frameHex, JSON.stringify(metadata)));
                    // The signing head may be newer than the status context.
                    await this.#advanceRegistrationHead();
                    return await this.#sends.send({ digest: summary.digest, kind: "private_register", route: "registrations", amountAtoms: "0",
                        feeAtoms: summary.fee_atoms, validUntil: summary.valid_until_height, sources: [], ownNoteCommitments: [],
                        inputs: summary.inputs.map((input) => `${input.transaction_id}:${input.output_index}`), to: summary.owner,
                        stage: "sending", time: Date.now(), frameHex,
                        registration: { frameId: inspected.frame_id, inputAmountAtoms: summary.input_amount_atoms, maximumFeeAtoms: summary.maximum_fee_atoms } });
                }
                finally {
                    prepared.free();
                }
            }
            finally {
                reviewed.scan.free();
            }
        });
    }
    /** Refresh the scan and retry preparation if finality advances during the operation. */
    async #atNewestHead(prepare) {
        for (let attempt = 0;; attempt += 1) {
            try {
                return await prepare();
            }
            catch (error) {
                if (attempt >= 2 || !staleContext(error))
                    throw error;
            }
        }
    }
    /** Recheck the quote at the latest verified head before signing. */
    async #registrationAtNewestHead(reviewed, quote) {
        const ownerAuthorization = JSON.parse(reviewed.request).owner_authorization;
        const signal = AbortSignal.any([this.#stopped.signal, this.#journal.signal]);
        for (let attempt = 0;; attempt += 1) {
            try {
                await registrationContext(this.#wasm, this.#root, this.#network, this.#account, this.#genesis, this.#client, ownerAuthorization, { signal }, reviewed.scan);
                const signed = reviewed.scan.planRegistration(this.#root, reviewed.manifest, reviewed.request);
                if (!sameRegistration(registrationQuote(signed), quote))
                    throw new TenraiWalletError("the registration plan changed; review a new quote", "rejected");
                const prepared = reviewed.scan.prepareRegistration(this.#root, reviewed.manifest, reviewed.request);
                if (prepared.summary() !== signed) {
                    prepared.free();
                    throw new TenraiWalletError("the registration plan changed; review a new quote", "rejected");
                }
                return { signed, prepared };
            }
            catch (error) {
                if (attempt >= 2 || !staleContext(error))
                    throw error;
            }
        }
    }
    async #advanceRegistrationHead(options = {}) {
        const scan = this.#registrationStatusScan ??= new this.#wasm.PrivateScan(this.#root, this.#network, this.#genesis, this.#account, undefined, undefined);
        await registrationHead(this.#wasm, this.#root, this.#network, this.#account, this.#genesis, this.#client, { ...options, signal: AbortSignal.any([this.#stopped.signal, this.#journal.signal, ...(options.signal ? [options.signal] : [])]) }, scan);
        return registrationHeight(scan);
    }
    /** Check the node rules and security qualification for private spending. */
    async usability() {
        const status = await this.#client.privateTransfers.status({ signal: AbortSignal.any([this.#stopped.signal, this.#journal.signal]) });
        if (!status.active)
            return "inactive";
        const rules = JSON.parse(this.#wasm.privateRules());
        if (status.protocol.verifier_keys_digest !== rules.verifier_keys_digest || status.fees.schedule_digest !== rules.schedule_digest) {
            return "other-rules";
        }
        if (!status.protocol.fits_consensus_limits)
            return "no-fit";
        if (privateTransfersUsable(status) || this.#network !== "mainnet")
            return "ready";
        return "review-open";
    }
    async #requireUsable() {
        const reasons = {
            inactive: "private transfers are not active on this network",
            "other-rules": "the node runs other private rules than this wallet knows; update one of them",
            "no-fit": "the node reports that proofs do not fit its limits, so private transfers stay off",
            "review-open": "the security review of private transfers is open, so they stay off on mainnet",
        };
        const usability = await this.usability();
        if (usability !== "ready")
            throw new TenraiWalletError(reasons[usability], "rejected");
    }
    async #ready(address, options) {
        await this.#requireUsable();
        const call = options.signal ? { signal: options.signal } : {};
        for (let attempt = 0; attempt < 4; attempt++) {
            // Refresh notes after any other work that can advance finality.
            const fresh = await this.#advanceRegistrationHead(call);
            await this.#refresh(call);
            await this.#readRecords(call, address === undefined ? [] : [address]);
            const summary = JSON.parse(this.#scan.summary());
            const rules = JSON.parse(this.#wasm.privateRules());
            const head = JSON.parse(this.#scan.verifiedHead());
            const latest = JSON.parse(this.#registrationStatusScan.registrationVerifiedHead());
            const caught = BigInt(summary.height) >= this.#root.finalityHeight(this.#network, this.#genesis);
            if (caught && fresh - summary.height <= Math.floor(rules.validity_cuts / 4) && head.params_hash === latest.params_hash)
                break;
            if (attempt === 3)
                throw new TenraiWalletError("Private recovery could not catch the current verified head; retry before signing.", "rejected");
        }
        if (!this.#scan.registered()) {
            throw new TenraiWalletError("this wallet's private account is not published yet; call register first", "rejected");
        }
        if (address !== undefined && !this.#scan.registered(address)) {
            throw new TenraiWalletError("this address has no private account yet; its owner must publish it first", "rejected");
        }
    }
    #reservedNotes() {
        return [...this.#sends.reservedNotes(), ...[...this.#proving.values()].flatMap((held) => held.notes)];
    }
    #reservedInputs() {
        return new Set([...this.#sends.reservedInputs(), ...[...this.#proving.values()].flatMap((held) => held.inputs)]);
    }
    /** Reserve inputs during proof creation, then transfer the hold to the retained statement. */
    #held(prepared) {
        const summary = JSON.parse(prepared.summary());
        const inputs = summary.inputs.map((input) => `${input.transaction_id}:${input.output_index}`);
        if (this.#proving.size >= 64) {
            prepared.free();
            throw new TenraiWalletError("Finish an active private proof before starting another.", "rejected");
        }
        this.#proving.set(summary.digest, { notes: summary.sources, inputs });
        return prepared;
    }
    /** Prove, verify, journal and submit the statement. */
    async #proveAndSend(prepared, to, options) {
        const summary = JSON.parse(prepared.summary());
        try {
            const prove = {};
            prove.signal = options.signal ? AbortSignal.any([options.signal, this.#stopped.signal, this.#journal.signal]) : AbortSignal.any([this.#stopped.signal, this.#journal.signal]);
            if (options.onProgress)
                prove.onProgress = options.onProgress;
            prove.kind = summary.kind === "exit" ? "exit" : "large";
            const proof = await options.prover.prove(prepared.proverInput(), prove);
            if (this.#closed)
                throw new TenraiWalletError("the private scan closed before its proof could be submitted", "rejected");
            this.#journal.assertOpen();
            const frame = prepared.frame(proof);
            return await this.#sends.send({
                digest: summary.digest,
                kind: summary.kind,
                route: summary.route,
                amountAtoms: summary.amount_atoms,
                feeAtoms: summary.fee_atoms,
                validUntil: summary.valid_until_height,
                sources: summary.sources,
                inputs: summary.inputs.map((input) => `${input.transaction_id}:${input.output_index}`),
                to,
                stage: "sending",
                time: Date.now(),
                ownNoteCommitments: summary.own_note_commitments,
                frameHex: toHex(frame),
            });
        }
        finally {
            this.#proving.delete(summary.digest);
            prepared.free();
        }
    }
    /** Move public coins into notes, with any change returning to this account. */
    async enter(request, options) {
        this.#sends.requireOutcomeStore();
        const toItself = request.to === undefined || request.to === this.address;
        const prepared = await this.#inTurn(async () => {
            // Refresh notes after the public input proofs advance finality.
            const held = this.#reservedInputs();
            const coins = (await this.#coins()).filter((coin) => !held.has(`${coin.transactionId}:${coin.outputIndex}`));
            const plan = JSON.parse(this.#wasm.planPrivateEnter(request.amount.toString(), toItself, JSON.stringify(coins.map((coin) => coin.amount.toString()))));
            if (plan.problem !== undefined || plan.inputs === undefined) {
                throw new TenraiWalletError(plan.problem === "not_enough"
                    ? "the spendable coins do not cover the amount and the fee"
                    : "seven coins do not cover this with a valid note left over; compound them first", plan.problem === "not_enough" ? "insufficient" : "compound-needed");
            }
            const inputs = plan.inputs;
            const manifest = JSON.stringify(await this.#client.transactions.manifest());
            const enter = JSON.stringify({
                amount: request.amount.toString(),
                coins: inputs.map((index) => {
                    const coin = coins[index];
                    return {
                        transaction_id: coin.transactionId,
                        output_index: String(coin.outputIndex),
                        amount: coin.amount.toString(),
                        account: String(this.#account),
                        branch: coin.branch,
                        index: String(coin.index),
                    };
                }),
                ...(toItself ? {} : { to: request.to }),
            });
            return this.#atNewestHead(async () => {
                await this.#ready(toItself ? undefined : request.to, options);
                return this.#held(this.#scan.prepareEnter(this.#root, manifest, enter));
            });
        });
        return this.#proveAndSend(prepared, toItself ? null : request.to, options);
    }
    /** Send from two owned notes and return private change to this account. */
    async transfer(request, options) {
        this.#sends.requireOutcomeStore();
        const prepared = await this.#inTurn(() => this.#atNewestHead(async () => {
            await this.#ready(request.to, options);
            const reserved = this.#reservedNotes();
            this.#scan.beginSelection(request.amount.toString(), JSON.stringify(reserved));
            const plan = await inventoryQuery(this.#scan, this.#inventoryPages, () => this.#journal.assertOpen(), options);
            if (plan.problem !== undefined) {
                const reasons = {
                    not_enough: "the free notes do not cover the amount and the fee",
                    too_few_notes: "a transfer spends two notes and this wallet has fewer free; an ENTER adds one",
                    no_pair: "no two free notes cover this with a valid note left over",
                };
                throw new TenraiWalletError(reasons[plan.problem] ?? plan.problem, "insufficient");
            }
            if (!plan.sources || plan.sources.length !== 2)
                throw new TenraiWalletError("The local note selection is incomplete.", "invalid");
            this.#scan.beginSources(JSON.stringify(plan.sources), false);
            await inventoryQuery(this.#scan, this.#inventoryPages, () => this.#journal.assertOpen(), options);
            return this.#held(this.#scan.prepareTransfer(JSON.stringify({ to: request.to, amount: request.amount.toString(), reserved })));
        }));
        return this.#proveAndSend(prepared, request.to, options);
    }
    /** Exit one or two notes to a public address after fees. */
    async exit(request, options) {
        this.#sends.requireOutcomeStore();
        const prepared = await this.#inTurn(() => this.#atNewestHead(async () => {
            await this.#ready(undefined, options);
            const reserved = this.#reservedNotes();
            if (request.notes.some((note) => reserved.includes(note))) {
                throw new TenraiWalletError("a statement on its way spends this note already", "rejected");
            }
            this.#scan.beginSources(JSON.stringify(request.notes), false);
            await inventoryQuery(this.#scan, this.#inventoryPages, () => this.#journal.assertOpen(), options);
            return this.#held(this.#scan.prepareExit(JSON.stringify({ to: request.to, notes: request.notes })));
        }));
        return this.#proveAndSend(prepared, request.to, options);
    }
    /** Retained statements and their input holds. */
    onTheWay() {
        return this.#sends.list();
    }
    /** Settled transactions and received payments, newest first. */
    recent() {
        return this.#sends.recent();
    }
    /** Reconcile retained statements at the latest verified cut and retry executable originals. */
    check(tip) {
        return this.#checkPending(tip, false);
    }
    /** Reconcile registration funding independently of note recovery. */
    checkRegistrations() {
        return this.#checkPending(0, true);
    }
    #checkPending(tip, registrationsOnly) {
        return this.#inTurn(async () => {
            if (this.#sends.list().some((send) => send.kind === "private_register"))
                await this.#advanceRegistrationHead();
            const outcomes = await this.#sends.check(tip, registrationsOnly);
            for (const outcome of outcomes) {
                if (outcome.outcome === "final" || outcome.outcome === "expired" || outcome.outcome === "unknown")
                    this.#resolved(outcome.send.digest);
            }
            return outcomes;
        });
    }
    /** Ambiguous outcomes remain queryable after their expired active holds are closed. */
    unknownOutcome(digest) { return this.#inTurn(() => this.#sends.unknown(digest)); }
    unknownOutcomes(options = {}) { return this.#inTurn(() => this.#sends.unknownPage(options.after, options.limit)); }
    /** Retries a reviewed statement with the original stored proof and digest. */
    retry(digest) {
        return this.#inTurn(async () => {
            if (this.#sends.list().some((send) => send.digest === digest && send.kind === "private_register"))
                await this.#advanceRegistrationHead();
            return this.#sends.retry(digest);
        });
    }
    async #save() {
        if (this.#closed)
            throw new TenraiWalletError("the private scan is closed", "rejected");
        const sealed = this.#scan.seal();
        try {
            await this.#store.write("state", sealed);
            if (this.#closed)
                throw new TenraiWalletError("the private scan is closed", "rejected");
            await this.#store.write("mark", this.#scan.mark());
            this.#lastSaved = sealed;
            return sealed;
        }
        catch (error) {
            this.#storageFailed = true;
            throw error;
        }
    }
    /** Whether a statement on its way spends this transparent output, named `transactionId:outputIndex`. */
    /** Bounded retained/proving public input IDs for indexed balance selection. */
    heldCoinKeys() { return this.#closed ? this.#retained() : this.#reservedInputs(); }
    holdsCoin(outpoint) {
        return (this.#closed ? this.#retained() : this.#reservedInputs()).has(outpoint);
    }
    #retained() {
        if (!this.#retainedInputs) {
            throw new TenraiWalletError("the private holds of this closed scan are unknown; reopen the private store before spending", "rejected");
        }
        return this.#retainedInputs;
    }
    /** Frees scan keys; executable pending ENTER frames retain their public outpoint holds. */
    close() {
        if (this.#closing)
            return this.#closing;
        try {
            this.#retainedInputs = new Set(this.#sends.reservedInputs());
        }
        catch {
            this.#retainedInputs = undefined;
        }
        let resolve;
        let reject;
        this.#closing = new Promise((yes, no) => { resolve = yes; reject = no; });
        void this.#closing.catch(() => { });
        this.#closed = true;
        this.#stopped.abort(new TenraiWalletError("the private scan closed", "rejected"));
        const sendsClosed = this.#sends.close();
        const freed = Promise.all([this.#turn, sendsClosed]).then(() => {
            for (const quote of this.#registrationQuotes.keys())
                this.cancelRegistration(quote);
            this.#registrationStatusScan?.free();
            this.#registrationStatusScan = undefined;
            this.#registrationPlanScan?.free();
            this.#registrationPlanScan = undefined;
            this.#scan.free();
            if (this.#ownsLocalPages)
                this.#localPages?.close?.();
            if (this.#ownsInventoryPages)
                this.#inventoryPages?.close?.();
        });
        if (this.#ownsJournal)
            this.#journal.close();
        void Promise.all([freed, this.#ownsJournal ? this.#journal.closed : this.#journal.drained()]).then(() => resolve(), reject);
        return this.#closing;
    }
}
function toHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
/** What the scan says when this node does not hold what this wallet needs; a synchronized full or pruned node does. */
const HISTORY_NOT_HELD = /does not hold the notes|proves no spends/;
function refusal(error) {
    if (error instanceof TenraiApiError ||
        error instanceof TenraiNetworkError ||
        error instanceof TenraiTimeoutError ||
        error instanceof TenraiWalletError) {
        return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    return new TenraiWalletError(message, HISTORY_NOT_HELD.test(message) ? "history-not-held" : "invalid");
}
