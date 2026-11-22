import { formatTrai } from "@tenrai/sdk";
import { type FormEvent, useState } from "react";
import { WalletUser } from "../components/confirm.tsx";
import { Field, atomsOf } from "../components/fields.tsx";
import { useToast } from "../components/toast.tsx";
import { trai } from "../format.ts";
import { problem } from "../problem.ts";
import { checkPassword } from "../vault.ts";
import type { ConfirmSetting } from "./history.ts";
import { useSession } from "./session.tsx";

const MODES: [ConfirmSetting["mode"], string][] = [
  ["always", "Every time"],
  ["above", "From an amount on"],
  ["never", "Never"],
];

function describe(setting: ConfirmSetting): string {
  if (setting.mode === "never") {
    return "Never asked.";
  }
  return setting.mode === "above" ? `Asked when a transaction moves ${trai(setting.above)} or more.` : "Asked every time.";
}

/** Changing the setting needs the password too, so nobody at an unlocked wallet turns it off. */
export function PasswordPolicy() {
  const { confirm, setConfirm } = useSession();
  const notify = useToast();
  const [mode, setMode] = useState(confirm.mode);
  const [above, setAbove] = useState(confirm.mode === "above" ? formatTrai(confirm.above, { fixed: true }) : "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const amount = mode === "above" ? atomsOf(above) : 0n;
      if (mode === "above" && amount === 0n) {
        throw new Error("enter an amount above zero");
      }
      await checkPassword(password);
      setPassword("");
      const setting = { mode, above: amount };
      setConfirm(setting);
      notify(`Password before moving coins: ${describe(setting)}`);
    } catch (failure) {
      setError(problem(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="card">
      <h3 className="card__title">Password before moving coins</h3>
      <p className="note">{describe(confirm)}</p>
      <form className="stack-form" onSubmit={save} noValidate>
        <WalletUser />
        <fieldset className="choice">
          <legend className="field__k">Ask for the password</legend>
          {MODES.map(([value, label]) => (
            <label key={value}>
              <input type="radio" name="confirm-mode" checked={mode === value} onChange={() => setMode(value)} /> {label}
            </label>
          ))}
        </fieldset>
        {mode === "above" && (
          <Field label="From this amount on (TRAI)">
            <input value={above} onChange={(event) => setAbove(event.target.value)} inputMode="decimal" autoComplete="off" maxLength={40} />
          </Field>
        )}
        <Field label="Password">
          <input type="password" autoComplete="current-password" maxLength={4096} value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        <p className="note">Covers sending, compound, sweep, stake and unstake; the amount is what a transaction moves. Automatic compounding signs without asking.</p>
        {error && <p className="form-error">{error}</p>}
        <div className="actions">
          <button type="submit" className="btn btn--ghost" disabled={busy || !password}>
            {busy ? "Checking…" : "Save"}
          </button>
        </div>
      </form>
    </article>
  );
}
