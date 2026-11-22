import { AddressApi, KeysApi, ProofsApi } from "./api/address.js";
import { ChainApi, EconomicsApi, FeesApi } from "./api/chain.js";
import { PrivateTransfersApi } from "./api/private.js";
import { BlocksApi, CutsApi } from "./api/ledger.js";
import { MempoolApi } from "./api/mempool.js";
import { NetworkApi, NodeApi, WorkApi } from "./api/node.js";
import { StakingApi } from "./api/staking.js";
import { TransactionsApi } from "./api/transactions.js";
import { Transport } from "./http.js";
import { EventStream } from "./sockets/events.js";
import { LiveSocket } from "./sockets/live.js";
import { webSocketConstructor } from "./sockets/socket.js";
/** A client for one Tenrai node or gateway; both answer the same routes. */
export class TenraiClient {
    node;
    chain;
    economics;
    fees;
    privateTransfers;
    mempool;
    work;
    network;
    transactions;
    blocks;
    cuts;
    staking;
    address;
    keys;
    proofs;
    #http;
    #WebSocket;
    #reconnect;
    constructor(options = {}) {
        this.#http = new Transport(options);
        this.#WebSocket = options.WebSocket;
        this.#reconnect = options.reconnect;
        this.node = new NodeApi(this.#http);
        this.chain = new ChainApi(this.#http);
        this.economics = new EconomicsApi(this.#http);
        this.fees = new FeesApi(this.#http);
        this.privateTransfers = new PrivateTransfersApi(this.#http);
        this.mempool = new MempoolApi(this.#http);
        this.work = new WorkApi(this.#http);
        this.network = new NetworkApi(this.#http);
        this.transactions = new TransactionsApi(this.#http, {
            factory: () => this.#WebSocket ?? globalThis.WebSocket,
            reconnect: this.#reconnect,
        });
        this.blocks = new BlocksApi(this.#http);
        this.cuts = new CutsApi(this.#http);
        this.staking = new StakingApi(this.#http);
        this.address = new AddressApi(this.#http);
        this.keys = new KeysApi(this.#http);
        this.proofs = new ProofsApi(this.#http);
    }
    get url() {
        return this.#http.base.href;
    }
    get target() {
        return this.#http.target;
    }
    /** `GET /health`: true when the server answers "ok". */
    async health(options) {
        return (await this.#http.text("/health", options)).trim() === "ok";
    }
    /** Opens `/v1/ws` for subscriptions and read requests. */
    live(options = {}) {
        return new LiveSocket(this.#http, webSocketConstructor(this.#WebSocket), {
            reconnect: this.#reconnect,
            ...options,
        });
    }
    /** Opens `/v1/events`: every finalized cut in order, resumed by height after each reconnect. */
    events(options = {}) {
        return new EventStream(this.#http, webSocketConstructor(this.#WebSocket), {
            reconnect: this.#reconnect,
            ...options,
        });
    }
}
