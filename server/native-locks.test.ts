import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { TenraiClient } from "@tenrai/sdk";
import express from "express";
import { sendError } from "./errors.ts";
import { walletRelay } from "./relay.ts";

test("native-lock finalized UTXO proof relay preserves its anchor and rejects invalid batches before upstream", async (t) => {
  const anchor = { height: 100, cut_id: "11".repeat(48), state_root: "22".repeat(48), validator_set_id: "33".repeat(48) };
  const outpoint = { transaction_id: "44".repeat(48), output_index: 0 };
  const proof = { api_version: 1, network: "testnet", chain_id: "55".repeat(48), anchor, state_commitment: "", proofs: [] };
  let calls = 0;
  const upstream = new TenraiClient({ url: "http://upstream.invalid", target: "node", fetch: async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.method, "POST");
    assert.equal(new URL(request.url).pathname, "/v1/proofs/utxos");
    assert.deepEqual(await request.json(), { api_version: 1, anchor, outpoints: [outpoint] });
    calls += 1;
    return Response.json(proof);
  } });
  const app = express();
  app.use(walletRelay(upstream), sendError);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((failure) => failure ? reject(failure) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const send = (body: unknown) => fetch(`http://127.0.0.1:${address.port}/v1/proofs/utxos`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  const valid = await send({ api_version: 1, anchor, outpoints: [outpoint] });
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), proof);
  assert.equal(calls, 1);
  for (const body of [{ api_version: 1, outpoints: [outpoint] }, { api_version: 1, anchor, outpoints: Array(9).fill(outpoint) }]) {
    const invalid = await send(body);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json() as { code: string }).code, "invalid_request");
    assert.equal(calls, 1);
  }
});
