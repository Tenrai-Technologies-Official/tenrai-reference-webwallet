import type { Network } from "../types/common.ts";
import type { TransactionManifest } from "../types/transaction.ts";
export declare const MAX_MULTISIG_PACKAGE_BYTES: number;
export declare const MULTISIG_PUBLIC_KEY_BYTES = 1952;
export declare const MULTISIG_SIGNATURE_BYTES = 3309;
export type MultisigThreshold = 2 | 3;
/** The authorization encoding a signer reviewed for every threshold input. */
export type MultisigWitnessProfile = "threshold-ml-dsa-65-inline" | "threshold-ml-dsa-65-referenced";
export interface MultisigDescriptor {
    readonly threshold: MultisigThreshold;
    readonly members: readonly string[];
}
export interface MultisigPackageInput {
    readonly index: number;
    readonly transactionId: string;
    readonly outputIndex: number;
    readonly amount: bigint;
}
export interface MultisigPackageOutput {
    readonly index: number;
    readonly address: string;
    readonly amount: bigint;
    readonly lock: string;
}
export interface MultisigPackageSignature {
    readonly inputIndex: number;
    readonly memberIndex: number;
}
/** Immutable facts a signer must display before adding a signature. */
export interface MultisigPackageReview {
    readonly templateDigest: string;
    readonly transactionId: string;
    readonly chainId: string;
    readonly protocolVersion: number;
    readonly rulesHash: string;
    readonly validFromHeight: bigint;
    readonly validUntilHeight: bigint;
    readonly inputs: readonly MultisigPackageInput[];
    readonly outputs: readonly MultisigPackageOutput[];
    readonly fee: bigint;
    readonly descriptor: MultisigDescriptor & {
        readonly address: string;
    };
    readonly witnessProfile: MultisigWitnessProfile;
    readonly signatures: readonly MultisigPackageSignature[];
    readonly requiredSignatures: number;
    readonly missingSignatures: number;
    readonly complete: boolean;
    readonly payloadHex: string | undefined;
}
export interface MultisigSigningMessages {
    readonly templateDigest: string;
    readonly transactionId: string;
    readonly memberIndex: number;
    readonly messages: readonly Uint8Array[];
}
export interface MultisigBodyRequest {
    readonly valid_from_height: string;
    readonly valid_until_height: string;
    readonly inputs: readonly {
        readonly transaction_id: string;
        readonly output_index: string;
    }[];
    readonly outputs: readonly {
        readonly address: string;
        readonly amount: string;
    }[];
    readonly payload_hex?: string;
}
/** Manifest-bound offline packages for transparent 2-of-3 and 3-of-5 payments. */
export declare class MultisigSession {
    #private;
    readonly network: Network;
    readonly chainId: string;
    readonly maxWireBytes: number;
    private constructor();
    static fromManifest(manifest: TransactionManifest): Promise<MultisigSession>;
    encodeBody(request: MultisigBodyRequest): Uint8Array;
    createDescriptor(threshold: MultisigThreshold, members: readonly Uint8Array[]): MultisigDescriptor;
    validateDescriptor(value: MultisigDescriptor | string): MultisigDescriptor;
    address(value: MultisigDescriptor | string): string;
    createPackage(descriptorValue: MultisigDescriptor | string, body: Uint8Array, inputAmounts: readonly bigint[]): Uint8Array;
    decodePackage(value: Uint8Array): Uint8Array;
    review(value: Uint8Array): MultisigPackageReview;
    signingMessages(value: Uint8Array, reviewedTemplate: string, publicKey: Uint8Array): MultisigSigningMessages;
    addMemberSignatures(value: Uint8Array, reviewedTemplate: string, publicKey: Uint8Array, signatures: readonly Uint8Array[]): Uint8Array;
    signMember(value: Uint8Array, reviewedTemplate: string, publicKey: Uint8Array, sign: (message: Uint8Array) => Uint8Array): Uint8Array;
    combine(left: Uint8Array, right: Uint8Array): Uint8Array;
    transactionManifest(): string;
    complete(value: Uint8Array): Uint8Array;
    private call;
}
