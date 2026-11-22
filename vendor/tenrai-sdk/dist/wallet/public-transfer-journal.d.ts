import { type OutcomeAnchor } from "./unknown-outcome.ts";
import type { Network } from "../types/common.ts";
import type { Bindings } from "./runtime.ts";
import type { OpenTransfer } from "./wallet.ts";
import type { PrivateStoreSession } from "./private-store-session.ts";
/** Shares the account-session lease with private state; resolve writes only after strict durable commit. */
export interface PublicTransfersStore {
    readonly chainId: string;
    read(): Promise<Uint8Array | null | undefined>;
    write(bytes: Uint8Array): Promise<void>;
    /** Checks explicitly configured earlier journals before accepting a genuinely absent public record. */
    checkAbsent?(): Promise<void>;
    exportRecovery?(): Promise<Uint8Array>;
    /** Records successful authentication in an independent presence marker, when the provider supports one. */
    markPresent?(): Promise<void>;
}
/** Native canonical codecs bind the exact original chain, TXID, inputs and validity. */
export declare function validatePublicTransfer(wasm: Bindings, network: Network, value: unknown, chainId?: string): OpenTransfer;
export declare class PublicTransferJournal {
    #private;
    constructor(wasm: Bindings, root: unknown, owner: {
        network: Network;
        manifest: string | undefined;
        account: number;
    }, source: PublicTransfersStore, session: PrivateStoreSession);
    get chainId(): string;
    /** @internal Managed submission cannot bypass an unavailable ambiguity fence. */
    requireOutcomeStore(): void;
    unknown(transactionId: string): Promise<import("./unknown-outcome.ts").UnknownOutcome<OpenTransfer> | null>;
    unknownPage(after?: string, limit?: number): Promise<import("./outcome-store.ts").OutcomePage>;
    retainUnknown(entry: OpenTransfer, anchor: OutcomeAnchor): Promise<void>;
    restore(): Promise<OpenTransfer[]>;
    save(entries: readonly OpenTransfer[]): Promise<void>;
}
