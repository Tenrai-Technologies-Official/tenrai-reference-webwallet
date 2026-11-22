import { TenraiWalletError } from "../errors.js";
const HASH = /^[0-9a-f]{96}$/;
const DECIMAL = /^(0|[1-9][0-9]{0,38})$/;
function object(text, limit) {
    if (typeof text !== "string" || text.length > limit)
        throw new TypeError("Oversized local private inventory response.");
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new TypeError("Invalid local private inventory response.");
    return value;
}
function identity(value) {
    if (typeof value !== "string" || !HASH.test(value))
        throw new TypeError("Invalid private inventory identity.");
    return value;
}
function decimal(value) {
    if (typeof value !== "string" || !DECIMAL.test(value))
        throw new TypeError("Invalid private inventory count.");
    return BigInt(value);
}
function needed(store) {
    if (!store)
        throw new TenraiWalletError("Provide a durable encrypted private inventory store.", "rejected");
    return store;
}
function live(assertOpen, call) { assertOpen(); call.signal?.throwIfAborted(); }
export async function readInventory(scan, store, id, assertOpen, call) {
    live(assertOpen, call);
    identity(id);
    const bytes = await needed(store).read(id);
    live(assertOpen, call);
    if (bytes === null)
        throw new TenraiWalletError("A private inventory page is missing; rescan authenticated history.", "invalid");
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 40 || bytes.byteLength > 16424)
        throw new TypeError("Invalid encrypted private inventory page.");
    scan.takeInventoryRead(id, bytes);
}
export async function writeInventory(scan, store, id, assertOpen, call) {
    live(assertOpen, call);
    identity(id);
    await needed(store).write(id, scan.inventoryWriteBytes(id));
    live(assertOpen, call);
    scan.inventoryWritten(id);
}
export async function inventoryQuery(scan, store, assertOpen, call) {
    for (;;) {
        live(assertOpen, call);
        const request = object(scan.inventoryNext(), 1024);
        if (request["kind"] === "done")
            return object(scan.inventoryResult(), 64 * 1024);
        if (request["kind"] !== "inventory_read")
            throw new TypeError("A local private query requested an unsupported operation.");
        await readInventory(scan, store, identity(request["id"]), assertOpen, call);
    }
}
export async function inventoryNotePage(scan, store, after, limit, assertOpen, call) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 128)
        throw new RangeError("Private note page limit must be between 1 and 128.");
    live(assertOpen, call);
    scan.beginNotePage(after, limit);
    const value = await inventoryQuery(scan, store, assertOpen, call);
    if (!Array.isArray(value["notes"]) || value["notes"].length > limit)
        throw new TypeError("Invalid local private note page.");
    const notes = value["notes"].map((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row))
            throw new TypeError("Invalid local private note.");
        const note = row;
        const leaf = note["note"];
        if (typeof leaf !== "number" || !Number.isSafeInteger(leaf) || leaf < 0)
            throw new TypeError("Invalid local private note coordinate.");
        const amount = decimal(note["value_atoms"]);
        if (amount === 0n)
            throw new TypeError("Invalid local private note amount.");
        return { note: leaf, valueAtoms: amount, noteCommitment: identity(note["note_commitment"]) };
    });
    if (notes.some((note, index) => index > 0 && notes[index - 1].note >= note.note))
        throw new TypeError("Unordered local private note page.");
    const next = value["next_note"];
    if (next !== null && (typeof next !== "number" || !Number.isSafeInteger(next) || notes.at(-1)?.note !== next))
        throw new TypeError("Invalid local private note cursor.");
    return { notes, nextNote: next };
}
/** Runs only after the exact state bytes and all referenced objects have durably committed. */
export async function collectInventory(scan, store, sealedState, assertOpen, call) {
    live(assertOpen, call);
    const value = object(scan.inventoryRoots(), 16 * 1024);
    if (!Array.isArray(value["roots"]) || value["roots"].length > 16)
        throw new TypeError("Invalid private inventory roots.");
    const roots = value["roots"].map((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row))
            throw new TypeError("Invalid private inventory root.");
        const root = row;
        const tree = root["tree"];
        if (typeof tree !== "number" || !Number.isInteger(tree) || tree < 1 || tree > 4)
            throw new TypeError("Invalid private inventory tree.");
        return { tree: tree, generation: identity(root["generation"]), id: identity(root["id"]) };
    });
    if (!store) {
        if (roots.length)
            needed(store);
        return;
    }
    const usage = await store.usage();
    live(assertOpen, call);
    if (typeof usage.collecting !== "boolean")
        throw new TypeError("Invalid private inventory collection state.");
    if (!usage.collecting && decimal(usage.sealedBytes) <= decimal(value["sealed_byte_budget"]))
        return;
    const digest = await globalThis.crypto.subtle.digest("SHA-384", sealedState.slice().buffer);
    live(assertOpen, call);
    const token = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    await store.beginCollection(token, roots);
    live(assertOpen, call);
    for (;;) {
        const pending = await store.pendingCollection();
        live(assertOpen, call);
        if (pending.length > 64)
            throw new TypeError("Private inventory collection exceeded its page bound.");
        if (!pending.length)
            break;
        for (const root of pending) {
            const bytes = await store.read(root.id);
            live(assertOpen, call);
            if (bytes === null)
                throw new TenraiWalletError("A committed private inventory page is missing; rescan authenticated history.", "invalid");
            const text = scan.inventoryChildren(root.tree, root.generation, root.id, bytes);
            if (text.length > 4096)
                throw new TypeError("Oversized private inventory child list.");
            const children = JSON.parse(text);
            if (!Array.isArray(children) || children.length > 32)
                throw new TypeError("Invalid private inventory child list.");
            await store.markCollection(root, children.map(identity));
            live(assertOpen, call);
        }
    }
    while (!await store.sweepCollection(token))
        live(assertOpen, call);
    live(assertOpen, call);
}
