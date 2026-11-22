import type { FinalityProof } from "./finality-guard.ts";
import type { TenraiClient } from "../client.ts";
import type { CallOptions } from "../http.ts";
import type { PrivateLocalScanStore } from "./private-local-store.ts";
import type { PrivateInventoryStore } from "./private-inventory-store.ts";
import { type InventoryScan } from "./private-inventory-runtime.ts";
export type PrivateScanRequest = {
    kind: "anchor";
} | {
    kind: "bridge";
    after: string;
} | {
    kind: "cut_proof";
    height: number;
} | {
    kind: "notes";
    from: number;
} | {
    kind: "spend_proof";
    from_height: number;
    at_height: number;
    root: string;
} | {
    kind: "spend_keys";
    at_height: number;
    after: string | null;
} | {
    kind: "local_read";
    generation: string;
    page: string;
} | {
    kind: "local_write";
    generation: string;
    page: string;
} | {
    kind: "inventory_read";
    id: string;
} | {
    kind: "inventory_write";
    id: string;
} | {
    kind: "checkpoint";
} | {
    kind: "done";
};
export interface PrivateRefreshScan extends InventoryScan {
    takeAnchor(answer: string): void;
    takeBridge(answer: string): void;
    takeCutProof(answer: string): void;
    takeNotes(answer: string): void;
    notesRefused(): void;
    takeSpendProof(answer: string): void;
    spendProofRefused(): void;
    takeSpendKeys(answer: string): void;
    spendKeysRefused(): void;
    takeLocalRead(bytes: Uint8Array): void;
    localWriteBytes(): Uint8Array;
    localWritten(): void;
    checkpointWritten(): void;
    scratchGeneration(): string | undefined;
}
export interface PrivateScanDriver {
    proof: FinalityProof;
    scan: PrivateRefreshScan;
    client: TenraiClient;
    localPages: PrivateLocalScanStore | undefined;
    inventoryPages: PrivateInventoryStore | undefined;
    assertOpen(): void;
    readRecords(call: CallOptions): Promise<void>;
    save(): Promise<Uint8Array>;
}
export declare function answerPrivateScan(context: PrivateScanDriver, request: Exclude<PrivateScanRequest, {
    kind: "done";
}>, call: CallOptions): Promise<void>;
