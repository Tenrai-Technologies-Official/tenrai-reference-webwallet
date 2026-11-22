import type { ResponseVerifier, SignedExchange } from "../http.ts";
export interface TrustedServer {
    /** The 64 hex characters a node or gateway operator publishes as its identity. */
    identity: string;
    /** Refuses a server on another chain. */
    chainId?: string;
}
/** Checks the ML-DSA-65 signature of every REST answer; the key from /v1/node/identity must hash to `identity`. */
export declare function signedResponses(trust: TrustedServer): ResponseVerifier;
/** The identity a node derives from its ML-DSA-65 public key. */
export declare function nodeIdentity(publicKey: Uint8Array): Uint8Array;
export declare function verifyExchange(exchange: SignedExchange, publicKey: Uint8Array, chainId: Uint8Array, identity: Uint8Array): void;
export interface EnvelopeFields {
    chainId: Uint8Array;
    method: string;
    target: string;
    requestDigest: Uint8Array;
    status: number;
    responseDigest: Uint8Array;
    identity: Uint8Array;
    nonce: Uint8Array;
    tipHeight: bigint;
}
/** Byte for byte what `ResponseEnvelope::signable` in tenrai-auth writes; integers are little endian. */
export declare function envelope(fields: EnvelopeFields): Uint8Array;
