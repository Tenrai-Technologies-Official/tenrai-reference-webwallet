import { type PrivateTransferStatus, privateTransfersUsable } from "@tenrai/sdk";

const grouped = new Intl.NumberFormat("en-US");

/** `undefined` while loading, `null` if the node is unavailable. */
export function privateTransfersText(status: PrivateTransferStatus | null | undefined): string {
  if (status === undefined) return "Private transfers: checking the node…";
  if (status === null) return "Private transfers: the node does not report them, so they stay off.";
  const protocol = status.protocol;
  if (privateTransfersUsable(status)) return "Private transfers are active on this network.";
  if (!status.active) return "Private transfers: not active on this network.";
  if (protocol.fits_consensus_limits) return "Private transfers are active on this network; their security review is still open.";
  const proof = grouped.format(protocol.largest_measured_proof_bytes);
  const limit = grouped.format(status.limits.max_proof_bytes);
  return `Private transfers stay off: proofs up to ${proof} B exceed the ${limit} B limit.`;
}
