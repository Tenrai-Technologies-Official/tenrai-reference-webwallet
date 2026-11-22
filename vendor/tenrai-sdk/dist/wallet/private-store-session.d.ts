import type { PrivateNotesStore } from "./private-notes.ts";
/** Owns one provider's cross-instance lease, including writes/POSTs already started at close. */
export declare class PrivateStoreSession {
    #private;
    readonly store: PrivateNotesStore;
    readonly closed: Promise<void>;
    private constructor();
    static acquire(store: PrivateNotesStore): Promise<PrivateStoreSession>;
    get signal(): AbortSignal;
    assertOpen(): void;
    run<T>(work: () => Promise<T>): Promise<T>;
    drained(): Promise<void>;
    close(): void;
}
