import type { PublicCoinView } from "./public-coin-source.ts";
import type { TenraiClient } from "../client.ts";
import type { Network } from "../types/common.ts";
import type { Scan } from "./funds.ts";
import type { Coin, Operation, OperationSigners, Owner, Plan, Signer } from "./plan.ts";
import type { ProtocolRules, Rules } from "./protocol.ts";
import type { Branch, FeeOptions, SentTransfer } from "./types.ts";
export declare const NETWORKS: readonly Network[];
export interface Context {
    protocol: ProtocolRules;
    rules: Rules;
    scan: Scan;
    /** At most 512 largest unreserved coins, only for bounded consolidation windows. */
    coins: Coin[];
    inventory: PublicCoinView;
    close(): Promise<void>;
    referenced: Set<string>;
    feePerMass: bigint;
    validFrom: bigint;
    validUntil: bigint;
}
/** A staking operation; `reserved` leaves the wallet with it, `released` comes back to the wallet. */
export interface StakeOperation {
    operation: Operation;
    authorities: OperationSigners;
    reserved?: bigint;
    released?: bigint;
}
/** Plan fields every transfer shares. */
export interface PlanBase {
    coins: Coin[];
    feePerMass: bigint;
    validFrom: bigint;
    validUntil: bigint;
    referenced: Set<string>;
}
/** What the operations in their own modules need from the wallet that holds the keys. */
export interface Desk {
    address(index?: number, branch?: Branch): string;
    context(client: TenraiClient, fee: FeeOptions): Promise<Context>;
    base(context: Context): PlanBase;
    changeAddress(context: Context): string;
    steps(client: TenraiClient, context: Context, plans: Plan[]): Promise<SentTransfer[]>;
    owner(context: Context, value: string): Owner;
    validatorSigner(index: number, purpose: "possession" | "validator"): Signer;
    operate(client: TenraiClient, context: Context, request: StakeOperation): Promise<SentTransfer>;
}
