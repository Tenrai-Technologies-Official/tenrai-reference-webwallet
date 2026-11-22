import { retainedPublicRows } from "./public-pending.ts";
import {
  isFinal,
  type Network,
  type PendingPayment,
  type StakePositionView,
  TenraiApiError,
  TenraiNetworkError,
  TenraiTimeoutError,
  type TransactionLifecycle,
  type TransactionStatus,
} from "@tenrai/sdk";
import { autoCompound, type PreparedTransfer, type SentTransfer, TenraiWalletError, type Wallet, type WalletBalance } from "@tenrai/sdk/wallet";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { problem } from "../problem.ts";
import { tenrai } from "../tenrai.ts";
import { type AutoCompound, saveAutoCompound, saveLockMinutes, savedAutoCompound, savedLockMinutes } from "./automation.ts";
import type { ConfirmSetting, History, Parties, Remembered } from "./history.ts";
import { handedOut, saveAddresses, saveReceive, savedReceive } from "./scan.ts";

const REFRESH_MILLIS = 15_000;
// Poll until the node's address index reaches the finalized cut.
const INDEX_READS = 5;
const INDEX_WAIT_MILLIS = 1_500;
// Periodic full refresh for stake changes and unwatched addresses.
const FULL_REFRESH_MILLIS = 5 * 60_000;
const CHANGES_BATCH = 64;
const STATUS_MILLIS = 2_500;
const UNKNOWN_STATUS_MILLIS = 10_000;
const ARRIVAL_GRACE_MILLIS = 60_000;
const CUT_PAGE = 100;
const MAX_ACTIVITY_READ = 1_000;
const PAYLOAD_READS = 25;
const PAYLOAD_RETRY_MILLIS = 60_000;

/** Finalized activity with payload bytes encoded as hex. */
export type ActivityEntry = Remembered & { label?: string; payload?: string; payloadOutputs?: (string | null)[]; parties?: Parties };

export interface WalletData {
  balance: WalletBalance;
  activity: ActivityEntry[];
  positions: StakePositionView[];
  watched: string[];
  /** Timestamp for countdowns based on node estimates. */
  loadedAt: number;
  /** A failed history read forces a full refresh on the next poll. */
  complete: boolean;
  /** First retained history cut. Zero indicates a complete history. */
  heldFrom: number;
}

export interface Arriving {
  payment: PendingPayment;
  lifecycle: TransactionLifecycle;
  firstSeen: number;
  seenAt: number;
}

export interface Sent {
  transactionId: string;
  label: string;
  /** Balance delta including fees. */
  atoms: bigint;
  /** A transfer to this wallet's own addresses, with only the fee spent. */
  internal: boolean;
  sentAt: number;
  payload?: string;
  /** Addresses indexed by output for per-recipient payloads. */
  payloadOutputs?: (string | null)[];
  parties?: Parties;
  validUntil?: bigint;
  status?: TransactionStatus;
  /** The node reports the transaction as unknown. */
  unknown?: boolean;
  needsReview?: boolean;
  resendPaused?: boolean;
  amountUnknown?: boolean;
}

interface Session {
  wallet: Wallet;
  network: Network;
  history: History;
  data?: WalletData;
  error?: string;
  sent: Sent[];
  arriving: Arriving[];
  /** With a cut, wait for the address index to catch up before reading. */
  refresh: (height?: number) => void;
  track: (
    label: string,
    transfers: PreparedTransfer[],
    atoms: (transfer: PreparedTransfer) => bigint,
    payload?: string,
    outputs?: string[],
  ) => void;
  /** Track a submission that may have reached the node despite an error. */
  salvage: (
    label: string,
    failure: unknown,
    atoms: (transfer: PreparedTransfer) => bigint,
    payload?: string,
    outputs?: string[],
  ) => boolean;
  dismiss: (transactionId: string) => void;
  lock: () => void;
  receiveIndex: number;
  issued: number;
  /** Available after the initial address scan. */
  newAddress: () => void;
  useAddress: (index: number) => void;
  keep: number;
  setKeep: (keep: number) => void;
  /** Load payloads and addresses before returning activity for display. */
  show: (transactionIds: string[]) => void;
  autoCompound: AutoCompound | null;
  setAutoCompound: (setting: AutoCompound | null) => void;
  lockMinutes: number;
  setLockMinutes: (minutes: number) => void;
  remindCompound: boolean;
  setRemindCompound: (remind: boolean) => void;
  incomingPayloads: boolean;
  setIncomingPayloads: (show: boolean) => void;
  autoError?: string;
  confirm: ConfirmSetting;
  setConfirm: (setting: ConfirmSetting) => void;
  asks: (atoms: bigint) => boolean;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("useSession needs an open wallet");
  }
  return session;
}

export function SessionProvider({
  wallet,
  network,
  history,
  onLock,
  children,
}: {
  wallet: Wallet;
  network: Network;
  history: History;
  onLock: () => void;
  children: ReactNode;
}) {
  const [data, setData] = useState<WalletData>();
  const latest = useRef<WalletData | undefined>(undefined);
  latest.current = data;
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState<Sent[]>(() => {
    return retainedPublicRows(unfinished(history), wallet.openTransfers());
  });
  const [autoCompoundSetting, setAutoSetting] = useState<AutoCompound | null>(savedAutoCompound);
  const [autoError, setAutoError] = useState<string>();
  const setAutoCompound = useCallback((setting: AutoCompound | null) => {
    saveAutoCompound(setting);
    setAutoError(undefined);
    setAutoSetting(setting);
  }, []);
  const [lockMinutes, setLockState] = useState(savedLockMinutes);
  const setLockMinutes = useCallback((minutes: number) => {
    saveLockMinutes(minutes);
    setLockState(minutes);
  }, []);
  const [incomingPayloads, setIncomingState] = useState(() => history.incomingPayloads);
  const [remindCompound, setRemindState] = useState(() => history.remind);
  const setRemindCompound = useCallback(
    (remind: boolean) => {
      history.setRemind(remind);
      setRemindState(remind);
    },
    [history],
  );

  const lock = useCallback(() => {
    wallet.close();
    onLock();
  }, [wallet, onLock]);

  const [confirm, setConfirmState] = useState(() => history.confirm);
  const setConfirm = useCallback(
    (setting: ConfirmSetting) => {
      history.setConfirm(setting);
      setConfirmState(setting);
    },
    [history],
  );
  const asks = useCallback((atoms: bigint) => confirm.mode === "always" || (confirm.mode === "above" && atoms >= confirm.above), [confirm]);

  const [issued, setIssued] = useState(() => wallet.lastIssued);
  const [receiveIndex, setReceiveIndex] = useState(() => savedReceive(wallet));
  const newAddress = useCallback(() => {
    const index = wallet.newAddress().index;
    setIssued(index);
    setReceiveIndex(index);
    saveAddresses(wallet);
    saveReceive(wallet, index);
  }, [wallet]);
  const useAddress = useCallback(
    (index: number) => {
      setReceiveIndex(index);
      saveReceive(wallet, index);
    },
    [wallet],
  );

  const loaded = useRef(false);
  // Widen the next read when the history limit increases.
  const wide = useRef(false);
  const reread = useRef((_height: number) => {});
  const refresh = useCallback((height?: number) => reread.current(typeof height === "number" ? height : 0), []);
  const visible = useRef<string[]>([]);
  const readDetails = useRef(() => {});
  const show = useCallback(
    (transactionIds: string[]) => {
      const changed = transactionIds.join() !== visible.current.join();
      visible.current = transactionIds;
      if (changed && history.unread(transactionIds.length, transactionIds).length > 0) {
        readDetails.current();
      }
    },
    [history],
  );
  const setIncomingPayloads = useCallback(
    (show: boolean) => {
      history.setIncomingPayloads(show);
      setIncomingState(show);
      setData(
        (last) =>
          last && {
            ...last,
            activity: last.activity.map((entry) => ({
              ...entry,
              payload: payloadOf(history, entry.transactionId),
              payloadOutputs: payloadOutputsOf(history, entry.transactionId),
            })),
          },
      );
      if (show) {
        readDetails.current();
      }
    },
    [history],
  );
  const [keep, setKeepState] = useState(() => history.keep);
  const setKeep = useCallback(
    (next: number) => {
      const more = next > history.keep;
      history.setKeep(next);
      setKeepState(next);
      if (more) {
        wide.current = true;
      }
      refresh();
    },
    [history, refresh],
  );

  // Queue refreshes behind the active read.
  useEffect(() => {
    const state = { open: true, running: false, again: false, payloads: false, wanted: 0, reads: 0 };
    // Fetch transaction payloads separately from the balance refresh.
    const readPayloads = async () => {
      if (state.payloads) {
        return;
      }
      state.payloads = true;
      const show = () => {
        if (state.open) {
          setData(
            (last) =>
              last && {
                ...last,
                activity: last.activity.map((entry) => ({
                  ...entry,
                  payload: payloadOf(history, entry.transactionId),
                  payloadOutputs: payloadOutputsOf(history, entry.transactionId),
                  parties: partiesOf(history, entry.transactionId),
                })),
              },
          );
        }
      };
      try {
        await fetchPayloads(history, show, () => visible.current);
      } finally {
        state.payloads = false;
      }
    };
    readDetails.current = () => void readPayloads();
    reread.current = (height) => {
      if (height > state.wanted) {
        state.wanted = height;
        state.reads = 0;
      }
      if (state.running) {
        state.again = true;
        return;
      }
      state.running = true;
      void (async () => {
        do {
          state.again = false;
          try {
            const limit = !loaded.current ? 200 : wide.current ? Math.min(history.keep, MAX_ACTIVITY_READ) : 40;
            wide.current = false;
            const read = await load(wallet, history, issued, limit);
            if (!state.open) {
              break;
            }
            loaded.current = true;
            setData(read);
            setError(undefined);
            void readPayloads();
            const listed = new Set(read.activity.map((entry) => entry.transactionId));
            setSent((list) => retainedPublicRows(list.filter((entry) => entry.status?.lifecycle !== "finalized" && !listed.has(entry.transactionId)), wallet.openTransfers()));
            if (read.balance.indexedHeight < state.wanted && state.reads < INDEX_READS) {
              state.reads += 1;
              state.again = true;
              await new Promise((resolve) => setTimeout(resolve, INDEX_WAIT_MILLIS));
            }
          } catch (failure) {
            if (state.open) {
              setError(problem(failure));
            }
          }
        } while (state.again && state.open);
        state.running = false;
      })();
    };
    reread.current(0);
    return () => {
      state.open = false;
      reread.current = () => {};
      readDetails.current = () => {};
    };
  }, [wallet, history, issued]);

  // Check address changes before refreshing the full wallet.
  useEffect(() => {
    let asking = false;
    const poll = async () => {
      const last = latest.current;
      if (!last || !last.complete || Date.now() - last.loadedAt >= FULL_REFRESH_MILLIS) {
        refresh();
        return;
      }
      if (asking) {
        return;
      }
      asking = true;
      try {
        const handed = handedOut(issued).map((index) => wallet.address(index));
        const upTo = await unchangedUpTo(last, handed);
        if (upTo === null) {
          refresh();
        } else if (upTo > last.balance.indexedHeight) {
          // Carry the previous balance forward when these addresses have no changes.
          setData((current) => (current === last ? { ...last, balance: { ...last.balance, indexedHeight: upTo } } : current));
        }
      } catch {
        // Retry on the next poll.
      } finally {
        asking = false;
      }
    };
    const timer = setInterval(() => void poll(), REFRESH_MILLIS);
    return () => clearInterval(timer);
  }, [refresh, wallet, issued]);

  const height = data?.balance.indexedHeight;
  useEffect(() => {
    // Keep tracking unknown transactions while the SDK can still retry them.
    const open = sent.filter((entry) => (!entry.status || !isFinal(entry.status)) && (!entry.unknown || stillSending(entry, height)));
    if (open.length === 0) {
      return;
    }
    const asked = new Set(open.map((entry) => entry.transactionId));
    const timer = setTimeout(
      async () => {
        const batch = await tenrai.transactions.statuses([...asked]).catch(() => undefined);
        if (!batch) {
          return;
        }
        const updates = new Map(batch.statuses.map((status) => [status.transaction_id, status]));
        const unknown = new Set(batch.unknown);
        setSent((list) =>
          list.map((entry) =>
            asked.has(entry.transactionId)
              ? { ...entry, status: updates.get(entry.transactionId) ?? entry.status, unknown: unknown.has(entry.transactionId) }
              : entry,
          ),
        );
        if (batch.statuses.some((status) => status.lifecycle === "finalized")) {
          refresh();
        }
        // A restart can discard unmined mempool entries.
        if (unknown.size > 0) {
          void wallet.resend(tenrai).catch(() => []);
        }
      },
      open.every((entry) => entry.unknown) ? UNKNOWN_STATUS_MILLIS : STATUS_MILLIS,
    );
    return () => clearTimeout(timer);
  }, [sent, refresh, height, wallet]);

  useEffect(() => {
    const idleMillis = lockMinutes * 60_000;
    let timer = setTimeout(lock, idleMillis);
    const active = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, idleMillis);
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const event of events) {
      window.addEventListener(event, active, { passive: true });
    }
    return () => {
      clearTimeout(timer);
      for (const event of events) {
        window.removeEventListener(event, active);
      }
    };
  }, [lock, lockMinutes]);

  const track = useCallback<Session["track"]>(
    (label, transfers, atoms, payload, outputs) => {
      const sentAt = Date.now();
      const fresh = transfers.map((transfer) => {
        const change = atoms(transfer);
        return { transactionId: transfer.transactionId, label, atoms: change, internal: change === -transfer.fee, sentAt, validUntil: transfer.validUntil };
      });
      for (const { transactionId, ...own } of fresh) {
        if (payload) {
          history.setPayload(transactionId, payload, outputs);
        }
        if (outputs) {
          history.setParties(transactionId, [], outputs);
        }
        history.addOwn(transactionId, own);
      }
      const shown = fresh.map((entry) => ({
        ...entry,
        payload,
        payloadOutputs: payloadOutputsOf(history, entry.transactionId),
        parties: partiesOf(history, entry.transactionId),
      }));
      setSent((list) => [...shown, ...list]);
      refresh();
    },
    [history, refresh],
  );

  const salvage = useCallback<Session["salvage"]>(
    (label, failure, atoms, payload, outputs) => {
      if (!(failure instanceof TenraiWalletError)) {
        return false;
      }
      const before = Array.isArray(failure.details["sent"]) ? (failure.details["sent"] as SentTransfer[]) : [];
      const lost = failure.code === "unconfirmed" && failure.details["transfer"] ? [failure.details["transfer"] as PreparedTransfer] : [];
      if (before.length + lost.length > 0) {
        track(label, [...before, ...lost], atoms, payload, outputs);
      }
      return lost.length > 0;
    },
    [track],
  );

  const [arriving, setArriving] = useState<Arriving[]>([]);
  const arrivingCount = useRef(0);
  useEffect(() => {
    if (!data) {
      return;
    }
    const listed = new Set(data.activity.map((entry) => entry.transactionId));
    let current = true;
    const read = async () => {
      const pending = await tenrai.mempool.pending(data.watched).catch(() => undefined);
      if (!current || !pending) {
        return;
      }
      const ids = pending.entries.map((entry) => entry.transaction_id);
      const batch = ids.length > 0 ? await tenrai.transactions.statuses(ids).catch(() => undefined) : undefined;
      if (!current) {
        return;
      }
      const stages = new Map((batch?.statuses ?? []).map((status) => [status.transaction_id, status.lifecycle]));
      const now = Date.now();
      setArriving((last) => {
        const known = new Map(last.map((entry) => [entry.payment.transaction_id, entry]));
        const fresh = pending.entries.map((payment) => ({
          payment,
          lifecycle: stages.get(payment.transaction_id) ?? known.get(payment.transaction_id)?.lifecycle ?? "processing",
          firstSeen: known.get(payment.transaction_id)?.firstSeen ?? now,
          seenAt: now,
        }));
        const gone = last.filter(
          (entry) =>
            !ids.includes(entry.payment.transaction_id) &&
            entry.lifecycle !== "processing" &&
            entry.lifecycle !== "failed" &&
            now - entry.seenAt < ARRIVAL_GRACE_MILLIS,
        );
        return [...fresh, ...gone].filter((entry) => !listed.has(entry.payment.transaction_id));
      });
      if ([...stages.values()].includes("finalized") || ids.length < arrivingCount.current) {
        refresh();
      }
      arrivingCount.current = ids.length;
    };
    void read();
    const timer = setInterval(read, STATUS_MILLIS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [data, refresh]);

  const dismiss = useCallback(
    (transactionId: string) => {
      history.dropOwn(transactionId);
      setSent((list) => retainedPublicRows(list.filter((entry) => entry.transactionId !== transactionId), wallet.openTransfers()));
    },
    [history, wallet],
  );

  useEffect(() => {
    if (autoCompoundSetting === null) {
      return;
    }
    return autoCompound(wallet, tenrai, {
      ...autoCompoundSetting,
      onSent: (transfers) => {
        setAutoError(undefined);
        track("Automatic compound", transfers, (transfer) => -transfer.fee);
      },
      onError: (failure) => setAutoError(problem(failure)),
    });
  }, [wallet, autoCompoundSetting, track]);

  return (
    <SessionContext
      value={{
        wallet,
        network,
        history,
        data,
        error,
        sent,
        arriving,
        refresh,
        track,
        salvage,
        dismiss,
        lock,
        receiveIndex,
        issued,
        newAddress,
        useAddress,
        keep,
        setKeep,
        show,
        autoCompound: autoCompoundSetting,
        setAutoCompound,
        lockMinutes,
        setLockMinutes,
        remindCompound,
        setRemindCompound,
        incomingPayloads,
        setIncomingPayloads,
        autoError,
        confirm,
        setConfirm,
        asks,
      }}
    >
      {children}
    </SessionContext>
  );
}

function unfinished(history: History): Sent[] {
  const listed = new Set(history.activity.map((entry) => entry.transactionId));
  return [...history.own]
    .filter(([id]) => !listed.has(id))
    .map(([transactionId, own]) => ({
      transactionId,
      ...own,
      payload: history.payloads.get(transactionId) || undefined,
      payloadOutputs: payloadOutputsOf(history, transactionId),
      parties: partiesOf(history, transactionId),
    }))
    .sort((a, b) => b.sentAt - a.sentAt);
}

/** Return the latest cut without address changes, or null if any changed. */
async function unchangedUpTo(data: WalletData, handed: string[]): Promise<number | null> {
  const owners = [...new Set([...handed, ...data.balance.addresses.map((entry) => entry.address)])];
  let upTo = Number.MAX_SAFE_INTEGER;
  for (let start = 0; start < owners.length; start += CHANGES_BATCH) {
    const answer = await tenrai.address.changes(owners.slice(start, start + CHANGES_BATCH), data.balance.indexedHeight);
    if (answer.changes.length > 0 || answer.resync.length > 0) {
      return null;
    }
    upTo = Math.min(upTo, answer.indexed_height);
  }
  return upTo === Number.MAX_SAFE_INTEGER ? data.balance.indexedHeight : upTo;
}

async function load(wallet: Wallet, history: History, issued: number, limit: number): Promise<WalletData> {
  await wallet.resend(tenrai).catch(() => []);
  // Keep cached history when the node cannot serve it. Read balances from coins.
  const [balance, activity, positions, storage] = await Promise.all([
    wallet.balance(tenrai),
    wallet.activity(tenrai, { limit }).catch(() => null),
    wallet.positions(tenrai),
    tenrai.node.storage().catch(() => null),
  ]);
  saveAddresses(wallet);
  const untimed = history.merge(activity ?? []);
  if (untimed.length > 0) {
    history.setTimes(await cutTimes(untimed));
  }
  const handed = handedOut(issued).map((index) => wallet.address(index));
  const watched = [...new Set([...handed, ...balance.addresses.map((entry) => entry.address)])].slice(0, 64);
  const shown = history.activity.map((entry) => ({
    ...entry,
    label: entry.transactionId === null ? undefined : history.own.get(entry.transactionId)?.label,
    payload: payloadOf(history, entry.transactionId),
    payloadOutputs: payloadOutputsOf(history, entry.transactionId),
    parties: partiesOf(history, entry.transactionId),
  }));
  return {
    balance,
    activity: shown,
    positions,
    watched,
    loadedAt: Date.now(),
    complete: activity !== null,
    heldFrom: storage?.complete_history === false ? storage.body_history_floor : 0,
  };
}

function payloadOf(history: History, transactionId: string | null): string | undefined {
  return transactionId === null ? undefined : history.payloads.get(transactionId) || undefined;
}

function payloadOutputsOf(history: History, transactionId: string | null): (string | null)[] | undefined {
  return transactionId === null ? undefined : history.payloadOutputs.get(transactionId);
}

function partiesOf(history: History, transactionId: string | null): Parties | undefined {
  return transactionId === null ? undefined : history.parties.get(transactionId);
}

export function stillSending(entry: Sent, height: number | undefined): boolean {
  return entry.validUntil !== undefined && height !== undefined && BigInt(height) < entry.validUntil;
}

/** Fetch payloads and addresses for the visible page first. */
async function fetchPayloads(history: History, show: () => void, first: () => string[]): Promise<void> {
  for (let count = 0; count < PAYLOAD_READS; count += 1) {
    const [transactionId] = history.unread(1, first());
    if (!transactionId) {
      break;
    }
    try {
      const view = await tenrai.transactions.get(transactionId);
      const outputs: (string | null)[] = [];
      for (const output of view.outputs.filter((item) => item.index < 256)) {
        outputs[output.index] = output.address;
      }
      const listed = Array.from(outputs, (address) => address ?? null);
      // Discard incoming payloads without reading them when disabled.
      const kept = history.incomingPayloads || history.sentByThisWallet(transactionId);
      history.setPayload(transactionId, kept ? (view.payload_hex ?? "") : "", listed);
      const validator = view.operation?.type === "bond" ? view.operation.data.validator_id : null;
      history.setParties(transactionId, view.inputs.map((input) => input.spends?.address ?? null), listed, view.kind, validator);
      show();
    } catch (failure) {
      if (failure instanceof TenraiNetworkError || (failure instanceof TenraiApiError && (failure.code === "unavailable" || failure.code === "rate_limited"))) {
        break;
      }
      // Retry later. A pruned node may have discarded these transactions.
      history.missed(transactionId, failure instanceof TenraiTimeoutError ? PAYLOAD_RETRY_MILLIS : Infinity);
    }
  }
}

async function cutTimes(heights: number[]): Promise<Map<number, number | null>> {
  const times = new Map<number, number | null>();
  for (const height of [...heights].sort((a, b) => b - a)) {
    if (times.has(height)) {
      continue;
    }
    const page = await tenrai.cuts.list({ before: height + 1, limit: CUT_PAGE }).catch(() => undefined);
    if (!page) {
      break;
    }
    for (const summary of page.cuts) {
      times.set(summary.cut.height, summary.finalized_at_millis);
    }
    if (!times.has(height)) {
      times.set(height, null);
    }
  }
  return times;
}
