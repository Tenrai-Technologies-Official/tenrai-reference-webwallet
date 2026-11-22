import type { TenraiClient } from "../client.ts";
import type { CompoundOptions, SentTransfer } from "./types.ts";
/** What `autoCompound` needs from a wallet. */
export interface Compounding {
    compound(client: TenraiClient, options?: CompoundOptions): Promise<SentTransfer[]>;
}
export interface AutoCompoundOptions extends CompoundOptions {
    /** Compound an address once it holds more than this many outputs; at least 2. Needed unless `atLeast` is set. */
    above?: number;
    /** Time between two checks; one minute by default, at least five seconds. */
    everyMillis?: number;
    /** Called with the transfers of every round that sent something. */
    onSent?: (transfers: SentTransfer[]) => void;
    /** Called when a round fails; the next round runs anyway. */
    onError?: (error: unknown) => void;
}
/** Compounds in the background every `everyMillis` by `above` or `atLeast`; returns the function that stops it. */
export declare function autoCompound(wallet: Compounding, client: TenraiClient, options: AutoCompoundOptions): () => void;
