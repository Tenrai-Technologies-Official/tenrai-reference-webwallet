import type { Network } from "../types/common.ts";
import type { Signer } from "./plan.ts";
import type { Bindings } from "./runtime.ts";
import type { Branch } from "./types.ts";
export declare const MIN_VALIDATOR_CONSENSUS_KEY_INDEX = 2147418112;
export declare const DEFAULT_VALIDATOR_CONSENSUS_KEY_INDEX = 2147483647;
export declare const DEFAULT_VALIDATOR_ROTATION_KEY_INDEX: number;
export type WalletRoot = InstanceType<Bindings["WalletRoot"]>;
/** The keys of one account as far as they were derived; the secret parts stay in the WASM. */
export declare class KeyChain {
    #private;
    constructor(wasm: Bindings, root: WalletRoot, network: Network, account: number);
    root(): WalletRoot;
    path(address: string): {
        branch: Branch;
        index: number;
    } | undefined;
    key(branch: Branch, index: number): {
        publicKey: Uint8Array;
        address: string;
    };
    signer(address: string, purpose: "spend" | "operation" | "possession" | "validator"): Signer;
    validatorSigner(index: number, purpose: "possession" | "validator"): Signer;
    close(): void;
}
