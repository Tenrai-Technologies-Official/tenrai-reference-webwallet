import { indexedDbFinalityGuardStore } from "./finality-guard-indexeddb.js";
const bound = new WeakMap();
export function attachFinalityGuard(root, store) {
    const old = bound.get(root);
    if (old) {
        if (store && old.store !== store) {
            if (old.store === undefined && !old.closed && !old.failed && !old.running.size) {
                old.store = store;
                return;
            }
            throw new Error("Close the wallet before changing its global finality store.");
        }
        return;
    }
    bound.set(root, { store, owned: false, closed: false, failed: false, running: new Set() });
}
function owner(root) {
    attachFinalityGuard(root);
    const entry = bound.get(root);
    if (entry.closed || entry.failed)
        throw new Error("Reopen the wallet after an uncertain finality-store operation.");
    if (!entry.store) {
        if (typeof globalThis.indexedDB === "undefined")
            throw new Error("Configure WalletOptions.finalityStore with sqliteFinalityGuardStore on a dedicated disk database.");
        entry.store = indexedDbFinalityGuardStore();
        entry.owned = true;
    }
    return entry;
}
/** Fetch first: only bounded Rust proof verification and durable ACK hold the global lease. */
export function withFinalityProof(root, network, manifest, verify) {
    let entry;
    try {
        entry = owner(root);
    }
    catch (error) {
        return Promise.reject(error);
    }
    const run = entry.store.run(root.finalityScope(network, manifest), async (sealed, saveExact) => {
        if (entry.closed || entry.failed)
            throw new Error("The wallet finality context closed.");
        try {
            if (sealed !== null)
                root.restoreFinalityState(network, manifest, sealed);
        }
        catch (error) {
            entry.failed = true;
            throw error;
        }
        let result, failure, failed = false;
        try {
            if (root.finalityHalted(network, manifest))
                throw new Error("A genuine finalized quorum conflict halted this wallet.");
            result = await verify(root.finalityHeight(network, manifest));
        }
        catch (error) {
            failure = error;
            failed = true;
        }
        // Even a refused operation must durably retain its genuinely verified conflict.
        if (root.finalityDirty(network, manifest)) {
            try {
                const exact = root.sealFinalityState(network, manifest);
                await saveExact(exact);
                root.acknowledgeFinalityState(network, manifest, exact);
            }
            catch (error) {
                entry.failed = true;
                throw error;
            }
        }
        if (root.finalityHalted(network, manifest))
            throw new Error("A genuine finalized quorum conflict halted this wallet.");
        if (failed)
            throw failure;
        root.assertFinalitySafe(network, manifest);
        return result;
    });
    entry.running.add(run);
    void run.finally(() => entry.running.delete(run)).catch(() => { });
    return run;
}
export async function closeFinalityGuard(root) {
    const entry = bound.get(root);
    if (!entry)
        return;
    entry.closed = true;
    await Promise.allSettled([...entry.running]);
    if (entry.owned)
        await entry.store?.close();
}
