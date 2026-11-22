import type { ApiVersion, AtomAmount, FinalizedCut, Hash384Hex, Network, UtxoSource } from "./common.ts";
/**
 * `processing`: no block carries it yet. `receiving`: a mined block carries it.
 * `registered`: a cut registered that block. `finalized`: a finalized cut executed it.
 */
export type TransactionLifecycle = "processing" | "receiving" | "registered" | "finalized" | "failed";
/** Only `conflict` and `expired` with a `finalized_cut` are final, see `isFinal`. */
export type TransactionFailure = "conflict" | "invalid" | "expired" | "dropped" | "no_effect";
export interface TransactionStatus {
    api_version: ApiVersion;
    transaction_id: Hash384Hex;
    lifecycle: TransactionLifecycle;
    observed_work: {
        block_id: Hash384Hex;
    } | null;
    registered_cut: FinalizedCut | null;
    finalized_cut: FinalizedCut | null;
    failure: TransactionFailure | null;
}
export interface TransactionStatusBatch {
    api_version: ApiVersion;
    statuses: TransactionStatus[];
    unknown: Hash384Hex[];
}
export interface TransactionSubmissionReceipt {
    api_version: ApiVersion;
    transaction_id: Hash384Hex;
    lifecycle: TransactionLifecycle;
}
export interface TransactionLimits {
    max_wire_bytes: number;
    max_inputs: number;
    max_outputs: number;
    max_operation_bytes: number;
    max_witnesses: number;
    max_signature_checks: number;
}
export interface TransactionMassRules {
    wire_byte_mass: number;
    input_mass: number;
    output_mass: number;
    witness_mass: number;
    operation_byte_mass: number;
    payload_byte_mass: number;
}
export interface TransactionManifest {
    api_version: ApiVersion;
    network: Network;
    chain_id: Hash384Hex;
    protocol_version: number;
    params_hash: Hash384Hex;
    ledger_rules_hash: Hash384Hex;
    finalized: FinalizedCut;
    transaction_limits: TransactionLimits;
    transaction_mass_rules: TransactionMassRules;
    minimum_fee_per_mass: AtomAmount;
    max_transaction_mass: number;
    max_transparent_payload_bytes: number;
    max_validity_cuts: number;
}
export type TransactionKind = "payment" | "register" | "bond" | "exit" | "unbond" | "withdraw" | "rotate" | "endpoint" | "reward_lock" | "evidence" | "heartbeat" | "commission"
/** Transparent value entering private notes; it runs only in the private stage of a cut. */
 | "private_enter" | "private_register";
export interface OutputView {
    index: number;
    amount: AtomAmount;
    address: string;
    lock: string;
}
export interface SpentOutput {
    address: string;
    lock: string;
    amount: AtomAmount;
    source: UtxoSource;
    created_finalized_height: number;
    block_id: Hash384Hex | null;
}
export interface InputView {
    transaction_id: Hash384Hex;
    output_index: number;
    spends: SpentOutput | null;
}
export type OperationView = {
    type: "register";
    data: {
        consensus_public_key: string;
        overlay_endpoint_hex: string;
        owner_address: string;
        reward_address: string;
        self_bond: AtomAmount;
        commission_bps: number;
    };
} | {
    type: "bond";
    data: {
        validator_id: Hash384Hex;
        owner_address: string;
        reward_address: string;
        amount: AtomAmount;
    };
} | {
    type: "exit";
    data: {
        validator_id: Hash384Hex;
        expected_owner_nonce: number;
    };
} | {
    type: "unbond";
    data: {
        position_id: Hash384Hex;
        expected_position_nonce: number;
    };
} | {
    type: "withdraw";
    data: {
        position_id: Hash384Hex;
        expected_position_nonce: number;
    };
} | {
    type: "rotate";
    data: {
        validator_id: Hash384Hex;
        expected_owner_nonce: number;
        new_consensus_public_key: string;
        overlay_endpoint_hex: string;
    };
} | {
    type: "endpoint";
    data: {
        validator_id: Hash384Hex;
        expected_owner_nonce: number;
        expected_consensus_key_version: number;
        consensus_public_key: string;
        overlay_endpoint_hex: string;
    };
} | {
    type: "reward_lock";
    data: {
        position_id: Hash384Hex;
        expected_position_nonce: number;
        new_reward_address: string;
    };
} | {
    type: "evidence";
    data: {
        kind: "vote";
        first_message_bytes: number;
        second_message_bytes: number;
    };
} | {
    type: "heartbeat";
    data: {
        validator_id: Hash384Hex;
        expected_consensus_key_version: number;
        expected_heartbeat_epoch: number;
    };
} | {
    type: "commission";
    data: {
        validator_id: Hash384Hex;
        expected_owner_nonce: number;
        commission_bps: number;
    };
} | {
    type: "private_enter";
    data: {
        statement_digest: Hash384Hex;
    };
} | {
    type: "private_register";
    data: {
        authorization_id: Hash384Hex;
    };
};
export type InputAuthorizationView = {
    profile: "native_lock";
    input_index: number;
    signature_count: number;
    lock_commitment: string;
    lock_type: "timelock" | "hashlock" | "htlc";
    branch: "claim" | "refund";
    descriptor_hex: string;
    preimage_hex: string;
} | {
    profile: "direct_mldsa65";
    input_index: number;
    signature_count: number;
    lock_commitment: string;
} | {
    profile: "threshold_mldsa65";
    input_index: number;
    threshold: number;
    member_count: number;
    signature_count: number;
    lock_commitment: string;
};
export interface TransactionView {
    api_version: ApiVersion;
    transaction_id: Hash384Hex;
    witness_id: Hash384Hex;
    kind: TransactionKind;
    protocol_version: number;
    rules_hash: Hash384Hex;
    valid_from_height: number;
    valid_until_height: number;
    inputs: InputView[];
    outputs: OutputView[];
    /** Bytes the sender chose; display them escaped, never as markup. */
    payload_hex: string | null;
    operation: OperationView | null;
    witnesses: number;
    authorizations: InputAuthorizationView[];
    wire_bytes: number;
    mass: number;
    input_total: AtomAmount | null;
    output_total: AtomAmount;
    fee: AtomAmount | null;
    wire_hex: string;
    status: TransactionStatus;
    block_id: Hash384Hex | null;
    /** Finalized cuts from the one that executed it up to the head; 0 before that. */
    confirmations: number;
    /** Blocks registered from that cut on, capped at 100,000; null before finality. */
    work_confirmations: number | null;
    finalized_at_millis: number | null;
}
export interface TransactionSummary {
    transaction_id: Hash384Hex;
    lifecycle: TransactionLifecycle;
    failure: TransactionFailure | null;
    finalized_height: number | null;
    block_id: Hash384Hex | null;
    seen_at_millis: number;
}
export interface TransactionList {
    api_version: ApiVersion;
    transactions: TransactionSummary[];
}
/** A local display projection; it cannot replace canonical wire or signature verification. */
export interface CompactTransactionView extends Omit<TransactionView, "witness_id" | "wire_hex" | "input_total" | "authorizations" | "output_total" | "fee" | "block_id"> {
    provenance: "local_validation";
    recorded_witness_id: Hash384Hex;
    signature_checks: number;
    /** Retained descriptors, branch and revealed preimage; no signatures. */
    native_spends: InputAuthorizationView[];
    input_total?: AtomAmount;
    output_total: AtomAmount | null;
    fee: AtomAmount;
    unsigned_body_hex: string;
    block_id: Hash384Hex | null;
    private_funding?: {
        kind: "enter";
        statement_id: Hash384Hex;
    } | {
        kind: "registration";
        registration_id: Hash384Hex;
        authorization_id: Hash384Hex;
        owner_lock_hex: string;
    };
}
