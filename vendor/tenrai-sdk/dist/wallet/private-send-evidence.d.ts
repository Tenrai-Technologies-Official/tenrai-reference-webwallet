import type { FinalityProof } from "./finality-guard.ts";
import type { TenraiClient } from "../client.ts";
import type { PrivateSend, PrivateSendEvidence } from "./private-sends.ts";
import type { Bindings } from "./runtime.ts";
export interface StatementScan {
    summary(): string;
    statementFrameInfo(frame: string): string;
    registrationFrameInfo?(frame: string, metadata: string): string;
    registrationVerifiedHead?(): string;
    registrationProofRequest?(height: bigint): string;
    takeRegistrationBridge?(answer: string): void;
    verifyRegistrationExecution?(frame: string, metadata: string, proof: string, cut: string, items: string): string;
    statementSourcesUnspent(frame: string, sources: string): boolean;
    verifiedHead(): string;
    statementProofRequest(height: bigint): string;
    takeStatementBridge(answer: string): void;
    verifyStatementExecution(frame: string, digest: string, kind: string, proof: string, cut: string, items: string): string;
}
export declare function statementScan(value: unknown): StatementScan;
/** Checks local journal metadata against the canonical chain-bound original frame. */
export declare function validateStatementSend(scan: StatementScan, entry: PrivateSend): {
    from: number;
    until: number;
};
/** Calls are serialized with refresh by PrivateNotes; no node-reported head is trusted here. */
export declare function privateSendEvidence(scan: StatementScan, client: TenraiClient, wasm: Bindings, registration?: () => StatementScan, sources?: (entry: PrivateSend) => Promise<boolean>, proof?: FinalityProof): PrivateSendEvidence;
