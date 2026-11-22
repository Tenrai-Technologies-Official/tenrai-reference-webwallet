import { AddressApi, KeysApi, ProofsApi } from "./api/address.ts";
import { ChainApi, EconomicsApi, FeesApi } from "./api/chain.ts";
import { PrivateTransfersApi } from "./api/private.ts";
import { BlocksApi, CutsApi } from "./api/ledger.ts";
import { MempoolApi } from "./api/mempool.ts";
import { NetworkApi, NodeApi, WorkApi } from "./api/node.ts";
import { StakingApi } from "./api/staking.ts";
import { TransactionsApi } from "./api/transactions.ts";
import { type CallOptions, type Target, type TransportOptions } from "./http.ts";
import { EventStream, type EventStreamOptions } from "./sockets/events.ts";
import { LiveSocket, type LiveSocketOptions } from "./sockets/live.ts";
import { type ReconnectOptions, type WebSocketConstructor } from "./sockets/socket.ts";
export interface ClientOptions extends TransportOptions {
    /** For runtimes without a global WebSocket, for example `WebSocket` from the ws package. */
    WebSocket?: WebSocketConstructor;
    /** Delays between reconnect attempts of every socket this client opens. */
    reconnect?: ReconnectOptions;
}
/** A client for one Tenrai node or gateway; both answer the same routes. */
export declare class TenraiClient {
    #private;
    readonly node: NodeApi;
    readonly chain: ChainApi;
    readonly economics: EconomicsApi;
    readonly fees: FeesApi;
    readonly privateTransfers: PrivateTransfersApi;
    readonly mempool: MempoolApi;
    readonly work: WorkApi;
    readonly network: NetworkApi;
    readonly transactions: TransactionsApi;
    readonly blocks: BlocksApi;
    readonly cuts: CutsApi;
    readonly staking: StakingApi;
    readonly address: AddressApi;
    readonly keys: KeysApi;
    readonly proofs: ProofsApi;
    constructor(options?: ClientOptions);
    get url(): string;
    get target(): Target;
    /** `GET /health`: true when the server answers "ok". */
    health(options?: CallOptions): Promise<boolean>;
    /** Opens `/v1/ws` for subscriptions and read requests. */
    live(options?: LiveSocketOptions): LiveSocket;
    /** Opens `/v1/events`: every finalized cut in order, resumed by height after each reconnect. */
    events(options?: EventStreamOptions): EventStream;
}
