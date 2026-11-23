import { type AddressProofDocument, type AddressProofRequest } from "../address.ts";
import type { TenraiClient } from "../client.ts";
import type { TransactionLifecycle } from "../types/transaction.ts";
import type { Network } from "../types/common.ts";
import type { StakePositionView } from "../types/staking.ts";
import { Messenger } from "./messenger.ts";
import type { MultisigSession } from "./multisig.ts";
import type { NativeLockSession, NativeLockSpendReview, SignedNativeLockSpend } from "./native-locks.ts";
import { PrivateNotes, type PrivateNotesOptions } from "./private-notes.ts";
import type { ActivityOptions, Branch, BondRequest, BurnRequest, CompoundOptions, ExitValidatorRequest, FeeOptions, MergeOptions, PositionRequest, PreparedTransfer, RegisterValidatorRequest, RotateValidatorRequest, ScheduleValidatorCommissionRequest, SendRequest, SentTransfer, SetStakeRewardAddressRequest, SignedTransfer, SweepRequest, UpdateValidatorEndpointRequest, ValidatorHeartbeatRequest, WalletActivity, WalletBalance, WalletOptions, WalletOutput } from "./types.ts";
/** Retained signed transaction. An HTLC claim may include its preimage. */
export interface OpenTransfer {
    transactionId: string;
    wireHex: string;
    /** Manifest used for the original signature. */
    manifest?: string;
    validUntil: bigint;
    sentAt: number;
    /** Keep unresolved submissions until verified reconciliation. */
    needsReview?: boolean;
    /** Pause retries after a reported expiry, settlement or spent input. */
    resendPaused?: boolean;
    /** Exported transactions become eligible for resends after `submit`. */
    exported?: boolean;
    /** Outpoints reserved by the original transaction. */
    spends: {
        key: string;
        address: string;
    }[];
}
/** HD wallet backed by the protocol WASM. */
export declare class Wallet {
    #private;
    readonly network: Network;
    readonly account: number;
    private constructor();
    static fromMnemonic(mnemonic: string, options: WalletOptions): Promise<Wallet>;
    /** Generate a wallet and its recovery phrase. Back up the phrase and passphrase. */
    static generate(options: WalletOptions): Promise<{
        wallet: Wallet;
        mnemonic: string;
    }>;
    get fingerprint(): string;
    /** Highest used receive and change indices after a scan. */
    get usedAddresses(): Readonly<Record<Branch, number>> | undefined;
    /** Restore scan boundaries without lowering them. */
    rememberUsed(used: Record<Branch, number>): void;
    /** Issue the next receiving address after scanning or restoring used indices. */
    newAddress(): {
        index: number;
        address: string;
    };
    get lastIssued(): number;
    rememberIssued(index: number): void;
    /** Scan owned addresses. An explicit rebuild replaces the advisory coin cache. */
    rescan(client: TenraiClient, options?: {
        depth?: number;
        rebuildCoinCache?: boolean;
    }): Promise<Readonly<Record<Branch, number>>>;
    address(index?: number, branch?: Branch): string;
    multisigMemberPublicKey(index?: number, branch?: Branch): Uint8Array;
    /** Derive a validator key from the reserved change-index range. */
    validatorConsensusPublicKey(index?: number): Uint8Array;
    /** Sign the exact reviewed multisig template with this member key. */
    signMultisigPackage(session: MultisigSession, bytes: Uint8Array, reviewed: string, index?: number, branch?: Branch): Uint8Array;
    /** Verify a conditional input using the local trust root and finality guard. */
    reviewNativeLockSpend(session: NativeLockSession, client: TenraiClient, request: Parameters<NativeLockSession["prepareSpend"]>[1]): Promise<NativeLockSpendReview>;
    /** Sign a reviewed native spend and durably reserve its input before export. */
    signNativeLockSpend(session: NativeLockSession, review: NativeLockSpendReview, index?: number, branch?: Branch): Promise<SignedNativeLockSpend>;
    /** Prepare a reviewed native spend for managed submission. */
    prepareNativeLockSpend(session: NativeLockSession, review: NativeLockSpendReview, index?: number, branch?: Branch): Promise<PreparedTransfer>;
    owns(address: string): boolean;
    /** Return the derivation path for an address already known to the wallet. */
    pathOf(address: string): Readonly<{
        branch: Branch;
        index: number;
    }> | undefined;
    balance(client: TenraiClient): Promise<WalletBalance>;
    /** Return up to the 256 largest outputs. Use `outputPage` for a canonical page. */
    outputs(client: TenraiClient, options?: {
        limit?: number;
        address?: string;
    }): Promise<WalletOutput[]>;
    outputPage(client: TenraiClient, query?: import("./public-coin-store.ts").PublicCoinQuery): Promise<import("./public-coin-store.ts").PublicCoinPage & {
        indexedHeight: number;
    }>;
    /** Finalized activity, newest first. */
    activity(client: TenraiClient, options?: ActivityOptions): Promise<WalletActivity[]>;
    positions(client: TenraiClient): Promise<StakePositionView[]>;
    proveAddress(request: AddressProofRequest | string, options?: {
        now?: number;
    }): Promise<AddressProofDocument>;
    /** Build a transfer review and retain its original signed bytes for `submit` or `exportSigned`. */
    prepare(client: TenraiClient, request: SendRequest): Promise<PreparedTransfer>;
    /** Reserve and send the exact transfer prepared by this wallet. */
    submit(client: TenraiClient, prepared: PreparedTransfer): Promise<SentTransfer>;
    /** Export signed bytes after the input reservations commit durably. */
    exportSigned(prepared: PreparedTransfer): Promise<SignedTransfer>;
    /** Submit a transfer. An ambiguous response raises `unconfirmed`. */
    send(client: TenraiClient, request: SendRequest): Promise<SentTransfer>;
    /** Send to the network's unspendable burn address. */
    burn(client: TenraiClient, request: BurnRequest): Promise<SentTransfer>;
    /**
     * Retry unknown, executable transfers using their original bytes, at most every 30 seconds.
     * Returns the IDs accepted by the node.
     */
    resend(client: TenraiClient): Promise<string[]>;
    reconcilePublic(client: TenraiClient): Promise<string[]>;
    unknownPublicOutcome(transactionId: string): Promise<import("./unknown-outcome.ts").UnknownOutcome<OpenTransfer> | null>;
    unknownPublicOutcomes(options?: {
        after?: string;
        limit?: number;
    }): Promise<import("./outcome-store.ts").OutcomePage>;
    /** Return copies of the retained public transfers. */
    openTransfers(): OpenTransfer[];
    /** Import retained transfers when the wallet has no managed public journal. */
    keepOpen(transfers: readonly OpenTransfer[]): void;
    /**
     * Return the most a single transfer can send after fees, within the input limit.
     * Defaults to the first receiving address and returns zero if the fee cannot be covered.
     */
    maxSendable(client: TenraiClient, request?: FeeOptions & {
        to?: string;
        payload?: string | Uint8Array;
    }): Promise<bigint>;
    /**
     * Confirm and finalize each needed compounding round before preparing the payment.
     * Up to 64 compounds per call. Throws `insufficient` when compounding cannot make it fit.
     */
    mergeFor(client: TenraiClient, request: SendRequest, options?: MergeOptions): Promise<SentTransfer[]>;
    /** Sweep spendable outputs to one address, up to 64 transfers per call. */
    sweep(client: TenraiClient, request: SweepRequest): Promise<SentTransfer[]>;
    /**
     * Merge outputs per address above the configured threshold, up to 64 transfers per call.
     */
    compound(client: TenraiClient, options?: CompoundOptions): Promise<SentTransfer[]>;
    /** Bond to a validator after checking finalized delegation state. */
    bond(client: TenraiClient, request: BondRequest): Promise<SentTransfer>;
    unbond(client: TenraiClient, request: PositionRequest): Promise<SentTransfer>;
    /** Withdraw a position once it is `withdrawable`. */
    withdraw(client: TenraiClient, request: PositionRequest): Promise<SentTransfer>;
    /** Register a self-bond and prove possession of the new consensus key. */
    registerValidator(client: TenraiClient, request: RegisterValidatorRequest): Promise<SentTransfer>;
    /** Schedule exit using the finalized owner nonce. */
    exitValidator(client: TenraiClient, request: ExitValidatorRequest): Promise<SentTransfer>;
    /** Rotate a validator key and endpoint using the finalized registry record. */
    rotateValidator(client: TenraiClient, request: RotateValidatorRequest): Promise<SentTransfer>;
    /** Update the endpoint using the current consensus key. */
    updateValidatorEndpoint(client: TenraiClient, request: UpdateValidatorEndpointRequest): Promise<SentTransfer>;
    /** Schedule commission in the active rules' 10-basis-point increments. */
    scheduleValidatorCommission(client: TenraiClient, request: ScheduleValidatorCommissionRequest): Promise<SentTransfer>;
    setStakeRewardAddress(client: TenraiClient, request: SetStakeRewardAddressRequest): Promise<SentTransfer>;
    /** Sign a heartbeat for the next finalized epoch. */
    heartbeatValidator(client: TenraiClient, request: ValidatorHeartbeatRequest): Promise<SentTransfer>;
    /** Keep one messenger session per wallet. Its key stays in WASM. */
    messenger(client: TenraiClient): Messenger;
    /** Stops new spending immediately; resolves after outstanding work, key cleanup and store release. */
    close(): Promise<void>;
    /** Relay an already signed artifact through the wallet's durable submission path. */
    submitSignedPublic(client: TenraiClient, artifact: {
        transactionId: string;
        wireHex: string;
        manifest: string;
        validUntil: bigint;
        spends: {
            key: string;
            address: string;
        }[];
    }): Promise<{
        transactionId: string;
        lifecycle: TransactionLifecycle;
    }>;
    /** Retry the retained original signed bytes. */
    retryPublic(client: TenraiClient, transactionId: string): Promise<{
        transactionId: string;
        lifecycle: TransactionLifecycle;
    }>;
    /** Restore public and private submission journals locally before spending. */
    restorePrivatePending(options: PrivateNotesOptions): Promise<void>;
    /**
     * This account's private notes, read from `client` and checked against the wallet's trust root, and
     * spent with proofs a prover on this device makes; see `localProver`.
     */
    privateNotes(client: TenraiClient, options?: PrivateNotesOptions): Promise<PrivateNotes>;
}
