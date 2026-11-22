import { toAtomAmount } from "../amount.js";
export class ChainApi {
    #http;
    /** @internal */
    constructor(http) {
        this.#http = http;
    }
    /** `GET /v1/chain/head`: the finalized head. */
    head(options) {
        return this.#http.get("/v1/chain/head", undefined, options);
    }
    /** `GET /v1/chain/genesis`: the genesis cut, fixed for the life of the chain. */
    genesis(options) {
        return this.#http.get("/v1/chain/genesis", undefined, options);
    }
    /** `GET /v1/chain/issuance`: minted, burned and reserved atoms from the accounting record. */
    issuance(options) {
        return this.#http.get("/v1/chain/issuance", undefined, options);
    }
    /** `GET /v1/chain/epoch`: current epoch, its height range and committee. */
    epoch(options) {
        return this.#http.get("/v1/chain/epoch", undefined, options);
    }
    /** `GET /v1/chain/daa`: difficulty target and target block rate. */
    daa(options) {
        return this.#http.get("/v1/chain/daa", undefined, options);
    }
    /** `GET /v1/chain/rates`: block, transaction and cut rates over recent windows, and the network hash rate. */
    rates(options) {
        return this.#http.get("/v1/chain/rates", undefined, options);
    }
}
export class EconomicsApi {
    #http;
    /** @internal */
    constructor(http) {
        this.#http = http;
    }
    /** `GET /v1/economics/supply`: max, total and circulating supply, bonded and unbonding stake. */
    supply(options) {
        return this.#http.get("/v1/economics/supply", undefined, options);
    }
    /** `GET /v1/economics/emission`: subsidy per cut and when it next drops. */
    emission(options) {
        return this.#http.get("/v1/economics/emission", undefined, options);
    }
    /** `GET /v1/economics/estimate/mining`: expected blocks and reward per day for a hash rate. */
    miningEstimate(hashesPerSecond, options) {
        if (!Number.isFinite(hashesPerSecond) || hashesPerSecond < 0) {
            throw new RangeError("hashesPerSecond must be a finite number from 0");
        }
        return this.#http.get("/v1/economics/estimate/mining", { hashes_per_second: hashesPerSecond }, options);
    }
    /** `GET /v1/economics/estimate/staking`: expected reward per day for a stake in atoms. */
    stakingEstimate(atoms, options) {
        return this.#http.get("/v1/economics/estimate/staking", { amount: toAtomAmount(atoms) }, options);
    }
}
export class FeesApi {
    #http;
    /** @internal */
    constructor(http) {
        this.#http = http;
    }
    /** `GET /v1/fees/quote`: minimum fee per mass and the mass limits a transaction must meet. */
    quote(options) {
        return this.#http.get("/v1/fees/quote", undefined, options);
    }
    /** `GET /v1/fees/estimate`: fee per mass suggestions from the current pool. */
    estimate(options) {
        return this.#http.get("/v1/fees/estimate", undefined, options);
    }
}
