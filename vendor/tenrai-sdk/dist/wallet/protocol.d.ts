import type { Network } from "../types/common.ts";
import type { TransactionManifest } from "../types/transaction.ts";
import type { Bindings } from "./runtime.ts";
export declare const PUBLIC_KEY_BYTES = 1952;
export declare const SIGNATURE_BYTES = 3309;
export interface Rules {
    network: Network;
    chainId: string;
    finalizedHeight: bigint;
    maxInputs: number;
    maxOutputs: number;
    maxWitnesses: number;
    maxWireBytes: number;
    minimumFeePerMass: bigint;
    maxMass: bigint;
    maxPayloadBytes: number;
    maxValidityCuts: bigint;
}
export interface Quote {
    mass: bigint;
    minimumFee: bigint;
    witnesses: number;
}
export interface BodyView {
    transactionId: string;
    inputs: {
        transactionId: string;
        outputIndex: number;
    }[];
    outputs: {
        address: string;
        amount: bigint;
    }[];
}
export interface BodyRequest {
    valid_from_height: string;
    valid_until_height: string;
    inputs: {
        transaction_id: string;
        output_index: string;
    }[];
    outputs: {
        address: string;
        amount: string;
    }[];
    payload_hex?: string;
    operation?: {
        type: string;
        data: Record<string, string>;
    };
}
export type WitnessProfile = "inline" | "referenced";
/** The Rust transaction rules bound to one node's manifest; every answer is checked again. */
export declare class ProtocolRules {
    #private;
    readonly rules: Rules;
    constructor(wasm: Bindings, manifest: TransactionManifest);
    transactionManifest(): string;
    parseAddress(text: string, network?: Network): string;
    encodeBody(request: BodyRequest): Uint8Array;
    inspectBody(body: Uint8Array): BodyView;
    /** The protocol package refuses to quote a transaction over the limits, which counts as too heavy. */
    quote(body: Uint8Array, profiles: WitnessProfile[]): Quote;
    spendMessage(body: Uint8Array, index: number, previous: {
        address: string;
        amount: bigint;
    }): Uint8Array;
    operationMessage(body: Uint8Array): Uint8Array;
    possessionMessage(body: Uint8Array): Uint8Array;
    witness(profile: WitnessProfile, publicKey: Uint8Array, signature: Uint8Array): Uint8Array;
    assemble(body: Uint8Array, witnesses: Uint8Array): Uint8Array;
    inspect(wire: Uint8Array): {
        transactionId: string;
        mass: bigint;
    };
    /** Throws unless every input, and the owner of an operation, signed exactly this transaction. */
    verify(wire: Uint8Array, previous: {
        address: string;
        amount: bigint;
    }[], referenced: Uint8Array[], owner?: string): void;
}
export declare function toHex(bytes: Uint8Array): string;
