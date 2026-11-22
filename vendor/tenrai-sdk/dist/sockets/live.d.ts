import { type TenraiError } from "../errors.ts";
import { type Transport } from "../http.ts";
import type { SocketTopic } from "../types/streams.ts";
import { type CloseInfo, Emitter, type ReconnectOptions, type WebSocketConstructor } from "./socket.ts";
import { type LiveSubscription, type SubscribeOptions } from "./subscriptions.ts";
export type { LiveSubscription, SubscribeOptions } from "./subscriptions.ts";
export declare const NODE_API_PROTOCOL = "tenrai.node-api.v1";
export interface LiveSocketOptions {
    reconnect?: ReconnectOptions;
    requestTimeoutMillis?: number;
    /** Frames this socket sends per second: 8 for the `api` target, 40 for `node`. */
    framesPerSecond?: number;
}
export type LiveSocketEvents = {
    open: [];
    close: [CloseInfo];
    error: [TenraiError];
};
/** The multiplexed `/v1/ws` socket: subscriptions and read requests over one connection. */
export declare class LiveSocket extends Emitter<LiveSocketEvents> {
    #private;
    /** @internal */
    constructor(http: Transport, factory: WebSocketConstructor, options?: LiveSocketOptions);
    /** Renewed after every reconnect, followed by `onResync`. Equal subscriptions share one on the server. */
    subscribe<T extends SocketTopic>(options: SubscribeOptions<T>): LiveSubscription;
    /** A GET read route answered over the socket, such as "/v1/chain/head". */
    request<T>(path: string): Promise<T>;
    /** Round trip in milliseconds. */
    ping(): Promise<number>;
    close(): void;
}
