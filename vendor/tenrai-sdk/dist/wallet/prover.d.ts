import { TenraiError } from "../errors.ts";
export type ProofKind = "large" | "exit";
export type ProofFailureKind = "cancelled" | "memory" | "unavailable" | "failed";
/** Local proving ended before submission. */
export declare class ProofFailure extends TenraiError {
    name: string;
    readonly kind: ProofFailureKind;
    constructor(kind: ProofFailureKind, message: string);
}
export interface ProofProgress {
    /** Fraction complete, from zero to one. */
    share: number;
    elapsedMillis: number;
}
export interface ProveOptions {
    /** Cancel the local worker or process. */
    signal?: AbortSignal;
    onProgress?: (progress: ProofProgress) => void;
    /** Circuit class used to estimate progress. */
    kind?: ProofKind;
}
/** Estimated proof duration in seconds. */
export interface ProofEstimate {
    from: number;
    to: number;
    expected: number;
    /** True when based on a previous proof on this device. */
    measured: boolean;
}
/**
 * Generate a proof locally. Keep note secrets on the device and wipe input after use.
 * Use {@link browserProver} in a browser or {@link nativeProver} in Node.js.
 */
export interface PrivateProver {
    prove(input: Uint8Array, options?: ProveOptions): Promise<Uint8Array>;
}
export interface BrowserProverOptions {
    /** Base URL of the packaged browser prover assets. */
    folder: URL | string;
    /** Number of worker threads. Defaults to available cores minus one, capped at eight. */
    threads?: number;
    /** Worker factory for apps using a Trusted Types policy. */
    createWorker?: (url: URL) => Worker;
}
/** Threaded proving requires cross-origin isolation. */
export declare function proverThreads(scope?: {
    crossOriginIsolated?: boolean;
    navigator?: {
        hardwareConcurrency?: number;
    };
}): number;
/** Estimate proving time from a prior local run or the available threads. */
export declare function proofEstimate(kind: ProofKind, options?: {
    native?: boolean;
    threads?: number;
    lastSeconds?: number;
}): ProofEstimate;
/** Run each browser proof in its own worker. */
export declare function browserProver(options: BrowserProverOptions): PrivateProver;
/** Pass proof input to `tenrai-tsp2-prove` over a local pipe. */
export declare function nativeProver(options: {
    path: string;
}): PrivateProver;
/** Select the local browser worker or native process. */
export declare function localProver(options: {
    folder?: URL | string;
    path?: string;
    threads?: number;
}): PrivateProver;
