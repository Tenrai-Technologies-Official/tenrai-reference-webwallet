import { TenraiClient } from "@tenrai/sdk";
import { loadProtocolRules } from "@tenrai/sdk/wallet";
import wasm from "../vendor/tenrai-sdk/wasm/tenrai_wasm_bg.wasm?url";

export type ServiceName = "api" | "node";

const SERVICE_KEY = "tenrai-wallet-service";

export function savedService(): ServiceName {
  try {
    return localStorage.getItem(SERVICE_KEY) === "node" ? "node" : "api";
  } catch {
    return "api";
  }
}

/** The choice takes effect with the next page load, which locks the wallet. */
export function saveService(name: ServiceName): void {
  try {
    localStorage.setItem(SERVICE_KEY, name);
  } catch {
    // Without storage the page stays on the Tenrai API.
  }
}

/** Services this server relays: the Tenrai API and, if set, its own node. */
export async function servicesOffered(): Promise<ServiceName[]> {
  try {
    const config = (await (await fetch("/api/config")).json()) as { services?: unknown };
    return Array.isArray(config.services) && config.services.includes("node") ? ["api", "node"] : ["api"];
  } catch {
    return ["api"];
  }
}

export const service = savedService();

/** The page reads the chain only through its own server, which relays the routes a wallet needs. */
export const tenrai = new TenraiClient({ url: new URL(`/api/${service}`, window.location.origin).href, target: service });

// Without its own node the server relays the API only; other choices fall back to it.
if (service === "node") {
  void servicesOffered().then((offered) => {
    if (!offered.includes("node")) {
      saveService("api");
      window.location.reload();
    }
  });
}

/** Vite gives the protocol WASM a new URL; the SDK still checks it against its pinned hash. */
export const protocolReady: Promise<void> = loadProtocolRules(wasm);
