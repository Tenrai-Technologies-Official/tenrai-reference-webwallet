import type { ResponseVerifier, SignedExchange } from "../http.ts";
export interface TrustedServer {
    /** Operator-published identity as 64 hexadecimal characters. */
    identity: string;
    /** Expected chain ID, if the caller pins a chain. */
    chainId?: string;
}
/** Verify REST signatures against the ML-DSA-65 key bound to the operator identity. */
export declare function signedResponses(trust: TrustedServer): ResponseVerifier;
/** Derive the node identity from its ML-DSA-65 public key. */
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
/** Encode the signed response envelope defined by `tenrai-auth`, with little-endian integers. */
export declare function envelope(fields: EnvelopeFields): Uint8Array;
