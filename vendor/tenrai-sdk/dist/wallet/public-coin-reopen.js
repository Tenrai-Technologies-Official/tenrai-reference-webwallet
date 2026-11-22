import { ResumableCoinInventory, PublicCoinHistoryGap, publicCoinRecoveryObservations } from "./public-coin-resume.js";
/** An expired advisory range permits one fresh owned generation, never an authoritative journal reset. */
export async function reopenPublicCoins(options) {
    if (options.rebuild) {
        await options.previous?.close();
        let store = await options.factory(), observed = options.observed;
        try {
            try {
                const checkpoint = await store.recover(options.codec);
                if (checkpoint) {
                    const saved = publicCoinRecoveryObservations(checkpoint);
                    saved.forEach(options.restore);
                    observed = [...new Map([...saved, ...observed].map(row => [row.address, row])).values()];
                }
            }
            catch {
                // An explicit operator action may discard an unreadable owned cache, never authoritative journals.
                await store.close();
                store = await options.factory();
            }
            observed = await options.observe(observed);
            return await ResumableCoinInventory.open(options.source, observed, store, options.codec, options.held, options.restore, options.budget, options.cancelled, true);
        }
        catch (error) {
            await store.close().catch(() => { });
            throw error;
        }
    }
    let observed = options.observed, reset = false;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            if (attempt === 0 && options.previous) {
                await options.previous.refresh(observed, options.budget);
                return options.previous;
            }
            const store = await options.factory();
            return await ResumableCoinInventory.open(options.source, observed, store, options.codec, options.held, options.restore, options.budget, options.cancelled, reset);
        }
        catch (error) {
            if (!(error instanceof PublicCoinHistoryGap) || attempt !== 0)
                throw error;
            await options.previous?.close();
            const rows = new Map([...error.tracked, ...observed].map(row => [row.address, row]));
            observed = await options.observe([...rows.values()]);
            reset = true;
        }
    }
    throw new Error("The retained public history changed again during its bounded rebuild.");
}
