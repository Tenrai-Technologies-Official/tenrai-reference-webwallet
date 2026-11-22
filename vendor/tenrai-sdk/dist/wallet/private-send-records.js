import { registrationMetadata } from "./private-registration.js";
export const MAX_SENDS_BYTES = 32 * 1024 * 1024;
export const MAX_PENDING_SENDS = 64;
const MAX_FRAME_HEX = 4 * 1024 * 1024;
const MAX_ATOMS = (1n << 128n) - 1n;
const HASH = /^[0-9a-f]{96}$/;
const OUTPOINT = /^([0-9a-f]{96}):(0|[1-9][0-9]{0,9})$/;
const ROUTES = { enter: "enters", transfer: "transfers", exit: "exits", private_register: "registrations" };
function invalid() {
    throw new TypeError("the pending private-send record is damaged; restore an intact copy before spending");
}
function object(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        invalid();
    return value;
}
function integer(value, minimum = 0) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum)
        invalid();
    return value;
}
function amount(value) {
    if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,38})$/.test(value) || BigInt(value) > MAX_ATOMS)
        invalid();
    return value;
}
function commitment(value) {
    if (typeof value !== "string" || !HASH.test(value))
        invalid();
    return value;
}
/** Next-leaf cursors may also equal the exhausted 64-bit tree size. */
export function noteCursor(value) {
    if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > 1n << 64n)
        invalid();
    return value;
}
function destination(value) {
    if (value === null)
        return null;
    if (typeof value !== "string" || value.length === 0 || value.length > 8192)
        invalid();
    return value;
}
function array(value, maximum, read) {
    if (!Array.isArray(value) || value.length > maximum)
        invalid();
    return value.map(read);
}
/** Validates persisted public artifacts and reservation metadata without changing their frame. */
export function sendRecord(value) {
    const item = object(value);
    const digest = item["digest"];
    const kind = item["kind"];
    const stage = item["stage"];
    const frame = item["frameHex"];
    if (typeof digest !== "string" || !HASH.test(digest))
        invalid();
    if (kind !== "enter" && kind !== "transfer" && kind !== "exit" && kind !== "private_register")
        invalid();
    if (item["route"] !== ROUTES[kind])
        invalid();
    if (stage !== "sending" && stage !== "pool" && stage !== "needs_review")
        invalid();
    if (typeof frame !== "string" || frame.length === 0 || frame.length > MAX_FRAME_HEX || frame.length % 2 !== 0 || !/^[0-9a-f]+$/.test(frame))
        invalid();
    const sources = array(item["sources"], 64, (value) => integer(value));
    const inputs = array(item["inputs"], 64, (value) => {
        if (typeof value !== "string")
            invalid();
        const match = OUTPOINT.exec(value);
        if (!match || BigInt(match[2]) > 0xffffffffn)
            invalid();
        return value;
    });
    if (new Set(sources).size !== sources.length || new Set(inputs).size !== inputs.length)
        invalid();
    if ((kind === "enter" || kind === "private_register") ? sources.length !== 0 || inputs.length === 0 : sources.length === 0 || inputs.length !== 0)
        invalid();
    if (kind === "private_register" ? item["amountAtoms"] !== "0" || inputs.length > 8 || (!Array.isArray(item["ownNoteCommitments"]) || item["ownNoteCommitments"].length !== 0) : item["registration"] !== undefined)
        invalid();
    if (item["attempted"] !== undefined && typeof item["attempted"] !== "boolean")
        invalid();
    const own = array(item["ownNoteCommitments"], 2, commitment);
    if (new Set(own).size !== own.length || (kind === "exit" && own.length !== 0))
        invalid();
    const reason = item["reviewReason"];
    if (reason !== undefined && (typeof reason !== "string" || reason.length > 512))
        invalid();
    return {
        digest, kind, route: ROUTES[kind], ...(kind === "private_register" ? { registration: registrationMetadata(item["registration"]) } : {}), amountAtoms: amount(item["amountAtoms"]), feeAtoms: amount(item["feeAtoms"]),
        validUntil: integer(item["validUntil"]), sources, inputs, to: destination(item["to"]), stage,
        time: integer(item["time"]), ownNoteCommitments: own, frameHex: frame,
        // Every restored/prepared durable frame may already have reached another instance or a node.
        attempted: true,
        ...(reason === undefined ? {} : { reviewReason: reason }),
    };
}
export function sendSnapshot(entry) {
    return { ...entry, sources: [...entry.sources], inputs: [...entry.inputs], ownNoteCommitments: [...entry.ownNoteCommitments], ...(entry.registration ? { registration: { ...entry.registration, inputAmountAtoms: [...entry.registration.inputAmountAtoms] } } : {}) };
}
/** The canonical frame inspector binds change metadata to actual statement outputs. */
export function validateOwnNoteCommitments(frame, entry) {
    const outputs = array(object(frame)["output_commitments"], 2, commitment);
    if (new Set(outputs).size !== outputs.length || entry.ownNoteCommitments.some((id) => !outputs.includes(id)))
        invalid();
}
export function samePreparedSend(left, right) {
    const prepared = ({ stage: _stage, time: _time, attempted: _attempted, reviewReason: _reason, ...entry }) => entry;
    return JSON.stringify(prepared(left)) === JSON.stringify(prepared(right));
}
export function savedSends(value) {
    const item = object(value);
    if (item["version"] !== 1)
        invalid();
    const entries = array(item["entries"], MAX_PENDING_SENDS, sendRecord);
    if (new Set(entries.map((entry) => entry.digest)).size !== entries.length)
        invalid();
    const done = array(item["done"], 20, (value) => {
        const record = object(value);
        const kind = record["kind"];
        if (kind !== "enter" && kind !== "transfer" && kind !== "exit" && kind !== "private_register" && kind !== "received")
            invalid();
        return { kind, amountAtoms: amount(record["amountAtoms"]), to: destination(record["to"]),
            height: integer(record["height"]), time: integer(record["time"]) };
    });
    const expected = array(item["expected"], 1024, (value) => {
        const row = object(value);
        return { id: commitment(row["id"]), finalizedHeight: row["finalizedHeight"] === null ? null : integer(row["finalizedHeight"]), closedAtHeight: row["closedAtHeight"] === null ? null : integer(row["closedAtHeight"]) };
    });
    if (new Set(expected.map((row) => row.id)).size !== expected.length)
        invalid();
    return { version: 1, entries, done, nextLeaf: item["nextLeaf"] === null ? null : noteCursor(item["nextLeaf"]), expected };
}
/** Null means absent only; authentication, decoding and shape errors propagate. */
export function openSavedSends(saved, open) {
    if (!(saved instanceof Uint8Array) || saved.byteLength > MAX_SENDS_BYTES + 65536)
        invalid();
    const plain = open(saved.slice());
    try {
        if (!(plain instanceof Uint8Array) || plain.byteLength > MAX_SENDS_BYTES)
            invalid();
        return savedSends(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain)));
    }
    finally {
        if (plain instanceof Uint8Array)
            plain.fill(0);
    }
}
export function encodeSavedSends(value) {
    if (value.expected.length > 1024)
        throw new RangeError("scan pending private outputs before creating another statement");
    if (value.entries.length > MAX_PENDING_SENDS || value.entries.reduce((total, entry) => total + entry.frameHex.length, 0) > MAX_SENDS_BYTES) {
        throw new RangeError("the pending private-send record is full; resolve existing statements before proving another");
    }
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    if (bytes.byteLength > MAX_SENDS_BYTES) {
        bytes.fill(0);
        throw new RangeError("the pending private-send record exceeds its storage limit");
    }
    return bytes;
}
