const KEY = "tenrai-wallet-auto-compound";
const LOCK_KEY = "tenrai-wallet-lock-minutes";
export const MIN_AUTO_COMPOUND = 2;
export const MAX_AUTO_COMPOUND = 10_000;
export const LOCK_MINUTES = [15, 30, 60, 180, 360, 720];

/** Compounds an address above `above` outputs or once the rest reaches `atLeast` atoms. */
export type AutoCompound = { above: number } | { atLeast: bigint };

function validAbove(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= MIN_AUTO_COMPOUND && value <= MAX_AUTO_COMPOUND;
}

/** The saved setting for automatic compounding, or null while it is off. */
export function savedAutoCompound(): AutoCompound | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown;
    if (validAbove(value)) {
      return { above: value };
    }
    const saved = value as { above?: unknown; atLeast?: unknown } | null;
    if (validAbove(saved?.above)) {
      return { above: saved.above };
    }
    if (typeof saved?.atLeast === "string" && /^[1-9]\d{0,38}$/.test(saved.atLeast)) {
      return { atLeast: BigInt(saved.atLeast) };
    }
  } catch {
    // An unreadable setting leaves automatic compounding off.
  }
  return null;
}

export function saveAutoCompound(setting: AutoCompound | null): void {
  try {
    if (setting === null) {
      localStorage.removeItem(KEY);
    } else {
      localStorage.setItem(KEY, JSON.stringify("above" in setting ? { above: setting.above } : { atLeast: setting.atLeast.toString() }));
    }
  } catch {
    // Without storage the setting lasts until the page closes.
  }
}

export function savedLockMinutes(): number {
  try {
    const minutes = Number(localStorage.getItem(LOCK_KEY));
    return LOCK_MINUTES.includes(minutes) ? minutes : LOCK_MINUTES[0]!;
  } catch {
    return LOCK_MINUTES[0]!;
  }
}

export function saveLockMinutes(minutes: number): void {
  try {
    localStorage.setItem(LOCK_KEY, String(minutes));
  } catch {
    // Without storage the setting lasts until the page closes.
  }
}

export function lockLabel(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} minutes`;
  }
  const hours = minutes / 60;
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}
