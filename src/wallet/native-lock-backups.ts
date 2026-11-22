import type { Network } from "@tenrai/sdk";

export const MAX_NATIVE_LOCK_BACKUP_BYTES = 64 * 1024;
export const MAX_NATIVE_LOCK_BACKUP_DESCRIPTORS = 100;
const NETWORKS: readonly Network[] = ["mainnet", "testnet", "testnet100", "development"];
const DESCRIPTOR_HEX = /^(?:[0-9a-f]{2}){2,124}$/;
const encoder = new TextEncoder();

function checkedDescriptors(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_NATIVE_LOCK_BACKUP_DESCRIPTORS) throw new TypeError("a native lock backup must contain 1 to 100 descriptors");
  if (value.some((entry) => typeof entry !== "string" || !DESCRIPTOR_HEX.test(entry))) throw new TypeError("native lock descriptors must be bounded canonical lowercase hex");
  return [...new Set(value as string[])];
}

/** Public recovery container only. Every returned descriptor still requires protocol inspect validation. */
export function decodeNativeLockBackup(text: string, expectedNetwork: Network): string[] {
  if (!NETWORKS.includes(expectedNetwork)) throw new TypeError("invalid native lock backup network");
  if (typeof text !== "string" || text.length > MAX_NATIVE_LOCK_BACKUP_BYTES || encoder.encode(text).length > MAX_NATIVE_LOCK_BACKUP_BYTES) throw new TypeError("the native lock backup exceeds 64 KiB");
  const document: unknown = JSON.parse(text);
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new TypeError("invalid native lock backup object");
  const value = document as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["format", "version", "network", "descriptors"].includes(key))) throw new TypeError("unexpected field in a public native lock backup");
  const format = Object.hasOwn(value, "format");
  const version = Object.hasOwn(value, "version");
  if ((!format && !version) || (format && value["format"] !== 1) || (version && value["version"] !== 1)) throw new TypeError("unsupported or conflicting native lock backup version");
  if (value["network"] !== expectedNetwork) throw new TypeError("the native lock backup is for another network");
  return checkedDescriptors(value["descriptors"]);
}

/** Both wallets write format1. Secrets, signatures and wallet keys have no field in this container. */
export function encodeNativeLockBackup(network: Network, descriptorHexes: readonly string[]): string {
  if (!NETWORKS.includes(network)) throw new TypeError("invalid native lock backup network");
  const descriptors = checkedDescriptors(descriptorHexes);
  const text = JSON.stringify({ format: 1, network, descriptors }, null, 2);
  if (encoder.encode(text).length > MAX_NATIVE_LOCK_BACKUP_BYTES) throw new TypeError("the native lock backup exceeds 64 KiB");
  return text;
}
