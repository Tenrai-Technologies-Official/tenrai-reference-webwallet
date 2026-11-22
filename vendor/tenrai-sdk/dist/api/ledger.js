import { U32, hash384, limit, whole } from "../validate.js";
export class BlocksApi {
    #http;
    /** @internal */
    constructor(http) {
        this.#http = http;
    }
    /** `GET /v1/blocks/recent`: the blocks this node accepted last, newest first. */
    recent(options = {}) {
        return this.#http.get("/v1/blocks/recent", { limit: limit(options.limit, Number.MAX_SAFE_INTEGER) }, options);
    }
    /** `GET /v1/blocks/{id}`: one block, from the pool or from finalized history. */
    get(blockId, options) {
        return this.#http.get(`/v1/blocks/${hash384(blockId, "blockId")}`, undefined, options);
    }
}
export class CutsApi {
    #http;
    /** @internal */
    constructor(http) {
        this.#http = http;
    }
    /** `GET /v1/cuts`: finalized cuts, newest first, at most 100 per page. */
    list(options = {}) {
        const before = options.before === undefined ? undefined : whole(options.before, "before");
        return this.#http.get("/v1/cuts", { before, limit: limit(options.limit, Number.MAX_SAFE_INTEGER) }, options);
    }
    /** `GET /v1/cuts/{height}`: one finalized cut with the blocks it registered and executed. */
    get(height, options) {
        return this.#http.get(`/v1/cuts/${whole(height, "height")}`, undefined, options);
    }
    /** `GET /v1/cuts/{height}/addresses`: addresses the cut paid or spent from. Only recent cuts; use `changes` for older ones. */
    addresses(height, options) {
        return this.#http.get(`/v1/cuts/${whole(height, "height")}/addresses`, undefined, options);
    }
    /** `GET /v1/cuts/{height}/changes`: every output the cut created or spent, paged by `next_cursor`. */
    changes(height, options = {}) {
        const cursor = options.cursor === undefined ? undefined : whole(options.cursor, "cursor", U32);
        return this.#http.get(`/v1/cuts/${whole(height, "height")}/changes`, { cursor, limit: limit(options.limit, U32) }, options);
    }
    /** `GET /v1/cuts/{height}/transactions`: the transactions the cut executed, paged by `next_cursor`. */
    transactions(height, options = {}) {
        const cursor = options.cursor === undefined ? undefined : hash384(options.cursor, "cursor");
        return this.#http.get(`/v1/cuts/${whole(height, "height")}/transactions`, { cursor, limit: limit(options.limit, Number.MAX_SAFE_INTEGER) }, options);
    }
    /** `GET /v1/cuts/{height}/blocks`: the blocks the cut executed. */
    blocks(height, options) {
        return this.#http.get(`/v1/cuts/${whole(height, "height")}/blocks`, undefined, options);
    }
}
