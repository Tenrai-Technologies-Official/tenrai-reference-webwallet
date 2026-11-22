import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import test from "node:test";
import { TenraiClient } from "@tenrai/sdk";
import express from "express";
import { sendError } from "./errors.ts";
import { walletRelay } from "./relay.ts";

test("compressed bodies with trailing bytes never reach a decoder or the node", async (t) => {
  let forwarded = 0;
  const upstream = new TenraiClient({
    url: "http://upstream.invalid",
    target: "node",
    retries: 0,
    fetch: async () => { forwarded++; throw new Error("compressed input was forwarded"); },
  });
  const app = express();
  app.use(walletRelay(upstream), sendError);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const json = Buffer.from('{"wire_hex":"00","bytes":"00"}');
  const compressed = [["gzip", gzipSync(json)], ["deflate", deflateSync(json)], ["br", brotliCompressSync(json)]] as const;
  for (const [encoding, frame] of compressed) {
    const encoded = Uint8Array.from(Buffer.concat([
      frame, Buffer.from("trailing bytes after the compressed frame"),
    ]));
    for (const route of ["/v1/transactions", "/v1/private/transfers"]) {
      const response = await fetch(base + route, {
        method: "POST", headers: { "content-type": "application/json", "content-encoding": encoding },
        body: encoded,
      });
      assert.equal(response.status, 415, `${encoding} must not reach a decoder at ${route}`);
      const payload: unknown = await response.json();
      assert.ok(payload !== null && typeof payload === "object" && "code" in payload);
      assert.equal(payload.code, "unsupported_media_type");
    }
  }
  assert.equal(forwarded, 0);
  const alive = await fetch(base + "/not_a_wallet_route");
  assert.equal(alive.status, 404);
});
