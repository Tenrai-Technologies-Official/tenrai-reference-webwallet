export const PUBLIC_COIN_PAGE = 256;
export const PUBLIC_COIN_U128_MAX = (1n << 128n) - 1n;
const HASH = /^[0-9a-f]{96}$/;
const KEY = /^[0-9a-f]{104}$/;
const ADDRESS = /^[a-z0-9]{1,128}$/;
const MAX_OPERATIONS = 8;
export function publicCoinScope(value) {
    if (typeof value !== "string" || value.length < 1 || value.length > 256 || !/^[\x21-\x7e]+$/.test(value))
        throw new Error("Invalid public coin cache scope.");
    return value;
}
export function publicCoinAddress(value) {
    if (typeof value !== "string" || !ADDRESS.test(value))
        throw new Error("Invalid public coin address.");
    return value;
}
export function publicCoinKey(value) {
    if (typeof value !== "string" || !KEY.test(value))
        throw new Error("Invalid public coin cursor.");
    return value;
}
export function publicCoinAmount(value) {
    if (typeof value !== "bigint" || value <= 0n || value > PUBLIC_COIN_U128_MAX)
        throw new Error("Invalid public coin amount.");
    return value;
}
export function publicCoin(row) {
    if (!row || typeof row !== "object" || typeof row.transactionId !== "string" || !HASH.test(row.transactionId)
        || !Number.isSafeInteger(row.outputIndex) || row.outputIndex < 0 || row.outputIndex > 0xffff_ffff
        || !Number.isSafeInteger(row.height) || row.height < 0)
        throw new Error("Invalid public coin row.");
    return { address: publicCoinAddress(row.address), transactionId: row.transactionId, outputIndex: row.outputIndex,
        amount: publicCoinAmount(row.amount), height: row.height };
}
export function publicCoinCursor(row) {
    return row.transactionId + row.outputIndex.toString(16).padStart(8, "0");
}
export function publicCoinInverseAmount(amount) {
    return (PUBLIC_COIN_U128_MAX - publicCoinAmount(amount)).toString(16).padStart(32, "0");
}
export function publicCoinRows(rows) {
    if (!Array.isArray(rows) || rows.length > PUBLIC_COIN_PAGE)
        throw new Error("A public coin write page exceeds 256 rows.");
    const result = rows.map(publicCoin);
    if (new Set(result.map(publicCoinCursor)).size !== result.length)
        throw new Error("A public coin page repeats an outpoint.");
    return result;
}
export function publicCoinKeys(keys) {
    if (!Array.isArray(keys) || keys.length > PUBLIC_COIN_PAGE)
        throw new Error("A public coin removal page exceeds 256 keys.");
    const result = keys.map(publicCoinKey);
    if (new Set(result).size !== result.length)
        throw new Error("A public coin removal page repeats an outpoint.");
    return result;
}
export function publicCoinQuery(query = {}) {
    const limit = query.limit ?? PUBLIC_COIN_PAGE;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > PUBLIC_COIN_PAGE)
        throw new Error("Invalid public coin page limit.");
    return { limit, ...(query.after === undefined ? {} : { after: publicCoinKey(query.after) }),
        ...(query.address === undefined ? {} : { address: publicCoinAddress(query.address) }) };
}
export function publicLargestCoinQuery(query = {}) {
    const base = publicCoinQuery({ limit: query.limit, address: query.address });
    return { limit: base.limit, ...(base.address === undefined ? {} : { address: base.address }),
        ...(query.after === undefined ? {} : { after: { amount: publicCoinAmount(query.after.amount), key: publicCoinKey(query.after.key) } }) };
}
export function samePublicCoin(left, right) {
    return left.address === right.address && left.transactionId === right.transactionId && left.outputIndex === right.outputIndex
        && left.amount === right.amount && left.height === right.height;
}
/** Serialize requests and hold ownership until outstanding writes settle. */
export class PublicCoinOperations {
    #tail = Promise.resolve();
    #failed;
    #closing = false;
    #queued = 0;
    #closed;
    #cleanup;
    constructor(cleanup) { this.#cleanup = cleanup; }
    assertOpen() {
        if (this.#closing)
            throw new Error("The public coin cache is closed.");
        if (this.#failed !== undefined)
            throw new Error("The public coin cache is incomplete; close it and perform a verified rescan.", { cause: this.#failed });
    }
    snapshot(read) {
        this.assertOpen();
        try {
            return read();
        }
        catch (error) {
            this.fail(error);
            throw error;
        }
    }
    fail(error) { this.#failed ??= error ?? new Error("The public coin cache failed."); }
    run(work) {
        this.assertOpen();
        if (this.#queued >= MAX_OPERATIONS) {
            const error = new Error("The bounded public coin cache queue is full.");
            this.fail(error);
            return Promise.reject(error);
        }
        this.#queued += 1;
        const result = this.#tail.then(async () => {
            if (this.#failed !== undefined)
                this.assertOpen();
            try {
                return await work();
            }
            catch (error) {
                this.fail(error);
                throw error;
            }
        });
        const finished = result.finally(() => { this.#queued -= 1; });
        this.#tail = finished.then(() => { }, () => { });
        return finished;
    }
    close() {
        if (this.#closed)
            return this.#closed;
        this.#closing = true;
        this.#closed = this.#tail.then(this.#cleanup);
        return this.#closed;
    }
}
export function publicCoinGeneration() {
    if (!globalThis.crypto?.getRandomValues)
        throw new Error("Secure randomness is unavailable for the public coin cache.");
    return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function publicCoinBudget(options = {}) {
    const maximum = options.maxCoins ?? 1_000_000;
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > Number.MAX_SAFE_INTEGER)
        throw new Error("Invalid public coin cache row budget.");
    return maximum;
}
export function publicCoinCapacity(count, maximum) {
    if (!Number.isSafeInteger(count) || count < 0 || count > maximum)
        throw new Error("The public coin cache row budget was exceeded; holdings remain incomplete until a verified rescan.");
}
