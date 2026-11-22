import { utxoPresenceRequest, checkedUtxoPresenceResponse } from "./utxo-presence.js";
import { U16, U32, address, addresses, cursor, hash384, hex, limit, whole } from "../validate.js";
export const MAX_ADDRESS_BATCH = 64;
export const MAX_UTXO_PROOFS = 8;
/** Maximum direct ML-DSA-65 locks one `proofs.keys` request can prove. */
export const MAX_KEY_REGISTRY_PROOFS = 5;
const SPEND_LOCK_COMMITMENT_HEX_LENGTH = 80;
const KEY_REGISTRY_RECORD_HEX_LENGTH = 3_904;
const FINALIZED_STATE_COMMITMENT_HEX_LENGTH = 1_684;
const MAX_KEY_REGISTRY_PROOF_HEX_LENGTH = 104_920;
export function utxoPageQuery(options) {
    if (options.cursor !== undefined && options.after !== undefined)
        throw new RangeError("cursor and after are mutually exclusive");
    if (options.after !== undefined && !/^[0-9a-f]{104}$/.test(options.after))
        throw new RangeError("after must be one canonical 104-hex outpoint");
    return { ...pageQuery(options), after: options.after };
}
export function pageQuery(options) {
    return { cursor: cursor(options.cursor), limit: limit(options.limit, U16) };
}
export class AddressApi {
    #http;
    /** @internal */
    constructor(http) {
        this.#http = http;
    }
    /** `GET /v1/address/{address}/balance`: finalized balance and number of unspent outputs. */
    balance(owner, options) {
        return this.#http.get(`/v1/address/${address(owner)}/balance`, undefined, options);
    }
    /** `GET /v1/address/{address}/utxos`: pinned cursor pages or moving after pages; each reports `anchor`. */
    utxos(owner, options = {}) {
        return this.#http.get(`/v1/address/${address(owner)}/utxos`, utxoPageQuery(options), options);
    }
    /** `GET /v1/address/{address}/history`: outputs received and spent, newest first, paged. */
    history(owner, options = {}) {
        return this.#http.get(`/v1/address/${address(owner)}/history`, pageQuery(options), options);
    }
    /** Finite ascending changes in (afterHeight,atHeight], received before spent within each cut. */
    historyRange(owner, afterHeight, atHeight, options = {}) {
        const after = whole(afterHeight, "afterHeight"), at = whole(atHeight, "atHeight");
        if (at < after)
            throw new RangeError("atHeight precedes afterHeight");
        return this.#http.get("/v1/address/" + address(owner) + "/history", { ...pageQuery(options), after_height: after, at_height: at }, options);
    }
    /** Finite ordered ranges for up to64 owners, with at most256 events in total. */
    historyRanges(ranges, atHeight, options = {}) {
        const at = whole(atHeight, "atHeight"), seen = new Set();
        if (!Array.isArray(ranges) || !ranges.length || ranges.length > 64)
            throw new RangeError("Pass1..64 public history ranges.");
        const entries = ranges.map(row => {
            const owner = address(row.address), after = whole(row.after_height, "after_height");
            if (seen.has(owner) || after > at)
                throw new RangeError("History owners must be unique and ranges finite.");
            seen.add(owner);
            return { address: owner, after_height: after };
        });
        if (options.cursor !== undefined && !/^[0-9a-f]{224}$/.test(options.cursor))
            throw new RangeError("Invalid history-range cursor.");
        const maximum = options.limit ?? 256;
        if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 256)
            throw new RangeError("History limit must be1..256.");
        return this.#http.post("/v1/address/history-range", { api_version: 1, at_height: at, addresses: entries, limit: maximum, ...(options.cursor === undefined ? {} : { cursor: options.cursor }) }, undefined, options);
    }
    /** `GET /v1/address/{address}/unbonding`: stake this address is unbonding, with when each position can be withdrawn. */
    unbonding(owner, options = {}) {
        return this.#http.get(`/v1/address/${address(owner)}/unbonding`, pageQuery(options), options);
    }
    /** `POST /v1/address/balances`: balances of up to 64 addresses at one indexed height. */
    balances(owners, options) {
        return this.#http.post("/v1/address/balances", batch(owners), undefined, options);
    }
    /** `POST /v1/address/utxos`: up to 256 outputs per address; read a `truncated` one page by page with `utxos`. */
    utxoBatch(owners, options) {
        return this.#http.post("/v1/address/utxos", batch(owners), undefined, options);
    }
    /** `POST /v1/address/changes`: what the cuts after `afterHeight` received and spent, for up to 64 addresses. */
    changes(owners, afterHeight, options) {
        return this.#http.post("/v1/address/changes", { ...batch(owners), after_height: whole(afterHeight, "afterHeight") }, undefined, options);
    }
}
export class KeysApi {
    #http;
    /** @internal */
    constructor(http) {
        this.#http = http;
    }
    /** `POST /v1/keys/registered`: whether each address has a registered key at the node's current work anchor. */
    registered(owners, options) {
        return this.#http.post("/v1/keys/registered", batch(owners), undefined, options);
    }
}
export class ProofsApi {
    #http;
    /** @internal */
    constructor(http) {
        this.#http = http;
    }
    /** `POST /v1/proofs/utxos`: proofs that up to eight outputs are unspent at a finalized cut such as `chain.head()`. */
    utxos(anchor, outpoints, options) {
        if (outpoints.length === 0 || outpoints.length > MAX_UTXO_PROOFS) {
            throw new RangeError(`pass 1 to ${MAX_UTXO_PROOFS} outpoints`);
        }
        const cut = {
            height: whole(anchor.height, "anchor.height"),
            cut_id: hash384(anchor.cut_id, "anchor.cut_id"),
            state_root: hash384(anchor.state_root, "anchor.state_root"),
            validator_set_id: hash384(anchor.validator_set_id, "anchor.validator_set_id"),
        };
        const sorted = outpoints
            .map((outpoint) => ({
            transaction_id: hash384(outpoint.transaction_id, "transaction_id"),
            output_index: whole(outpoint.output_index, "output_index", U32),
        }))
            .sort((left, right) => left.transaction_id === right.transaction_id
            ? left.output_index - right.output_index
            : left.transaction_id < right.transaction_id
                ? -1
                : 1);
        for (let index = 1; index < sorted.length; index += 1) {
            const previous = sorted[index - 1];
            const current = sorted[index];
            if (previous && current && previous.transaction_id === current.transaction_id && previous.output_index === current.output_index) {
                throw new RangeError("the same outpoint appears twice");
            }
        }
        return this.#http.post("/v1/proofs/utxos", { api_version: 1, anchor: cut, outpoints: sorted }, undefined, options);
    }
    /** Proves presence or explicit absence for every requested output at an independently authenticated cut. */
    utxoPresence(anchor, outpoints, options) {
        const request = utxoPresenceRequest(anchor, outpoints);
        const bounded = { ...options, maxResponseBytes: Math.min(options?.maxResponseBytes ?? 1024 * 1024, 1024 * 1024) };
        return this.#http.post("/v1/proofs/utxo-presence", request, undefined, bounded)
            .then((answer) => checkedUtxoPresenceResponse(answer, request));
    }
    /**
     * `POST /v1/proofs/keys`: membership or absence proofs for one to five ML-DSA-65 lock commitments at this
     * finalized cut. The proofs bind to the cut's state root, not to its finality: authenticate the cut first.
     */
    keys(anchor, lockCommitments, options) {
        const request = keyProofRequest(anchor, lockCommitments);
        return this.#http.post("/v1/proofs/keys", request, undefined, options).then((value) => checkedKeyProofResponse(value, request));
    }
}
function keyProofRequest(anchor, lockCommitments) {
    if (!Array.isArray(lockCommitments) || lockCommitments.length === 0 || lockCommitments.length > MAX_KEY_REGISTRY_PROOFS) {
        throw new RangeError(`pass 1 to ${MAX_KEY_REGISTRY_PROOFS} lock commitments`);
    }
    const sorted = lockCommitments.map((commitment) => fixedHex(commitment, SPEND_LOCK_COMMITMENT_HEX_LENGTH, "lockCommitment")).sort();
    for (let index = 1; index < sorted.length; index += 1) {
        if (sorted[index - 1] === sorted[index]) {
            throw new RangeError("the same lock commitment appears twice");
        }
    }
    return { api_version: 1, anchor: finalizedCut(anchor), lock_commitments: sorted };
}
function checkedKeyProofResponse(value, request) {
    if (!isRecord(value) || value.api_version !== 1 || !Array.isArray(value.proofs)) {
        throw new TypeError("invalid key-registry proof response");
    }
    const network = proofNetwork(value.network);
    const chainId = hash384(value.chain_id, "key-registry proof response chain_id");
    const anchor = finalizedCut(value.anchor);
    if (!sameCut(anchor, request.anchor)) {
        throw new TypeError("key-registry proof response changed the requested anchor");
    }
    const stateCommitment = fixedHex(value.state_commitment, FINALIZED_STATE_COMMITMENT_HEX_LENGTH, "key-registry proof response state_commitment");
    if (value.proofs.length === 0 || value.proofs.length > MAX_KEY_REGISTRY_PROOFS) {
        throw new RangeError(`key-registry proof response must contain 1 to ${MAX_KEY_REGISTRY_PROOFS} proofs`);
    }
    if (value.proofs.length !== request.lock_commitments.length) {
        throw new TypeError("key-registry proof response has a different number of proofs");
    }
    const proofs = value.proofs.map((proof, index) => checkedKeyProofEntry(proof, request.lock_commitments[index]));
    for (let index = 1; index < proofs.length; index += 1) {
        const previous = proofs[index - 1];
        const current = proofs[index];
        if (previous !== undefined && current !== undefined && previous.lock_commitment >= current.lock_commitment) {
            throw new TypeError("key-registry proof response locks are not strictly ordered");
        }
    }
    return { api_version: 1, network, chain_id: chainId, anchor, state_commitment: stateCommitment, proofs };
}
function checkedKeyProofEntry(value, expectedLock) {
    if (!isRecord(value)) {
        throw new TypeError("invalid key-registry proof entry");
    }
    const lock = fixedHex(value.lock_commitment, SPEND_LOCK_COMMITMENT_HEX_LENGTH, "key-registry proof lock_commitment");
    if (lock !== expectedLock) {
        throw new TypeError("key-registry proof response does not match the requested locks");
    }
    const record = value.record === null ? null : fixedHex(value.record, KEY_REGISTRY_RECORD_HEX_LENGTH, "key-registry proof record");
    const proof = boundedHex(value.proof, MAX_KEY_REGISTRY_PROOF_HEX_LENGTH, "key-registry proof");
    return { lock_commitment: lock, record, proof };
}
function proofNetwork(value) {
    if (value === "development" || value === "testnet" || value === "testnet100" || value === "mainnet") {
        return value;
    }
    throw new TypeError("invalid key-registry proof response network");
}
function finalizedCut(value) {
    if (!isRecord(value)) {
        throw new TypeError("invalid finalized cut");
    }
    return {
        height: whole(value.height, "anchor.height"),
        cut_id: hash384(value.cut_id, "anchor.cut_id"),
        state_root: hash384(value.state_root, "anchor.state_root"),
        validator_set_id: hash384(value.validator_set_id, "anchor.validator_set_id"),
    };
}
function sameCut(left, right) {
    return (left.height === right.height &&
        left.cut_id === right.cut_id &&
        left.state_root === right.state_root &&
        left.validator_set_id === right.validator_set_id);
}
function fixedHex(value, length, name) {
    if (typeof value !== "string" || value.length !== length) {
        throw new TypeError(`${name} must be ${length / 2} bytes as lowercase hex`);
    }
    return hex(value, name);
}
function boundedHex(value, maximumLength, name) {
    if (typeof value !== "string") {
        throw new TypeError(`${name} must be lowercase hex`);
    }
    if (value.length > maximumLength) {
        throw new RangeError(`${name} exceeds its transport bound`);
    }
    return hex(value, name);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function batch(owners) {
    return { api_version: 1, addresses: addresses(owners, MAX_ADDRESS_BATCH) };
}
