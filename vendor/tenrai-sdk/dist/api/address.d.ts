import type { CallOptions, Transport } from "../http.ts";
import type { AddressBalance, AddressBalances, AddressChanges, AddressHistoryPage, AddressHistoryRange, AddressHistoryRangesPage, AddressUtxoBatch, KeyReferenceBatch, UtxoPage } from "../types/address.ts";
import type { FinalizedCut, OutPoint, SpendLockCommitmentHex } from "../types/common.ts";
import type { FinalizedKeyRegistryProofResponse, FinalizedUtxoProofResponse, FinalizedUtxoPresenceResponse } from "../types/mempool.ts";
import type { UnbondingPositions } from "../types/staking.ts";
export declare const MAX_ADDRESS_BATCH = 64;
export declare const MAX_UTXO_PROOFS = 8;
/** Maximum direct ML-DSA-65 locks one `proofs.keys` request can prove. */
export declare const MAX_KEY_REGISTRY_PROOFS = 5;
export interface PageOptions extends CallOptions {
    /** `next_cursor` of the previous page. */
    cursor?: string;
    limit?: number;
}
export interface UtxoPageOptions extends PageOptions {
    /** Canonical 104-hex outpoint for a moving walk; mutually exclusive with cursor. */
    after?: string;
}
export declare function utxoPageQuery(options: UtxoPageOptions): {
    cursor: string | undefined;
    after: string | undefined;
    limit: number | undefined;
};
export declare function pageQuery(options: PageOptions): {
    cursor: string | undefined;
    limit: number | undefined;
};
export declare class AddressApi {
    #private;
    /** @internal */
    constructor(http: Transport);
    /** `GET /v1/address/{address}/balance`: finalized balance and number of unspent outputs. */
    balance(owner: string, options?: CallOptions): Promise<AddressBalance>;
    /** `GET /v1/address/{address}/utxos`: pinned cursor pages or moving after pages; each reports `anchor`. */
    utxos(owner: string, options?: UtxoPageOptions): Promise<UtxoPage>;
    /** `GET /v1/address/{address}/history`: outputs received and spent, newest first, paged. */
    history(owner: string, options?: PageOptions): Promise<AddressHistoryPage>;
    /** Finite ascending changes in (afterHeight,atHeight], received before spent within each cut. */
    historyRange(owner: string, afterHeight: number, atHeight: number, options?: PageOptions): Promise<AddressHistoryPage>;
    /** Finite ordered ranges for up to64 owners, with at most256 events in total. */
    historyRanges(ranges: readonly AddressHistoryRange[], atHeight: number, options?: PageOptions): Promise<AddressHistoryRangesPage>;
    /** `GET /v1/address/{address}/unbonding`: stake this address is unbonding, with when each position can be withdrawn. */
    unbonding(owner: string, options?: PageOptions): Promise<UnbondingPositions>;
    /** `POST /v1/address/balances`: balances of up to 64 addresses at one indexed height. */
    balances(owners: readonly string[], options?: CallOptions): Promise<AddressBalances>;
    /** `POST /v1/address/utxos`: up to 256 outputs per address; read a `truncated` one page by page with `utxos`. */
    utxoBatch(owners: readonly string[], options?: CallOptions): Promise<AddressUtxoBatch>;
    /** `POST /v1/address/changes`: what the cuts after `afterHeight` received and spent, for up to 64 addresses. */
    changes(owners: readonly string[], afterHeight: number, options?: CallOptions): Promise<AddressChanges>;
}
export declare class KeysApi {
    #private;
    /** @internal */
    constructor(http: Transport);
    /** `POST /v1/keys/registered`: whether each address has a registered key at the node's current work anchor. */
    registered(owners: readonly string[], options?: CallOptions): Promise<KeyReferenceBatch>;
}
export declare class ProofsApi {
    #private;
    /** @internal */
    constructor(http: Transport);
    /** `POST /v1/proofs/utxos`: proofs that up to eight outputs are unspent at a finalized cut such as `chain.head()`. */
    utxos(anchor: FinalizedCut, outpoints: readonly OutPoint[], options?: CallOptions): Promise<FinalizedUtxoProofResponse>;
    /** Proves presence or explicit absence for every requested output at an independently authenticated cut. */
    utxoPresence(anchor: FinalizedCut, outpoints: readonly OutPoint[], options?: CallOptions): Promise<FinalizedUtxoPresenceResponse>;
    /**
     * `POST /v1/proofs/keys`: membership or absence proofs for one to five ML-DSA-65 lock commitments at this
     * finalized cut. The proofs bind to the cut's state root, not to its finality: authenticate the cut first.
     */
    keys(anchor: FinalizedCut, lockCommitments: readonly SpendLockCommitmentHex[], options?: CallOptions): Promise<FinalizedKeyRegistryProofResponse>;
}
