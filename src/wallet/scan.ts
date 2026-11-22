import type { Wallet } from "@tenrai/sdk/wallet";

const KEY = "tenrai-wallet-used-addresses";
export const DEFAULT_SCAN_DEPTH = 1_000;
export const MAX_SCAN_DEPTH = 10_000;
const RECENT_ADDRESSES = 20;

type Saved = { fingerprint?: string; used?: { receive: number; change: number }; issued?: number; receive?: number };

function saved(wallet: Wallet): Saved | undefined {
  try {
    const record = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
    return record?.fingerprint === wallet.fingerprint ? record : undefined;
  } catch {
    // Rescan when the stored index is unreadable.
    return undefined;
  }
}

/** Use the saved high-water mark to shorten the scan. */
export function restoreAddresses(wallet: Wallet): void {
  const record = saved(wallet);
  try {
    if (record?.used) {
      wallet.rememberUsed(record.used);
    }
    if (record?.issued !== undefined) {
      wallet.rememberIssued(record.issued);
    }
  } catch {
    // Ignore invalid saved indices.
  }
}

export function saveAddresses(wallet: Wallet): void {
  const used = wallet.usedAddresses;
  if (!used) {
    return;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...saved(wallet), fingerprint: wallet.fingerprint, used, issued: wallet.lastIssued }));
  } catch {
    // The next session can scan again.
  }
}

export function savedReceive(wallet: Wallet): number {
  const index = saved(wallet)?.receive;
  return typeof index === "number" && Number.isSafeInteger(index) && index >= 0 && index <= wallet.lastIssued ? index : wallet.lastIssued;
}

export function saveReceive(wallet: Wallet, index: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...saved(wallet), fingerprint: wallet.fingerprint, receive: index }));
  } catch {
    // The selection stays in memory for this session.
  }
}

export function forgetAddresses(): void {
  localStorage.removeItem(KEY);
}

/** Indices of the newest handed-out receiving addresses, newest first, then the main address. */
export function handedOut(issued: number): number[] {
  return [...Array.from({ length: Math.min(issued, RECENT_ADDRESSES) }, (_, offset) => issued - offset), 0];
}

export function addressName(index: number, branch: "receive" | "change" = "receive"): string {
  if (branch === "change") {
    return `Change ${index}`;
  }
  return index === 0 ? "Main address" : `Address ${index}`;
}
