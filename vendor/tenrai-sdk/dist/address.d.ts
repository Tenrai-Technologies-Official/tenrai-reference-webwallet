/** The network an address belongs to; testnet and testnet100 share their addresses. */
export type AddressNetwork = "mainnet" | "testnet" | "development";
/** Asks the owner of `address` to sign `challenge` before `expires_at` (Unix seconds). */
export interface AddressProofRequest {
    type: "tenrai-address-proof-request";
    version: 1;
    address: string;
    challenge: string;
    expires_at: number;
}
/** The owner's answer: the request's fields plus the ML-DSA-65 public key and signature, as hex. */
export interface AddressProofDocument {
    type: "tenrai-address-proof";
    version: 1;
    address: string;
    challenge: string;
    expires_at: number;
    public_key: string;
    signature: string;
}
export type AddressProofResult = "valid" | "malformed" | "wrong-request" | "not-single-key" | "key-mismatch" | "expired" | "bad-signature";
/** What `verifyAddressProof` found; the address fields are missing when the proof could not be read. */
export interface AddressProofVerdict {
    result: AddressProofResult;
    valid: boolean;
    reason: string;
    address?: string;
    network?: AddressNetwork;
    verificationWords?: string[];
    challenge?: string;
    expiresAt?: number;
}
export interface ProofRequestOptions {
    /** Seconds the owner has to answer; 600 by default, at most one year. */
    validFor?: number;
    /** Unix seconds; the clock by default. */
    now?: number;
}
export interface VerifyProofOptions {
    /** The request the proof must answer; without it only the signature is checked. */
    request?: AddressProofRequest | string;
    /** Unix seconds; the clock by default. */
    now?: number;
}
/** Ten minutes, and one year at most, as in the wallets. */
export declare const ADDRESS_PROOF_VALID_FOR = 600;
export declare const MAX_ADDRESS_PROOF_VALID_FOR: number;
/** The burn address of a network: no key can spend what is paid to it, and the node takes it out of the supply. */
export declare function burnAddress(network: AddressNetwork | "testnet100"): string;
/** Whether `address` is the burn address of its network. */
export declare function isBurnAddress(address: string): boolean;
/** The versioned authorization profile carried by the canonical address. */
export declare function addressLockProfile(address: string): "direct_mldsa65" | "threshold_mldsa65" | "native_lock";
/** The six public words that stand for an address of any network; they are no recovery phrase. */
export declare function addressVerificationWords(address: string): string[];
/** A request with a fresh random challenge that asks the owner of `address` to prove it. */
export declare function createAddressProofRequest(address: string, options?: ProofRequestOptions): AddressProofRequest;
/** Reads a proof request from JSON text or an object, refusing anything a wallet must not sign. */
export declare function readAddressProofRequest(value: AddressProofRequest | string): AddressProofRequest;
/** Checks an address proof and, given its request, that the proof answers it. */
export declare function verifyAddressProof(proof: AddressProofDocument | string, options?: VerifyProofOptions): AddressProofVerdict;
