import { TenraiApiError, formatTrai, isBurnAddress } from "@tenrai/sdk";
import {
  type MergeSummary,
  type Payment,
  type PreparedTransfer,
  type SendRequest,
  TenraiWalletError,
  encodeRecipientPayloads,
  parsePaymentRequest,
} from "@tenrai/sdk/wallet";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import { hexOf } from "../bytes.ts";
import { PasswordField } from "../components/confirm.tsx";
import { Dialog } from "../components/dialog.tsx";
import { Facts } from "../components/facts.tsx";
import { AUTO_FEE, AddressCheck, Field, FeeField, type FeeChoice, atomsOf, feeOptions, useAddressCheck } from "../components/fields.tsx";
import { Hint } from "../components/hint.tsx";
import { CloseIcon, ScanIcon } from "../components/icons.tsx";
import { ScanDialog } from "../components/scanner.tsx";
import { useToast } from "../components/toast.tsx";
import { Amount } from "../components/values.tsx";
import { wordsOf } from "../components/words.tsx";
import { count } from "../format.ts";
import { DEFAULT_PAYLOAD_LIMIT, type PayloadFormat, payloadInput, recipientPayloadsInput } from "../payload.ts";
import { problem } from "../problem.ts";
import { readyToSend } from "../sync.ts";
import { tenrai } from "../tenrai.ts";
import { usePrivate } from "./privateState.tsx";
import { checkPassword } from "../vault.ts";
import { useSession } from "./session.tsx";

interface Extra {
  to: string;
  amount: string;
  payload: string;
}

const NO_RECIPIENT: Extra = { to: "", amount: "", payload: "" };

/** Show the signed amount and fee before submission. */
export function SendDialog({ onClose }: { onClose: () => void }) {
  const { wallet, network, track, salvage, asks } = useSession();
  const notify = useToast();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const privately = usePrivate();
  const [firstPayload, setFirstPayload] = useState("");
  const [extra, setExtra] = useState<Extra[]>([]);
  const [fee, setFee] = useState<FeeChoice>(AUTO_FEE);
  const [withPayload, setWithPayload] = useState(false);
  const [payloadFormat, setPayloadFormat] = useState<PayloadFormat>("text");
  const [payloadValue, setPayloadValue] = useState("");
  const [limit, setLimit] = useState(DEFAULT_PAYLOAD_LIMIT);
  const [maxRecipients, setMaxRecipients] = useState(7);
  const [prepared, setPrepared] = useState<PreparedTransfer>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [scanning, setScanning] = useState(false);
  const [password, setPassword] = useState("");
  const [asking, setAsking] = useState<{ merge: MergeSummary; answer: (yes: boolean) => void }>();
  const [merging, setMerging] = useState(false);
  const check = useAddressCheck(to, network);
  // Keep draft payloads when the checkbox is off.
  const payload = payloadInput(payloadFormat, withPayload ? payloadValue : "", limit);
  const many = extra.length > 0;
  const burn = check === "valid" && isBurnAddress(to.trim());
  const label = burn && !many ? "Burn" : "Sent";
  // Recipient `i` becomes output `i`.
  const texts = many && withPayload ? [firstPayload.trim(), ...extra.map((row) => row.payload.trim())] : [];
  const own = recipientPayloadsInput(texts, limit);
  const both = own.count > 0 && payload.size > 0;
  const payloadId = useId();
  const needsPassword = prepared !== undefined && asks(prepared.amount);

  useEffect(() => {
    let current = true;
    tenrai.transactions.manifest().then(
      (manifest) => {
        if (current) {
          setLimit(manifest.max_transparent_payload_bytes);
          setMaxRecipients(Math.max(1, manifest.transaction_limits.max_outputs - 1));
        }
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);

  const take = async (text: string) => {
    try {
      const request = await parsePaymentRequest(text, network);
      setTo(request.address);
      if (request.amount !== null) {
        setAmount(formatTrai(request.amount, { fixed: true }));
      }
      if (request.payload !== null) {
        setWithPayload(true);
        if (many) {
          setFirstPayload(request.payload);
        } else {
          setPayloadFormat("text");
          setPayloadValue(request.payload);
        }
      }
      return true;
    } catch {
      return false;
    }
  };

  const fillMax = async () => {
    setError(undefined);
    try {
      const most = await wallet.maxSendable(tenrai, {
        ...(check === "valid" ? { to: to.trim() } : {}),
        ...(payload.payload === undefined ? {} : { payload: payload.payload }),
        ...feeOptions(fee),
      });
      if (most === 0n) {
        throw new Error("the spendable coins do not cover a fee");
      }
      setAmount(formatTrai(most, { fixed: true }));
    } catch (failure) {
      setError(problem(failure));
    }
  };

  const recipients = () => [
    { to: to.trim(), amount: atomsOf(amount), text: withPayload && many ? firstPayload.trim() : "" },
    ...extra.map((row, index) => {
      if (!row.to.trim()) {
        throw new Error(`enter the address of recipient ${index + 2}`);
      }
      return { to: row.to.trim(), amount: atomsOf(row.amount), text: withPayload ? row.payload.trim() : "" };
    }),
  ];

  const review = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (check !== "valid") {
        throw new Error(`enter a ${network} address to send to`);
      }
      const problemText = payload.problem ?? own.problem ?? (both ? "Give each recipient its own payload or one payload for all, not both." : undefined);
      if (problemText) {
        throw new Error(problemText);
      }
      const general = payload.payload === undefined ? {} : { payload: payload.payload };
      const fees = feeOptions(fee);
      const payments: Payment[] = recipients().map(({ to: address, amount: atoms, text }) =>
        text ? { to: address, amount: atoms, payload: text } : { to: address, amount: atoms },
      );
      const request: SendRequest = many ? { payments, ...general, ...fees } : { to: to.trim(), amount: atomsOf(amount), ...general, ...fees };
      try {
        setPrepared(await wallet.prepare(tenrai, request));
      } catch (failure) {
        if (!(failure instanceof TenraiWalletError && failure.code === "compound-needed")) {
          throw failure;
        }
        if (await mergeFirst(request)) {
          setPrepared(await wallet.prepare(tenrai, request));
        }
      }
    } catch (failure) {
      setError(problem(failure));
    } finally {
      setAsking(undefined);
      setMerging(false);
      setBusy(false);
    }
  };

  // Ask for approval to merge inputs if the transfer exceeds the input limit.
  const mergeFirst = async (request: SendRequest) => {
    let asked = false;
    let agreed = false;
    const atoms = (transfer: PreparedTransfer) => -transfer.fee;
    try {
      await readyToSend(notify);
      const merged = await wallet.mergeFor(tenrai, request, {
        confirm: (merge) =>
          new Promise<boolean>((resolve) => {
            asked = true;
            setAsking({
              merge,
              answer: (yes) => {
                agreed = yes;
                setAsking(undefined);
                setMerging(yes);
                resolve(yes);
              },
            });
          }),
      });
      if (merged.length > 0) {
        track("Compound", merged, atoms);
      }
      return !asked || agreed;
    } catch (failure) {
      salvage("Compound", failure, atoms);
      throw failure;
    }
  };

  const send = async () => {
    if (!prepared || busy || (needsPassword && !password)) {
      return;
    }
    setBusy(true);
    setError(undefined);
    if (needsPassword) {
      try {
        await checkPassword(password);
        setPassword("");
      } catch (failure) {
        setError(problem(failure));
        setBusy(false);
        return;
      }
    }
    const list = recipients();
    const leaving = list.reduce((sum, entry) => (wallet.owns(entry.to) ? sum : sum + entry.amount), 0n);
    const atoms = (transfer: PreparedTransfer) => -(leaving + transfer.fee);
    const entries = list.flatMap((entry, output) => (entry.text ? [{ output, payload: new TextEncoder().encode(entry.text) }] : []));
    const sentPayload = entries.length > 0 ? hexOf(encodeRecipientPayloads(entries)) : payload.hex || undefined;
    const outputs = list.map((entry) => entry.to);
    try {
      await readyToSend(notify);
      const sent = await wallet.submit(tenrai, prepared);
      track(label, [sent], atoms, sentPayload, outputs);
      notify(`${label === "Burn" ? "Burned" : "Sent"}. It is final once a cut executes it.`);
      onClose();
    } catch (failure) {
      // Track an ambiguous submission while the SDK retries the signed transaction.
      if (salvage(label, failure, atoms, sentPayload, outputs)) {
        notify(problem(failure));
        onClose();
        return;
      }
      const refusedBusy = failure instanceof TenraiApiError && (failure.code === "unavailable" || failure.code === "rate_limited");
      setError(refusedBusy ? "The node is busy and did not take the transfer. Press Send again in a moment; the same signed transfer goes out." : problem(failure));
      setBusy(false);
    }
  };

  const reviewRows = (): [string, ReactNode][] => {
    if (!prepared) {
      return [];
    }
    const rows: [string, ReactNode][] = [["Type", label === "Burn" ? "Burn" : "Payment"]];
    if (many) {
      recipients().forEach((entry, index) => {
        rows.push([`To ${index + 1}`, <span className="mono">{entry.to}</span>], ["Recipient fingerprint", wordsOf(entry.to) ?? "-"], [`Amount ${index + 1}`, <Amount atoms={entry.amount} />]);
        if (entry.text) {
          rows.push([`Payload ${index + 1}`, entry.text]);
        }
      });
    } else if (burn) {
      rows.push(["To", <span className="mono">{`${to.trim()} (burn address)`}</span>], ["Amount", <Amount atoms={prepared.amount} />]);
    } else {
      rows.push(["To", <span className="mono">{to.trim()}</span>], ["Recipient fingerprint", wordsOf(to.trim()) ?? "-"], ["Amount", <Amount atoms={prepared.amount} />]);
    }
    rows.push(["Fee", <Amount atoms={prepared.fee} />], ["Total", <Amount atoms={prepared.amount + prepared.fee} />]);
    if (payload.size > 0) {
      rows.push([many ? "Payload for all" : "Payload", payloadFormat === "text" ? payloadValue : `hex, ${count(payload.size)} bytes`]);
    }
    rows.push(["Transaction ID", <span className="mono">{prepared.transactionId}</span>]);
    return rows;
  };

  const editRow = (index: number, change: Partial<Extra>) =>
    setExtra((rows) => rows.map((row, position) => (position === index ? { ...row, ...change } : row)));

  const removeRow = (index: number) => {
    setExtra((rows) => rows.filter((_, position) => position !== index));
    if (extra.length === 1) {
      setFirstPayload("");
    }
  };

  if (asking) {
    return (
      <Dialog title="Send TRAI" onClose={() => asking.answer(false)}>
        <Facts
          rows={[
            ["Type", "Compound"],
            ["Outputs", count(asking.merge.outputs)],
            ["Transactions", count(asking.merge.transfers)],
            ["Fee", <Amount atoms={asking.merge.fee} />],
          ]}
        />
        <p className="note">
          The amount is spread over more outputs than one transfer can spend. A compound merges them first, each address into
          outputs of its own; then the payment is shown for approval.
        </p>
        <div className="actions actions--end">
          <button type="button" className="btn btn--ghost" onClick={() => asking.answer(false)}>
            Back
          </button>
          <button type="button" className="btn btn--solid" onClick={() => asking.answer(true)}>
            Compound and send
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Send TRAI" onClose={onClose}>
      {privately.enabled && privately.available && !prepared && (
        <div className="segment" role="tablist" aria-label="Send from">
          <button type="button" role="tab" aria-selected>
            Transparent
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={false}
            onClick={() => {
              onClose();
              privately.open({ to, amount });
            }}
          >
            Private
          </button>
        </div>
      )}
      {prepared ? (
        <>
          <Facts rows={reviewRows()} />
          {needsPassword && <PasswordField value={password} onChange={setPassword} onEnter={() => void send()} />}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="actions actions--end">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setPrepared(undefined);
                setPassword("");
              }}
              disabled={busy}
            >
              Back
            </button>
            <button type="button" className="btn btn--solid" onClick={send} disabled={busy || (needsPassword && !password)}>
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </>
      ) : (
        <form className="stack-form" onSubmit={review} noValidate>
          <Field
            label={many ? "Recipient 1" : "Recipient"}
            hint={
              <>
                <AddressCheck state={check} network={network} burn={burn} />
                {check === "valid" && !burn && <span className="verify-words__line">Verification words: {wordsOf(to.trim())}</span>}
              </>
            }
          >
            <span className="with-button">
              <input
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  if (event.target.value.includes(":")) {
                    void take(event.target.value);
                  }
                }}
                data-tone={check === "valid" && !burn ? "ok" : check === "empty" ? undefined : "bad"}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={640}
                placeholder="Address or payment request"
                autoFocus
              />
              <button type="button" className="icon-btn" aria-label="Scan a QR code" title="Scan a QR code" onClick={() => setScanning(true)}>
                <ScanIcon />
              </button>
            </span>
          </Field>
          <Field label="Amount (TRAI)">
            <span className="with-button">
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
                maxLength={40}
                placeholder="0.00000000"
              />
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => void fillMax()}
                disabled={busy || many}
                title={many ? "Max sends to one recipient" : undefined}
              >
                Max
              </button>
            </span>
          </Field>
          {many && withPayload && (
            <Field label="Payload for this recipient (optional)">
              <input value={firstPayload} onChange={(event) => setFirstPayload(event.target.value)} autoComplete="off" spellCheck={false} maxLength={limit} />
            </Field>
          )}
          {extra.map((row, index) => (
            <div className="recipient-extra" role="group" aria-label={`Recipient ${index + 2}`} key={index}>
              <div className="field__k field__k--split">
                <span>Recipient {index + 2}</span>
                <button type="button" className="icon-btn icon-btn--small" aria-label={`Remove recipient ${index + 2}`} onClick={() => removeRow(index)}>
                  <CloseIcon />
                </button>
              </div>
              <input
                value={row.to}
                onChange={(event) => editRow(index, { to: event.target.value })}
                aria-label={`Address of recipient ${index + 2}`}
                placeholder="Address"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={320}
              />
              <input
                value={row.amount}
                onChange={(event) => editRow(index, { amount: event.target.value })}
                aria-label={`Amount for recipient ${index + 2}`}
                placeholder="Amount (TRAI)"
                inputMode="decimal"
                autoComplete="off"
                maxLength={40}
              />
              {withPayload && (
                <input
                  value={row.payload}
                  onChange={(event) => editRow(index, { payload: event.target.value })}
                  aria-label={`Payload for recipient ${index + 2}`}
                  placeholder="Payload for this recipient (optional)"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={limit}
                />
              )}
            </div>
          ))}
          <div className="recipient-tools">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setExtra((rows) => [...rows, { ...NO_RECIPIENT }])}
              disabled={1 + extra.length >= maxRecipients}
            >
              Add recipient
            </button>
            {many && (own.problem || both || own.count > 0) && (
              <span className="live-check" data-tone={own.problem || both ? "bad" : undefined} role="status">
                {own.problem ?? (both ? "Give each recipient its own payload or one payload for all, not both." : `${count(own.size)} of ${count(limit)} bytes.`)}
              </span>
            )}
          </div>
          <div className="hint-line">
            <label className="check">
              <input type="checkbox" checked={withPayload} onChange={(event) => setWithPayload(event.target.checked)} />
              <span>Add a message (payload)</span>
            </label>
            <Hint label="About the message">{`Sent with the payment, for example an invoice number. Up to ${count(limit)} bytes, readable by anyone on chain.`}</Hint>
          </div>
          {withPayload && (
            <div className="field">
              <span className="field__k field__k--split">
                <label htmlFor={payloadId}>{many ? "Payload for all recipients (optional)" : "Payload"}</label>
                <select
                  className="payload-format"
                  aria-label="Payload format"
                  value={payloadFormat}
                  onChange={(event) => setPayloadFormat(event.target.value as PayloadFormat)}
                >
                  <option value="text">Text</option>
                  <option value="hex">Hex</option>
                </select>
              </span>
              <textarea
                id={payloadId}
                value={payloadValue}
                onChange={(event) => setPayloadValue(event.target.value)}
                rows={2}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={limit * 2}
              />
              {(payload.problem || payload.size > 0) && (
                <span className="live-check" data-tone={payload.problem ? "bad" : undefined} role="status">
                  {payload.problem ?? `${count(payload.size)} of ${count(limit)} bytes.`}
                </span>
              )}
            </div>
          )}
          <FeeField value={fee} onChange={setFee} />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn--solid btn--wide" type="submit" disabled={busy}>
            {merging ? "Compounding…" : busy ? "Signing…" : "Review"}
          </button>
        </form>
      )}
      {scanning && (
        <ScanDialog
          onText={async (text) => {
            const taken = await take(text);
            if (taken) {
              setScanning(false);
            }
            return taken;
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </Dialog>
  );
}
