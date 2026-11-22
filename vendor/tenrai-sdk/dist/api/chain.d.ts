import type { CallOptions, Transport } from "../http.ts";
import type { ChainHead, ChainIssuance, ChainRates, CoinSupply, DaaInfo, EmissionSchedule, EpochInfo, FeeEstimate, FeeQuote, MiningEstimate, StakingEstimate } from "../types/chain.ts";
export declare class ChainApi {
    #private;
    /** @internal */
    constructor(http: Transport);
    /** `GET /v1/chain/head`: the finalized head. */
    head(options?: CallOptions): Promise<ChainHead>;
    /** `GET /v1/chain/genesis`: the genesis cut, fixed for the life of the chain. */
    genesis(options?: CallOptions): Promise<ChainHead>;
    /** `GET /v1/chain/issuance`: minted, burned and reserved atoms from the accounting record. */
    issuance(options?: CallOptions): Promise<ChainIssuance>;
    /** `GET /v1/chain/epoch`: current epoch, its height range and committee. */
    epoch(options?: CallOptions): Promise<EpochInfo>;
    /** `GET /v1/chain/daa`: difficulty target and target block rate. */
    daa(options?: CallOptions): Promise<DaaInfo>;
    /** `GET /v1/chain/rates`: block, transaction and cut rates over recent windows, and the network hash rate. */
    rates(options?: CallOptions): Promise<ChainRates>;
}
export declare class EconomicsApi {
    #private;
    /** @internal */
    constructor(http: Transport);
    /** `GET /v1/economics/supply`: max, total and circulating supply, bonded and unbonding stake. */
    supply(options?: CallOptions): Promise<CoinSupply>;
    /** `GET /v1/economics/emission`: subsidy per cut and when it next drops. */
    emission(options?: CallOptions): Promise<EmissionSchedule>;
    /** `GET /v1/economics/estimate/mining`: expected blocks and reward per day for a hash rate. */
    miningEstimate(hashesPerSecond: number, options?: CallOptions): Promise<MiningEstimate>;
    /** `GET /v1/economics/estimate/staking`: expected reward per day for a stake in atoms. */
    stakingEstimate(atoms: bigint, options?: CallOptions): Promise<StakingEstimate>;
}
export declare class FeesApi {
    #private;
    /** @internal */
    constructor(http: Transport);
    /** `GET /v1/fees/quote`: minimum fee per mass and the mass limits a transaction must meet. */
    quote(options?: CallOptions): Promise<FeeQuote>;
    /** `GET /v1/fees/estimate`: fee per mass suggestions from the current pool. */
    estimate(options?: CallOptions): Promise<FeeEstimate>;
}
