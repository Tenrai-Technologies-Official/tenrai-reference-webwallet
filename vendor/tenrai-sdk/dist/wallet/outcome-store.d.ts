/** Durable ciphertext archive under the account journal lease. */
export interface OutcomeStore {
    read(kind: OutcomeDomain, digest: string): Promise<Uint8Array | null>;
    /** Reject a different ciphertext for an existing digest. */
    write(kind: OutcomeDomain, digest: string, sealed: Uint8Array): Promise<void>;
    /** List up to 128 digests in lexicographic order without reading their frames. */
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
/** Keep final records after the active journal rotates. */
export declare function indexedDbOutcomeStore(namespace: string): OutcomeStore;
