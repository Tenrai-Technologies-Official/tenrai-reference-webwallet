import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { TenraiClient } from "@tenrai/sdk";
import { Wallet } from "@tenrai/sdk/wallet";
import { browserStore, publicTransferStore } from "../../src/wallet/privateStore.ts";
import { History } from "../../src/wallet/history.ts";
import { privateRecords, publicRecords } from "./sdk-disk.mjs";

globalThis.crypto ??= webcrypto;
const text = new TextEncoder();
const copy = (value) => value === undefined ? undefined : structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };

export async function bindings() {
  const module = await import(new URL("./runtime.js", import.meta.resolve("@tenrai/sdk/wallet")));
  return module.protocolBindings();
}

/** Load a public spend fixture with its quorum certificate and coin presence proof. */
async function readCapture() {
  const file = process.env.TENRAI_NATIVE_CAPTURE;
  assert.ok(file && isAbsolute(file), "Set TENRAI_NATIVE_CAPTURE to the absolute path of the synthetic chain capture.");
  const data = await readFile(file); assert.ok(data.byteLength <= 32 * 1024 * 1024);
  const value = JSON.parse(data.toString("utf8"));
  assert.equal(value.format, 1); assert.equal(value.network, "development"); assert.match(value.test_only, /synthetic/);
  assert.ok(typeof value.genesis_manifest === "string" && value.genesis_manifest.length > 0);
  assert.ok(Array.isArray(value.public_cases) && value.public_cases.length === 1);
  const entry = value.public_cases[0];
  assert.equal(entry.name, "ordinary-single"); assert.equal(entry.canonical_coins.length, 1);
  assert.match(entry.wallet_entropy_hex, /^[0-9a-f]{64}$/); assert.match(entry.verified_head.chain_id, /^[0-9a-f]{96}$/);
  return { genesis: value.genesis_manifest, entry };
}
const capture = await readCapture();
const wasm = await bindings();
const entropy = Uint8Array.from(Buffer.from(capture.entry.wallet_entropy_hex, "hex"));
export const MNEMONIC = wasm.mnemonicFromEntropy(entropy);
entropy.fill(0);
export const CHAIN = capture.entry.verified_head.chain_id;
export const publicKey = (owner) => "public-transfers:" + CHAIN + ":" + owner.network + ":" + owner.account + ":" + owner.address;
export function lockManager() {
  const held = new Set();
  return { held, request(name, options, work) {
    assert.deepEqual(options, { mode: "exclusive", ifAvailable: true });
    return Promise.resolve().then(async () => {
      if (held.has(name)) return work(null);
      held.add(name);
      try { return await work({ name }); } finally { held.delete(name); }
    });
  } };
}

// Model request success separately from transaction commit or abort.
export function database() {
  const rows = new Map(), events = [], transactions = [];
  let behavior = "strict", controlled, noticed = deferred(), writes = 0, reads = 0, opens = 0, closes = 0;
  const db = { objectStoreNames: { contains: () => true }, close() { closes += 1; },
    transaction(table, mode, options) {
      assert.equal(table, "records"); transactions.push({ mode, options });
      if (mode === "readwrite") {
        assert.deepEqual(options, { durability: "strict" });
        if (behavior === "unsupported") throw new TypeError("strict durability unsupported");
      }
      let aborted = false;
      const tx = { durability: behavior === "relaxed" && mode === "readwrite" ? "relaxed" : "strict", error: null,
        abort() { aborted = true; tx.error = new Error("controlled transaction abort");
          queueMicrotask(() => { events.push("abort"); tx.onabort?.(); }); },
        objectStore() {
          if (mode === "readwrite" && behavior === "throw-store") throw new Error("controlled synchronous objectStore refusal");
          return {
          get(key) {
            reads += 1; const request = { result: copy(rows.get(key)) };
            queueMicrotask(() => { request.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.()); });
            return request;
          },
          put(value, key) {
            if (behavior === "throw-put") throw new Error("controlled synchronous put refusal");
            writes += 1; const saved = copy(value), request = { result: key };
            const commit = () => { if (!aborted) { rows.set(key, saved); events.push("commit"); tx.oncomplete?.(); } };
            queueMicrotask(() => {
              events.push("request-success"); request.onsuccess?.();
              if (key.startsWith("public-transfers:") && behavior === "hold") {
                controlled = { commit, abort: () => tx.abort() }; noticed.resolve({ key, value: copy(saved) });
              } else if (key.startsWith("public-transfers:") && behavior === "abort") tx.abort();
              else queueMicrotask(commit);
            });
            return request;
          },
        }; },
      };
      if (behavior === "missing" && mode === "readwrite") delete tx.durability;
      return tx;
    },
  };
  return { rows, events, transactions, reads: () => reads, writes: () => writes, opens: () => opens, closes: () => closes,
    configure(value) { behavior = value; }, nextWrite() { return noticed.promise; },
    hold() { behavior = "hold"; noticed = deferred(); },
    commit() { assert.ok(controlled); behavior = "strict"; controlled.commit(); },
    abort() { assert.ok(controlled); behavior = "abort"; controlled.abort(); },
    open(name, version) {
      opens += 1;
      assert.equal(name, "tenrai-reference-private"); assert.equal(version, 1);
      const request = { result: db }; queueMicrotask(() => request.onsuccess?.()); return request;
    },
  };
}
export function environment(context) {
  const db = database(), locks = lockManager(), local = new Map();
  const localStorage = { getItem: (key) => local.get(key) ?? null, setItem: (key, value) => local.set(key, value),
    removeItem: (key) => local.delete(key) };
  for (const [name, value] of Object.entries({ indexedDB: db, navigator: { locks }, localStorage })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    context.after(() => { if (original) Object.defineProperty(globalThis, name, original); else delete globalThis[name]; });
  }
  return { db, locks, local, owner: null };
}
export async function openWallet(env, { passphrase = "", checkHistory = false, owner = null } = {}) {
  return Wallet.fromMnemonic(MNEMONIC, { network: "development", passphrase, genesisManifest: capture.genesis, ...await publicRecords(),
    async privateStore(derived) {
      const selected = owner ?? derived; env.owner = selected;
      const guard = checkHistory ? async () => {
        assert.equal(env.locks.held.size, 1);
        await History.open({ mnemonic: MNEMONIC, passphrase }, "development", { requireEmptyPublic: true });
      } : undefined;
      return { store: { ...browserStore(selected, CHAIN), ...await privateRecords() }, publicTransfers: publicTransferStore(selected, CHAIN, guard),
        genesisManifest: capture.genesis };
    },
  });
}
export async function openRecord(bytes, passphrase = "") {
  const entropy = wasm.mnemonicEntropy(MNEMONIC);
  const root = new wasm.WalletRoot(entropy, passphrase); entropy.fill(0);
  try {
    const plain = root.openStoreRecord("development", capture.genesis, 0, "tenrai_public_transfers", bytes);
    try { return JSON.parse(new TextDecoder().decode(plain)); } finally { plain.fill(0); }
  } finally { root.free(); }
}
export async function earlierHistory(env, stored, { damage = false } = {}) {
  const material = await crypto.subtle.importKey("raw", text.encode(MNEMONIC + "\n"), "HKDF", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256",
    salt: text.encode("tenrai-reference-wallet-history"), info: text.encode("development") }, material, 512));
  try {
    const key = await crypto.subtle.importKey("raw", bits.slice(0,32), "AES-GCM", false, ["encrypt"]);
    const id = Buffer.from(await crypto.subtle.digest("SHA-256", bits.slice(32))).toString("hex");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: text.encode(id) },
      key, text.encode(JSON.stringify(stored))));
    if (damage) cipher[cipher.length - 1] ^= 1;
    const raw = JSON.stringify({ iv: Buffer.from(iv).toString("base64"), data: Buffer.from(cipher).toString("base64") });
    const name = "tenrai-wallet-history:" + id; env.local.set(name, raw); return { name, raw };
  } finally { bits.fill(0); }
}
/** Serve the captured head and the fixture wallet's genesis input. */
export async function node(wallet, env) {
  const { entry } = capture, coin = entry.canonical_coins[0], owner = coin.address;
  const head = entry.verified_head.finalized, height = head.height;
  assert.equal(wallet.address(), owner);
  const canonical = wasm.validateManifest(JSON.stringify(entry.manifest));
  const record = { outpoint: coin.outpoint, amount: coin.amount, created_finalized_height: Number(coin.created_finalized_height), source: coin.source };
  const info = { api_version: 1, network: "development", chain_id: CHAIN, protocol_version: entry.manifest.protocol_version,
    params_hash: entry.manifest.params_hash, node_version: "certified-capture", identity: "00".repeat(32), storage_mode: "full",
    history_floor: 0, address_index_height: height, finalized: head, started_at_millis: 0 };
  const addresses = (body) => { assert.ok(Array.isArray(body?.addresses)); return body.addresses; };
  const posts = [], requests = [];
  let bridge = 0;
  const routes = {
    "GET /v1/node/info": () => info,
    "GET /v1/transactions/manifest": () => entry.manifest,
    "GET /v1/private/anchor": () => entry.anchor_response,
    ["GET /v1/finality/cuts/" + entry.cut_proof_response.height]: () => entry.cut_proof_response,
    "GET /v1/finality/bridge": () => { const next = entry.bridge_responses[bridge++]; assert.ok(next, "no captured bridge for the verifier's request"); return next; },
    "POST /v1/proofs/utxo-presence": (body) => {
      assert.deepEqual(body, { api_version: 1, anchor: head, outpoints: entry.canonical_coins.map((row) => row.outpoint) });
      return entry.presence_response;
    },
    "POST /v1/address/balances": (body) => ({ api_version: 1, indexed_height: height,
      balances: addresses(body).map((address) => ({ address, balance: address === owner ? coin.amount : "0", utxos: address === owner ? 1 : 0 })) }),
    "POST /v1/address/changes": (body) => ({ api_version: 1, after_height: body.after_height, indexed_height: height, changes: [], resync: [] }),
    ["GET /v1/address/" + owner + "/utxos"]: () => ({ api_version: 1, network: "development", address: owner, anchor: head, utxos: [record], next_cursor: null }),
    "POST /v1/address/history-range": (body) => {
      assert.equal(body.at_height, height);
      assert.ok(body.addresses.every((row) => row.after_height === height), "this single-head capture has no history to replay");
      return { api_version: 1, at_height: height, indexed_height: height, history_from: 0, events: [],
        completed: body.addresses.map((row) => row.address), next_cursor: null };
    },
    "POST /v1/transactions": (body) => {
      const inspected = JSON.parse(wasm.inspectTransaction(Uint8Array.from(Buffer.from(body.wire_hex, "hex")), canonical));
      assert.equal(inspected.body.chain_id, CHAIN); posts.push(body.wire_hex); env.db.events.push("POST");
      return { api_version: 1, transaction_id: inspected.transaction_id, lifecycle: "processing" };
    },
  };
  const client = new TenraiClient({ url: "http://127.0.0.1:28701/", target: "node", retries: 0,
    requestsPerSecond: 0, fetch: async (input, init = {}) => {
      const request = new Request(input, init), path = new URL(request.url).pathname;
      const rawBody = await request.text(), body = rawBody ? JSON.parse(rawBody) : null;
      requests.push(request.method + " " + path);
      const route = routes[request.method + " " + path];
      if (!route) return Response.json({ api_version: 1, code: "not_found", message: "controlled missing route", retry_after_millis: null }, { status: 404 });
      return Response.json(structuredClone(route(body)));
    } });
  const feePerMass = BigInt(entry.manifest.minimum_fee_per_mass);
  return { client, posts, requests, send: () => wallet.send(client, { to: wallet.address(5), amount: 100_000_000n, feePerMass }) };
}
