import { parseTrai, type FeeEstimate, type FeePriority, type Network } from "@tenrai/sdk";
import { isValidAddress, type FeeOptions } from "@tenrai/sdk/wallet";
import { useEffect, useId, useState, type ReactNode } from "react";
import { plural } from "../format.ts";
import { tenrai } from "../tenrai.ts";

const PRIORITIES: [FeePriority, string][] = [
  ["minimum", "Minimum"],
  ["normal", "Normal"],
  ["priority", "Priority"],
];

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__k">{label}</span>
      {children}
      {hint}
    </label>
  );
}

export type FeeChoice = { mode: "auto"; priority: FeePriority } | { mode: "manual"; perMass: string };

export const AUTO_FEE: FeeChoice = { mode: "auto", priority: "normal" };

/** Fixed rates are in atoms per unit of mass. */
export function feeOptions(choice: FeeChoice): FeeOptions {
  if (choice.mode === "auto") {
    return { priority: choice.priority };
  }
  const rate = choice.perMass.trim();
  if (!/^[1-9][0-9]{0,18}$/.test(rate)) {
    throw new Error("the manual fee must be a whole number of atoms per unit of mass");
  }
  return { feePerMass: BigInt(rate) };
}

export function FeeField({ value, onChange }: { value: FeeChoice; onChange: (value: FeeChoice) => void }) {
  const name = useId();
  const [estimate, setEstimate] = useState<FeeEstimate>();

  useEffect(() => {
    tenrai.fees.estimate().then(setEstimate, () => setEstimate(undefined));
  }, []);

  const rate = (priority: FeePriority) => estimate?.suggestions.find((entry) => entry.priority === priority)?.fee_per_mass;

  return (
    <div className="fee">
      <fieldset className="choice">
        <legend className="field__k">Fee</legend>
        <label>
          <input type="radio" name={name} checked={value.mode === "auto"} onChange={() => onChange(AUTO_FEE)} /> Automatic
        </label>
        <label>
          <input
            type="radio"
            name={name}
            checked={value.mode === "manual"}
            onChange={() => onChange({ mode: "manual", perMass: rate("normal") ?? estimate?.minimum_fee_per_mass ?? "1" })}
          />{" "}
          Manual
        </label>
      </fieldset>
      {value.mode === "auto" ? (
        <Field label="Priority">
          <select value={value.priority} onChange={(event) => onChange({ mode: "auto", priority: event.target.value as FeePriority })}>
            {PRIORITIES.map(([priority, label]) => {
              const perMass = rate(priority);
              return (
                <option key={priority} value={priority}>
                  {perMass === undefined ? label : `${label}, ${plural(perMass, "atom")} per mass`}
                </option>
              );
            })}
          </select>
        </Field>
      ) : (
        <Field label="Atoms per unit of mass">
          <input
            value={value.perMass}
            inputMode="numeric"
            autoComplete="off"
            maxLength={19}
            onChange={(event) => onChange({ mode: "manual", perMass: event.target.value })}
          />
        </Field>
      )}
    </div>
  );
}

export function feeText(choice: FeeChoice): string {
  return choice.mode === "auto" ? `Automatic, ${choice.priority}` : `${plural(choice.perMass.trim(), "atom")} per unit of mass`;
}

export function AddressCheck({ state, network, burn = false }: { state: "empty" | "valid" | "invalid"; network: Network; burn?: boolean }) {
  if (state === "empty") {
    return null;
  }
  return (
    <span className="live-check" data-tone={state === "valid" && !burn ? "ok" : "bad"} role="status">
      {state === "invalid" ? `Not a ${network} address.` : burn ? "This is the burn address. What is paid to it is destroyed for good." : `A ${network} address.`}
    </span>
  );
}

export function useAddressCheck(text: string, network: Network): "empty" | "valid" | "invalid" {
  const [state, setState] = useState<"empty" | "valid" | "invalid">("empty");

  useEffect(() => {
    const value = text.trim();
    if (!value) {
      setState("empty");
      return;
    }
    let current = true;
    isValidAddress(value, network).then((valid) => {
      if (current) {
        setState(valid ? "valid" : "invalid");
      }
    });
    return () => {
      current = false;
    };
  }, [text, network]);

  return state;
}

export function atomsOf(text: string): bigint {
  let atoms: bigint;
  try {
    atoms = parseTrai(text.trim());
  } catch {
    throw new Error("enter an amount such as 1.5, with at most eight decimals");
  }
  if (atoms <= 0n) {
    throw new Error("the amount must be more than zero");
  }
  return atoms;
}
