/** @module @tenrai/sdk/verify */
import { sha384 } from "@noble/hashes/sha2.js";
import { shake256 } from "@noble/hashes/sha3.js";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { TenraiSignatureError } from "../errors.js";
const encoder = new TextEncoder();
const ENVELOPE_DOMAIN = encoder.encode("TRAI/API/ENVELOPE/1");
const SIGNING_CONTEXT = encoder.encode("TRAI/API/RESPONSE/1");
const NODE_ID_DOMAIN = encoder.encode("TRAI/P2P/MLDSA65/NODE-ID/1");
const ENVELOPE_VERSION = 1;
const PUBLIC_KEY_BYTES = 1952;
const SIGNATURE_BYTES = 3309;
const MAX_METHOD_BYTES = 16;
const MAX_TARGET_BYTES = 2048;
const MAX_U64 = (1n << 64n) - 1n;
/** Verify REST signatures against the ML-DSA-65 key bound to the operator identity. */
export function signedResponses(trust) {
    const identity = bytes(trust.identity, 32, "identity");
    let key;
    return {
        async prepare(readIdentity) {
            const document = await readIdentity();
            if (document.key_scheme !== "mldsa65") {
                throw new TenraiSignatureError("the server signs with an unknown key scheme");
            }
            const publicKey = bytes(document.public_key, PUBLIC_KEY_BYTES, "public key");
            if (!equal(nodeIdentity(publicKey), identity) || document.identity !== trust.identity) {
                throw new TenraiSignatureError("the server's public key does not belong to the trusted identity");
            }
            if (trust.chainId !== undefined && document.chain_id !== trust.chainId) {
                throw new TenraiSignatureError("the server is on another chain");
            }
            key = { publicKey, chainId: bytes(document.chain_id, 48, "chain id") };
        },
        verify(exchange) {
            if (!key) {
                throw new TenraiSignatureError("the trusted identity has not been read yet");
            }
            verifyExchange(exchange, key.publicKey, key.chainId, identity);
        },
    };
}
/** Derive the node identity from its ML-DSA-65 public key. */
export function nodeIdentity(publicKey) {
    const input = new Uint8Array(NODE_ID_DOMAIN.length + publicKey.length);
    input.set(NODE_ID_DOMAIN);
    input.set(publicKey, NODE_ID_DOMAIN.length);
    return shake256(input, { dkLen: 32 });
}
export function verifyExchange(exchange, publicKey, chainId, identity) {
    const header = (name) => {
        const value = exchange.headers.get(name);
        if (value === null) {
            throw new TenraiSignatureError(`the answer to ${exchange.method} ${exchange.target} is not signed`);
        }
        return value;
    };
    if (header("x-tenrai-envelope-version") !== String(ENVELOPE_VERSION)) {
        throw new TenraiSignatureError("the answer uses an unknown signature envelope");
    }
    if (!equal(bytes(header("x-tenrai-node-identity"), 32, "identity"), identity)) {
        throw new TenraiSignatureError("the answer was signed by another server");
    }
    if (header("x-tenrai-request-nonce") !== exchange.nonce) {
        throw new TenraiSignatureError("the answer belongs to another request");
    }
    const height = header("x-tenrai-tip-height");
    if (!/^(0|[1-9][0-9]{0,19})$/.test(height) || BigInt(height) > MAX_U64) {
        throw new TenraiSignatureError("the answer carries a malformed tip height");
    }
    const message = envelope({
        chainId,
        method: exchange.method,
        target: exchange.target,
        requestDigest: sha384(exchange.requestBody),
        status: exchange.status,
        responseDigest: sha384(exchange.responseBody),
        identity,
        nonce: bytes(exchange.nonce, 32, "nonce"),
        tipHeight: BigInt(height),
    });
    const signature = bytes(header("x-tenrai-signature"), SIGNATURE_BYTES, "signature");
    if (!ml_dsa65.verify(signature, message, publicKey, { context: SIGNING_CONTEXT })) {
        throw new TenraiSignatureError(`the signature on ${exchange.method} ${exchange.target} is invalid`);
    }
}
/** Encode the signed response envelope defined by `tenrai-auth`, with little-endian integers. */
export function envelope(fields) {
    const method = encoder.encode(fields.method);
    const target = encoder.encode(fields.target);
    if (method.length === 0 || method.length > MAX_METHOD_BYTES || target.length === 0 || target.length > MAX_TARGET_BYTES) {
        throw new TenraiSignatureError("the request method or target is outside the signed bounds");
    }
    const parts = [
        ENVELOPE_DOMAIN,
        u16(ENVELOPE_VERSION),
        fields.chainId,
        Uint8Array.of(method.length),
        method,
        u16(target.length),
        target,
        fields.requestDigest,
        u16(fields.status),
        fields.responseDigest,
        fields.identity,
        fields.nonce,
        u64(fields.tipHeight),
    ];
    const message = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        message.set(part, offset);
        offset += part.length;
    }
    return message;
}
function u16(value) {
    const out = new Uint8Array(2);
    new DataView(out.buffer).setUint16(0, value, true);
    return out;
}
function u64(value) {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigUint64(0, value, true);
    return out;
}
function bytes(text, length, name) {
    if (typeof text !== "string" || text.length !== length * 2 || !/^[0-9a-f]*$/.test(text)) {
        throw new TenraiSignatureError(`the ${name} must be ${length * 2} lowercase hex characters`);
    }
    const out = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
        out[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
    }
    return out;
}
function equal(left, right) {
    return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
