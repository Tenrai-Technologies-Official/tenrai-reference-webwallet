import type { FinalityGuardStore } from "./finality-guard-store.ts";
import type { OutcomeStore } from "./outcome-store.ts";
import { type PrivateInventoryStore } from "./private-inventory-store.ts";
import { type PrivateLocalScanStore } from "./private-local-store.ts";
import type { TenraiClient } from "../client.ts";
import type { CallOptions } from "../http.ts";
import type { Network } from "../types/common.ts";
import { type PrivateRecord, type PrivateSend, type PrivateSendOutcome } from "./private-sends.ts";
import type { PrivateProver, ProveOptions } from "./prover.ts";
import type { Bindings } from "./runtime.ts";
import { PrivateStoreSession } from "./private-store-session.ts";
import type { PublicTransfersStore } from "./public-transfer-journal.ts";
import { type PrivateRegistrationQuote, type PrivateRegistrationRequest } from "./private-registration.ts";
/** Account storage used by private notes and retained transfers. */
export interface PrivateNotesStore {
    /** Stable account identity for the shared exclusive lease. */
    readonly id: string;
    inventoryPages?: PrivateInventoryStore;
    /** Durable outcome archive for adapters without an IndexedDB provider. */
    outcomes?: OutcomeStore;
    /** Encrypted recovery scratch for adapters without an IndexedDB provider. */
    localPages?: PrivateLocalScanStore;
    /** Fail if the account lease is already held. The lease has no time-based expiry. */
    acquireSendsLease?(): Promise<{
        release(): void | Promise<void>;
    }>;
    /** Load a sealed record. Return null for absent sends and throw for unreadable sends. */
    read(name: "state" | "mark" | "sends"): Promise<Uint8Array | null | undefined>;
    /** Resolve only when the sealed record has durably committed. */
    write(name: "state" | "mark" | "sends", bytes: Uint8Array): Promise<void>;
}
export interface PrivateNotesOptions {
    finalityStore?: FinalityGuardStore;
    store: PrivateNotesStore;
    /** Public transaction journal sharing the account lease. */
    publicTransfers?: PublicTransfersStore;
    /** Local genesis manifest for networks without a built-in trust root. */
    genesisManifest?: string;
}
/** Public input and derivation path for an ENTER. */
export interface PrivateCoin {
    transactionId: string;
    outputIndex: number;
    amount: bigint;
    branch: string;
    index: number;
}
export type PrivateUsability = "ready" | "inactive" | "other-rules" | "no-fit" | "review-open";
export interface PrivateProofOptions extends ProveOptions {
    /** Device-local prover. See `localProver`. */
    prover: PrivateProver;
}
export interface PrivateNote {
    /** Leaf index in the note log. */
    note: number;
    valueAtoms: bigint;
    noteCommitment: string;
}
export interface PrivateNotesResult {
    /** Verified finalized cut for this result. */
    height: number;
    balanceAtoms: bigint;
    reservedAtoms: bigint;
    reservedNoteCount: bigint;
    /** First page of up to 128 notes. Use `page` to continue. */
    notes: PrivateNote[];
    noteCount: bigint;
    noteCursor: bigint;
    nextNote: number | null;
    /** New payments since the previous refresh. The initial scan returns none. */
    received: PrivateRecord[];
}
/**
 * Verify the finalized head and rebuild the note and nullifier roots in WASM.
 * Keep the verified scan state sealed under the account key for incremental refresh.
 */
export declare class PrivateNotes {
    #private;
    private constructor();
    /** @internal */
    static open(wasm: Bindings, root: InstanceType<Bindings["WalletRoot"]>, network: Network, account: number, client: TenraiClient, options: PrivateNotesOptions, coins?: () => Promise<PrivateCoin[]>, resolved?: (digest: string) => void, existingJournal?: PrivateStoreSession): Promise<PrivateNotes>;
    /** True after the scan releases its keys. Pending ENTER holds remain available. */
    get isClosed(): boolean;
    get address(): string;
    /** True when unreadable scan state was discarded for recovery. */
    get savedStateDamaged(): boolean;
    /** Rollback marker. Recovery verifies forward and requires a head at least this recent. */
    get rolledBackFrom(): number | undefined;
    /**
     * Verify and save new chain data. `rescan` replays the compact recovery log.
     * Publish the result only after verifying the finalized state.
     */
    refresh(options?: {
        rescan?: boolean;
    } & CallOptions): Promise<PrivateNotesResult>;
    /** Read up to 128 verified notes from local storage. */
    page(options?: {
        after?: number;
        limit?: number;
    } & CallOptions): Promise<{
        notes: PrivateNote[];
        nextNote: number | null;
    }>;
    /** Check recipient registration at the last verified cut. Defaults to this account. */
    registered(address?: string, options?: CallOptions): Promise<boolean>;
    /** Export owner authorization without funding or publishing a registration. */
    registrationAuthorization(): Promise<Uint8Array>;
    /** Check registration using a separate finality context. */
    registrationStatus(options?: CallOptions): Promise<boolean>;
    /** Quote public inputs, fee, change and validity before sponsor signing. */
    planRegistration(request: PrivateRegistrationRequest, options?: CallOptions): Promise<PrivateRegistrationQuote>;
    /** Discard the quote and release its verification context. */
    cancelRegistration(quote: PrivateRegistrationQuote): void;
    /** Sign the issued quote, commit its original frame and submit it. */
    register(quote: PrivateRegistrationQuote): Promise<PrivateSend>;
    /** Check the node rules and security qualification for private spending. */
    usability(): Promise<PrivateUsability>;
    /** Move public coins into notes, with any change returning to this account. */
    enter(request: {
        amount: bigint;
        to?: string;
    }, options: PrivateProofOptions): Promise<PrivateSend>;
    /** Send from two owned notes and return private change to this account. */
    transfer(request: {
        to: string;
        amount: bigint;
    }, options: PrivateProofOptions): Promise<PrivateSend>;
    /** Exit one or two notes to a public address after fees. */
    exit(request: {
        to: string;
        notes: number[];
    }, options: PrivateProofOptions): Promise<PrivateSend>;
    /** Retained statements and their input holds. */
    onTheWay(): PrivateSend[];
    /** Settled transactions and received payments, newest first. */
    recent(): PrivateRecord[];
    /** Reconcile retained statements at the latest verified cut and retry executable originals. */
    check(tip: number): Promise<PrivateSendOutcome[]>;
    /** Reconcile registration funding independently of note recovery. */
    checkRegistrations(): Promise<PrivateSendOutcome[]>;
    /** Ambiguous outcomes remain queryable after their expired active holds are closed. */
    unknownOutcome(digest: string): Promise<import("./unknown-outcome.ts").UnknownOutcome<PrivateSend> | null>;
    unknownOutcomes(options?: {
        after?: string;
        limit?: number;
    }): Promise<{
        ids: string[];
        next: string | null;
    }>;
    /** Retries a reviewed statement with the original stored proof and digest. */
    retry(digest: string): Promise<PrivateSend>;
    /** Whether a statement on its way spends this transparent output, named `transactionId:outputIndex`. */
    /** Bounded retained/proving public input IDs for indexed balance selection. */
    heldCoinKeys(): ReadonlySet<string>;
    holdsCoin(outpoint: string): boolean;
    /** Frees scan keys; executable pending ENTER frames retain their public outpoint holds. */
    close(): Promise<void>;
}
