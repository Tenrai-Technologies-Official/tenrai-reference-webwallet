import assert from "node:assert/strict";
import test from "node:test";
import { TenraiApiError, type TenraiClient, type TransactionLifecycle, type TransactionStatus, type TransactionView } from "@tenrai/sdk";
import { retryNativeTransaction } from "../src/wallet/native-lock-retry.ts";

const prepared = Object.freeze({ transactionId: "17".repeat(48), wireHex: "aabbccdd" });
const missing = () => new TenraiApiError(404, "not_found", "not found");
const status = (lifecycle: TransactionLifecycle = "finalized"): TransactionStatus => ({ api_version: 1, transaction_id: prepared.transactionId, lifecycle, observed_work: null, registered_cut: null, finalized_cut: null, failure: null });
const view = (wire: string = prepared.wireHex) => ({ transaction_id: prepared.transactionId, wire_hex: wire, status: status() }) as TransactionView;
function client(overrides: Record<string, unknown>, submitted: string[] = []) {
  return { transactions: { status: async () => { throw missing(); }, get: async () => view(), submit: async (wire: string) => { submitted.push(wire); return { api_version: 1, transaction_id: prepared.transactionId, lifecycle: "processing" }; }, ...overrides } } as unknown as Pick<TenraiClient, "transactions">;
}

test("explicit retry recognizes the exact pooled or finalized original without another submission", async () => {
  for (const lifecycle of ["processing", "receiving", "registered", "finalized"] as const) {
    const wires: string[] = [];
    const receipt = await retryNativeTransaction(client({ status: async () => status(lifecycle) }, wires), prepared);
    assert.equal(receipt.transaction_id, prepared.transactionId);
    assert.equal(receipt.lifecycle, lifecycle);
    assert.deepEqual(wires, []);
  }
});

test("already-pooled and finalized-input-missing conflicts reconcile only after the original becomes known", async () => {
  for (const reason of ["already_pooled", "input_pooled", "input_missing"] as const) {
    let lookup = 0;
    const wires: string[] = [];
    const transport = client({ status: async () => { if (lookup++ === 0) throw missing(); return status(); }, submit: async (wire: string) => { wires.push(wire); throw new TenraiApiError(409, "conflict", "conflict", undefined, reason); } });
    assert.equal((await retryNativeTransaction(transport, prepared)).lifecycle, "finalized");
    assert.deepEqual(wires, [prepared.wireHex]);
  }
});

test("a lost answer reconciles the exact wire while an unknown conflicting transaction remains an error", async () => {
  let lookup = 0;
  const wires: string[] = [];
  const lost = new Error("connection reset after acceptance");
  const transport = client({ status: async () => { if (lookup++ === 0) throw missing(); return status(); }, submit: async (wire: string) => { wires.push(wire); throw lost; } });
  assert.equal((await retryNativeTransaction(transport, prepared)).transaction_id, prepared.transactionId);
  assert.deepEqual(wires, [prepared.wireHex]);
  const conflict = new TenraiApiError(409, "conflict", "some other spend owns the input", undefined, "input_missing");
  await assert.rejects(retryNativeTransaction(client({ submit: async () => { throw conflict; } }), prepared), (failure) => failure === conflict);
});

test("status, full transaction and wire identity mismatches fail closed", async () => {
  const wires: string[] = [];
  const mismatches = [
    { status: async () => ({ ...status(), transaction_id: "18".repeat(48) }) },
    { status: async () => status(), get: async () => ({ ...view(), transaction_id: "18".repeat(48) }) },
    { status: async () => status(), get: async () => ({ ...view(), status: { ...status(), transaction_id: "18".repeat(48) } }) },
    { status: async () => status(), get: async () => view("different wire") },
    { status: async () => status("failed") },
  ];
  for (const mismatch of mismatches) await assert.rejects(retryNativeTransaction(client(mismatch, wires), prepared));
  assert.deepEqual(wires, []);
});

test("a pruned full view may use the pinned exact original status; unavailable status never fabricates acceptance", async () => {
  assert.equal((await retryNativeTransaction(client({ status: async () => status(), get: async () => { throw missing(); } }), prepared)).lifecycle, "finalized");
  const unavailable = new TenraiApiError(503, "unavailable", "try later");
  const wires: string[] = [];
  await assert.rejects(retryNativeTransaction(client({ status: async () => { throw unavailable; } }, wires), prepared), (failure) => failure === unavailable);
  assert.deepEqual(wires, []);
});

test("an unrelated successful submission receipt is never hidden by a later lookup", async () => {
  let lookups = 0;
  await assert.rejects(retryNativeTransaction(client({ status: async () => { lookups++; throw missing(); }, submit: async () => ({ api_version: 1, transaction_id: "18".repeat(48), lifecycle: "processing" }) }), prepared));
  assert.equal(lookups, 1);
});
