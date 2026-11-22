import type { ApiVersion, AtomAmount, Hash384Hex } from "./common.ts";
export type ValidatorState = "eligible" | "exit_requested";
/** Rejects validator state values outside the node protocol. */
export declare function validatorState(value: unknown): ValidatorState;
/** A reason a validator is not active at the response's finalized epoch. */
export type ValidatorInactiveReason = "exit_requested" | "activation_pending" | "heartbeat_expired" | "jailed";
/** Validators may waive their commission; rates otherwise advance in one-tenth-percent steps. */
export declare const MIN_VALIDATOR_COMMISSION_BPS = 0;
export declare const MAX_VALIDATOR_COMMISSION_BPS = 1000;
export declare const VALIDATOR_COMMISSION_STEP_BPS = 10;
export declare const DEFAULT_VALIDATOR_COMMISSION_BPS = 500;
export interface PendingValidatorCommission {
    /** The scheduled rate: 0 to 1,000 basis points in 10-bps steps. */
    bps: number;
    /** Epoch where the scheduled rate becomes active. */
    activate_after_epoch: number;
    /** First finalized height where this scheduled rate applies. */
    activate_after_height: number;
}
/** A validator overlay endpoint change scheduled for a fixed epoch boundary. */
export interface PendingValidatorEndpoint {
    /** Canonical validator-overlay endpoint bytes as lowercase hex. */
    overlay_endpoint_hex: string;
    activate_after_epoch: number;
    /** First finalized height where this scheduled endpoint applies. */
    activate_after_height: number;
}
/** Rejects validator inactivity reasons outside the node protocol. */
export declare function validatorInactiveReason(value: unknown): ValidatorInactiveReason;
export interface ValidatorView {
    validator_id: Hash384Hex;
    owner_address: string;
    owner_nonce: number;
    /** Registry lifecycle; current eligibility is reported separately below. */
    state: ValidatorState;
    /** Finalized cut that began a validator exit, or null when no exit is pending. */
    exit_request_height: number | null;
    /** Whether this validator is active at the response's finalized epoch. */
    is_active: boolean;
    /** Deterministic reasons this validator is not currently active, in protocol order; empty exactly when `is_active` is true. */
    inactive_reasons: ValidatorInactiveReason[];
    self_bond_position_id: Hash384Hex;
    /** Maximum live positions the active rules allow for this validator. */
    position_capacity: number;
    live_positions: number;
    /** Remaining delegation positions under the active rules. */
    available_position_slots: number;
    /** Whether the finalized registry accepts a new delegation now. */
    accepting_delegations: boolean;
    consensus_key_version: number;
    /** Active ML-DSA-65 consensus key as lowercase hex. */
    consensus_public_key: string;
    /** Canonical validator-overlay endpoint for the active consensus key. */
    overlay_endpoint_hex: string;
    /** A delayed endpoint update, or null when none is scheduled. */
    pending_endpoint: PendingValidatorEndpoint | null;
    /** Current commission charged against delegated rewards: 0 to 1,000 bps in 10-bps steps. */
    commission_bps: number;
    /** A delayed commission update, or null when none is scheduled. */
    pending_commission: PendingValidatorCommission | null;
    /** Finalized epoch of the validator's most recent heartbeat. */
    last_heartbeat_epoch: number;
    /** Last closed attendance epoch applied to this validator, or null before its first attendance result. */
    last_attendance_epoch: number | null;
    /** First epoch after the jail term, or null when no jail term has been imposed. */
    jailed_until_epoch: number | null;
    /** First epoch in which the validator is eligible for committee selection. */
    activation_epoch: number;
    /** First finalized height where the validator can become active. */
    activation_height: number;
    penalty_generation: number;
    pending_key_activation_epoch: number | null;
}
export interface ValidatorList {
    api_version: ApiVersion;
    finalized_height: number;
    total_bonded: AtomAmount;
    /** The least a delegation may bond. */
    minimum_delegation: AtomAmount;
    /** The least a validator registers with. */
    minimum_self_bond: AtomAmount;
    /** Maximum validator records the active rules permit. */
    validator_capacity: number;
    /** Validator records still available under the active rules. */
    available_validator_slots: number;
    /** Maximum live stake positions the active rules permit. */
    position_capacity: number;
    /** Live stake positions across the finalized registry. */
    live_positions: number;
    /** Stake positions still available under the active rules. */
    available_position_slots: number;
    validators: ValidatorView[];
    next_cursor: string | null;
}
export interface ValidatorUptime {
    validator_id: Hash384Hex;
    committee_cuts: number;
    signed_cuts: number;
    first_signed_height: number | null;
    last_signed_height: number | null;
}
export interface ValidatorUptimeList {
    api_version: ApiVersion;
    finalized_height: number;
    from_height: number;
    cuts: number;
    target_cut_interval_millis: number;
    validators: ValidatorUptime[];
}
export type StakePositionKind = "self_bond" | "delegated";
/** `exit_requested`: the owner unbonded; it earns nothing and turns `unbonding` at an epoch boundary. */
export type StakePositionState = "bonded" | "exit_requested" | "unbonding" | "withdrawable";
export interface StakePositionView {
    position_id: Hash384Hex;
    validator_id: Hash384Hex;
    owner_address: string;
    reward_address: string;
    principal: AtomAmount;
    position_nonce: number;
    kind: StakePositionKind;
    state: StakePositionState;
    /** Whether this position remains in a future staking-reward snapshot. */
    future_rewards_eligible: boolean;
    exit_request_height: number | null;
    withdrawable_after_height: number | null;
    cuts_until_withdrawable: number | null;
    estimated_millis_until_withdrawable: number | null;
}
export interface ValidatorDetail {
    api_version: ApiVersion;
    finalized_height: number;
    validator: ValidatorView;
    self_bond: StakePositionView | null;
}
/** A finalized slash retained until its evidence window closes. */
export interface ValidatorSlashForfeiture {
    self_bond_position_id: Hash384Hex;
    evidence_id: Hash384Hex;
    evidence_height: number;
    applied_height: number;
    retire_height: number;
    position_count: number;
    burned_principal: AtomAmount;
}
/** Current slash information for a validator; the forfeiture is absent after its retention window. */
export interface ValidatorSlashStatus {
    api_version: ApiVersion;
    finalized_height: number;
    validator_id: Hash384Hex;
    active_forfeiture: ValidatorSlashForfeiture | null;
}
export interface StakePositionDetail {
    api_version: ApiVersion;
    finalized_height: number;
    position: StakePositionView;
}
export interface StakePositionList {
    api_version: ApiVersion;
    finalized_height: number;
    positions: StakePositionView[];
    next_cursor: string | null;
}
/** One page of a validator's live positions; totals count still-bonded principal, `stakers` the distinct owners. */
export interface ValidatorPositionList {
    api_version: ApiVersion;
    finalized_height: number;
    validator_id: Hash384Hex;
    total_bonded: AtomAmount;
    self_bonded: AtomAmount;
    delegated: AtomAmount;
    stakers: number;
    position_capacity: number;
    live_positions: number;
    available_position_slots: number;
    positions: StakePositionView[];
    next_cursor: string | null;
}
export interface UnbondingPositions {
    api_version: ApiVersion;
    address: string;
    finalized_height: number;
    target_cut_interval_millis: number;
    unbonding_delay_cuts: number;
    estimated_unbonding_millis: number;
    unbonding: AtomAmount;
    withdrawable: AtomAmount;
    positions: StakePositionView[];
    next_cursor: string | null;
}
