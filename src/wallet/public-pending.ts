import type { OpenTransfer } from "@tenrai/sdk/wallet";
import type { Sent } from "./session.tsx";

/** The durable artifact survives a missing display-cache row or an unverified final status. */
export function retainedPublicRows(rows: readonly Sent[], retained: readonly OpenTransfer[]): Sent[] {
  const next = new Map(rows.map((entry) => [entry.transactionId, entry]));
  for (const transfer of retained) {
    const prior = next.get(transfer.transactionId);
    next.set(transfer.transactionId, { ...(prior ?? { transactionId: transfer.transactionId, label: "Retained public transaction", atoms: 0n, internal: true,
      sentAt: transfer.sentAt, amountUnknown: true }), validUntil: transfer.validUntil,
      needsReview: transfer.needsReview === true, resendPaused: transfer.resendPaused === true });
  }
  return [...next.values()].sort((a, b) => b.sentAt - a.sentAt);
}
