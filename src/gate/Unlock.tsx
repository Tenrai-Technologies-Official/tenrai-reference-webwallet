import type { Network } from "@tenrai/sdk";
import { Wallet } from "@tenrai/sdk/wallet";
import { privateWalletStore } from "../wallet/privateStore.ts";
import { type FormEvent, useState } from "react";
import { Ask, WalletUser } from "../components/confirm.tsx";
import { Field } from "../components/fields.tsx";
import { problem } from "../problem.ts";
import { forget, open, savedNetwork } from "../vault.ts";
import { History } from "../wallet/history.ts";
import { RecoveryDownload } from "../components/recovery.tsx";
import { restoreAddresses } from "../wallet/scan.ts";
import type { Opened } from "./Gate.tsx";
import type { GateLifetime } from "./lifetime.ts";

export function Unlock({
  network,
  lifetime,
  onOpen,
  onRestore,
  onForget,
}: {
  network: Network | undefined;
  lifetime: GateLifetime;
  onOpen: (opened: Opened) => void;
  onRestore: () => void;
  onForget: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [recovery, setRecovery] = useState<unknown>();

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setRecovery(undefined);
    const attempt = lifetime.begin();
    try {
      await attempt.ready();
      const { secret, network: saved } = await open(password);
      attempt.assertOpen();
      if (network !== undefined && saved !== network) {
        throw new Error(`this wallet is for the ${saved} network, the node runs ${network}`);
      }
      const wallet = await attempt.wallet(() => Wallet.fromMnemonic(secret.mnemonic, { network: saved, passphrase: secret.passphrase, privateStore: (owner) => privateWalletStore(owner, () => History.open(secret, saved, { requireEmptyPublic: true }).then(() => {})) }));
      attempt.assertOpen();
      restoreAddresses(wallet);
      const history = await History.open(secret, saved);
      attempt.assertOpen();
      attempt.handoff(wallet, () => onOpen({ wallet, network: saved, history }));
    } catch (failure) {
      await attempt.close().catch(() => {});
      if (!attempt.current) return;
      setError(problem(failure));
      setRecovery(failure);
      setBusy(false);
    }
  };

  const [asking, setAsking] = useState(false);
  const forgetWallet = () => {
    void lifetime.cancel();
    forget();
    onForget();
  };

  return (
    <section className="gate__body" aria-labelledby="unlock-title">
      <h1 id="unlock-title" className="gate__title">
        Welcome back
      </h1>
      <p className="note">A {savedNetwork()} wallet is saved on this device.</p>
      <form className="stack-form" onSubmit={unlock} noValidate>
        <WalletUser />
        <Field label="Password">
          <input
            type="password"
            autoComplete="current-password"
            maxLength={4096}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
          />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <RecoveryDownload error={recovery} />
        <button className="btn btn--solid btn--wide" type="submit" disabled={busy || !network || !password}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </form>
      <div className="gate__links">
        <button type="button" className="link" onClick={onRestore}>
          Restore another wallet
        </button>
        <button type="button" className="link" onClick={() => setAsking(true)}>
          Forget this wallet
        </button>
      </div>
      {asking && (
        <Ask
          title="Forget this wallet"
          text="Remove the wallet from this device? Only its 24 words bring it back."
          action="Forget"
          onConfirm={forgetWallet}
          onClose={() => setAsking(false)}
        />
      )}
    </section>
  );
}
