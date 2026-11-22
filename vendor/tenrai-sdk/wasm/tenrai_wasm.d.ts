/* tslint:disable */
/* eslint-disable */

/**
 * A paid registration, with complete signed funding and no private proof.
 */
export class PreparedRegistration {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    frame(): Uint8Array;
    summary(): string;
}

/**
 * One private statement ready for the local prover. `free` wipes its prover input.
 */
export class PreparedStatement {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The frame a node admits, once the proof holds under the pinned key of the statement's circuit.
     */
    frame(proof: Uint8Array): Uint8Array;
    /**
     * The bytes for the local prover. They hold secrets of the notes: they stay on this device, and
     * the worker that gets them wipes them.
     */
    proverInput(): Uint8Array;
    /**
     * What the statement does, as JSON: `kind`, `route`, `digest`, the amounts in atoms, its anchor
     * and last valid height, the notes or coins it spends.
     */
    summary(): string;
}

/**
 * A wallet's private notes, verified from its own trust root. It says what it needs from a node
 * and takes the answers as they come; see `crates/traidag/src/tsp2/wallet/scan_refresh.rs`.
 */
export class PrivateScan {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Verify a public owner authorization and select its owner address before registry lookup.
     */
    authorizationOwner(authorization_hex: string): string;
    beginNotePage(after: string | null | undefined, limit: number): void;
    /**
     * Where the record log goes on from, for `takeRecords`; nothing once the verified cut's log is
     * read.
     */
    beginRecords(addresses: string): void;
    beginSelection(amount: string, reserved: string): void;
    beginSources(leaves: string, checking: boolean): void;
    checkpointWritten(): void;
    /**
     * Whether saved bytes were given that did not open, so that everything is read again.
     */
    damaged(): boolean;
    inventoryChildren(tree: number, generation: string, id: string, bytes: Uint8Array): string;
    inventoryNext(): string;
    inventoryResult(): string;
    inventoryRoots(): string;
    inventoryWriteBytes(id: string): Uint8Array;
    inventoryWritten(id: string): void;
    localWriteBytes(): Uint8Array;
    localWritten(): void;
    mark(): Uint8Array;
    /**
     * `network` is the network's name. A test network names its genesis with `manifest`; mainnet
     * has its trust root in this build and refuses any other. `sealed` and `mark` are what the
     * last visit left.
     */
    constructor(root: WalletRoot, network: string, manifest: string | null | undefined, account: number, sealed?: Uint8Array | null, mark?: Uint8Array | null);
    /**
     * What the refresh needs next, as JSON with a `kind`; `done` when it is finished.
     */
    next(): string;
    /**
     * The node cannot prove the spends from there; every row must do.
     */
    notesRefused(): void;
    openSends(sealed: Uint8Array): Uint8Array;
    /**
     * Exact fee/change quote for selected sponsor coins. No funding inputs are signed.
     */
    planRegistration(root: WalletRoot, manifest: string, request: string): string;
    /**
     * An ENTER of the coins `request` names, signed with `root`: JSON with `coins`, `amount` and
     * optionally `to`. What the coins hold beyond the amount and the fee becomes a note of this
     * wallet.
     */
    prepareEnter(root: WalletRoot, manifest: string, request: string): PreparedStatement;
    /**
     * An EXIT: JSON with `to` and the leaves of one or two `notes`.
     */
    prepareExit(request: string): PreparedStatement;
    /**
     * Sign an explicitly fee-capped registration; persist the frame and input reservations
     * before publishing it to `/v1/private/registrations`.
     */
    prepareRegistration(root: WalletRoot, manifest: string, request: string): PreparedRegistration;
    /**
     * A transfer: JSON with `to`, `amount` and `reserved`.
     */
    prepareTransfer(request: string): PreparedStatement;
    privateAddress(): string;
    recordsFrom(): bigint | undefined;
    /**
     * Whether the account of `address`, or this wallet's without one, is registered at the verified
     * cut.
     */
    registered(address?: string | null): boolean;
    /**
     * Export this owner's non-spending authorization for a funded self or sponsored registration.
     */
    registration(): Uint8Array;
    /**
     * Validate a restored complete frame against its stored signed input amounts and fee cap.
     */
    registrationFrameInfo(frame_hex: string, metadata: string): string;
    registrationProofRequest(height: bigint): string;
    /**
     * Authenticated public registration head; this carries no private balance or note claim.
     */
    registrationVerifiedHead(): string;
    /**
     * The cut the mark names when the saved state is older than it.
     */
    rolledBackFrom(): bigint | undefined;
    scratchGeneration(): string | undefined;
    seal(): Uint8Array;
    /**
     * Seals the statements on their way under this account's key, for a store that keeps them as it
     * gets them.
     */
    sealSends(plaintext: Uint8Array): Uint8Array;
    /**
     * The node holds no rows from the start; its proofs must do.
     */
    spendKeysRefused(): void;
    spendProofRefused(): void;
    start(rescan: boolean): void;
    startHeadOnly(): void;
    /**
     * Canonical public identity and reservations of the original statement frame, as JSON.
     */
    statementFrameInfo(frame_hex: string): string;
    /**
     * The next bounded bridge request for an execution receipt at `height`, or `ready`.
     */
    statementProofRequest(height: bigint): string;
    /**
     * Whether an expired frame's exact nullifiers still belong to these verified unspent leaves.
     */
    statementSourcesUnspent(frame_hex: string, sources: string): boolean;
    /**
     * The balance and notes as JSON, only once a refresh ended at a verified cut.
     */
    summary(): string;
    takeAnchor(answer: string): void;
    takeBridge(answer: string): void;
    takeCutProof(answer: string): void;
    takeInventoryRead(id: string, bytes: Uint8Array): void;
    takeLocalRead(sealed: Uint8Array): void;
    takeNotes(answer: string): void;
    takeRecords(answer: string): void;
    takeRegistrationBridge(answer: string): void;
    takeSpendKeys(answer: string): void;
    takeSpendProof(answer: string): void;
    takeStatementBridge(answer: string): void;
    /**
     * The exact finalized head of a completed, verified refresh, as JSON.
     */
    verifiedHead(): string;
    /**
     * Authenticate the exact paid registration frame in a genuinely certified private batch.
     */
    verifyRegistrationExecution(frame_hex: string, metadata: string, proof_answer: string, cut_view: string, private_items: string): string;
    /**
     * Authenticates exact ENTER, TRANSFER or EXIT execution against a certified cut.
     */
    verifyStatementExecution(frame_hex: string, digest: string, _class: string, proof_answer: string, cut_view: string, private_items: string): string;
}

export class PublicCoinCache {
    free(): void;
    [Symbol.dispose](): void;
    bucket(point: string): string;
    hash(domain: string, bytes: Uint8Array): string;
    constructor(root: WalletRoot, network: string, manifest: string | null | undefined, account: number);
    open(sealed: Uint8Array): string;
    seal(checkpoint: string): Uint8Array;
    readonly chainId: string;
    readonly scope: string;
}

export class WalletRoot {
    free(): void;
    [Symbol.dispose](): void;
    acknowledgeFinalityState(network: string, manifest: string | null | undefined, sealed: Uint8Array): void;
    assertFinalitySafe(network: string, manifest?: string | null): void;
    derivePublicKey(account: string, branch: string, index: string): Uint8Array;
    finalityDirty(network: string, manifest?: string | null): boolean;
    finalityHalted(network: string, manifest?: string | null): boolean;
    finalityHeight(network: string, manifest?: string | null): bigint;
    finalityScope(network: string, manifest?: string | null): string;
    fingerprint(): string;
    /**
     * Accepts the request in transaction `request`; the transaction must spend a coin of the
     * address that request went to, or the requester ignores it.
     */
    messengerAccept(request: string, request_payload_hex: string, text: string): string;
    /**
     * Chats as JSON from `[{transaction, payload_hex, sent, inputs, to, height, time}]`; texts
     * still need the display check before they are shown.
     */
    messengerChats(observed: string): string;
    /**
     * The Messenger ID other wallets see in this wallet's chat requests.
     */
    messengerId(): string;
    /**
     * A message as payload hex in a chat object from `messengerChats`.
     */
    messengerMessage(chat: string, text: string): string;
    /**
     * A chat request as payload hex, sent with one atom; anyone can read the note.
     */
    messengerRequest(note: string): string;
    constructor(entropy: Uint8Array, passphrase: string);
    /**
     * Authenticates the exact record id and returns its plaintext; no key leaves this root.
     */
    openStoreRecord(network: string, manifest: string | null | undefined, account: number, record_id: string, sealed: Uint8Array): Uint8Array;
    /**
     * Answers an address proof request with the key at this path.
     */
    proveAddress(account: string, branch: string, index: string, request: string, now: string): string;
    restoreFinalityState(network: string, manifest: string | null | undefined, sealed: Uint8Array): void;
    sealFinalityState(network: string, manifest?: string | null): Uint8Array;
    /**
     * Encrypts one local record under this wallet and the requested network's trusted genesis.
     */
    sealStoreRecord(network: string, manifest: string | null | undefined, account: number, record_id: string, plaintext: Uint8Array): Uint8Array;
    /**
     * `purpose` is `spend`, `operation`, `possession`, or `validator`.
     */
    sign(account: string, branch: string, index: string, message: Uint8Array, purpose: string): Uint8Array;
    /**
     * Signs the announced key's proof for a Register or Rotate operation.
     */
    signPossession(account: string, branch: string, index: string, body_wire: Uint8Array, manifest: string): Uint8Array;
}

/**
 * Adds a complete, verified signature set from one threshold member.
 */
export function addMultisigPackageSignatures(_package: Uint8Array, reviewed_template: string, public_key: Uint8Array, signatures: string, manifest: string): Uint8Array;

export function addressFromPublicKey(public_key: Uint8Array, network: string): string;

/**
 * A proof request with a fresh random challenge for `address`, as JSON.
 */
export function addressProofRequest(address: string, expires_at: string): string;

/**
 * The six public verification words of an address on any network, separated by single spaces.
 */
export function addressVerificationWords(address: string): string;

export function apiVersion(): number;

export function assembleTransaction(body: Uint8Array, witnesses: Uint8Array, manifest: string): Uint8Array;

/**
 * The burn address of `network`: no key can spend what is paid to it, and the node removes it from supply.
 */
export function burnAddress(network: string): string;

/**
 * Combines two packages when they share the same immutable transaction template.
 */
export function combineMultisigPackages(left: Uint8Array, right: Uint8Array, manifest: string): Uint8Array;

/**
 * Returns the exact height-zero trust root compiled into this WASM build.
 *
 * This is not a post-launch checkpoint and it does not authenticate a remote
 * node's latest state. It is the local starting point for a later verified
 * finality path only.
 */
export function compiledMainnetGenesisFinalityBundle(): Uint8Array;

/**
 * Returns the fully authorized wire transaction after manifest and fee checks.
 *
 * Referenced threshold packages are verified with the descriptor's public keys locally. This
 * does not prove that those keys are finalized in the chain registry.
 */
export function completeMultisigPackage(_package: Uint8Array, manifest: string): Uint8Array;

export function createMultisigDescriptor(threshold: string, member_public_keys: string): string;

/**
 * Creates an inline-witness package for a transparent threshold payment.
 */
export function createMultisigPackage(descriptor: string, body: Uint8Array, input_amounts: string, manifest: string): Uint8Array;

export function createNativeLock(request: string, network: string): string;

/**
 * Validates a package and returns its canonical byte representation.
 */
export function decodeMultisigPackage(_package: Uint8Array, manifest: string): Uint8Array;

/**
 * The entries of a payload in the recipient layout as JSON, or `undefined` for an ordinary payload.
 */
export function decodeRecipientPayloads(payload_hex: string): string | undefined;

export function encodeMultisigInlineWitness(descriptor: string, signatures: string): Uint8Array;

export function encodeNativeWitness(descriptor_hex: string, branch: string, preimage_hex: string, public_key: Uint8Array, signature: Uint8Array): Uint8Array;

/**
 * One payload per recipient output in one transaction payload, `protocol/recipient-payloads-v1.md`;
 * `entries` is JSON `[{"output": 0, "payload_hex": "…"}]` with rising outputs, the result hex.
 */
export function encodeRecipientPayloads(entries: string): string;

export function encodeTransactionBody(request: string, manifest: string): Uint8Array;

export function encodeWitness(public_key: Uint8Array, signature: Uint8Array): Uint8Array;

/**
 * Encodes an inline or finalized-key-reference input witness.
 */
export function encodeWitnessWithProfile(profile: string, public_key: Uint8Array | null | undefined, signature: Uint8Array): Uint8Array;

export function formatAmount(atoms: string): string;

export function inspectNativeLock(descriptor_hex: string, network: string): string;

export function inspectTransaction(wire: Uint8Array, manifest: string): string;

export function inspectTransactionBody(body: Uint8Array, manifest: string): string;

/**
 * Messenger frames belong in a chat and are never shown as a payload.
 */
export function isMessengerPayload(payload_hex: string): boolean;

/**
 * The longest note, accept text and message text in bytes, as JSON.
 */
export function messengerLimits(): string;

export function mnemonicEntropy(phrase: string): Uint8Array;

export function mnemonicFromEntropy(entropy: Uint8Array): string;

export function mnemonicWordList(): string;

export function multisigAddress(descriptor: string, network: string): string;

/**
 * Returns one member's spend messages after binding them to a reviewed template digest.
 */
export function multisigPackageSigningMessages(_package: Uint8Array, reviewed_template: string, public_key: Uint8Array, manifest: string): string;

export function nativeHash(preimage: Uint8Array): string;

export function nativeLockAddress(descriptor_hex: string, network: string): string;

export function nativeLockSigningMessage(body: Uint8Array, input_index: string, previous_output: string, descriptor_hex: string, branch: string, preimage_hex: string, manifest: string): Uint8Array;

export function openWalletFile(sealed: Uint8Array, password: Uint8Array): Uint8Array;

export function operationMessage(body: Uint8Array, manifest: string): Uint8Array;

export function parseAddress(address: string, network: string): string;

export function parseAmount(amount: string): string;

/**
 * Accepts only an exact copy of this build's compiled height-zero trust root.
 *
 * It does not parse a peer-provided genesis into a new trust anchor. A later remote-finality API
 * must still verify its certified path.
 */
export function parseCompiledMainnetGenesisFinalityBundle(bytes: Uint8Array): Uint8Array;

export function parsePaymentUri(uri: string, network: string): string;

/**
 * Which coins an ENTER of `amount` atoms spends, as JSON: `inputs` (indices into the JSON list
 * `amounts`), `rest_atoms` and the values of its `notes`, or a `problem`.
 */
export function planPrivateEnter(amount: string, to_itself: boolean, amounts: string): string;

export function possessionMessage(body: Uint8Array, manifest: string): Uint8Array;

/**
 * What this build's prover and verifier run, as JSON, to compare with a node's private status: the
 * digests, the fee, the smallest note and how long a statement stays valid.
 */
export function privateRules(): string;

export function protocolProfile(): string;

export function quoteNativeTransaction(body: Uint8Array, conditions: string, manifest: string): string;

export function quoteTransaction(body: Uint8Array, manifest: string): string;

/**
 * Quotes a body with one profile for each canonical input.
 */
export function quoteTransactionWithInputProfiles(body: Uint8Array, input_profiles: string, manifest: string): string;

export function quoteTransactionWithWitnesses(body: Uint8Array, witnesses: Uint8Array, manifest: string): string;

/**
 * Checks exact planned input facts at a cut the caller authenticated independently.
 * Canonical selected records under a head the caller must independently authenticate.
 */
export function readFinalizedUtxoSelection(request: string, response: string, expected: string): string;

/**
 * Returns the immutable transaction facts that a threshold member must review.
 */
export function reviewMultisigPackage(_package: Uint8Array, manifest: string): string;

/**
 * Seals seed entropy into the wallet file the command-line wallet also uses.
 */
export function sealWalletFile(entropy: Uint8Array, password: Uint8Array): Uint8Array;

export function serviceIdentityForPublicKey(public_key: Uint8Array): Uint8Array;

export function spendMessage(body: Uint8Array, input_index: string, previous_output: string, manifest: string): Uint8Array;

export function transactionId(body: Uint8Array, manifest: string): string;

/**
 * Returns the manifest re-encoded after every consensus bound in it was checked.
 */
export function validateManifest(manifest: string): string;

export function validateMultisigDescriptor(descriptor: string): string;

/**
 * Checks an address proof and, given its request, that it answers that request; returns a
 * verdict whose `result` is `valid`, `malformed`, `wrong-request`, `not-single-key`,
 * `key-mismatch`, `expired` or `bad-signature`.
 */
export function verifyAddressProof(proof: string, request: string | null | undefined, now: string): string;

/**
 * Verifies a bounded presence/absence response against the caller-authenticated cut.
 */
export function verifyFinalizedUtxoPresence(request: string, response: string): void;

/**
 * Verifies live UTXO membership at a finalized anchor the caller must authenticate.
 */
export function verifyFinalizedUtxoProof(request: string, response: string): void;

export function verifyFinalizedUtxoSelection(request: string, response: string, expected: string): void;

export function verifyServiceResponse(public_key: Uint8Array, chain_id_hex: string, method: string, target: string, request_body: Uint8Array, status: number, response_body: Uint8Array, identity: Uint8Array, nonce: Uint8Array, tip_height: string, signature: Uint8Array): void;

export function verifyTransaction(wire: Uint8Array, previous_outputs: string, owner_address: string | null | undefined, manifest: string): void;

/**
 * Verifies referenced input witnesses against the supplied finalized keys.
 */
export function verifyTransactionWithReferencedKeys(wire: Uint8Array, previous_outputs: string, owner_address: string | null | undefined, referenced_public_keys: string, manifest: string): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_preparedregistration_free: (a: number, b: number) => void;
    readonly __wbg_preparedstatement_free: (a: number, b: number) => void;
    readonly __wbg_privatescan_free: (a: number, b: number) => void;
    readonly __wbg_publiccoincache_free: (a: number, b: number) => void;
    readonly __wbg_walletroot_free: (a: number, b: number) => void;
    readonly addMultisigPackageSignatures: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly addressFromPublicKey: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly addressProofRequest: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly addressVerificationWords: (a: number, b: number, c: number) => void;
    readonly apiVersion: () => number;
    readonly assembleTransaction: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly burnAddress: (a: number, b: number, c: number) => void;
    readonly combineMultisigPackages: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly compiledMainnetGenesisFinalityBundle: (a: number) => void;
    readonly completeMultisigPackage: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly createMultisigDescriptor: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly createMultisigPackage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly createNativeLock: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly decodeMultisigPackage: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly decodeRecipientPayloads: (a: number, b: number, c: number) => void;
    readonly encodeMultisigInlineWitness: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly encodeNativeWitness: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly encodeRecipientPayloads: (a: number, b: number, c: number) => void;
    readonly encodeTransactionBody: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly encodeWitness: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly encodeWitnessWithProfile: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly formatAmount: (a: number, b: number, c: number) => void;
    readonly inspectNativeLock: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly inspectTransaction: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly inspectTransactionBody: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly isMessengerPayload: (a: number, b: number) => number;
    readonly messengerLimits: (a: number) => void;
    readonly mnemonicEntropy: (a: number, b: number, c: number) => void;
    readonly mnemonicFromEntropy: (a: number, b: number, c: number) => void;
    readonly mnemonicWordList: (a: number) => void;
    readonly multisigAddress: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly multisigPackageSigningMessages: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly nativeHash: (a: number, b: number, c: number) => void;
    readonly nativeLockAddress: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly nativeLockSigningMessage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number) => void;
    readonly openWalletFile: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly operationMessage: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly parseAddress: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly parseAmount: (a: number, b: number, c: number) => void;
    readonly parseCompiledMainnetGenesisFinalityBundle: (a: number, b: number, c: number) => void;
    readonly parsePaymentUri: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly planPrivateEnter: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly possessionMessage: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly preparedregistration_frame: (a: number, b: number) => void;
    readonly preparedregistration_summary: (a: number, b: number) => void;
    readonly preparedstatement_frame: (a: number, b: number, c: number, d: number) => void;
    readonly preparedstatement_proverInput: (a: number) => number;
    readonly preparedstatement_summary: (a: number, b: number) => void;
    readonly privateRules: (a: number) => void;
    readonly privatescan_authorizationOwner: (a: number, b: number, c: number, d: number) => void;
    readonly privatescan_beginNotePage: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly privatescan_beginRecords: (a: number, b: number, c: number, d: number) => void;
    readonly privatescan_beginSelection: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly privatescan_beginSources: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly privatescan_checkpointWritten: (a: number, b: number) => void;
    readonly privatescan_damaged: (a: number) => number;
    readonly privatescan_inventoryChildren: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly privatescan_inventoryNext: (a: number, b: number) => void;
    readonly privatescan_inventoryResult: (a: number, b: number) => void;
    readonly privatescan_inventoryRoots: (a: number, b: number) => void;
    readonly privatescan_inventoryWriteBytes: (a: number, b: number, c: number, d: number) => void;
    readonly privatescan_inventoryWritten: (a: number, b: number, c: number, d: number) => void;
    readonly privatescan_localWriteBytes: (a: number, b: number) => void;
    readonly privatescan_localWritten: (a: number, b: number) => void;
    readonly privatescan_mark: (a: number, b: number) => void;
    readonly privatescan_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly privatescan_next: (a: number, b: number) => void;
    readonly privatescan_notesRefused: (a: number, b: number) => void;
    readonly privatescan_openSends: (a: number, b: number, c: number, d: number) => void;
    readonly privatescan_planRegistration: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly privatescan_prepareEnter: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly privatescan_prepareExit: (a: number, b: number, c: number, d: number) => void;
    readonly privatescan_prepareRegistration: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly privatescan_prepareTransfer: (a: number, b: number, c: number, d: number) => void;
    readonly privatescan_privateAddress: (a: number, b: number) => void;
    readonly privatescan_recordsFrom: (a: number, b: number) => void;
    readonly privatescan_registered: (a: number, b: number, c: number, d: number) => void;
    readonly privatescan_registration: (a: number, b: number) => void;
    readonly privatescan_registrationFrameInfo: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly privatescan_registrationProofRequest: (a: number, b: number, c: bigint) => void;
    readonly privatescan_registrationVerifiedHead: (a: number, b: number) => void;
    readonly privatescan_rolledBackFrom: (a: number, b: number) => void;
    readonly privatescan_scratchGeneration: (a: number, b: number) => void;
    readonly privatescan_seal: (a: number, b: number) => void;
    readonly privatescan_sealSends: (a: number, b: number, c: number, d: number) => void;
    readonly privatescan_spendKeysRefused: (a: number, b: number) => void;
    readonly privatescan_spendProofRefused: (a: number, b: number) => void;
    readonly privatescan_start: (a: number, b: number, c: number) => void;
    readonly privatescan_startHeadOnly: (a: number) => void;
    readonly privatescan_statementFrameInfo: (a: number, b: number, c: number, d: number) => void;
    readonly privatescan_statementProofRequest: (a: number, b: number, c: bigint) => void;
    readonly privatescan_statementSourcesUnspent: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly privatescan_summary: (a: number, b: number) => void;
    readonly privatescan_takeAnchor: (a: number, b: number, c: number, d: number) => void;
    readonly privatescan_takeBridge: (a: number, b: number, c: number, d: number) => void;
    readonly privatescan_takeCutProof: (a: number, b: number, c: number, d: number) => void;
    readonly privatescan_takeInventoryRead: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly privatescan_takeLocalRead: (a: number, b: number, c: number, d: number) => void;
    readonly privatescan_takeNotes: (a: number, b: number, c: number, d: number) => void;
    readonly privatescan_takeRecords: (a: number, b: number, c: number, d: number) => void;
    readonly privatescan_takeRegistrationBridge: (a: number, b: number, c: number, d: number) => void;
    readonly privatescan_takeSpendKeys: (a: number, b: number, c: number, d: number) => void;
    readonly privatescan_takeSpendProof: (a: number, b: number, c: number, d: number) => void;
    readonly privatescan_takeStatementBridge: (a: number, b: number, c: number, d: number) => void;
    readonly privatescan_verifiedHead: (a: number, b: number) => void;
    readonly privatescan_verifyRegistrationExecution: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
    readonly privatescan_verifyStatementExecution: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => void;
    readonly protocolProfile: (a: number) => void;
    readonly publiccoincache_bucket: (a: number, b: number, c: number, d: number) => void;
    readonly publiccoincache_chainId: (a: number, b: number) => void;
    readonly publiccoincache_hash: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly publiccoincache_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly publiccoincache_open: (a: number, b: number, c: number, d: number) => void;
    readonly publiccoincache_scope: (a: number, b: number) => void;
    readonly publiccoincache_seal: (a: number, b: number, c: number, d: number) => void;
    readonly quoteNativeTransaction: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly quoteTransaction: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly quoteTransactionWithInputProfiles: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly quoteTransactionWithWitnesses: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly readFinalizedUtxoSelection: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly reviewMultisigPackage: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly sealWalletFile: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly serviceIdentityForPublicKey: (a: number, b: number, c: number) => void;
    readonly spendMessage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly transactionId: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly validateManifest: (a: number, b: number, c: number) => void;
    readonly validateMultisigDescriptor: (a: number, b: number, c: number) => void;
    readonly verifyAddressProof: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly verifyFinalizedUtxoPresence: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly verifyFinalizedUtxoProof: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly verifyFinalizedUtxoSelection: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly verifyServiceResponse: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number) => void;
    readonly verifyTransaction: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly verifyTransactionWithReferencedKeys: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly walletroot_acknowledgeFinalityState: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly walletroot_assertFinalitySafe: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly walletroot_derivePublicKey: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly walletroot_finalityDirty: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly walletroot_finalityHalted: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly walletroot_finalityHeight: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly walletroot_finalityScope: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly walletroot_fingerprint: (a: number, b: number) => void;
    readonly walletroot_messengerAccept: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly walletroot_messengerChats: (a: number, b: number, c: number, d: number) => void;
    readonly walletroot_messengerId: (a: number, b: number) => void;
    readonly walletroot_messengerMessage: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly walletroot_messengerRequest: (a: number, b: number, c: number, d: number) => void;
    readonly walletroot_new: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly walletroot_openStoreRecord: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly walletroot_proveAddress: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
    readonly walletroot_restoreFinalityState: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly walletroot_sealFinalityState: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly walletroot_sealStoreRecord: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly walletroot_sign: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
    readonly walletroot_signPossession: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
    readonly __wbindgen_export: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
