import { useState } from "react";
import { Dialog } from "../components/dialog.tsx";
import { DownloadIcon } from "../components/icons.tsx";
import { useToast } from "../components/toast.tsx";
import { CopyIconButton, QrCode } from "../components/values.tsx";
import { VerificationWords, wordsOf } from "../components/words.tsx";
import { problem } from "../problem.ts";
import { RequestDialog } from "./RequestDialog.tsx";
import { paymentImage } from "./requestImage.ts";
import { addressName } from "./scan.ts";
import { useSession } from "./session.tsx";

const LISTED = 50;

async function saveAddressImage(address: string, network: string) {
  const blob = await paymentImage({ uri: address, address, words: wordsOf(address) ?? "", amount: null, network, logo: "/tenrai-logo-white.png" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tenrai-address-${address.slice(0, 12)}-${address.slice(-6)}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ReceiveDialog({ onClose }: { onClose: () => void }) {
  const { wallet, receiveIndex, network } = useSession();
  const notify = useToast();
  const address = wallet.address(receiveIndex);
  const save = () => saveAddressImage(address, network).catch((failure: unknown) => notify(problem(failure), "bad"));
  return (
    <Dialog
      title="Receive TRAI"
      onClose={onClose}
      actions={
        <button type="button" className="icon-btn icon-btn--small" aria-label="Download as image" title="Download as image" onClick={save}>
          <DownloadIcon />
        </button>
      }
    >
      <div className="qr-box">
        <QrCode text={wallet.address(receiveIndex)} label="QR code of your address" />
      </div>
      <ReceiveAddress />
    </Dialog>
  );
}

export function ReceiveAddress() {
  const { wallet, data, receiveIndex, issued, newAddress, useAddress } = useSession();
  const [requesting, setRequesting] = useState(false);
  const address = wallet.address(receiveIndex);
  // Keep the main address and recently issued addresses available.
  const choices = [0, ...Array.from({ length: Math.min(issued, LISTED) }, (_, offset) => issued - offset).reverse()];
  return (
    <>
      <label className="field">
        <span className="field__k">Address</span>
        <select value={receiveIndex} onChange={(event) => useAddress(Number(event.target.value))}>
          {choices.map((index) => (
            <option key={index} value={index}>
              {`${addressName(index)} · ${wallet.address(index).slice(0, 14)}…${wallet.address(index).slice(-6)}`}
            </option>
          ))}
        </select>
      </label>
      <div className="receive-address">
        <span className="field__k">{addressName(receiveIndex)}</span>
        <div className="address-line">
          <code className="address-box">{address}</code>
          <CopyIconButton text={address} label="Copy address" />
        </div>
      </div>
      <VerificationWords address={address} />
      <div className="actions">
        <button type="button" className="btn btn--ghost" onClick={newAddress} disabled={!data}>
          New address
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setRequesting(true)}>
          Request payment
        </button>
      </div>
      {requesting && <RequestDialog address={address} onClose={() => setRequesting(false)} />}
    </>
  );
}
