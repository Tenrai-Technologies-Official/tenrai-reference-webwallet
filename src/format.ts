import { formatTrai, type AtomAmount } from "@tenrai/sdk";

export function trai(atoms: AtomAmount | bigint, { signed = false } = {}): string {
  const value = typeof atoms === "bigint" ? atoms : BigInt(atoms);
  const magnitude = value < 0n ? -value : value;
  const [integer = "0", fraction] = formatTrai(magnitude, { fixed: true }).split(".");
  const sign = signed ? (value < 0n ? "− " : "+ ") : value < 0n ? "−" : "";
  return `${sign}${BigInt(integer).toLocaleString("en-US")}.${fraction} TRAI`;
}

/** Truncate balance summaries to two decimals. */
export function traiBrief(atoms: AtomAmount | bigint): string {
  const value = typeof atoms === "bigint" ? atoms : BigInt(atoms);
  const cents = (value < 0n ? -value : value) / 1_000_000n;
  return `${value < 0n ? "−" : ""}${(cents / 100n).toLocaleString("en-US")}.${(cents % 100n).toString().padStart(2, "0")} TRAI`;
}

export function count(value: number | bigint): string {
  return value.toLocaleString("en-US");
}

export function plural(value: number | bigint | string, word: string): string {
  const number = BigInt(value);
  return `${count(number)} ${word}${number === 1n ? "" : "s"}`;
}

export function shortId(id: string): string {
  return `${id.slice(0, 10)}…${id.slice(-6)}`;
}

export function shortAddress(address: string): string {
  return address.length > 24 ? `${address.slice(0, 14)}…${address.slice(-6)}` : address;
}

export function dateTime(millis: number): string {
  return new Date(millis).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function timeLeft(millis: number): string {
  const seconds = Math.max(0, Math.ceil(millis / 1000));
  const clock = [Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60].map((part) => String(part).padStart(2, "0")).join(":");
  const days = Math.floor(seconds / 86_400);
  return days > 0 ? `${days} d ${clock}` : clock;
}

export function duration(millis: number): string {
  const minutes = Math.round(millis / 60_000);
  if (minutes < 1) {
    return "under a minute";
  }
  if (minutes < 120) {
    return `${minutes} min`;
  }
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}
