import type { PrivateInventoryStore } from "./private-inventory-store.ts";
import type { CallOptions } from "../http.ts";
export interface InventoryScan {
    inventoryNext(): string;
    inventoryResult(): string;
    takeInventoryRead(id: string, bytes: Uint8Array): void;
    inventoryWriteBytes(id: string): Uint8Array;
    inventoryWritten(id: string): void;
    inventoryRoots(): string;
    inventoryChildren(tree: number, generation: string, id: string, bytes: Uint8Array): string;
    beginNotePage(after: string | undefined, limit: number): void;
}
export interface LocalPrivateNote {
    note: number;
    valueAtoms: bigint;
    noteCommitment: string;
}
export interface LocalPrivateNotePage {
    notes: LocalPrivateNote[];
    nextNote: number | null;
}
export declare function readInventory(scan: InventoryScan, store: PrivateInventoryStore | undefined, id: string, assertOpen: () => void, call: CallOptions): Promise<void>;
export declare function writeInventory(scan: InventoryScan, store: PrivateInventoryStore | undefined, id: string, assertOpen: () => void, call: CallOptions): Promise<void>;
export declare function inventoryQuery(scan: InventoryScan, store: PrivateInventoryStore | undefined, assertOpen: () => void, call: CallOptions): Promise<Record<string, unknown>>;
export declare function inventoryNotePage(scan: InventoryScan, store: PrivateInventoryStore | undefined, after: string | undefined, limit: number, assertOpen: () => void, call: CallOptions): Promise<LocalPrivateNotePage>;
/** Runs only after the exact state bytes and all referenced objects have durably committed. */
export declare function collectInventory(scan: InventoryScan, store: PrivateInventoryStore | undefined, sealedState: Uint8Array, assertOpen: () => void, call: CallOptions): Promise<void>;
