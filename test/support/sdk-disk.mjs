import { after } from "node:test";
import { DatabaseSync } from "./sqlite.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sqliteFinalityGuardStore, sqliteOutcomeStore, sqlitePersistentPublicCoinStore, sqlitePrivateInventoryStore,
  sqlitePrivateLocalScanStore } from "@tenrai/sdk/wallet";

// Use SDK disk providers for SDK-owned state. The tests still exercise the browser account journal.
const owned = [];

async function disk(label, open, close) {
  const directory = await mkdtemp(join(tmpdir(), "tenrai-reference-" + label + "-"));
  const database = new DatabaseSync(join(directory, "fixture.sqlite"));
  let provider;
  try { provider = await open(database); }
  catch (error) {
    try { database.close(); } catch { /* Already closed by the provider. */ }
    await rm(directory, { recursive: true });
    throw error;
  }
  owned.push({ directory, close: () => close(provider, database) });
  return provider;
}

const closeDatabase = (_provider, database) => database.close();

export async function privateRecords(namespace = "reference-provider") {
  return {
    outcomes: await disk("outcomes", (database) => sqliteOutcomeStore(database, namespace), closeDatabase),
    inventoryPages: await disk("inventory", (database) => sqlitePrivateInventoryStore(database, namespace), closeDatabase),
    localPages: await disk("scratch", (database) => sqlitePrivateLocalScanStore(database, namespace), closeDatabase),
  };
}

export async function publicRecords() {
  return {
    publicCoinStore: (scope) => disk("coins", (database) => sqlitePersistentPublicCoinStore(database, scope, { maxCoins: 10_000 }),
      (provider) => provider.close()),
    finalityStore: await disk("finality", (database) => sqliteFinalityGuardStore(database), (provider) => provider.close()),
  };
}

after(async () => {
  const failures = [];
  for (const entry of owned.splice(0).reverse()) {
    try { await entry.close(); } catch (error) { failures.push(error); }
    try { await rm(entry.directory, { recursive: true }); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, "Fixture database cleanup failed.");
});
