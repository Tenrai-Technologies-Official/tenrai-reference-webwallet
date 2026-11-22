import { NETWORKS } from "./context.js";
import { protocolBindings } from "./runtime.js";
export { PrivateNotes, } from "./private-notes.js";
export { ProofFailure, browserProver, localProver, nativeProver, proofEstimate, proverThreads, } from "./prover.js";
export { NativeLockSession } from "./native-locks.js";
export { TenraiWalletError } from "../errors.js";
export { DEFAULT_VALIDATOR_COMMISSION_BPS, MAX_VALIDATOR_COMMISSION_BPS, MIN_VALIDATOR_COMMISSION_BPS, VALIDATOR_COMMISSION_STEP_BPS, } from "../types/staking.js";
export { autoCompound } from "./auto.js";
export { MESSENGER_LIMITS, Messenger } from "./messenger.js";
export { isChatText, isMessengerPayload, isSafeText, payloadText } from "./payload.js";
export { encodeRecipientPayloads, recipientPayloads } from "./recipients.js";
export { MAX_REQUEST_PAYLOAD_BYTES, isRequestPayload, parsePaymentRequest, paymentRequest } from "./request.js";
export { MAX_MULTISIG_PACKAGE_BYTES, MULTISIG_PUBLIC_KEY_BYTES, MULTISIG_SIGNATURE_BYTES, MultisigSession, } from "./multisig.js";
export { DEFAULT_VALIDATOR_CONSENSUS_KEY_INDEX, DEFAULT_VALIDATOR_ROTATION_KEY_INDEX, MIN_VALIDATOR_CONSENSUS_KEY_INDEX, } from "./keychain.js";
export { Wallet } from "./wallet.js";
/**
 * Loads the Rust protocol rules once. Only needed when a bundler moves the binary: pass its URL or
 * bytes before the first wallet call. Any source must match the pinned hash.
 */
export async function loadProtocolRules(source) {
    await protocolBindings(source);
}
/** Whether `text` is a canonical Tenrai address on `network`, by the protocol package's rules. */
export async function isValidAddress(text, network) {
    if (typeof text !== "string" || text.length === 0 || text.length > 128 || !NETWORKS.includes(network)) {
        return false;
    }
    const wasm = await protocolBindings();
    try {
        return wasm.parseAddress(text, network) === text;
    }
    catch {
        return false;
    }
}
export { browserPrivateLocalScanStore } from "./private-local-store.js";
export { sqlitePrivateLocalScanStore } from "./private-local-sqlite.js";
export { indexedDbPrivateInventoryStore } from "./private-inventory-store.js";
export { sqlitePrivateInventoryStore } from "./private-inventory-sqlite.js";
export { indexedDbPublicCoinStore } from "./public-coin-indexeddb.js";
export { sqlitePublicCoinStore } from "./public-coin-sqlite.js";
export { indexedDbOutcomeStore } from "./outcome-store.js";
export { sqliteOutcomeStore } from "./outcome-sqlite.js";
export { UnknownOutcomeError } from "./unknown-outcome.js";
export { indexedDbFinalityGuardStore } from "./finality-guard-indexeddb.js";
export { sqliteFinalityGuardStore } from "./finality-guard-sqlite.js";
export { indexedDbPersistentPublicCoinStore } from "./public-coin-persistent-indexeddb.js";
export { sqlitePersistentPublicCoinStore } from "./public-coin-persistent-sqlite.js";
