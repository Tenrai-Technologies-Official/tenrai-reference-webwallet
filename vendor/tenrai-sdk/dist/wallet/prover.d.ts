import { TenraiError } from "../errors.ts";
/** "exit" for a proof that pays notes out; "large" for an ENTER or a transfer, which take longer. */
export type ProofKind = "large" | "exit";
export type ProofFailureKind = "cancelled" | "memory" | "unavailable" | "failed";
/** Why there is no proof. Nothing was sent, and nothing a wallet holds is held by it. */
export declare class ProofFailure extends TenraiError {
    name: string;
    readonly kind: ProofFailureKind;
    constructor(kind: ProofFailureKind, message: string);
}
export interface ProofProgress {
    /** From 0 to 1, by the stages the proof has reached. */
    share: number;
    elapsedMillis: number;
}
export interface ProveOptions {
    /** Ends the proof at any time, with its worker or process and the secrets in it. */
    signal?: AbortSignal;
    onProgress?: (progress: ProofProgress) => void;
    /** Which stages the progress goes by; `PrivateNotes` names it. */
    kind?: ProofKind;
}
/** How long a proof takes, in seconds. */
export interface ProofEstimate {
    from: number;
    to: number;
    /** What to count down from. */
    expected: number;
    /** Whether it goes by a proof this device made before rather than by its threads. */
    measured: boolean;
}
/**
 * Makes the proof of a private statement on this device. The input holds secrets of the notes: it stays
 * here and the prover wipes it. Anything may implement this, and a wallet takes whichever fits it:
 * {@link browserProver} in a web page, {@link nativeProver} under Node, or {@link localProver} to choose.
 */
export interface PrivateProver {
    prove(input: Uint8Array, options?: ProveOptions): Promise<Uint8Array>;
}
export interface BrowserProverOptions {
    /** Where the page hosts the SDK's `prover` folder, with the headers its README names. */
    folder: URL | string;
    /** Threads of a proof, by default what the device has less one, at most eight; none takes the slower build. */
    threads?: number;
    /** Starts the worker, for a page under a Trusted Types policy; receives the URL of `worker.js`. */
    createWorker?: (url: URL) => Worker;
}
/** Threads for a proof in this page; a page without the isolation headers has none. */
export declare function proverThreads(scope?: {
    crossOriginIsolated?: boolean;
    navigator?: {
        hardwareConcurrency?: number;
    };
}): number;
/**
 * How long a proof of this kind takes here: by `lastSeconds`, what the last such proof took on this device, or
 * before there was one, by the threads it gets. A wallet keeps only that number, for the next estimate.
 */
export declare function proofEstimate(kind: ProofKind, options?: {
    native?: boolean;
    threads?: number;
    lastSeconds?: number;
}): ProofEstimate;
/** The prover in a Web Worker of this page, one worker per proof; ending it releases all it held. */
export declare function browserProver(options: BrowserProverOptions): PrivateProver;
/** The native prover `tenrai-tsp2-prove` as a child process, which gets its input through a pipe. */
export declare function nativeProver(options: {
    path: string;
}): PrivateProver;
/**
 * The prover that fits where this runs: a Web Worker in a page, the native program under Node. A wallet
 * never needs a server for it, and none is asked.
 */
export declare function localProver(options: {
    folder?: URL | string;
    path?: string;
    threads?: number;
}): PrivateProver;
