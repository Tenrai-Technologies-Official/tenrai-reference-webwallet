import {
  type AddressProofRequest,
  type AddressProofVerdict,
  createAddressProofRequest,
  readAddressProofRequest,
  verifyAddressProof,
} from "@tenrai/sdk";
import { type FormEvent, type ReactNode, useState } from "react";
import { Dialog } from "../components/dialog.tsx";
import { Facts } from "../components/facts.tsx";
import { AddressCheck, Field, useAddressCheck } from "../components/fields.tsx";
import { CopyButton, DownloadButton } from "../components/values.tsx";
import { wordsOf } from "../components/words.tsx";
import { problem } from "../problem.ts";
import { useSession } from "./session.tsx";

interface Question {
  title: string;
  facts: [string, ReactNode][];
  note: string;
  action: string;
  run: () => Promise<void>;
}

interface Shown {
  title: string;
  note: string;
  text: string;
  file: string;
}

const RESULTS: Record<AddressProofVerdict["result"], string> = {
  valid: "Valid: the owner of this address signed it",
  malformed: "Not a readable address proof",
  "wrong-request": "Not valid: it answers another request",
  "not-single-key": "Not valid: a multisig address cannot prove its owner this way",
  "key-mismatch": "Not valid: the key does not belong to the address",
  expired: "Not valid: the proof expired",
  "bad-signature": "Not valid: the signature does not verify",
};

function expiry(at: number): string {
  const minutes = Math.ceil((at - Date.now() / 1000) / 60);
  const when = new Date(at * 1000).toLocaleString();
  return minutes > 0 ? `${when}, in ${minutes} min` : `${when}, passed`;
}

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Sign a request for one of this wallet's addresses, ask others for a proof, and check theirs. */
export function Ownership({ ask }: { ask: (question: Question) => void }) {
  const { wallet, network } = useSession();
  const [pasted, setPasted] = useState("");
  const [target, setTarget] = useState("");
  const [proof, setProof] = useState("");
  const [request, setRequest] = useState("");
  const [verdict, setVerdict] = useState<AddressProofVerdict>();
  const [shown, setShown] = useState<Shown>();
  const [error, setError] = useState<{ card: string; text: string }>();
  const check = useAddressCheck(target, network);

  const prove = (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    let read: AddressProofRequest;
    try {
      read = readAddressProofRequest(pasted.trim());
      if (read.expires_at <= Date.now() / 1000) {
        throw new Error("the proof request expired; ask for a new one");
      }
    } catch (failure) {
      setError({ card: "prove", text: problem(failure) });
      return;
    }
    ask({
      title: "Prove ownership",
      facts: [
        ["Address", <span className="mono">{read.address}</span>],
        ["Verification words", wordsOf(read.address) ?? "-"],
        ["Expires", expiry(read.expires_at)],
        ["Challenge", <span className="mono">{read.challenge}</span>],
      ],
      note: "The wallet signs that it holds the key of this address. No coins move.",
      action: "Sign proof",
      run: async () => {
        const signed = await wallet.proveAddress(read);
        setPasted("");
        setShown({ title: "Address proof", note: "Send this proof back to whoever asked for it.", text: pretty(signed), file: "tenrai-address-proof.json" });
      },
    });
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    try {
      if (check !== "valid") {
        throw new Error(`enter a ${network} address`);
      }
      const text = pretty(createAddressProofRequest(target.trim()));
      setRequest(text);
      setShown({
        title: "Proof request",
        note: "Send this to the owner of the address; it can be answered for 10 minutes. Paste the proof under Check a proof once it comes back.",
        text,
        file: "tenrai-address-proof-request.json",
      });
    } catch (failure) {
      setError({ card: "ask", text: problem(failure) });
    }
  };

  const verify = (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    if (!proof.trim()) {
      setError({ card: "check", text: "paste the address proof first" });
      return;
    }
    setVerdict(verifyAddressProof(proof.trim(), request.trim() ? { request: request.trim() } : {}));
  };

  const failure = (card: string) =>
    error?.card === card && (
      <p className="form-error" role="alert">
        {error.text}
      </p>
    );

  return (
    <>
      <article className="card">
        <h3 className="card__title">Prove an address is yours</h3>
        <p className="note">Paste the proof request a service or person sent you. The wallet signs it with the key of that address; no coins move.</p>
        <form className="stack-form" onSubmit={prove} noValidate>
          <Field label="Proof request">
            <textarea value={pasted} onChange={(event) => setPasted(event.target.value)} rows={4} spellCheck={false} maxLength={32768} />
          </Field>
          {failure("prove")}
          <div className="actions">
            <button type="submit" className="btn btn--ghost">
              Review
            </button>
          </div>
        </form>
      </article>

      <article className="card">
        <h3 className="card__title">Check a proof</h3>
        <form className="stack-form" onSubmit={verify} noValidate>
          <Field label="Address proof">
            <textarea value={proof} onChange={(event) => setProof(event.target.value)} rows={4} spellCheck={false} maxLength={32768} />
          </Field>
          <Field label="Request it should answer, if you sent one">
            <textarea value={request} onChange={(event) => setRequest(event.target.value)} rows={3} spellCheck={false} maxLength={32768} />
          </Field>
          {failure("check")}
          <div className="actions">
            <button type="submit" className="btn btn--ghost">
              Check proof
            </button>
          </div>
        </form>
        {verdict && (
          <div className="verdict" data-tone={verdict.valid ? "ok" : "bad"} role="status">
            <Facts
              rows={[
                ["Result", verdict.result === "malformed" ? `${RESULTS.malformed}: ${verdict.reason}` : RESULTS[verdict.result]],
                ...(verdict.address
                  ? ([
                      ["Address", <span className="mono">{verdict.address}</span>],
                      ["Network", verdict.network ?? "-"],
                      ["Verification words", verdict.verificationWords?.join(" · ") ?? "-"],
                      ["Expires", verdict.expiresAt === undefined ? "-" : expiry(verdict.expiresAt)],
                      ["Challenge", <span className="mono">{verdict.challenge}</span>],
                    ] as [string, ReactNode][])
                  : []),
                ...(request.trim()
                  ? []
                  : ([["Request", "Not given: only the signature was checked. Compare the challenge with the one you sent."]] as [string, ReactNode][])),
              ]}
            />
          </div>
        )}
      </article>

      <article className="card card--wide">
        <h3 className="card__title">Ask for a proof</h3>
        <form className="stack-form" onSubmit={create} noValidate>
          <Field label="Address the other side should prove" hint={<AddressCheck state={check} network={network} />}>
            <input value={target} onChange={(event) => setTarget(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={128} />
          </Field>
          {failure("ask")}
          <div className="actions">
            <button type="submit" className="btn btn--ghost">
              Create request
            </button>
          </div>
        </form>
      </article>

      {shown && <DocumentDialog shown={shown} onClose={() => setShown(undefined)} />}
    </>
  );
}

function DocumentDialog({ shown, onClose }: { shown: Shown; onClose: () => void }) {
  return (
    <Dialog title={shown.title} onClose={onClose}>
      <p className="note">{shown.note}</p>
      <textarea className="document-text" value={shown.text} readOnly rows={10} spellCheck={false} />
      <div className="actions">
        <CopyButton text={shown.text} label="Copy" className="btn btn--solid" />
        <DownloadButton text={shown.text} file={shown.file} type="application/json" />
      </div>
    </Dialog>
  );
}
