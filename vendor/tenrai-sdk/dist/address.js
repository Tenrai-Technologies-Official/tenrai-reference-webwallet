import { sha384 } from "@noble/hashes/sha2.js";
import { shake256 } from "@noble/hashes/sha3.js";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { ADDRESS_WORD_LIST } from "./address-words.js";
const encoder = new TextEncoder();
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32M = 0x2bc830a3;
const NETWORKS = { trai: "mainnet", ttrai: "testnet", dtrai: "development" };
const FORMAT_VERSION = 1;
const LOCK_BYTES = 41;
const SINGLE_KEY = 1;
const THRESHOLD = 2;
const NATIVE_LOCK_V1 = 3;
const WORDS_DOMAIN = "TRAI_ADDRESS_WORDS_V1";
const PROOF_DOMAIN = "TRAI_ADDRESS_PROOF_V1";
const PROOF_CONTEXT = encoder.encode("TRAI/ADDRESS/PROOF/1");
const LOCK_DOMAIN = encoder.encode("TRAI_LOCK_V1");
const REQUEST_TYPE = "tenrai-address-proof-request";
const PROOF_TYPE = "tenrai-address-proof";
const REQUEST_FIELDS = ["type", "version", "address", "challenge", "expires_at"];
const PROOF_FIELDS = [...REQUEST_FIELDS, "public_key", "signature"];
const CHALLENGE_BYTES = 32;
const PUBLIC_KEY_BYTES = 1952;
const SIGNATURE_BYTES = 3309;
const MAX_DOCUMENT_CHARS = 32 * 1024;
const MAX_ADDRESS_CHARS = 128;
/** Ten minutes, and one year at most, as in the wallets. */
export const ADDRESS_PROOF_VALID_FOR = 600;
export const MAX_ADDRESS_PROOF_VALID_FOR = 365 * 24 * 60 * 60;
const BURN_ADDRESSES = {
    mainnet: "trai1qyqsqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqhhus7s",
    testnet: "ttrai1qyqsqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqfztafh",
    development: "dtrai1qyqsqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpxq6ml",
};
/** The burn address of a network: no key can spend what is paid to it, and the node takes it out of the supply. */
export function burnAddress(network) {
    return BURN_ADDRESSES[network === "testnet100" ? "testnet" : network];
}
/** Whether `address` is the burn address of its network. */
export function isBurnAddress(address) {
    return Object.values(BURN_ADDRESSES).includes(address);
}
/** The versioned authorization profile carried by the canonical address. */
export function addressLockProfile(address) {
    const profile = decodeAddress(address).lock[0];
    return profile === SINGLE_KEY ? "direct_mldsa65" : profile === THRESHOLD ? "threshold_mldsa65" : "native_lock";
}
/** The six public words that stand for an address of any network; they are no recovery phrase. */
export function addressVerificationWords(address) {
    const parsed = decodeAddress(address);
    const digest = domainHash(WORDS_DOMAIN, [parsed.hrp, Uint8Array.of(FORMAT_VERSION), parsed.lock]);
    const words = [];
    for (let word = 0; word < 6; word += 1) {
        let index = 0;
        for (let bit = word * 11; bit < word * 11 + 11; bit += 1) {
            index = (index << 1) | (((digest[bit >> 3] ?? 0) >> (7 - (bit & 7))) & 1);
        }
        words.push(ADDRESS_WORD_LIST[index] ?? "");
    }
    return words;
}
/** A request with a fresh random challenge that asks the owner of `address` to prove it. */
export function createAddressProofRequest(address, options = {}) {
    const validFor = options.validFor ?? ADDRESS_PROOF_VALID_FOR;
    if (!Number.isSafeInteger(validFor) || validFor < 1 || validFor > MAX_ADDRESS_PROOF_VALID_FOR) {
        throw new RangeError(`validFor must be a whole number of seconds from 1 to ${MAX_ADDRESS_PROOF_VALID_FOR}`);
    }
    if (decodeAddress(address).lock[0] !== SINGLE_KEY) {
        throw new TypeError("only an address with a single key can prove its owner; this one has a conditional or threshold lock");
    }
    return {
        type: REQUEST_TYPE,
        version: 1,
        address,
        challenge: toHex(crypto.getRandomValues(new Uint8Array(CHALLENGE_BYTES))),
        expires_at: seconds(options.now) + validFor,
    };
}
/** Reads a proof request from JSON text or an object, refusing anything a wallet must not sign. */
export function readAddressProofRequest(value) {
    const fields = documentFields(value, REQUEST_TYPE, REQUEST_FIELDS);
    if (decodeAddress(fields.address).lock[0] !== SINGLE_KEY) {
        throw new TypeError("a multisig or conditional address cannot prove its owner this way");
    }
    return {
        type: REQUEST_TYPE,
        version: 1,
        address: fields.address,
        challenge: fields.challenge,
        expires_at: fields.expires_at,
    };
}
/** Checks an address proof and, given its request, that the proof answers it. */
export function verifyAddressProof(proof, options = {}) {
    const now = seconds(options.now);
    let fields;
    let parsed;
    try {
        fields = documentFields(proof, PROOF_TYPE, PROOF_FIELDS);
        parsed = decodeAddress(fields.address);
        hexBytes(fields.public_key, PUBLIC_KEY_BYTES, "public key");
        hexBytes(fields.signature, SIGNATURE_BYTES, "signature");
    }
    catch (error) {
        return { result: "malformed", valid: false, reason: error instanceof Error ? error.message : "the proof is unreadable" };
    }
    const found = {
        address: fields.address,
        network: parsed.network,
        verificationWords: addressVerificationWords(fields.address),
        challenge: fields.challenge,
        expiresAt: fields.expires_at,
    };
    const verdict = (result, reason) => ({
        result,
        valid: result === "valid",
        reason,
        ...found,
    });
    if (options.request !== undefined) {
        let request;
        try {
            request = documentFields(options.request, REQUEST_TYPE, REQUEST_FIELDS);
            decodeAddress(request.address);
        }
        catch (error) {
            return verdict("malformed", error instanceof Error ? error.message : "the request is unreadable");
        }
        if (request.address !== found.address || request.challenge !== found.challenge || request.expires_at !== found.expiresAt) {
            return verdict("wrong-request", "the proof answers another request: the address, challenge or expiry differ");
        }
    }
    if (parsed.lock[0] !== SINGLE_KEY) {
        return verdict("not-single-key", "only an address with a single ML-DSA-65 key can prove its owner this way");
    }
    const publicKey = hexBytes(fields.public_key, PUBLIC_KEY_BYTES, "public key");
    if (!equal(lockCommitment(publicKey), parsed.lock.subarray(1))) {
        return verdict("key-mismatch", "the public key does not belong to this address");
    }
    if (now > found.expiresAt) {
        return verdict("expired", "the proof expired");
    }
    const message = domainHash(PROOF_DOMAIN, [
        parsed.hrp,
        Uint8Array.of(FORMAT_VERSION),
        parsed.lock,
        hexBytes(fields.challenge, CHALLENGE_BYTES, "challenge"),
        u64(found.expiresAt),
    ]);
    const signature = hexBytes(fields.signature, SIGNATURE_BYTES, "signature");
    if (!ml_dsa65.verify(signature, message, publicKey, { context: PROOF_CONTEXT })) {
        return verdict("bad-signature", "the signature does not verify");
    }
    return verdict("valid", "the proof holds");
}
/** Reads a request or proof document, refusing other types, versions, fields and encodings. */
function documentFields(value, type, names) {
    let document = value;
    if (typeof value === "string") {
        if (value.length > MAX_DOCUMENT_CHARS) {
            throw new TypeError("the document is too large");
        }
        try {
            document = JSON.parse(value);
        }
        catch {
            throw new TypeError("the document is not JSON");
        }
    }
    if (document === null || typeof document !== "object" || Array.isArray(document)) {
        throw new TypeError("the document is not a JSON object");
    }
    const fields = document;
    const keys = Object.keys(fields);
    if (keys.length !== names.length || !names.every((name) => Object.hasOwn(fields, name))) {
        throw new TypeError(`a ${type} has exactly the fields ${names.join(", ")}`);
    }
    if (fields.type !== type) {
        throw new TypeError(`this is not a ${type}`);
    }
    if (fields.version !== 1) {
        throw new TypeError(`version ${String(fields.version)} is not supported`);
    }
    if (typeof fields.address !== "string") {
        throw new TypeError("the address is not text");
    }
    hexBytes(fields.challenge, CHALLENGE_BYTES, "challenge");
    if (!Number.isSafeInteger(fields.expires_at) || fields.expires_at < 0) {
        throw new TypeError(`expires_at must be a whole number from 0 to ${Number.MAX_SAFE_INTEGER}`);
    }
    return fields;
}
/** Splits a canonical lower-case Bech32m Tenrai address into its network and 41-byte lock. */
function decodeAddress(text) {
    if (typeof text !== "string" || text.length === 0 || text.length > MAX_ADDRESS_CHARS || text !== text.toLowerCase()) {
        throw new TypeError("not a Tenrai address");
    }
    const separator = text.lastIndexOf("1");
    const hrp = text.slice(0, separator);
    const network = NETWORKS[hrp];
    if (separator < 1 || network === undefined) {
        throw new TypeError("not a Tenrai address");
    }
    const values = [];
    for (const char of text.slice(separator + 1)) {
        const value = CHARSET.indexOf(char);
        if (value < 0) {
            throw new TypeError("not a Tenrai address");
        }
        values.push(value);
    }
    if (values.length < 6 || polymod([...expand(hrp), ...values]) !== BECH32M) {
        throw new TypeError("not a Tenrai address: a character is wrong or missing");
    }
    const payload = regroup(values.slice(0, -6));
    if (payload === undefined || payload.length !== 1 + LOCK_BYTES || payload[0] !== FORMAT_VERSION) {
        throw new TypeError("not a Tenrai address");
    }
    const lock = payload.subarray(1);
    if (lock[0] !== SINGLE_KEY && lock[0] !== THRESHOLD && lock[0] !== NATIVE_LOCK_V1) {
        throw new TypeError("not a Tenrai address");
    }
    return { network, hrp: encoder.encode(hrp), lock };
}
function polymod(values) {
    const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let check = 1;
    for (const value of values) {
        const top = check >>> 25;
        check = (((check & 0x1ffffff) << 5) ^ value) >>> 0;
        for (let bit = 0; bit < 5; bit += 1) {
            if ((top >>> bit) & 1) {
                check = (check ^ (generator[bit] ?? 0)) >>> 0;
            }
        }
    }
    return check;
}
function expand(hrp) {
    const codes = [...hrp].map((char) => char.charCodeAt(0));
    return [...codes.map((code) => code >> 5), 0, ...codes.map((code) => code & 31)];
}
function regroup(values) {
    const bytes = [];
    let buffer = 0;
    let bits = 0;
    for (const value of values) {
        buffer = (buffer << 5) | value;
        bits += 5;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((buffer >> bits) & 0xff);
        }
        buffer &= (1 << bits) - 1;
    }
    return bits >= 5 || buffer !== 0 ? undefined : Uint8Array.from(bytes);
}
function domainHash(domain, parts) {
    const name = encoder.encode(domain);
    const input = new Uint8Array(2 + name.length + 8 + parts.reduce((total, part) => total + 8 + part.length, 0));
    const view = new DataView(input.buffer);
    view.setUint16(0, name.length);
    input.set(name, 2);
    let offset = 2 + name.length;
    view.setBigUint64(offset, BigInt(parts.length));
    offset += 8;
    for (const part of parts) {
        view.setBigUint64(offset, BigInt(part.length));
        input.set(part, offset + 8);
        offset += 8 + part.length;
    }
    return sha384(input);
}
function lockCommitment(publicKey) {
    const input = new Uint8Array(LOCK_DOMAIN.length + 1 + publicKey.length);
    input.set(LOCK_DOMAIN);
    input[LOCK_DOMAIN.length] = SINGLE_KEY;
    input.set(publicKey, LOCK_DOMAIN.length + 1);
    return shake256(input, { dkLen: LOCK_BYTES - 1 });
}
function u64(value) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
    return bytes;
}
function seconds(now) {
    const value = now ?? Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError("now must be whole Unix seconds");
    }
    return value;
}
function hexBytes(value, length, name) {
    if (typeof value !== "string" || value.length !== length * 2 || !/^[0-9a-f]*$/.test(value)) {
        throw new TypeError(`the ${name} must be ${length} bytes of lower-case hex`);
    }
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
        bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
}
function toHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function equal(left, right) {
    return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
