var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { TenraiError } from "../errors.js";
import { PROVER_FILES } from "./prover-pins.js";
const NODE_CHILD_PROCESS = "node:child_process";
const PLAIN_WASM = "plain/tenrai_tsp2_prover_wasm_bg.wasm";
const THREADS_WASM = "threads/tenrai_tsp2_prover_wasm_threads_bg.wasm";
/** One core stays free for the page; above this the proof's hash search gains little. */
const MOST_THREADS = 8;
/** A worker that has not begun by then did not get its threads, which it cannot tell by itself. */
const START_MILLIS = 60_000;
/** A statement stays valid for 15 minutes; a proof that takes longer than this would come too late. */
const PROOF_MILLIS = 12 * 60_000;
/** How far a proof has come when it reaches a stage, by proofs measured in browsers. */
const STAGE_SHARES = {
    large: {
        started: 0.01,
        "Preprocessed columns": 0.04,
        "Base columns": 0.09,
        "LogUp columns": 0.17,
        Composition: 0.25,
        "Evaluate columns out of domain": 0.38,
        "Compute FRI quotients": 0.49,
        "Commit FRI layers": 0.52,
        "Decommit trace trees": 0.99,
    },
    exit: {
        started: 0.02,
        "Preprocessed columns": 0.08,
        "Base columns": 0.11,
        "LogUp columns": 0.2,
        Composition: 0.26,
        "Evaluate columns out of domain": 0.43,
        "Compute FRI quotients": 0.73,
        "Commit FRI layers": 0.77,
        "Decommit trace trees": 0.96,
    },
};
/**
 * Seconds a proof takes, by the threads it gets at least: from proofs measured in Chrome and Firefox on a desktop
 * of six cores. A slower device takes longer, which the ranges and then its own last proof allow for.
 */
const BROWSER_SECONDS = {
    large: [[7, 30, 60], [4, 30, 90], [2, 60, 150], [1, 120, 300], [0, 120, 360]],
    exit: [[7, 10, 30], [4, 10, 40], [2, 20, 60], [1, 40, 120], [0, 60, 180]],
};
const NATIVE_SECONDS = { large: [10, 30], exit: [5, 15] };
/** Why there is no proof. Nothing was sent, and nothing a wallet holds is held by it. */
export class ProofFailure extends TenraiError {
    name = "ProofFailure";
    kind;
    constructor(kind, message) {
        super(message);
        this.kind = kind;
    }
}
function hex(bytes) {
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
/** The worker's scripts must be the reviewed ones; it checks the module itself. */
async function checkScripts(folder) {
    const scripts = Object.keys(PROVER_FILES).filter((file) => file.endsWith(".js"));
    await Promise.all(scripts.map(async (file) => {
        const response = await fetch(new URL(file, folder), { cache: "no-cache" });
        const digest = response.ok ? hex(await crypto.subtle.digest("SHA-256", await response.arrayBuffer())) : "";
        if (digest !== PROVER_FILES[file]) {
            throw new ProofFailure("unavailable", `the prover file ${file} is not the reviewed one`);
        }
    }));
}
/** Threads for a proof in this page; a page without the isolation headers has none. */
export function proverThreads(scope = globalThis) {
    if (!scope.crossOriginIsolated)
        return 0;
    return Math.max(1, Math.min(MOST_THREADS, (scope.navigator?.hardwareConcurrency ?? 2) - 1));
}
/**
 * How long a proof of this kind takes here: by `lastSeconds`, what the last such proof took on this device, or
 * before there was one, by the threads it gets. A wallet keeps only that number, for the next estimate.
 */
export function proofEstimate(kind, options = {}) {
    const last = options.lastSeconds;
    if (last !== undefined && Number.isFinite(last) && last > 0)
        return { from: last * 0.8, to: last * 1.25, expected: last, measured: true };
    const threads = options.threads ?? proverThreads();
    const [from, to] = options.native
        ? NATIVE_SECONDS[kind]
        : BROWSER_SECONDS[kind].find(([least]) => threads >= least).slice(1);
    return { from: from, to: to, expected: (from + to) / 2, measured: false };
}
function failureOf(text, notes) {
    const all = [text, ...notes].join(" ");
    if (/memory free|could not allocate|out of memory|WebAssembly\.Memory|Memory\(\)/i.test(all)) {
        return new ProofFailure("memory", "this device or browser has too little free memory for the proof, up to about 3.5 GiB");
    }
    return new ProofFailure("failed", `the proof could not be made: ${text}`);
}
/** The prover in a Web Worker of this page, one worker per proof; ending it releases all it held. */
export function browserProver(options) {
    const folder = new URL(options.folder, globalThis.location?.href);
    const start = options.createWorker ?? ((url) => new Worker(url, { type: "module" }));
    return {
        async prove(input, { signal, onProgress, kind = "large" } = {}) {
            try {
                if (signal?.aborted)
                    throw new ProofFailure("cancelled", "the proof was cancelled");
                await checkScripts(folder);
                if (signal?.aborted)
                    throw new ProofFailure("cancelled", "the proof was cancelled");
            }
            catch (error) {
                input.fill(0);
                throw error;
            }
            return new Promise((resolve, reject) => {
                const began = Date.now();
                const notes = [];
                const timers = [];
                let worker;
                const finish = (settle, value) => {
                    for (const timer of timers)
                        clearTimeout(timer);
                    signal?.removeEventListener("abort", cancel);
                    worker?.terminate();
                    if (input.buffer.byteLength)
                        input.fill(0);
                    settle(value);
                };
                const cancel = () => finish(reject, new ProofFailure("cancelled", "the proof was cancelled"));
                signal?.addEventListener("abort", cancel, { once: true });
                try {
                    worker = start(new URL("worker.js", folder));
                }
                catch (error) {
                    finish(reject, new ProofFailure("unavailable", `the prover cannot start here: ${String(error)}`));
                    return;
                }
                const startTimer = setTimeout(() => finish(reject, new ProofFailure("unavailable", "the prover did not start; this browser or site may not allow it")), START_MILLIS);
                timers.push(startTimer);
                timers.push(setTimeout(() => finish(reject, new ProofFailure("failed", "the proof took too long for its statement to stay valid")), PROOF_MILLIS));
                worker.onmessage = ({ data }) => {
                    if (data.note) {
                        notes.push(data.note);
                    }
                    else if (data.stage) {
                        if (data.stage === "started")
                            clearTimeout(startTimer);
                        const share = STAGE_SHARES[kind][data.stage];
                        if (share !== undefined)
                            onProgress?.({ share, elapsedMillis: Date.now() - began });
                    }
                    else if (data.proof) {
                        finish(resolve, new Uint8Array(data.proof));
                    }
                    else {
                        finish(reject, failureOf(String(data.failed ?? ""), notes));
                    }
                };
                worker.onerror = (event) => finish(reject, failureOf(event.message || "the prover stopped", notes));
                worker.postMessage({
                    input: input.buffer,
                    threads: options.threads ?? proverThreads(),
                    sha256: { plain: PROVER_FILES[PLAIN_WASM], threads: PROVER_FILES[THREADS_WASM] },
                }, [input.buffer]);
            });
        },
    };
}
function joined(chunks) {
    const all = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let at = 0;
    for (const chunk of chunks) {
        all.set(chunk, at);
        at += chunk.length;
    }
    return all;
}
/** The native prover `tenrai-tsp2-prove` as a child process, which gets its input through a pipe. */
export function nativeProver(options) {
    return {
        async prove(input, { signal } = {}) {
            const { spawn } = (await import(__rewriteRelativeImportExtension(/* @vite-ignore */ NODE_CHILD_PROCESS)));
            return new Promise((resolve, reject) => {
                if (signal?.aborted) {
                    input.fill(0);
                    reject(new ProofFailure("cancelled", "the proof was cancelled"));
                    return;
                }
                const output = [];
                const errors = [];
                const child = spawn(options.path, [], { stdio: ["pipe", "pipe", "pipe"] });
                const cancel = () => child.kill();
                signal?.addEventListener("abort", cancel, { once: true });
                child.stdout.on("data", (chunk) => output.push(chunk));
                child.stderr.on("data", (chunk) => errors.push(chunk));
                child.on("error", (error) => {
                    signal?.removeEventListener("abort", cancel);
                    input.fill(0);
                    reject(new ProofFailure("unavailable", `the prover ${options.path} does not start: ${error.message}`));
                });
                child.on("close", (code) => {
                    signal?.removeEventListener("abort", cancel);
                    input.fill(0);
                    if (signal?.aborted)
                        reject(new ProofFailure("cancelled", "the proof was cancelled"));
                    else if (code === 0)
                        resolve(joined(output));
                    else
                        reject(failureOf(new TextDecoder().decode(joined(errors)).trim() || `the prover ended with ${code}`, []));
                });
                child.stdin.end(input);
            });
        },
    };
}
/**
 * The prover that fits where this runs: a Web Worker in a page, the native program under Node. A wallet
 * never needs a server for it, and none is asked.
 */
export function localProver(options) {
    if (typeof Worker === "function" && options.folder !== undefined) {
        return browserProver({ folder: options.folder, ...(options.threads === undefined ? {} : { threads: options.threads }) });
    }
    if (options.path !== undefined)
        return nativeProver({ path: options.path });
    throw new ProofFailure("unavailable", "name the hosted prover folder in a page, or the native prover under Node");
}
