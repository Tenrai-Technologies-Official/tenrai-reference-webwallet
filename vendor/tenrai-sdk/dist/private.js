/**
 * Whether a wallet may offer private transfers: only when the node reports them active, the
 * protocol's proofs fit the consensus limits, and its internal qualification has completed.
 * Wallets read the status from the node instead of assuming it.
 */
export function privateTransfersUsable(status) {
    return (status.active &&
        status.protocol.fits_consensus_limits &&
        (status.protocol.security_qualification === "internally_qualified" ||
            status.protocol.security_qualification === "complete"));
}
