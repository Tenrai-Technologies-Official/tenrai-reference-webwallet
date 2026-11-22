import type { TenraiClient } from "../client.ts";
import type { CallOptions } from "../http.ts";
import type { Network } from "../types/common.ts";
import type { Bindings } from "./runtime.ts";
type Scan = InstanceType<Bindings["PrivateScan"]>;
/** A separate head-only context never replaces the note scan's authenticated balance. */
export declare function registrationContext(wasm: Bindings, root: InstanceType<Bindings["WalletRoot"]>, network: Network, account: number, genesis: string | undefined, client: TenraiClient, ownerAuthorization: string | undefined, call: CallOptions, existing?: Scan): Promise<Scan>;
export declare function registrationHeight(scan: Scan): number;
export declare function registrationHead(wasm: Bindings, root: InstanceType<Bindings["WalletRoot"]>, network: Network, account: number, genesis: string | undefined, client: TenraiClient, call: CallOptions, existing?: Scan): Promise<Scan>;
export declare const behindFinality: (error: unknown) => boolean;
export {};
