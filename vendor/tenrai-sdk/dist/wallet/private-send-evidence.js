import { validateOwnNoteCommitments } from "./private-send-records.js";
import { registrationInspectionMetadata } from "./private-registration.js";
const HASH = /^[0-9a-f]{96}$/;
const HEAD = /^[0-9a-f]{516}$/;
const PROOF_BYTES = 2 * 1024 * 1024;
const CUT_BYTES = 1024 * 1024;
const ITEMS_BYTES = 256 * 1024;
function json(text, maximum) {
    if (typeof text !== "string" || text.length > maximum)
        throw new TypeError("the protocol returned oversized statement evidence");
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new TypeError("invalid statement evidence");
    return value;
}
function height(value) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
        throw new TypeError("invalid verified height");
    return value;
}
function hash(value) {
    if (typeof value !== "string" || !HASH.test(value))
        throw new TypeError("invalid verified hash");
    return value;
}
function verifiedHead(scan, registration = false) {
    if (registration && typeof scan.registrationVerifiedHead !== "function")
        throw new TypeError("the protocol WASM lacks public registration finality");
    const value = json(registration ? scan.registrationVerifiedHead() : scan.verifiedHead(), 2048);
    const network = value["network"];
    if (network !== "mainnet" && network !== "testnet" && network !== "testnet100" && network !== "development")
        throw new TypeError("invalid verified network");
    const finalized = value["finalized"];
    if (!finalized || typeof finalized !== "object" || Array.isArray(finalized))
        throw new TypeError("invalid verified head");
    return { network, chain_id: hash(value["chain_id"]), params_hash: hash(value["params_hash"]),
        protocol_version: height(value["protocol_version"]), finalized: {
            height: height(finalized["height"]), cut_id: hash(finalized["cut_id"]),
            state_root: hash(finalized["state_root"]), validator_set_id: hash(finalized["validator_set_id"]),
        } };
}
export function statementScan(value) {
    const scan = value;
    for (const name of ["summary", "statementFrameInfo", "statementSourcesUnspent", "verifiedHead", "statementProofRequest", "takeStatementBridge", "verifyStatementExecution"]) {
        if (typeof scan?.[name] !== "function")
            throw new TypeError("the protocol WASM lacks private statement finality verification");
    }
    return scan;
}
/** Checks local journal metadata against the canonical chain-bound original frame. */
export function validateStatementSend(scan, entry) {
    if (entry.kind === "private_register" && typeof scan.registrationFrameInfo !== "function")
        throw new TypeError("the protocol WASM lacks paid registration verification");
    const frame = json(entry.kind === "private_register" ? scan.registrationFrameInfo(entry.frameHex, registrationInspectionMetadata(entry)) : scan.statementFrameInfo(entry.frameHex), 8192);
    if (hash(frame["digest"]) !== entry.digest || frame["class"] !== entry.kind || height(frame["valid_until_height"]) !== entry.validUntil ||
        height(frame["valid_from_height"]) > entry.validUntil || !Array.isArray(frame["inputs"]))
        throw new TypeError("the pending metadata does not match its original statement frame");
    if (entry.kind === "private_register" && (frame["frame_id"] !== entry.registration?.frameId || frame["fee_atoms"] !== entry.feeAtoms || frame["owner"] !== entry.to
        || entry.amountAtoms !== "0" || entry.sources.length !== 0 || entry.ownNoteCommitments.length !== 0))
        throw new TypeError("registration metadata changed its funding frame");
    validateOwnNoteCommitments(frame, entry);
    const inputs = frame["inputs"].map((item) => {
        if (!item || typeof item !== "object")
            throw new TypeError("invalid framed input");
        const point = item;
        const index = height(point["output_index"]);
        if (index > 0xffff_ffff)
            throw new TypeError("invalid framed input index");
        return `${hash(point["transaction_id"])}:${index}`;
    }).sort();
    if (JSON.stringify(inputs) !== JSON.stringify([...entry.inputs].sort()) || entry.sources.length > 2)
        throw new TypeError("the pending reservations do not match their original statement frame");
    return { from: height(frame["valid_from_height"]), until: height(frame["valid_until_height"]) };
}
/** Calls are serialized with refresh by PrivateNotes; no node-reported head is trusted here. */
export function privateSendEvidence(scan, client, wasm, registration, sources, proof) {
    const verify = work => {
        if (!proof)
            return Promise.reject(new Error("A durable shared finality proof owner is required."));
        return proof(work);
    };
    const pending = new Map();
    const context = (entry) => {
        if (entry?.kind !== "private_register")
            return scan;
        if (!registration)
            throw new TypeError("refresh the public registration context first");
        return registration();
    };
    return {
        assertFinality: entry => verify(height => { if (height >= BigInt(entry.validUntil))
            throw new Error("The certified signed validity window is closed."); }),
        validate: (entry) => validateStatementSend(scan, entry),
        pending: (kind) => {
            const target = kind === undefined ? pending.get("private") ?? pending.get("registration") : pending.get(kind);
            return target === undefined ? undefined : { ...target };
        },
        sourcesUnspent: async (entry) => { validateStatementSend(scan, entry); if (!sources)
            throw new TypeError("A local inventory source checker is required."); return sources(entry); },
        snapshot(entry) {
            const selected = context(entry);
            const head = verifiedHead(selected, entry?.kind === "private_register");
            if (entry?.kind === "private_register")
                return { height: head.finalized.height, anchor: head.finalized };
            const value = JSON.parse(scan.summary());
            if (height(value.height) !== head.finalized.height)
                throw new TypeError("the private scan has no coherent finalized summary");
            return { height: head.finalized.height, anchor: head.finalized };
        },
        async execution(entry, at, outerSignal) {
            const validity = validateStatementSend(scan, entry);
            const selected = context(entry);
            const kind = entry.kind === "private_register" ? "registration" : "private";
            const target = pending.get(kind);
            if (height(at) < validity.from || at > validity.until)
                throw new TypeError("the reported statement height is outside its original frame validity");
            if (target && (target.digest !== entry.digest || target.height !== at)) {
                throw new Error("another statement's finality history is still being verified");
            }
            pending.set(kind, { digest: entry.digest, height: height(at) });
            const calls = new AbortController();
            const signal = AbortSignal.any([outerSignal, calls.signal]);
            let progressed = 0;
            let budgetExhausted = false;
            try {
                const seen = new Set();
                let ready = false;
                for (let step = 0; step <= 64; step += 1) {
                    if (signal.aborted)
                        throw signal.reason;
                    const request = json(entry.kind === "private_register"
                        ? selected.registrationProofRequest(BigInt(height(at))) : selected.statementProofRequest(BigInt(height(at))), 2048);
                    if (request["kind"] === "ready") {
                        ready = true;
                        pending.delete(kind);
                        break;
                    }
                    const after = request["after"];
                    budgetExhausted = step === 64 && request["kind"] === "bridge";
                    if (step === 64 || request["kind"] !== "bridge" || request["max_links"] !== 1 || typeof after !== "string" || !HEAD.test(after) || seen.has(after)) {
                        throw new TypeError(step === 64 ? "statement finality history continues on the next check" : "statement finality history did not make bounded progress");
                    }
                    seen.add(after);
                    const bridge = await client.privateTransfers.finalityBridge(after, { signal, maxLinks: 1, maxResponseBytes: PROOF_BYTES });
                    await verify(() => {
                        if (entry.kind === "private_register")
                            selected.takeRegistrationBridge(JSON.stringify(bridge));
                        else
                            selected.takeStatementBridge(JSON.stringify(bridge));
                    });
                    progressed += 1;
                }
                if (!ready)
                    throw new TypeError("statement finality history is incomplete");
                const [proof, cut, items] = await Promise.all([
                    client.privateTransfers.finalizedCutProof(at, { signal, maxResponseBytes: PROOF_BYTES }),
                    client.cuts.get(at, { signal, maxResponseBytes: CUT_BYTES }),
                    client.privateTransfers.cutItems(at, { signal, maxResponseBytes: ITEMS_BYTES }),
                ]);
                if (entry.kind === "private_register" && typeof selected.verifyRegistrationExecution !== "function")
                    throw new TypeError("the protocol WASM lacks paid registration execution verification");
                const result = json(await verify(() => entry.kind === "private_register"
                    ? selected.verifyRegistrationExecution(entry.frameHex, registrationInspectionMetadata(entry), JSON.stringify(proof), JSON.stringify(cut), JSON.stringify(items))
                    : selected.verifyStatementExecution(entry.frameHex, entry.digest, entry.kind, JSON.stringify(proof), JSON.stringify(cut), JSON.stringify(items))), 2048);
                return { digest: hash(result["digest"]), class: String(result["class"]),
                    height: height(result["height"]), cut_id: hash(result["cut_id"]) };
            }
            catch (error) {
                // Only verified progress interrupted by this turn's budget delays a new scan.
                // A pruned, malformed or unavailable response leaves the payment reserved for
                // review while ordinary balance refresh and other receipts can continue.
                if (!(progressed > 0 && (budgetExhausted || signal.aborted)))
                    pending.delete(kind);
                throw error;
            }
            finally {
                // Cancel siblings/queued HTTP calls if any parallel evidence reply failed.
                calls.abort();
            }
        },
        async sourceCoverage(entry, signal) {
            validateStatementSend(scan, entry);
            const selected = context(entry);
            const before = verifiedHead(selected, entry.kind === "private_register");
            if (before.finalized.height <= entry.validUntil)
                throw new TypeError("the original signed validity window is not closed");
            let allUnspent;
            if (entry.kind === "enter" || entry.kind === "private_register") {
                const outpoints = entry.inputs.map((key) => { const [transaction_id, index] = key.split(":"); return { transaction_id: hash(transaction_id), output_index: Number(index) }; })
                    .sort((a, b) => a.transaction_id === b.transaction_id ? a.output_index - b.output_index : a.transaction_id < b.transaction_id ? -1 : 1);
                if (!outpoints.length || outpoints.length > 8)
                    throw new TypeError("invalid original source coverage");
                const request = { api_version: 1, anchor: before.finalized, outpoints };
                const answer = await client.proofs.utxoPresence(before.finalized, outpoints, { signal, maxResponseBytes: 1024 * 1024 });
                await verify(() => wasm.verifyFinalizedUtxoPresence(JSON.stringify(request), JSON.stringify(answer)));
                if (answer.network !== before.network || answer.chain_id !== before.chain_id || answer.proofs.length !== outpoints.length)
                    throw new TypeError("source presence belongs to another chain or incomplete request");
                allUnspent = answer.proofs.every((proof) => proof.record !== null);
            }
            else {
                if (!sources)
                    throw new TypeError("a completed local inventory source checker is required");
                // The selected COW source query checks exact membership/absence in the completed inventory.
                allUnspent = await sources(entry);
                if (typeof allUnspent !== "boolean")
                    throw new TypeError("incomplete private source coverage");
            }
            if (JSON.stringify(verifiedHead(selected, entry.kind === "private_register")) !== JSON.stringify(before))
                throw new TypeError("source coverage changed during reconciliation");
            return { anchor: before.finalized, allUnspent };
        },
        async inputsUnspent(entry, signal) {
            validateStatementSend(scan, entry);
            const selected = context(entry);
            const head = verifiedHead(selected, entry.kind === "private_register");
            if (head.finalized.height <= entry.validUntil)
                return false;
            const outpoints = entry.inputs.map((key) => {
                const [transaction_id, index] = key.split(":");
                return { transaction_id: hash(transaction_id), output_index: Number(index) };
            }).sort((left, right) => left.transaction_id === right.transaction_id
                ? left.output_index - right.output_index : left.transaction_id < right.transaction_id ? -1 : 1);
            if (outpoints.length === 0 || outpoints.length > 8)
                return false;
            const request = { api_version: 1, anchor: head.finalized, outpoints };
            const answer = await client.proofs.utxos(head.finalized, outpoints, { signal, maxResponseBytes: PROOF_BYTES });
            await verify(() => wasm.verifyFinalizedUtxoProof(JSON.stringify(request), JSON.stringify(answer)));
            if (answer.chain_id !== head.chain_id || answer.network !== head.network || answer.proofs.length !== outpoints.length)
                return false;
            if (JSON.stringify(verifiedHead(selected, entry.kind === "private_register")) !== JSON.stringify(head))
                return false;
            return answer.proofs.every((proof, index) => {
                const outpoint = outpoints[index];
                const record = proof.record;
                return typeof record === "string" && /^[0-9a-f]{236}$/.test(record)
                    && record.slice(0, 96) === outpoint.transaction_id
                    && BigInt("0x" + record.slice(96, 104)) === BigInt(outpoint.output_index);
            });
        },
    };
}
