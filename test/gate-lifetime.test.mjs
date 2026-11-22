import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { test } from "node:test";
import { GateLifetime } from "../src/gate/lifetime.ts";
import { open, save } from "../src/vault.ts";

const turn = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function wallet(close = async () => {}) {
  let closes = 0;
  return { get closes() { return closes; }, async close() { closes += 1; await close(); } };
}

test("a mode switch closes a late factory result and waits for its lease before another attempt", async () => {
  const lifetime = new GateLifetime(), old = lifetime.begin(); await old.ready();
  const factory = deferred(), closed = deferred(), late = wallet(() => closed.promise);
  const opening = old.wallet(() => factory.promise);
  const rejected = assert.rejects(opening, /no longer active/);
  await turn();
  const stopping = lifetime.cancel();
  const next = lifetime.begin(); let ready = false;
  const waiting = next.ready().then(() => { ready = true; });
  factory.resolve(late); await turn();
  assert.equal(late.closes, 1); assert.equal(ready, false); assert.equal(old.current, false);
  closed.resolve(); await rejected; await stopping; await waiting;
  const current = await next.wallet(async () => wallet());
  assert.equal(ready, true); assert.equal(current.closes, 0);
  await lifetime.stop(); assert.equal(current.closes, 1);
});

test("late history completion cannot hand an old wallet into a new action", async () => {
  const lifetime = new GateLifetime(), old = lifetime.begin(); await old.ready();
  const previous = await old.wallet(async () => wallet()), history = deferred();
  let opened = 0;
  const completion = (async () => { await history.promise; old.assertOpen(); old.handoff(previous, () => { opened += 1; }); })();
  const rejected = assert.rejects(completion, /no longer active/);
  const next = lifetime.begin(); await next.ready();
  const current = await next.wallet(async () => wallet());
  history.resolve(); await rejected;
  assert.equal(opened, 0); assert.equal(previous.closes, 1); assert.equal(current.closes, 0);
  await lifetime.stop(); assert.equal(current.closes, 1);
});

test("successful synchronous handoff transfers ownership while unmount still closes unhanded wallets", async () => {
  const lifetime = new GateLifetime(), attempt = lifetime.begin(); await attempt.ready();
  const retained = await attempt.wallet(async () => wallet()); let delivered;
  attempt.handoff(retained, () => { delivered = retained; });
  await lifetime.stop(); assert.equal(delivered, retained); assert.equal(retained.closes, 0);
  assert.throws(() => lifetime.begin(), /gate is closed/);
  lifetime.resume(); const pending = lifetime.begin(); await pending.ready();
  const discarded = await pending.wallet(async () => wallet());
  await pending.close(); await pending.close();
  assert.equal(pending.signal.aborted, true); assert.equal(discarded.closes, 1);
  await lifetime.stop(); assert.equal(discarded.closes, 1);
  await retained.close(); assert.equal(retained.closes, 1);
});

test("a late factory close failure prevents replacement ownership from starting", async () => {
  const lifetime = new GateLifetime(), previous = lifetime.begin(); await previous.ready();
  const factory = deferred(); const creation = previous.wallet(() => factory.promise);
  const failedCreation = assert.rejects(creation, /lease release failed/); await turn();
  const next = lifetime.begin(); const refused = assert.rejects(next.ready(), /lease release failed/);
  factory.resolve(wallet(async () => { throw new Error("lease release failed"); }));
  await failedCreation; await refused; await assert.rejects(lifetime.stop(), /lease release failed/);
});

test("throwing handoff drains its wallet close before replacement and preserves close failures", async () => {
  for (const fails of [false, true]) {
    const lifetime = new GateLifetime(), attempt = lifetime.begin(); await attempt.ready();
    const released = deferred();
    const retained = await attempt.wallet(async () => wallet(async () => {
      await released.promise;
      if (fails) throw new Error("handoff lease release failed");
    }));
    assert.throws(() => attempt.handoff(retained, () => { throw new Error("opening callback failed"); }), /opening callback failed/);
    const next = lifetime.begin(); let ready = false;
    const waiting = next.ready().then(() => { ready = true; });
    const refused = fails ? assert.rejects(waiting, /handoff lease release failed/) : undefined;
    await turn(); assert.equal(retained.closes, 1); assert.equal(ready, false);
    released.resolve();
    if (fails) { await refused; await assert.rejects(lifetime.stop(), /handoff lease release failed/); }
    else { await waiting; assert.equal(ready, true); await lifetime.stop(); }
    assert.equal(retained.closes, 1);
  }
});

function vaultEnvironment(context, stopAt) {
  const beforeCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const beforeStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const rows = new Map([["tenrai-reference-wallet", "previous exact encrypted record"]]);
  let writes = 0, encryptions = 0;
  const reached = deferred(), release = deferred();
  const subtle = new Proxy(webcrypto.subtle, { get(target, key) {
    if (key === "deriveKey") return async (...args) => {
      const derived = await target.deriveKey(...args);
      if (stopAt === "derive") { reached.resolve(); await release.promise; }
      return derived;
    };
    if (key === "encrypt") return async (...args) => {
      encryptions += 1; const encrypted = await target.encrypt(...args);
      if (stopAt === "encrypt") { reached.resolve(); await release.promise; }
      return encrypted;
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: { subtle, getRandomValues: webcrypto.getRandomValues.bind(webcrypto) } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key) => rows.get(key) ?? null,
    setItem(key, value) { writes += 1; rows.set(key, String(value)); }, removeItem: (key) => rows.delete(key),
  } });
  context.after(() => {
    release.resolve();
    if (beforeCrypto) Object.defineProperty(globalThis, "crypto", beforeCrypto); else delete globalThis.crypto;
    if (beforeStorage) Object.defineProperty(globalThis, "localStorage", beforeStorage); else delete globalThis.localStorage;
  });
  return { reached: reached.promise, release: release.resolve, rows, writes: () => writes, encryptions: () => encryptions };
}
const secret = { mnemonic: "public functional vault fixture", passphrase: "public fixture passphrase" };

test("cancelling during actual vault key derivation cannot begin encryption or overwrite credentials", { concurrency: false }, async (context) => {
  const env = vaultEnvironment(context, "derive"), lifetime = new GateLifetime(), attempt = lifetime.begin(); await attempt.ready();
  const writing = save(secret, "public-fixture-password", "development", { assertOpen: () => attempt.assertOpen() });
  const refused = assert.rejects(writing, /no longer active/);
  await env.reached; await lifetime.stop(); env.release(); await refused;
  assert.equal(env.encryptions(), 0); assert.equal(env.writes(), 0);
  assert.equal(env.rows.get("tenrai-reference-wallet"), "previous exact encrypted record");
});

test("cancelling after actual encryption still fences the final synchronous credential write", { concurrency: false }, async (context) => {
  const env = vaultEnvironment(context, "encrypt"), lifetime = new GateLifetime(), attempt = lifetime.begin(); await attempt.ready();
  const writing = save(secret, "public-fixture-password", "development", { assertOpen: () => attempt.assertOpen() });
  const refused = assert.rejects(writing, /no longer active/);
  await env.reached; await lifetime.stop(); env.release(); await refused;
  assert.equal(env.encryptions(), 1); assert.equal(env.writes(), 0);
  assert.equal(env.rows.get("tenrai-reference-wallet"), "previous exact encrypted record");
});

test("the current gate action can durably save and reopen its exact vault secret", { concurrency: false }, async (context) => {
  const env = vaultEnvironment(context), lifetime = new GateLifetime(), attempt = lifetime.begin(); await attempt.ready();
  let guards = 0;
  await save(secret, "public-fixture-password", "development", { assertOpen: () => { guards += 1; attempt.assertOpen(); } });
  assert.equal(env.writes(), 1); assert.equal(env.encryptions(), 1); assert.ok(guards >= 3);
  assert.deepEqual(await open("public-fixture-password"), { secret, network: "development" });
  await lifetime.stop();
});
