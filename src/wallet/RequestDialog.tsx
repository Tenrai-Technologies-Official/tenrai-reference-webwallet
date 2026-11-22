import { formatTrai } from "@tenrai/sdk";
import { MAX_REQUEST_PAYLOAD_BYTES, isRequestPayload, paymentRequest } from "@tenrai/sdk/wallet";
import { useEffect, useState } from "react";
import { Dialog } from "../components/dialog.tsx";
import { atomsOf, Field } from "../components/fields.tsx";
import { CopyButton, QrCode } from "../components/values.tsx";
import { VerificationWords, wordsOf } from "../components/words.tsx";
import { trai } from "../format.ts";
import { problem } from "../problem.ts";
import { paymentImage } from "./requestImage.ts";
import { useSession } from "./session.tsx";

/** Payment request dialog: amount, optional payload, QR code, URI and image. */
export function RequestDialog({ address, onClose }: { address: string; onClose: () => void }) {
  const { network } = useSession();
  const [amount, setAmount] = useState("");
  const [payload, setPayload] = useState("");
  const [request, setRequest] = useState<{ uri: string; atoms: bigint; payload: string }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let current = true;
    setRequest(undefined);
    setError(undefined);
    if (!amount.trim()) {
      return;
    }
    try {
      const atoms = atomsOf(amount);
      if (atoms === 0n) {
        throw new Error("the amount must be greater than zero");
      }
      const text = payload.trim();
      if (text && !isRequestPayload(text)) {
        throw new Error(`the payload may hold letters, digits, spaces and . , : ; - _ / # + ( ) ! ? % @ * & only, up to ${MAX_REQUEST_PAYLOAD_BYTES} bytes`);
      }
      paymentRequest(address, network, atoms, text).then(
        (uri) => current && setRequest({ uri, atoms, payload: text }),
        (failure: unknown) => current && setError(problem(failure)),
      );
    } catch (failure) {
      setError(problem(failure));
    }
    return () => {
      current = false;
    };
  }, [address, network, amount, payload]);

  const save = async () => {
    if (!request) {
      return;
    }
    try {
      const blob = await paymentImage({
        uri: request.uri,
        address,
        words: wordsOf(address) ?? "",
        amount: trai(request.atoms),
        payload: request.payload,
        network,
        logo: "/tenrai-logo-white.png",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tenrai-payment-request-${formatTrai(request.atoms)}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (failure) {
      setError(problem(failure));
    }
  };

  return (
    <Dialog title="Request payment" onClose={onClose}>
      <Field label="Amount (TRAI)">
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          autoComplete="off"
          maxLength={40}
          placeholder="0.00000000"
          autoFocus
        />
      </Field>
      <Field label="Payload (optional)" hint={<span className="note">Sent with the payment, for example an invoice number; anyone can read it on chain.</span>}>
        <input
          value={payload}
          onChange={(event) => setPayload(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_REQUEST_PAYLOAD_BYTES}
          placeholder="Invoice 42"
        />
      </Field>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {request ? (
        <>
          <div className="qr-box">
            <QrCode text={request.uri} label="QR code of the payment request" />
          </div>
          <code className="address-box">{request.uri}</code>
          <VerificationWords address={address} />
        </>
      ) : (
        !error && <p className="note">Enter the amount to ask for; the QR code carries it and the payload, and the sender's wallet fills them in.</p>
      )}
      <div className="actions">
        {request ? (
          <CopyButton text={request.uri} label="Copy request" className="btn btn--solid" />
        ) : (
          <button type="button" className="btn btn--solid" disabled>
            Copy request
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={save} disabled={!request}>
          Download image
        </button>
      </div>
    </Dialog>
  );
}
