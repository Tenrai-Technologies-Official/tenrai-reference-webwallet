import { parseTrai } from "@tenrai/sdk";
import type { PrivateRegistrationQuote } from "@tenrai/sdk/wallet";
import { useState } from "react";
import { Confirm } from "../components/confirm.tsx";
import { Field } from "../components/fields.tsx";
import { trai } from "../format.ts";
import { problem } from "../problem.ts";
import { usePrivate } from "./privateState.tsx";

/** Publishing pays a public fee; quotation never signs the sponsor inputs. */
export function PublishRegistration() {
  const state = usePrivate();
  const [cap, setCap] = useState("");
  const [quote, setQuote] = useState<PrivateRegistrationQuote>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const prepare = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const maximum = parseTrai(cap);
      if (maximum <= 0n) throw new Error("Enter a maximum fee above zero.");
      setQuote(await state.planRegistration(maximum));
    } catch (failure) { setError(problem(failure)); }
    finally { setBusy(false); }
  };
  return <>
    <Field label="Maximum registration fee (TRAI)" hint="Publishing spends public coins. Review the exact fee and change before signing.">
      <input inputMode="decimal" autoComplete="off" maxLength={48} value={cap} onChange={(event) => setCap(event.target.value)} disabled={busy} />
    </Field>
    <button type="button" className="btn btn--solid" disabled={busy || !cap.trim()} onClick={() => void prepare()}>Review registration</button>
    {error && <p className="form-error" role="alert">{error}</p>}
    {quote && <Confirm title="Publish private account" password action="Pay fee and publish" onClose={() => { state.cancelRegistration(quote); setQuote(undefined); }}
      facts={[["Owner", quote.owner], ["Fee", trai(quote.feeAtoms)], ["Maximum fee", trai(quote.maximumFeeAtoms)],
        ["Change", `${trai(quote.changeAtoms)} to ${quote.changeAddress}`],
        ...quote.inputs.map((input): [string, string] => ["Public input", `${input.transactionId}:${input.outputIndex} (${trai(input.amountAtoms)})`])]}
      note="The complete signed frame and its reserved public inputs are saved before submission. An uncertain response keeps them reserved for safe retry."
      onConfirm={() => state.register(quote)} />}
  </>;
}
