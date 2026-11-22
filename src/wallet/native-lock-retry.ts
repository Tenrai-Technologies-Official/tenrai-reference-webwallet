import { TenraiApiError, type TenraiClient, type TransactionSubmissionReceipt } from "@tenrai/sdk";

type ExactTransaction = Readonly<{ transactionId: string; wireHex: string }>;
const ACCEPTED = new Set(["processing", "receiving", "registered", "finalized"]);

/** Keep the original reviewed wire. A conflict alone never establishes acceptance. */
export async function retryNativeTransaction(client: Pick<TenraiClient, "transactions">, prepared: ExactTransaction): Promise<TransactionSubmissionReceipt> {
  const known = async (): Promise<TransactionSubmissionReceipt | undefined> => {
    let status;
    try { status = await client.transactions.status(prepared.transactionId); }
    catch (failure) {
      if (failure instanceof TenraiApiError && failure.status === 404 && failure.code === "not_found") return undefined;
      throw failure;
    }
    if (status.transaction_id !== prepared.transactionId) throw new Error("The node returned another transaction's status.");
    if (!ACCEPTED.has(status.lifecycle)) throw new Error("The original transaction is not accepted. Inspect its status before preparing another spend.");
    try {
      const view = await client.transactions.get(prepared.transactionId);
      if (view.transaction_id !== prepared.transactionId || view.status.transaction_id !== prepared.transactionId) throw new Error("The node returned another transaction.");
      if (view.wire_hex !== undefined && view.wire_hex !== null && view.wire_hex !== prepared.wireHex) throw new Error("The node's transaction wire differs from the reviewed transaction.");
    } catch (failure) {
      // A pruned node can retain the exact status while the full wire is unavailable.
      if (!(failure instanceof TenraiApiError && failure.status === 404 && failure.code === "not_found")) throw failure;
    }
    return { api_version: 1, transaction_id: prepared.transactionId, lifecycle: status.lifecycle };
  };
  const previous = await known();
  if (previous) return previous;
  let receipt;
  try { receipt = await client.transactions.submit(prepared.wireHex); }
  catch (failure) {
    const reconciled = await known();
    if (reconciled) return reconciled;
    throw failure;
  }
  if (receipt.transaction_id !== prepared.transactionId || !ACCEPTED.has(receipt.lifecycle)) throw new Error("Submission did not confirm the reviewed transaction.");
  return receipt;
}
