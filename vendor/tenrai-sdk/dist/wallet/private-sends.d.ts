import { type OutcomeAnchor, type UnknownOutcome } from "./unknown-outcome.ts";
import type { RegistrationMetadata } from "./private-registration.ts";
import type { TenraiClient } from "../client.ts";
import type { PrivateNotesStore } from "./private-notes.ts";
import type { PrivateStoreSession } from "./private-store-session.ts";
export type PrivateKind = "enter" | "transfer" | "exit" | "private_register";
/** A proven statement on its way to a final cut. */
export interface PrivateSend {
    digest: string;
    kind: PrivateKind;
    route: "enters" | "transfers" | "exits" | "registrations";
    amountAtoms: string;
    feeAtoms: string;
    validUntil: number;
    /** The notes it spends, by their leaves. */
    sources: number[];
    /** The transparent outputs it spends, as `transactionId:outputIndex`. */
    inputs: string[];
    to: string | null;
    /** `sending` until a node is known to hold it. */
    stage: "sending" | "pool" | "needs_review";
    /** Write-ahead intent: this exact durable frame may already have reached a node. */
    attempted?: boolean;
    reviewReason?: string;
    /** When it was proven, in milliseconds since 1970. */
    time: number;
    /** Exact output commitments sealed to this account, including change. */
    ownNoteCommitments: string[];
    frameHex: string;
    registration?: RegistrationMetadata;
}
/** A finished private transaction, or a payment this wallet noticed among its new notes. */
export interface PrivateRecord {
    kind: PrivateKind | "received";
    amountAtoms: string;
    to: string | null;
    /** The final cut that ran it; for a payment the cut it was proven at. */
    height: number;
    time: number;
}
/** Seals the list under the account's key: it names amounts and recipients. */
export interface SendsSealer {
    sealSends(plaintext: Uint8Array): Uint8Array;
    openSends(sealed: Uint8Array): Uint8Array;
}
export type PrivateSendOutcome = {
    outcome: "final";
    send: PrivateSend;
    height: number;
} | {
    outcome: "expired";
    send: PrivateSend;
} | {
    outcome: "refused";
    send: PrivateSend;
    reason: unknown;
} | {
    outcome: "unknown";
    send: PrivateSend;
    closedAtHeight: number;
};
export interface PrivateSendEvidence {
    assertFinality?(entry: PrivateSend): Promise<void>;
    validate(entry: PrivateSend): void;
    sourcesUnspent(entry: PrivateSend): boolean | Promise<boolean>;
    pending(kind?: "private" | "registration"): {
        digest: string;
        height: number;
    } | undefined;
    snapshot(entry?: PrivateSend): {
        height: number;
        anchor?: OutcomeAnchor;
        notes?: readonly number[];
    };
    /** Resolves once no refresh holds the scan half read. */
    idle?(): Promise<void>;
    sourceCoverage?(entry: PrivateSend, signal: AbortSignal): Promise<{
        anchor: OutcomeAnchor;
        allUnspent: boolean;
    }>;
    execution(entry: PrivateSend, height: number, signal: AbortSignal): Promise<{
        digest: string;
        class: string;
        height: number;
        cut_id: string;
    }>;
    inputsUnspent(entry: PrivateSend, signal: AbortSignal): Promise<boolean>;
}
/** Keeps exact frames reserved until certified execution or proven unused expiry. */
export declare class PrivateSends {
    #private;
    private constructor();
    /** @internal */
    static open(client: TenraiClient, store: Pick<PrivateNotesStore, "read" | "write" | "outcomes">, sealer: SendsSealer, journal?: PrivateStoreSession): Promise<PrivateSends>;
    list(): PrivateSend[];
    /** @internal Evidence comes from the completed, independently verified private scan. */
    useEvidence(evidence: PrivateSendEvidence): void;
    /** @internal A bounded historical proof must finish before refresh resets its tracker. */
    pendingProof(): boolean;
    recent(): PrivateRecord[];
    /** A cold wallet establishes its certified global watermark without inventing old arrivals. */
    noteArrivalCursor(globalCursor: string): Promise<string | null>;
    /** Persists each bounded page before returning its newly observed payments. */
    noteArrivals(height: number, notes: {
        note: number | string;
        valueAtoms: bigint;
        noteCommitment: string;
    }[]): Promise<PrivateRecord[]>;
    /** A complete certified scan also retires own outputs already spent before this scan. */
    finishNoteArrivals(globalCursor: string, finalizedHeight: number): Promise<void>;
    reservedNotes(): number[];
    reservedInputs(): Set<string>;
    /** @internal Check before signing or starting a prover for a managed payment. */
    requireOutcomeStore(): void;
    /** Paged durable outcomes retain the original artifact without occupying active reservations. */
    unknown(digest: string): Promise<UnknownOutcome<PrivateSend> | null>;
    unknownPage(after?: string, limit?: number): Promise<{
        ids: string[];
        next: string | null;
    }>;
    /** @internal Keeps a proven statement, then hands it to the node. */
    send(entry: PrivateSend): Promise<PrivateSend>;
    /** Operator retry preserves the original digest, proof frame and reservations. */
    retry(digest: string): Promise<PrivateSend>;
    /** Asks about every statement on its way. `tip` is the newest final cut the wallet knows. */
    check(tip: number, registrationsOnly?: boolean): Promise<PrivateSendOutcome[]>;
    close(): Promise<void>;
}
