import { OutcomeArchive, UnknownOutcomeError } from "./unknown-outcome.js";
import { TenraiApiError, TenraiWalletError } from "../errors.js";
import { MAX_SENDS_BYTES, noteCursor, encodeSavedSends, openSavedSends, samePreparedSend, sendRecord, sendSnapshot } from "./private-send-records.js";
/** Permanent submission refusals pause automatic retry while the original frame stays reserved. */
const DEFINITE_CONFLICTS = new Set(["input_pooled", "input_missing", "note_pooled", "note_spent"]);
/** A private statement holds a proof of about 1 MB in hexadecimal; a slow line needs time for it. */
const SUBMIT_TIMEOUT_MILLIS = 120_000;
/** The newest finished transactions a wallet keeps to show. */
const DONE_KEPT = 20;
function definiteRefusal(error) {
    if (!(error instanceof TenraiApiError))
        return false;
    if (error.status === 409)
        return error.reason !== undefined && DEFINITE_CONFLICTS.has(error.reason);
    return error.status >= 400 && error.status <= 499 && ![408, 425, 429].includes(error.status);
}
function submitter(client, route, signal) {
    const api = client.privateTransfers;
    const options = { timeoutMillis: SUBMIT_TIMEOUT_MILLIS, signal };
    return (bytes) => route === "registrations" ? api.submitRegistration(bytes, options) : route === "enters" ? api.submitEnter(bytes, options) : route === "transfers" ? api.submitTransfer(bytes, options) : api.submitExit(bytes, options);
}
/** Keeps exact frames reserved until certified execution or proven unused expiry. */
export class PrivateSends {
    #client;
    #store;
    #archive;
    #sealer;
    #entries = new Map();
    #submitting = new Set();
    #checking = false;
    #done = [];
    #nextLeaf = null;
    #expected = [];
    #evidence;
    #writing = Promise.resolve();
    #queuedWrites = 0;
    #uncertain = false;
    #stopped = new AbortController();
    #journal;
    #closed = false;
    #archiveCount = 0;
    #archiveIdle = Promise.resolve();
    #archiveDone = () => { };
    constructor(client, store, sealer, journal) {
        this.#client = client;
        this.#store = store;
        this.#sealer = sealer;
        this.#archive = store.outcomes ? new OutcomeArchive(store.outcomes, { seal: (_id, plain) => sealer.sealSends(plain), open: (_id, sealed) => sealer.openSends(sealed) }) : undefined;
        this.#journal = journal;
    }
    /** @internal */
    static async open(client, store, sealer, journal) {
        const sends = new PrivateSends(client, store, sealer, journal);
        const saved = await store.read("sends");
        if (saved !== null && saved !== undefined) {
            const plain = openSavedSends(saved, (bytes) => sealer.openSends(bytes));
            for (const entry of plain.entries)
                sends.#entries.set(entry.digest, entry);
            sends.#done = plain.done;
            sends.#nextLeaf = plain.nextLeaf;
            sends.#expected = plain.expected;
        }
        return sends;
    }
    list() {
        return [...this.#entries.values()].map(sendSnapshot);
    }
    /** A send after its proof runs beside the scan's refreshes; one that meets the scan half read reads it once it is whole. */
    async #wholeSnapshot(evidence, entry) {
        try {
            return evidence.snapshot(entry);
        }
        catch (error) {
            if (!evidence.idle || !String(error instanceof Error ? error.message : error).includes("the private inventory is not verified"))
                throw error;
            await evidence.idle();
            return evidence.snapshot(entry);
        }
    }
    /** @internal Evidence comes from the completed, independently verified private scan. */
    useEvidence(evidence) {
        for (const entry of this.#entries.values())
            evidence.validate(sendSnapshot(entry));
        this.#evidence = evidence;
    }
    /** @internal A bounded historical proof must finish before refresh resets its tracker. */
    pendingProof() { return this.#evidence?.pending("private") !== undefined; }
    recent() {
        return this.#done.map((row) => ({ ...row }));
    }
    /** A cold wallet establishes its certified global watermark without inventing old arrivals. */
    async noteArrivalCursor(globalCursor) {
        const end = noteCursor(globalCursor);
        return this.#change((draft) => {
            if (draft.nextLeaf === null) {
                draft.nextLeaf = end;
                return null;
            }
            if (BigInt(draft.nextLeaf) > BigInt(end))
                throw new TypeError("private arrival cursor moved backwards");
            return draft.nextLeaf;
        });
    }
    /** Persists each bounded page before returning its newly observed payments. */
    async noteArrivals(height, notes) {
        if (!Number.isSafeInteger(height) || height < 0 || !Array.isArray(notes) || notes.length > 128)
            throw new TypeError("invalid private arrivals page");
        const rows = notes.map((note) => {
            if (typeof note.note === "number" && (!Number.isSafeInteger(note.note) || note.note < 0))
                throw new TypeError("invalid private note index");
            const leaf = BigInt(noteCursor(String(note.note)));
            if (leaf >= 1n << 64n || typeof note.valueAtoms !== "bigint" || note.valueAtoms < 0n || note.valueAtoms >= 1n << 128n || typeof note.noteCommitment !== "string" || !/^[0-9a-f]{96}$/.test(note.noteCommitment))
                throw new TypeError("invalid private arrival");
            return { ...note, leaf };
        });
        if (rows.some((row, index) => index > 0 && row.leaf <= rows[index - 1].leaf) || new Set(rows.map((row) => row.noteCommitment)).size !== rows.length)
            throw new TypeError("private arrivals are not distinct and ordered");
        return this.#change((draft) => {
            if (draft.nextLeaf === null)
                throw new TypeError("private arrival scan has no global cursor");
            const seen = BigInt(draft.nextLeaf);
            const arrivals = [];
            for (const note of rows) {
                if (note.leaf < seen)
                    continue;
                const own = draft.expected.findIndex((row) => row.id === note.noteCommitment);
                if (own >= 0)
                    draft.expected.splice(own, 1);
                else
                    arrivals.push({ kind: "received", amountAtoms: note.valueAtoms.toString(), to: null, height, time: Date.now() });
                draft.nextLeaf = (note.leaf + 1n).toString();
            }
            draft.done = [...arrivals, ...draft.done].slice(0, DONE_KEPT);
            return arrivals;
        });
    }
    /** A complete certified scan also retires own outputs already spent before this scan. */
    async finishNoteArrivals(globalCursor, finalizedHeight) {
        const end = noteCursor(globalCursor);
        if (!Number.isSafeInteger(finalizedHeight) || finalizedHeight < 0)
            throw new TypeError("invalid private arrival height");
        await this.#change((draft) => {
            if (draft.nextLeaf === null || BigInt(draft.nextLeaf) > BigInt(end))
                throw new TypeError("private arrival cursor moved backwards");
            draft.nextLeaf = end;
            draft.expected = draft.expected.filter((row) => (row.finalizedHeight === null || row.finalizedHeight > finalizedHeight) && (row.closedAtHeight === null || row.closedAtHeight > finalizedHeight));
        });
    }
    reservedNotes() {
        this.#assertOpen();
        return this.list().flatMap((entry) => entry.sources);
    }
    reservedInputs() {
        this.#assertOpen();
        return new Set(this.list().flatMap((entry) => entry.inputs));
    }
    /** A bounded write actor publishes its next cache only after durable storage acknowledges it. */
    async #change(edit) {
        this.#assertOpen();
        if (this.#queuedWrites >= 8)
            throw new TenraiWalletError("the private journal is busy", "rejected");
        this.#queuedWrites += 1;
        const change = this.#writing.then(async () => {
            this.#assertOpen();
            const draft = { version: 1, entries: this.list(), done: this.#done.map((row) => ({ ...row })), nextLeaf: this.#nextLeaf, expected: this.#expected.map((row) => ({ ...row })) };
            const result = edit(draft);
            const plain = encodeSavedSends(draft);
            let sealed;
            try {
                const encoded = this.#sealer.sealSends(plain);
                if (!(encoded instanceof Uint8Array) || encoded.byteLength > MAX_SENDS_BYTES + 65536)
                    throw new RangeError("sealed private sends exceed their storage limit");
                sealed = encoded.slice();
            }
            finally {
                plain.fill(0);
            }
            this.#assertOpen();
            try {
                await this.#store.write("sends", sealed);
            }
            catch (error) {
                this.#uncertain = true;
                throw error;
            }
            this.#entries.clear();
            for (const entry of draft.entries)
                this.#entries.set(entry.digest, entry);
            this.#done = draft.done.map((row) => ({ ...row }));
            this.#nextLeaf = draft.nextLeaf;
            this.#expected = draft.expected.map((row) => ({ ...row }));
            return result;
        });
        this.#writing = change.then(() => { }, () => { });
        try {
            return await change;
        }
        finally {
            this.#queuedWrites -= 1;
        }
    }
    /** @internal Check before signing or starting a prover for a managed payment. */
    requireOutcomeStore() {
        this.#assertOpen();
        if (!this.#archive)
            throw new TenraiWalletError("configure a durable outcome store before submitting private payments", "rejected");
    }
    /** Paged durable outcomes retain the original artifact without occupying active reservations. */
    async unknown(digest) {
        this.#assertOpen();
        if (!this.#archive)
            throw new TenraiWalletError("configure a durable outcome store before closing an ambiguous payment", "rejected");
        return this.#archiveWork(() => this.#archive.read("private", digest, sendRecord));
    }
    async unknownPage(after, limit = 128) {
        this.#assertOpen();
        if (!this.#archive)
            throw new TenraiWalletError("configure a durable outcome store before reading ambiguous payments", "rejected");
        return this.#archiveWork(() => this.#archive.store.page("private", after, limit));
    }
    async #closeExpired(entry, signal) {
        const evidence = this.#evidence;
        const coverage = await evidence.sourceCoverage?.(sendSnapshot(entry), signal).catch(() => undefined);
        if (coverage) {
            const current = evidence.snapshot(entry);
            if (coverage.anchor.height <= entry.validUntil || JSON.stringify(current.anchor) !== JSON.stringify(coverage.anchor))
                return undefined;
            if (coverage.allUnspent === true) {
                await this.#dropped(entry);
                return { outcome: "expired", send: sendSnapshot(entry) };
            }
            if (coverage.allUnspent !== false)
                throw new TypeError("incomplete source coverage");
            if (!this.#archive) {
                await this.#review(entry, "configure a durable outcome store before closing this ambiguous payment");
                return undefined;
            }
            let saved;
            try {
                saved = await this.#archiveWork(() => this.#archive.retain("private", entry.digest, coverage.anchor, sendSnapshot(entry), sendRecord, samePreparedSend));
            }
            catch (error) {
                this.#uncertain = true;
                throw error;
            }
            this.#assertOpen();
            if (saved.closedAt.height > coverage.anchor.height || JSON.stringify(evidence.snapshot(entry).anchor) !== JSON.stringify(coverage.anchor))
                return undefined;
            await this.#change((draft) => {
                const original = draft.entries.find((row) => row.digest === entry.digest);
                if (!original || !samePreparedSend(original, entry))
                    throw new TypeError("the pending artifact changed during reconciliation");
                draft.entries = draft.entries.filter((row) => row.digest !== entry.digest);
                for (const expected of draft.expected)
                    if (entry.ownNoteCommitments.includes(expected.id))
                        expected.closedAtHeight = coverage.anchor.height;
            });
            return { outcome: "unknown", send: sendSnapshot(entry), closedAtHeight: coverage.anchor.height };
        }
        // Positive-only evidence can prove unused expiry; it cannot authenticate absence.
        const unused = await Promise.resolve().then(() => entry.kind === "enter" || entry.kind === "private_register"
            ? evidence.inputsUnspent(sendSnapshot(entry), signal) : evidence.sourcesUnspent(sendSnapshot(entry))).catch(() => false);
        if (unused === true) {
            await this.#dropped(entry);
            return { outcome: "expired", send: sendSnapshot(entry) };
        }
        await this.#review(entry, "the expired statement's inputs need verified reconciliation");
        return undefined;
    }
    async #dropped(entry) {
        await this.#change((draft) => {
            draft.entries = draft.entries.filter((row) => row.digest !== entry.digest);
            draft.expected = draft.expected.filter((row) => !entry.ownNoteCommitments.includes(row.id));
        });
    }
    /** @internal Keeps a proven statement, then hands it to the node. */
    async send(entry) {
        this.#assertOpen();
        const prepared = sendRecord(entry);
        if (!this.#evidence)
            throw new TenraiWalletError("the original frame must be checked before submission", "rejected");
        this.#evidence.validate(prepared);
        if (!this.#archive)
            throw new TenraiWalletError("configure a durable outcome store before submitting private payments", "rejected");
        const previous = await this.#archiveWork(() => this.#archive.read("private", prepared.digest, sendRecord));
        if (previous)
            throw new UnknownOutcomeError(prepared.digest, previous.closedAt.height);
        const fresh = await this.#change((draft) => {
            const previous = draft.entries.find((row) => row.digest === prepared.digest);
            if (previous) {
                if (!samePreparedSend(previous, prepared))
                    throw new TenraiWalletError("a pending statement cannot replace its original frame or reservations", "invalid");
                return false;
            }
            if (draft.entries.some((row) => row.sources.some((source) => prepared.sources.includes(source)) || row.inputs.some((input) => prepared.inputs.includes(input))))
                throw new TenraiWalletError("another private statement reserves these inputs", "rejected");
            if (prepared.ownNoteCommitments.some((id) => draft.expected.some((row) => row.id === id)))
                throw new TenraiWalletError("a private output commitment is already reserved", "invalid");
            draft.entries.push(prepared);
            draft.expected.push(...prepared.ownNoteCommitments.map((id) => ({ id, finalizedHeight: null, closedAtHeight: null })));
            return true;
        });
        if (fresh)
            await this.#submit(prepared);
        return sendSnapshot(this.#entries.get(prepared.digest) ?? prepared);
    }
    async #stage(entry, stage) {
        await this.#change((draft) => {
            const row = draft.entries.find((row) => row.digest === entry.digest);
            if (row) {
                row.stage = stage;
                if (stage !== "needs_review")
                    delete row.reviewReason;
            }
        });
    }
    async #review(entry, reason) {
        const message = (reason instanceof Error ? reason.message : String(reason)).slice(0, 512);
        await this.#change((draft) => {
            const row = draft.entries.find((row) => row.digest === entry.digest);
            if (row) {
                row.stage = "needs_review";
                row.reviewReason = message;
            }
        });
    }
    /** Persists the original frame before POST; any uncertain or refused copy retains its reservations. */
    async #submit(entry) {
        return this.#journal ? this.#journal.run(() => this.#submitOwned(entry)) : this.#submitOwned(entry);
    }
    async #submitOwned(entry) {
        // A check that comes while the statement is on the line finds it unknown; a second copy would only spend budget.
        if (this.#submitting.has(entry.digest)) {
            return;
        }
        this.#submitting.add(entry.digest);
        let posted = false;
        try {
            // Persist the original bytes and write-ahead intent before every POST.
            await this.#change((draft) => {
                const row = draft.entries.find((row) => row.digest === entry.digest);
                if (!row)
                    throw new TenraiWalletError("the private statement has already settled", "rejected");
                row.attempted = true;
            });
            this.#assertOpen();
            if (this.#evidence && (await this.#wholeSnapshot(this.#evidence, entry)).height >= entry.validUntil) {
                throw new TenraiWalletError("the statement's last valid cut has already finalized", "rejected");
            }
            if (!this.#evidence?.assertFinality)
                throw new TenraiWalletError("A durable shared finality owner is required before private submission.", "rejected");
            await this.#evidence.assertFinality(entry);
            this.#assertOpen();
            posted = true;
            const signal = this.#journal ? AbortSignal.any([this.#stopped.signal, this.#journal.signal]) : this.#stopped.signal;
            const post = () => submitter(this.#client, entry.route, signal)(entry.frameHex);
            const receipt = await post();
            this.#assertOpen();
            if (receipt.id !== (entry.kind === "private_register" ? entry.registration?.frameId : entry.digest)) {
                throw new TenraiWalletError("the node took another statement than this wallet sent", "rejected");
            }
            await this.#stage(entry, "pool");
        }
        catch (error) {
            if (!posted || this.#uncertain || this.#closed)
                throw error;
            if (error instanceof TenraiApiError && error.reason === "already_pooled") {
                await this.#stage(entry, "pool");
                return;
            }
            if (definiteRefusal(error) || error instanceof TenraiWalletError) {
                // This answer cannot rule out an earlier in-flight copy, including one
                // restored from disk or sent by another instance. Keep its exact frame.
                await this.#review(entry, error);
                throw error;
            }
        }
        finally {
            this.#submitting.delete(entry.digest);
        }
    }
    /** Operator retry preserves the original digest, proof frame and reservations. */
    async retry(digest) {
        const entry = this.#entries.get(digest);
        if (!entry || entry.stage !== "needs_review")
            throw new TenraiWalletError("this statement is not awaiting review", "invalid");
        if (!this.#evidence)
            throw new TenraiWalletError("the private scan has not restored finality evidence", "rejected");
        await this.#stage(entry, "sending");
        await this.#submit(entry);
        return sendSnapshot(this.#entries.get(digest) ?? entry);
    }
    /** Asks about every statement on its way. `tip` is the newest final cut the wallet knows. */
    async check(tip, registrationsOnly = false) {
        return this.#journal ? this.#journal.run(() => this.#checkOwned(tip, registrationsOnly)) : this.#checkOwned(tip, registrationsOnly);
    }
    async #checkOwned(tip, registrationsOnly) {
        this.#assertOpen();
        // A second check at the same time would tell the same outcomes again.
        if (this.#checking)
            return [];
        this.#checking = true;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12_000);
        const signal = this.#journal ? AbortSignal.any([controller.signal, this.#stopped.signal, this.#journal.signal]) : AbortSignal.any([controller.signal, this.#stopped.signal]);
        try {
            const outcomes = [];
            if (!this.#evidence)
                return outcomes;
            if (!Number.isSafeInteger(tip) || tip < 0)
                throw new TypeError("invalid verified private height");
            const pending = this.#evidence.pending(registrationsOnly ? "registration" : undefined);
            const entries = pending ? [this.#entries.get(pending.digest)].filter((entry) => entry !== undefined) : [...this.#entries.values()];
            for (const entry of entries) {
                if (registrationsOnly && entry.kind !== "private_register")
                    continue;
                if (signal.aborted)
                    break;
                let verifiedHeight;
                try {
                    const snapshot = this.#evidence.snapshot(entry);
                    if (!Number.isSafeInteger(snapshot.height) || snapshot.height < 0)
                        throw new TypeError("invalid verified private height");
                    verifiedHeight = entry.kind === "private_register" ? snapshot.height : Math.min(tip, snapshot.height);
                }
                catch {
                    continue;
                }
                let known;
                if (pending) {
                    // Resume this exact target before any other height can replace its historical tracker.
                    known = { height: pending.height };
                }
                else
                    try {
                        if (entry.kind === "private_register") {
                            const status = await this.#client.transactions.status(entry.digest, { signal, maxResponseBytes: 64 * 1024 });
                            if (status.transaction_id !== entry.digest)
                                throw new TypeError("registration status changed its funding transaction");
                            known = { height: status.lifecycle === "finalized" && status.failure === null ? status.finalized_cut?.height ?? null : null };
                        }
                        else
                            known = await this.#client.privateTransfers.statement(entry.digest, { signal, maxResponseBytes: 64 * 1024 });
                    }
                    catch (error) {
                        known = error instanceof TenraiApiError && error.status === 404 ? null : undefined;
                    }
                if (known === undefined && verifiedHeight <= entry.validUntil)
                    continue;
                if (known?.height !== undefined && known.height !== null) {
                    try {
                        if (!Number.isSafeInteger(known.height) || known.height < 0 || known.height > verifiedHeight)
                            throw new TypeError("the reported statement height is not verified");
                        const verified = await this.#evidence.execution(sendSnapshot(entry), known.height, signal);
                        if (verified.digest !== entry.digest || verified.class !== entry.kind || verified.height !== known.height || !/^[0-9a-f]{96}$/.test(verified.cut_id))
                            throw new TypeError("the statement inclusion proof changed its identity");
                    }
                    catch (reason) {
                        await this.#review(entry, reason);
                        if (this.#evidence.pending())
                            break;
                        if (verifiedHeight > entry.validUntil) {
                            const outcome = await this.#closeExpired(entry, signal);
                            if (outcome)
                                outcomes.push(outcome);
                        }
                        continue;
                    }
                    const height = known.height;
                    await this.#change((draft) => {
                        draft.done = [{ kind: entry.kind, amountAtoms: entry.kind === "private_register" ? entry.feeAtoms : entry.amountAtoms, to: entry.to, height, time: entry.time }, ...draft.done].slice(0, DONE_KEPT);
                        draft.entries = draft.entries.filter((row) => row.digest !== entry.digest);
                        for (const row of draft.expected)
                            if (entry.ownNoteCommitments.includes(row.id))
                                row.finalizedHeight = height;
                    });
                    outcomes.push({ outcome: "final", send: entry, height: known.height });
                }
                else if (verifiedHeight > entry.validUntil) {
                    const outcome = await this.#closeExpired(entry, signal);
                    if (outcome)
                        outcomes.push(outcome);
                }
                else if (known) {
                    if (entry.stage !== "needs_review")
                        await this.#stage(entry, "pool");
                }
                else if (verifiedHeight < entry.validUntil && entry.stage !== "needs_review") {
                    await this.#stage(entry, "sending");
                    try {
                        await this.#submit(entry);
                    }
                    catch (reason) {
                        outcomes.push({ outcome: "refused", send: entry, reason });
                    }
                }
            }
            return outcomes;
        }
        finally {
            clearTimeout(timer);
            controller.abort();
            this.#checking = false;
        }
    }
    #assertOpen() {
        if (this.#uncertain)
            throw new TenraiWalletError("the private journal write outcome is unknown; reopen this store before spending", "rejected");
        if (this.#closed)
            throw new TenraiWalletError("the private sends journal is closed", "rejected");
        this.#journal?.assertOpen();
    }
    async #archiveWork(work) {
        this.#assertOpen();
        if (this.#archiveCount >= 8)
            throw new TenraiWalletError("the outcome archive is busy", "rejected");
        if (this.#archiveCount === 0)
            this.#archiveIdle = new Promise((done) => { this.#archiveDone = done; });
        this.#archiveCount++;
        try {
            return await (this.#journal ? this.#journal.run(work) : work());
        }
        finally {
            this.#archiveCount--;
            if (this.#archiveCount === 0)
                this.#archiveDone();
        }
    }
    close() {
        if (this.#closed)
            return this.#archiveIdle;
        this.#closed = true;
        this.#stopped.abort(new TenraiWalletError("the private sends journal closed", "rejected"));
        return this.#archiveIdle;
    }
}
