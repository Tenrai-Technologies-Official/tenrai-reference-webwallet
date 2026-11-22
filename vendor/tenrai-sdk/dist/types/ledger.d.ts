import type { ApiVersion, AtomAmount, FinalizedCut, Hash384Hex, RewardReference, StakePayoutReference } from "./common.ts";
import type { TransactionView } from "./transaction.ts";
export type BlockState = "pooled" | "registered" | "executed" | "retained";
/** `pending` while the anchor's registration window is open, so the subsidy share can still change. */
export type BlockRewardState = "pending" | "queued" | "paid";
/** Fees are known once the block executed, its subsidy share once its anchor closed. */
export interface BlockReward {
    state: BlockRewardState;
    fees: AtomAmount;
    subsidy: AtomAmount | null;
    /** The first cut that may pay it; payouts per cut are capped, so it can come a little later. */
    payable_from_height: number | null;
}
export interface BlockView {
    api_version: ApiVersion;
    block_id: Hash384Hex;
    protocol_version: number;
    work_ref: Hash384Hex;
    parents: Hash384Hex[];
    payload_length: number;
    payload_mass: number;
    reward_address: string;
    nonce: string;
    extranonce: string;
    /** Text the miner chose; display it escaped. */
    miner_tag: string | null;
    transaction_ids: Hash384Hex[];
    state: BlockState;
    registration_height: number | null;
    execution_height: number | null;
    /** Finalized cuts from the one that executed it up to the head; 0 before that. */
    confirmations: number;
    /** Blocks registered from that cut on, capped at 100,000; null before finality. */
    work_confirmations: number | null;
    finalized_at_millis: number | null;
    /** Null until the block executed. */
    reward: BlockReward | null;
}
export interface BlockSummary {
    block_id: Hash384Hex;
    parents: Hash384Hex[];
    transactions: number;
    reward_address: string;
    miner_tag: string | null;
    seen_at_millis: number;
}
export interface BlockList {
    api_version: ApiVersion;
    blocks: BlockSummary[];
}
export interface CutSummary {
    cut: FinalizedCut;
    registered_blocks: number;
    executed_blocks: number;
    rewards: AtomAmount | null;
    /** What the staking pool received from this cut; null when the node keeps no such summary. */
    stake_rewards: AtomAmount | null;
    finalized_at_millis: number | null;
}
export interface CutView {
    api_version: ApiVersion;
    cut: FinalizedCut;
    epoch: number;
    protocol_version: number;
    registered_blocks: Hash384Hex[];
    executed_blocks: Hash384Hex[];
    transactions: number;
    /** Finalized cuts from this one up to the head. */
    confirmations: number;
    /** Blocks registered from this cut on, capped at 100,000. */
    work_confirmations: number | null;
    rewards: RewardReference[] | null;
    /** What the staking pool received from this cut; null when the node keeps no such summary. */
    stake_rewards: AtomAmount | null;
    /** Positions paid from a closed staking pool in this cut; null when the node keeps no summary. */
    stake_payouts: StakePayoutReference[] | null;
    finalized_at_millis: number | null;
}
export interface CutList {
    api_version: ApiVersion;
    cuts: CutSummary[];
    next_before: number | null;
}
export interface CutBlocks {
    api_version: ApiVersion;
    height: number;
    blocks: BlockView[];
}
export interface CutTransactions {
    api_version: ApiVersion;
    height: number;
    transactions: TransactionView[];
    next_cursor: Hash384Hex | null;
}
