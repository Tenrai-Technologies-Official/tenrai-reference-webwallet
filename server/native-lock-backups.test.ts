import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Network, TransactionManifest } from "@tenrai/sdk";
import { NativeLockSession } from "@tenrai/sdk/wallet";
import { decodeNativeLockBackup, encodeNativeLockBackup } from "../src/wallet/native-lock-backups.ts";

interface Fixture {
  network: Network;
  descriptors: string[];
  manifest: TransactionManifest;
  canonical: Record<string, unknown>;
  legacy: Record<string, unknown>;
  vanilla_export: Record<string, unknown>;
  reference_export: Record<string, unknown>;
}
const fixture = JSON.parse(readFileSync(new URL("./fixtures/native-lock-backups-v1.json", import.meta.url), "utf8")) as Fixture;

test("both wallets' public descriptor exports and the legacy vanilla backup restore without losing hex", async () => {
  const session = await NativeLockSession.fromManifest(fixture.manifest);
  for (const exported of [fixture.canonical, fixture.legacy, fixture.vanilla_export, fixture.reference_export]) {
    const hexes = decodeNativeLockBackup(JSON.stringify(exported), fixture.network);
    assert.deepEqual(hexes, fixture.descriptors);
    const checked = hexes.map((hex) => session.inspect(hex));
    assert.deepEqual(checked.map((entry) => entry.descriptor_hex), fixture.descriptors);
  }
  const encoded = JSON.parse(encodeNativeLockBackup(fixture.network, fixture.descriptors)) as Record<string, unknown>;
  assert.deepEqual(encoded, fixture.reference_export);
  assert.deepEqual(Object.keys(encoded), ["format", "network", "descriptors"]);
});

test("backup version transitions and deduplication preserve the canonical public container", () => {
  const compatible = { ...fixture.canonical, version: 1, descriptors: [...fixture.descriptors, ...fixture.descriptors] };
  assert.deepEqual(decodeNativeLockBackup(JSON.stringify(compatible), fixture.network), fixture.descriptors);
  assert.deepEqual(JSON.parse(encodeNativeLockBackup(fixture.network, [...fixture.descriptors, ...fixture.descriptors])), fixture.canonical);
  for (const changed of [{ format: 2 }, { version: 2 }, { format: 1, version: 2 }, { format: 2, version: 1 }]) {
    assert.throws(() => decodeNativeLockBackup(JSON.stringify({ ...fixture.canonical, ...changed }), fixture.network), /version/);
  }
});

test("foreign, oversized, malformed or secret-bearing backups are rejected", () => {
  const decode = (value: unknown) => decodeNativeLockBackup(JSON.stringify(value), fixture.network);
  assert.throws(() => decode({ ...fixture.canonical, network: fixture.network === "mainnet" ? "testnet" : "mainnet" }), /network/);
  assert.throws(() => decode({ ...fixture.canonical, descriptors: [] }), /1 to 100/);
  assert.throws(() => decode({ ...fixture.canonical, descriptors: Array(101).fill(fixture.descriptors[0]) }), /1 to 100/);
  assert.throws(() => decode({ ...fixture.canonical, secret: "private" }), /unexpected field/);
  assert.throws(() => decode({ ...fixture.canonical, padding: "é".repeat(35000) }), /64 KiB/);
  for (const malformed of ["010", "0g", "01".repeat(125), fixture.descriptors[0]!.toUpperCase(), 1, null]) {
    assert.throws(() => decode({ ...fixture.canonical, descriptors: [malformed] }), /hex/);
  }
  assert.throws(() => decode({ network: fixture.network, descriptors: fixture.descriptors }), /version/);
});

test("protocol inspection rejects an unsupported descriptor after the container has decoded", async () => {
  const session = await NativeLockSession.fromManifest(fixture.manifest);
  const decoded = decodeNativeLockBackup(JSON.stringify({ ...fixture.canonical, descriptors: [fixture.descriptors[0], "0201"] }), fixture.network);
  assert.throws(() => decoded.map((hex) => session.inspect(hex)));
});
