/**
 * Starts at most `concurrent` requests at once and `perSecond` each second, bursts of `burst`; 0 per second is unlimited.
 * Refusals count against the client's address and enough of them block it for minutes, so one refusal holds back the
 * whole lane, and after it requests go one by one until the refusals stop.
 */
export declare class Lane {
    #private;
    constructor(concurrent: number, perSecond: number, burst: number);
    /** Resolves with the function that frees the slot again. */
    enter(signal?: AbortSignal): Promise<() => void>;
    /** The service refused a request of this lane and asked for this wait; each further refusal waits longer. */
    refused(askedMillis: number): void;
}
