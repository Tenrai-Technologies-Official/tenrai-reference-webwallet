import { useState } from "react";

/** Downloads opaque retained records; it performs no import, deletion or coin operation. */
export function RecoveryDownload({ error }: { error: unknown }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  if (!error || typeof error !== "object" || !("exportRecovery" in error) || typeof error.exportRecovery !== "function") return null;
  const exportRecovery = error.exportRecovery.bind(error) as () => Promise<unknown>;
  const download = async () => {
    setBusy(true);
    try {
      const bytes: unknown = await exportRecovery();
      if (!(bytes instanceof Uint8Array)) throw new Error("Invalid retained-record export.");
      const copy = new Uint8Array(bytes);
      const url = URL.createObjectURL(new Blob([copy.buffer], { type: "application/json" }));
      try {
        const link = document.createElement("a"); link.href = url; link.download = "tenrai-wallet-record-recovery.json"; link.click();
      } finally { URL.revokeObjectURL(url); }
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : "The retained records could not be exported."); }
    finally { setBusy(false); }
  };
  return <><button type="button" className="link" disabled={busy} onClick={() => void download()}>Download retained records</button>{failure && <p role="alert">{failure}</p>}</>;
}
