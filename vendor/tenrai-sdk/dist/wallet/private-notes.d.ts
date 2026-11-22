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
/** Where a wallet keeps what it knows of its private notes between its runs. */
export interface PrivateNotesStore {
    /** Stable identity of this durable account store, sharing its exclusive lease. */
    readonly id: string;
    inventoryPages?: PrivateInventoryStore;
    /** Durable paged ambiguous outcomes; required outside IndexedDB browsers. */
    outcomes?: OutcomeStore;
    /** Account-scoped durable encrypted scratch; required for full recovery outside IndexedDB browsers. */
    localPages?: PrivateLocalScanStore;
    /** Exclusive ownership across all instances using this account journal; fail immediately when already owned. No time-based expiry. */
    acquireSendsLease?(): Promise<{
        release(): void | Promise<void>;
    }>;
    /** What the last run left: the sealed state, kept apart from it if possible its mark, and the statements on their way. */
    /** For sends, null means absent; existing data that cannot be read must throw. */
    read(name: "state" | "mark" | "sends"): Promise<Uint8Array | null | undefined>;
    /** Resolving a sends write must mean durable commit, before the original frame may be submitted. */
    write(name: "state" | "mark" | "sends", bytes: Uint8Array): Promise<void>;
}
export interface PrivateNotesOptions {
    finalityStore?: FinalityGuardStore;
    store: PrivateNotesStore;
    /** Explicit durable public artifact record, sharing this store's account-session lease. */
    publicTransfers?: PublicTransfersStore;
    /** A test network's genesis manifest, as its trust root. Mainnet has its own in the protocol WASM. */
    genesisManifest?: string;
}
/** A coin an ENTER may spend, with the path of its key. */
export interface PrivateCoin {
    transactionId: string;
    outputIndex: number;
    amount: bigint;
    branch: string;
    index: number;
}
/** What stands in the way of spending here, or `ready`. */
export type PrivateUsability = "ready" | "inactive" | "other-rules" | "no-fit" | "review-open";
/** How a private statement is made. */
export interface PrivateProofOptions extends ProveOptions {
    /** The prover on this device; see `localProver`. */
    prover: PrivateProver;
}
export interface PrivateNote {
    /** The leaf of the note in the note log. */
    note: number;
    valueAtoms: bigint;
    noteCommitment: string;
}
export interface PrivateNotesResult {
    /** The finalized cut this result is proven against. */
    height: number;
    balanceAtoms: bigint;
    reservedAtoms: bigint;
    reservedNoteCount: bigint;
    /** At most 128 notes; use page() to continue the local inventory. */
    notes: PrivateNote[];
    noteCount: bigint;
    noteCursor: bigint;
    nextNote: number | null;
    /** Payments among the notes that are new since the last refresh; none on the first read. */
    received: PrivateRecord[];
}
/**
 * A wallet's private notes, checked rather than believed. Every head comes with a proof of finality
 * from the wallet's trust root, the notes must rebuild the note tree of that head and the spends its
 * nullifier set, so a node can neither invent a head nor hide a note or a spend. All of it runs in
 * the protocol WASM, by the rules the command-line wallet runs by; this class only carries the bytes.
 * What it learned stays sealed in the store under the account's key, and the next refresh reads only
 * what is new.
 */
export declare class PrivateNotes {
    #private;
    private constructor();
    /** @internal */
    static open(wasm: Bindings, root: InstanceType<Bindings["WalletRoot"]>, network: Network, account: number, client: TenraiClient, options: PrivateNotesOptions, coins?: () => Promise<PrivateCoin[]>, resolved?: (digest: string) => void, existingJournal?: PrivateStoreSession): Promise<PrivateNotes>;
    /** Whether this scan has released its keys. Pending ENTER holds remain available. */
    get isClosed(): boolean;
    /** This account's private address. */
    get address(): string;
    /** Whether saved bytes were found that did not open: they were dropped and everything is read again. */
    get savedStateDamaged(): boolean;
    /**
     * The cut this wallet had verified when it last wrote, if the saved state is older than that: an
     * older copy was put back. The refresh proves its way forward from it all the same, and refuses a
     * node behind that cut.
     */
    get rolledBackFrom(): number | undefined;
    /**
     * Reads what is new from the node, proves it and saves it. `rescan` forgets the notes first and
     * reads the whole history, from the compact recovery log retained by full and pruned nodes. Throws when the node does not lead
     * to a finalized state; nothing it served then counts.
     */
    refresh(options?: {
        rescan?: boolean;
    } & CallOptions): Promise<PrivateNotesResult>;
    /** Reads at most 128 already verified notes from this device; it makes no owned-note network query. */
    page(options?: {
        after?: number;
        limit?: number;
    } & CallOptions): Promise<{
        notes: PrivateNote[];
        nextNote: number | null;
    }>;
    /** Whether the account of `address`, or this wallet's without one, is registered at the cut the last refresh verified. */
    registered(address?: string, options?: CallOptions): Promise<boolean>;
    /** Exports owner authorization only. This does not spend coins or publish a registration. */
    registrationAuthorization(): Promise<Uint8Array>;
    /** Checks this owner from a separate head-only context before any note recovery. */
    registrationStatus(options?: CallOptions): Promise<boolean>;
    /** Quotes selected public inputs, exact fee, change and validity before any sponsor signature. */
    planRegistration(request: PrivateRegistrationRequest, options?: CallOptions): Promise<PrivateRegistrationQuote>;
    /** Discards an unsigned quote and frees its separate verification context. */
    cancelRegistration(quote: PrivateRegistrationQuote): void;
    /** Signs only a quote issued by this session, durably records it and posts the complete frame. */
    register(quote: PrivateRegistrationQuote): Promise<PrivateSend>;
    /**
     * What stands in the way of spending here: the node's rules must be this build's, and on mainnet the
     * review done.
     */
    usability(): Promise<PrivateUsability>;
    /**
     * Moves transparent coins into private notes: `amount` atoms to `to`, this wallet without one. What the
     * coins hold beyond the amount and the fee becomes a note of this wallet.
     */
    enter(request: {
        amount: bigint;
        to?: string;
    }, options: PrivateProofOptions): Promise<PrivateSend>;
    /** Sends `amount` atoms from two notes of this wallet to a private address; the rest comes back as a note. */
    transfer(request: {
        to: string;
        amount: bigint;
    }, options: PrivateProofOptions): Promise<PrivateSend>;
    /** Pays one or two whole notes out to a transparent address, less the fee. */
    exit(request: {
        to: string;
        notes: number[];
    }, options: PrivateProofOptions): Promise<PrivateSend>;
    /** The statements on their way, which hold their notes and coins. */
    onTheWay(): PrivateSend[];
    /** The newest finished transactions and received payments this wallet saw, newest first. */
    recent(): PrivateRecord[];
    /**
     * Asks about the statements on their way, given the newest final cut: sends again what no node knows
     * while it is valid, and tells what became final, expired or was refused.
     */
    check(tip: number): Promise<PrivateSendOutcome[]>;
    /** Reconciles public registration funding while the independent note recovery is incomplete. */
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
