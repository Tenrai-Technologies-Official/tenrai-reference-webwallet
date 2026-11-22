import * as bindings from "../../wasm/tenrai_wasm.js";
export type Bindings = typeof bindings;
export declare function protocolBindings(source?: URL | string | Uint8Array): Promise<Bindings>;
export declare function checkBinary(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
