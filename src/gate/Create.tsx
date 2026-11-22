import type { Network } from "@tenrai/sdk";
import { Wallet } from "@tenrai/sdk/wallet";
import { privateWalletStore } from "../wallet/privateStore.ts";
import { type FormEvent, type KeyboardEvent, useState } from "react";
import { WalletUser } from "../components/confirm.tsx";
import { Dialog } from "../components/dialog.tsx";
import { PhraseButtons, Words } from "../components/facts.tsx";
import { Field } from "../components/fields.tsx";
import { problem } from "../problem.ts";
import { save } from "../vault.ts";
import { History } from "../wallet/history.ts";
import { RecoveryDownload } from "../components/recovery.tsx";
import { type Opened, passwordProblem } from "./Gate.tsx";
import type { GateAttempt, GateLifetime } from "./lifetime.ts";

export function Create({ network, lifetime, onOpen }: { network: Network | undefined; lifetime: GateLifetime; onOpen: (opened: Opened) => void }) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [passphraseRepeat, setPassphraseRepeat] = useState("");
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [recovery, setRecovery] = useState<unknown>();
  const [created, setCreated] = useState<{ wallet: Wallet; mnemonic: string; passphrase: string; network: Network; attempt: GateAttempt }>();

  // The passphrase fields belong to a form of their own; Enter in them creates the wallet as in the other fields.
  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const form = event.currentTarget.closest("form");
    const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (form && button && !button.disabled) form.requestSubmit(button);
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const invalid = passwordProblem(password, repeat) ?? (passphrase === passphraseRepeat ? undefined : "The two passphrases differ.");
    if (invalid || !network) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(undefined);
    setRecovery(undefined);
    const attempt = lifetime.begin();
    try {
      await attempt.ready();
      let mnemonic = "";
      const wallet = await attempt.wallet(async () => {
        const generated = await Wallet.generate({ network, passphrase, privateStore: privateWalletStore });
        mnemonic = generated.mnemonic;
        return generated.wallet;
      });
      attempt.assertOpen();
      setCreated({ wallet, mnemonic, passphrase, network, attempt });
    } catch (failure) {
      await attempt.close().catch(() => {});
      if (attempt.current) { setError(problem(failure)); setRecovery(failure); }
    } finally {
      if (attempt.current) setBusy(false);
    }
  };

  // Saved only once the words are written down, so a closed dialog leaves nothing behind.
  const keep = async () => {
    if (!created) return;
    const { wallet, mnemonic, passphrase: selectedPassphrase, network: selectedNetwork, attempt } = created;
    try {
      attempt.assertOpen();
      const secret = { mnemonic, passphrase: selectedPassphrase };
      const history = await History.open(secret, selectedNetwork);
      attempt.assertOpen();
      await save(secret, password, selectedNetwork, { assertOpen: () => attempt.assertOpen() });
      attempt.assertOpen();
      attempt.handoff(wallet, () => onOpen({ wallet, network: selectedNetwork, history }));
    } catch (failure) {
      await attempt.close().catch(() => {});
      if (attempt.current) { setCreated(undefined); setError(problem(failure)); setRecovery(failure); }
    }
  };

  const discard = async () => {
    if (!created) return;
    const { attempt } = created;
    try { await attempt.close(); }
    catch (failure) { if (attempt.current) setError(problem(failure)); }
    finally { if (attempt.current) setCreated(undefined); }
  };

  return (
    <section className="gate__body" aria-labelledby="create-title">
      <h1 id="create-title" className="gate__title">
        Create a wallet
      </h1>
      <p className="note">The wallet draws a new 24-word recovery phrase on this device and shows it once to write down. You only choose a password.</p>
      <form className="stack-form" onSubmit={create} noValidate>
        <WalletUser />
        <Field label="Password, 12 characters or more">
          <input type="password" autoComplete="new-password" maxLength={4096} value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        <Field label="Repeat the password">
          <input type="password" autoComplete="new-password" maxLength={4096} value={repeat} onChange={(event) => setRepeat(event.target.value)} />
        </Field>
        <details className="plain">
          <summary>Extra passphrase, optional</summary>
          <p className="note">A second secret on top of the 24 words. A different passphrase opens a different, empty wallet.</p>
          <Field label="Passphrase">
            <input type="password" autoComplete="off" maxLength={256} form="create-passphrase" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} onKeyDown={submitOnEnter} />
          </Field>
          <Field label="Repeat the passphrase">
            <input
              type="password"
              autoComplete="off"
              maxLength={256}
              form="create-passphrase"
              value={passphraseRepeat}
              onChange={(event) => setPassphraseRepeat(event.target.value)}
              onKeyDown={submitOnEnter}
            />
          </Field>
        </details>
        <label className="check">
          <input type="checkbox" checked={backup} onChange={(event) => setBackup(event.target.checked)} />
          <span>I will write down the 24 words. Without them the funds cannot be recovered.</span>
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <RecoveryDownload error={recovery} />
        <button className="btn btn--solid btn--wide" type="submit" disabled={busy || !network || !backup}>
          {busy ? "Creating…" : "Create wallet"}
        </button>
      </form>
      <form id="create-passphrase" hidden />
      {created && <PhraseDialog phrase={created.mnemonic} onKeep={keep} onCancel={() => void discard()} />}
    </section>
  );
}

function PhraseDialog({ phrase, onKeep, onCancel }: { phrase: string; onKeep: () => Promise<void>; onCancel: () => void }) {
  const [written, setWritten] = useState(false);
  const [busy, setBusy] = useState(false);

  const keep = async () => {
    setBusy(true);
    await onKeep();
  };

  return (
    <Dialog title="Your recovery phrase" onClose={onCancel}>
      <p className="note">Write these 24 words down in this order, or save them, and keep them offline. Anyone who has them, on paper or in a file, can spend your TRAI.</p>
      <Words phrase={phrase} />
      <div className="actions">
        <PhraseButtons phrase={phrase} />
      </div>
      <label className="check">
        <input type="checkbox" checked={written} onChange={(event) => setWritten(event.target.checked)} />
        <span>I wrote the 24 words down or saved them.</span>
      </label>
      <div className="actions actions--end">
        <button type="button" className="btn btn--solid" disabled={!written || busy} onClick={keep}>
          {busy ? "Saving…" : "Open the wallet"}
        </button>
      </div>
    </Dialog>
  );
}
