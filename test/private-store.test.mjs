import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { TenraiClient } from "@tenrai/sdk";
import { PrivateNotes } from "@tenrai/sdk/wallet";
import { browserStore, privateWalletStore, MAINNET_CHAIN_ID, DEVELOPMENT_CHAIN_ID } from "../src/wallet/privateStore.ts";
import { privateRecords } from "./support/sdk-disk.mjs";

const CHAIN = "31".repeat(48);
const DIGEST = "ab".repeat(48);
const KEYS = "11".repeat(48);
const SCHEDULE = "22".repeat(48);
const OWNER = Object.freeze({ network: "development", account: 0, address: "dtrai1accountalpha", fingerprint: "TRAI-1234-5678" });
const previous = (name, owner = OWNER) => `${name}:${owner.fingerprint}`;
const current = (name, owner = OWNER, chain = CHAIN) => `${name}:${chain}:${owner.network}:${owner.account}:${owner.address}`;
const namespace = (key) => `tenrai-reference-private:records:${key}`;
const clone = (value) => value === undefined ? undefined : structuredClone(value);

/** Models the Web Locks callback/hold lifecycle; separate adapters share this one backend. */
function locks() {
  const held = new Set();
  const requested = [];
  return { held, requested,
    request(name, options, work) {
      assert.deepEqual(options, { mode: "exclusive", ifAvailable: true });
      requested.push(name);
      return Promise.resolve().then(async () => {
        if (held.has(name)) return work(null);
        held.add(name);
        try { return await work({ name, mode: "exclusive" }); }
        finally { held.delete(name); }
      });
    },
  };
}

/** Model staged writes and separate request and transaction completion. */
function idb() {
  const rows = new Map();
  const events = [];
  const calls = [];
  let behavior = "strict";
  let controlled;
  let closed = 0;
  let reads = 0;
  let puts = 0;
  let noticed = () => {};
  const objectStoreNames = { contains: () => true };
  const database = { objectStoreNames, close() { closed += 1; },
    transaction(table, mode, options) {
      assert.equal(table, "records");
      calls.push({ mode, options });
      if (mode === "readwrite" && behavior === "unsupported") throw new TypeError("durability options unsupported");
      const transaction = { durability: mode === "readwrite" && behavior === "relaxed" ? "relaxed" : "strict", error: null,
        abort() {
          transaction.error = new Error("transaction aborted after request success");
          queueMicrotask(() => { events.push("tx:abort"); transaction.onabort?.({ target: transaction }); });
        },
        objectStore() {
          return {
            get(key) {
              reads += 1;
              const request = { result: clone(rows.get(key)) };
              queueMicrotask(() => {
                request.onsuccess?.({ target: request });
                queueMicrotask(() => transaction.oncomplete?.({ target: transaction }));
              });
              return request;
            },
            put(value, key) {
              puts += 1;
              const request = { result: key };
              const saved = clone(value);
              const commit = () => {
                rows.set(key, saved);
                events.push("tx:complete");
                transaction.oncomplete?.({ target: transaction });
              };
              // Delay the signed frame after the initial bookkeeping write.
              const frame = value instanceof Uint8Array && new TextDecoder().decode(value).includes('"frameHex":"f077"');
              queueMicrotask(() => {
                events.push("put:success");
                request.onsuccess?.({ target: request });
                if (behavior === "hold" && frame) {
                  events.push("frame:request-success");
                  controlled = { transaction, commit: () => { events.push("frame:complete"); commit(); } };
                  noticed();
                } else if (behavior === "abort" && frame) transaction.abort();
                else queueMicrotask(commit);
              });
              return request;
            },
          };
        },
      };
      if (mode === "readwrite" && behavior === "missing") delete transaction.durability;
      return transaction;
    },
  };
  return { rows, events, calls, reads: () => reads, puts: () => puts, closed: () => closed,
    configure(value) { behavior = value; },
    waitForFrame() { return new Promise((resolve) => { noticed = resolve; }); },
    commitFrame() { assert.ok(controlled); behavior = "strict"; controlled.commit(); },
    abortFrame() { assert.ok(controlled); controlled.transaction.abort(); },
    open(name, version) {
      assert.equal(name, "tenrai-reference-private"); assert.equal(version, 1);
      const request = { result: database };
      queueMicrotask(() => request.onsuccess?.({ target: request }));
      return request;
    },
  };
}

function environment(t) {
  const db = idb();
  const lock = locks();
  const local = new Map();
  for (const [name, value] of Object.entries({ indexedDB: db, navigator: { locks: lock }, localStorage: {
    getItem: (key) => local.get(key) ?? null, setItem: (key, value) => local.set(key, value),
  } })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    t.after(() => { if (original) Object.defineProperty(globalThis, name, original); else delete globalThis[name]; });
  }
  return { db, lock, local };
}

const NOTES = [{ note: 3, value_atoms: "10" }, { note: 9, value_atoms: "10" }];

/** A scan/prover double isolates real SDK journal/POST scheduling from native proof verification. */
class Scan {
  #query = {};
  privateAddress() { return OWNER.address; }
  damaged() { return false; }
  rolledBackFrom() { return undefined; }
  start() {}
  startHeadOnly() {}
  next() { return JSON.stringify({ kind: "done" }); }
  summary() { return JSON.stringify({ height: 100, balance_atoms: "20", note_count: "2", note_cursor: "10", notes: NOTES }); }
  verifiedHead() { return JSON.stringify({ network: "development", chain_id: CHAIN, params_hash: SCHEDULE, protocol_version: 2,
    finalized: { height: 100, cut_id: DIGEST, state_root: SCHEDULE, validator_set_id: KEYS } }); }
  registrationVerifiedHead() { return this.verifiedHead(); }
  scratchGeneration() { return undefined; }
  statementFrameInfo() { return JSON.stringify({ digest: DIGEST, class: "transfer", valid_from_height: 100, valid_until_height: 400, output_commitments: [], inputs: [] }); }
  statementSourcesUnspent() { return false; }
  statementProofRequest() { throw new Error("not part of a provider persistence test"); }
  takeStatementBridge() { throw new Error("not part of a provider persistence test"); }
  verifyStatementExecution() { throw new Error("not part of a provider persistence test"); }
  seal() { return new Uint8Array([1]); }
  mark() { return new Uint8Array([2]); }
  beginRecords() {}
  recordsFrom() { return undefined; }
  takeRecords() {}
  registered() { return true; }
  unsavedRows() { return 0n; }
  sealSends(bytes) { return bytes.slice(); }
  openSends(bytes) { return bytes.slice(); }
  planTransfer() { return JSON.stringify({ sources: [3, 9], change_atoms: "0" }); }
  inventoryRoots() { return JSON.stringify({ roots: [], sealed_byte_budget: "999999999" }); }
  inventoryNext() { return JSON.stringify({ kind: "done" }); }
  inventoryResult() { return JSON.stringify(this.#query); }
  beginSelection(amount, reserved) { this.#query = JSON.parse(this.planTransfer(amount, reserved)); }
  beginSources() { this.#query = { kind: "sources_ready" }; }
  beginNotePage(after, limit) {
    const notes = NOTES.filter((row) => after === undefined || BigInt(row.note) > BigInt(after)).slice(0, limit)
      .map((row) => ({ ...row, note_commitment: (row.note === 3 ? "33" : "99").repeat(48) }));
    this.#query = { notes, next_note: null };
  }
  prepareTransfer() { return {
    summary: () => JSON.stringify({ kind: "transfer", route: "transfers", digest: DIGEST, amount_atoms: "1", fee_atoms: "7",
      change_atoms: "0", anchor_height: 100, valid_until_height: 400, sources: [3, 9], inputs: [], own_note_commitments: [] }),
    proverInput: () => new Uint8Array([1]), frame: () => new Uint8Array([0xf0, 0x77]), free() {},
  }; }
  free() {}
}

/** Exercise the SDK's scheduling with a finality double. */
function finalityRoot() {
  return { finalityScope: () => "reference-provider-finality", restoreFinalityState() {}, finalityDirty: () => false,
    finalityHalted: () => false, finalityHeight: () => 0n, assertFinalitySafe() {}, sealFinalityState: () => new Uint8Array(40),
    acknowledgeFinalityState() {} };
}
const finalityStore = { async run(_scope, work) { return work(null, async () => {}); }, close() {} };

async function spending(store, db) {
  let posts = 0;
  const client = new TenraiClient({ url: "http://127.0.0.1:28701/", target: "node", retries: 0, requestsPerSecond: 0,
    fetch: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === "/v1/private/status") return Response.json({ active: true,
        protocol: { verifier_keys_digest: KEYS, fits_consensus_limits: true, security_qualification: "incomplete" }, fees: { schedule_digest: SCHEDULE } });
      assert.equal(path, "/v1/private/transfers"); assert.equal(init.method, "POST");
      assert.equal(JSON.parse(new TextDecoder().decode(init.body)).bytes, "f077");
      posts += 1; db.events.push("post");
      return Response.json({ api_version: 1, id: DIGEST });
    },
  });
  const wasm = { PrivateScan: Scan, privateRules: () => JSON.stringify({ verifier_keys_digest: KEYS, schedule_digest: SCHEDULE, fee_atoms: "7", minimum_note_atoms: "1", validity_cuts: 300 }) };
  const records = await privateRecords();
  const notes = await PrivateNotes.open(wasm, finalityRoot(), "development", 0, client, { store: { ...store, ...records }, finalityStore });
  return { notes, posts: () => posts, send: () => notes.transfer({ to: "dtrai1recipient", amount: 1n }, { prover: { async prove(input) { input.fill(0); return new Uint8Array([0x77]); } } }) };
}

test("distinct provider wrappers contend before restore/writes and release every namespace", { concurrency: false, timeout: 20_000 }, async (t) => {
  const { db, lock } = environment(t);
  const a = browserStore(OWNER, CHAIN), b = browserStore({ ...OWNER }, CHAIN);
  const lease = await a.acquireSendsLease();
  assert.deepEqual([...lock.held], [namespace(current("sends"))]);
  await assert.rejects(b.acquireSendsLease(), /already open/);
  assert.equal(db.reads(), 0); assert.equal(db.puts(), 0);
  await lease.release(); assert.equal(lock.held.size, 0);
  const next = await b.acquireSendsLease(); await next.release();
  assert.equal(lock.held.size, 0);
});

test("a browser without Web Locks refuses account ownership before any storage access", { concurrency: false, timeout: 20_000 }, async (t) => {
  const { db } = environment(t);
  delete navigator.locks;
  await assert.rejects(browserStore(OWNER, CHAIN).acquireSendsLease(), /cannot exclusively own/);
  assert.equal(db.reads(), 0);
  assert.equal(db.puts(), 0);
});

test("the account lease is its full namespace alone; a short display fingerprint is never locked", { concurrency: false, timeout: 20_000 }, async (t) => {
  const { lock } = environment(t);
  const fingerprint = namespace(previous("sends"));
  lock.held.add(fingerprint);
  const lease = await browserStore(OWNER, CHAIN).acquireSendsLease();
  assert.deepEqual(lock.requested, [namespace(current("sends"))]);
  await lease.release();
  assert.deepEqual([...lock.held], [fingerprint]);
  lock.held.delete(fingerprint);
  lock.held.add(namespace(current("sends")));
  await assert.rejects(browserStore(OWNER, CHAIN).acquireSendsLease(), /already open/);
});

test("the durable key separates full addresses/chains/accounts rather than a short display fingerprint", { concurrency: false, timeout: 20_000 }, async (t) => {
  const { db } = environment(t);
  const owners = [OWNER, { ...OWNER, address: "dtrai1accountbeta" }, { ...OWNER, account: 1 }];
  for (const owner of owners) await browserStore(owner, CHAIN).write("sends", new Uint8Array([owner.account + 1]));
  await browserStore(OWNER, "32".repeat(48)).write("sends", new Uint8Array([4]));
  assert.equal(db.rows.size, 4);
  for (const owner of owners) assert.ok(db.rows.has(current("sends", owner)));
  assert.ok(db.rows.has(current("sends", OWNER, "32".repeat(48))));
  assert.equal(db.rows.has(previous("sends")), false);
});

test("a row under a short display fingerprint is never read as the account's data and stays unchanged", { concurrency: false, timeout: 20_000 }, async (t) => {
  const { db } = environment(t);
  const foreign = new Uint8Array([7, 7, 7]);
  db.rows.set(previous("sends"), foreign.slice());
  const store = browserStore(OWNER, CHAIN);
  assert.equal(await store.read("sends"), null);
  await store.write("sends", new Uint8Array([9]));
  assert.deepEqual(db.rows.get(previous("sends")), foreign);
  assert.deepEqual(db.rows.get(current("sends")), new Uint8Array([9]));
});

test("a damaged account row is refused and preserved; a fingerprint row never stands in for it", { concurrency: false, timeout: 20_000 }, async (t) => {
  const { db } = environment(t);
  const store = browserStore(OWNER, CHAIN);
  const bad = { damaged: true };
  db.rows.set(previous("sends"), new Uint8Array([5]));
  db.rows.set(current("sends"), bad);
  await assert.rejects(store.read("sends"), /damaged/);
  assert.deepEqual(db.rows.get(current("sends")), bad);
  assert.deepEqual(db.rows.get(previous("sends")), new Uint8Array([5]));
});

test("a strict transaction must complete before the SDK sends its original frame", { concurrency: false, timeout: 20_000 }, async (t) => {
  const { db } = environment(t);
  const opened = await spending(browserStore(OWNER, CHAIN), db);
  try {
    db.configure("hold");
    const seen = db.waitForFrame();
    const sending = opened.send();
    await Promise.race([seen, sending.then(() => { throw new Error("submission completed before reaching its controlled journal write"); })]);
    await nextTurn();
    assert.equal(opened.posts(), 0, "put request success alone is insufficient");
    assert.ok(db.calls.filter((call) => call.mode === "readwrite").every((call) => call.options.durability === "strict"));
    assert.equal(db.rows.has(current("sends")), true, "only the earlier empty bookkeeping row has committed");
    assert.equal(new TextDecoder().decode(db.rows.get(current("sends"))).includes("f077"), false);
    db.commitFrame();
    await sending;
    assert.equal(opened.posts(), 1);
    assert.ok(db.events.indexOf("frame:request-success") < db.events.indexOf("frame:complete"));
    assert.ok(db.events.indexOf("frame:complete") < db.events.indexOf("post"));
    assert.ok(new TextDecoder().decode(db.rows.get(current("sends"))).includes("f077"));
  } finally { await opened.notes.close(); }
});

test("put success followed by transaction abort prevents the actual SDK POST", { concurrency: false, timeout: 20_000 }, async (t) => {
  const { db } = environment(t);
  const opened = await spending(browserStore(OWNER, CHAIN), db);
  try {
    db.configure("hold");
    const seen = db.waitForFrame();
    const sending = opened.send();
    const ended = assert.rejects(sending, /transaction aborted/);
    await Promise.race([seen, sending.then(() => { throw new Error("submission completed before reaching its controlled journal write"); })]);
    await nextTurn();
    assert.equal(opened.posts(), 0);
    db.abortFrame();
    await ended;
    assert.equal(opened.posts(), 0);
    assert.deepEqual(opened.notes.onTheWay(), [], "a frame whose write never committed is not on its way");
    assert.equal(new TextDecoder().decode(db.rows.get(current("sends"))).includes("f077"), false);
    await assert.rejects(opened.send(), /reopen this store before spending/);
    assert.equal(opened.posts(), 0);
  } finally { await opened.notes.close(); }
});

test("closing during an original-frame write retains the real provider lease until commit and reopens the same frame", { concurrency: false, timeout: 20_000 }, async (t) => {
  const { db, lock } = environment(t);
  const opened = await spending(browserStore(OWNER, CHAIN), db);
  db.configure("hold");
  const seen = db.waitForFrame();
  const sending = opened.send();
  const ended = assert.rejects(sending, /closed/);
  await Promise.race([seen, sending.then(() => { throw new Error("submission completed before reaching its controlled journal write"); })]);
  const closing = opened.notes.close();
  await assert.rejects(browserStore(OWNER, CHAIN).acquireSendsLease(), /already open/);
  assert.deepEqual([...lock.held], [namespace(current("sends"))]);
  assert.equal(opened.posts(), 0);
  db.commitFrame();
  await ended;
  await closing;
  assert.equal(lock.held.size, 0);
  const reopened = await spending(browserStore(OWNER, CHAIN), db);
  try {
    assert.equal(reopened.notes.onTheWay()[0]?.frameHex, "f077");
    assert.deepEqual(reopened.notes.onTheWay()[0]?.sources, [3, 9]);
    assert.equal(reopened.posts(), 0);
  } finally { await reopened.notes.close(); }
});

test("invalid mandatory sealed bytes stop SDK restore and release its lease without overwriting the row", { concurrency: false, timeout: 20_000 }, async (t) => {
  const { db, lock } = environment(t);
  const corrupt = new Uint8Array([0xff]);
  db.rows.set(current("sends"), corrupt.slice());
  await assert.rejects(spending(browserStore(OWNER, CHAIN), db));
  assert.equal(lock.held.size, 0);
  assert.deepEqual(db.rows.get(current("sends")), corrupt);
  assert.equal(db.events.includes("post"), false);
  assert.equal(db.puts(), 0);
});

test("unsupported, relaxed or missing durability refuses before the SDK POST", { concurrency: false, timeout: 20_000 }, async (t) => {
  const { db } = environment(t);
  for (const behavior of ["unsupported", "relaxed", "missing"]) {
    db.configure("strict");
    const opened = await spending(browserStore(OWNER, CHAIN), db);
    try {
      db.configure(behavior);
      await assert.rejects(opened.send(), /strict storage durability/);
      assert.equal(opened.posts(), 0);
    } finally { await opened.notes.close(); }
  }
  assert.ok(db.closed() > 0);
});

test("mainnet uses its compiled chain pin; development/test networks use only configured genesis metadata", { concurrency: false, timeout: 20_000 }, async (t) => {
  const { db } = environment(t);
  const original = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const fetched = [];
  let response = new Response(null, { status: 404 });
  Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: async (path) => { fetched.push(path); return response.clone(); } });
  t.after(() => { if (original) Object.defineProperty(globalThis, "fetch", original); else delete globalThis.fetch; });
  const main = await privateWalletStore({ ...OWNER, network: "mainnet", address: "trai1accountalpha" });
  assert.equal(main.genesisManifest, undefined); assert.deepEqual(fetched, []);
  await main.store.write("sends", new Uint8Array([1]));
  assert.ok(db.rows.has(current("sends", { ...OWNER, network: "mainnet", address: "trai1accountalpha" }, MAINNET_CHAIN_ID)));
  const development = await privateWalletStore(OWNER);
  await development.store.write("sends", new Uint8Array([2]));
  assert.ok(db.rows.has(current("sends", OWNER, DEVELOPMENT_CHAIN_ID)));
  const configured = { network: "testnet", chain_id: "53".repeat(48) };
  response = Response.json(configured);
  const testnet = await privateWalletStore({ ...OWNER, network: "testnet" });
  assert.equal(testnet.genesisManifest, JSON.stringify(configured));
  await testnet.store.write("sends", new Uint8Array([3]));
  assert.ok(db.rows.has(current("sends", { ...OWNER, network: "testnet" }, configured.chain_id)));
  await assert.rejects(privateWalletStore({ ...OWNER, network: "testnet100" }), /does not identify/);
  response = new Response(null, { status: 404 });
  await assert.rejects(privateWalletStore({ ...OWNER, network: "testnet" }), /Configure the test genesis/);
  assert.ok(fetched.every((path) => path === "/api/genesis"), "no unsigned remote NodeInfo selects a trust namespace");
});

test("provider release pins agree with the selected public Core genesis files", { skip: !process.env.TENRAI_REPO, concurrency: false }, async () => {
  const core = process.env.TENRAI_REPO;
  assert.equal((await readFile(join(core, "config/mainnet.chain-id"), "utf8")).trim(), MAINNET_CHAIN_ID);
  assert.equal(JSON.parse(await readFile(join(core, "config/development.traidag.json"), "utf8")).chain_id, DEVELOPMENT_CHAIN_ID);
});
