/** @module @tenrai/sdk/wallet */
import type { Network } from "../types/common.ts";
export { PrivateNotes, type PrivateCoin, type PrivateNote, type PrivateProofOptions, type PrivateUsability, type PrivateNotesOptions, type PrivateNotesResult, type PrivateNotesStore, } from "./private-notes.ts";
export type { PublicTransfersStore } from "./public-transfer-journal.ts";
export type { PrivateKind, PrivateRecord, PrivateSend, PrivateSendOutcome } from "./private-sends.ts";
export { ProofFailure, browserProver, localProver, nativeProver, proofEstimate, proverThreads, type BrowserProverOptions, type PrivateProver, type ProofEstimate, type ProofFailureKind, type ProofKind, type ProofProgress, type ProveOptions, } from "./prover.ts";
export { NativeLockSession, type NativeLockBranch, type NativeLockDescriptor, type NativeLockRequest, type NativeLockSpendReview, type SignedNativeLockSpend } from "./native-locks.ts";
export { TenraiWalletError, type WalletErrorCode } from "../errors.ts";
export { DEFAULT_VALIDATOR_COMMISSION_BPS, MAX_VALIDATOR_COMMISSION_BPS, MIN_VALIDATOR_COMMISSION_BPS, VALIDATOR_COMMISSION_STEP_BPS, } from "../types/staking.ts";
export { autoCompound, type AutoCompoundOptions, type Compounding } from "./auto.ts";
export { MESSENGER_LIMITS, Messenger, type Chat, type ChatMessage, type MessengerFrame } from "./messenger.ts";
export { isChatText, isMessengerPayload, isSafeText, payloadText } from "./payload.ts";
export { encodeRecipientPayloads, type RecipientPayload, recipientPayloads } from "./recipients.ts";
export { MAX_REQUEST_PAYLOAD_BYTES, type PaymentRequest, isRequestPayload, parsePaymentRequest, paymentRequest } from "./request.ts";
export { MAX_MULTISIG_PACKAGE_BYTES, MULTISIG_PUBLIC_KEY_BYTES, MULTISIG_SIGNATURE_BYTES, MultisigSession, type MultisigBodyRequest, type MultisigDescriptor, type MultisigPackageInput, type MultisigPackageOutput, type MultisigPackageReview, type MultisigPackageSignature, type MultisigSigningMessages, type MultisigThreshold, type MultisigWitnessProfile, } from "./multisig.ts";
export type { ActivityOptions, Branch, BondRequest, BurnRequest, CompoundOptions, ExitValidatorRequest, FeeOptions, MergeOptions, MergeSummary, Payment, PositionRequest, PreparedTransfer, RegisterValidatorRequest, RotateValidatorRequest, ScheduleValidatorCommissionRequest, SendRequest, SentTransfer, SignedTransfer, SetStakeRewardAddressRequest, SweepRequest, UpdateValidatorEndpointRequest, ValidatorHeartbeatRequest, WalletActivity, WalletBalance, WalletOptions, WalletOutput, } from "./types.ts";
export { DEFAULT_VALIDATOR_CONSENSUS_KEY_INDEX, DEFAULT_VALIDATOR_ROTATION_KEY_INDEX, MIN_VALIDATOR_CONSENSUS_KEY_INDEX, } from "./keychain.ts";
export { type OpenTransfer, Wallet } from "./wallet.ts";
/**
 * Loads the Rust protocol rules once. Only needed when a bundler moves the binary: pass its URL or
 * bytes before the first wallet call. Any source must match the pinned hash.
 */
export declare function loadProtocolRules(source?: URL | string | Uint8Array): Promise<void>;
/** Whether `text` is a canonical Tenrai address on `network`, by the protocol package's rules. */
export declare function isValidAddress(text: string, network: Network): Promise<boolean>;
export { browserPrivateLocalScanStore, type PrivateLocalScanStore } from "./private-local-store.ts";
export { sqlitePrivateLocalScanStore, type PrivateScanSqlite } from "./private-local-sqlite.ts";
export type { PrivateRegistrationRequest, PrivateRegistrationQuote, RegistrationMetadata } from "./private-registration.ts";
export { indexedDbPrivateInventoryStore, type PrivateInventoryRoot, type PrivateInventoryStore } from "./private-inventory-store.ts";
export { sqlitePrivateInventoryStore } from "./private-inventory-sqlite.ts";
export { indexedDbPublicCoinStore } from "./public-coin-indexeddb.ts";
export { sqlitePublicCoinStore } from "./public-coin-sqlite.ts";
export type { PublicCoin, PublicCoinStore, PublicCoinQuery, PublicCoinPage, PublicCoinStoreOptions, PublicCoinDiskOptions, PublicCoinSqlite } from "./public-coin-store.ts";
export { indexedDbOutcomeStore, type OutcomeStore, type OutcomeDomain, type OutcomePage } from "./outcome-store.ts";
export { sqliteOutcomeStore } from "./outcome-sqlite.ts";
export { UnknownOutcomeError, type UnknownOutcome, type OutcomeAnchor } from "./unknown-outcome.ts";
export type { FinalityGuardStore, FinalityGuardSqlite, FinalityGuardIndexedDbOptions } from "./finality-guard-store.ts";
export { indexedDbFinalityGuardStore } from "./finality-guard-indexeddb.ts";
export { sqliteFinalityGuardStore } from "./finality-guard-sqlite.ts";
export { indexedDbPersistentPublicCoinStore } from "./public-coin-persistent-indexeddb.ts";
export { sqlitePersistentPublicCoinStore } from "./public-coin-persistent-sqlite.ts";
export type { PersistentPublicCoinStore, PublicCoinCheckpoint, PublicCoinCheckpointCodec } from "./public-coin-persistent-types.ts";
