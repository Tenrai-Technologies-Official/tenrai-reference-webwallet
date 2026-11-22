import { withFinalityProof } from "./finality-guard.js";
/** A separate head-only context never replaces the note scan's authenticated balance. */
export async function registrationContext(wasm, root, network, account, genesis, client, ownerAuthorization, call, existing) {
    const scan = existing ?? new wasm.PrivateScan(root, network, genesis, account, undefined, undefined);
    try {
        await advanceHead(scan, client, call, root, network, genesis);
        const owner = ownerAuthorization === undefined ? scan.privateAddress() : scan.authorizationOwner(ownerAuthorization);
        const validity = JSON.parse(wasm.privateRules()).validity_cuts;
        if (!Number.isSafeInteger(validity) || validity < 4)
            throw new Error("Invalid registration validity window.");
        const budget = Math.floor(validity / 4);
        for (let attempt = 0; attempt < 4; attempt += 1) {
            await records(scan, owner, client, call);
            const checked = registrationHeight(scan);
            await advanceHead(scan, client, call, root, network, genesis);
            const latest = registrationHeight(scan);
            if (latest < checked)
                throw new Error("Registration finality moved backwards.");
            if (latest - checked <= budget) {
                // The expensive initial stream is complete. Rebase only its bounded recent suffix.
                await records(scan, owner, client, call);
                return scan;
            }
        }
        throw new Error("The registration record stream could not catch the verified head; retry before signing.");
    }
    catch (error) {
        if (!existing)
            scan.free();
        throw error;
    }
}
export function registrationHeight(scan) {
    const height = JSON.parse(scan.registrationVerifiedHead()).finalized.height;
    if (!Number.isSafeInteger(height) || height < 0)
        throw new Error("Invalid verified registration height.");
    return height;
}
export async function registrationHead(wasm, root, network, account, genesis, client, call, existing) {
    const scan = existing ?? new wasm.PrivateScan(root, network, genesis, account, undefined, undefined);
    try {
        await advanceHead(scan, client, call, root, network, genesis);
        return scan;
    }
    catch (error) {
        if (!existing)
            scan.free();
        throw error;
    }
}
/** What the WASM says when a context's head is older than finality another part of the wallet verified. */
const BEHIND = "the public money head is behind already verified wallet finality";
export const behindFinality = (error) => String(error instanceof Error ? error.message : error).includes(BEHIND);
/** A bridge can carry the wallet's finality past the anchor the node served a moment before; the head is read again. */
async function advanceHead(scan, client, call, root, network, genesis) {
    for (let attempt = 0;; attempt += 1) {
        await readHead(scan, client, call, root, network, genesis);
        try {
            registrationHeight(scan);
            return;
        }
        catch (error) {
            if (attempt >= 2 || !behindFinality(error))
                throw error;
        }
    }
}
async function readHead(scan, client, call, root, network, genesis) {
    await withFinalityProof(root, network, genesis, () => scan.startHeadOnly());
    let previous = "";
    for (;;) {
        call.signal?.throwIfAborted();
        const next = await withFinalityProof(root, network, genesis, () => scan.next());
        if (next === previous)
            throw new Error("The registration head proof made no progress.");
        previous = next;
        const request = JSON.parse(next);
        if (request.kind === "done")
            break;
        if (request.kind === "anchor") {
            const answer = await client.privateTransfers.anchor(call);
            await withFinalityProof(root, network, genesis, () => scan.takeAnchor(JSON.stringify(answer)));
        }
        else if (request.kind === "bridge" && typeof request.after === "string") {
            const answer = await client.privateTransfers.finalityBridge(request.after, { ...call, maxLinks: 1, maxResponseBytes: 2 * 1024 * 1024 });
            await withFinalityProof(root, network, genesis, () => scan.takeBridge(JSON.stringify(answer)));
        }
        else if (request.kind === "cut_proof" && Number.isSafeInteger(request.height)) {
            const answer = await client.privateTransfers.finalizedCutProof(request.height, call);
            await withFinalityProof(root, network, genesis, () => scan.takeCutProof(JSON.stringify(answer)));
        }
        else
            throw new Error("Unexpected request from the registration head verifier.");
    }
}
async function records(scan, owner, client, call) {
    scan.beginRecords(JSON.stringify([owner]));
    let previousIndex;
    for (;;) {
        const from = scan.recordsFrom();
        if (from === undefined)
            return;
        const index = Number(from);
        if (!Number.isSafeInteger(index) || index < 0)
            throw new Error("Invalid registration record cursor.");
        if (index === previousIndex)
            throw new Error("The registration record proof made no progress.");
        previousIndex = index;
        scan.takeRecords(JSON.stringify(await client.privateTransfers.records({ ...call, from: index, limit: 512 })));
    }
}
