import { isSafeText } from "@tenrai/sdk/wallet";

const ADDRESS = /^(?:trai|ttrai|dtrai)1[02-9ac-hj-np-z]{8,120}$/;
const TRANSACTION_ID = /^[0-9a-f]{96}$/;
const MAX_BLOCKED = 1_000;
const MAX_HIDDEN = 10_000;
const MAX_NAMES = 1_000;
export const MAX_NAME_CHARS = 64;

export interface StoredMessenger {
  enabled?: boolean;
  ask?: boolean;
  since?: number;
  blocked?: string[];
  hidden?: string[];
  deleted?: [string, number][];
  read?: [string, number][];
  names?: [string, string][];
}

function counts(value: unknown): Map<string, number> {
  const entries = Array.isArray(value) ? value : [];
  return new Map(
    entries.filter(
      (entry): entry is [string, number] =>
        Array.isArray(entry) && typeof entry[0] === "string" && TRANSACTION_ID.test(entry[0]) && Number.isSafeInteger(entry[1]) && entry[1] >= 0,
    ),
  );
}

function strings(value: unknown, pattern: RegExp, limit: number): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && pattern.test(item)))].slice(-limit) : [];
}

export function cleanName(name: string): string {
  const trimmed = name.trim();
  if ([...trimmed].length > MAX_NAME_CHARS || !isSafeText(trimmed)) {
    throw new Error(`a name has at most ${MAX_NAME_CHARS} characters and no hidden or direction characters`);
  }
  return trimmed;
}

export class MessengerStore {
  enabled = true;
  ask = false;
  /** Older messages count as read, so a restored wallet starts without unread ones. */
  since = Date.now();
  blocked: string[] = [];
  readonly hidden = new Set<string>();
  /** Per chat, how many of its messages were there when it was deleted here. */
  readonly deleted = new Map<string, number>();
  readonly read = new Map<string, number>();
  readonly names = new Map<string, string>();
  readonly #soon: () => void;
  readonly #now: () => void;

  constructor(soon: () => void, now: () => void) {
    this.#soon = soon;
    this.#now = now;
  }

  load(stored: StoredMessenger | undefined): void {
    this.enabled = stored?.enabled !== false;
    this.ask = stored?.ask === true;
    this.since = Number.isSafeInteger(stored?.since) ? (stored?.since as number) : Date.now();
    this.blocked = strings(stored?.blocked, ADDRESS, MAX_BLOCKED);
    this.hidden.clear();
    for (const id of strings(stored?.hidden, TRANSACTION_ID, MAX_HIDDEN)) {
      this.hidden.add(id);
    }
    for (const [target, source] of [
      [this.deleted, stored?.deleted],
      [this.read, stored?.read],
    ] as const) {
      target.clear();
      for (const [id, count] of counts(source)) {
        target.set(id, count);
      }
    }
    this.names.clear();
    for (const entry of Array.isArray(stored?.names) ? stored.names.slice(-MAX_NAMES) : []) {
      if (Array.isArray(entry) && typeof entry[0] === "string" && ADDRESS.test(entry[0]) && typeof entry[1] === "string") {
        try {
          const name = cleanName(entry[1]);
          if (name) {
            this.names.set(entry[0], name);
          }
        } catch {
          // A name that breaks the rules is dropped.
        }
      }
    }
  }

  stored(): StoredMessenger {
    return {
      enabled: this.enabled,
      ask: this.ask,
      since: this.since,
      blocked: this.blocked,
      hidden: [...this.hidden],
      deleted: [...this.deleted],
      read: [...this.read],
      names: [...this.names],
    };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.#now();
  }

  setAsk(ask: boolean): void {
    this.ask = ask;
    this.#now();
  }

  block(address: string): void {
    if (!this.blocked.includes(address)) {
      this.blocked = [...this.blocked, address].slice(-MAX_BLOCKED);
    }
    this.#now();
  }

  unblock(address: string): void {
    this.blocked = this.blocked.filter((item) => item !== address);
    this.#now();
  }

  // A later message brings the chat back with what came after it.
  deleteChat(request: string, messages: number): void {
    this.deleted.set(request, messages);
    this.read.set(request, Math.max(messages, this.read.get(request) ?? 0));
    this.#now();
  }

  hide(transactionId: string): void {
    this.hidden.add(transactionId);
    if (this.hidden.size > MAX_HIDDEN) {
      this.hidden.delete(this.hidden.values().next().value as string);
    }
    this.#now();
  }

  markRead(request: string, messages: number): boolean {
    if ((this.read.get(request) ?? 0) >= messages) {
      return false;
    }
    this.read.set(request, messages);
    this.#soon();
    return true;
  }

  setName(address: string, name: string): void {
    const clean = cleanName(name);
    if (clean) {
      this.names.set(address, clean);
      if (this.names.size > MAX_NAMES) {
        this.names.delete(this.names.keys().next().value as string);
      }
    } else {
      this.names.delete(address);
    }
    this.#now();
  }
}
