import type { TenraiClient } from "../client.ts";
import type { Desk } from "./context.ts";
import type { CompoundOptions, FeeOptions, MergeOptions, SendRequest, SentTransfer, SweepRequest } from "./types.ts";
export declare function maxSendable(desk: Desk, client: TenraiClient, request?: FeeOptions & {
    to?: string;
    payload?: string | Uint8Array;
}): Promise<bigint>;
export declare function mergeFor(desk: Desk, client: TenraiClient, request: SendRequest, options?: MergeOptions): Promise<SentTransfer[]>;
export declare function sweep(desk: Desk, client: TenraiClient, request: SweepRequest): Promise<SentTransfer[]>;
export declare function compound(desk: Desk, client: TenraiClient, options?: CompoundOptions): Promise<SentTransfer[]>;
