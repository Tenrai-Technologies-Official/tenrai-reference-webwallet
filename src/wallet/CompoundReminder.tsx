import type { PreparedTransfer, WalletOutput } from "@tenrai/sdk/wallet";
import { useEffect, useRef, useState } from "react";
import { Confirm } from "../components/confirm.tsx";
import { Dialog } from "../components/dialog.tsx";
import { useToast } from "../components/toast.tsx";
import { Amount } from "../components/values.tsx";
import { count, plural, shortAddress } from "../format.ts";
import { problem } from "../problem.ts";
import { readyToSend } from "../sync.ts";
import { tenrai } from "../tenrai.ts";
import { useSession } from "./session.tsx";

export const REMIND_ABOVE = 25;

/** Suggests a compound once a session when the wallet holds more than 25 outputs. */
export function CompoundReminder() {
  const { data, sent, autoCompound, remindCompound } = useSession();
  const [open, setOpen] = useState(false);
  const asked = useRef(false);
  const due = !!data && data.balance.outputs > REMIND_ABOVE && data.balance.addresses.some((entry) => entry.outputs > 1);
  const compounding = sent.some(
    (entry) =>
      (entry.label === "Compound" || entry.label === "Automatic compound") &&
      entry.status?.lifecycle !== "finalized" &&
      entry.status?.lifecycle !== "failed",
  );

  useEffect(() => {
    if (due && !asked.current && remindCompound && autoCompound === null && !compounding) {
      asked.current = true;
      setOpen(true);
    }
  }, [due, remindCompound, autoCompound, compounding]);

  return open ? <Reminder onClose={() => setOpen(false)} /> : null;
}

function Reminder({ onClose }: { onClose: () => void }) {
  const { wallet, data, asks, track, salvage, setRemindCompound } = useSession();
  const notify = useToast();
  const [outputs, setOutputs] = useState<WalletOutput[]>();
  const [error, setError] = useState<string>();
  const [stop, setStop] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const loadedAt = data?.loadedAt;

  useEffect(() => {
    let current = true;
    wallet.outputs(tenrai).then(
      (list) => current && setOutputs(list),
      (failure: unknown) => current && setError(problem(failure)),
    );
    return () => {
      current = false;
    };
  }, [wallet, loadedAt]);

  const close = () => {
    if (stop) {
      setRemindCompound(false);
      notify("No more compound reminders; Settings, Compound turns them on again.");
    }
    onClose();
  };

  const run = async () => {
    const atoms = (transfer: PreparedTransfer) => -transfer.fee;
    try {
      await readyToSend(notify);
      const sent = await wallet.compound(tenrai);
      if (sent.length === 0) {
        notify("Nothing to compound: every address holds one output at most.");
        return;
      }
      track("Compound", sent, atoms);
      notify(`${plural(sent.length, "compound transfer")} sent.`);
    } catch (failure) {
      if (!salvage("Compound", failure, atoms)) {
        throw failure;
      }
      notify(problem(failure));
    }
  };

  if (confirming) {
    return (
      <Confirm
        title="Compound"
        facts={[
          ["Merges", "the outputs of each address into one output of that address"],
          ["Fee", "Automatic, normal"],
        ]}
        note="Addresses are never mixed. Later transfers need fewer inputs and cost less."
        action="Compound"
        password={asks(data?.balance.atoms ?? 0n)}
        onConfirm={run}
        onClose={close}
      />
    );
  }

  return (
    <Dialog title="Time to compound" onClose={close}>
      <p className="note">
        This wallet holds <strong>{count(data?.balance.outputs ?? 0)} outputs</strong>.
        A payment spends outputs as its inputs, at most 8 in one transaction, and every input adds to the fee. With this many,
        payments cost more, larger ones need several outputs merged first, and some fail until they are.
      </p>
      <p className="note">
        Compound merges the outputs of each address into one output of that address. The balance stays the same apart from a
        small fee per address, addresses are never mixed, and later payments are cheaper.
      </p>
      {outputs && <p className="note">Showing up to 256 largest available outputs. Consolidation runs in batches.</p>}
      <div className="output-list">
        {outputs ? (
          <table className="table">
            <thead>
              <tr>
                <th>Amount</th>
                <th>Address</th>
                <th>Cut</th>
              </tr>
            </thead>
            <tbody>
              {outputs.map((output) => (
                <tr key={`${output.transactionId}:${output.outputIndex}`}>
                  <td data-label="Amount">
                    <Amount atoms={output.amount} />
                  </td>
                  <td data-label="Address" className="mono" title={output.address}>
                    {shortAddress(output.address)}
                  </td>
                  <td data-label="Cut">{count(output.height)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty">{error ?? "Reading the outputs…"}</p>
        )}
      </div>
      <label className="check">
        <input type="checkbox" checked={stop} onChange={(event) => setStop(event.target.checked)} />
        <span>Don't remind me again</span>
      </label>
      <div className="actions actions--end">
        <button type="button" className="btn btn--ghost" onClick={close}>
          Later
        </button>
        <button type="button" className="btn btn--solid" onClick={() => setConfirming(true)}>
          Compound now
        </button>
      </div>
    </Dialog>
  );
}
