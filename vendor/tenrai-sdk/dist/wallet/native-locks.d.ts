import { type PublicSendEvidence } from "./public-send-evidence.ts";
import type { TenraiClient } from "../client.ts";
import type { Network, OutPoint, UtxoRecord } from "../types/common.ts";
import type { TransactionManifest } from "../types/transaction.ts";
export type NativeLockBranch = "claim" | "refund";
export type NativeLockRequest = {
    type: "timelock";
    owner_address: string;
    unlock_height: string;
} | {
    type: "hashlock";
    owner_address: string;
    hash_hex: string;
} | {
    type: "htlc";
    claim_address: string;
    refund_address: string;
    hash_hex: string;
    refund_height: string;
};
/** Public recovery data. Back up this descriptor alongside the wallet recovery phrase. */
export interface NativeLockDescriptor {
    readonly descriptor_hex: string;
    readonly lock_hex: string;
    readonly address: string;
    readonly type: "timelock" | "hashlock" | "htlc";
    readonly owner_address?: string;
    readonly claim_address?: string;
    readonly refund_address?: string;
    readonly hash_hex?: string;
    readonly unlock_height?: string;
    readonly refund_height?: string;
}
export interface NativeLockSpendReview {
    readonly transactionId: string;
    readonly descriptor: NativeLockDescriptor;
    readonly branch: NativeLockBranch;
    readonly authorityAddress: string;
    readonly destination: string;
    readonly outpoint: Readonly<OutPoint>;
    readonly inputAmount: bigint;
    readonly amount: bigint;
    readonly fee: bigint;
    readonly validFrom: bigint;
    readonly validUntil: bigint;
    readonly preimageBytes: number;
}
export interface SignedNativeLockSpend {
    readonly transactionId: string;
    readonly wireHex: string;
    readonly amount: bigint;
    readonly fee: bigint;
    readonly validUntil: bigint;
}
/** Manifest-bound native locks. The protocol WASM validates every descriptor, witness and signature. */
export declare class NativeLockSession {
    #private;
    readonly network: Network;
    private constructor();
    static fromManifest(manifest: TransactionManifest): Promise<NativeLockSession>;
    create(request: NativeLockRequest): NativeLockDescriptor;
    inspect(descriptorHex: string): NativeLockDescriptor;
    /** Hashes raw bytes. A claim publishes these bytes on chain. */
    hash(preimageHex: string): string;
    /** A bounded, consistent finalized snapshot; locked funds are kept separate from ordinary spendable balance. */
    watch(client: TenraiClient, descriptorHex: string): Promise<readonly UtxoRecord[]>;
    /** @internal Use `Wallet.reviewNativeLockSpend` to supply the wallet's verification context. */
    prepareSpend(client: TenraiClient, request: {
        descriptorHex: string;
        branch: NativeLockBranch;
        preimageHex?: string;
        outpoint: OutPoint;
        destination: string;
        maxFee?: bigint;
    }, owner?: PublicSendEvidence): Promise<NativeLockSpendReview>;
    transactionManifest(review: NativeLockSpendReview): string;
    /** @internal Bind a spend review to the wallet that prepared it. */
    assertOwner(review: NativeLockSpendReview, owner: PublicSendEvidence): void;
    /** Signs only a review produced by this session, with the exact key named by the selected branch; a repeat must sign validly again. */
    signSpend(review: NativeLockSpendReview, publicKey: Uint8Array, sign: (message: Uint8Array) => Uint8Array): Promise<SignedNativeLockSpend>;
}
