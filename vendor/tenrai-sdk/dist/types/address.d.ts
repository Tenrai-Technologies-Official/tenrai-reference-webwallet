import type { ApiVersion, AtomAmount, Hash384Hex, Network, OutPoint, UtxoRecord, UtxoSource } from "./common.ts";
export interface AddressBalance {
    api_version: ApiVersion;
    address: string;
    balance: AtomAmount;
    utxos: number;
    indexed_height: number;
}
export interface BalanceEntry {
    address: string;
    balance: AtomAmount;
    utxos: number;
}
export interface AddressBalances {
    api_version: ApiVersion;
    indexed_height: number;
    balances: BalanceEntry[];
}
export interface AddressUtxos {
    address: string;
    utxos: UtxoRecord[];
    truncated: boolean;
}
export interface AddressUtxoBatch {
    api_version: ApiVersion;
    indexed_height: number;
    addresses: AddressUtxos[];
}
export interface UtxoPage {
    api_version: ApiVersion;
    network: Network;
    address: string;
    /** Per-page finalized snapshot; a pinned cursor retains it, while after-key mode may advance. */
    anchor: {
        height: number;
        cut_id: Hash384Hex;
        state_root: Hash384Hex;
    };
    utxos: UtxoRecord[];
    next_cursor: string | null;
}
export type AddressEventKind = "received" | "spent";
export interface AddressEvent {
    finalized_height: number;
    kind: AddressEventKind;
    outpoint: OutPoint;
    amount: AtomAmount;
    source: UtxoSource;
    transaction_id: Hash384Hex | null;
}
/**
 * One page of an address's history. `history_from` is the first cut this node holds the history of:
 * where the pages end, older events may exist on another node. Zero when it holds all of it.
 */
export interface AddressHistoryPage {
    api_version: ApiVersion;
    address: string;
    indexed_height: number;
    history_from: number;
    events: AddressEvent[];
    next_cursor: string | null;
}
export interface AddressChange {
    address: string;
    finalized_height: number;
    received: UtxoRecord[];
    spent: OutPoint[];
    balance: AtomAmount;
    utxos: number;
}
export interface AddressChanges {
    api_version: ApiVersion;
    after_height: number;
    indexed_height: number;
    changes: AddressChange[];
    /** Addresses with more than 256 events since `after_height`; read them again in full. */
    resync: string[];
}
export interface CutChange {
    address: string;
    kind: AddressEventKind;
    outpoint: OutPoint;
    amount: AtomAmount;
    source: UtxoSource;
    created_finalized_height: number;
    transaction_id: Hash384Hex | null;
}
export interface CutChanges {
    api_version: ApiVersion;
    height: number;
    changes: CutChange[];
    next_cursor: number | null;
}
export interface CutAddresses {
    api_version: ApiVersion;
    height: number;
    addresses: string[];
}
export interface KeyReference {
    address: string;
    usable_at_admission_anchor: boolean;
}
export interface KeyReferenceBatch {
    api_version: ApiVersion;
    admission_anchor: {
        height: number;
        cut_id: Hash384Hex;
        work_ref: Hash384Hex;
        state_root: Hash384Hex;
    };
    registrations: KeyReference[];
}
/** One finite, fixed-target history range per owner. */
export interface AddressHistoryRange {
    address: string;
    after_height: number;
}
export interface AddressHistoryRangesPage {
    api_version: ApiVersion;
    at_height: number;
    indexed_height: number;
    history_from: number;
    events: (AddressEvent & {
        address: string;
    })[];
    completed: string[];
    next_cursor: string | null;
}
