import type { Network } from "@tenrai/sdk";
import { base64, bytes } from "./bytes.ts";
import { forgetHistory } from "./wallet/history.ts";
import { forgetAddresses } from "./wallet/scan.ts";

const KEY = "tenrai-reference-wallet";
// PBKDF2-SHA256 iteration count for new vaults.
const ROUNDS = 600_000;
const encoder = new TextEncoder();

export interface Secret {
  mnemonic: string;
  passphrase: string;
}

interface Saved {
  network: Network;
  salt: string;
  iv: string;
  sealed: string;
}

export function savedNetwork(): Network | null {
  return read()?.network ?? null;
}

/** Encrypts the recovery phrase with the password and keeps it in this browser only. */
export async function save(secret: Secret, password: string, network: Network, { assertOpen }: { assertOpen?: () => void } = {}): Promise<void> {
  assertOpen?.();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  assertOpen?.();
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(network) },
    key,
    encoder.encode(JSON.stringify(secret)),
  );
  const saved: Saved = { network, salt: base64(salt), iv: base64(iv), sealed: base64(new Uint8Array(sealed)) };
  assertOpen?.();
  localStorage.setItem(KEY, JSON.stringify(saved));
}

/** The saved phrase and its network; throws on a wrong password. */
export async function open(password: string): Promise<{ secret: Secret; network: Network }> {
  const saved = read();
  if (!saved) {
    throw new Error("no wallet is saved on this device");
  }
  const key = await deriveKey(password, bytes(saved.salt));
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes(saved.iv), additionalData: encoder.encode(saved.network) },
      key,
      bytes(saved.sealed),
    );
  } catch {
    throw new Error("the password is not right");
  }
  return { secret: JSON.parse(new TextDecoder().decode(plain)) as Secret, network: saved.network };
}

export async function checkPassword(password: string): Promise<void> {
  await open(password);
}

export function forget(): void {
  localStorage.removeItem(KEY);
  forgetHistory();
  forgetAddresses();
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ROUNDS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function read(): Saved | null {
  try {
    const text = localStorage.getItem(KEY);
    return text ? (JSON.parse(text) as Saved) : null;
  } catch {
    return null;
  }
}
