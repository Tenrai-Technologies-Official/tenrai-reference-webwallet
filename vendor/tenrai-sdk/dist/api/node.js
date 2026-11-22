export class NodeApi {
    #http;
    /** @internal */
    constructor(http) {
        this.#http = http;
    }
    /** `GET /v1/node/info`: network, node version, storage mode, address index and finalized head. */
    info(options) {
        return this.#http.get("/v1/node/info", undefined, options);
    }
    /** `GET /v1/node/status`: chain, protocol version and finalized cut. */
    status(options) {
        return this.#http.get("/v1/node/status", undefined, options);
    }
    /** `GET /v1/node/identity`: the ML-DSA-65 key this server signs answers with. */
    identity(options) {
        return this.#http.get("/v1/node/identity", undefined, options);
    }
    /** `GET /v1/node/sync`: whether the node has caught up with its peers. */
    sync(options) {
        return this.#http.get("/v1/node/sync", undefined, options);
    }
    /** `GET /v1/node/history-sync`: retained-history bridge advice from connected peers. */
    historySync(options) {
        return this.#http.get("/v1/node/history-sync", undefined, options);
    }
    /** `GET /v1/node/peers`. A gateway answers only if its operator publishes peers. */
    peers(options) {
        return this.#http.get("/v1/node/peers", undefined, options);
    }
    /** `GET /v1/storage`: storage role and the oldest height with block bodies. */
    storage(options) {
        return this.#http.get("/v1/storage", undefined, options);
    }
}
export class WorkApi {
    #http;
    /** @internal */
    constructor(http) {
        this.#http = http;
    }
    /** `GET /v1/work/pool`: blocks the node holds and has queued for registration. */
    pool(options) {
        return this.#http.get("/v1/work/pool", undefined, options);
    }
}
export class NetworkApi {
    #http;
    /** @internal */
    constructor(http) {
        this.#http = http;
    }
    /** `GET /v1/network/mining`: current work reference, target and block rate. */
    mining(options) {
        return this.#http.get("/v1/network/mining", undefined, options);
    }
}
