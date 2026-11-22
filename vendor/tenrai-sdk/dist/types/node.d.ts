import type { ApiVersion, AtomAmount, FinalizedCut, Hash384Hex, Network } from "./common.ts";
export type StorageMode = "full" | "archive" | "pruned";
export interface NodeInfo {
    api_version: ApiVersion;
    network: Network;
    chain_id: Hash384Hex;
    protocol_version: number;
    params_hash: Hash384Hex;
    node_version: string;
    /** 64 hex characters, see `NodeIdentity`. */
    identity: string;
    storage_mode: StorageMode;
    /** Lowest height whose block bodies this node still has. */
    history_floor: number;
    /** Height the address index has reached; null while it is being built. */
    address_index_height: number | null;
    finalized: FinalizedCut;
    started_at_millis: number;
}
/** The protocol version and parameters that apply from a height on. */
export interface RuleChange {
    height: number;
    protocol_version: number;
    params_hash: Hash384Hex;
}
/** A protocol version, from a height on, of a release newer than the node's. */
export interface UnknownRules {
    height: number;
    protocol_version: number;
}
export interface NodeStatus {
    api_version: ApiVersion;
    network: Network;
    chain_id: Hash384Hex;
    /** Those of the next cut, as are the parameters. */
    protocol_version: number;
    params_hash: Hash384Hex;
    finalized: FinalizedCut;
    /** The next rule change the node's release schedules. */
    next_upgrade?: RuleChange;
    /** The network follows rules the node's release does not know; the node stopped following. */
    update_required?: UnknownRules;
    /** A peer claims to run rules the node's release does not know. */
    update_announced?: UnknownRules;
}
export interface NodeIdentity {
    api_version: ApiVersion;
    network: Network;
    chain_id: Hash384Hex;
    /** 64 hex characters, derived from the public key. */
    identity: string;
    /** ML-DSA-65 public key, 3904 hex characters. */
    public_key: string;
    key_scheme: "mldsa65";
}
export interface SyncStatus {
    api_version: ApiVersion;
    synced: boolean;
    finalized_height: number;
    best_peer_height: number | null;
    /** Cuts behind the best peer. */
    behind_by: number;
    peers: number;
}
/** A peer-advertisement advisory; the values summarize the connected peer set. */
export interface HistorySyncBlocker {
    local_height: number;
    best_peer_height: number;
    lowest_advertised_floor: number;
}
/** Retained-history bridge advice from authenticated peer advertisements. */
export interface HistorySyncStatus {
    api_version: ApiVersion;
    blocker: HistorySyncBlocker | null;
}
export interface PeerInfo {
    peer_id: string;
    address: string | null;
    outbound: boolean | null;
    authenticated: boolean;
    finalized_height: number | null;
    connected_seconds: number | null;
}
export interface PeerList {
    api_version: ApiVersion;
    peers: PeerInfo[];
}
export interface StorageInfo {
    api_version: ApiVersion;
    mode: StorageMode;
    finalized_height: number;
    /** Lowest height whose complete canonical block bodies and witnesses are kept. */
    body_history_floor: number;
    /** Actual compact-query boundary; absent on older nodes. */
    compact_history_floor?: number;
    /** Lowest height whose finalized state is kept whole, so UTXO proofs work from there on; 0 on an archive. */
    state_history_floor: number;
    archive_capable: boolean;
    /** Whether it holds every cut and block from genesis. */
    complete_history: boolean;
    /** Configured total query-history horizon; null for an archive. */
    history_days: number | null;
    /** Canonical transaction and witness retention, when advertised. */
    canonical_history_days?: number;
    /** Configured compact-query retention; availability starts at compact_history_floor. */
    compact_history_days?: number;
    /** The height of the snapshot it started from; compact private recovery rows may predate it. */
    started_from_snapshot: number | null;
    /** First retained private note index; 0 after complete recovery-log synchronization. */
    private_notes_from: number;
    /** The first height of the private spends it holds. */
    private_spends_from_height: number;
    /**
     * The check of the history below the snapshot this node started from; null for a node that
     * holds its full history or keeps only recent cuts.
     */
    history_check: HistoryCheck | null;
}
/**
 * `replaying`: the history is replayed from genesis with every check of a normal sync.
 * `verified`: the replay reached the snapshot with exactly its cut; the node serves this history
 * from its next start. `failed`: the replay disagreed with the snapshot; the node keeps its
 * snapshot and never serves that history.
 */
export type HistoryCheckPhase = "replaying" | "verified" | "failed";
/**
 * A node that started from a snapshot serves no history below it until a replay from genesis
 * arrives at the same cut.
 */
export interface HistoryCheck {
    phase: HistoryCheckPhase;
    snapshot_height: number;
    /** Height the replay has checked; null once the check failed. */
    checked_height: number | null;
}
export interface WorkPoolInfo {
    api_version: ApiVersion;
    held_work: number;
    queued_work: number;
    open_anchors: number;
}
export interface NetworkMiningInfo {
    api_version: ApiVersion;
    work_ref: Hash384Hex | null;
    target: string | null;
    registration_height: number | null;
    registration_window_end: number | null;
    work_blocks_per_second: number;
    target_cut_interval_millis: number;
}
export interface MempoolInfo {
    api_version: ApiVersion;
    transactions: number;
    mass: number;
    wire_bytes: number;
    max_transactions: number;
    max_mass: number;
    max_wire_bytes: number;
    held_blocks: number;
    queued_blocks: number;
    lowest_fee_per_mass: AtomAmount | null;
}
