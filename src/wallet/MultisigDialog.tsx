import { MAX_MULTISIG_PACKAGE_BYTES, MultisigSession, type Branch, type MultisigPackageReview } from "@tenrai/sdk/wallet";
import { type ChangeEvent, type ReactNode, useEffect, useState } from "react";
import { hexOf } from "../bytes.ts";
import { Confirm } from "../components/confirm.tsx";
import { Dialog } from "../components/dialog.tsx";
import { Facts } from "../components/facts.tsx";
import { Amount } from "../components/values.tsx";
import { problem } from "../problem.ts";
import { readyToSend } from "../sync.ts";
import { tenrai } from "../tenrai.ts";
import { useToast } from "../components/toast.tsx";
import { useSession } from "./session.tsx";

type CheckedPackage = { session: MultisigSession; bytes: Uint8Array; review: MultisigPackageReview };
type PendingAction = { kind: "sign" | "submit"; template: string; review: MultisigPackageReview };

function wipe(value: Uint8Array | undefined): void {
  value?.fill(0);
}

function packageName(review: MultisigPackageReview, extension: "tmsig" | "trai"): string {
  return `tenrai-${extension === "tmsig" ? "multisig" : "transaction"}-${review.transactionId.slice(0, 16)}.${extension}`;
}

function save(bytes: Uint8Array, name: string): void {
  const copy = new Uint8Array(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function readPackage(event: ChangeEvent<HTMLInputElement>): Promise<Uint8Array | undefined> {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = "";
  if (!file) {
    return undefined;
  }
  if (file.size === 0 || file.size > MAX_MULTISIG_PACKAGE_BYTES) {
    throw new Error("Choose a non-empty multisig package no larger than 256 KiB.");
  }
  return new Uint8Array(await file.arrayBuffer());
}

function memberPolicy(review: MultisigPackageReview): string {
  return `${review.descriptor.threshold}-of-${review.descriptor.members.length}`;
}

function outputs(review: MultisigPackageReview): ReactNode {
  return (
    <ol className="output-list multisig-output-list">
      {review.outputs.map((output) => (
        <li key={output.index}>
          <span className="mono">{output.address}</span>
          <span> — </span>
          <Amount atoms={output.amount} />
        </li>
      ))}
    </ol>
  );
}

function facts(review: MultisigPackageReview): [string, ReactNode][] {
  return [
    ["Multisig address", <span className="mono">{review.descriptor.address}</span>],
    ["Policy", memberPolicy(review)],
    ["Witness profile", review.witnessProfile],
    ["Validity", `${review.validFromHeight.toLocaleString()}–${review.validUntilHeight.toLocaleString()}`],
    ["Inputs", review.inputs.length.toLocaleString()],
    ["Recipients and outputs", outputs(review)],
    ["Fee", <Amount atoms={review.fee} />],
    ["Signatures", `${review.requiredSignatures - review.missingSignatures}/${review.requiredSignatures}`],
    ["Transaction ID", <span className="mono">{review.transactionId}</span>],
    ["Package template", <span className="mono">{review.templateDigest}</span>],
  ];
}

function path(branch: Branch, indexText: string): { branch: Branch; index: number } {
  if (!/^(0|[1-9][0-9]{0,9})$/.test(indexText)) {
    throw new Error("Choose a valid wallet address index.");
  }
  const index = Number(indexText);
  if (!Number.isSafeInteger(index) || index > 0xffff_ffff) {
    throw new Error("Choose a valid wallet address index.");
  }
  return { branch, index };
}

/** Offline threshold-signing packages. The raw package is never kept in browser storage. */
export function MultisigDialog({ onClose }: { onClose: () => void }) {
  const { wallet, refresh } = useSession();
  const notify = useToast();
  const [stored, setStored] = useState<Uint8Array>();
  const [current, setCurrent] = useState<CheckedPackage>();
  const [branch, setBranch] = useState<Branch>("receive");
  const [indexText, setIndexText] = useState("0");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction>();

  useEffect(
    () => () => {
      wipe(stored);
    },
    [stored],
  );

  const install = (checked: CheckedPackage) => {
    const copy = new Uint8Array(checked.bytes);
    setStored((previous) => {
      wipe(previous);
      return copy;
    });
    setCurrent({ ...checked, bytes: copy });
  };

  const checked = async (value = stored): Promise<CheckedPackage> => {
    if (!value) {
      throw new Error("Import a multisig package first.");
    }
    const session = await MultisigSession.fromManifest(await tenrai.transactions.manifest());
    const canonical = session.decodePackage(value);
    const review = session.review(canonical);
    return { session, bytes: canonical, review };
  };

  const refreshPackage = async (): Promise<CheckedPackage> => {
    const next = await checked();
    install(next);
    return next;
  };

  const importPackage = async (event: ChangeEvent<HTMLInputElement>) => {
    setBusy(true);
    setError(undefined);
    let value: Uint8Array | undefined;
    try {
      value = await readPackage(event);
      if (!value) {
        return;
      }
      install(await checked(value));
      notify("Multisig package checked. Review every output before signing.");
    } catch (failure) {
      setError(problem(failure));
    } finally {
      wipe(value);
      setBusy(false);
    }
  };

  const combine = async (event: ChangeEvent<HTMLInputElement>) => {
    setBusy(true);
    setError(undefined);
    let value: Uint8Array | undefined;
    try {
      value = await readPackage(event);
      if (!value) {
        return;
      }
      const left = await refreshPackage();
      const right = left.session.decodePackage(value);
      const merged = left.session.combine(left.bytes, right);
      try {
        install({ session: left.session, bytes: merged, review: left.session.review(merged) });
      } finally {
        wipe(merged);
        wipe(right);
      }
      notify("Compatible signatures combined. Review the package again before continuing.");
    } catch (failure) {
      setError(problem(failure));
    } finally {
      wipe(value);
      setBusy(false);
    }
  };

  const requestAction = async (kind: PendingAction["kind"]) => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await refreshPackage();
      if (kind === "sign") {
        if (next.review.complete) {
          throw new Error("This package already has every required signature.");
        }
        const selected = path(branch, indexText);
        const publicKey = wallet.multisigMemberPublicKey(selected.index, selected.branch);
        try {
          const memberIndex = next.review.descriptor.members.indexOf(hexOf(publicKey));
          if (memberIndex < 0) {
            throw new Error("The selected wallet key is not a member of this multisig policy.");
          }
          const messages = next.session.signingMessages(next.bytes, next.review.templateDigest, publicKey);
          try {
            if (messages.memberIndex !== memberIndex || messages.messages.length !== next.review.inputs.length) {
              throw new Error("The signing request does not match this package.");
            }
          } finally {
            messages.messages.forEach(wipe);
          }
        } finally {
          wipe(publicKey);
        }
      } else if (!next.review.complete) {
        throw new Error("Collect every required signature before submitting this package.");
      }
      setPending({ kind, template: next.review.templateDigest, review: next.review });
    } catch (failure) {
      setError(problem(failure));
    } finally {
      setBusy(false);
    }
  };

  const sign = async () => {
    const next = await refreshPackage();
    if (!pending || pending.kind !== "sign" || next.review.templateDigest !== pending.template) {
      throw new Error("The package changed. Review it again before signing.");
    }
    const selected = path(branch, indexText);
    const publicKey = wallet.multisigMemberPublicKey(selected.index, selected.branch);
    try {
      if (!next.review.descriptor.members.includes(hexOf(publicKey))) {
        throw new Error("The selected wallet key is not a member of this multisig policy.");
      }
      const updated = wallet.signMultisigPackage(next.session, next.bytes, next.review.templateDigest, selected.index, selected.branch);
      try {
        install({ session: next.session, bytes: updated, review: next.session.review(updated) });
      } finally {
        wipe(updated);
      }
      notify("Your signatures were added. Download the updated package for the other members.");
    } finally {
      wipe(publicKey);
    }
  };

  const downloadPackage = () => {
    if (!stored || !current) {
      return;
    }
    save(stored, packageName(current.review, "tmsig"));
  };

  const complete = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await refreshPackage();
      if (!next.review.complete) {
        throw new Error("Collect every required signature before completing this package.");
      }
      const wire = next.session.complete(next.bytes);
      try {
        save(wire, packageName(next.review, "trai"));
      } finally {
        wipe(wire);
      }
      notify("Completed transaction downloaded. It is not sent until you choose Submit.");
    } catch (failure) {
      setError(problem(failure));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const next = await refreshPackage();
    if (!pending || pending.kind !== "submit" || next.review.templateDigest !== pending.template || !next.review.complete) {
      throw new Error("The package changed. Review it again before submitting.");
    }
    await readyToSend(notify);
    const wire = next.session.complete(next.bytes);
    try {
      let receipt;
      try {
        receipt = await wallet.submitSignedPublic(tenrai, { wireHex: hexOf(wire), manifest: next.session.transactionManifest(),
          transactionId: next.review.transactionId, validUntil: next.review.validUntilHeight,
          spends: next.review.inputs.map((input) => ({ key: `${input.transactionId}:${input.outputIndex}`, address: next.review.descriptor.address })) });
      } catch (failure) {
        notify(`The original transaction ${next.review.transactionId.slice(0, 16)} was retained for retry or verified reconciliation.`);
        refresh();
        throw failure;
      }
      if (receipt.transactionId !== next.review.transactionId) {
        throw new Error("The service returned a receipt for another transaction.");
      }
      notify(`Transaction ${next.review.transactionId.slice(0, 16)} submitted.`);
      refresh();
    } finally {
      wipe(wire);
    }
  };

  const review = current?.review;
  return (
    <>
      <Dialog title="Multisig package" onClose={onClose}>
        <p className="note">Review an offline threshold-signing package, add this wallet's signatures, combine packages from other members, then complete or submit it. The package stays only in this browser session.</p>
        <label className="field">
          <span className="field__k">Import package</span>
          <input type="file" accept=".tmsig,application/octet-stream" onChange={(event) => void importPackage(event)} disabled={busy} />
        </label>
        {review ? (
          <>
            <Facts rows={facts(review)} />
            <p className="note" role="status">
              {review.complete
                ? "All required signatures are present. Complete and submit only after reviewing the outputs above."
                : `${review.missingSignatures} signature${review.missingSignatures === 1 ? "" : "s"} still required.`}
            </p>
            <div className="stack-form">
              <div className="field">
                <span className="field__k">Signing key from this wallet</span>
                <div className="multisig-key-path">
                  <select value={branch} onChange={(event) => setBranch(event.target.value === "change" ? "change" : "receive")} disabled={busy || review.complete}>
                    <option value="receive">Receive</option>
                    <option value="change">Change</option>
                  </select>
                  <input
                    value={indexText}
                    onChange={(event) => setIndexText(event.target.value)}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-label="Wallet address index"
                    maxLength={10}
                    disabled={busy || review.complete}
                  />
                </div>
              </div>
              <label className="field">
                <span className="field__k">Combine another member's package</span>
                <input type="file" accept=".tmsig,application/octet-stream" onChange={(event) => void combine(event)} disabled={busy} />
              </label>
            </div>
            <div className="actions">
              <button type="button" className="btn btn--solid" onClick={() => void requestAction("sign")} disabled={busy || review.complete}>
                Sign package
              </button>
              <button type="button" className="btn btn--ghost" onClick={downloadPackage} disabled={busy}>
                Download package
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => void complete()} disabled={busy || !review.complete}>
                Download transaction
              </button>
              <button type="button" className="btn btn--solid" onClick={() => void requestAction("submit")} disabled={busy || !review.complete}>
                Submit transaction
              </button>
            </div>
          </>
        ) : (
          <p className="note">Import a signed package from a coordinator or another member. It is never saved with the wallet.</p>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </Dialog>
      {pending && (
        <Confirm
          title={pending.kind === "sign" ? "Sign multisig package" : "Submit multisig transaction"}
          facts={facts(pending.review)}
          note={
            pending.kind === "sign"
              ? "Sign only if every recipient, amount, fee, validity window and package template above is expected."
              : "Submit this fully signed transaction to the connected service. It cannot be changed after submission."
          }
          action={pending.kind === "sign" ? "Sign package" : "Submit transaction"}
          password={pending.kind === "sign"}
          onConfirm={pending.kind === "sign" ? sign : submit}
          onClose={() => setPending(undefined)}
        />
      )}
    </>
  );
}
