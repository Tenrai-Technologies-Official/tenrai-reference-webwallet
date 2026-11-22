import { TenraiError } from "../errors.ts";
export type WebSocketConstructor = new (url: string, protocols?: string | string[]) => WebSocket;
export interface ReconnectOptions {
    /** First delay after a lost connection; it doubles up to `maxDelayMillis`, with jitter. */
    minDelayMillis?: number;
    maxDelayMillis?: number;
}
export interface CloseInfo {
    code: number;
    reason: string;
    /** Set while the socket will reconnect. */
    retryInMillis?: number;
}
export type Listener<Args extends unknown[]> = (...args: Args) => void;
/** What a caller's listener throws surfaces as an uncaught error and leaves the socket alone. */
export declare function invoke<Args extends unknown[]>(listener: Listener<Args>, ...args: Args): void;
export declare class Emitter<Events extends Record<string, unknown[]>> {
    #private;
    /** Returns a function that removes the listener. */
    on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void;
    off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void;
    protected emit<K extends keyof Events>(event: K, ...args: Events[K]): void;
}
export declare function webSocketConstructor(given: WebSocketConstructor | undefined): WebSocketConstructor;
export declare class Backoff {
    #private;
    constructor(options?: ReconnectOptions);
    next(): number;
    reset(): void;
}
export interface ConnectionHandlers {
    opened(): void;
    message(text: string): void;
    /** False stops reconnecting. */
    closed(info: CloseInfo): boolean;
    failed(error: TenraiError): void;
}
export interface ConnectionOptions {
    factory: WebSocketConstructor;
    url: () => string;
    protocol: string;
    maxMessageChars: number;
    idleMillis: number;
    reconnect?: ReconnectOptions | undefined;
    /** Frames sent per second, in bursts of the same size; unset sends at once. */
    framesPerSecond?: number | undefined;
}
/** One WebSocket at a time, reopened after every loss until `stop`. */
export declare class Connection {
    #private;
    constructor(options: ConnectionOptions, handlers: ConnectionHandlers);
    get open(): boolean;
    get stopped(): boolean;
    start(): void;
    /** Keeps the delay short after a connection that worked. */
    settled(): void;
    /** Queues the frame behind the pacing; false while no socket is open. */
    send(text: string, sent?: () => void): boolean;
    /** Drops the current socket without waiting for its close handshake; the connection reopens it. */
    restart(code?: number, reason?: string): void;
    stop(): void;
}
