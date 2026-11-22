import type { Bindings } from "./runtime.ts";
import type { Network } from "../types/common.ts";
import type { PublicCoinCheckpointCodec } from "./public-coin-persistent-types.ts";
export interface OwnedPublicCoinCodec extends PublicCoinCheckpointCodec {
    readonly chainId: string;
    close(): void;
}
export declare function publicCoinCodec(wasm: Bindings, root: InstanceType<Bindings["WalletRoot"]>, network: Network, genesis: string | undefined, account: number): OwnedPublicCoinCodec;
