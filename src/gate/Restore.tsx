import type { Network } from "@tenrai/sdk";
import { Wallet } from "@tenrai/sdk/wallet";
import { privateWalletStore } from "../wallet/privateStore.ts";
import { type FormEvent, useState } from "react";
import { WalletUser } from "../components/confirm.tsx";
import { Field } from "../components/fields.tsx";
import { problem } from "../problem.ts";
import { save, savedNetwork } from "../vault.ts";
import { History } from "../wallet/history.ts";
import { RecoveryDownload } from "../components/recovery.tsx";
import { type Opened, passwordProblem } from "./Gate.tsx";
import type { GateLifetime } from "./lifetime.ts";

export function Restore({ network, lifetime, onOpen }: { network: Network | undefined; lifetime: GateLifetime; onOpen: (opened: Opened) => void }) {
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [recovery, setRecovery] = useState<unknown>();
  const words = phrase.trim() ? phrase.trim().toLowerCase().split(/[\s,]+/) : [];

  const restore = async (event: FormEvent) => {
    event.preventDefault();
    const invalid = passwordProblem(password, repeat);
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
      const secret = { mnemonic: words.join(" "), passphrase };
      const wallet = await attempt.wallet(() => Wallet.fromMnemonic(secret.mnemonic, { network, passphrase, privateStore: (owner) => privateWalletStore(owner, () => History.open(secret, network, { requireEmptyPublic: true }).then(() => {})) }));
      attempt.assertOpen();
      const history = await History.open(secret, network);
      attempt.assertOpen();
      await save(secret, password, network, { assertOpen: () => attempt.assertOpen() });
      attempt.assertOpen();
      attempt.handoff(wallet, () => onOpen({ wallet, network, history }));
    } catch (failure) {
      await attempt.close().catch(() => {});
      if (!attempt.current) return;
      setError(problem(failure));
      setRecovery(failure);
      setBusy(false);
    }
  };

  return (
    <section className="gate__body" aria-labelledby="restore-title">
      <h1 id="restore-title" className="gate__title">
        Restore a wallet
      </h1>
      <form className="stack-form" onSubmit={restore} noValidate>
        <WalletUser />
        <Field label="Recovery phrase" hint={<span className="note">{words.length} of 24 words</span>}>
          <textarea
            rows={4}
            maxLength={512}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
          />
        </Field>
        <Field label="New password, 12 characters or more">
          <input type="password" autoComplete="new-password" maxLength={4096} value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        <Field label="Repeat the password">
          <input type="password" autoComplete="new-password" maxLength={4096} value={repeat} onChange={(event) => setRepeat(event.target.value)} />
        </Field>
        <Field label="Passphrase, only if the wallet has one">
          <input type="password" autoComplete="off" maxLength={256} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />
        </Field>
        {savedNetwork() && <p className="note">This replaces the wallet saved on this device.</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <RecoveryDownload error={recovery} />
        <button className="btn btn--solid btn--wide" type="submit" disabled={busy || !network || words.length !== 24}>
          {busy ? "Restoring…" : "Restore"}
        </button>
      </form>
    </section>
  );
}
