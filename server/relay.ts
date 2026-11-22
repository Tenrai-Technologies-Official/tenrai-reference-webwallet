import { parseAtoms, type TenraiClient, type FinalizedCut, type OutPoint } from "@tenrai/sdk";
import express, { Router, type Request } from "express";

export function walletRelay(tenrai: TenraiClient): Router {
  const node = Router();
  // Proof routes parse their own larger request bodies.
  const large = express.json({ limit: "3mb", inflate: false });
  node.post("/v1/private/registrations", large, async (req, res) => {
    res.json(await tenrai.privateTransfers.submitRegistration(body(req).bytes as string));
  });
  node.post("/v1/private/transfers", large, async (req, res) => {
    res.json(await tenrai.privateTransfers.submitTransfer(body(req).bytes as string));
  });
  node.post("/v1/private/enters", large, async (req, res) => {
    res.json(await tenrai.privateTransfers.submitEnter(body(req).bytes as string));
  });
  node.post("/v1/private/exits", large, async (req, res) => {
    res.json(await tenrai.privateTransfers.submitExit(body(req).bytes as string));
  });
  node.use(express.json({ limit: "1mb", inflate: false }));

  node.get("/v1/node/info", async (_req, res) => {
    res.json(await tenrai.node.info());
  });

  node.get("/v1/node/sync", async (_req, res) => {
    res.json(await tenrai.node.sync());
  });

  node.get("/v1/storage", async (_req, res) => {
    res.json(await tenrai.node.storage());
  });

  node.get("/v1/transactions/manifest", async (_req, res) => {
    res.json(await tenrai.transactions.manifest());
  });

  node.get("/v1/fees/estimate", async (_req, res) => {
    res.json(await tenrai.fees.estimate());
  });

  node.get("/v1/private/status", async (_req, res) => {
    res.json(await tenrai.privateTransfers.status());
  });

  // Proof routes used by the browser to verify private notes.
  node.get("/v1/private/anchor", async (_req, res) => {
    res.json(await tenrai.privateTransfers.anchor());
  });

  node.get("/v1/private/notes", async (req, res) => {
    res.json(await tenrai.privateTransfers.notes({ from: whole(req.query.from), limit: whole(req.query.limit) }));
  });

  node.get("/v1/private/records", async (req, res) => {
    res.json(await tenrai.privateTransfers.records({ from: whole(req.query.from), limit: whole(req.query.limit) }));
  });

  node.get("/v1/private/statements/:digest", async (req, res) => {
    res.json(await tenrai.privateTransfers.statement(req.params.digest, { maxResponseBytes: 64 * 1024 }));
  });

  node.get("/v1/private/nullifiers", async (req, res) => {
    res.json(
      await tenrai.privateTransfers.nullifiers({ fromHeight: whole(req.query.from_height), limit: whole(req.query.limit) }),
    );
  });

  // The browser falls back to a full spend scan when incremental proofs are unavailable.
  node.get("/v1/private/nullifier-keys", async (req, res) => {
    res.json(
      await tenrai.privateTransfers.nullifierKeys({
        atHeight: whole(req.query.at_height) ?? -1,
        after: text(req.query.after),
        limit: whole(req.query.limit),
      }),
    );
  });

  node.get("/v1/private/nullifier-updates", async (req, res) => {
    res.json(
      await tenrai.privateTransfers.nullifierUpdate({
        fromHeight: whole(req.query.from_height) ?? -1,
        atHeight: whole(req.query.at_height) ?? -1,
        root: text(req.query.root) ?? "",
      }),
    );
  });

  node.get("/v1/finality/bridge", async (req, res) => {
    const maxLinks = req.query.max_links === undefined ? undefined : (whole(req.query.max_links) ?? -1);
    res.json(await tenrai.privateTransfers.finalityBridge(text(req.query.after) ?? "", { maxLinks, maxResponseBytes: 2 * 1024 * 1024 }));
  });

  node.get("/v1/cuts/:height", async (req, res) => {
    res.json(await tenrai.cuts.get(whole(req.params.height) ?? -1, { maxResponseBytes: 1024 * 1024 }));
  });

  node.get("/v1/private/cuts/:height", async (req, res) => {
    res.json(await tenrai.privateTransfers.cutItems(whole(req.params.height) ?? -1, { maxResponseBytes: 256 * 1024 }));
  });

  node.get("/v1/finality/cuts/:height", async (req, res) => {
    res.json(await tenrai.privateTransfers.finalizedCutProof(whole(req.params.height) ?? -1, { maxResponseBytes: 2 * 1024 * 1024 }));
  });

  node.post("/v1/address/balances", async (req, res) => {
    res.json(await tenrai.address.balances(addresses(req)));
  });

  node.post("/v1/address/changes", async (req, res) => {
    res.json(await tenrai.address.changes(addresses(req), body(req).after_height as number));
  });

  node.post("/v1/address/utxos", async (req, res) => {
    res.json(await tenrai.address.utxoBatch(addresses(req)));
  });

  node.get("/v1/address/:address/utxos", async (req, res) => {
    res.json(await tenrai.address.utxos(req.params.address, page(req)));
  });

  // Coin recovery reads changes between the two cuts in ascending order.
  node.get("/v1/address/:address/history", async (req, res) => {
    if (req.query.after_height === undefined && req.query.at_height === undefined) {
      res.json(await tenrai.address.history(req.params.address, page(req)));
      return;
    }
    const after = whole(req.query.after_height) ?? -1;
    res.json(await tenrai.address.historyRange(req.params.address, after, whole(req.query.at_height) ?? -1, page(req)));
  });

  node.post("/v1/address/history-range", async (req, res) => {
    const request = body(req);
    res.json(
      await tenrai.address.historyRanges(request.addresses as HistoryRanges, request.at_height as number, {
        limit: request.limit as number | undefined,
        cursor: request.cursor as string | undefined,
      }),
    );
  });

  node.get("/v1/address/:address/unbonding", async (req, res) => {
    res.json(await tenrai.address.unbonding(req.params.address, page(req)));
  });

  node.get("/v1/cuts", async (req, res) => {
    const before = text(req.query.before);
    const { limit } = page(req);
    res.json(await tenrai.cuts.list({ before: before === undefined ? undefined : Number(before), limit }));
  });

  node.post("/v1/proofs/utxos", async (req, res) => {
    const request = body(req);
    res.json(await tenrai.proofs.utxos(request.anchor as FinalizedCut, request.outpoints as OutPoint[]));
  });

  node.post("/v1/proofs/utxo-presence", async (req, res) => {
    const request = body(req);
    res.json(await tenrai.proofs.utxoPresence(request.anchor as FinalizedCut, request.outpoints as OutPoint[]));
  });

  node.post("/v1/keys/registered", async (req, res) => {
    res.json(await tenrai.keys.registered(addresses(req)));
  });

  node.post("/v1/mempool/pending", async (req, res) => {
    res.json(await tenrai.mempool.pending(addresses(req)));
  });

  node.get("/v1/staking/validators", async (req, res) => {
    res.json(await tenrai.staking.validators(page(req)));
  });

  node.get("/v1/staking/uptime", async (_req, res) => {
    res.json(await tenrai.staking.uptime());
  });

  node.get("/v1/staking/validators/:id", async (req, res) => {
    res.json(await tenrai.staking.validator(req.params.id));
  });

  node.post("/v1/staking/positions", async (req, res) => {
    res.json(await tenrai.staking.positions(addresses(req), page(req)));
  });

  node.get("/v1/staking/positions/:id", async (req, res) => {
    res.json(await tenrai.staking.position(req.params.id));
  });

  node.get("/v1/economics/estimate/staking", async (req, res) => {
    res.json(await tenrai.economics.stakingEstimate(parseAtoms(text(req.query.amount) ?? "")));
  });

  node.post("/v1/transactions", async (req, res) => {
    res.json(await tenrai.transactions.submit(body(req).wire_hex as string));
  });

  node.get("/v1/transactions/:id/status", async (req, res) => {
    res.json(await tenrai.transactions.status(req.params.id));
  });

  node.get("/v1/transactions/:id", async (req, res) => {
    res.json(await tenrai.transactions.get(req.params.id));
  });

  node.post("/v1/transactions/status", async (req, res) => {
    res.json(await tenrai.transactions.statuses(body(req).transaction_ids as string[]));
  });

  node.use((_req, res) => {
    res.status(404).json({ api_version: 1, code: "not_found", message: "the wallet does not use this route", retry_after_millis: null });
  });

  return node;
}

type HistoryRanges = Parameters<TenraiClient["address"]["historyRanges"]>[0];

function body(req: Request): Record<string, unknown> {
  return typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {};
}

function addresses(req: Request): string[] {
  return body(req).addresses as string[];
}

function page(req: Request): { cursor?: string; limit?: number } {
  const limit = text(req.query.limit);
  return { cursor: text(req.query.cursor), limit: limit === undefined ? undefined : Number(limit) };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Parse decimal integers. The SDK rejects the invalid-value sentinel. */
function whole(value: unknown): number | undefined {
  const spelled = text(value);
  if (spelled === undefined) return undefined;
  return /^\d{1,15}$/.test(spelled) ? Number(spelled) : -1;
}
