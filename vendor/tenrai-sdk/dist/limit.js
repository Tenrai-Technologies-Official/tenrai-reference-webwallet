const MAX_HOLD_MILLIS = 5_000;
const CAREFUL_GAP_MILLIS = 400;
const CAREFUL_MILLIS = 10_000;
/**
 * Starts at most `concurrent` requests at once and `perSecond` each second, bursts of `burst`; 0 per second is unlimited.
 * Refusals count against the client's address and enough of them block it for minutes, so one refusal holds back the
 * whole lane, and after it requests go one by one until the refusals stop.
 */
export class Lane {
    #concurrent;
    #perSecond;
    #burst;
    #waiting = [];
    #tokens;
    #refilledAt = performance.now();
    #active = 0;
    #heldUntil = 0;
    #carefulUntil = 0;
    #refusals = 0;
    #timer;
    constructor(concurrent, perSecond, burst) {
        this.#concurrent = concurrent;
        this.#perSecond = perSecond;
        this.#burst = burst;
        this.#tokens = burst;
    }
    /** Resolves with the function that frees the slot again. */
    enter(signal) {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(signal.reason);
                return;
            }
            const start = () => {
                signal?.removeEventListener("abort", abort);
                this.#active += 1;
                let released = false;
                resolve(() => {
                    if (!released) {
                        released = true;
                        this.#active -= 1;
                        this.#next();
                    }
                });
            };
            const abort = () => {
                const index = this.#waiting.indexOf(start);
                if (index >= 0) {
                    this.#waiting.splice(index, 1);
                    reject(signal?.reason);
                }
            };
            signal?.addEventListener("abort", abort, { once: true });
            this.#waiting.push(start);
            this.#next();
        });
    }
    /** The service refused a request of this lane and asked for this wait; each further refusal waits longer. */
    refused(askedMillis) {
        const now = performance.now();
        this.#refusals = now < this.#carefulUntil ? this.#refusals + 1 : 1;
        const wait = Math.min(askedMillis * this.#refusals, MAX_HOLD_MILLIS) + Math.random() * 500;
        this.#heldUntil = Math.max(this.#heldUntil, now + wait);
        this.#carefulUntil = this.#heldUntil + CAREFUL_MILLIS;
    }
    #next() {
        while (this.#waiting.length > 0) {
            const now = performance.now();
            const careful = now < this.#carefulUntil;
            if (this.#active >= (careful ? 1 : this.#concurrent)) {
                return;
            }
            if (now < this.#heldUntil) {
                this.#wakeIn(this.#heldUntil - now);
                return;
            }
            if (this.#perSecond > 0) {
                this.#tokens = Math.min(this.#burst, this.#tokens + ((now - this.#refilledAt) * this.#perSecond) / 1_000);
                this.#refilledAt = now;
                if (this.#tokens < 1) {
                    this.#wakeIn(((1 - this.#tokens) * 1_000) / this.#perSecond);
                    return;
                }
                this.#tokens -= 1;
            }
            if (careful) {
                this.#heldUntil = now + CAREFUL_GAP_MILLIS;
            }
            this.#waiting.shift()?.();
        }
    }
    #wakeIn(millis) {
        this.#timer ??= setTimeout(() => {
            this.#timer = undefined;
            this.#next();
        }, Math.ceil(millis));
    }
}
