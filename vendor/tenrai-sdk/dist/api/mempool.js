import { U16, addresses, limit } from "../validate.js";
import { MAX_ADDRESS_BATCH } from "./address.js";
export class MempoolApi {
    #http;
    /** @internal */
    constructor(http) {
        this.#http = http;
    }
    /** `GET /v1/mempool`: size and limits of the transaction pool. */
    info(options) {
        return this.#http.get("/v1/mempool", undefined, options);
    }
    /** `GET /v1/mempool/transactions`: pooled transactions in the pool's priority order. */
    transactions(options = {}) {
        return this.#http.get("/v1/mempool/transactions", { limit: limit(options.limit, U16) }, options);
    }
    /** `POST /v1/mempool/pending`: payments to these addresses still in the pool. Pending, never part of a balance. */
    pending(owners, options) {
        return this.#http.post("/v1/mempool/pending", { api_version: 1, addresses: addresses(owners, MAX_ADDRESS_BATCH) }, undefined, options);
    }
}
