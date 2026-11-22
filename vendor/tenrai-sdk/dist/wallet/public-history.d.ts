import type { AddressEvent } from "../types/address.ts";
import type { TenraiClient } from "../client.ts";
/** Globally requested transactions, with fixed row/work budgets and bounded in-flight pages. */
export declare class PublicHistory {
    #private;
    readonly most: number;
    constructor(most: number);
    older(height: number): boolean;
    take(address: string, event: AddressEvent): void;
    finish(): AddressEvent[];
    get bufferedRows(): number;
    get bufferedTransactions(): number;
}
export declare function collectPublicHistory(client: TenraiClient, addresses: readonly string[], most: number): Promise<AddressEvent[]>;
