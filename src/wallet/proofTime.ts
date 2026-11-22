import type { ProofEstimate } from "@tenrai/sdk/wallet";

/** Seconds as a person says them: exactly below 20, then by fives, from a minute on in half minutes. */
export function spokenTime(seconds: number): string {
  const rounded = seconds < 20 ? Math.max(1, Math.round(seconds)) : 5 * Math.round(seconds / 5);
  return rounded < 60 ? `${rounded} s` : `${Math.max(1, Math.round(seconds / 30) / 2)} min`;
}

/** "30 s to 1 min" before any proof here, "35 s, as last time" after one. */
export function estimateText(estimate: ProofEstimate): string {
  return estimate.measured
    ? `${spokenTime(estimate.expected)}, as last time`
    : `${spokenTime(estimate.from)} to ${spokenTime(estimate.to)}`;
}
