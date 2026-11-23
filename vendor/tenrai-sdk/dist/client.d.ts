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
    /** WebSocket implementation for runtimes without a global one. */
    WebSocket?: WebSocketConstructor;
    /** Reconnect policy shared by the client's sockets. */
    reconnect?: ReconnectOptions;
}
/** Client for a Tenrai node or gateway. */
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
    /** Follow finalized cuts, resuming by height after reconnects. */
    events(options?: EventStreamOptions): EventStream;
}
