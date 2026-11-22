export interface PrivateInventoryRoot {
    readonly tree: 1 | 2 | 3 | 4;
    readonly generation: string;
    readonly id: string;
}
export interface PrivateInventoryStore {
    read(id: string): Promise<Uint8Array | null>;
    usage(): Promise<{
        objects: string;
        sealedBytes: string;
        collecting: boolean;
    }>;
    write(id: string, sealed: Uint8Array): Promise<void>;
    beginCollection(token: string, roots: readonly PrivateInventoryRoot[]): Promise<void>;
    pendingCollection(): Promise<readonly PrivateInventoryRoot[]>;
    markCollection(root: PrivateInventoryRoot, children: readonly string[]): Promise<void>;
    sweepCollection(token: string): Promise<boolean>;
    close(): void;
}
/** Ciphertexts only. Callers hold the account session lease across manifest I/O and collection. */
export declare function indexedDbPrivateInventoryStore(namespace: string): PrivateInventoryStore;
