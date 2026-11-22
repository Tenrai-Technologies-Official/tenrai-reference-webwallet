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
/** The retained original authorization artifact; an HTLC claim can include its preimage before broadcast. */
export interface OpenTransfer {
    transactionId: string;
    wireHex: string;
    /** Canonical native transaction manifest retained with the original wire. */
    manifest?: string;
    validUntil: bigint;
    sentAt: number;
    /** An uncertain attempt retains its frame and inputs until verified reconciliation. */
    needsReview?: boolean;
    /** A reported expiry/final/spend stops automatic POSTs, without proving settlement. */
    resendPaused?: boolean;
    /** Handed out by `exportSigned`; the wallet resends it only after `submit`. */
    exported?: boolean;
    /** The outputs it spends; once one leaves the UTXO set it was included or another transfer won. */
    spends: {
        key: string;
        address: string;
    }[];
}
/** An HD wallet from a 24-word recovery phrase; keys never leave the protocol WASM. */
export declare class Wallet {
    #private;
    readonly network: Network;
    readonly account: number;
    private constructor();
    static fromMnemonic(mnemonic: string, options: WalletOptions): Promise<Wallet>;
    /** A new wallet and its recovery phrase; store the phrase, it is the only backup. */
    static generate(options: WalletOptions): Promise<{
        wallet: Wallet;
        mnemonic: string;
    }>;
    /** The recovery fingerprint of this wallet. */
    get fingerprint(): string;
    /** The highest used receive/change indices, once a scan has completed. */
    get usedAddresses(): Readonly<Record<Branch, number>> | undefined;
    /** Restores the receive/change scan boundaries without lowering them. */
    rememberUsed(used: Record<Branch, number>): void;
    /** Hands out the next receiving address after a scan or rememberUsed. */
    newAddress(): {
        index: number;
        address: string;
    };
    /** The receiving index last handed out by newAddress. */
    get lastIssued(): number;
    /** Restores the highest receiving index already handed out. */
    rememberIssued(index: number): void;
    /** Scans addresses; rebuildCoinCache explicitly replaces only this account's advisory coin cache. */
    rescan(client: TenraiClient, options?: {
        depth?: number;
        rebuildCoinCache?: boolean;
    }): Promise<Readonly<Record<Branch, number>>>;
    /** Derives receiving or change address number index. */
    address(index?: number, branch?: Branch): string;
    /** Returns the public key for one wallet path. */
    multisigMemberPublicKey(index?: number, branch?: Branch): Uint8Array;
    /** Returns a validator public key from its reserved derivation range. */
    validatorConsensusPublicKey(index?: number): Uint8Array;
    /** Signs the exact reviewed multisig template with one wallet member key. */
    signMultisigPackage(session: MultisigSession, bytes: Uint8Array, reviewed: string, index?: number, branch?: Branch): Uint8Array;
    /** Authenticate a conditional input under this wallet's local Genesis and durable finality guard. */
    reviewNativeLockSpend(session: NativeLockSession, client: TenraiClient, request: Parameters<NativeLockSession["prepareSpend"]>[1]): Promise<NativeLockSpendReview>;
    /** Signs a reviewed native-lock spend; as with `exportSigned`, its input is held in the durable journal first. */
    signNativeLockSpend(session: NativeLockSession, review: NativeLockSpendReview, index?: number, branch?: Branch): Promise<SignedNativeLockSpend>;
    /** Prepares a native spend for the wallet's ordinary submission, input reservation and retry handling. */
    prepareNativeLockSpend(session: NativeLockSession, review: NativeLockSpendReview, index?: number, branch?: Branch): Promise<PreparedTransfer>;
    /** Whether this wallet derived the address. */
    owns(address: string): boolean;
    /** Returns an already derived address path, if owned. */
    pathOf(address: string): Readonly<{
        branch: Branch;
        index: number;
    }> | undefined;
    /** Scans owned addresses and returns their finalized balance. */
    balance(client: TenraiClient): Promise<WalletBalance>;
    /** Returns up to256 largest available outputs. outputPage reads a bounded canonical page. */
    outputs(client: TenraiClient, options?: {
        limit?: number;
        address?: string;
    }): Promise<WalletOutput[]>;
    outputPage(client: TenraiClient, query?: import("./public-coin-store.ts").PublicCoinQuery): Promise<import("./public-coin-store.ts").PublicCoinPage & {
        indexedHeight: number;
    }>;
    /** Returns finalized address activity, newest first. */
    activity(client: TenraiClient, options?: ActivityOptions): Promise<WalletActivity[]>;
    /** Returns stake positions controlled by the used addresses. */
    positions(client: TenraiClient): Promise<StakePositionView[]>;
    /** Signs a reviewed address-proof request for an owned path. */
    proveAddress(request: AddressProofRequest | string, options?: {
        now?: number;
    }): Promise<AddressProofDocument>;
    /** Builds and signs a transfer for review; `submit` sends exactly this transfer, `exportSigned` hands out its bytes. */
    prepare(client: TenraiClient, request: SendRequest): Promise<PreparedTransfer>;
    /** Submits a transfer from `prepare` and holds its inputs back from other transfers, as `send` does. */
    submit(client: TenraiClient, prepared: PreparedTransfer): Promise<SentTransfer>;
    /** Signed bytes of a prepared transfer, returned once its inputs are held in the durable journal; nothing is sent. */
    exportSigned(prepared: PreparedTransfer): Promise<SignedTransfer>;
    /** Builds, signs and submits a transfer; a lost answer whose status cannot be read throws `unconfirmed`. */
    send(client: TenraiClient, request: SendRequest): Promise<SentTransfer>;
    /** Burns `amount`: pays it to the burn address of the wallet's network. It cannot be undone. */
    burn(client: TenraiClient, request: BurnRequest): Promise<SentTransfer>;
    /**
     * Sends transfers on their way again, unchanged, while the node does not know them and they can still
     * execute, each at most every 30 s: a node that restarts forgets what only its pool held. Every transfer
     * runs it first; call it now and then while waiting. Returns the ids the node took.
     */
    resend(client: TenraiClient): Promise<string[]>;
    reconcilePublic(client: TenraiClient): Promise<string[]>;
    unknownPublicOutcome(transactionId: string): Promise<import("./unknown-outcome.ts").UnknownOutcome<OpenTransfer> | null>;
    unknownPublicOutcomes(options?: {
        after?: string;
        limit?: number;
    }): Promise<import("./outcome-store.ts").OutcomePage>;
    /** The transfers on their way, to keep across a restart of the program and hand to `keepOpen`. */
    openTransfers(): OpenTransfer[];
    /** Takes back what `openTransfers` gave: their inputs stay held and `resend` looks after them. */
    keepOpen(transfers: readonly OpenTransfer[]): void;
    /**
     * The most one transfer can pay to `to` (the first receiving address when left out): the largest spendable
     * outputs up to the input limit, less the fee, which a `payload` raises. 0 when they cannot pay the fee.
     */
    maxSendable(client: TenraiClient, request?: FeeOptions & {
        to?: string;
        payload?: string | Uint8Array;
    }): Promise<bigint>;
    /**
     * Compounds first when `request` needs more outputs than one transfer spends, and waits until that is final;
     * `confirm` sees every round before it goes out. At most 64 compounds per call; returns none when the payment
     * already fits and throws `insufficient` when compounding cannot make it fit.
     */
    mergeFor(client: TenraiClient, request: SendRequest, options?: MergeOptions): Promise<SentTransfer[]>;
    /** Sends every spendable output to `to`, at most 64 transfers per call; run it again for the rest or after a failure. */
    sweep(client: TenraiClient, request: SweepRequest): Promise<SentTransfer[]>;
    /**
     * Merges the outputs of every address that holds more than `above` of them (several, by default),
     * at most 64 transfers per call; the way out of `compound-needed`. `autoCompound` runs it on a timer.
     */
    compound(client: TenraiClient, options?: CompoundOptions): Promise<SentTransfer[]>;
    /** Bonds `amount` to a validator after checking its finalized delegation state. */
    bond(client: TenraiClient, request: BondRequest): Promise<SentTransfer>;
    /** Starts unbonding a bonded position of this wallet. */
    unbond(client: TenraiClient, request: PositionRequest): Promise<SentTransfer>;
    /** Returns the stake of a position that is `withdrawable` to the wallet. */
    withdraw(client: TenraiClient, request: PositionRequest): Promise<SentTransfer>;
    /** Registers a validator using a self-bond, owner signature and proof of the new consensus key. */
    registerValidator(client: TenraiClient, request: RegisterValidatorRequest): Promise<SentTransfer>;
    /** Schedules the validator's exit with the current finalized owner nonce. */
    exitValidator(client: TenraiClient, request: ExitValidatorRequest): Promise<SentTransfer>;
    /** Rotates a validator key and overlay endpoint after checking the finalized registry record. */
    rotateValidator(client: TenraiClient, request: RotateValidatorRequest): Promise<SentTransfer>;
    /** Schedules an overlay endpoint change while retaining the active consensus key. */
    updateValidatorEndpoint(client: TenraiClient, request: UpdateValidatorEndpointRequest): Promise<SentTransfer>;
    /** Schedules a delayed validator commission change in the active rules' 10-bps grid. */
    scheduleValidatorCommission(client: TenraiClient, request: ScheduleValidatorCommissionRequest): Promise<SentTransfer>;
    /** Changes the finalized reward lock for one stake position. */
    setStakeRewardAddress(client: TenraiClient, request: SetStakeRewardAddressRequest): Promise<SentTransfer>;
    /** Publishes one signed heartbeat for the next finalized epoch of an eligible validator. */
    heartbeatValidator(client: TenraiClient, request: ValidatorHeartbeatRequest): Promise<SentTransfer>;
    /** Chats of this wallet, `protocol/messenger-v1.md`; the messenger key stays in the WASM. Keep one per wallet. */
    messenger(client: TenraiClient): Messenger;
    /** Stops new spending immediately; resolves after outstanding work, key cleanup and store release. */
    close(): Promise<void>;
    /** Relays an already signed reviewed public artifact through this wallet's durable submission path. */
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
    /** Retries the retained original bytes; it never constructs or signs a replacement transaction. */
    retryPublic(client: TenraiClient, transactionId: string): Promise<{
        transactionId: string;
        lifecycle: TransactionLifecycle;
    }>;
    /** Restores pending ENTER holds only; this reads the supplied store without contacting a node or creating a proof. */
    restorePrivatePending(options: PrivateNotesOptions): Promise<void>;
    /**
     * This account's private notes, read from `client` and checked against the wallet's trust root, and
     * spent with proofs a prover on this device makes; see `localProver`.
     */
    privateNotes(client: TenraiClient, options?: PrivateNotesOptions): Promise<PrivateNotes>;
}
