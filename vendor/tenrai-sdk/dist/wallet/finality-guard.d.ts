import type { Network } from "../types/common.ts";
import type { Bindings } from "./runtime.ts";
import type { FinalityGuardStore } from "./finality-guard-store.ts";
type Root = InstanceType<Bindings["WalletRoot"]>;
export type FinalityProof = <T>(verify: (height: bigint) => T | Promise<T>) => Promise<T>;
export declare function attachFinalityGuard(root: Root, store?: FinalityGuardStore): void;
/** Fetch first: only bounded Rust proof verification and durable ACK hold the global lease. */
export declare function withFinalityProof<T>(root: Root, network: Network, manifest: string | undefined, verify: (height: bigint) => T | Promise<T>): Promise<T>;
export declare function closeFinalityGuard(root: Root): Promise<void>;
export {};
