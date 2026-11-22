import {UnknownOutcomes} from "./UnknownOutcomes.tsx";
import { tenrai } from "../tenrai.ts";
import { problem as problemText } from "../problem.ts";
import { useToast } from "../components/toast.tsx";
import { isBurnAddress } from "@tenrai/sdk";
import { isMessengerPayload } from "@tenrai/sdk/wallet";
import { Fragment, type ReactNode, useEffect, useState,useCallback } from "react";
import { MergeIcon, ReceiveIcon, SendIcon } from "../components/icons.tsx";
import { Payloads } from "../components/payload.tsx";
import { Amount, Badge, Stage, TxId } from "../components/values.tsx";
import { addressUrl, cutUrl } from "../explorer.ts";
import { count, dateTime, plural, shortAddress, trai, traiBrief } from "../format.ts";
import type { Parties } from "./history.ts";
import { MultisigDialog } from "./MultisigDialog.tsx";
import { NativeLocksDialog } from "./NativeLocksDialog.tsx";
import { usePrivate } from "./privateState.tsx";
import { ReceiveDialog } from "./ReceiveDialog.tsx";
import { useMessenger } from "./messengerState.tsx";
import { SendDialog } from "./SendDialog.tsx";
import { addressName } from "./scan.ts";
import { type ActivityEntry, type Arriving, type Sent, stillSending, useSession } from "./session.tsx";

const KIND_TITLES: Record<string, string> = {
  bond: "Stake",
  unbond: "Unstake",
  exit: "Unstake",
  withdraw: "Withdraw",
  register: "Validator registration",
  heartbeat: "Validator heartbeat",
  commission: "Validator commission change",
  endpoint: "Validator endpoint change",
  private_enter: "Made private",
};
// Outputs of a stake operation are only its change; older rows say "Unbond".
const STAKE_LABELS = new Set(["Stake", "Unstake", "Unbond", "Withdraw"]);

const PAGE_ROWS = 10;

export function Home() {
  const { data, error, sent, arriving: all, dismiss, history,wallet } = useSession();
  const outcomePage=useCallback((after?:string,limit=10)=>wallet.unknownPublicOutcomes({...(after===undefined?{}:{after}),limit}),[wallet]);
  const outcomeRead=useCallback((id:string)=>wallet.unknownPublicOutcome(id),[wallet]);
  const [dialog, setDialog] = useState<"send" | "receive" | "multisig" | "native-locks">();
  const privately = usePrivate();

  const own = new Set(sent.map((entry) => entry.transactionId));
  const arriving = all.filter((entry) => !own.has(entry.payment.transaction_id));
  const incoming = arriving.flatMap((entry) => entry.payment.outputs).reduce((sum, output) => sum + BigInt(output.amount), 0n);
  const height = data?.balance.indexedHeight;
  const outgoing = sent
    .filter(
      (entry) =>
        entry.status?.lifecycle !== "finalized" &&
        entry.status?.lifecycle !== "failed" &&
        (!entry.unknown || stillSending(entry, height)) &&
        entry.atoms < 0n,
    )
    .reduce((sum, entry) => sum - entry.atoms, 0n);
  const positions = data?.positions ?? [];
  const bonded = positions.filter((position) => position.state === "bonded");
  const staked = bonded.reduce((sum, position) => sum + BigInt(position.principal), 0n);
  const leaving = positions.reduce((sum, position) => sum + BigInt(position.principal), 0n) - staked;

  return (
    <div className="home">
      <article className="hero">
        <p className="eyebrow">Balance</p>
        <p className="hero__amount">{data ? trai(data.balance.atoms) : "…"}</p>
        {privately.enabled && privately.available && (
          <p className="hero__sub">
            <button type="button" className="link" onClick={() => privately.open()}>
              Private balance: {privately.result ? trai(privately.result.balanceAtoms) : "…"}
            </button>
          </p>
        )}
        <p className="hero__sub">{data ? `Final up to cut ${count(data.balance.indexedHeight)}` : "Reading the chain…"}</p>
        <div className="hero__stats">
          <Stat label="Incoming" atoms={incoming} note="" />
          <Stat label="Outgoing" atoms={outgoing} note="sent, not final yet" />
          <Stat label="Staked" atoms={staked} note={leaving > 0n ? `${traiBrief(leaving)} unbonding` : plural(bonded.length, "position")} />
        </div>
        <div className="hero__actions">
          <button type="button" className="btn btn--solid" onClick={() => setDialog("send")} disabled={!data}>
            <SendIcon />
            Send
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setDialog("receive")}>
            <ReceiveIcon />
            Receive
          </button>
{history.nativeLocks && (
            <button type="button" className="btn btn--ghost" onClick={() => setDialog("native-locks")} disabled={!data}>Native locks</button>
          )}
          {history.multisig && (
            <button type="button" className="btn btn--ghost" onClick={() => setDialog("multisig")} disabled={!data}>
              Multisig
            </button>
          )}
        </div>
      </article>

      <section className="block" aria-labelledby="activity-title">
        <h2 id="activity-title" className="block__title">
          Activity
        </h2>
        {error && <p className="form-error">{error}</p>}
        <UnknownOutcomes page={outcomePage} read={outcomeRead}/>
        <Activity sent={sent} arriving={arriving} activity={data?.activity} heldFrom={data?.heldFrom ?? 0} height={height} onDismiss={dismiss} />
      </section>

      {dialog === "send" && <SendDialog onClose={() => setDialog(undefined)} />}
      {dialog === "receive" && <ReceiveDialog onClose={() => setDialog(undefined)} />}
      {dialog === "multisig" && <MultisigDialog onClose={() => setDialog(undefined)} />}
      {dialog === "native-locks" && <NativeLocksDialog onClose={() => setDialog(undefined)} />}
    </div>
  );
}

function merges(label: string | undefined, internal: boolean): boolean {
  return label === "Compound" || label === "Automatic compound" || (label === "Sweep" && internal);
}

function unstakes(label: string | undefined, kind: string | null): boolean {
  return label === "Unstake" || label === "Unbond" || (!label && (kind === "unbond" || kind === "exit"));
}

function title(label: string): string {
  return label === "Unbond" ? "Unstake" : label;
}

function Direction({ atoms, merge, quiet = false }: { atoms: bigint; merge: boolean; quiet?: boolean }) {
  if (merge) {
    return (
      <span className="activity__icon">
        <MergeIcon />
      </span>
    );
  }
  if (quiet) {
    return (
      <span className="activity__icon">
        <SendIcon />
      </span>
    );
  }
  return atoms >= 0n ? (
    <span className="activity__icon activity__icon--in">
      <ReceiveIcon />
    </span>
  ) : (
    <span className="activity__icon activity__icon--out">
      <SendIcon />
    </span>
  );
}

function tone(atoms: bigint, merge: boolean): string {
  return merge ? "activity__amount neutral" : atoms >= 0n ? "activity__amount plus" : "activity__amount minus";
}

function Stat({ label, atoms, note }: { label: string; atoms: bigint; note: string }) {
  return (
    <div>
      <p className="stat__k">{label}</p>
      <p className="stat__v">{traiBrief(atoms)}</p>
      <p className="stat__s">{note}</p>
    </div>
  );
}

function Activity({
  sent,
  arriving,
  activity,
  heldFrom,
  height,
  onDismiss,
}: {
  sent: Sent[];
  arriving: Arriving[];
  activity?: ActivityEntry[];
  heldFrom: number;
  height?: number;
  onDismiss: (id: string) => void;
}) {
  if (!activity) {
    return <p className="empty">Reading the activity…</p>;
  }
  const final = new Set(activity.map((entry) => entry.transactionId));
  const waiting = sent.filter((entry) => entry.needsReview || !final.has(entry.transactionId));
  const coming = arriving.filter((entry) => !final.has(entry.payment.transaction_id));
  const rows = [
    ...coming.map((entry) => ({ key: entry.payment.transaction_id, row: <IncomingRow entry={entry} /> })),
    ...waiting.map((entry) => ({ key: `pending-${entry.transactionId}`, row: <SentRow entry={entry} height={height} onDismiss={onDismiss} /> })),
    ...activity.map((entry, index) => ({ key: entry.transactionId ?? `output-${index}`, id: entry.transactionId, row: <ActivityRow entry={entry} /> })),
  ];
  return <Pages rows={rows} heldFrom={heldFrom} />;
}

function Pages({ rows, heldFrom }: { rows: { key: string; id?: string | null; row: ReactNode }[]; heldFrom: number }) {
  const { show } = useSession();
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_ROWS));
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * PAGE_ROWS, (current + 1) * PAGE_ROWS);
  const ids = shown.flatMap((entry) => (entry.id ? [entry.id] : []));
  const key = ids.join();
  useEffect(() => show(key ? key.split(",") : []), [key, show]);
  const coverage = heldFrom > 0 ? `Older activity may exist: this node holds it from cut ${count(heldFrom)} on.` : null;
  if (rows.length === 0) {
    return <p className="empty">{coverage ?? "Nothing yet. Receive TRAI and it shows up here."}</p>;
  }
  return (
    <>
      <ul className="activity">
        {shown.map((entry) => (
          <Fragment key={entry.key}>{entry.row}</Fragment>
        ))}
      </ul>
      {pages > 1 && (
        <nav className="pager" aria-label="Activity pages">
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setPage(0)} disabled={current === 0}>
            Newest
          </button>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setPage(current - 1)} disabled={current === 0}>
            Newer
          </button>
          <span className="pager__page">{`Page ${current + 1} of ${pages}`}</span>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setPage(current + 1)} disabled={current >= pages - 1}>
            Older
          </button>
        </nav>
      )}
      {coverage && <p className="empty">{coverage}</p>}
    </>
  );
}

/** Stake outputs represent change. */
function paying(parties: Parties | undefined, label: string | undefined): boolean {
  const kind = parties?.kind;
  return (!kind || kind === "payment") && !STAKE_LABELS.has(label ?? "");
}

function selfTransfer(entry: ActivityEntry, owns: (address: string) => boolean): boolean {
  const parties = entry.parties;
  return Boolean(parties?.to.length) && paying(parties, entry.label) && [...(parties?.from ?? []), ...(parties?.to ?? [])].every(owns);
}

function burned(entry: ActivityEntry, owns: (address: string) => boolean): boolean {
  const away = entry.parties?.to.filter((address) => !owns(address)) ?? [];
  return away.length === 1 && away.every((address) => isBurnAddress(address));
}

function PartyLine({ parties, label, incoming }: { parties?: Parties; label?: string; incoming: boolean }) {
  const { wallet } = useSession();
  if (!parties) {
    return null;
  }
  if (parties.kind === "bond" && parties.validator) {
    return (
      <p className="activity__party">
        <span className="activity__party-k">To</span>
        <span className="activity__party-name">Validator</span>
        <span className="mono" title={parties.validator}>{`${parties.validator.slice(0, 8)}…${parties.validator.slice(-8)}`}</span>
      </p>
    );
  }
  const listed = incoming ? parties.from : parties.to;
  const others = listed.filter((address) => !wallet.owns(address));
  const shown = others.length || incoming || !paying(parties, label) ? others : listed;
  const first = shown[0];
  if (!first) {
    return null;
  }
  const path = wallet.pathOf(first);
  return (
    <p className="activity__party">
      <span className="activity__party-k">{incoming ? "From" : "To"}</span>
      <a className="txid__link" href={addressUrl(first)} target="_blank" rel="noopener noreferrer" title={first}>
        {shortAddress(first)}
      </a>
      {path && <span className="activity__party-name">{addressName(path.index, path.branch)}</span>}
      {!path && isBurnAddress(first) && <span className="activity__party-name">Burn address</span>}
      {shown.length > 1 && <span className="activity__party-more">{`+${shown.length - 1} more`}</span>}
    </p>
  );
}

function IncomingRow({ entry }: { entry: Arriving }) {
  const { payment, lifecycle } = entry;
  const atoms = payment.outputs.reduce((sum, output) => sum + BigInt(output.amount), 0n);
  return (
    <li className="activity__row">
      <span className="activity__icon activity__icon--in">
        <ReceiveIcon />
      </span>
      <div className="activity__main">
        <p className="activity__title">Incoming payment</p>
        <p className="activity__meta">
          <span>{dateTime(entry.firstSeen)}</span>
          <TxId id={payment.transaction_id} />
        </p>
      </div>
      <div className="activity__side">
        <span className="activity__amount plus">
          <Amount atoms={atoms} signed />
        </span>
        <Stage lifecycle={lifecycle} />
      </div>
    </li>
  );
}

function SentRow({ entry, height, onDismiss }: { entry: Sent; height?: number; onDismiss: (id: string) => void }) {
  const { wallet, refresh } = useSession();
  const notify = useToast();
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try { await wallet.retryPublic(tenrai, entry.transactionId); notify("The original signed transaction was retried."); }
    catch (failure) { notify(problemText(failure)); }
    finally { setRetrying(false); refresh(); }
  };
  const exportOriginal = () => {
    const original = wallet.openTransfers().find((item) => item.transactionId === entry.transactionId);
    if (!original) return;
    const bytes = new TextEncoder().encode(JSON.stringify({ ...original, validUntil: original.validUntil.toString() }));
    const url = URL.createObjectURL(new Blob([bytes.buffer], { type: "application/json" }));
    try { const link = document.createElement("a"); link.href = url; link.download = `tenrai-transaction-${entry.transactionId.slice(0, 16)}.json`; link.click(); }
    finally { URL.revokeObjectURL(url); }
  };
  const status = entry.status;
  const failed = status?.lifecycle === "failed";
  // The SDK retries the signed transfer through its last valid cut.
  const again = entry.unknown && stillSending(entry, height);
  const problem =
    entry.unknown && !again ? "unknown to the node" : failed ? `failed${status.failure ? `: ${status.failure.replace("_", " ")}` : ""}` : undefined;
  const merge = merges(entry.label, entry.internal);
  const quiet = unstakes(entry.label, null);
  const openChat = useChatLink(entry.transactionId);
  return (
    <li className="activity__row">
      <Direction atoms={entry.atoms} merge={merge} quiet={quiet} />
      <div className="activity__main">
        <p className="activity__title">{title(entry.label)}</p>
        <p className="activity__meta">
          <span>{dateTime(entry.sentAt)}</span>
          <TxId id={entry.transactionId} />
        </p>
        <PartyLine parties={entry.parties} label={entry.label} incoming={false} />
        {entry.payload && <Payloads hex={entry.payload} outputs={entry.payloadOutputs} onOpenChat={openChat} />}
      </div>
      <div className="activity__side">
        <span className={tone(entry.atoms, merge || quiet)}>
          {entry.amountUnknown ? "Amount pending verification" : <Amount atoms={entry.atoms} signed />}
        </span>
        {entry.needsReview ? <span className="activity__status"><Badge tone="wait">Needs verified reconciliation</Badge>
          {!entry.resendPaused && <button type="button" className="link" disabled={retrying} onClick={() => void retry()}>Retry original transaction</button>}
          <button type="button" className="link" onClick={exportOriginal}>Export original transaction</button></span> : problem ? (
          <span className="activity__status">
            <Badge tone="bad">{problem}</Badge>
            <button type="button" className="link" onClick={() => onDismiss(entry.transactionId)}>
              Hide
            </button>
          </span>
        ) : again ? (
          <Badge tone="wait">Sending again</Badge>
        ) : status ? (
          <Stage lifecycle={status.lifecycle} />
        ) : (
          <Badge tone="wait">Sending</Badge>
        )}
      </div>
    </li>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const { wallet } = useSession();
  const openChat = useChatLink(entry.transactionId);
  const net = entry.received - entry.spent;
  const kind = entry.parties?.kind ?? null;
  const incoming = net > 0n && !entry.label && (!kind || kind === "payment");
  // Show incoming payloads for this wallet's outputs only.
  const owns = incoming ? (address: string) => wallet.owns(address) : undefined;
  const reward = entry.spent === 0n ? rewardName(entry) : undefined;
  const internal = net <= 0n && selfTransfer(entry, (address) => wallet.owns(address));
  const merge = merges(entry.label, entry.received > 0n) || internal;
  const quiet = net <= 0n && unstakes(entry.label, kind);
  return (
    <li className="activity__row">
      <Direction atoms={net} merge={merge} quiet={quiet} />
      <div className="activity__main">
        <p className="activity__title">
          {(entry.label && title(entry.label)) ?? reward ?? (isMessengerPayload(entry.payload) ? "Messenger" : null) ?? KIND_TITLES[kind ?? ""] ?? (internal ? "Self transfer" : net >= 0n ? "Received" : burned(entry, (address) => wallet.owns(address)) ? "Burn" : "Sent")}
          <span className="seal">Finalized</span>
        </p>
        <p className="activity__meta">
          {entry.time !== null && <span>{dateTime(entry.time)}</span>}
          {reward ? (
            // Rewards link to a cut instead of a transaction.
            <a className="txid__link" href={cutUrl(entry.height)} target="_blank" rel="noopener noreferrer">
              Cut {count(entry.height)}
            </a>
          ) : (
            <>
              <span>Cut {count(entry.height)}</span>
              {entry.transactionId && <TxId id={entry.transactionId} />}
            </>
          )}
        </p>
        <PartyLine parties={entry.parties} label={entry.label} incoming={incoming} />
        {entry.payload && <Payloads hex={entry.payload} outputs={entry.payloadOutputs} owns={owns} onOpenChat={openChat} />}
      </div>
      <div className="activity__side">
        <span className={tone(net, merge || quiet)}>
          <Amount atoms={net} signed />
        </span>
      </div>
    </li>
  );
}

function useChatLink(transactionId: string | null): (() => void) | undefined {
  const messenger = useMessenger();
  return messenger.active && transactionId ? () => messenger.openChat(transactionId) : undefined;
}

function rewardName(entry: ActivityEntry): string | undefined {
  if (entry.sources.includes("stake_reward")) {
    return "Staking reward";
  }
  if (entry.sources.includes("private_exit")) {
    return "Received from private";
  }
  return entry.sources.includes("work_reward") ? "Mining reward" : undefined;
}
