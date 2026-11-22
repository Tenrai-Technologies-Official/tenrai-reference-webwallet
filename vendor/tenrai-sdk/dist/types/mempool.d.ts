import type { ApiVersion, AtomAmount, FinalizedCut, FinalizedStateCommitmentHex, Hash384Hex, Network, OutPoint, SpendLockCommitmentHex } from "./common.ts";
export interface MempoolEntry {
    transaction_id: Hash384Hex;
    mass: number;
    wire_bytes: number;
    fee: AtomAmount;
    fee_per_mass: AtomAmount;
}
export interface MempoolEntries {
    api_version: ApiVersion;
    total: number;
    entries: MempoolEntry[];
}
export interface PendingOutput {
    output_index: number;
    amount: AtomAmount;
}
export interface PendingPayment {
    address: string;
    transaction_id: Hash384Hex;
    outputs: PendingOutput[];
}
export interface PendingPayments {
    api_version: ApiVersion;
    finalized_height: number;
    entries: PendingPayment[];
}
export type MempoolRemovalReason = "finalized" | "expired" | "evicted" | "conflict" | "rejected" | "unknown";
export interface MempoolTxSeen {
    address: string;
    transaction_id: Hash384Hex;
    outputs: PendingOutput[];
    seen_at_millis: number;
}
export interface MempoolTxRemoved {
    address: string;
    transaction_id: Hash384Hex;
    reason: MempoolRemovalReason;
    finalized_height: number | null;
}
export interface MempoolTransaction {
    transaction_id: Hash384Hex;
    outputs: {
        output_index: number;
        address: string;
        amount: AtomAmount;
    }[];
    seen_at_millis: number;
}
export interface MempoolTransactionRemoved {
    transaction_id: Hash384Hex;
    reason: MempoolRemovalReason;
    finalized_height: number | null;
}
export interface UtxoMembershipProof {
    outpoint: OutPoint;
    /** 118 bytes as hex. */
    record: string;
    proof: string;
}
export interface FinalizedUtxoProofResponse {
    api_version: ApiVersion;
    network: Network;
    chain_id: Hash384Hex;
    anchor: FinalizedCut;
    /** 842 bytes as hex. */
    state_commitment: FinalizedStateCommitmentHex;
    proofs: UtxoMembershipProof[];
}
/** The bounded, canonical request sent to `POST /v1/proofs/keys`. */
export interface FinalizedKeyRegistryProofRequest {
    api_version: ApiVersion;
    /** Caller-selected cut. Its BFT finality is authenticated outside this request. */
    anchor: FinalizedCut;
    /** One to five strictly ordered direct ML-DSA-65 lock commitments. */
    lock_commitments: SpendLockCommitmentHex[];
}
/** A membership proof carries the registered public key; an absence proof has `record: null`. */
export interface KeyRegistryProofEntry {
    /** 40 bytes as hex. */
    lock_commitment: SpendLockCommitmentHex;
    /** The registered ML-DSA-65 public key, 1952 bytes as hex, or null for an absence proof. */
    record: string | null;
    /** Bounded canonical key-registry Patricia proof bytes as hex. */
    proof: string;
}
/** Key-registry proofs bound to `anchor.state_root`; they do not prove the anchor's finality, authenticate it first. */
export interface FinalizedKeyRegistryProofResponse {
    api_version: ApiVersion;
    network: Network;
    chain_id: Hash384Hex;
    anchor: FinalizedCut;
    /** 842 bytes as hex. */
    state_commitment: FinalizedStateCommitmentHex;
    proofs: KeyRegistryProofEntry[];
}
/** Explicit presence or authenticated absence; authenticate anchor finality before using it. */
export interface UtxoPresenceProof {
    outpoint: OutPoint;
    record: string | null;
    proof: string;
}
export interface FinalizedUtxoPresenceResponse extends Omit<FinalizedUtxoProofResponse, "proofs"> {
    proofs: UtxoPresenceProof[];
}
