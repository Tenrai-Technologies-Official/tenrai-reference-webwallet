import type { ApiVersion, AtomAmount, Hash384Hex } from "./common.ts";
export interface ChainHead {
    chain_id: Hash384Hex;
    height: number;
    cut_id: Hash384Hex;
    state_root: Hash384Hex;
    validator_set_id: Hash384Hex;
    params_hash: Hash384Hex;
}
export interface ChainIssuance {
    minted_atoms: AtomAmount;
    burned_atoms: AtomAmount;
    work_reserve_atoms: AtomAmount;
    stake_reserve_atoms: AtomAmount;
    unminted_work_carry_atoms: AtomAmount;
}
export interface EpochInfo {
    api_version: ApiVersion;
    finalized_height: number;
    epoch: number;
    cuts_per_epoch: number;
    first_height: number;
    last_height: number;
    cuts_remaining: number;
    estimated_millis_remaining: number;
    validator_set_id: Hash384Hex;
    active_validators: number;
    bonded: AtomAmount;
}
export interface DaaInfo {
    api_version: ApiVersion;
    finalized_height: number;
    /** 32-byte big-endian target as hex. */
    target: string;
    expected_hashes_per_block: number;
    target_blocks_per_second: number;
    target_cut_interval_millis: number;
    registration_window_heights: number;
    half_life_blocks: number;
    work_ref: Hash384Hex | null;
    registration_height: number | null;
}
export interface RateWindow {
    seconds: number;
    received_blocks_per_second: number;
    registered_blocks_per_second: number;
    executed_blocks_per_second: number;
    transactions_per_second: number;
    cuts_per_second: number;
}
export interface ChainRates {
    api_version: ApiVersion;
    sampled_at_millis: number;
    windows: RateWindow[];
    network_hashes_per_second: number;
    average_cut_interval_millis: number | null;
}
export interface CoinSupply {
    api_version: ApiVersion;
    finalized_height: number;
    max_supply: AtomAmount;
    total_supply: AtomAmount;
    circulating_supply: AtomAmount;
    bonded: AtomAmount;
    unbonding: AtomAmount;
    /** Value held in private notes, as one total: no note's amount. */
    private_supply: AtomAmount;
    minted: AtomAmount;
    burned: AtomAmount;
    work_reserve: AtomAmount;
    stake_reserve: AtomAmount;
    unscheduled_emission: AtomAmount;
}
export interface EmissionSchedule {
    api_version: ApiVersion;
    finalized_height: number;
    interval: number;
    reduction_interval_cuts: number;
    reduction_numerator: number;
    reduction_denominator: number;
    cut_subsidy: AtomAmount;
    cut_work_subsidy: AtomAmount;
    cut_stake_subsidy: AtomAmount;
    interval_subsidy: AtomAmount;
    cuts_until_reduction: number;
    estimated_millis_until_reduction: number;
    next_cut_subsidy: AtomAmount;
    next_interval_subsidy: AtomAmount;
}
export interface MiningEstimate {
    api_version: ApiVersion;
    finalized_height: number;
    hashes_per_second: number;
    network_hashes_per_second: number;
    network_share: number;
    expected_blocks_per_day: number;
    work_subsidy_per_day: AtomAmount;
    expected_reward_per_day: AtomAmount;
}
export interface StakingEstimate {
    api_version: ApiVersion;
    finalized_height: number;
    amount: AtomAmount;
    total_bonded: AtomAmount;
    stake_subsidy_per_day: AtomAmount;
    expected_reward_per_day: AtomAmount;
    annual_percentage_rate: number;
}
/** Numbers as decimal strings; the fee is in atoms per unit of mass. */
export interface FeeQuote {
    profile: "traidag-fee-quote-v1";
    minimum_fee_per_mass: string;
    max_transaction_mass: string;
    max_work_payload_mass: string;
}
export type FeePriority = "minimum" | "normal" | "priority";
export interface FeeSuggestion {
    priority: FeePriority;
    fee_per_mass: AtomAmount;
    mass_ahead: number;
}
export interface FeeEstimate {
    api_version: ApiVersion;
    finalized_height: number;
    minimum_fee_per_mass: AtomAmount;
    max_transaction_mass: number;
    pooled_mass: number;
    suggestions: FeeSuggestion[];
}
