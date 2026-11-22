import type { CallOptions, Transport } from "../http.ts";
import type { NetworkMiningInfo, HistorySyncStatus, NodeIdentity, NodeInfo, NodeStatus, PeerList, StorageInfo, SyncStatus, WorkPoolInfo } from "../types/node.ts";
export declare class NodeApi {
    #private;
    /** @internal */
    constructor(http: Transport);
    /** `GET /v1/node/info`: network, node version, storage mode, address index and finalized head. */
    info(options?: CallOptions): Promise<NodeInfo>;
    /** `GET /v1/node/status`: chain, protocol version and finalized cut. */
    status(options?: CallOptions): Promise<NodeStatus>;
    /** `GET /v1/node/identity`: the ML-DSA-65 key this server signs answers with. */
    identity(options?: CallOptions): Promise<NodeIdentity>;
    /** `GET /v1/node/sync`: whether the node has caught up with its peers. */
    sync(options?: CallOptions): Promise<SyncStatus>;
    /** `GET /v1/node/history-sync`: retained-history bridge advice from connected peers. */
    historySync(options?: CallOptions): Promise<HistorySyncStatus>;
    /** `GET /v1/node/peers`. A gateway answers only if its operator publishes peers. */
    peers(options?: CallOptions): Promise<PeerList>;
    /** `GET /v1/storage`: storage role and the oldest height with block bodies. */
    storage(options?: CallOptions): Promise<StorageInfo>;
}
export declare class WorkApi {
    #private;
    /** @internal */
    constructor(http: Transport);
    /** `GET /v1/work/pool`: blocks the node holds and has queued for registration. */
    pool(options?: CallOptions): Promise<WorkPoolInfo>;
}
export declare class NetworkApi {
    #private;
    /** @internal */
    constructor(http: Transport);
    /** `GET /v1/network/mining`: current work reference, target and block rate. */
    mining(options?: CallOptions): Promise<NetworkMiningInfo>;
}
