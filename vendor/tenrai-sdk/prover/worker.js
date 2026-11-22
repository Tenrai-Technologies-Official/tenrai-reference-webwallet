// One proof in one worker. The page sends the prover input, how many threads to use and the SHA-256 of
// the module; it gets the stages the proof reaches and then the proof or the reason there is none. Ending
// this worker ends its threads and releases the whole memory, the secrets in it with it. Nothing here
// talks to anything but this folder.

const BUILDS = {
  threads: { glue: "./threads/tenrai_tsp2_prover_wasm_threads.js", wasm: "threads/tenrai_tsp2_prover_wasm_threads_bg.wasm" },
  plain: { glue: "./plain/tenrai_tsp2_prover_wasm.js", wasm: "plain/tenrai_tsp2_prover_wasm_bg.wasm" },
};

// A browser hands the memory of a worker that just ended back seconds later, Chrome after about 4.5 s; a proof
// started before that asks again, and only then there is too little.
const MEMORY_WAIT_MILLIS = 10_000;
const MEMORY_ASK_MILLIS = 1_000;

globalThis.tenraiProverStage = (stage) => self.postMessage({ stage });
// The module says through the console why it traps, just before it does.
console.error = (...parts) => self.postMessage({ note: parts.join(" ") });

async function pinnedModule(path, sha256) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error("the prover module could not be loaded");
  const bytes = await response.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hex !== sha256) throw new Error("the prover module is not the reviewed build");
  return WebAssembly.compile(bytes);
}

async function proofOf(prover, input) {
  const until = Date.now() + MEMORY_WAIT_MILLIS;
  for (;;) {
    try {
      return prover.prove(input);
    } catch (error) {
      if (!/memory free for the proof/.test(String(error?.message ?? error)) || Date.now() >= until) throw error;
      await new Promise((done) => setTimeout(done, MEMORY_ASK_MILLIS));
    }
  }
}

self.onmessage = async ({ data }) => {
  const input = new Uint8Array(data.input);
  try {
    const threaded = data.threads > 0;
    const build = threaded ? BUILDS.threads : BUILDS.plain;
    const prover = await import(build.glue);
    const module = await pinnedModule(build.wasm, threaded ? data.sha256.threads : data.sha256.plain);
    const wasm = await prover.default({ module_or_path: module });
    if (threaded) await prover.initThreadPool(data.threads);
    self.postMessage({ stage: "started" });
    const proof = await proofOf(prover, input);
    self.postMessage({ proof, memory_bytes: wasm.memory.buffer.byteLength }, [proof.buffer]);
  } catch (error) {
    self.postMessage({ failed: String(error?.message ?? error) });
  } finally {
    input.fill(0);
  }
};
