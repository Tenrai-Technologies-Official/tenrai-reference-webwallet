import { publicCoin, publicCoinAddress, publicCoinCursor, publicCoinGeneration, publicCoinInverseAmount, publicCoinKey, samePublicCoin } from "./public-coin-store.js";
const HASH = /^[0-9a-f]{96}$/, GEN = /^[0-9a-f]{32}$/, BUCKET = /^[0-9a-f]{5}$/;
const U128 = (1n << 128n) - 1n, MAX_PROGRESS = 4 * 1024 * 1024, MAX_SEALED = 16 * 1024 * 1024;
const encoder = new TextEncoder();
/** @param {any} value */
export function scope(value) {
    if (typeof value !== "string" || !/^[\x21-\x7e]{1,512}$/.test(value))
        throw new Error("Invalid persistent public coin scope.");
    return value;
}
/** @param {any} value */
export function progress(value) {
    if (typeof value !== "string" || value.length > MAX_PROGRESS || encoder.encode(value).length > MAX_PROGRESS)
        throw new Error("Public coin progress exceeds its bound.");
    return value;
}
/** @param {any} value */
export function sealed(value) {
    if (!(value instanceof Uint8Array) || value.length < 40 || value.length > MAX_SEALED || (typeof SharedArrayBuffer !== "undefined" && value.buffer instanceof SharedArrayBuffer))
        throw new Error("Invalid sealed public coin checkpoint.");
    return new Uint8Array(value);
}
/** @param {any} value */
function hashValue(value) {
    if (typeof value !== "string" || !HASH.test(value))
        throw new Error("Invalid public coin digest.");
    return value;
}
/** @param {any} value */
export function document(value) {
    if (!value || Object.keys(value).sort().join(",") !== "coinCount,generation,progress,root,totalAtoms" || typeof value.generation !== "string" || !GEN.test(value.generation) || typeof value.root !== "string" || !HASH.test(value.root)
        || !Number.isSafeInteger(value.coinCount) || value.coinCount < 0 || typeof value.totalAtoms !== "string" || !/^(0|[1-9][0-9]{0,38})$/.test(value.totalAtoms) || BigInt(value.totalAtoms) > U128)
        throw new Error("Malformed public coin checkpoint.");
    return { generation: value.generation, root: value.root, coinCount: value.coinCount, totalAtoms: value.totalAtoms, progress: progress(value.progress) };
}
/** @param {any} a @param {any} b */
export function sameDocument(a, b) {
    return JSON.stringify(document(a)) === JSON.stringify(document(b));
}
/** @param {any} a @param {any} b */
export function sameBytes(a, b) {
    return a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((x, i) => x === b[i]);
}
/** @param {any} values */
function binary(values) {
    const out = new Uint8Array(values.length * 48);
    for (let at = 0; at < values.length; at++) {
        const value = hashValue(values[at]);
        for (let i = 0; i < 48; i++)
            out[at * 48 + i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}
/** @param {any} codec @param {any} domain @param {any} bytes */
function digest(codec, domain, bytes) {
    return hashValue(codec.hash(domain, bytes));
}
/** @param {any} codec @param {any} key */
export function bucket(codec, key) {
    const value = codec.bucket(publicCoinKey(key));
    if (typeof value !== "string" || !BUCKET.test(value))
        throw new Error("Invalid keyed public coin bucket.");
    return value;
}
/** @param {any} codec */
export function emptyHashes(codec) {
    const seed = digest(codec, "coin_chain", new Uint8Array());
    const end = new Uint8Array(56);
    end.set(binary([seed]));
    const b = digest(codec, "coin_end", end), m = digest(codec, "coin_branch", binary(Array(256).fill(b))), t = digest(codec, "coin_branch", binary(Array(256).fill(m)));
    return { b, m, t, root: digest(codec, "coin_root", binary(Array(16).fill(t))) };
}
/** @param {any} coin @param {any} namespace @param {any} generation @param {any} codec */
export function stored(coin, namespace, generation, codec) {
    const checked = publicCoin(coin), key = publicCoinCursor(checked);
    return { ...checked, amount: checked.amount.toString(), scope: namespace, generation, key, bucket: bucket(codec, key), inverseAmount: publicCoinInverseAmount(checked.amount) };
}
/** @param {any} row @param {any} namespace @param {any} generation @param {any} codec */
export function decoded(row, namespace, generation, codec) {
    if (!row || row.scope !== namespace || row.generation !== generation || typeof row.amount !== "string" || !/^[1-9][0-9]{0,38}$/.test(row.amount))
        throw new Error("Malformed persistent public coin.");
    const coin = publicCoin({ ...row, amount: BigInt(row.amount) });
    if (row.key !== publicCoinCursor(coin) || row.bucket !== bucket(codec, row.key) || row.inverseAmount !== publicCoinInverseAmount(coin.amount))
        throw new Error("Persistent public coin indexes changed.");
    return coin;
}
/** @param {any} values */
export function mutations(values) {
    if (!Array.isArray(values) || values.length > 256)
        throw new Error("Public coin page exceeds256 mutations.");
    return values.map((value) => { if (value?.kind === "put")
        return { kind: "put", coin: publicCoin(value.coin) }; if (value?.kind === "remove")
        return { kind: "remove", key: publicCoinKey(value.key), address: publicCoinAddress(value.address) }; throw new Error("Invalid public coin mutation."); });
}
class BucketHash {
    codec;
    hash;
    count = 0;
    previous = "";
    /** @param {any} codec */ constructor(codec) {
        this.codec = codec;
        this.hash = digest(codec, "coin_chain", new Uint8Array());
    }
    /** @param {any} row */
    push(row) {
        if (row.key <= this.previous)
            throw new Error("Persistent bucket keys do not advance.");
        this.previous = row.key;
        const fact = digest(this.codec, "coin_row", encoder.encode(JSON.stringify([row.key, row.address, row.amount, row.height])));
        this.hash = digest(this.codec, "coin_chain", binary([this.hash, fact]));
        this.count++;
        if (!Number.isSafeInteger(this.count))
            throw new Error("Public coin count overflow.");
    }
    end() {
        const bytes = new Uint8Array(56);
        bytes.set(binary([this.hash]));
        new DataView(bytes.buffer).setBigUint64(48, BigInt(this.count), false);
        return digest(this.codec, "coin_end", bytes);
    }
}
/** Streaming sparse tree fold with bounded per-level digests. */
class TreeFold {
    codec;
    empty;
    chain;
    b = "";
    m = "";
    t = "";
    mids;
    tops;
    roots;
    /** @param {any} codec */ constructor(codec) {
        this.codec = codec;
        this.empty = emptyHashes(codec);
        this.chain = new BucketHash(codec);
        this.mids = Array(256).fill(this.empty.b);
        this.tops = Array(256).fill(this.empty.m);
        this.roots = Array(16).fill(this.empty.t);
    }
    /** @returns {any[]} */ endBucket() {
        if (!this.b)
            return [];
        const hash = this.chain.end();
        this.mids[parseInt(this.b.slice(3), 16)] = hash;
        return [{ id: "b" + this.b, digest: hash }];
    }
    /** @returns {any[]} */ endMiddle() {
        if (!this.m)
            return [];
        const hash = digest(this.codec, "coin_branch", binary(this.mids));
        this.tops[parseInt(this.m.slice(1), 16)] = hash;
        this.mids.fill(this.empty.b);
        return [{ id: "m" + this.m, digest: hash }];
    }
    /** @returns {any[]} */ endTop() {
        if (!this.t)
            return [];
        const hash = digest(this.codec, "coin_branch", binary(this.tops));
        this.roots[parseInt(this.t, 16)] = hash;
        this.tops.fill(this.empty.m);
        return [{ id: "t" + this.t, digest: hash }];
    }
    /** @param {any} row @returns {any[]} */
    push(row) {
        let nodes = [];
        if (row.bucket !== this.b) {
            if (this.b && row.bucket < this.b)
                throw new Error("Public coin bucket order regressed.");
            nodes.push(...this.endBucket());
            if (row.bucket.slice(0, 3) !== this.m) {
                nodes.push(...this.endMiddle());
                if (row.bucket[0] !== this.t)
                    nodes.push(...this.endTop());
            }
            this.b = row.bucket;
            this.m = row.bucket.slice(0, 3);
            this.t = row.bucket[0];
            this.chain = new BucketHash(this.codec);
        }
        this.chain.push(row);
        return nodes;
    }
    finish() {
        const nodes = [...this.endBucket(), ...this.endMiddle(), ...this.endTop()];
        return { nodes, root: digest(this.codec, "coin_root", binary(this.roots)) };
    }
}
/** @param {any} codec @param {any} namespace */
function checkCodec(codec, namespace) {
    if (!codec || codec.scope !== scope(namespace) || typeof codec.open !== "function" || typeof codec.seal !== "function" || typeof codec.bucket !== "function" || typeof codec.hash !== "function")
        throw new Error("Wrong public coin checkpoint scope or codec.");
}
/** @param {any} raw @param {any} namespace @param {any} codec */
function opened(raw, namespace, codec) {
    if (!raw || raw.scope !== namespace || !GEN.test(raw.generation))
        throw new Error("Malformed public coin checkpoint envelope.");
    const doc = document(codec.open(sealed(raw.sealed)));
    if (raw.generation !== doc.generation)
        throw new Error("Public coin generation binding changed.");
    return doc;
}
/** @param {any} doc @param {any} namespace @param {any} codec */
function envelope(doc, namespace, codec) {
    const checked = document(doc), bytes = sealed(codec.seal(checked));
    if (!sameDocument(codec.open(bytes), checked))
        throw new Error("The coin codec acknowledged different checkpoint facts.");
    return { scope: namespace, generation: checked.generation, sealed: bytes };
}
/** @param {any} namespace @param {any} codec @returns {Generator<any,any,any>} */
export function* recoverPlan(namespace, codec) {
    checkCodec(codec, namespace);
    const raw = yield { kind: "metaGet" };
    if (raw === null)
        return null;
    const doc = opened(raw, namespace, codec), fold = new TreeFold(codec);
    let after = null, count = 0, total = 0n, nodes = 0;
    for (;;) {
        const rows = yield { kind: "scan", generation: doc.generation, after, limit: 256 };
        if (!Array.isArray(rows) || rows.length > 256)
            throw new Error("Oversized persistent coin page.");
        for (const row of rows) {
            const coin = decoded(row, namespace, doc.generation, codec);
            for (const node of fold.push(row)) {
                if ((yield { kind: "nodeGet", generation: doc.generation, id: node.id }) !== node.digest)
                    throw new Error("Public coin hash index is corrupt.");
                nodes++;
            }
            count++;
            total += coin.amount;
            if (!Number.isSafeInteger(count) || total > U128)
                throw new Error("Public coin aggregate overflow.");
            after = [row.bucket, row.key];
        }
        if (rows.length < 256)
            break;
    }
    const finish = fold.finish();
    for (const node of finish.nodes) {
        if ((yield { kind: "nodeGet", generation: doc.generation, id: node.id }) !== node.digest)
            throw new Error("Public coin hash index is corrupt.");
        nodes++;
    }
    if ((yield { kind: "nodeCount", generation: doc.generation }) !== nodes || finish.root !== doc.root || count !== doc.coinCount || total.toString() !== doc.totalAtoms)
        throw new Error("Persistent public coin checkpoint failed its full integrity check.");
    return doc;
}
/** @param {any} codec @param {any} namespace @param {any} generation @param {any} key @returns {Generator<any,any,any>} */
function* bucketPlan(codec, namespace, generation, key) {
    const fold = new BucketHash(codec);
    let after = null;
    for (;;) {
        const rows = yield { kind: "scan", generation, bucket: key, after, limit: 256 };
        if (!Array.isArray(rows) || rows.length > 256)
            throw new Error("Oversized public coin bucket page.");
        for (const row of rows) {
            decoded(row, namespace, generation, codec);
            if (row.bucket !== key)
                throw new Error("A public coin left its keyed bucket.");
            fold.push(row);
            after = [row.bucket, row.key];
        }
        if (rows.length < 256)
            break;
    }
    return fold.count === 0 ? null : fold.end();
}
/** @param {any} codec @param {any} generation @param {any} prefix @param {any} empty @returns {Generator<any,any,any>} */
function* groupPlan(codec, generation, prefix, empty) {
    const values = yield { kind: "children", generation, prefix };
    const size = prefix === "t" ? 16 : 256;
    if (!Array.isArray(values) || values.length > size)
        throw new Error("Malformed public coin hash fanout.");
    const hashes = Array(size).fill(empty);
    let previous = "";
    for (const node of values) {
        if (typeof node.id !== "string" || !node.id.startsWith(prefix) || node.id.length !== prefix.length + (prefix === "t" ? 1 : 2) || node.id <= previous || !/^\w+$/.test(node.id))
            throw new Error("Malformed public coin hash path.");
        const suffix = node.id.slice(prefix.length);
        if (!/^[0-9a-f]+$/.test(suffix))
            throw new Error("Malformed public coin hash position.");
        const index = parseInt(suffix, 16);
        if (index >= size)
            throw new Error("Public coin hash position exceeds fanout.");
        hashes[index] = hashValue(node.digest);
        previous = node.id;
    }
    return { hash: digest(codec, prefix === "t" ? "coin_root" : "coin_branch", binary(hashes)), empty: values.length === 0 };
}
/** @param {any} namespace @param {any} expected @param {any} values @param {any} nextProgress @param {any} codec @param {any} maximum @returns {Generator<any,any,any>} */
export function* commitPlan(namespace, expected, values, nextProgress, codec, maximum) {
    checkCodec(codec, namespace);
    const changes = mutations(values), doc = opened(yield { kind: "metaGet" }, namespace, codec);
    if (!sameDocument(doc, expected))
        throw new Error("Public coin checkpoint changed outside its physical lease.");
    const empty = emptyHashes(codec), buckets = [...new Set(changes.map((value) => bucket(codec, value.kind === "put" ? publicCoinCursor(value.coin) : value.key)))].sort(), middles = [...new Set(buckets.map((key) => key.slice(0, 3)))], tops = [...new Set(buckets.map((key) => key[0]))];
    for (const key of buckets) {
        const actual = yield* bucketPlan(codec, namespace, doc.generation, key);
        if ((yield { kind: "nodeGet", generation: doc.generation, id: "b" + key }) !== actual)
            throw new Error("Affected public coin bucket differs from its authenticated path.");
    }
    for (const key of middles) {
        const actual = yield* groupPlan(codec, doc.generation, "b" + key, empty.b);
        if ((yield { kind: "nodeGet", generation: doc.generation, id: "m" + key }) !== (actual.empty ? null : actual.hash))
            throw new Error("Affected public coin middle path is corrupt.");
    }
    for (const key of tops) {
        const actual = yield* groupPlan(codec, doc.generation, "m" + key, empty.m);
        if ((yield { kind: "nodeGet", generation: doc.generation, id: "t" + key }) !== (actual.empty ? null : actual.hash))
            throw new Error("Affected public coin upper path is corrupt.");
    }
    if ((yield* groupPlan(codec, doc.generation, "t", empty.t)).hash !== doc.root)
        throw new Error("Public coin hash paths differ from the sealed root.");
    let count = doc.coinCount, total = BigInt(doc.totalAtoms);
    for (const change of changes) {
        const key = change.kind === "put" ? publicCoinCursor(change.coin) : change.key, old = yield { kind: "coinGet", generation: doc.generation, key };
        const coin = old === null ? null : decoded(old, namespace, doc.generation, codec);
        if (change.kind === "put") {
            if (coin && !samePublicCoin(coin, change.coin))
                throw new Error("An immutable public coin changed.");
            if (!coin) {
                yield { kind: "coinPut", row: stored(change.coin, namespace, doc.generation, codec) };
                count++;
                total += change.coin.amount;
            }
        }
        else if (coin) {
            if (coin.address !== change.address)
                throw new Error("A foreign address tried to remove a public coin.");
            yield { kind: "coinRemove", generation: doc.generation, key };
            count--;
            total -= coin.amount;
        }
        if (!Number.isSafeInteger(count) || count < 0 || count > maximum || total < 0n || total > U128)
            throw new Error("Persistent public coin count/value budget exceeded.");
    }
    for (const key of buckets)
        yield { kind: "nodePut", generation: doc.generation, id: "b" + key, digest: yield* bucketPlan(codec, namespace, doc.generation, key) };
    for (const key of middles) {
        const group = yield* groupPlan(codec, doc.generation, "b" + key, empty.b);
        yield { kind: "nodePut", generation: doc.generation, id: "m" + key, digest: group.empty ? null : group.hash };
    }
    for (const key of tops) {
        const group = yield* groupPlan(codec, doc.generation, "m" + key, empty.m);
        yield { kind: "nodePut", generation: doc.generation, id: "t" + key, digest: group.empty ? null : group.hash };
    }
    const next = document({ ...doc, root: (yield* groupPlan(codec, doc.generation, "t", empty.t)).hash, coinCount: count, totalAtoms: total.toString(), progress: progress(nextProgress) });
    yield { kind: "metaPut", row: envelope(next, namespace, codec) };
    return next;
}
/** @param {any} namespace @param {any} nextProgress @param {any} codec @returns {Generator<any,any,any>} */
export function* resetPlan(namespace, nextProgress, codec) {
    checkCodec(codec, namespace);
    const generation = publicCoinGeneration(), prior = yield { kind: "metaGet" };
    if (prior !== null && prior.generation === generation)
        throw new Error("The public coin RNG repeated its current generation.");
    const occupied = yield { kind: "scan", generation, after: null, limit: 256 };
    if (!Array.isArray(occupied) || occupied.length !== 0 || (yield { kind: "nodeCount", generation }) !== 0)
        throw new Error("The public coin RNG selected an existing generation.");
    const next = document({ generation, root: emptyHashes(codec).root, coinCount: 0, totalAtoms: "0", progress: progress(nextProgress) });
    yield { kind: "metaPut", row: envelope(next, namespace, codec) };
    return next;
}
