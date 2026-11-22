import { isMessengerPayload, payloadText, recipientPayloads } from "@tenrai/sdk/wallet";
import { useState } from "react";
import { shortAddress } from "../format.ts";

const SHOWN = 160;

/** A payload line: text when safe, else hex, always as text. */
export function PayloadLine({ hex, label = "Payload" }: { hex: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const text = payloadText(hex);
  const shown = Array.from(text ?? hex);
  const long = shown.length > SHOWN;
  return (
    <p className="activity__payload">
      <span className="activity__payload-k">{text === null ? `${label}, hex, ${hex.length / 2} bytes` : label}</span>
      <span className={text === null ? "mono" : undefined}>{long && !open ? `${shown.slice(0, SHOWN).join("")}…` : shown.join("")}</span>
      {long && (
        <button type="button" className="link activity__payload-more" onClick={() => setOpen((value) => !value)}>
          {open ? "less" : "more"}
        </button>
      )}
    </p>
  );
}

/** Payload lines: own outputs' for a receipt (`owns` given), each recipient's for a send. */
export function Payloads({
  hex,
  outputs,
  owns,
  onOpenChat,
}: {
  hex: string;
  outputs?: (string | null)[];
  owns?: (address: string) => boolean;
  onOpenChat?: () => void;
}) {
  // A chat frame belongs in the Messenger tab; the activity only names it.
  if (isMessengerPayload(hex)) {
    return (
      <p className="activity__payload">
        <span className="activity__payload-k">Messenger</span>
        {onOpenChat && (
          <button type="button" className="link activity__payload-more" onClick={onOpenChat}>
            Open chat
          </button>
        )}
      </p>
    );
  }
  const entries = recipientPayloads(hex);
  if (!entries) {
    return <PayloadLine hex={hex} />;
  }
  return (
    <>
      {entries.map((entry) => {
        const recipient = outputs?.[entry.output] ?? null;
        if (owns && !(recipient && owns(recipient))) {
          return null;
        }
        const label = owns ? "Payload" : `Payload for ${recipient ? shortAddress(recipient) : `output ${entry.output + 1}`}`;
        return <PayloadLine key={entry.output} hex={entry.payloadHex} label={label} />;
      })}
    </>
  );
}
