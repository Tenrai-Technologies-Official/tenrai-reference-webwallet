var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import * as bindings from "../../wasm/tenrai_wasm.js";
import { TenraiError } from "../errors.js";
// SHA-256 of the protocol binary in wasm/release.json.
const WASM_SHA256 = "f432fdc69ff0771f108452772d2bd9e46b3d6be1a6f3ef6aab131b01d5cd448c";
const NODE_FS = "node:fs/promises";
let loading;
export function protocolBindings(source) {
    loading ??= load(source).catch((error) => {
        loading = undefined;
        throw error;
    });
    return loading;
}
async function load(source) {
    const bytes = source instanceof Uint8Array
        ? new Uint8Array(source)
        : await read(new URL(source ?? "../../wasm/tenrai_wasm_bg.wasm", import.meta.url));
    await checkBinary(bytes);
    bindings.initSync({ module: bytes });
    return bindings;
}
export async function checkBinary(bytes) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (hex !== WASM_SHA256) {
        throw new TenraiError("the protocol WASM does not match the reviewed build");
    }
}
async function read(url) {
    if (url.protocol === "file:") {
        const fs = (await import(__rewriteRelativeImportExtension(/* @vite-ignore */ NODE_FS)));
        return new Uint8Array(await fs.readFile(url));
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new TenraiError(`the protocol WASM could not be loaded (HTTP ${response.status})`);
    }
    return new Uint8Array(await response.arrayBuffer());
}
