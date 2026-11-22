import assert from "node:assert/strict";
import test from "node:test";
import { retainedPublicRows } from "../src/wallet/public-pending.ts";

const ID = "ab".repeat(48);
const retained = { transactionId: ID, wireHex: "0102", validUntil: 40n, sentAt: 7, spends: [], needsReview: true, resendPaused: false };

test("a retained artifact remains visible even when no display-cache payment row survived", () => {
  const rows = retainedPublicRows([], [retained]);
  assert.equal(rows.length, 1); assert.equal(rows[0].transactionId, ID);
  assert.equal(rows[0].amountUnknown, true); assert.equal(rows[0].needsReview, true);
  assert.equal(rows[0].validUntil, 40n); assert.equal(rows[0].label, "Retained public transaction");
});

test("display final/unknown metadata cannot overwrite the authoritative retained review phase", () => {
  const cached = { transactionId: ID, label: "Payment", atoms: -10n, internal: false, sentAt: 1,
    status: { transaction_id: ID, lifecycle: "finalized" }, needsReview: false };
  const rows = retainedPublicRows([cached], [{ ...retained, resendPaused: true }]);
  assert.equal(rows[0].needsReview, true); assert.equal(rows[0].resendPaused, true);
  assert.equal(rows[0].atoms, -10n); assert.equal(rows[0].amountUnknown, undefined);
  assert.equal(cached.needsReview, false, "the cache input was not mutated");
});

test("a committed direct-ACK phase stays distinct from uncertain retained frames", () => {
  const rows = retainedPublicRows([], [{ ...retained, needsReview: false }]);
  assert.equal(rows[0].needsReview, false); assert.equal(rows[0].transactionId, ID);
});
