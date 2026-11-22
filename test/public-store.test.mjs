import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { environment, openWallet, openRecord, earlierHistory, publicKey, node } from "./support/public-store.mjs";

const options = { concurrency: false, timeout: 30_000 };
const clone = (bytes) => new Uint8Array(bytes);
async function failure(promise) {
  let caught;
  try { await promise; } catch (error) { caught = error; }
  assert.ok(caught, "the operation must refuse");
  return caught;
}

test("a wallet factory returns only after its native-root empty journal commits strictly", options, async (context) => {
  const env = environment(context);
  env.db.hold();
  let returned = false;
  const opening = openWallet(env).then((wallet) => { returned = true; return wallet; });
  const write = await env.db.nextWrite();
  await nextTurn();
  assert.equal(returned, false);
  assert.equal(env.locks.held.size, 1);
  assert.equal(env.db.rows.size, 0);
  assert.deepEqual(await openRecord(write.value), { format: 1, entries: [] });
  env.db.commit();
  const wallet = await opening;
  try {
    assert.ok(env.db.rows.get(publicKey(env.owner)) instanceof Uint8Array);
    assert.deepEqual(wallet.openTransfers(), []);
  } finally { await wallet.close(); }
  assert.equal(env.locks.held.size, 0);
});

test("a real SDK payment posts only after strict commit of its exact native-root signed frame", options, async (context) => {
  const env = environment(context), wallet = await openWallet(env);
  try {
    const rpc = await node(wallet, env), before = clone(env.db.rows.get(publicKey(env.owner)));
    const eventStart = env.db.events.length;
    env.db.hold();
    const sending = rpc.send();
    const candidate = await env.db.nextWrite();
    await nextTurn();
    assert.equal(rpc.posts.length, 0);
    assert.deepEqual(env.db.rows.get(publicKey(env.owner)), before);
    const retained = await openRecord(candidate.value);
    assert.equal(retained.entries.length, 1);
    const original = retained.entries[0];
    assert.ok(original.wireHex.length > 100, "the real canonical signer produced the retained artifact");
    env.db.commit();
    const receipt = await sending;
    assert.equal(rpc.posts.length, 1);
    assert.equal(rpc.posts[0], original.wireHex);
    assert.equal(receipt.transactionId, original.transactionId);
    const events = env.db.events.slice(eventStart);
    assert.ok(events.indexOf("commit") < events.indexOf("POST"));
    const stored = await openRecord(env.db.rows.get(publicKey(env.owner)));
    assert.equal(stored.entries[0].wireHex, original.wireHex);
    assert.equal(wallet.openTransfers()[0].wireHex, original.wireHex);
  } finally { await wallet.close(); }
});

test("request success followed by abort sends nothing and preserves the prior durable journal", options, async (context) => {
  const env = environment(context), wallet = await openWallet(env);
  try {
    const rpc = await node(wallet, env), prior = clone(env.db.rows.get(publicKey(env.owner)));
    env.db.hold();
    const sending = rpc.send();
    const rejected = failure(sending);
    await env.db.nextWrite(); await nextTurn();
    assert.equal(rpc.posts.length, 0);
    env.db.abort();
    const error = await rejected;
    assert.equal(error.code, "unconfirmed");
    assert.equal(rpc.posts.length, 0);
    assert.deepEqual(env.db.rows.get(publicKey(env.owner)), prior);
    const calls = rpc.requests.length;
    await assert.rejects(rpc.send(), /must be restored/);
    assert.equal(rpc.requests.length, calls, "failed durability fences a replacement plan");
  } finally { env.db.configure("strict"); await wallet.close(); }
});

test("unsupported, relaxed and missing strict durability all refuse a real SDK payment before POST", options, async (context) => {
  const env = environment(context);
  for (const behavior of ["unsupported", "relaxed", "missing"]) {
    env.db.configure("strict");
    const wallet = await openWallet(env);
    try {
      const rpc = await node(wallet, env), prior = clone(env.db.rows.get(publicKey(env.owner)));
      env.db.configure(behavior);
      await assert.rejects(rpc.send(), { code: "unconfirmed" });
      assert.equal(rpc.posts.length, 0, behavior);
      assert.deepEqual(env.db.rows.get(publicKey(env.owner)), prior, behavior);
    } finally { env.db.configure("strict"); await wallet.close(); }
  }
  assert.equal(env.locks.held.size, 0);
});

test("closing during commit drains ownership and reopening retries only the retained original wire", options, async (context) => {
  const env = environment(context), wallet = await openWallet(env);
  const rpc = await node(wallet, env);
  env.db.hold();
  const sending = rpc.send(), rejected = failure(sending);
  const pending = await env.db.nextWrite();
  const original = (await openRecord(pending.value)).entries[0];
  const closing = wallet.close();
  assert.equal(env.locks.held.size, 1);
  await assert.rejects(openWallet(env), /already open/);
  assert.equal(rpc.posts.length, 0);
  env.db.commit();
  await rejected; await closing;
  assert.equal(env.locks.held.size, 0);
  const reopened = await openWallet(env);
  try {
    const held = reopened.openTransfers();
    assert.equal(held.length, 1);
    assert.equal(held[0].transactionId, original.transactionId);
    assert.equal(held[0].wireHex, original.wireHex);
    const retry = await node(reopened, env);
    await reopened.retryPublic(retry.client, original.transactionId);
    assert.deepEqual(retry.posts, [original.wireHex]);
  } finally { await reopened.close(); }
});

test("independent provider wrappers refuse another wallet before restore or planning and release after close", options, async (context) => {
  const env = environment(context), first = await openWallet(env);
  const reads = env.db.reads(), writes = env.db.writes();
  await assert.rejects(openWallet(env), /already open/);
  assert.equal(env.db.reads(), reads);
  assert.equal(env.db.writes(), writes);
  await first.close();
  assert.equal(env.locks.held.size, 0);
  const next = await openWallet(env);
  await next.close();
  assert.equal(env.locks.held.size, 0);
});

test("native-root corruption is refused without replacement and exports the original row read-only", options, async (context) => {
  const env = environment(context), first = await openWallet(env);
  const key = publicKey(env.owner);
  await first.close();
  const damaged = clone(env.db.rows.get(key));
  damaged[damaged.length - 1] ^= 1; env.db.rows.set(key, damaged);
  const writes = env.db.writes();
  const error = await failure(openWallet(env));
  assert.equal(typeof error.exportRecovery, "function");
  assert.equal(env.locks.held.size, 0);
  assert.deepEqual(env.db.rows.get(key), damaged);
  const exportStart = env.db.transactions.length;
  const raw = JSON.parse(new TextDecoder().decode(await error.exportRecovery()));
  assert.equal(raw.key, key);
  assert.deepEqual(new Uint8Array(Buffer.from(raw.value.base64, "base64")), damaged);
  assert.equal(env.db.writes(), writes);
  assert.ok(env.db.transactions.slice(exportStart).every((transaction) => transaction.mode === "readonly"));
});

test("a short display identity cannot make another full secret root authenticate the retained row", options, async (context) => {
  const env = environment(context), first = await openWallet(env);
  const owner = { ...env.owner }, key = publicKey(owner), original = clone(env.db.rows.get(key));
  await first.close();
  const writes = env.db.writes();
  // Deliberately give the other full root the same provider namespace/display identity.
  await assert.rejects(openWallet(env, { passphrase: "another full recovery secret", owner }), /cannot be authenticated/);
  assert.deepEqual(env.db.rows.get(key), original);
  assert.equal(env.db.writes(), writes);
  assert.equal(env.locks.held.size, 0);
});

test("the actual earlier-history guard preserves damaged and executable rows before empty initialization", options, async (context) => {
  const env = environment(context);
  for (const shape of [
    { stored: { format: 1, own: [], activity: [], open: [] }, damage: true },
    { stored: { format: 1, own: [], activity: [], open: [{}] }, damage: false },
    { stored: { format: 1, own: [], activity: [] }, damage: false },
  ]) {
    const previous = await earlierHistory(env, shape.stored, { damage: shape.damage });
    const error = await failure(openWallet(env, { checkHistory: true }));
    assert.equal(typeof error.exportRecovery, "function");
    const exported = JSON.parse(new TextDecoder().decode(await error.exportRecovery()));
    assert.equal(exported.key, previous.name); assert.equal(exported.value, previous.raw);
    assert.equal(env.local.get(previous.name), previous.raw);
    assert.equal(env.db.rows.size, 0);
    assert.equal(env.db.writes(), 0);
    assert.equal(env.locks.held.size, 0);
  }
  const previous = await earlierHistory(env, { format: 1, own: [], activity: [], open: [] });
  const wallet = await openWallet(env, { checkHistory: true });
  assert.deepEqual(wallet.openTransfers(), []);
  assert.equal(env.local.get(previous.name), previous.raw);
  await wallet.close();
  // A valid mandatory row is authoritative; old display data is never re-imported.
  env.local.set(previous.name, "damaged old display cache");
  const reopened = await openWallet(env, { checkHistory: true });
  await reopened.close();
  assert.equal(env.local.get(previous.name), "damaged old display cache");
});


test("a missing previously initialized public record is not silently relabelled as an empty account", options, async (context) => {
  const env = environment(context), wallet = await openWallet(env);
  const key = publicKey(env.owner); await wallet.close();
  env.db.rows.delete(key);
  const writes = env.db.writes();
  const error = await failure(openWallet(env));
  assert.match(error.message, /previously initialized public payment journal is missing/);
  assert.equal(typeof error.exportRecovery, "function");
  assert.equal(env.db.writes(), writes); assert.equal(env.db.rows.has(key), false); assert.equal(env.locks.held.size, 0);
  const exported = JSON.parse(new TextDecoder().decode(await error.exportRecovery()));
  assert.equal(exported.marker, "present"); assert.equal(exported.value, null);
});


test("an existing empty-string earlier history is damaged data, not an absent journal", options, async (context) => {
  const env = environment(context);
  const previous = await earlierHistory(env, { format: 1, own: [], activity: [], open: [] });
  env.local.set(previous.name, "");
  const error = await failure(openWallet(env, { checkHistory: true }));
  assert.equal(typeof error.exportRecovery, "function");
  const exported = JSON.parse(new TextDecoder().decode(await error.exportRecovery()));
  assert.equal(exported.key, previous.name); assert.equal(exported.value, "");
  assert.equal(env.local.get(previous.name), ""); assert.equal(env.db.rows.size, 0);
  assert.equal(env.db.writes(), 0); assert.equal(env.locks.held.size, 0);
});


test("synchronous IDB request failures abort and close every connection before refusing payment", options, async (context) => {
  const env = environment(context);
  for (const behavior of ["throw-store", "throw-put"]) {
    env.db.configure("strict");
    const wallet = await openWallet(env);
    try {
      const rpc = await node(wallet, env), prior = clone(env.db.rows.get(publicKey(env.owner)));
      const eventStart = env.db.events.length;
      env.db.configure(behavior);
      await assert.rejects(rpc.send(), { code: "unconfirmed" });
      assert.equal(rpc.posts.length, 0, behavior);
      assert.deepEqual(env.db.rows.get(publicKey(env.owner)), prior);
      assert.equal(env.db.closes(), env.db.opens(), "every failed IDB action closes its connection");
      assert.ok(env.db.events.slice(eventStart).includes("abort"));
    } finally { env.db.configure("strict"); await wallet.close(); }
    assert.equal(env.locks.held.size, 0);
  }
});

test("synchronous initial journal failure releases the factory lease and leaves storage untouched", options, async (context) => {
  const env = environment(context);
  env.db.configure("throw-put");
  await assert.rejects(openWallet(env));
  assert.equal(env.db.rows.size, 0);
  assert.equal(env.db.closes(), env.db.opens());
  assert.equal(env.locks.held.size, 0);
  env.db.configure("strict");
  const wallet = await openWallet(env);
  await wallet.close();
  assert.equal(env.db.closes(), env.db.opens());
  assert.equal(env.locks.held.size, 0);
});
