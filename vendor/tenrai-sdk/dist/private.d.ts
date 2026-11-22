import type { PrivateTransferStatus } from "./types/private.ts";
/**
 * Whether a wallet may offer private transfers: only when the node reports them active, the
 * protocol's proofs fit the consensus limits, and its internal qualification has completed.
 * Wallets read the status from the node instead of assuming it.
 */
export declare function privateTransfersUsable(status: PrivateTransferStatus): boolean;
