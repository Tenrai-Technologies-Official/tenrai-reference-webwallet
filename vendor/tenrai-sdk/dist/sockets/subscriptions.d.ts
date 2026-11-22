import type { TenraiApiError } from "../errors.ts";
import type { ClientFrame, EventResyncReason, SocketEvent, SocketTopic, TopicEvents } from "../types/streams.ts";
export type SubscribeOptions<T extends SocketTopic> = {
    topic: T;
    onEvent: (event: TopicEvents[T]) => void;
    /** Events may have been missed, also after a reconnect; read the state again over HTTP. */
    onResync?: (reason: EventResyncReason) => void;
    /** The server refused the subscription for good; without it the socket's `error` event reports it. */
    onError?: (error: TenraiApiError) => void;
} & (T extends "transaction" ? {
    transactionId: string;
} : T extends "addresses" ? {
    addresses: string[];
} : unknown);
export interface LiveSubscription {
    readonly topic: SocketTopic;
    close(): void;
}
interface Subscriber {
    onEvent: (event: SocketEvent) => void;
    onResync: ((reason: EventResyncReason) => void) | undefined;
    onError: ((error: TenraiApiError) => void) | undefined;
}
/** One subscription on the server; a node answers an equal subscribe with the same id. */
export interface Group {
    key: string;
    topic: SocketTopic;
    transactionId: string | undefined;
    addresses: string[] | undefined;
    subscribers: Set<Subscriber>;
    server: number | undefined;
    pending: number | undefined;
    retry: ReturnType<typeof setTimeout> | undefined;
    attempts: number;
    latest: SocketEvent | undefined;
}
/** What the socket lends its subscriptions. */
export interface Link {
    /** False while no socket is open. */
    send(frame: ClientFrame): boolean;
    /** A frame id whose answer comes back to `subscribed` or `refused`. */
    expect(group: Group, resync: boolean): number;
    forget(id: number): void;
    nextId(): number;
    report(error: TenraiApiError): void;
}
/** The subscriptions of one `/v1/ws` socket; equal ones share a group and one subscription on the server. */
export declare class Subscriptions {
    #private;
    constructor(link: Link);
    add<T extends SocketTopic>(options: SubscribeOptions<T>): LiveSubscription;
    /** Subscribes every group the server does not hold, after the socket opened. */
    renew(reopened: boolean): void;
    /** The socket closed, and with it every subscription on the server. */
    reset(): void;
    clear(): void;
    subscribed(group: Group, subscription: number, resync: boolean): void;
    refused(group: Group, error: TenraiApiError): void;
    notify(subscription: number, event: SocketEvent): void;
    resync(subscription: number, reason: EventResyncReason): void;
}
export {};
