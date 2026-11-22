import { type OutcomeDomain, type OutcomeStore } from "./outcome-store.ts";
export interface OutcomeAnchor {
    height: number;
    cut_id: string;
    state_root: string;
    validator_set_id: string;
}
export interface UnknownOutcome<T> {
    format: 1;
    outcome: "unknown";
    domain: OutcomeDomain;
    digest: string;
    /** The current certified coverage, never the transaction's execution height. */
    closedAt: OutcomeAnchor;
    entry: T;
}
interface ExpiringArtifact {
    validUntil: number | string | bigint;
}
export interface OutcomeCodec {
    seal(id: string, plain: Uint8Array): Uint8Array | Promise<Uint8Array>;
    open(id: string, sealed: Uint8Array): Uint8Array | Promise<Uint8Array>;
}
export declare class UnknownOutcomeError extends Error {
    readonly outcome = "unknown";
    readonly digest: string;
    readonly closedAtHeight: number;
    constructor(digest: string, closedAtHeight: number);
}
export declare function outcomeAnchor(value: unknown): OutcomeAnchor;
/** Only the caller's verified coverage can authorize closing an active monetary hold. */
export declare class OutcomeArchive {
    #private;
    readonly store: OutcomeStore;
    readonly codec: OutcomeCodec;
    constructor(store: OutcomeStore, codec: OutcomeCodec);
    read<T extends ExpiringArtifact>(domain: OutcomeDomain, digest: string, validate: (entry: unknown) => T): Promise<UnknownOutcome<T> | null>;
    retain<T extends ExpiringArtifact>(domain: OutcomeDomain, digest: string, closedAt: OutcomeAnchor, entry: T, validate: (value: unknown) => T, same: (left: T, right: T) => boolean): Promise<UnknownOutcome<T>>;
}
export {};
