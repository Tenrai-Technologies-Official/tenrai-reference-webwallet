import { outcomeBytes, outcomeIdentity } from "./outcome-store.js";
function closedAfter(anchor, entry) {
    const value = entry.validUntil;
    if (typeof value !== "bigint" && (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value)) && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0))
        throw new TypeError("invalid original signed expiry");
    const until = BigInt(value);
    if (until < 0n || until > 0xffffffffffffffffn || BigInt(anchor.height) <= until)
        throw new TypeError("the retained outcome predates canonical signed expiry");
}
export class UnknownOutcomeError extends Error {
    outcome = "unknown";
    digest;
    closedAtHeight;
    constructor(digest, closedAtHeight) {
        super("The original payment outcome is unknown. Do not create a replacement payment automatically.");
        this.name = "UnknownOutcomeError";
        this.digest = digest;
        this.closedAtHeight = closedAtHeight;
    }
}
export function outcomeAnchor(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new TypeError("Invalid outcome coverage anchor.");
    const row = value;
    if (typeof row.height !== "number" || !Number.isSafeInteger(row.height) || row.height < 0)
        throw new TypeError("Invalid outcome coverage height.");
    const hash = (value) => { if (typeof value !== "string" || !/^[0-9a-f]{96}$/.test(value))
        throw new TypeError("Invalid outcome coverage commitment."); return value; };
    return { height: row.height, cut_id: hash(row.cut_id), state_root: hash(row.state_root), validator_set_id: hash(row.validator_set_id) };
}
/** Only the caller's verified coverage can authorize closing an active monetary hold. */
export class OutcomeArchive {
    store;
    codec;
    constructor(store, codec) { this.store = store; this.codec = codec; }
    async read(domain, digest, validate) {
        outcomeIdentity(domain, digest);
        const sealed = await this.store.read(domain, digest);
        if (sealed === null)
            return null;
        const plain = await this.codec.open(this.#id(domain, digest), outcomeBytes(sealed));
        try {
            if (!(plain instanceof Uint8Array) || plain.byteLength > 5 * 1024 * 1024 - 40)
                throw new Error("The outcome record exceeds its bound.");
            const row = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain));
            if (!row || typeof row !== "object" || Array.isArray(row))
                throw new Error("Invalid retained outcome.");
            const item = row;
            if (item.format !== 1 || item.outcome !== "unknown" || item.domain !== domain || item.digest !== digest)
                throw new Error("A retained outcome changed its identity.");
            const closedAt = outcomeAnchor(item.closedAt), entry = validate(item.entry);
            closedAfter(closedAt, entry);
            return { format: 1, outcome: "unknown", domain, digest, closedAt, entry };
        }
        finally {
            if (plain instanceof Uint8Array)
                plain.fill(0);
        }
    }
    async retain(domain, digest, closedAt, entry, validate, same) {
        outcomeIdentity(domain, digest);
        closedAt = outcomeAnchor(closedAt);
        const previous = await this.read(domain, digest, validate);
        if (previous) {
            if (!same(previous.entry, entry))
                throw new Error("The original ambiguous payment artifact cannot be replaced.");
            return previous;
        }
        const checked = validate(entry);
        closedAfter(closedAt, checked);
        const receipt = { format: 1, outcome: "unknown", domain, digest, closedAt, entry: checked };
        const plain = new TextEncoder().encode(JSON.stringify(receipt, (_key, value) => typeof value === "bigint" ? value.toString() : value));
        try {
            if (plain.byteLength > 5 * 1024 * 1024 - 40)
                throw new Error("The retained outcome exceeds its bound.");
            const sealed = outcomeBytes(await this.codec.seal(this.#id(domain, digest), plain));
            await this.store.write(domain, digest, sealed);
            return receipt;
        }
        finally {
            plain.fill(0);
        }
    }
    #id(domain, digest) { return "unknown-" + domain + "-" + digest; }
}
