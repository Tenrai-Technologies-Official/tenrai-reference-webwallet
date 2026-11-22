import type { FinalizedCut, OutPoint } from "../types/common.ts";
import type { FinalizedUtxoPresenceResponse } from "../types/mempool.ts";
export interface UtxoPresenceRequest {
    api_version: 1;
    anchor: FinalizedCut;
    outpoints: OutPoint[];
}
export declare function utxoPresenceRequest(anchor: FinalizedCut, points: readonly OutPoint[]): UtxoPresenceRequest;
/** Structural binding only. The protocol verifier must check every proof at a certified head. */
export declare function checkedUtxoPresenceResponse(value: unknown, request: UtxoPresenceRequest): FinalizedUtxoPresenceResponse;
