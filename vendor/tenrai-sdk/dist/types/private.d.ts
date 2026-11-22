import type { ApiVersion, AtomAmount, Hash384Hex, OutPoint } from "./common.ts";
import type { InputView, TransactionMassRules } from "./transaction.ts";
/**
 * Private transfers (TSP-2) as a node sees them. Private notes live in an append-only note tree and
 * a spent note leaves only its nullifier, so there is no fixed number of cells: the state is a count
 * of notes against the tree's capacity.
 */
export interface PrivateTransferStatus {
    api_version: ApiVersion;
    finalized_height: number;
    /** False until a rule-set version activates private transfers. */
    active: boolean;
    protocol: PrivateProofProtocol;
    limits: PrivateTransferLimits;
    fees: PrivateFeeRule;
    capacity: PrivateCapacity;
    notes: PrivateNoteCounts;
    pool: PrivatePoolCounts;
}
/**
 * What the chain can run privately, apart from its transparent budget, and how much recent cuts
 * used: at most `statements_per_minute` statements at the target cut interval.
 */
export interface PrivateCapacity {
    cut_interval_millis: number;
    statements_per_minute: number;
    /** The last finalized cuts under private rules counted, and what they ran. */
    recent_cuts: number;
    recent_statements: number;
    recent_registrations: number;
}
/** The one proof protocol the node's verifier accepts. */
export interface PrivateProofProtocol {
    name: string;
    /** The commitment to the pinned verifier keys of all circuits, which the rule set's parameter hash takes. */
    verifier_keys_digest: string;
    /** Every circuit with the digest of its pinned verifier key; a proof verifies only under the key of its own circuit. */
    circuits: PrivateCircuitKey[];
    /** The security level the protocol is designed for: a target, not a completed qualification. */
    target_security_bits: number;
    /** Internal qualification and independent review have distinct reported states. */
    security_qualification: PrivateSecurityQualification;
    /** Steps of the security argument still open for review. */
    open_review_items: string[];
    /** Verifier work charged per proof, in microseconds of one reference core. */
    verifier_work_units: number;
    /** Heap charged per verification. */
    verifier_scratch_bytes: number;
    /** The largest proof of this protocol measured so far; sizes vary with the drawn queries. */
    largest_measured_proof_bytes: number;
    /** False while measured proofs exceed `limits.max_proof_bytes`: the protocol cannot be used under these limits. */
    fits_consensus_limits: boolean;
}
/** The circuits of the protocol: a transfer, an ENTER of one or two notes, an EXIT of one or two notes. */
export type PrivateCircuit = "transfer" | "enter-1" | "enter-2" | "exit-1" | "exit-2";
export interface PrivateCircuitKey {
    circuit: PrivateCircuit;
    /** SHA-384 of the circuit's pinned verifier key, hexadecimal. */
    verifier_key_digest: string;
}
/** Internal proof qualification and independent review are distinct states. */
export type PrivateSecurityQualification = "incomplete" | "internally_qualified" | "complete";
/** The consensus limits of one private statement; while inactive, those of the prepared release profile. */
export interface PrivateTransferLimits {
    max_proof_bytes: number;
    max_wire_bytes: number;
    sources: number;
    outputs: number;
    /** Private statements of all classes together, and recipient registrations, one cut runs at most. */
    statements_per_cut: number;
    registrations_per_cut: number;
}
/**
 * The fee of a private transfer is its logical mass times the minimum fee per mass times
 * `multiplier`; `burned_percent` of every fee is burned. ENTERs and EXITs follow the same rule. The
 * schedule values are null while no resource schedule is active.
 */
export interface PrivateFeeRule {
    multiplier: number;
    burned_percent: number;
    schedule_digest: string | null;
    minimum_fee_per_mass: AtomAmount | null;
    minimum_note_value: AtomAmount | null;
    /** The fee of a statement at the schedule's limits, which covers any transfer, ENTER or EXIT. */
    transfer_fee: AtomAmount | null;
    /** What each resource adds to `transfer_fee`; empty while no schedule is active. */
    components: PrivateFeeComponent[];
    registration?: PrivateRegistrationFeeRule | null;
}
/** Integer coefficients for the atomic public funding of one private recipient registration. */
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
/** The resources a private statement uses, in the order of the schedule. */
export type PrivateResource = "wire_bytes" | "proof_bytes" | "verifier_work" | "scratch_kib" | "queue_bytes" | "note_appends" | "nullifiers" | "recovery_bytes";
/**
 * One resource of a statement at the schedule's limits: the mass counts `units` of it at
 * `mass_per_unit`, and `fee` is that mass times the minimum fee per mass times the multiplier.
 */
export interface PrivateFeeComponent {
    resource: PrivateResource;
    units: number;
    mass_per_unit: number;
    fee: AtomAmount;
}
/** The finalized private state: notes of the note tree, registered recipients and the value the notes hold. */
export interface PrivateNoteCounts {
    appended: number;
    /** Leaves the note tree can hold, as a decimal string (2^64). */
    capacity: string;
    records: number;
    confidential_atoms: AtomAmount;
}
/** Verified private statements (transfers, ENTERs, EXITs) and recipient registrations in the node's pool. */
export interface PrivatePoolCounts {
    statements: number;
    registrations: number;
    bytes: number;
}
/** What the node pooled after it verified a submission: the statement digest, or the full paid registration frame ID. */
export interface PrivateSubmissionReceipt {
    api_version: ApiVersion;
    id: string;
}
/**
 * The finalized cut a wallet anchors its private statements to, as canonical bytes it checks against
 * each other: head record, state commitment, TSP-2 state record and recipient registry state.
 */
export interface PrivateAnchor {
    api_version: ApiVersion;
    height: number;
    head: string;
    state: string;
    record: string;
    registry: string;
    /** Notes in the note log and records in the record log at this cut. */
    notes: number;
    records: number;
    /** The value private notes hold at this cut. */
    confidential_atoms: AtomAmount;
}
/** One certified bridge between two epoch ends, which a client verifies from its own anchor. */
export interface FinalityBridge {
    api_version: ApiVersion;
    source_height: number;
    target_height: number;
    /** The canonical bridge, hexadecimal. */
    bytes: string;
}
/** A finalized cut with its quorum and the proof of the committee behind it, hexadecimal. */
export interface FinalizedCutProofAnswer {
    api_version: ApiVersion;
    height: number;
    proof: string;
}
/** The nullifiers from a height on with the nodes that prove them on top of a given root. */
export interface PrivateNullifierUpdate {
    api_version: ApiVersion;
    proof: string;
    /** Where the next page starts; null once the proof reaches the height asked for. */
    next_height: number | null;
}
/** One note of the finalized note log: its entry and its capsule, hexadecimal. */
export interface PrivateNote {
    leaf_index: number;
    entry: string;
    capsule: string;
}
/** Notes in leaf order; `next` is where the following page starts, null at the end of the log. */
export interface PrivateNotePage {
    api_version: ApiVersion;
    notes: PrivateNote[];
    next: number | null;
}
/** One recipient record of the finalized record log with its owner lock, hexadecimal. */
export interface PrivateRecord {
    record_index: number;
    owner: string;
    record: string;
}
/** One nullifier a finalized cut made permanent, hexadecimal. */
export interface PrivateNullifier {
    height: number;
    nullifier: Hash384Hex;
}
/**
 * Nullifiers of whole cuts in height order. A wallet compares them with its notes locally, so no node
 * learns which notes it asks about; `next_height` is where the following page starts, null at the end.
 */
export interface PrivateNullifierPage {
    api_version: ApiVersion;
    nullifiers: PrivateNullifier[];
    next_height: number | null;
}
/** Sorted public hash keys of the permanent set at a fixed finalized height. */
export interface PrivateNullifierKeyPage {
    api_version: ApiVersion;
    at_height: number;
    keys: Hash384Hex[];
    /** May advance even when keys is empty; null ends the complete stream. */
    next: Hash384Hex | null;
}
export type PrivateStatementClass = "transfer" | "enter" | "exit";
/**
 * One private statement as anyone may see it: what it spent and created in public. Never the amounts
 * it moved privately, its owners, or who paid whom.
 */
export interface PrivateStatement {
    api_version: ApiVersion;
    class: PrivateStatementClass;
    digest: Hash384Hex;
    /** The finalized cut that ran it; null while it waits in the node's pool. */
    height: number | null;
    cut_id: Hash384Hex | null;
    /** The cuts from the one that ran it to the head; 0 while it waits. */
    confirmations: number;
    /** Work blocks registered since, as far as the node counts them. */
    work_confirmations: number | null;
    finalized_at_millis: number | null;
    /** Null where the node no longer keeps the statement's bytes. */
    details: PrivateStatementDetails | null;
}
/** One statement of a {@link PrivateStatementList}. */
export interface PrivateStatementRow {
    class: PrivateStatementClass;
    digest: Hash384Hex;
    /** The finalized cut that ran it; null while it waits in the node's pool. */
    height: number | null;
    confirmations: number;
    finalized_at_millis: number | null;
}
/** Private statements, newest first: nothing but their class and where they ran. */
export interface PrivateStatementList {
    api_version: ApiVersion;
    statements: PrivateStatementRow[];
    /** Asks for the next page as `before`; null at the end of what this node keeps. */
    next_before: number | null;
}
/** The public content of a private statement. */
export interface PrivateStatementDetails {
    /** Bytes of the statement with its proof, and of the proof alone. */
    bytes: number;
    proof_bytes: number;
    fee: AtomAmount;
    anchor_height: number;
    valid_from_height: number;
    valid_until_height: number;
    /** The nullifiers it made permanent. */
    nullifiers: Hash384Hex[];
    /** The notes it appended. */
    notes: PrivateStatementNote[];
    /** An ENTER: the transparent outputs it spent and the value it brought in. */
    spent: InputView[];
    entered: AtomAmount | null;
    /** An EXIT: the output it created, the address it pays and the value it paid out. */
    created: OutPoint | null;
    address: string | null;
    exited: AtomAmount | null;
}
/** The private items a finalized cut ran, in the order it ran them: registrations by ID, then statements by class and digest. */
export interface PrivateCutItems {
    api_version: ApiVersion;
    height: number;
    registrations: Hash384Hex[];
    statements: {
        class: PrivateStatementClass;
        digest: Hash384Hex;
    }[];
}
/** A note a statement appended: its commitment and the digest of its capsule. */
export interface PrivateStatementNote {
    commitment: Hash384Hex;
    capsule_digest: Hash384Hex;
}
/** Records in index order; `next` as for notes. */
export interface PrivateRecordPage {
    api_version: ApiVersion;
    records: PrivateRecord[];
    next: number | null;
}
