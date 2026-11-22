import { TenraiWalletError } from "../errors.js";
/** One minute between checks unless the caller asks otherwise. */
const EVERY_MILLIS = 60_000;
const MIN_EVERY_MILLIS = 5_000;
/** Compounds in the background every `everyMillis` by `above` or `atLeast`; returns the function that stops it. */
export function autoCompound(wallet, client, options) {
    const { above, atLeast, everyMillis = EVERY_MILLIS, onSent, onError, ...fee } = options;
    if (atLeast === undefined ? above === undefined || !Number.isSafeInteger(above) || above < 2 : typeof atLeast !== "bigint" || atLeast <= 0n) {
        throw new TenraiWalletError("automatic compounding needs a limit of at least 2 outputs or a positive amount", "invalid");
    }
    if (!Number.isSafeInteger(everyMillis) || everyMillis < MIN_EVERY_MILLIS) {
        throw new TenraiWalletError(`automatic compounding checks at most every ${MIN_EVERY_MILLIS} ms`, "invalid");
    }
    let stopped = false;
    let timer;
    const round = async () => {
        try {
            const sent = await wallet.compound(client, atLeast === undefined ? { ...fee, above } : { ...fee, atLeast, ...(above === undefined ? {} : { above }) });
            if (sent.length > 0 && !stopped) {
                onSent?.(sent);
            }
        }
        catch (error) {
            if (!stopped) {
                onError?.(error);
            }
        }
        if (!stopped) {
            timer = setTimeout(round, everyMillis);
        }
    };
    timer = setTimeout(round, 0);
    return () => {
        stopped = true;
        clearTimeout(timer);
    };
}
