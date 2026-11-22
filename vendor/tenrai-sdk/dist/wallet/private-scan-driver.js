import { TenraiApiError, TenraiWalletError } from "../errors.js";
import { collectInventory, readInventory, writeInventory } from "./private-inventory-runtime.js";
function live(context, call) { context.assertOpen(); call.signal?.throwIfAborted(); }
function notHeld(error) { return error instanceof TenraiApiError && error.status === 404; }
export async function answerPrivateScan(context, request, call) {
    const { scan, client } = context;
    const api = client.privateTransfers;
    live(context, call);
    switch (request.kind) {
        case "checkpoint": {
            const sealed = await context.save();
            live(context, call);
            await context.localPages?.clearExcept(scan.scratchGeneration() ?? null);
            live(context, call);
            await collectInventory(scan, context.inventoryPages, sealed, context.assertOpen, call);
            scan.checkpointWritten();
            return;
        }
        case "inventory_read": return readInventory(scan, context.inventoryPages, request.id, context.assertOpen, call);
        case "inventory_write": return writeInventory(scan, context.inventoryPages, request.id, context.assertOpen, call);
        case "local_read": {
            if (!context.localPages)
                throw new TenraiWalletError("Provide a durable encrypted private recovery store.", "rejected");
            const bytes = await context.localPages.read(request.generation, request.page);
            live(context, call);
            if (bytes === null)
                throw new TenraiWalletError("An encrypted private recovery page is missing; rescan authenticated history.", "invalid");
            scan.takeLocalRead(bytes);
            return;
        }
        case "local_write": {
            if (!context.localPages)
                throw new TenraiWalletError("Provide a durable encrypted private recovery store.", "rejected");
            await context.localPages.write(request.generation, request.page, scan.localWriteBytes());
            live(context, call);
            scan.localWritten();
            return;
        }
        case "anchor": {
            const answer = await api.anchor(call);
            live(context, call);
            await context.proof(() => scan.takeAnchor(JSON.stringify(answer)));
            return;
        }
        case "bridge": {
            const answer = await api.finalityBridge(request.after, { ...call, maxLinks: 1, maxResponseBytes: 2 * 1024 * 1024 });
            live(context, call);
            await context.proof(() => scan.takeBridge(JSON.stringify(answer)));
            // Each certified bridge advances a bounded durable frontier even before note recovery starts.
            await context.save();
            return;
        }
        case "cut_proof": {
            const answer = await api.finalizedCutProof(request.height, call);
            live(context, call);
            await context.proof(() => scan.takeCutProof(JSON.stringify(answer)));
            return;
        }
        case "notes": {
            let page;
            try {
                page = await api.notes({ ...call, from: request.from, limit: 512 });
            }
            catch (error) {
                if (!notHeld(error))
                    throw error;
                await context.readRecords(call);
                live(context, call);
                scan.notesRefused();
                return;
            }
            live(context, call);
            scan.takeNotes(JSON.stringify(page));
            return;
        }
        case "spend_proof": {
            let page;
            try {
                page = await api.nullifierUpdate({ ...call, fromHeight: request.from_height, atHeight: request.at_height, root: request.root });
            }
            catch (error) {
                if (!notHeld(error))
                    throw error;
                live(context, call);
                scan.spendProofRefused();
                return;
            }
            live(context, call);
            scan.takeSpendProof(JSON.stringify(page));
            return;
        }
        case "spend_keys": {
            let page;
            try {
                page = await api.nullifierKeys({ ...call, atHeight: request.at_height,
                    ...(request.after === null ? {} : { after: request.after }), limit: 512 });
            }
            catch (error) {
                if (!notHeld(error))
                    throw error;
                live(context, call);
                scan.spendKeysRefused();
                return;
            }
            live(context, call);
            scan.takeSpendKeys(JSON.stringify(page));
            return;
        }
    }
}
