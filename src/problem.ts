import { TenraiApiError, TenraiNetworkError, TenraiTimeoutError } from "@tenrai/sdk";
import { TenraiWalletError } from "@tenrai/sdk/wallet";
import { trai } from "./format.ts";

/** A node's words for a refused private transaction, in this wallet's. */
const NODE_WORDS: Record<string, string> = {
  "the node already holds this private statement": "The node already holds this private transaction.",
  "another statement the node holds spends a note of this one": "Another private transaction on the node spends a note of this one.",
  "a note of this statement is already spent": "A note of this private transaction is already spent.",
  "another statement the node holds spends an output of this one": "Another private transaction on the node spends a coin of this one.",
  "an output of this statement is not an unspent output": "A coin of this private transaction is already spent.",
  "the owner of this registration has a record already": "This private account is published already.",
  "the private pool of this node is full; retry later": "The node holds as many private transactions as it can. Try again later.",
  "the private statement was refused": "This private transaction does not fit the rules or the state of the chain.",
  "the validity of this private statement has ended": "The validity of this private transaction has ended.",
  "private transfers are not active on this chain": "Private transactions are not active on this network.",
};

/** A sentence for the user, with what to do next where the SDK's code tells it. */
export function problem(error: unknown): string {
  if (error instanceof TenraiWalletError) {
    switch (error.code) {
      case "insufficient": {
        const { available } = error.details;
        return typeof available === "bigint"
          ? `Not enough TRAI: ${trai(available)} can be spent, and the fee comes on top.`
          : "Not enough TRAI for this amount and its fee.";
      }
      case "compound-needed":
        return "This amount needs more coins than one transfer can spend. Compound them under Settings, then send again.";
      case "fee-ceiling":
        return "The automatic fee is unusually high right now. Choose a manual fee to send anyway.";
      case "unconfirmed":
        return "The node did not confirm the transfer in time. The wallet keeps it and sends it again by itself, so do not send it again; it shows under Activity.";
      default:
        return sentence(error.message);
    }
  }
  if (error instanceof TenraiNetworkError || error instanceof TenraiTimeoutError) {
    return "The wallet server does not answer. Try again in a moment.";
  }
  if (error instanceof TenraiApiError || error instanceof Error) {
    return NODE_WORDS[error.message] ?? sentence(error.message);
  }
  return "Something went wrong.";
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}${/[.!?]$/.test(trimmed) ? "" : "."}`;
}
