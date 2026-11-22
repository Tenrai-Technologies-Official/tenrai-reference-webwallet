import { type ReactNode, useEffect, useRef, useState } from "react";
import { problem } from "../problem.ts";
import { checkPassword } from "../vault.ts";
import { Dialog } from "./dialog.tsx";
import { Facts } from "./facts.tsx";

/** Account label for password managers. */
export function WalletUser() {
  return <input type="text" name="username" autoComplete="username" value="Tenrai Wallet" readOnly hidden />;
}

/** Wrap detached secret fields for password managers. Fields handle Enter. */
export function SecretForm({ children }: { children: ReactNode }) {
  return (
    <form className="secret-form" onSubmit={(event) => event.preventDefault()} noValidate>
      <WalletUser />
      {children}
    </form>
  );
}

export function PasswordField({ value, onChange, onEnter }: { value: string; onChange: (value: string) => void; onEnter: () => void }) {
  return (
    <SecretForm>
      <label className="field">
        <span className="field__k">Password</span>
        <input
          type="password"
          autoComplete="current-password"
          maxLength={4096}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onEnter();
            }
          }}
          autoFocus
        />
      </label>
    </SecretForm>
  );
}

export function Ask({ title, text, action, onConfirm, onClose }: { title: string; text: string; action: string; onConfirm: () => void; onClose: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
  }, []);
  return (
    <Dialog title={title} onClose={onClose}>
      <p>{text}</p>
      <div className="actions actions--end">
        <button type="button" className="btn btn--ghost" ref={cancel} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => {
            onClose();
            onConfirm();
          }}
        >
          {action}
        </button>
      </div>
    </Dialog>
  );
}

export function Confirm({
  title,
  facts,
  note,
  action,
  password = false,
  onConfirm,
  onClose,
}: {
  title: string;
  facts: [string, ReactNode][];
  note?: string;
  action: string;
  password?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [typed, setTyped] = useState("");

  const confirm = async () => {
    if (busy || (password && !typed)) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      if (password) {
        await checkPassword(typed);
        setTyped("");
      }
      await onConfirm();
      onClose();
    } catch (failure) {
      setError(problem(failure));
      setBusy(false);
    }
  };

  return (
    <Dialog title={title} onClose={onClose}>
      <Facts rows={facts} />
      {note && <p className="note">{note}</p>}
      {password && <PasswordField value={typed} onChange={setTyped} onEnter={() => void confirm()} />}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="actions actions--end">
        <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn--solid" onClick={confirm} disabled={busy || (password && !typed)}>
          {busy ? "Signing…" : action}
        </button>
      </div>
    </Dialog>
  );
}
