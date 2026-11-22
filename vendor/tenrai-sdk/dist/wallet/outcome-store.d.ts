/** Durable account-scoped ciphertexts. The caller holds the same exclusive lease as its journals. */
export interface OutcomeStore {
    read(kind: OutcomeDomain, digest: string): Promise<Uint8Array | null>;
    /** Insert only. An existing different ciphertext must throw and remain intact. */
    write(kind: OutcomeDomain, digest: string, sealed: Uint8Array): Promise<void>;
    /** Lexicographic digest order; no more than 128 identities, without loading their frames. */
    page(kind: OutcomeDomain, after?: string, limit?: number): Promise<OutcomePage>;
    close?(): void;
}
export type OutcomeDomain = "public" | "private";
export interface OutcomePage {
    ids: string[];
    next: string | null;
}
export declare const MAX_OUTCOME_SEALED_BYTES: number;
export declare function outcomeIdentity(kind: OutcomeDomain, digest: string): void;
export declare function outcomeBytes(value: unknown): Uint8Array;
export declare function outcomeLimit(limit: number): void;
/** Immutable per-digest records survive rotation of the bounded active journal. */
export declare function indexedDbOutcomeStore(namespace: string): OutcomeStore;
