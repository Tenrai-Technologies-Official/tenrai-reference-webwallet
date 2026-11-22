import type { FinalityGuardStore } from "./finality-guard-store.ts";
import type { PersistentPublicCoinStore } from "./public-coin-persistent-types.ts";
import type { PrivateNotesOptions } from "./private-notes.ts";
import type { FeePriority } from "../types/chain.ts";
import type { Network, UtxoSource } from "../types/common.ts";
import type { TransactionLifecycle } from "../types/transaction.ts";
export type Branch = "receive" | "change";
export interface WalletOptions {
    /** Full-wallet chain/Genesis guard; all accounts share its physical lease. */
    finalityStore?: FinalityGuardStore;
    /** Retained authenticated advisory cache. Node.js callers must supply a dedicated disk provider. */
    publicCoinStore?: (scope: string) => Promise<PersistentPublicCoinStore>;
    /** Browser cache row cap; defaults to 1000000. Never truncates a completed inventory. */
    publicCoinMaxCoins?: number;
    /** Maximum history events processed during one resumed scan; defaults to200065536. */
    publicCoinEventLimit?: number;
    /** Public local Genesis manifest for a custom chain; built-in networks use compiled trust. */
    genesisManifest?: string;
    network: Network;
    /** The optional recovery passphrase set when the wallet was created. */
    passphrase?: string;
    account?: number;
    /** Restores durable private ENTER holds before the wallet is returned. The provider must use the same store as privateNotes. */
    privateStore?: (owner: {
        readonly network: Network;
        readonly account: number;
        readonly address: string;
        readonly fingerprint: string;
    }) => PrivateNotesOptions | Promise<PrivateNotesOptions>;
}
export interface FeeOptions {
    /** Fee level from the node's estimate, `normal` by default. */
    priority?: FeePriority;
    /** A fixed fee rate in atoms per unit of mass instead of the estimate. */
    feePerMass?: bigint;
}
export interface Payment {
    to: string;
    /** In atoms; `parseTrai("2.5")` converts from TRAI. */
    amount: bigint;
    /** This recipient's own payload, `protocol/recipient-payloads-v1.md`; then the request has no `payload` for all. */
    payload?: string | Uint8Array;
}
/** One recipient as `to` and `amount`, or several in `payments`. */
export type SendRequest = FeeOptions & {
    /** Text, checked for invisible characters, or raw bytes stored with the transfer. */
    payload?: string | Uint8Array;
    /** Outputs of this wallet the transfer has to spend, as a chat accept does. */
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
    /** In atoms; burned coins cannot be recovered. */
    amount: bigint;
}
/** What compounding first takes, for a confirmation. */
export interface MergeSummary {
    /** Outputs the first round spends. */
    outputs: number;
    /** Transfers of every round until the payment fits. */
    transfers: number;
    /** Fee of every round, in atoms. */
    fee: bigint;
}
export interface MergeOptions {
    /** Sees what compounding first takes before anything is sent; false stops it. */
    confirm?: (merge: MergeSummary) => boolean | Promise<boolean>;
    /** How long each round may take to become final, 10 minutes by default. */
    timeoutMillis?: number;
}
export interface CompoundOptions extends FeeOptions {
    /** Merge only addresses that hold more than this many outputs; 1 by default, so every address with several. */
    above?: number;
    /** Merge only addresses whose outputs besides the largest add up to at least this many atoms. */
    atLeast?: bigint;
}
export interface BondRequest extends FeeOptions {
    validatorId: string;
    /** In atoms. */
    amount: bigint;
    /** The wallet address that owns the position and receives its rewards; the first receiving address by default. */
    owner?: string;
}
export interface PositionRequest extends FeeOptions {
    positionId: string;
}
/** Registers a validator with a self-bond, an overlay endpoint and a wallet-derived consensus key. */
export interface RegisterValidatorRequest extends FeeOptions {
    /** In atoms; it must meet the finalized minimum self-bond. */
    selfBond: bigint;
    /** Canonical hex exported by the validator node for its private overlay route. */
    overlayEndpointHex: string;
    /** Reserved change-branch index for the validator consensus key. */
    consensusKeyIndex?: number;
    /** Delegator commission in basis points, 500 (5.0%) by default. */
    commissionBps?: number;
    /** Wallet address that owns the registry record; the first receiving address by default. */
    owner?: string;
    /** Reward destination; the owner address by default. */
    rewardAddress?: string;
}
export interface ExitValidatorRequest extends FeeOptions {
    validatorId: string;
}
export interface RotateValidatorRequest extends FeeOptions {
    validatorId: string;
    /** Canonical hex exported by the validator node for its new private overlay route. */
    overlayEndpointHex: string;
    /** Reserved change-branch index for the new validator consensus key. */
    consensusKeyIndex?: number;
}
/** Schedules an overlay endpoint change without replacing the validator consensus key. */
export interface UpdateValidatorEndpointRequest extends FeeOptions {
    validatorId: string;
    /** Canonical hex exported by the validator node for its replacement private overlay route. */
    overlayEndpointHex: string;
    /** Reserved change-branch index of the active validator consensus key. */
    consensusKeyIndex?: number;
}
export interface ScheduleValidatorCommissionRequest extends FeeOptions {
    validatorId: string;
    /** New delegated-reward commission in basis points, in 10-bps steps. */
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
/** A transfer to review: no input is held and its signed bytes stay in the wallet. */
export interface PreparedTransfer {
    transactionId: string;
    /** In atoms: what the recipients get, what a bond locks or what a withdrawal returns. */
    amount: bigint;
    fee: bigint;
    change: bigint;
    inputs: number;
    /** The last cut height at which the transfer can still execute; pass it to `waitForFinal`. */
    validUntil: bigint;
}
/** A transfer from `exportSigned`; its inputs stay held until a finality proof after `validUntil`. */
export interface SignedTransfer extends PreparedTransfer {
    /** The signed transaction, ready for `client.transactions.submit`. */
    wireHex: string;
    /** Canonical transaction manifest it was signed under. */
    manifest: string;
}
export interface SentTransfer extends PreparedTransfer {
    /** The signed transaction as sent. */
    wireHex: string;
    lifecycle: TransactionLifecycle;
}
export interface WalletBalance {
    /** Finalized balance of all used addresses, in atoms. */
    atoms: bigint;
    /** Unspent outputs (UTXOs) of all used addresses. */
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
/** One unspent output the wallet can spend now. */
export interface WalletOutput {
    address: string;
    transactionId: string;
    outputIndex: number;
    /** In atoms. */
    amount: bigint;
    /** Finalized height of the cut that created it. */
    height: number;
}
export interface ActivityOptions {
    /** Entries to return, 50 by default, at most 1000. */
    limit?: number;
}
/** What one transaction did to the wallet; `received - spent` is the change of the balance. */
export interface WalletActivity {
    /** Null only for an output whose spender the node does not know. */
    transactionId: string | null;
    /** Finalized height of the transaction. */
    height: number;
    /** Atoms paid to the wallet's addresses, change included. */
    received: bigint;
    /** Atoms that left the wallet's addresses. */
    spent: bigint;
    /** Where the received outputs came from, `stake_reward` for a staking payout. */
    sources: UtxoSource[];
}
