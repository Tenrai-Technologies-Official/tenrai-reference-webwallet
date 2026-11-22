import {UnknownOutcomes} from "./UnknownOutcomes.tsx";
import { PublishRegistration } from "./PrivateRegistration.tsx";
import type { ProofKind } from "@tenrai/sdk/wallet";
import { useEffect, useState } from "react";
import { PasswordField } from "../components/confirm.tsx";
import { Dialog } from "../components/dialog.tsx";
import { Facts } from "../components/facts.tsx";
import { AddressCheck, Field, atomsOf, useAddressCheck } from "../components/fields.tsx";
import { MergeIcon, ReceiveIcon, SendIcon } from "../components/icons.tsx";
import { useToast } from "../components/toast.tsx";
import { Badge, CopyIconButton, QrCode } from "../components/values.tsx";
import { VerificationWords } from "../components/words.tsx";
import { count, dateTime, shortAddress, trai, traiBrief } from "../format.ts";
import { problem as problemText } from "../problem.ts";
import { checkPassword } from "../vault.ts";
import { estimateText, spokenTime } from "./proofTime.ts";
import { usePrivate } from "./privateState.tsx";
import { useSession } from "./session.tsx";

type Way = "send" | "enter" | "exit";

const WAYS: [Way, string][] = [
  ["send", "Send privately"],
  ["enter", "Make private"],
  ["exit", "Make transparent"],
];

function clockTime(millis: number): string {
  const seconds = Math.floor(millis / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PrivateTab() {
  const state = usePrivate();
  const { result, proof, usability, registered } = state;
  const [dialog, setDialog] = useState<Way | "receive">();
  const [preset, setPreset] = useState<{ to: string; amount: string } | null>(null);

  useEffect(() => {
    const taken = state.takePreset();
    if (taken) {
      setPreset(taken);
      setDialog("send");
    }
    // Consume the payment draft on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reserved=result?.reservedAtoms??0n;
  const ready = usability === "ready" && registered === true && !proof;
  const free=result?result.noteCount-result.reservedNoteCount:0n;
  const blocked =
    usability === "other-rules"
      ? "The node runs other private rules than this wallet knows, so it makes no proofs. Update the wallet or choose another node."
      : usability === "no-fit"
        ? "The node reports that proofs do not fit its limits, so private sends stay off."
        : usability === "review-open"
          ? "The security review of private transfers is open, so they stay off on mainnet."
          : "";

  return (
    <div className="home">
      <article className="hero">
        <p className="eyebrow">Private balance</p>
        <p className="hero__amount">{result ? trai(result.balanceAtoms) : state.checking ? "Checking…" : "…"}</p>
        <p className="hero__sub">{result ? `${result.noteCount} notes, proven at cut ${count(result.height)}` : ""}</p>
        <div className="hero__stats">
          <div>
            <p className="stat__k">Available</p>
            <p className="stat__v">{result ? traiBrief(result.balanceAtoms - reserved) : "-"}</p>
            <p className="stat__s" />
          </div>
          <div>
            <p className="stat__k">On the way</p>
            <p className="stat__v">{result ? traiBrief(reserved) : "-"}</p>
            <p className="stat__s" />
          </div>
          <div>
            <p className="stat__k">Free notes</p>
            <p className="stat__v">{result ? count(free) : "-"}</p>
            <p className="stat__s" />
          </div>
        </div>
        <div className="hero__actions hero__actions--two">
          <button type="button" className="btn btn--solid" onClick={() => setDialog("send")} disabled={!ready}>
            <SendIcon />
            Send privately
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setDialog("receive")} disabled={!state.address}>
            <ReceiveIcon />
            Receive
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setDialog("enter")} disabled={!ready}>
            Make private
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setDialog("exit")} disabled={!ready}>
            Make transparent
          </button>
        </div>
      </article>

      <div className="home__side">
        {(blocked || (usability === "ready" && registered === false)) && (
          <section className="block" aria-labelledby="private-start-title">
            <h2 id="private-start-title" className="block__title">
              Before the first use
            </h2>
            {blocked && <p className="note">{blocked}</p>}
            {usability === "ready" && registered === false && (
              <>
                <p className="note">This wallet's private account is not published yet. It can receive and spend notes once a final cut holds the registration.</p>
                {state.registering ? (
                  <p className="note" role="status">
                    Waiting for a final cut to hold the registration…
                  </p>
                ) : (
                  <div>
                    <PublishRegistration />
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {state.problem && (
          <p className="form-error" role="alert">
            {state.problem}
          </p>
        )}

        {proof && <ProofBlock />}

        <section className="block" aria-labelledby="private-activity-title">
          <h2 id="private-activity-title" className="block__title">
            Activity
          </h2>
          <PrivateActivity />
          <UnknownOutcomes page={state.unknownPage} read={state.unknownOutcome}/>
        </section>

        {result && result.noteCount > 0n && (
          <section className="block" aria-labelledby="private-notes-title">
            <h2 id="private-notes-title" className="block__title">
              Notes
            </h2>
            <p className="note">
              {String(free)} of {String(result.noteCount)} free
            </p>
            {free < 2n && (
              <p className="note">
                {free === 1n
                  ? "A private send spends two notes and this wallet has one free. Make a small amount private to add notes, or pay the note out with Make transparent."
                  : "All your notes are on the way. New ones arrive once a final cut has run the transaction."}
              </p>
            )}
            <PrivateNotePages />
            <ul className="private-notes">
              {result.notes.map((note) => (
                <li key={note.note} className="private-note">
                  <span>Note {count(note.note)}</span>
                  <span className="private-note__value">{trai(note.valueAtoms)}</span>
                  {!state.freeNotes.includes(note) && <Badge tone="wait">On the way</Badge>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <details className="plain">
          <summary>Balance looks wrong?</summary>
          <p className="note">
            This wallet checks your notes against the chain on its own, and proofs are made on this device: no key and no note leaves it. If something is missing, for example after a restore, read the whole history. That can take a
            while.
          </p>
          <div className="actions">
            <button type="button" className="btn btn--ghost" onClick={() => void state.refresh()} disabled={state.checking}>
              Check again
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => void state.refresh(true)} disabled={state.checking}>
              Read the whole history
            </button>
          </div>
        </details>
      </div>

      {dialog === "receive" && <PrivateReceive onClose={() => setDialog(undefined)} />}
      {dialog !== undefined && dialog !== "receive" && (
        <PrivateDialog way={dialog} preset={preset} onWay={setDialog} onClose={() => { setDialog(undefined); setPreset(null); }} />
      )}
    </div>
  );
}

function ProofBlock() {
  const { proof, cancel } = usePrivate();
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!proof) return null;
  return (
    <section className="block" aria-labelledby="private-proof-title">
      <h2 id="private-proof-title" className="block__title">
        Proof on this device
      </h2>
      <progress className="private-progress" max={1} value={proof.share} aria-labelledby="private-proof-text" />
      <p className="note" id="private-proof-text" role="status">
        {proof.left === null
          ? `Making the proof on this device: ${Math.round(proof.share * 100)} %, ${clockTime(Date.now() - proof.began)}`
          : `Making the proof on this device: ${Math.round(proof.share * 100)} %, about ${spokenTime(proof.left)} left`}
      </p>
      <div>
        <button type="button" className="btn btn--ghost" onClick={cancel}>
          Cancel the proof
        </button>
      </div>
    </section>
  );
}

function PrivateActivity() {
  const { onTheWay, recent, result, retry } = usePrivate();
  const notify = useToast();
  if (!onTheWay.length && !recent.length) {
    if (!result) return null;
    if (result.noteCount > 0n) return <p className="note">No private transactions on this device yet.</p>;
    return <p className="note">Nothing here yet. Make coins private, or give someone your private address. Only you see the amounts and who paid whom.</p>;
  }
  return (
    <ul className="activity">
      {onTheWay.map((entry) => (
        <Row key={entry.digest} kind={entry.kind} atoms={BigInt(entry.kind === "private_register" ? entry.feeAtoms : entry.amountAtoms)} to={entry.to} time={entry.time}
          stage={entry.stage === "needs_review" ? "Needs review; payment remains reserved" : entry.stage === "pool" ? "Waiting for a final cut" : "Going to the node"}
          reason={entry.reviewReason}
          retry={entry.stage === "needs_review" ? () => { void retry(entry.digest).catch((error: unknown) => notify(problemText(error))); } : undefined} />
      ))}
      {recent.map((entry, index) => (
        <Row key={`${entry.time}-${index}`} kind={entry.kind} atoms={BigInt(entry.amountAtoms)} to={entry.to} time={entry.time} />
      ))}
    </ul>
  );
}

function Row({ kind, atoms, to, time, stage, reason, retry }: { kind: string; atoms: bigint; to: string | null; time: number; stage?: string; reason?: string | undefined; retry?: (() => void) | undefined }) {
  const titles: Record<string, string> = { enter: "Made private", transfer: "Sent privately", exit: "Made transparent", private_register: "Private account published", received: "Private payment received" };
  const quiet = kind === "enter" && !to;
  const incoming = kind === "received";
  return (
    <li className="activity__row" data-on-way={stage ? "true" : undefined}>
      <span className={quiet ? "activity__icon" : incoming ? "activity__icon activity__icon--in" : "activity__icon activity__icon--out"}>
        {quiet ? <MergeIcon /> : incoming ? <ReceiveIcon /> : <SendIcon />}
      </span>
      <div className="activity__main">
        <p className="activity__title">
          {titles[kind] ?? kind}
          {!stage && <span className="seal">Finalized</span>}
        </p>
        <p className="activity__meta">
          <span>{dateTime(time)}</span>
          {to && <span>to {shortAddress(to)}</span>}
        </p>
      </div>
      <div className="activity__side">
        <span className={`activity__amount ${quiet ? "neutral" : incoming ? "plus" : "minus"}`}>
          {quiet ? "" : incoming ? "+" : "−"}
          {trai(atoms)}
        </span>
        {stage && <Badge tone="wait">{stage}</Badge>}
        {reason && <span className="note">{reason}</span>}
        {retry && <button type="button" className="link" onClick={retry}>Retry original payment</button>}
      </div>
    </li>
  );
}

function PrivateReceive({ onClose }: { onClose: () => void }) {
  const { address } = usePrivate();
  return (
    <Dialog title="Your private address" onClose={onClose}>
      {address && (
        <>
          <QrCode text={address} label="Your private address" />
          <div className="address-line">
            <code className="address-box">{address}</code>
            <CopyIconButton text={address} label="Copy private address" />
          </div>
          <VerificationWords address={address} />
          <p className="note">Give this address to whoever sends you private TRAI. It is not your transparent address, and coins sent to it the ordinary way do not become private.</p>
        </>
      )}
    </Dialog>
  );
}

function Recipient({ value, onChange, label, optional = false }: { value: string; onChange: (value: string) => void; label: string; optional?: boolean }) {
  const { network } = useSession();
  const check = useAddressCheck(value, network);
  return (
    <>
      <Field label={label}>
        <input type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={256} required={!optional} value={value} onChange={(event) => onChange(event.target.value)} />
      </Field>
      <AddressCheck state={check} network={network} />
      {check === "valid" && <VerificationWords address={value.trim()} />}
    </>
  );
}

function PrivateNotePages(){
  const state=usePrivate();const result=state.result;
  if(!result||result.noteCount<=128n)return null;
  return <div className="actions">
    <button type="button" disabled={state.checking} onClick={()=>void state.page()}>First notes</button>
    <button type="button" disabled={state.checking||result.nextNote===null} onClick={()=>void state.page(result.nextNote??undefined)}>Next notes</button>
  </div>;
}

function PrivateDialog({ way, preset, onWay, onClose }: { way: Way; preset: { to: string; amount: string } | null; onWay: (way: Way) => void; onClose: () => void }) {
  const { asks, data, wallet } = useSession();
  const state = usePrivate();
  const notify = useToast();
  const [to, setTo] = useState(preset?.to ?? "");
  const [amount, setAmount] = useState(preset?.amount ?? "");
  const [chosen, setChosen] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [review, setReview] = useState<{ rows: [string, string][]; atoms: bigint; memory: string; kind: ProofKind; run: () => Promise<void> }>();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const fee = BigInt(state.status?.fees.transfer_fee ?? "0");
  const minimum = BigInt(state.status?.fees.minimum_note_value ?? "0");
  const values = state.freeNotes.map((note) => note.valueAtoms).sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  const most = values.length >= 2 ? (values[0] as bigint) + (values[1] as bigint) - fee - minimum : 0n;
  const exitTotal = state.freeNotes.filter((note) => chosen.includes(note.note)).reduce((sum, note) => sum + note.valueAtoms, 0n);

  const switchTo = (next: Way) => {
    setError("");
    setTo("");
    setAmount("");
    setChosen([]);
    onWay(next);
  };

  const prepare = async () => {
    setError("");
    setBusy(true);
    try {
      if (way === "exit") {
        if (chosen.length < 1 || chosen.length > 2) throw new Error("Choose one or two notes.");
        if (exitTotal <= fee) throw new Error("These notes hold no more than the fee.");
        const address = to.trim();
        setReview({
          rows: [["Type", "Make transparent"], ["To", address], ["Amount", trai(exitTotal - fee)], ["Fee", trai(fee)], ["Total", trai(exitTotal)]],
          atoms: exitTotal,
          memory: "1.5",
          kind: "exit",
          run: () => state.exit(address, chosen),
        });
        return;
      }
      const atoms = atomsOf(amount);
      if (atoms <= 0n) throw new Error("Enter an amount above zero.");
      const address = to.trim();
      if (address && !(await state.isRecipient(address))) {
        throw new Error("This address has no private account yet; its owner must publish it first.");
      }
      const toRow: [string, string] = ["To", address || "this wallet"];
      setReview({
        rows: [["Type", way === "send" ? "Send privately" : "Make private"], toRow, ["Amount", trai(atoms)], ["Fee", trai(fee)], ["Total", trai(atoms + fee)]],
        atoms: atoms + fee,
        memory: "3.5",
        kind: "large",
        run: way === "send" ? () => state.transfer(atoms, address) : () => state.enter(atoms, address || undefined),
      });
    } catch (failure) {
      setError(problemText(failure));
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!review) return;
    setError("");
    try {
      if (asks(review.atoms)) {
        await checkPassword(password);
        setPassword("");
      }
    } catch (failure) {
      setError(problemText(failure));
      return;
    }
    // The Private tab owns proof progress and errors.
    const run = review.run;
    onClose();
    await run().catch((failure: unknown) => notify(problemText(failure)));
  };

  if (review) {
    return (
      <Dialog title="Review" onClose={onClose}>
        <p className="note">
          The proof is made on this device and takes about {estimateText(state.estimate(review.kind))}; it needs up to {review.memory} GiB of free memory.
          You can cancel it until it is done.
        </p>
        <Facts rows={review.rows} />
        {asks(review.atoms) && <PasswordField value={password} onChange={setPassword} onEnter={() => void approve()} />}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions actions--end">
          <button type="button" className="btn btn--ghost" onClick={() => setReview(undefined)}>
            Back
          </button>
          <button type="button" className="btn btn--solid" onClick={() => void approve()} disabled={asks(review.atoms) && !password}>
            Make the proof and send
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Private transfers" onClose={onClose}>
      <div className="segment segment--three" role="tablist" aria-label="Private actions">
        {WAYS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={way === id} onClick={() => switchTo(id)}>
            {label}
          </button>
        ))}
      </div>
      <form
        className="stack-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void prepare();
        }}
      >
        {way === "send" && (
          <>
            <p className="note">Sends from two private notes to a private address; the rest comes back as a new note.</p>
            <Recipient value={to} onChange={setTo} label="Private address of the recipient" />
            <Field label="Amount (TRAI)">
              <input type="text" inputMode="decimal" autoComplete="off" maxLength={48} required value={amount} onChange={(event) => setAmount(event.target.value)} />
            </Field>
            <p className="note">
              {values.length < 2
                ? "A private send spends two notes and this wallet has fewer free. Make a small amount private to add notes, or wait for a private transaction on its way."
                : (state.result && state.result.noteCount>128n ? "The wallet selects two notes from the complete local inventory." : `Two of your notes allow up to ${trai(most > 0n ? most : 0n)}.`)}
            </p>
          </>
        )}
        {way === "enter" && (
          <>
            <p className="note">Moves transparent coins into private notes. What the coins hold beyond the amount and the fee becomes a note of this wallet.</p>
            <Field label="Amount (TRAI)">
              <input type="text" inputMode="decimal" autoComplete="off" maxLength={48} required value={amount} onChange={(event) => setAmount(event.target.value)} />
            </Field>
            <p className="note">Available: {data ? trai(data.balance.atoms) : "…"}</p>
            <Recipient value={to} onChange={setTo} label="Private address (empty: this wallet)" optional />
          </>
        )}
        {way === "exit" && (
          <>
            <p className="note">Pays one or two whole notes out to a transparent address, less the fee.</p>
            {state.freeNotes.length === 0 && <p className="note">This wallet holds no free note.</p>}
            <PrivateNotePages /><div className="private-notes">
              {state.freeNotes.map((note) => (
                <label key={note.note} className="check">
                  <input
                    type="checkbox"
                    checked={chosen.includes(note.note)}
                    disabled={chosen.length >= 2 && !chosen.includes(note.note)}
                    onChange={(event) => setChosen((list) => (event.target.checked ? [...list, note.note] : list.filter((entry) => entry !== note.note)))}
                  />
                  <span>
                    Note {count(note.note)}: {trai(note.valueAtoms)}
                  </span>
                </label>
              ))}
            </div>
            <Recipient value={to} onChange={setTo} label="Transparent address" />
            <button type="button" className="btn btn--ghost" onClick={() => setTo(wallet.address(0))}>
              Use this wallet's address
            </button>
            {chosen.length > 0 && exitTotal > fee && <p className="note">The address receives {trai(exitTotal - fee)}.</p>}
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <p className="note">
          Fee per private transaction: {trai(fee)}. Takes about {estimateText(state.estimate(way === "exit" ? "exit" : "large"))} on this device.
        </p>
        <button type="submit" className="btn btn--solid btn--wide" disabled={busy || (way === "send" && values.length < 2)}>
          Review and sign
        </button>
      </form>
    </Dialog>
  );
}
