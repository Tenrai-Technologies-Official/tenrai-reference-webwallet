import type { Network, UtxoSource } from "@tenrai/sdk";
import { type MessengerFrame, type OpenTransfer, recipientPayloads, type WalletActivity } from "@tenrai/sdk/wallet";
import { base64, bytes } from "../bytes.ts";
import type { Secret } from "../vault.ts";
import { MessengerStore, type StoredMessenger } from "./messengerStore.ts";

const PREFIX = "tenrai-wallet-history:";
const FRAMES_PREFIX = "tenrai-wallet-messenger:";
const FORMAT = 1;
/** Chat frames kept beside the history, within the site's storage. */
export const MAX_KEPT_FRAMES = 2_000;
const MAX_FRAME_CHARS = 1_000_000;
/** How many finalized transactions the browser keeps; the balance never depends on them. */
export const KEEP_CHOICES = [500, 1_000, 2_000, 5_000];
const MAX_PARTIES = 16;
const SAVE_DELAY_MILLIS = 500;
const TRANSACTION_ID = /^[0-9a-f]{96}$/;
const PAYLOAD_HEX = /^(?:[0-9a-f]{2})*$/;
const encoder = new TextEncoder();

/** A transfer this wallet sent: purpose, balance change including fee, and time. */
export interface Own {
  label: string;
  atoms: bigint;
  /** Only the fee left the wallet: the coins went to its own addresses, as in a compound. */
  internal: boolean;
  sentAt: number;
  /** The last cut that can still execute it. */
  validUntil?: bigint;
}

/** When moving coins asks for the password: every time, from an amount on, or never. */
export interface ConfirmSetting {
  mode: "always" | "above" | "never";
  above: bigint;
}

const ALWAYS: ConfirmSetting = { mode: "always", above: 0n };

/** Addresses a transaction's coins came from and went to, with its kind and validator. */
export interface Parties {
  from: string[];
  to: string[];
  kind: string | null;
  validator: string | null;
}

const KINDS = ["payment", "register", "bond", "exit", "unbond", "withdraw", "rotate", "reward_lock", "evidence", "heartbeat", "commission", "endpoint", "private_enter"];

function kindOf(value: unknown): string | null {
  return typeof value === "string" && KINDS.includes(value) ? value : null;
}

function validatorOf(value: unknown): string | null {
  return typeof value === "string" && TRANSACTION_ID.test(value) ? value : null;
}

/** Finalized activity with the time of its cut; null while unknown. */
export interface Remembered extends WalletActivity {
  time: number | null;
}

interface Stored {
  format: number;
  own: [string, { label: string; atoms: string; internal?: boolean; sentAt: number; validUntil?: string }][];
  activity: { transactionId: string | null; height: number; received: string; spent: string; sources: UtxoSource[]; time: number | null }[];
  payloads?: [string, string][];
  open?: (Omit<OpenTransfer, "validUntil"> & { validUntil: string })[];
  payloadOutputs?: [string, (string | null)[]][];
  parties?: [string, Parties][];
  confirm?: { mode: string; above: string };
  keep?: number;
  remind?: boolean;
  incoming?: boolean;
  messenger?: StoredMessenger;
  multisig?: boolean;
  nativeLocks?: boolean;
  privateTransfers?: boolean;
  proofSeconds?: Record<string, number>;
}

class HistoryRecoveryError extends Error {
  readonly exportRecovery: () => Promise<Uint8Array>;
  constructor(message: string, id: string, raw: string) {
    super(message);
    this.name = "HistoryRecoveryError";
    this.exportRecovery = async () => encoder.encode(JSON.stringify({ format: "tenrai_history_recovery", key: PREFIX + id, value: raw }));
  }
}

/** Own transfers and finalized activity, sealed with a key from the recovery phrase. */
export class History {
  readonly own = new Map<string, Own>();
  open: OpenTransfer[] = [];
  activity: Remembered[] = [];
  /** Payloads by transaction, as hex and empty for none; kept only inside the sealed record. */
  readonly payloads = new Map<string, string>();
  /** Output addresses by index, for transactions whose payload gives each recipient its own. */
  readonly payloadOutputs = new Map<string, (string | null)[]>();
  readonly parties = new Map<string, Parties>();
  confirm: ConfirmSetting = ALWAYS;
  keep = KEEP_CHOICES[0]!;
  /** Whether a wallet with many outputs is reminded to compound. */
  remind = true;
  /** Whether payloads of transactions this wallet did not send are read and shown. */
  incomingPayloads = true;
  readonly messenger = new MessengerStore(
    () => this.#save(),
    () => this.#saveNow(),
  );
  /** Whether the Multisig button shows; off until turned on for this wallet. */
  multisig = false;
  /** Whether the Timelocks & swaps button shows; off until turned on for this wallet. */
  nativeLocks = false;
  /** Whether this wallet reads and shows private notes; off until turned on for this wallet. */
  privateTransfers = false;
  /** The seconds the last proof of each kind took on this device, nothing else, for the next estimate. */
  proofSeconds: Record<string, number> = {};
  /** Finalized chat frames in their own sealed record, so a chat outlasts the history. */
  frames: MessengerFrame[] = [];
  readonly #key: CryptoKey;
  readonly #id: string;
  #framesKey = "";
  #framesTimer = 0;
  /** Heights whose cut time was asked for this session, found or not. */
  readonly #asked = new Set<number>();
  /** When to ask for a payload again: never if missing, later after a slow answer. */
  readonly #missed = new Map<string, number>();
  #timer = 0;
  #writing: Promise<void> = Promise.resolve();

  private constructor(key: CryptoKey, id: string) {
    this.#key = key;
    this.#id = id;
  }

  static async open(secret: Secret, network: Network, { requireEmptyPublic = false } = {}): Promise<History> {
    const material = await crypto.subtle.importKey("raw", encoder.encode(`${secret.mnemonic}\n${secret.passphrase}`), "HKDF", false, ["deriveBits"]);
    const bits = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: encoder.encode("tenrai-reference-wallet-history"), info: encoder.encode(network) },
        material,
        512,
      ),
    );
    try {
      const key = await crypto.subtle.importKey("raw", bits.slice(0, 32), "AES-GCM", false, ["encrypt", "decrypt"]);
      const id = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bits.slice(32))));
      const history = new History(key, id);
      await history.#load(requireEmptyPublic);
      if (requireEmptyPublic && history.open.length) throw new HistoryRecoveryError("Earlier public transfers remain in this browser history. Download the retained record for explicit recovery before spending; no replacement payment was created.", id, localStorage.getItem(PREFIX + id) ?? "");
      return history;
    } finally {
      bits.fill(0);
    }
  }

  /** Merges what the node lists now; returns the heights still without a time. */
  merge(fresh: WalletActivity[]): number[] {
    const known = new Map(this.activity.map((entry) => [identity(entry), entry]));
    for (const entry of fresh) {
      known.set(identity(entry), { ...entry, time: known.get(identity(entry))?.time ?? null });
    }
    this.activity = [...known.values()].sort((a, b) => b.height - a.height).slice(0, this.keep);
    this.#save();
    const untimed = this.activity.filter((entry) => entry.time === null && !this.#asked.has(entry.height));
    return [...new Set(untimed.map((entry) => entry.height))];
  }

  setTimes(times: Map<number, number | null>): void {
    for (const height of times.keys()) {
      this.#asked.add(height);
    }
    this.activity = this.activity.map((entry) => (entry.time === null ? { ...entry, time: times.get(entry.height) ?? null } : entry));
    this.#save();
  }

  /** Fewer drops the oldest at once. */
  setKeep(keep: number): void {
    if (!KEEP_CHOICES.includes(keep)) {
      throw new Error("choose one of the offered sizes");
    }
    this.keep = keep;
    this.activity = this.activity.slice(0, keep);
    this.#saveNow();
  }

  /** Finalized transactions whose details are not read yet, `first` before the newest. */
  unread(limit: number, first: readonly string[] = []): string[] {
    const reward = (entry: Remembered) => entry.spent === 0n && entry.sources.some((source) => source !== "regular");
    const listed = this.activity.flatMap((entry) => (entry.transactionId && !reward(entry) ? [entry.transactionId] : []));
    const known = new Set(listed);
    return [...new Set([...first.filter((id) => known.has(id)), ...listed])]
      .filter((id) => (!this.payloads.has(id) || !this.parties.has(id)) && (this.#missed.get(id) ?? 0) <= Date.now())
      .slice(0, limit);
  }

  setParties(transactionId: string, from: (string | null)[], to: (string | null)[], kind: string | null = null, validator: string | null = null): void {
    this.parties.set(transactionId, { from: distinct(from), to: distinct(to), kind: kindOf(kind), validator: validatorOf(validator) });
    this.#save();
  }

  setPayload(transactionId: string, payloadHex: string, outputs?: (string | null)[]): void {
    const clean = payloadHex.toLowerCase();
    this.payloads.set(transactionId, PAYLOAD_HEX.test(clean) ? clean : "");
    if (outputs && recipientPayloads(clean)) {
      this.payloadOutputs.set(transactionId, outputs);
    }
    this.#save();
  }

  missed(transactionId: string, retryAfterMillis = Infinity): void {
    this.#missed.set(transactionId, Date.now() + retryAfterMillis);
  }

  /** Whether this wallet spent coins in the transaction, also one it sent from another browser. */
  sentByThisWallet(transactionId: string): boolean {
    return this.own.has(transactionId) || this.activity.some((entry) => entry.transactionId === transactionId && entry.spent > 0n);
  }

  /** Keeps exported frames; over the size budget the oldest messages go first. */
  setFrames(frames: MessengerFrame[]): void {
    let over = frames.reduce((sum, frame) => sum + frame.payloadHex.length, 0) - MAX_FRAME_CHARS;
    const dropped = new Set<number>();
    for (const messagesOnly of [true, false]) {
      frames.forEach((frame, index) => {
        if (over > 0 && !dropped.has(index) && (!messagesOnly || frame.payloadHex.slice(10, 12) === "03")) {
          dropped.add(index);
          over -= frame.payloadHex.length;
        }
      });
    }
    const kept = frames.filter((_, index) => !dropped.has(index));
    const key = `${kept.length}:${kept[0]?.transactionId ?? ""}:${kept.at(-1)?.transactionId ?? ""}`;
    if (key === this.#framesKey) {
      return;
    }
    this.#framesKey = key;
    this.frames = kept;
    clearTimeout(this.#framesTimer);
    this.#framesTimer = window.setTimeout(() => {
      this.#writing = this.#writing.then(() => this.#writeFrames()).catch(() => undefined);
    }, SAVE_DELAY_MILLIS);
  }

  /** Off forgets incoming payloads; on lets them be read again. */
  setIncomingPayloads(show: boolean): void {
    if (!show) {
      this.setFrames(this.frames.filter((frame) => frame.sent));
    }
    this.incomingPayloads = show;
    for (const id of [...this.payloads.keys()]) {
      if (this.sentByThisWallet(id)) {
        continue;
      }
      if (show) {
        this.payloads.delete(id);
      } else {
        this.payloads.set(id, "");
      }
      this.payloadOutputs.delete(id);
    }
    this.#saveNow();
  }

  setRemind(remind: boolean): void {
    this.remind = remind;
    this.#saveNow();
  }

  setConfirm(setting: ConfirmSetting): void {
    this.confirm = setting;
    this.#saveNow();
  }

  setNativeLocks(shown: boolean): void {
    this.nativeLocks = shown;
    this.#saveNow();
  }

  setPrivateTransfers(enabled: boolean): void {
    this.privateTransfers = enabled;
    this.#saveNow();
  }

  setProofSeconds(slot: string, seconds: number): void {
    this.proofSeconds = { ...this.proofSeconds, [slot]: seconds };
    this.#saveNow();
  }

  setMultisig(shown: boolean): void {
    this.multisig = shown;
    this.#saveNow();
  }

  addOwn(transactionId: string, own: Own): void {
    this.own.set(transactionId, own);
    this.#saveNow();
  }

  /** The SDK account store owns executable public transfers. */
  setOpen(transfers: OpenTransfer[]): void {
    const ids = (list: OpenTransfer[]) => list.map((transfer) => transfer.transactionId).join();
    if (ids(transfers) !== ids(this.open)) {
      this.open = transfers;
      this.#saveNow();
    }
  }

  dropOwn(transactionId: string): void {
    this.own.delete(transactionId);
    this.#saveNow();
  }

  async #load(requireEmptyPublic = false): Promise<void> {
    const raw = localStorage.getItem(PREFIX + this.#id);
    if (raw === null) {
      return;
    }
    try {
      const { iv, data } = JSON.parse(raw) as { iv: string; data: string };
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(iv), additionalData: encoder.encode(this.#id) }, this.#key, bytes(data));
      const stored = JSON.parse(new TextDecoder().decode(plain)) as Stored;
      if (stored.format !== FORMAT || requireEmptyPublic && !Array.isArray(stored.open)) {
        if (requireEmptyPublic) throw new Error("The earlier public journal is not identifiable.");
        return;
      }
      for (const [id, own] of stored.own) {
        const validUntil = typeof own.validUntil === "string" && /^\d{1,20}$/.test(own.validUntil) ? BigInt(own.validUntil) : undefined;
        this.own.set(id, { label: own.label, atoms: BigInt(own.atoms), internal: own.internal === true, sentAt: own.sentAt, validUntil });
      }
      this.activity = stored.activity.map((entry) => ({ ...entry, received: BigInt(entry.received), spent: BigInt(entry.spent) }));
      this.confirm = confirmFrom(stored.confirm);
      this.remind = stored.remind !== false;
      this.incomingPayloads = stored.incoming !== false;
      this.messenger.load(stored.messenger);
      this.multisig = stored.multisig === true;
      this.nativeLocks = stored.nativeLocks === true;
      this.privateTransfers = stored.privateTransfers === true;
      for (const [slot, seconds] of Object.entries(stored.proofSeconds ?? {})) {
        if (/^(large|exit):\d{1,2}$/.test(slot) && Number.isInteger(seconds) && seconds > 0 && seconds <= 3600) {
          this.proofSeconds[slot] = seconds;
        }
      }
      if (typeof stored.keep === "number" && KEEP_CHOICES.includes(stored.keep)) {
        this.keep = stored.keep;
      }
      if (requireEmptyPublic && stored.open && stored.open.length > 0) throw new HistoryRecoveryError("Earlier public transfers remain in this browser history. Download the retained record for explicit recovery before spending; it was not imported or replaced.", this.#id, raw);
      this.open = (stored.open ?? []).flatMap((transfer) => {
        const known =
          TRANSACTION_ID.test(transfer.transactionId) &&
          typeof transfer.wireHex === "string" &&
          /^[0-9a-f]+$/.test(transfer.wireHex) &&
          /^\d{1,20}$/.test(transfer.validUntil) &&
          Number.isSafeInteger(transfer.sentAt) &&
          Array.isArray(transfer.spends);
        return known ? [{ ...transfer, validUntil: BigInt(transfer.validUntil) }] : [];
      });
      for (const [id, parties] of stored.parties ?? []) {
        // Re-read legacy rows without a transaction kind.
        if (TRANSACTION_ID.test(id) && addressList(parties?.from) && addressList(parties?.to) && "kind" in parties) {
          this.parties.set(id, { from: distinct(parties.from), to: distinct(parties.to), kind: kindOf(parties.kind), validator: validatorOf(parties.validator) });
        }
      }
      for (const [id, payload] of stored.payloads ?? []) {
        if (TRANSACTION_ID.test(id) && typeof payload === "string" && PAYLOAD_HEX.test(payload)) {
          this.payloads.set(id, payload);
        }
      }
      for (const [id, outputs] of stored.payloadOutputs ?? []) {
        const valid = Array.isArray(outputs) && outputs.length <= 256 && outputs.every((item) => item === null || (typeof item === "string" && item.length <= 256));
        if (TRANSACTION_ID.test(id) && valid) {
          this.payloadOutputs.set(id, outputs);
        }
      }
    } catch (cause) {
      if (requireEmptyPublic) {
        if (cause instanceof HistoryRecoveryError) throw cause;
        throw new HistoryRecoveryError("The earlier browser history cannot establish that no public payment remains executable. Download its original record for recovery before spending; its bytes were preserved.", this.#id, raw);
      }
    }
    await this.#loadFrames();
  }

  async #loadFrames(): Promise<void> {
    const raw = localStorage.getItem(FRAMES_PREFIX + this.#id);
    if (!raw) {
      return;
    }
    try {
      const { iv, data } = JSON.parse(raw) as { iv: string; data: string };
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(iv), additionalData: encoder.encode(`${this.#id}:messenger`) }, this.#key, bytes(data));
      const stored = JSON.parse(new TextDecoder().decode(plain)) as { frames?: unknown };
      this.frames = Array.isArray(stored.frames) ? (stored.frames.filter((frame) => frame && typeof frame === "object") as MessengerFrame[]) : [];
    } catch {
      this.frames = [];
    }
  }

  async #writeFrames(): Promise<void> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(`${this.#id}:messenger`) },
      this.#key,
      encoder.encode(JSON.stringify({ frames: this.frames })),
    );
    localStorage.setItem(FRAMES_PREFIX + this.#id, JSON.stringify({ iv: base64(iv), data: base64(new Uint8Array(data)) }));
  }

  #save(): void {
    clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => this.#saveNow(), SAVE_DELAY_MILLIS);
  }

  // Serialize writes so a reload can recover the latest activity.
  #saveNow(): void {
    clearTimeout(this.#timer);
    this.#writing = this.#writing.then(() => this.#write()).catch(() => undefined);
  }

  async #write(): Promise<void> {
    const kept = new Set([...this.own.keys(), ...this.activity.flatMap((entry) => (entry.transactionId ? [entry.transactionId] : []))]);
    const stored: Stored = {
      format: FORMAT,
      own: [...this.own].map(([id, own]) => [
        id,
        { label: own.label, atoms: own.atoms.toString(), internal: own.internal, sentAt: own.sentAt, validUntil: own.validUntil?.toString() },
      ]),
      activity: this.activity.map((entry) => ({ ...entry, received: entry.received.toString(), spent: entry.spent.toString() })),
      payloads: [...this.payloads].filter(([id]) => kept.has(id)),
      payloadOutputs: [...this.payloadOutputs].filter(([id]) => kept.has(id)),
      parties: [...this.parties].filter(([id]) => kept.has(id)),
      confirm: { mode: this.confirm.mode, above: this.confirm.above.toString() },
      keep: this.keep,
      remind: this.remind,
      incoming: this.incomingPayloads,
      messenger: this.messenger.stored(),
      multisig: this.multisig,
      nativeLocks: this.nativeLocks,
      privateTransfers: this.privateTransfers,
      proofSeconds: this.proofSeconds,
      open: this.open.map((transfer) => ({ ...transfer, validUntil: transfer.validUntil.toString() })),
    };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(this.#id) },
      this.#key,
      encoder.encode(JSON.stringify(stored)),
    );
    localStorage.setItem(PREFIX + this.#id, JSON.stringify({ iv: base64(iv), data: base64(new Uint8Array(data)) }));
  }
}

export function forgetHistory(): void {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(PREFIX) || key.startsWith(FRAMES_PREFIX)) {
      localStorage.removeItem(key);
    }
  }
}

function addressList(value: unknown): value is (string | null)[] {
  return Array.isArray(value) && value.length <= 256 && value.every((item) => item === null || (typeof item === "string" && item.length <= 256));
}

function distinct(addresses: (string | null)[]): string[] {
  return [...new Set(addresses.filter((item): item is string => typeof item === "string"))].slice(0, MAX_PARTIES);
}

// Require the password if the saved policy is unreadable.
function confirmFrom(value: Stored["confirm"]): ConfirmSetting {
  const above = typeof value?.above === "string" && /^\d{1,39}$/.test(value.above) ? BigInt(value.above) : 0n;
  if (value?.mode === "never") {
    return { mode: "never", above: 0n };
  }
  return value?.mode === "above" && above > 0n ? { mode: "above", above } : ALWAYS;
}

function identity(entry: WalletActivity): string {
  return entry.transactionId ?? `${entry.height}:${entry.received}:${entry.spent}`;
}

function hex(data: Uint8Array): string {
  return [...data].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
