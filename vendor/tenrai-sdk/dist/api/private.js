import { hash384, hex, limit, whole } from "../validate.js";
/** The most notes, records or nullifiers one page returns. */
export const MAX_PRIVATE_PAGE = 512;
const MAX_STATEMENT_PAGE = 100;
export class PrivateTransfersApi {
    #http;
    /** @internal */
    constructor(http) {
        this.#http = http;
    }
    /**
     * `GET /v1/private/status`: whether private transfers (TSP-2) are active, the proof protocol the
     * node verifies, the limits and fee rule, the private state and the node's pool.
     */
    status(options) {
        return this.#http.get("/v1/private/status", undefined, options);
    }
    /** `GET /v1/private/anchor`: the finalized head as the anchor of the next private statements. */
    anchor(options) {
        return this.#http.get("/v1/private/anchor", undefined, options);
    }
    /**
     * `GET /v1/private/notes`: the finalized note log from `from` on, in leaf order. A node that does
     * not hold the notes from there, as before the height it synced from, answers 404.
     */
    notes(options = {}) {
        return this.#http.get("/v1/private/notes", page(options), options);
    }
    /** `GET /v1/private/records`: the finalized recipient record log from `from` on, in index order. */
    records(options = {}) {
        return this.#http.get("/v1/private/records", page(options), options);
    }
    /**
     * `GET /v1/private/nullifiers`: the nullifiers of whole finalized cuts from `fromHeight` on. A
     * wallet marks its notes spent from them locally; a node that does not hold the cuts from there
     * answers 404.
     */
    nullifiers(options = {}) {
        return this.#http.get("/v1/private/nullifiers", {
            from_height: options.fromHeight === undefined ? undefined : whole(options.fromHeight, "fromHeight"),
            limit: limit(options.limit, MAX_PRIVATE_PAGE),
        }, options);
    }
    /** Streams public hashed keys at one certified height; the wallet verifies the complete root. */
    nullifierKeys(options) {
        return this.#http.get("/v1/private/nullifier-keys", {
            at_height: whole(options.atHeight, "atHeight"),
            after: options.after === undefined ? undefined : hash384(options.after, "after"),
            limit: limit(options.limit, MAX_PRIVATE_PAGE),
        }, options);
    }
    /**
     * `GET /v1/private/nullifier-updates`: the next nullifiers with the nodes that prove them on top
     * of `root`. The wallet inserts them itself and compares the result with the root of a finalized
     * cut, so a node can hide no spend, and learns nothing about the wallet's notes. Answers 404 when
     * the node cannot prove them from there; then every row of `nullifiers` must do.
     */
    nullifierUpdate(options) {
        return this.#http.get("/v1/private/nullifier-updates", {
            from_height: whole(options.fromHeight, "fromHeight"),
            at_height: whole(options.atHeight, "atHeight"),
            root: hash384(options.root, "root"),
        }, options);
    }
    /**
     * `GET /v1/finality/bridge`: the certified bridge that continues from this epoch end, given as its
     * finalized head record. A client verifies it from its own last anchor; 404 when the node holds
     * none yet.
     */
    finalityBridge(after, options) {
        const maxLinks = options?.maxLinks === undefined ? undefined : whole(options.maxLinks, "maxLinks", 64);
        if (maxLinks === 0)
            throw new RangeError("maxLinks must be between 1 and 64");
        return this.#http.get("/v1/finality/bridge", {
            after: hex(after, "after"),
            max_links: maxLinks,
        }, options);
    }
    /**
     * `GET /v1/finality/cuts/{height}`: the cut at `height`, the quorum that finalized it and the proof
     * of its committee, for a client to verify from the epoch end before it.
     */
    finalizedCutProof(height, options) {
        return this.#http.get(`/v1/finality/cuts/${whole(height, "height")}`, undefined, options);
    }
    /**
     * `GET /v1/private/statements/{digest}`: one private statement as anyone may see it, executed or
     * waiting in the node's pool; 404 when the node knows none with this digest.
     */
    statement(digest, options) {
        return this.#http.get(`/v1/private/statements/${hash384(digest, "digest")}`, undefined, options);
    }
    /**
     * `GET /v1/private/statements`: private statements, newest first: those waiting in the node's pool
     * on the first page, then what finalized cuts ran, whole cuts at a time. `next_before` asks for the next page.
     */
    statements(query = {}, options) {
        const params = {
            before: query.before === undefined ? undefined : whole(query.before, "before"),
            limit: limit(query.limit, MAX_STATEMENT_PAGE),
        };
        return this.#http.get("/v1/private/statements", params, options);
    }
    /**
     * `GET /v1/private/cuts/{height}`: the private items a finalized cut ran, in execution order; 404
     * where the node does not hold that cut's history.
     */
    cutItems(height, options) {
        return this.#http.get(`/v1/private/cuts/${whole(height, "height")}`, undefined, options);
    }
    /** `POST /v1/private/registrations`: a complete paid recipient-registration frame; the receipt names its full frame ID. */
    submitRegistration(bytesHex, options) {
        return this.#submit("/v1/private/registrations", bytesHex, options);
    }
    /** `POST /v1/private/transfers`: a proven private transfer; the receipt names its statement digest. */
    submitTransfer(bytesHex, options) {
        return this.#submit("/v1/private/transfers", bytesHex, options);
    }
    /** `POST /v1/private/enters`: a proven ENTER frame with its signed transparent transaction. */
    submitEnter(bytesHex, options) {
        return this.#submit("/v1/private/enters", bytesHex, options);
    }
    /** `POST /v1/private/exits`: a proven EXIT frame. */
    submitExit(bytesHex, options) {
        return this.#submit("/v1/private/exits", bytesHex, options);
    }
    /** The node verifies the proof before its receipt; a lost answer never submits twice. */
    #submit(path, bytesHex, options) {
        return this.#http.submit(path, { bytes: hex(bytesHex, "bytesHex") }, options);
    }
}
function page(options) {
    return {
        from: options.from === undefined ? undefined : whole(options.from, "from"),
        limit: limit(options.limit, MAX_PRIVATE_PAGE),
    };
}
