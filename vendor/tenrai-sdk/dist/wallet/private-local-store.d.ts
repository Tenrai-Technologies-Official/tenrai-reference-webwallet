/** Account-scoped encrypted scratch. Every successful write must be a durable commit. */
export interface PrivateLocalScanStore {
    read(generation: string, page: string): Promise<Uint8Array | null>;
    write(generation: string, page: string, sealed: Uint8Array): Promise<void>;
    clear(generation: string): Promise<void>;
    /** Only disposable recovery scratch in this account namespace; never live inventory or journals. */
    clearRecovery(): Promise<void>;
    /** Retain only the generation named by a durably saved checkpoint. */
    clearExcept(generation: string | null): Promise<void>;
    close?(): void;
}
/** The caller owns the account-session lease; plaintext note openings never reach this store. */
export declare function browserPrivateLocalScanStore(namespace: string): PrivateLocalScanStore;
