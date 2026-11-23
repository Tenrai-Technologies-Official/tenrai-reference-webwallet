import type { FinalityGuardStore } from "./finality-guard-store.ts";
import type { PersistentPublicCoinStore } from "./public-coin-persistent-types.ts";
import type { PrivateNotesOptions } from "./private-notes.ts";
import type { FeePriority } from "../types/chain.ts";
import type { Network, UtxoSource } from "../types/common.ts";
import type { TransactionLifecycle } from "../types/transaction.ts";
export type Branch = "receive" | "change";
export interface WalletOptions {
    /** Durable finality guard shared by all accounts of this wallet root. */
    finalityStore?: FinalityGuardStore;
    /** Authenticated coin cache. Node.js callers supply a dedicated disk adapter. */
    publicCoinStore?: (scope: string) => Promise<PersistentPublicCoinStore>;
    /** Browser coin-cache row cap. Defaults to 1,000,000. */
    publicCoinMaxCoins?: number;
    /** Per-scan history event cap, including resumed work. Defaults to 200,065,536. */
    publicCoinEventLimit?: number;
    /** Trust root for a custom chain. Built-in networks use the protocol WASM pins. */
    genesisManifest?: string;
    network: Network;
    /** Recovery passphrase, if configured. */
    passphrase?: string;
    account?: number;
    /** Opens the account journal and restores pending inputs before returning the wallet. */
    privateStore?: (owner: {
        readonly network: Network;
        readonly account: number;
        readonly address: string;
        readonly fingerprint: string;
    }) => PrivateNotesOptions | Promise<PrivateNotesOptions>;
}
export interface FeeOptions {
    /** Fee estimate priority, `normal` by default. */
    priority?: FeePriority;
    /** Fixed fee rate in atoms per unit of mass. */
    feePerMass?: bigint;
}
export interface Payment {
    to: string;
    /** Integer atoms. Use `parseTrai` to convert TRAI text. */
    amount: bigint;
    /** Recipient-specific payload. Omit the shared payload when using it. */
    payload?: string | Uint8Array;
}
/** One recipient or a batch of payments. */
export type SendRequest = FeeOptions & {
    /** Display-safe text or raw bytes stored with the transaction. */
    payload?: string | Uint8Array;
    /** Input outpoints the wallet must include. */
    include?: readonly {
        transactionId: string;
        outputIndex: number;
    }[];
} & (Payment | {
    payments: Payment[];
});
export interface SweepRequest extends FeeOptions {
    to: string;
}
export interface BurnRequest extends FeeOptions {
    /** Burn amount in atoms. Burning is irreversible. */
    amount: bigint;
}
/** Totals for the compounding confirmation. */
export interface MergeSummary {
    /** Inputs in the first round. */
    outputs: number;
    /** Transfers across all rounds needed to make the payment fit. */
    transfers: number;
    /** Total fee in atoms. */
    fee: bigint;
}
export interface MergeOptions {
    /** Return false to cancel before that round is sent. */
    confirm?: (merge: MergeSummary) => boolean | Promise<boolean>;
    /** Finality timeout per round. Defaults to 10 minutes. */
    timeoutMillis?: number;
}
export interface CompoundOptions extends FeeOptions {
    /** Minimum output count to exceed before merging. Defaults to one. */
    above?: number;
    /** Minimum total atoms outside the largest output. */
    atLeast?: bigint;
}
export interface BondRequest extends FeeOptions {
    validatorId: string;
    /** Delegation amount in atoms. */
    amount: bigint;
    /** Position owner. Defaults to the first receiving address. */
    owner?: string;
}
export interface PositionRequest extends FeeOptions {
    positionId: string;
}
/** Self-bond and consensus-key parameters for a validator registration. */
export interface RegisterValidatorRequest extends FeeOptions {
    /** Self-bond in atoms, at least the finalized minimum. */
    selfBond: bigint;
    /** Canonical hex of the validator's overlay endpoint. */
    overlayEndpointHex: string;
    /** Reserved change-branch index for the validator consensus key. */
    consensusKeyIndex?: number;
    /** Delegator commission. Defaults to 500 basis points. */
    commissionBps?: number;
    /** Registry owner. Defaults to the first receiving address. */
    owner?: string;
    /** Reward destination. Defaults to the owner address. */
    rewardAddress?: string;
}
export interface ExitValidatorRequest extends FeeOptions {
    validatorId: string;
}
export interface RotateValidatorRequest extends FeeOptions {
    validatorId: string;
    /** Canonical hex of the new overlay endpoint. */
    overlayEndpointHex: string;
    /** Reserved change-branch index for the new validator consensus key. */
    consensusKeyIndex?: number;
}
/** Overlay endpoint update signed by the current consensus key. */
export interface UpdateValidatorEndpointRequest extends FeeOptions {
    validatorId: string;
    /** Canonical hex of the replacement overlay endpoint. */
    overlayEndpointHex: string;
    /** Reserved change-branch index of the active validator consensus key. */
    consensusKeyIndex?: number;
}
export interface ScheduleValidatorCommissionRequest extends FeeOptions {
    validatorId: string;
    /** New commission in 10-basis-point increments. */
    commissionBps: number;
}
export interface SetStakeRewardAddressRequest extends FeeOptions {
    positionId: string;
    rewardAddress: string;
}
export interface ValidatorHeartbeatRequest extends FeeOptions {
    validatorId: string;
    /** Reserved change-branch index of the active validator consensus key. */
    consensusKeyIndex?: number;
}
/** Review metadata. Signed bytes stay in the wallet until durable reservation. */
export interface PreparedTransfer {
    transactionId: string;
    /** Atoms paid, bonded or withdrawn by the operation. */
    amount: bigint;
    fee: bigint;
    change: bigint;
    inputs: number;
    /** Last executable cut height, also accepted by `waitForFinal`. */
    validUntil: bigint;
}
/** Signed export with inputs reserved until verified reconciliation. */
export interface SignedTransfer extends PreparedTransfer {
    /** Wire bytes ready for `client.transactions.submit`. */
    wireHex: string;
    /** Canonical transaction manifest it was signed under. */
    manifest: string;
}
export interface SentTransfer extends PreparedTransfer {
    wireHex: string;
    lifecycle: TransactionLifecycle;
}
export interface WalletBalance {
    /** Finalized balance in atoms across the wallet's used addresses. */
    atoms: bigint;
    outputs: number;
    addresses: {
        address: string;
        branch: Branch;
        index: number;
        atoms: bigint;
        outputs: number;
    }[];
    indexedHeight: number;
}
export interface WalletOutput {
    address: string;
    transactionId: string;
    outputIndex: number;
    /** Amount in atoms. */
    amount: bigint;
    /** Finalized cut that created the output. */
    height: number;
}
export interface ActivityOptions {
    /** Page limit. Defaults to 50 and is capped at 1,000. */
    limit?: number;
}
/** Finalized activity. `received - spent` is the balance change. */
export interface WalletActivity {
    /** Null when the node cannot identify the spender. */
    transactionId: string | null;
    height: number;
    /** Atoms received, including change. */
    received: bigint;
    /** Atoms spent from wallet inputs. */
    spent: bigint;
    /** Origin of the received outputs. */
    sources: UtxoSource[];
}
