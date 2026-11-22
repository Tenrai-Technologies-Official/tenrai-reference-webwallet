import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { problem } from "../problem.ts";
import { Dialog } from "./dialog.tsx";

const READY = "Point the camera at the QR code of an address or a payment request.";
const UNKNOWN = "This QR code holds no Tenrai address or payment request for this network.";

/** Reads a QR code with the camera or from an image; `onText` says whether it took the text. */
export function ScanDialog({ onText, onClose }: { onText: (text: string) => Promise<boolean>; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const take = useRef(onText);
  take.current = onText;
  const [status, setStatus] = useState(READY);

  const accept = async (text: string) => {
    const taken = await take.current(text);
    if (!taken) {
      setStatus(UNKNOWN);
    }
    return taken;
  };

  // The decoder loads only when a scan starts, so the wallet page stays small.
  useEffect(() => {
    const element = video.current;
    let stop: (() => void) | undefined;
    let closed = false;
    if (element) {
      void import("../qrRead.ts").then(
        ({ startScanner }) => {
          if (!closed) {
            stop = startScanner(element, (text) => accept(text), setStatus);
          }
        },
        (failure: unknown) => setStatus(problem(failure)),
      );
    }
    return () => {
      closed = true;
      stop?.();
    };
  }, []);

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const { readImage } = await import("../qrRead.ts");
      const text = await readImage(file);
      if (text) {
        await accept(text);
      } else {
        setStatus("No QR code was found in this image.");
      }
    } catch (failure) {
      setStatus(problem(failure));
    }
  };

  return (
    <Dialog title="Scan a QR code" onClose={onClose}>
      <video ref={video} className="scanner" muted playsInline />
      <p className="note" role="status" aria-live="polite">
        {status}
      </p>
      <div className="actions">
        <label className="btn btn--ghost">
          Choose an image
          <input type="file" accept="image/*" hidden onChange={pick} />
        </label>
      </div>
    </Dialog>
  );
}
