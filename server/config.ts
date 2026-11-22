import { resolve } from "node:path";

export interface Config {
  host: string;
  port: number;
  apiUrl: string;
  nodeUrl: string | null;
  explorerUrl: string;
  /** Allows sends during sync on a test network. */
  sendWhenNotSynced: boolean;
  /** Requests per minute per client. Zero disables the rate limit. */
  rateLimit: number;
  /** Trust root for a test network. */
  testGenesisManifest: string | null;
  dev: boolean;
}

function serviceUrl(value: string, name: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${name} must be an http or https URL`);
  }
  return url.href.replace(/\/+$/, "");
}

export function readConfig(): Config {
  const port = Number(process.env.PORT ?? 28784);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be a port number");
  }
  const rateLimit = Number(process.env.TENRAI_RATE_LIMIT ?? 600);
  if (!Number.isSafeInteger(rateLimit) || rateLimit < 0) {
    throw new Error("TENRAI_RATE_LIMIT must be a whole number of requests per minute");
  }
  const explorer = new URL(serviceUrl(process.env.TENRAI_EXPLORER_URL ?? "https://explorer.tenrai-technologies.org", "TENRAI_EXPLORER_URL"));
  return {
    host: process.env.HOST ?? "127.0.0.1",
    port,
    apiUrl: serviceUrl(process.env.TENRAI_API_URL ?? "https://api.tenrai-technologies.org", "TENRAI_API_URL"),
    nodeUrl: process.env.TENRAI_NODE_URL ? serviceUrl(process.env.TENRAI_NODE_URL, "TENRAI_NODE_URL") : null,
    explorerUrl: explorer.origin + explorer.pathname.replace(/\/+$/, ""),
    testGenesisManifest: process.env.TENRAI_TEST_GENESIS_MANIFEST ? resolve(process.env.TENRAI_TEST_GENESIS_MANIFEST) : null,
    sendWhenNotSynced: ["1", "true"].includes((process.env.TENRAI_SEND_WHEN_NOT_SYNCED ?? "").trim().toLowerCase()),
    rateLimit,
    dev: process.argv.includes("--dev"),
  };
}
