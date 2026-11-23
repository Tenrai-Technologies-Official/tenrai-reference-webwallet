/** Durable encrypted recovery scratch scoped to one account. */
export interface PrivateLocalScanStore {
    read(generation: string, page: string): Promise<Uint8Array | null>;
    write(generation: string, page: string, sealed: Uint8Array): Promise<void>;
    clear(generation: string): Promise<void>;
    /** Clear disposable recovery scratch in this account. */
    clearRecovery(): Promise<void>;
    /** Retain the generation named by a durably committed checkpoint. */
    clearExcept(generation: string | null): Promise<void>;
    close?(): void;
}
/** Store ciphertexts while the caller holds the account lease. */
export declare function browserPrivateLocalScanStore(namespace: string): PrivateLocalScanStore;
