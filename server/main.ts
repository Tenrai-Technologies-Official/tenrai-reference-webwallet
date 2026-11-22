import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TenraiClient } from "@tenrai/sdk";
import express, { type RequestHandler } from "express";
import { readConfig } from "./config.ts";
import { sendError } from "./errors.ts";
import { relayLimit } from "./limit.ts";
import { walletRelay } from "./relay.ts";

const config = readConfig();
// The browser owns retries. Relay requests share one upstream budget.
const api = new TenraiClient({ url: config.apiUrl, target: "api", retries: 0 });
const node = config.nodeUrl ? new TenraiClient({ url: config.nodeUrl, target: "node", retries: 0 }) : null;

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root, "dist");
if (!config.dev && !existsSync(join(dist, "index.html"))) {
  throw new Error("dist/ is missing; run npm run build first");
}

const app = express();
const server = createServer(app);
// Keep connections open longer than the proxy's idle timeout.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
app.disable("x-powered-by");
// Trust forwarding headers from a local reverse proxy.
app.set("trust proxy", "loopback");
if (!config.dev) {
  app.use(securityHeaders());
}
app.use("/api", relayLimit(config.rateLimit));
app.use("/api/api", walletRelay(api), sendError);
if (node) {
  app.use("/api/node", walletRelay(node), sendError);
}
// Test deployments supply a genesis manifest. Mainnet's trust root is in WASM.
app.get("/api/genesis", (_req, res) => {
  if (!config.testGenesisManifest) {
    res.status(404).json({ api_version: 1, code: "not_found", message: "no test genesis is named", retry_after_millis: null });
    return;
  }
  res.type("application/json").sendFile(config.testGenesisManifest);
});
app.get("/api/config", (_req, res) => {
  res.json({
    api_version: 1,
    explorer_url: config.explorerUrl,
    services: node ? ["api", "node"] : ["api"],
    send_when_not_synced: config.sendWhenNotSynced,
  });
});
app.use("/api", (_req, res) => {
  res.status(404).json({ api_version: 1, code: "not_found", message: "no such route", retry_after_millis: null });
});

// The prover worker has its own CSP.
app.use(
  "/prover",
  (_req, res, next) => {
    res.set("content-security-policy", "default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'");
    next();
  },
  express.static(join(root, "node_modules", "@tenrai", "sdk", "prover"), { index: false, fallthrough: false, immutable: false }),
);

if (config.dev) {
  const vite = await import("vite");
  const frontend = await vite.createServer({ server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
  app.use(frontend.middlewares);
} else {
  app.use("/assets", express.static(join(dist, "assets"), { immutable: true, maxAge: "1y", index: false, fallthrough: false }));
  app.use(express.static(dist, { index: false }));
  app.get("/{*page}", (_req, res) => res.sendFile(join(dist, "index.html")));
}

server.listen(config.port, config.host, () => {
  console.log(`Tenrai wallet on http://${config.host}:${config.port}, relaying ${config.apiUrl}${config.nodeUrl ? ` and ${config.nodeUrl}` : ""}`);
});

function securityHeaders(): RequestHandler {
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types tenrai-prover",
  ].join("; ");
  return (_req, res, next) => {
    res.set({
      "content-security-policy": policy,
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "require-corp",
      "permissions-policy": "camera=(self), microphone=(), geolocation=()",
    });
    next();
  };
}
