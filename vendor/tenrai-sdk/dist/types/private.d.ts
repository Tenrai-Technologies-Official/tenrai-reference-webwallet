import type { ApiVersion, AtomAmount, Hash384Hex, OutPoint } from "./common.ts";
import type { InputView, TransactionMassRules } from "./transaction.ts";
/** TSP-2 uses an append-only note tree and a nullifier set for spends. */
export interface PrivateTransferStatus {
    api_version: ApiVersion;
    finalized_height: number;
    /** Whether the current rule set enables private transfers. */
    active: boolean;
    protocol: PrivateProofProtocol;
    limits: PrivateTransferLimits;
    fees: PrivateFeeRule;
    capacity: PrivateCapacity;
    notes: PrivateNoteCounts;
    pool: PrivatePoolCounts;
}
/** Private statement capacity and recent utilization. */
export interface PrivateCapacity {
    cut_interval_millis: number;
    statements_per_minute: number;
    /** Recent finalized cuts and the private items they executed. */
    recent_cuts: number;
    recent_statements: number;
    recent_registrations: number;
}
/** The node's active or configured proof protocol. */
export interface PrivateProofProtocol {
    name: string;
    /** Commitment to the verifier key set bound into the rules. */
    verifier_keys_digest: string;
    /** Verifier key digest per circuit. */
    circuits: PrivateCircuitKey[];
    /** Target proof security in bits. */
    target_security_bits: number;
    /** Qualification state of the protocol. */
    security_qualification: PrivateSecurityQualification;
    /** Review items reported by the node. */
    open_review_items: string[];
    /** Work charge per proof, in reference-core microseconds. */
    verifier_work_units: number;
    /** Heap charge per verification. */
    verifier_scratch_bytes: number;
    /** Largest measured proof in bytes. */
    largest_measured_proof_bytes: number;
    /** Whether measured proof sizes fit the active limit. */
    fits_consensus_limits: boolean;
}
export type PrivateCircuit = "transfer" | "enter-1" | "enter-2" | "exit-1" | "exit-2";
export interface PrivateCircuitKey {
    circuit: PrivateCircuit;
    /** Hexadecimal SHA-384 digest of the pinned verifier key. */
    verifier_key_digest: string;
}
export type PrivateSecurityQualification = "incomplete" | "internally_qualified" | "complete";
/** Per-statement limits for the active or configured rules. */
export interface PrivateTransferLimits {
    max_proof_bytes: number;
    max_wire_bytes: number;
    sources: number;
    outputs: number;
    /** Maximum statements and registrations per cut. */
    statements_per_cut: number;
    registrations_per_cut: number;
}
/**
 * Private fees multiply logical mass by the minimum fee rate and the configured multiplier.
 * Schedule values are null until pricing is active.
 */
export interface PrivateFeeRule {
    multiplier: number;
    burned_percent: number;
    schedule_digest: string | null;
    minimum_fee_per_mass: AtomAmount | null;
    minimum_note_value: AtomAmount | null;
    /** The fee of a statement at the schedule's limits, which covers any transfer, ENTER or EXIT. */
    transfer_fee: AtomAmount | null;
    /** Fee contribution per resource. Empty before activation. */
    components: PrivateFeeComponent[];
    registration?: PrivateRegistrationFeeRule | null;
}
/** Pricing coefficients for funded private registrations. */
export interface PrivateRegistrationFeeRule {
    format_version: number;
    funding_transaction_type: number;
    max_frame_bytes: number;
    max_funding_inputs: number;
    max_funding_outputs: number;
    max_sponsor_signature_checks: number;
    max_inline_public_keys: number;
    max_cut_wire_bytes: number;
    max_cut_signature_checks: number;
    rules_digest: string;
    frame_fixed_bytes: number;
    owner_signature_checks: number;
    recipient_recovery_bytes: number;
    inline_public_key_recovery_bytes: number;
    recovery_byte_mass: number;
    funding_mass: TransactionMassRules;
    minimum_fee_per_mass: AtomAmount;
    multiplier: number;
    burned_percent: number;
}
export type PrivateResource = "wire_bytes" | "proof_bytes" | "verifier_work" | "scratch_kib" | "queue_bytes" | "note_appends" | "nullifiers" | "recovery_bytes";
/** Fee contribution of one resource at its schedule limit. */
export interface PrivateFeeComponent {
    resource: PrivateResource;
    units: number;
    mass_per_unit: number;
    fee: AtomAmount;
}
/** Finalized note and recipient state. */
export interface PrivateNoteCounts {
    appended: number;
    /** Note capacity as an integer string. */
    capacity: string;
    records: number;
    confidential_atoms: AtomAmount;
}
export interface PrivatePoolCounts {
    statements: number;
    registrations: number;
    bytes: number;
}
/** Receipt ID for a pooled private statement or registration. */
export interface PrivateSubmissionReceipt {
    api_version: ApiVersion;
    id: string;
}
/** Canonical records that bind the head and private state to the finalized anchor. */
export interface PrivateAnchor {
    api_version: ApiVersion;
    height: number;
    head: string;
    state: string;
    record: string;
    registry: string;
    /** Note and recipient log lengths at this cut. */
    notes: number;
    records: number;
    confidential_atoms: AtomAmount;
}
/** Certified bridge between epoch anchors. */
export interface FinalityBridge {
    api_version: ApiVersion;
    source_height: number;
    target_height: number;
    bytes: string;
}
/** Hex-encoded finalized cut, quorum certificate and committee proof. */
export interface FinalizedCutProofAnswer {
    api_version: ApiVersion;
    height: number;
    proof: string;
}
/** Nullifier range proof against a fixed root. */
export interface PrivateNullifierUpdate {
    api_version: ApiVersion;
    proof: string;
    /** Next page start, or null when the proof covers the requested height. */
    next_height: number | null;
}
/** Hex-encoded note and capsule in the finalized log. */
export interface PrivateNote {
    leaf_index: number;
    entry: string;
    capsule: string;
}
/** Note log page in leaf order. Null `next` marks the end. */
export interface PrivateNotePage {
    api_version: ApiVersion;
    notes: PrivateNote[];
    next: number | null;
}
/** Recipient record and owner lock from the finalized log. */
export interface PrivateRecord {
    record_index: number;
    owner: string;
    record: string;
}
export interface PrivateNullifier {
    height: number;
    nullifier: Hash384Hex;
}
/**
 * Nullifiers in cut order. Match them to owned notes locally.
 * Null `next_height` marks the end.
 */
export interface PrivateNullifierPage {
    api_version: ApiVersion;
    nullifiers: PrivateNullifier[];
    next_height: number | null;
}
/** Sorted nullifier keys at a fixed finalized height. */
export interface PrivateNullifierKeyPage {
    api_version: ApiVersion;
    at_height: number;
    keys: Hash384Hex[];
    /** An empty page can still advance the cursor. Null marks the end. */
    next: Hash384Hex | null;
}
export type PrivateStatementClass = "transfer" | "enter" | "exit";
/** Public view of a private statement, including any public inputs or outputs. */
export interface PrivateStatement {
    api_version: ApiVersion;
    class: PrivateStatementClass;
    digest: Hash384Hex;
    /** Finalized execution cut, or null while pending. */
    height: number | null;
    cut_id: Hash384Hex | null;
    /** Finalized cut confirmations. Zero while pending. */
    confirmations: number;
    /** Work blocks registered since execution. */
    work_confirmations: number | null;
    finalized_at_millis: number | null;
    /** Null if the node no longer retains the statement bytes. */
    details: PrivateStatementDetails | null;
}
export interface PrivateStatementRow {
    class: PrivateStatementClass;
    digest: Hash384Hex;
    /** Finalized execution cut, or null while pending. */
    height: number | null;
    confirmations: number;
    finalized_at_millis: number | null;
}
/** Recent private statements, newest first. */
export interface PrivateStatementList {
    api_version: ApiVersion;
    statements: PrivateStatementRow[];
    /** Pass this cursor as `before`. Null marks the end of retained history. */
    next_before: number | null;
}
export interface PrivateStatementDetails {
    /** Complete statement bytes and standalone proof bytes. */
    bytes: number;
    proof_bytes: number;
    fee: AtomAmount;
    anchor_height: number;
    valid_from_height: number;
    valid_until_height: number;
    nullifiers: Hash384Hex[];
    notes: PrivateStatementNote[];
    /** Public inputs and value consumed by ENTER. */
    spent: InputView[];
    entered: AtomAmount | null;
    /** Public output and value produced by EXIT. */
    created: OutPoint | null;
    address: string | null;
    exited: AtomAmount | null;
}
/** Finalized private items in execution order. */
export interface PrivateCutItems {
    api_version: ApiVersion;
    height: number;
    registrations: Hash384Hex[];
    statements: {
        class: PrivateStatementClass;
        digest: Hash384Hex;
    }[];
}
export interface PrivateStatementNote {
    commitment: Hash384Hex;
    capsule_digest: Hash384Hex;
}
/** Recipient records in log order. Null `next` marks the end. */
export interface PrivateRecordPage {
    api_version: ApiVersion;
    records: PrivateRecord[];
    next: number | null;
}
