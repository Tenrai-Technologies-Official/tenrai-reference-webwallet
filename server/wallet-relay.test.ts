import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { TenraiClient } from "@tenrai/sdk";
import express from "express";
import { sendError } from "./errors.ts";
import { walletRelay } from "./relay.ts";

const OWNER = "dtrai1qyq3qjnpaqkpdmvntqart7cd4p9hha6k559ez9dm3chxdmuv8xjnkm0927xgs95s0ems2c5fwe";
const VALIDATOR = "ef".repeat(48);
const ANCHOR = { height: 40, cut_id: "11".repeat(48), state_root: "22".repeat(48), validator_set_id: "33".repeat(48) };
const OUTPOINT = { transaction_id: "44".repeat(48), output_index: 1 };
/** A validator as the SDK's checks want it, whatever its values. */
const VALIDATOR_VIEW = {
  validator_id: VALIDATOR, owner_address: OWNER, owner_nonce: 0, state: "eligible", exit_request_height: null, is_active: true,
  inactive_reasons: [], self_bond_position_id: "cd".repeat(48), position_capacity: 256, live_positions: 1,
  available_position_slots: 255, accepting_delegations: true, consensus_key_version: 0, consensus_public_key: "00".repeat(1952),
  overlay_endpoint_hex: `20${"00".repeat(32)}220020${"00".repeat(32)}0100c6336400106800`, pending_endpoint: null,
  commission_bps: 100, pending_commission: null, last_heartbeat_epoch: 0, last_attendance_epoch: null, jailed_until_epoch: null,
  activation_epoch: 0, activation_height: 0, penalty_generation: 0, pending_key_activation_epoch: null,
};

test("the relay passes the routes the SDK's coins, sends, scan and staking take, with exact inputs", async (t) => {
  const asked: { method: string; path: string; query: Record<string, string>; body: unknown }[] = [];
  const upstream = new TenraiClient({
    url: "http://upstream.invalid",
    target: "node",
    retries: 0,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.json() : undefined;
      asked.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
      if (url.pathname === "/v1/proofs/utxo-presence") {
        return Response.json({
          api_version: 1, network: "development", chain_id: "de".repeat(48), anchor: ANCHOR,
          state_commitment: "55".repeat(842), proofs: [{ outpoint: OUTPOINT, record: null, proof: "66".repeat(8) }],
        });
      }
      if (url.pathname === `/v1/staking/validators/${VALIDATOR}`) {
        return Response.json({ api_version: 1, finalized_height: 40, validator: VALIDATOR_VIEW, self_bond: null });
      }
      return Response.json({ api_version: 1, path: url.pathname });
    },
  });
  const app = express();
  app.use(walletRelay(upstream), sendError);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((failure) => (failure ? reject(failure) : resolve())));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const get = (path: string) => fetch(base + path);
  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  const passed = async (label: string, answer: Promise<Response>) => {
    const response = await answer;
    assert.equal(response.status, 200, `${label}: ${await response.text()}`);
  };
  const ranges = { api_version: 1, at_height: 40, addresses: [{ address: OWNER, after_height: 3 }], limit: 256 };
  await passed("history ranges", post("/v1/address/history-range", ranges));
  await passed("one range", get(`/v1/address/${OWNER}/history?after_height=3&at_height=40&limit=200`));
  await passed("history", get(`/v1/address/${OWNER}/history?limit=20`));
  await passed("presence", post("/v1/proofs/utxo-presence", { api_version: 1, anchor: ANCHOR, outpoints: [OUTPOINT] }));
  await passed("spend keys", get(`/v1/private/nullifier-keys?at_height=40&after=${"77".repeat(48)}&limit=512`));
  await passed("validator", get(`/v1/staking/validators/${VALIDATOR}`));
  await passed("storage", get("/v1/storage"));
  assert.deepEqual(asked, [
    { method: "POST", path: "/v1/address/history-range", query: {}, body: ranges },
    { method: "GET", path: `/v1/address/${OWNER}/history`, query: { limit: "200", after_height: "3", at_height: "40" }, body: undefined },
    { method: "GET", path: `/v1/address/${OWNER}/history`, query: { limit: "20" }, body: undefined },
    { method: "POST", path: "/v1/proofs/utxo-presence", query: {}, body: { api_version: 1, anchor: ANCHOR, outpoints: [OUTPOINT] } },
    { method: "GET", path: "/v1/private/nullifier-keys", query: { at_height: "40", after: "77".repeat(48), limit: "512" }, body: undefined },
    { method: "GET", path: `/v1/staking/validators/${VALIDATOR}`, query: {}, body: undefined },
    { method: "GET", path: "/v1/storage", query: {}, body: undefined },
  ]);

  // What the SDK refuses never reaches the node.
  for (const [path, body] of [
    ["/v1/address/history-range", { ...ranges, at_height: 2 }],
    ["/v1/address/history-range", { ...ranges, addresses: [] }],
    ["/v1/proofs/utxo-presence", { api_version: 1, anchor: ANCHOR, outpoints: [] }],
  ] as const) {
    assert.equal((await post(path, body)).status, 400, path);
  }
  for (const path of [
    `/v1/address/${OWNER}/history?after_height=x&at_height=40`,
    `/v1/address/${OWNER}/history?after_height=50&at_height=40`,
    "/v1/private/nullifier-keys?limit=5",
    "/v1/private/nullifier-keys?at_height=40&after=xyz",
    "/v1/staking/validators/x",
  ]) {
    assert.equal((await get(path)).status, 400, path);
  }
  assert.equal(asked.length, 7);
});
