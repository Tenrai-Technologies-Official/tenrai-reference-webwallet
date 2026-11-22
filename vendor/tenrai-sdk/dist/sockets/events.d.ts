import { type TenraiError } from "../errors.ts";
import type { Transport } from "../http.ts";
import type { FinalizedCut } from "../types/common.ts";
import type { CutFinalizedEvent, EventCheckpoint, EventResyncReason } from "../types/streams.ts";
import { type CloseInfo, Emitter, type ReconnectOptions, type WebSocketConstructor } from "./socket.ts";
export declare const NODE_EVENT_PROTOCOL = "tenrai.node-events.v1";
export interface EventStreamOptions {
    /** Delivers every cut above this height first; without it the stream starts at the node's head. */
    afterHeight?: number;
    reconnect?: ReconnectOptions;
    /** A healthy stream carries a cut every few seconds; after this long without one it reconnects. */
    idleTimeoutMillis?: number;
}
export interface EventResync {
    reason: EventResyncReason;
    /** The node's head when it could not replay; the stream continues after it. */
    finalized: FinalizedCut;
}
export type EventStreamEvents = {
    checkpoint: [EventCheckpoint];
    cut: [CutFinalizedEvent];
    resync: [EventResync];
    open: [];
    close: [CloseInfo];
    error: [TenraiError];
};
/** Every finalized cut exactly once and in order, resumed by height after each reconnect. */
export declare class EventStream extends Emitter<EventStreamEvents> {
    #private;
    /** @internal */
    constructor(http: Transport, factory: WebSocketConstructor, options?: EventStreamOptions);
    /** The height of the last cut delivered, or where the stream resumes. */
    get lastHeight(): number | undefined;
    close(): void;
}
