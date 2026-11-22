import type { AtomAmount, TransactionLifecycle } from "@tenrai/sdk";
import { useEffect, useMemo, useState } from "react";
import { transactionUrl } from "../explorer.ts";
import { shortId, timeLeft, trai } from "../format.ts";
import { qrModules } from "../qr.ts";
import { CheckIcon, CopyIcon } from "./icons.tsx";

const QUIET_ZONE = 4;

export function Amount({ atoms, signed = false }: { atoms: AtomAmount | bigint; signed?: boolean }) {
  return <span className="amount">{trai(atoms, { signed })}</span>;
}

export function Badge({ tone, children }: { tone?: "good" | "bad" | "wait"; children: string }) {
  return <span className={tone ? `badge ${tone}` : "badge"}>{children}</span>;
}

const STAGES: Record<TransactionLifecycle, string> = {
  processing: "In mempool",
  receiving: "Mined",
  registered: "Registered",
  finalized: "Finalized",
  failed: "Failed",
};

export function Stage({ lifecycle }: { lifecycle: TransactionLifecycle }) {
  return <Badge tone={lifecycle === "finalized" ? "good" : lifecycle === "failed" ? "bad" : "wait"}>{STAGES[lifecycle]}</Badge>;
}

export function TxId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const label = copied ? "Copied" : "Copy transaction ID";
  return (
    <span className="txid">
      <a className="txid__link" href={transactionUrl(id)} target="_blank" rel="noopener noreferrer" title={id}>
        {shortId(id)}
      </a>
      <button type="button" className="txid__copy" onClick={copy} aria-label={label} title={label}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </span>
  );
}

/** Countdown based on the node's estimate. */
export function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="countdown">{until > now ? `in about ${timeLeft(until - now)}` : "any moment"}</span>;
}

export function CopyIconButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const shown = copied ? "Copied" : label;
  return (
    <button type="button" className="icon-btn icon-btn--field" onClick={copy} aria-label={shown} title={shown}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

export function CopyButton({ text, label = "Copy", className = "btn btn--ghost" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button type="button" className={className} onClick={copy}>
      {copied ? "Copied" : label}
    </button>
  );
}

export function DownloadButton({
  text,
  file,
  type = "text/plain",
  label = "Download",
  className = "btn btn--ghost",
}: {
  text: string;
  file: string;
  type?: string;
  label?: string;
  className?: string;
}) {
  const save = () => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = file;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return (
    <button type="button" className={className} onClick={save}>
      {label}
    </button>
  );
}

/** Preserve the QR code's quiet zone and contrast in both themes. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { side, path } = useMemo(() => {
    const modules = qrModules(text);
    let d = "";
    modules.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) {
          d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
        }
      }),
    );
    return { side: modules.length + QUIET_ZONE * 2, path: d };
  }, [text]);

  return (
    <svg className="qr" viewBox={`0 0 ${side} ${side}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={side} height={side} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
