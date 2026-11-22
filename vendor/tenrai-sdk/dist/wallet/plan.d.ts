import type { FeeEstimate, FeePriority } from "../types/chain.ts";
import type { BodyView, ProtocolRules, Quote, Rules, WitnessProfile } from "./protocol.ts";
/** How long a signed transfer stays valid, in cuts; the manifest may allow less. */
export declare const VALIDITY_CUTS = 1800n;
export interface Coin {
    address: string;
    transactionId: string;
    outputIndex: number;
    amount: bigint;
    height?: number;
}
export interface Output {
    address: string;
    amount: bigint;
}
/** A staking operation as the protocol package encodes it. */
export interface Operation {
    type: "register" | "bond" | "exit" | "unbond" | "withdraw" | "rotate" | "endpoint" | "reward_lock" | "heartbeat" | "commission";
    data: Record<string, string>;
}
export interface Plan {
    body: Uint8Array;
    view: BodyView;
    quote: Quote;
    fee: bigint;
    inputs: Coin[];
    profiles: WitnessProfile[];
    outputs: Output[];
    operation: Operation | undefined;
}
export interface PlanRequest {
    coins: Coin[];
    payments: Output[];
    changeAddress: string;
    feePerMass: bigint;
    payloadHex: string;
    validFrom: bigint;
    validUntil: bigint;
    referenced: ReadonlySet<string>;
    /** Taken from the inputs by the operation, such as a bond. */
    reserved?: bigint;
    /** Added by the operation, such as a withdrawn stake. */
    released?: bigint;
    operation?: Operation;
    /** Spends the coins in their order, up to the input limit, and pays all but the fee here. */
    sweep?: string;
    /** Coins the transfer has to spend, such as the one that shows who answers a chat request. */
    include?: Coin[];
}
export interface Signer {
    publicKey: Uint8Array;
    sign(message: Uint8Array): Uint8Array;
}
export declare function feeRate(priority: FeePriority, estimate: FeeEstimate | undefined, rules: Pick<Rules, "minimumFeePerMass" | "maxMass">): bigint;
export declare function compareCoins(left: Coin, right: Coin): number;
export declare function selectCoins(coins: Coin[], target: bigint, limit: number, referenced: ReadonlySet<string>): Coin[];
/** What one more input adds to the fee, with its key inline and with a registered one. */
export interface InputFees {
    inline: bigint;
    referenced: bigint;
}
/**
 * An address with more outputs than one transaction spends also gives its smallest ones worth more than
 * their fee, so they leave with the change instead of piling up; the same rule as the Tenrai wallets.
 */
export declare function fillCoins(chosen: Coin[], coins: Coin[], limit: number, referenced: ReadonlySet<string>, fees: InputFees): Coin[];
export declare function inputFees(protocol: ProtocolRules, request: PlanRequest): InputFees;
/** Inputs plus released minus outputs minus reserved is the fee; it only grows between rounds, so the loop settles. */
export declare function plan(protocol: ProtocolRules, request: PlanRequest): Plan;
/**
 * Moves coins to `destination` in as few transactions as the input limit allows: the smallest coins
 * first, with large ones added when small ones cannot pay their fee. Coins nothing can pay for are skipped.
 * Planning stops after `most` transactions; the coins left over wait for the next call.
 */
export declare function planCompound(protocol: ProtocolRules, request: Omit<PlanRequest, "payments" | "changeAddress" | "payloadHex" | "sweep"> & {
    destination: string;
}, most?: number): {
    plans: Plan[];
    skipped: Coin[];
};
/** What has to be compounded before a payment whose outputs are too many for one transfer. */
export interface MergePlan {
    /** The first round, each step with the address it merges into; empty when the payment fits as it is. */
    steps: {
        plan: Plan;
        destination: string;
    }[];
    /** Outputs the first round spends. */
    outputs: number;
    /** Transfers and fee of every round until the payment fits. */
    transfers: number;
    fee: bigint;
}
/**
 * The compounds that let `sending` go out in one transfer: the largest outputs of each address, the addresses
 * worth most after the fees first, each into `destination` of its address; the same rule as the Tenrai wallets.
 * Throws `insufficient` when the outputs are not worth enough after their fees.
 */
export declare function planMerge(protocol: ProtocolRules, request: Omit<PlanRequest, "payments" | "payloadHex" | "sweep">, sending: bigint, destination?: (address: string) => string, most?: number): MergePlan;
/** The operation's owner, who signs it next to the inputs. */
export interface Owner {
    address: string;
    signer: Signer;
}
/** Native-operation signatures beyond normal input witnesses. */
export interface OperationSigners {
    owner?: Owner;
    possession?: Signer;
    validator?: Signer;
}
/** Signs every input and the operation, then decodes and verifies the result before anyone can submit it. */
export declare function sign(protocol: ProtocolRules, planned: Plan, signerFor: (coin: Coin) => Signer, authorities?: OperationSigners): {
    wire: Uint8Array;
    transactionId: string;
};
export declare function operationAuthorityCount(operation: Operation | undefined): number;
