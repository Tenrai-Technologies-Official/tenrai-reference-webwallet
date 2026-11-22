import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { TenraiClient } from "@tenrai/sdk";
import express from "express";
import { sendError } from "./errors.ts";
import { walletRelay } from "./relay.ts";

test("the relay passes what the page needs to check its private notes, with exact inputs", async (t) => {
  const asked: string[] = [];
  const upstream = new TenraiClient({
    url: "http://upstream.invalid",
    target: "node",
    retries: 0,
    fetch: async (input, init) => {
      const url = new URL(new Request(input, init).url);
      asked.push(`${url.pathname}${url.search}`);
      if (url.pathname === "/v1/finality/cuts/9") {
        return Response.json({ api_version: 1, code: "not_found", message: "this node holds no such cut", retry_after_millis: null }, { status: 404 });
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
  const get = (path: string) => fetch(`http://127.0.0.1:${address.port}${path}`);

  const root = "cd".repeat(48);
  const head = "ab".repeat(258);
  for (const path of [
    "/v1/private/anchor",
    "/v1/private/notes?from=512&limit=512",
    "/v1/private/nullifiers?from_height=3&limit=512",
    `/v1/private/nullifier-updates?from_height=3&at_height=40&root=${root}`,
    `/v1/finality/bridge?after=${head}`,
    `/v1/finality/bridge?after=${head}&max_links=1`,
    `/v1/finality/bridge?after=${head}&max_links=64`,
    "/v1/finality/cuts/7",
    "/v1/cuts/7",
    "/v1/private/cuts/7",
  ]) {
    const answer = await get(path);
    assert.equal(answer.status, 200, path);
  }
  assert.deepEqual(asked, [
    "/v1/private/anchor",
    "/v1/private/notes?from=512&limit=512",
    "/v1/private/nullifiers?from_height=3&limit=512",
    `/v1/private/nullifier-updates?from_height=3&at_height=40&root=${root}`,
    `/v1/finality/bridge?after=${head}`,
    `/v1/finality/bridge?after=${head}&max_links=1`,
    `/v1/finality/bridge?after=${head}&max_links=64`,
    "/v1/finality/cuts/7",
    "/v1/cuts/7",
    "/v1/private/cuts/7",
  ]);

  // The node's refusal reaches the page as the node's, so the page can take another way.
  const missing = await get("/v1/finality/cuts/9");
  assert.equal(missing.status, 404);

  // What the SDK refuses never reaches the node.
  for (const path of [
    "/v1/private/notes?from=-1",
    "/v1/private/notes?from=1e3",
    "/v1/private/nullifier-updates?from_height=3&at_height=40&root=AB",
    "/v1/private/nullifier-updates?at_height=40",
    "/v1/finality/bridge?after=xyz",
    `/v1/finality/bridge?after=${head}&max_links=0`,
    `/v1/finality/bridge?after=${head}&max_links=65`,
    `/v1/finality/bridge?after=${head}&max_links=1&max_links=2`,
    "/v1/cuts/x",
    "/v1/private/cuts/x",
    "/v1/finality/cuts/x",
  ]) {
    const answer = await get(path);
    assert.equal(answer.status, 400, path);
  }
  assert.equal(asked.length, 11);
});
