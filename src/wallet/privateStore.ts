import type { PrivateNotesOptions, PrivateNotesStore, PublicTransfersStore, WalletOptions } from "@tenrai/sdk/wallet";
import { base64, bytes } from "../bytes.ts";

const DATABASE = "tenrai-reference-private";
const TABLE = "records";
const MARK_KEY = "tenrai-reference-private-mark";
type StoreOwner = Parameters<NonNullable<WalletOptions["privateStore"]>>[0];
// Pinned public roots: primitives/params/network.rs and config/development.traidag.json.
export const MAINNET_CHAIN_ID = "8395f150390e8b3ac210696c2e095b09a219da031ed563f1a22664dbc31bfe571115fb8ef69d5bbc8250e6cb339489d1";
export const DEVELOPMENT_CHAIN_ID = "dededededededededededededededededededededededededededededededededededededededededededededededede";

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(TABLE)) request.result.createObjectStore(TABLE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("this browser keeps no data"));
  });
}

function stored<T>(mode: IDBTransactionMode, act: (table: IDBObjectStore) => IDBRequest<T>, durable = false): Promise<T> {
  return database().then(
    (opened) =>
      new Promise<T>((resolve, reject) => {
        let transaction: IDBTransaction;
        try {
          transaction = opened.transaction(TABLE, mode, mode === "readwrite" ? { durability: "strict" } : undefined);
        } catch (error) {
          opened.close();
          reject(durable ? new Error("This browser cannot commit a payment with strict storage durability.", { cause: error }) : error);
          return;
        }
        if (durable && transaction.durability !== "strict") {
          transaction.abort();
          opened.close();
          reject(new Error("This browser cannot commit a payment with strict storage durability."));
          return;
        }
        let request: IDBRequest<T>;
        try { request = act(transaction.objectStore(TABLE)); }
        catch (error) {
          try { transaction.abort(); } catch { /* Already inactive. */ }
          opened.close();
          reject(error);
          return;
        }
        transaction.oncomplete = () => {
          opened.close();
          resolve(request.result);
        };
        transaction.onerror = () => {
          opened.close();
          reject(transaction.error ?? new Error("this browser keeps no data"));
        };
        transaction.onabort = transaction.onerror;
      }),
  );
}

/**
 * Store sealed state and pending transactions with a separate rollback marker.
 * Submission requires a durable pending record. Missing scan state triggers a rescan.
 */
export function browserStore(owner: StoreOwner, chainId: string): PrivateNotesStore {
  if (!/^[0-9a-f]{96}$/.test(chainId) || !/^[a-z0-9]{1,128}$/.test(owner.address) || !/^TRAI-[0-9A-F]{4}-[0-9A-F]{4}$/.test(owner.fingerprint) || !Number.isSafeInteger(owner.account) || owner.account < 0) throw new Error("Invalid private store identity.");
  const suffix = `${chainId}:${owner.network}:${owner.account}:${owner.address}`;
  const key = (name: string) => `${name}:${suffix}`;
  return {
    id:DATABASE+":"+TABLE+":"+suffix,
    acquireSendsLease:()=>acquireLeases([DATABASE+":"+TABLE+":"+key("sends")]),
    async read(name){
      if(name==="mark"){
        const independent=localStorage.getItem(MARK_KEY+":"+suffix);
        if(independent!==null)return bytes(independent);
      }
      const value=await stored("readonly",(table)=>table.get(key(name)) as IDBRequest<Uint8Array|undefined>);
      if(value!==undefined && !(value instanceof Uint8Array))throw new TypeError("The saved private account data is damaged.");
      return value??null;
    },
    async write(name,value){
      await stored("readwrite",(table)=>table.put(value,key(name)),true);
      if(name==="mark")localStorage.setItem(MARK_KEY+":"+suffix,base64(value));
    },
  };
}

/** Public transfers share the private account lease and require the full account key. */
export function publicTransferStore(owner: StoreOwner, chainId: string, checkAbsent?: () => Promise<void>): PublicTransfersStore {
  const key = `public-transfers:${chainId}:${owner.network}:${owner.account}:${owner.address}`;
  const marker = `tenrai-reference-public-present:${chainId}:${owner.network}:${owner.account}:${owner.address}`;
  const markPresent = async () => { localStorage.setItem(marker, "present"); };
  const exportRecovery = async () => {
    const value = await stored("readonly", (table) => table.get(key) as IDBRequest<unknown>);
    return new TextEncoder().encode(JSON.stringify({ format: "tenrai_public_journal_recovery", key, chain_id: chainId,
      marker: localStorage.getItem(marker), value: value instanceof Uint8Array ? { type: "uint8_array", base64: base64(value) } : value ?? null }));
  };
  return { chainId, ...(checkAbsent ? { checkAbsent } : {}), exportRecovery, markPresent,
    async read() {
      const value = await stored("readonly", (table) => table.get(key) as IDBRequest<unknown>);
      if (value === undefined) {
        if (localStorage.getItem(marker) !== null) {
          const error = new Error("The previously initialized public payment journal is missing. Restore an intact account record before spending.");
          Object.defineProperty(error, "exportRecovery", { value: exportRecovery }); throw error;
        }
        return null;
      }
      if (!(value instanceof Uint8Array) || value.byteLength < 40 || value.byteLength > 32 * 1024 * 1024 + 40) {
        const error = new Error("The retained public payment journal is damaged; spending is stopped and its original record was preserved.");
        Object.defineProperty(error, "exportRecovery", { value: exportRecovery }); throw error;
      }
      return value;
    },
    async write(value) {
      if (!(value instanceof Uint8Array) || value.byteLength < 40 || value.byteLength > 32 * 1024 * 1024 + 40) throw new Error("Invalid sealed public payment journal.");
      await stored("readwrite", (table) => table.put(value, key), true);
      await markPresent();
    },
  };
}

async function acquireLease(namespace: string): Promise<{ release(): Promise<void> }> {
  if (!navigator.locks?.request) throw new Error("This browser cannot exclusively own the private wallet store.");
  let resolve!: (lease: { release(): Promise<void> }) => void;
  let reject!: (error: unknown) => void;
  const acquired = new Promise<{ release(): Promise<void> }>((yes, no) => { resolve = yes; reject = no; });
  let unlock!: () => void;
  const held = new Promise<void>((done) => { unlock = done; });
  const request: Promise<void> = navigator.locks.request(namespace, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) { reject(new Error("This wallet is already open in another tab.")); return; }
    resolve({ release: async () => { unlock(); await request; } });
    await held;
  });
  void request.catch(reject);
  return acquired;
}

async function acquireLeases(namespaces: string[]): Promise<{ release(): Promise<void> }> {
  const leases: { release(): Promise<void> }[] = [];
  try {
    for (const namespace of [...new Set(namespaces)].sort()) leases.push(await acquireLease(namespace));
  } catch (error) {
    await Promise.all(leases.reverse().map((lease) => lease.release()));
    throw error;
  }
  let closing: Promise<void> | undefined;
  return { release: () => closing ??= Promise.all(leases.reverse().map((lease) => lease.release())).then(() => {}) };
}

async function testGenesis(): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch("/api/genesis", { signal: controller.signal });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error("The configured test genesis could not be loaded.");
    if (!response.body) throw new Error("the genesis manifest has no body");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (chunks.length >= 4096) throw new Error("The genesis manifest has too many stream chunks.");
        if (length > 2 * 1024 * 1024) throw new Error("the genesis manifest is too large");
        chunks.push(next.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } finally { clearTimeout(timer); }
}

/** Used at unlock, before transparent coin selection, and when opening the private tab. */
export async function privateWalletStore(owner: StoreOwner, checkAbsent?: () => Promise<void>): Promise<PrivateNotesOptions> {
  const manifest = owner.network === "mainnet" ? undefined : await testGenesis();
  let chainId: string;
  if (manifest !== undefined) {
    const configured = JSON.parse(manifest) as { network?: unknown; chain_id?: unknown };
    if (configured.network !== owner.network || typeof configured.chain_id !== "string" || !/^[0-9a-f]{96}$/.test(configured.chain_id)) throw new Error("The test genesis does not identify this wallet's network.");
    chainId = configured.chain_id;
  } else if (owner.network === "mainnet") chainId = MAINNET_CHAIN_ID;
  else if (owner.network === "development") chainId = DEVELOPMENT_CHAIN_ID;
  else throw new Error("Configure the test genesis before restoring this network's private wallet store.");
  return { store: browserStore(owner, chainId), publicTransfers: publicTransferStore(owner, chainId, checkAbsent), ...(manifest === undefined ? {} : { genesisManifest: manifest }) };
}
