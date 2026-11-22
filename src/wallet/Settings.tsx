import { privateTransfersText } from "../privateStatus.ts";
import { usePrivate } from "./privateState.tsx";
import { burnAddress, formatTrai, isBurnAddress, type NodeInfo } from "@tenrai/sdk";
import type { PreparedTransfer, WalletBalance } from "@tenrai/sdk/wallet";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Ask, Confirm, PasswordField, WalletUser } from "../components/confirm.tsx";
import { Dialog } from "../components/dialog.tsx";
import { Facts, PhraseButtons, Words } from "../components/facts.tsx";
import { AUTO_FEE, AddressCheck, Field, FeeField, type FeeChoice, atomsOf, feeOptions, feeText, useAddressCheck } from "../components/fields.tsx";
import { useToast } from "../components/toast.tsx";
import { Amount, Badge, CopyButton } from "../components/values.tsx";
import { plural, shortAddress, trai } from "../format.ts";
import { problem } from "../problem.ts";
import { readyToSend } from "../sync.ts";
import { saveService, service, servicesOffered, tenrai, type ServiceName } from "../tenrai.ts";
import { checkPassword, forget, open } from "../vault.ts";
import { KEEP_CHOICES } from "./history.ts";
import { LOCK_MINUTES, MAX_AUTO_COMPOUND, MIN_AUTO_COMPOUND, lockLabel } from "./automation.ts";
import { REMIND_ABOVE } from "./CompoundReminder.tsx";
import { Ownership } from "./Ownership.tsx";
import { PasswordPolicy } from "./PasswordPolicy.tsx";
import { ReceiveAddress } from "./ReceiveDialog.tsx";
import { MessengerSettings } from "./MessengerSettings.tsx";
import { addressName, DEFAULT_SCAN_DEPTH, handedOut, MAX_SCAN_DEPTH, saveAddresses } from "./scan.ts";
import { useSession } from "./session.tsx";

interface Question {
  title: string;
  facts: [string, ReactNode][];
  note: string;
  action: string;
  run: () => Promise<void>;
  /** Amount used to apply the transaction password policy. */
  moves?: bigint;
}

export function Settings() {
  const { asks } = useSession();
  const [question, setQuestion] = useState<Question>();
  return (
    <div className="settings">
      <section className="group" aria-labelledby="coins-title">
        <h2 id="coins-title" className="group__title">
          Coins
        </h2>
        <Compound ask={setQuestion} />
        <AutoCompound />
        <Sweep ask={setQuestion} />
        <Burn />
      </section>

      <section className="group" aria-labelledby="security-title">
        <h2 id="security-title" className="group__title">
          Security
        </h2>
        <RecoveryPhrase />
        <PasswordPolicy />
        <Lock />
      </section>

      <section className="group" aria-labelledby="addresses-title">
        <h2 id="addresses-title" className="group__title">
          Addresses
        </h2>
        <Addresses />
        <Scan />
        <Node />
      </section>

      <section className="group" aria-labelledby="messenger-title">
        <h2 id="messenger-title" className="group__title">
          Messenger
        </h2>
        <MessengerSettings />
      </section>

      <section className="group" aria-labelledby="ownership-title">
        <h2 id="ownership-title" className="group__title">
          Address ownership
        </h2>
        <Ownership ask={setQuestion} />
      </section>

      <section className="group" aria-labelledby="device-title">
        <h2 id="device-title" className="group__title">
          This device
        </h2>
        <IncomingPayloads />
        <Multisig />
        <NativeLocksOption />
        <PrivateOption />
        <HistorySize />
      </section>

      {question && (
        <Confirm
          title={question.title}
          facts={question.facts}
          note={question.note}
          action={question.action}
          password={question.moves !== undefined && asks(question.moves)}
          onConfirm={question.run}
          onClose={() => setQuestion(undefined)}
        />
      )}
    </div>
  );
}

function Compound({ ask }: { ask: (question: Question) => void }) {
  const { wallet, data, track, salvage, remindCompound, setRemindCompound } = useSession();
  const notify = useToast();
  const [fee, setFee] = useState<FeeChoice>(AUTO_FEE);
  const [error, setError] = useState<string>();

  const review = () => {
    setError(undefined);
    try {
      const options = feeOptions(fee);
      ask({
        title: "Compound",
        facts: [
          ["Merges", "the coins of each address into one coin of that address"],
          ["Fee", feeText(fee)],
        ],
        note: "Addresses are never mixed. Later transfers need fewer inputs and cost less.",
        action: "Compound",
        moves: data?.balance.atoms ?? 0n,
        run: async () => {
          const atoms = (transfer: PreparedTransfer) => -transfer.fee;
          try {
            await readyToSend(notify);
            const sent = await wallet.compound(tenrai, options);
            if (sent.length === 0) {
              notify("Nothing to compound: every address holds one coin at most.");
              return;
            }
            track("Compound", sent, atoms);
            notify(`${plural(sent.length, "compound transfer")} sent.`);
          } catch (failure) {
            if (!salvage("Compound", failure, atoms)) {
              throw failure;
            }
            notify(problem(failure));
          }
        },
      });
    } catch (failure) {
      setError(problem(failure));
    }
  };

  return (
    <article className="card">
      <h3 className="card__title">Compound</h3>
      <p className="note">Merges the many small coins an address collects, from mining or staking for example, into one. Needed when a transfer would spend more coins than one transaction takes.</p>
      <FeeField value={fee} onChange={setFee} />
      <label className="check">
        <input type="checkbox" checked={remindCompound} onChange={(event) => setRemindCompound(event.target.checked)} />
        <span>{`Remind me once the wallet holds more than ${REMIND_ABOVE} outputs`}</span>
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="actions">
        <button type="button" className="btn btn--ghost" onClick={review}>
          Review compound
        </button>
      </div>
    </article>
  );
}

function AutoCompound() {
  const { autoCompound, setAutoCompound, autoError } = useSession();
  const [measure, setMeasure] = useState<"outputs" | "amount">(autoCompound && "atLeast" in autoCompound ? "amount" : "outputs");
  const [limit, setLimit] = useState(String(autoCompound && "above" in autoCompound ? autoCompound.above : 10));
  const [amount, setAmount] = useState(autoCompound && "atLeast" in autoCompound ? formatTrai(autoCompound.atLeast, { fixed: true }) : "10");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Enabling automatic signing requires password confirmation.
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    let setting: { above: number } | { atLeast: bigint };
    try {
      if (measure === "amount") {
        setting = { atLeast: atomsOf(amount) };
      } else {
        const value = Number(limit.trim());
        if (!Number.isSafeInteger(value) || value < MIN_AUTO_COMPOUND || value > MAX_AUTO_COMPOUND) {
          throw new Error(`use a whole number from ${MIN_AUTO_COMPOUND} to ${MAX_AUTO_COMPOUND.toLocaleString("en-US")}`);
        }
        setting = { above: value };
      }
    } catch (failure) {
      setError(problem(failure));
      return;
    }
    setBusy(true);
    try {
      await checkPassword(password);
      setPassword("");
      setAutoCompound(setting);
    } catch (failure) {
      setError(problem(failure));
    } finally {
      setBusy(false);
    }
  };
  const state =
    autoCompound === null
      ? "Off."
      : "above" in autoCompound
        ? `On: above ${plural(autoCompound.above, "output")} at one address.`
        : `On: once the outputs of an address besides its largest add up to ${trai(autoCompound.atLeast)}.`;

  return (
    <article className="card">
      <h3 className="card__title">Automatic compounding</h3>
      <p className="note">
        While this wallet is open, it merges the outputs of every address that reaches the limit, at the normal fee,
        checking once a minute. Off until you turn it on; the setting stays on this device. An address with a single
        output is never compounded, whatever it holds.
      </p>
      <form className="stack-form" onSubmit={save} noValidate>
        <WalletUser />
        <fieldset className="choice">
          <legend className="field__k">Measured by</legend>
          <label>
            <input type="radio" name="auto-compound-by" checked={measure === "outputs"} onChange={() => setMeasure("outputs")} /> Number of outputs (UTXOs)
          </label>
          <label>
            <input type="radio" name="auto-compound-by" checked={measure === "amount"} onChange={() => setMeasure("amount")} /> Amount (TRAI)
          </label>
        </fieldset>
        {measure === "outputs" ? (
          <Field label="Once it holds more than this many outputs">
            <input value={limit} onChange={(event) => setLimit(event.target.value)} inputMode="numeric" autoComplete="off" maxLength={6} />
          </Field>
        ) : (
          <Field label="Once its outputs besides the largest add up to (TRAI)">
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" autoComplete="off" maxLength={40} />
          </Field>
        )}
        <Field label="Password">
          <input type="password" autoComplete="current-password" maxLength={4096} value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        <p className="note">{state}</p>
        {(error ?? autoError) && <p className="form-error">{error ?? autoError}</p>}
        <div className="actions">
          <button type="submit" className="btn btn--ghost" disabled={busy || !password}>
            {autoCompound === null ? "Turn on" : "Save limit"}
          </button>
          {autoCompound !== null && (
            <button type="button" className="btn btn--ghost" onClick={() => setAutoCompound(null)}>
              Turn off
            </button>
          )}
        </div>
      </form>
    </article>
  );
}

function Sweep({ ask }: { ask: (question: Question) => void }) {
  const { wallet, network, data, track, salvage } = useSession();
  const notify = useToast();
  const [to, setTo] = useState("");
  const [fee, setFee] = useState<FeeChoice>(AUTO_FEE);
  const [error, setError] = useState<string>();
  const check = useAddressCheck(to, network);
  const burn = check === "valid" && isBurnAddress(to.trim());

  const review = (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    try {
      if (check !== "valid") {
        throw new Error(`enter the ${network} address that gets everything`);
      }
      const options = feeOptions(fee);
      const destination = to.trim();
      const own = wallet.owns(destination);
      ask({
        title: "Sweep",
        facts: [
          ["To", <span className="mono">{destination}</span>],
          ["Sends", "everything this wallet can spend"],
          ["Fee", feeText(fee)],
        ],
        note: "Many coins take several transfers; run it again if one of them fails.",
        action: "Sweep",
        moves: data?.balance.atoms ?? 0n,
        run: async () => {
          const atoms = (transfer: PreparedTransfer) => -(own ? transfer.fee : transfer.amount + transfer.fee);
          try {
            await readyToSend(notify);
            const sent = await wallet.sweep(tenrai, { to: destination, ...options });
            track("Sweep", sent, atoms);
            notify(`${plural(sent.length, "sweep transfer")} sent.`);
          } catch (failure) {
            if (!salvage("Sweep", failure, atoms)) {
              throw failure;
            }
            notify(problem(failure));
          }
          setTo("");
        },
      });
    } catch (failure) {
      setError(problem(failure));
    }
  };

  return (
    <article className="card card--wide">
      <h3 className="card__title">Sweep</h3>
      <form className="stack-form" onSubmit={review} noValidate>
        <Field label="Send everything to" hint={<AddressCheck state={check} network={network} burn={burn} />}>
          <input
            value={to}
            onChange={(event) => setTo(event.target.value)}
            data-tone={check === "valid" && !burn ? "ok" : check === "empty" ? undefined : "bad"}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={128}
          />
        </Field>
        <FeeField value={fee} onChange={setFee} />
        {error && <p className="form-error">{error}</p>}
        <div className="actions">
          <button type="submit" className="btn btn--ghost">
            Review sweep
          </button>
        </div>
      </form>
    </article>
  );
}

function Burn() {
  const { wallet, network, track, salvage, asks } = useSession();
  const notify = useToast();
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState<FeeChoice>(AUTO_FEE);
  const [prepared, setPrepared] = useState<PreparedTransfer>();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const address = burnAddress(network);
  const needsPassword = prepared !== undefined && asks(prepared.amount);

  const review = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      setPrepared(await wallet.prepare(tenrai, { to: address, amount: atomsOf(amount), ...feeOptions(fee) }));
    } catch (failure) {
      setError(problem(failure));
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setPrepared(undefined);
    setPassword("");
    setFailed(undefined);
  };

  const confirm = async () => {
    if (!prepared || busy || (needsPassword && !password)) {
      return;
    }
    setBusy(true);
    setFailed(undefined);
    const atoms = (transfer: PreparedTransfer) => -(transfer.amount + transfer.fee);
    try {
      if (needsPassword) {
        await checkPassword(password);
        setPassword("");
      }
      await readyToSend(notify);
      const sent = await wallet.submit(tenrai, prepared);
      track("Burn", [sent], atoms, undefined, [address]);
      notify("Burned. It is final once a cut executes it.");
      setAmount("");
      back();
    } catch (failure) {
      if (salvage("Burn", failure, atoms, undefined, [address])) {
        notify(problem(failure));
        setAmount("");
        back();
      } else {
        setFailed(problem(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="card">
      <h3 className="card__title">Burn</h3>
      <p className="note">Pays the amount to the burn address, which no key can spend. Burned coins leave the supply and cannot be recovered.</p>
      <form className="stack-form" onSubmit={review} noValidate>
        <Field label="Amount (TRAI)">
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" autoComplete="off" maxLength={40} />
        </Field>
        <FeeField value={fee} onChange={setFee} />
        {error && <p className="form-error">{error}</p>}
        <div className="actions">
          <button type="submit" className="btn btn--ghost" disabled={busy}>
            {busy && !prepared ? "Signing…" : "Review burn"}
          </button>
        </div>
      </form>
      {prepared && (
        <Dialog title="Burn TRAI" onClose={back}>
          <Facts
            rows={[
              ["Type", "Burn"],
              ["To", <span className="mono">{`${address} (burn address)`}</span>],
              ["Amount", <Amount atoms={prepared.amount} />],
              ["Fee", <Amount atoms={prepared.fee} />],
              ["Total", <Amount atoms={prepared.amount + prepared.fee} />],
              ["Transaction ID", <span className="mono">{prepared.transactionId}</span>],
            ]}
          />
          {needsPassword && <PasswordField value={password} onChange={setPassword} onEnter={() => void confirm()} />}
          {failed && (
            <p className="form-error" role="alert">
              {failed}
            </p>
          )}
          <div className="actions actions--end">
            <button type="button" className="btn btn--ghost" onClick={back} disabled={busy}>
              Back
            </button>
            <button type="button" className="btn btn--solid" onClick={() => void confirm()} disabled={busy || (needsPassword && !password)}>
              {busy ? "Burning…" : "Burn"}
            </button>
          </div>
        </Dialog>
      )}
    </article>
  );
}

function RecoveryPhrase() {
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const reveal = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      setPhrase((await open(password)).secret.mnemonic);
      setPassword("");
    } catch (failure) {
      setError(problem(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="card">
      <h3 className="card__title">Recovery phrase</h3>
      {phrase ? (
        <>
          <p className="note">Anyone who sees these words can spend your TRAI.</p>
          <Words phrase={phrase} />
          <div className="actions">
            <PhraseButtons phrase={phrase} />
            <button type="button" className="btn btn--ghost" onClick={() => setPhrase(undefined)}>
              Hide the words
            </button>
          </div>
        </>
      ) : (
        <form className="inline-form" onSubmit={reveal} noValidate>
          <WalletUser />
          <Field label="Password">
            <input type="password" autoComplete="current-password" maxLength={4096} value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <button type="submit" className="btn btn--ghost" disabled={busy || !password}>
            {busy ? "Opening…" : "Show the 24 words"}
          </button>
        </form>
      )}
      {error && <p className="form-error">{error}</p>}
    </article>
  );
}

function Lock() {
  const { lock, lockMinutes, setLockMinutes } = useSession();
  const [asking, setAsking] = useState(false);
  const forgetWallet = () => {
    forget();
    lock();
  };
  return (
    <article className="card card--wide">
      <h3 className="card__title">Lock</h3>
      <Field label="Lock after this long without activity">
        <select value={lockMinutes} onChange={(event) => setLockMinutes(Number(event.target.value))}>
          {LOCK_MINUTES.map((minutes) => (
            <option key={minutes} value={minutes}>
              {lockLabel(minutes)}
            </option>
          ))}
        </select>
      </Field>
      <p className="note">{`The wallet locks itself after ${lockLabel(lockMinutes)} without activity and when the tab closes. Locking removes the keys from the page.`}</p>
      <div className="actions">
        <button type="button" className="btn btn--ghost" onClick={lock}>
          Lock now
        </button>
        <button type="button" className="btn btn--danger" onClick={() => setAsking(true)}>
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
    </article>
  );
}

function IncomingPayloads() {
  const { incomingPayloads, setIncomingPayloads } = useSession();
  const notify = useToast();
  return (
    <article className="card">
      <h3 className="card__title">Payloads</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={incomingPayloads}
          onChange={(event) => {
            setIncomingPayloads(event.target.checked);
            notify(event.target.checked ? "Payloads of incoming payments are shown again." : "Payloads of incoming payments are dropped unread.");
          }}
        />
        <span>Show payloads of incoming payments</span>
      </label>
      <p className="note">
        Off, the payments still arrive in full, but the wallet drops what others wrote into them unread, and forgets those it kept.
        Your own payloads stay.
      </p>
    </article>
  );
}

function Multisig() {
  const { history } = useSession();
  const [shown, setShown] = useState(() => history.multisig);
  return (
    <article className="card">
      <h3 className="card__title">Multisig</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={shown}
          onChange={(event) => {
            history.setMultisig(event.target.checked);
            setShown(event.target.checked);
          }}
        />
        <span>Show multisig</span>
      </label>
      <p className="note">Adds the Multisig button for packages that several keys sign together.</p>
    </article>
  );
}

function NativeLocksOption() {
  const { history } = useSession();
  const [shown, setShown] = useState(() => history.nativeLocks);
  return (
    <article className="card">
      <h3 className="card__title">Timelocks &amp; swaps</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={shown}
          onChange={(event) => {
            history.setNativeLocks(event.target.checked);
            setShown(event.target.checked);
          }}
        />
        <span>Show timelocks and swaps</span>
      </label>
      <p className="note">Adds the button for timelocked coins and atomic swaps.</p>
    </article>
  );
}

function PrivateOption() {
  const { available, enabled, setEnabled, status } = usePrivate();
  return (
    <article className="card">
      <h3 className="card__title">Private transfers</h3>
      <label className="check">
        <input type="checkbox" checked={enabled} disabled={!available} onChange={(event) => setEnabled(event.target.checked)} />
        <span>Use private transfers</span>
      </label>
      <p className="note">Adds a private balance, private sending and a private address. While it is off, this wallet neither reads nor shows private notes.</p>
      <p className="note">{privateTransfersText(status)}</p>
    </article>
  );
}

function HistorySize() {
  const { keep, setKeep } = useSession();
  const notify = useToast();
  const [asking, setAsking] = useState<number | null>(null);
  const apply = (value: number) => {
    setKeep(value);
    notify(`This device keeps the newest ${value.toLocaleString("en-US")} transactions.`);
  };
  const choose = (value: number) => {
    if (value < keep) {
      setAsking(value);
      return;
    }
    apply(value);
  };
  return (
    <article className="card">
      <h3 className="card__title">Activity history</h3>
      <Field label="Keep on this device">
        <select value={keep} onChange={(event) => choose(Number(event.target.value))}>
          {KEEP_CHOICES.map((value) => (
            <option key={value} value={value}>
              {`${value.toLocaleString("en-US")} transactions`}
            </option>
          ))}
        </select>
      </Field>
      <p className="note">Older ones are deleted. The balance comes from the coins themselves and stays right; keeping more reads further back from the node.</p>
      {asking !== null && (
        <Ask
          title="Activity history"
          text={`Keep only the newest ${asking.toLocaleString("en-US")} transactions? Older ones are deleted from this device.`}
          action="Delete older ones"
          onConfirm={() => apply(asking)}
          onClose={() => setAsking(null)}
        />
      )}
    </article>
  );
}

function Addresses() {
  const { wallet, data, receiveIndex, issued, useAddress } = useSession();
  const rows = new Map<string, WalletBalance["addresses"][number]>();
  for (const index of handedOut(issued)) {
    const address = wallet.address(index);
    rows.set(address, { address, branch: "receive", index, atoms: 0n, outputs: 0 });
  }
  for (const entry of data?.balance.addresses ?? []) {
    rows.set(entry.address, entry);
  }
  return (
    <article className="card card--wide">
      <h3 className="card__title">Receiving address</h3>
      <ReceiveAddress />
      {data && (
        <table className="table">
          <thead>
            <tr>
              <th>Address</th>
              <th>Kind</th>
              <th>Balance</th>
              <th>Receive</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...rows.values()].map((entry) => (
              <tr key={entry.address}>
                <td data-label="Address" className="mono" title={entry.address}>
                  {shortAddress(entry.address)}
                </td>
                <td data-label="Kind">{addressName(entry.index, entry.branch)}</td>
                <td data-label="Balance">
                  <Amount atoms={entry.atoms} />
                </td>
                <td data-label="Receive">
                  {entry.branch === "receive" && entry.index === receiveIndex ? (
                    <Badge tone="good">In use</Badge>
                  ) : entry.branch === "receive" && entry.index <= issued ? (
                    <button type="button" className="btn btn--ghost btn--small" onClick={() => useAddress(entry.index)}>
                      Use
                    </button>
                  ) : null}
                </td>
                <td data-label="">
                  <CopyButton text={entry.address} className="btn btn--ghost btn--small" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}

function lastUsed(index: number, kind: string): string {
  return index < 0 ? `no ${kind} used` : `last used ${kind} #${index}`;
}

function Scan() {
  const { wallet, refresh } = useSession();
  const notify = useToast();
  const [depth, setDepth] = useState(String(DEFAULT_SCAN_DEPTH));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const scan = async (event: FormEvent) => {
    event.preventDefault();
    const value = Number(depth.trim());
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SCAN_DEPTH) {
      setError(`enter a whole number from 1 to ${MAX_SCAN_DEPTH}`);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const used = await wallet.rescan(tenrai, { depth: value });
      saveAddresses(wallet);
      refresh();
      notify(`Scan finished: ${lastUsed(used.receive, "receiving address")}, ${lastUsed(used.change, "change address")}.`);
    } catch (failure) {
      setError(problem(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="card">
      <h3 className="card__title">Scan for coins</h3>
      <p className="note">
        Looks this many addresses past the last used one, on receiving and change addresses, for coins sent further out, such as
        by another wallet with the same recovery phrase.
      </p>
      <form className="stack-form" onSubmit={scan} noValidate>
        <Field label="Addresses past the last used one">
          <input value={depth} onChange={(event) => setDepth(event.target.value)} inputMode="numeric" autoComplete="off" maxLength={5} />
        </Field>
        {error && <p className="form-error">{error}</p>}
        <div className="actions">
          <button type="submit" className="btn btn--ghost" disabled={busy}>
            {busy ? "Scanning…" : "Scan"}
          </button>
        </div>
      </form>
    </article>
  );
}

function Node() {
  const [node, setNode] = useState<NodeInfo>();
  const [error, setError] = useState<string>();
  const [offered, setOffered] = useState<ServiceName[]>(["api"]);

  useEffect(() => {
    tenrai.node.info().then(setNode, (failure: unknown) => setError(problem(failure)));
    void servicesOffered().then(setOffered);
  }, []);

  const choose = (next: ServiceName) => {
    if (next !== service) {
      saveService(next);
      window.location.reload();
    }
  };

  return (
    <article className="card">
      <h3 className="card__title">Service</h3>
      <fieldset className="choice">
        <legend className="field__k">Read the chain through</legend>
        <label>
          <input type="radio" name="service" checked={service === "api"} onChange={() => choose("api")} /> Tenrai API
        </label>
        <label>
          <input type="radio" name="service" checked={service === "node"} disabled={!offered.includes("node")} onChange={() => choose("node")} /> Own node
        </label>
      </fieldset>
      <p className="note">{offered.includes("node") ? "Switching reloads the page; unlock the wallet again." : "This server relays the Tenrai API only."}</p>
      {node && (
        <Facts
          rows={[
            ["Network", node.network],
            ["Node version", node.node_version],
            ["Storage", node.storage_mode],
          ]}
        />
      )}
      {error && <p className="form-error">{error}</p>}
    </article>
  );
}
