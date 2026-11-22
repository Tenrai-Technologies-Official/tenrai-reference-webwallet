export function publicCoinCodec(wasm, root, network, genesis, account) {
    const native = new wasm.PublicCoinCache(root, network, genesis, account);
    let closed = false;
    const assert = () => { if (closed)
        throw new Error("The public checkpoint codec closed."); };
    return { scope: native.scope, chainId: native.chainId,
        bucket(key) { assert(); return native.bucket(key); }, hash(domain, bytes) { assert(); return native.hash(domain, bytes); },
        open(sealed) { assert(); return JSON.parse(native.open(sealed)); },
        seal(checkpoint) { assert(); return native.seal(JSON.stringify(checkpoint)); },
        close() { if (!closed) {
            closed = true;
            native.free();
        } } };
}
