export type ApiVersion = 1;
/** 96 lowercase hex characters. */
export type Hash384Hex = string;
/** 80 lowercase hex characters: the commitment of a direct ML-DSA-65 spend lock. */
export type SpendLockCommitmentHex = string;
/** 842 bytes as lowercase hex: the state commitment a finalized cut's state root commits to. */
export type FinalizedStateCommitmentHex = string;
/** Atoms as a decimal string; one TRAI is 100000000 atoms. */
export type AtomAmount = string;
export type Network = "development" | "testnet" | "testnet100" | "mainnet";
export type ApiErrorCode = "invalid_request" | "unsupported_api_version" | "not_found" | "conflict" | "payload_too_large" | "rate_limited" | "unavailable" | "internal";
/**
 * What became of a transaction a node refused with `conflict`: it already holds this very transaction, another
 * pooled one spends an input, or an input is not in the finalized UTXO set. With `not_found`,
 * `history_not_held`: this node keeps less or started later, and the chain may well hold it. That is
 * never an answer that there is none.
 */
export type ApiErrorReason = "already_pooled" | "input_pooled" | "input_missing" | "note_pooled" | "note_spent" | "already_registered" | "history_not_held";
export interface ApiErrorDocument {
    api_version: ApiVersion;
    code: ApiErrorCode;
    message: string;
    retry_after_millis?: number | null;
    /** On a refused transaction, and on history a node does not hold. */
    reason?: ApiErrorReason;
}
export interface FinalizedCut {
    height: number;
    cut_id: Hash384Hex;
    state_root: Hash384Hex;
    validator_set_id: Hash384Hex;
}
export interface OutPoint {
    transaction_id: Hash384Hex;
    output_index: number;
}
/** `private_exit`: the output of a private EXIT; its transaction ID is the EXIT's statement digest. */
export type UtxoSource = "regular" | "genesis" | "work_reward" | "stake_reward" | "private_exit";
export interface UtxoRecord {
    outpoint: OutPoint;
    amount: AtomAmount;
    created_finalized_height: number;
    source: UtxoSource;
}
/** A settled work claim; zero and protocol-2 burn claims create no spendable UTXO. */
export interface RewardReference {
    block_id: Hash384Hex;
    transaction_id: Hash384Hex;
    output_index: number;
    amount: AtomAmount;
}
/** A settled stake claim; a protocol-2 burn claim creates no UTXO. */
export interface StakePayoutReference {
    position_id: Hash384Hex;
    transaction_id: Hash384Hex;
    output_index: number;
    amount: AtomAmount;
}
