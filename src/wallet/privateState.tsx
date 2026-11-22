import type { PrivateTransferStatus } from "@tenrai/sdk";
import {
  ProofFailure,
  browserProver,
  proofEstimate,
  proverThreads,
  type PrivateNotes,
  type PrivateRegistrationQuote,
  type PrivateNotesResult,
  type PrivateProver,
  type PrivateRecord,
  type PrivateSend,
  type PrivateUsability,
  type ProofEstimate,
  type ProofKind,
  type ProofProgress,
} from "@tenrai/sdk/wallet";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useToast } from "../components/toast.tsx";
import { trai } from "../format.ts";
import { problem as problemText } from "../problem.ts";
import { tenrai } from "../tenrai.ts";
import { useSession } from "./session.tsx";

const REFRESH_MILLIS = 60_000;
const WAITING_MILLIS = 10_000;
const TICK_MILLIS = 2_500;

interface Worked {
  share: number;
  began: number;
  checking: boolean;
  total: number;
  stage: { share: number; at: number } | null;
  /** No estimate once the expected duration elapses. */
  left: number | null;
}

/** Use elapsed time to estimate progress between reported stages. */
function advanced(running: Worked): Worked {
  const elapsed = Date.now() - running.began;
  const stage = running.stage;
  const total = stage && stage.share >= 0.15 ? stage.at / stage.share : running.total;
  const share = Math.max(running.share, stage?.share ?? 0, Math.min(elapsed / total, 0.97));
  const left = Math.round((total - elapsed) / 1000);
  return { ...running, share, left: left >= 5 ? left : null };
}

export interface PrivateState {
  available: boolean;
  status: PrivateTransferStatus | null | undefined;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  address: string | undefined;
  result: PrivateNotesResult | undefined;
  checking: boolean;
  problem: string;
  usability: PrivateUsability | undefined;
  registered: boolean | null;
  registering: boolean;
  planRegistration: (maximumFeeAtoms: bigint) => Promise<PrivateRegistrationQuote>;
  cancelRegistration: (quote: PrivateRegistrationQuote) => void;
  register: (quote: PrivateRegistrationQuote) => Promise<void>;
  onTheWay: PrivateSend[];
  recent: PrivateRecord[];
  unknownPage(after?:string,limit?:number):Promise<{ids:string[];next:string|null}>;
  unknownOutcome(id:string):Promise<{closedAt:{height:number}}|null>;
  refresh: (rescan?: boolean) => Promise<void>;
  page:(after?:number)=>Promise<void>;
  retry: (digest: string) => Promise<void>;
  freeNotes: { note: number; valueAtoms: bigint }[];
  proof: Worked | null;
  estimate: (kind: ProofKind) => ProofEstimate;
  cancel: () => void;
  enter: (amount: bigint, to: string | undefined) => Promise<void>;
  transfer: (amount: bigint, to: string) => Promise<void>;
  exit: (to: string, notes: number[]) => Promise<void>;
  isRecipient: (address: string) => Promise<boolean>;
  /** Open the Private tab with an optional payment draft. */
  open: (send?: { to: string; amount: string }) => void;
  takePreset: () => { to: string; amount: string } | null;
}

const PrivateContext = createContext<PrivateState | null>(null);

export function usePrivate(): PrivateState {
  const state = useContext(PrivateContext);
  if (!state) {
    throw new Error("usePrivate needs an open wallet");
  }
  return state;
}

let scriptPolicy: { createScriptURL(url: string): string } | undefined;

/** Restrict the Trusted Types policy to the prover worker URL. */
function startWorker(url: URL): Worker {
  const types = (globalThis as unknown as { trustedTypes?: { createPolicy(name: string, rules: { createScriptURL(url: string): string }): { createScriptURL(url: string): string } } }).trustedTypes;
  if (!types) return new Worker(url, { type: "module" });
  scriptPolicy ??= types.createPolicy("tenrai-prover", {
    createScriptURL: (value) => {
      if (value !== new URL("/prover/worker.js", window.location.origin).href) throw new Error("this page starts one worker only");
      return value;
    },
  });
  return new Worker(scriptPolicy.createScriptURL(url.href), { type: "module" });
}

const prover = browserProver({ folder: new URL("/prover/", window.location.origin), createWorker: startWorker });

/** Keep private wallet state across tab changes. */
export function PrivateProvider({ onOpen, children }: { onOpen: () => void; children: ReactNode }) {
  const { wallet, history, refresh: readWallet } = useSession();
  const notify = useToast();
  const [status, setStatus] = useState<PrivateTransferStatus | null | undefined>(undefined);
  const [enabled, setEnabledState] = useState(() => history.privateTransfers);
  const [result, setResult] = useState<PrivateNotesResult>();
  const [address, setAddress] = useState<string>();
  const [problem, setProblem] = useState("");
  const [checking, setChecking] = useState(false);
  const [usability, setUsability] = useState<PrivateUsability>();
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [registering, setRegistering] = useState(false);
  const [onTheWay, setOnTheWay] = useState<PrivateSend[]>([]);
  const [recent, setRecent] = useState<PrivateRecord[]>([]);
  const [proof, setProof] = useState<Worked | null>(null);
  const notes = useRef<PrivateNotes | undefined>(undefined);
  const busy = useRef(false);
  const checkedAt = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const preset = useRef<{ to: string; amount: string } | null>(null);
  const registeringNow = useRef(false);
  registeringNow.current = registering;

  useEffect(() => {
    let live = true;
    tenrai.privateTransfers.status().then(
      (value) => live && setStatus(value),
      () => live && setStatus(null),
    );
    return () => {
      live = false;
    };
  }, []);

  const showLists = useCallback(() => {
    setOnTheWay(notes.current?.onTheWay() ?? []);
    setRecent(notes.current?.recent() ?? []);
  }, []);

  const unknownPage=useCallback((after?:string,limit=10)=>notes.current?.unknownOutcomes({...(after===undefined?{}:{after}),limit})??Promise.resolve({ids:[],next:null}),[]);
  const unknownOutcome=useCallback((id:string)=>notes.current?.unknownOutcome(id)??Promise.resolve(null),[]);

  const refresh = useCallback(
    async (rescan = false) => {
      const open = notes.current;
      if (!open || busy.current) return;
      busy.current = true;
      let again = false;
      setChecking(true);
      try {
        if (registered !== true) {
          const published = await open.registrationStatus();
          if (notes.current !== open) return;
          setRegistered(published);
          for (const outcome of await open.checkRegistrations()) {
            readWallet(outcome.outcome === "final" ? outcome.height : undefined);
          }
          showLists();
          if (!published) { setProblem(""); return; }
        }
        const read = await open.refresh({ rescan });
        if (notes.current !== open) return;
        setResult(read);
        setProblem("");
        for (const payment of read.received) notify(`Private payment received: ${trai(BigInt(payment.amountAtoms))}`);
        // Reconcile or retry pending submissions at the new cut.
        if (open.onTheWay().length) {
          for (const outcome of await open.check(read.height)) {
            again = true;
            // ENTER and EXIT can change the public balance or release reserved inputs.
            readWallet(outcome.outcome === "final" ? outcome.height : undefined);
            if (outcome.outcome === "final") notify(`The private transaction ran in final cut ${outcome.height}.`);
            else if (outcome.outcome === "expired") notify("A private transaction expired unused; its notes and coins are free again.");
            else if(outcome.outcome==="unknown")notify("The expired payment outcome remains unknown. Its active hold was closed using verified current state; do not create a replacement payment automatically.");
            else notify(`The node refused a private transaction: ${problemText(outcome.reason)}. Its original payment remains retained.`);
          }
        }
        const nowRegistered = await open.registered();
        if (notes.current !== open) return;
        setRegistered(nowRegistered);
        if (nowRegistered) setRegistering(false);
      } catch (failure) {
        if (notes.current === open) setProblem(`The private notes could not be checked: ${problemText(failure)}`);
      } finally {
        busy.current = false;
        checkedAt.current = again ? 0 : Date.now();
        setChecking(false);
        showLists();
      }
    },
    [notify, showLists, readWallet, registered],
  );

  const on = enabled && status?.active === true;

  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    void (async () => {
      try {
        const opened = await wallet.privateNotes(tenrai);
        if (!live) {
          opened.close();
          return;
        }
        notes.current = opened;
        setAddress(opened.address);
        setUsability(await opened.usability());
        await refresh();
      } catch (failure) {
        if (live) setProblem(`The private notes cannot be checked here: ${problemText(failure)}`);
      }
    })();
    return () => {
      live = false;
      controller.current?.abort();
      notes.current?.close();
      notes.current = undefined;
      busy.current = false;
      setResult(undefined);
      setAddress(undefined);
      setProblem("");
      setRegistered(null);
      setRegistering(false);
      setUsability(undefined);
      setOnTheWay([]);
      setRecent([]);
    };
    // The notes open once per wallet and switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, wallet]);

  useEffect(() => {
    if (!on) return undefined;
    const timer = setInterval(() => {
      const open = notes.current;
      if (!open || document.hidden) return;
      const waiting = registeringNow.current || open.onTheWay().length > 0;
      if (Date.now() - checkedAt.current >= (waiting ? WAITING_MILLIS : REFRESH_MILLIS)) void refresh();
    }, TICK_MILLIS);
    return () => clearInterval(timer);
  }, [on, refresh]);

  const setEnabled = useCallback(
    (value: boolean) => {
      if (!value && (controller.current || notes.current?.onTheWay().length)) {
        notify("A private transaction is still on its way; this can be switched off once it is done.");
        return;
      }
      history.setPrivateTransfers(value);
      setEnabledState(value);
    },
    [history, notify],
  );

  const estimate = useCallback((kind: ProofKind) => proofEstimate(kind, { lastSeconds: history.proofSeconds[`${kind}:${proverThreads()}`] }), [history]);
  const proving = proof !== null;
  useEffect(() => {
    if (!proving) return undefined;
    const timer = setInterval(() => setProof((running) => running && advanced(running)), 1000);
    return () => clearInterval(timer);
  }, [proving]);

  const prove = useCallback(
    async (kind: ProofKind, work: (options: { prover: PrivateProver; signal: AbortSignal; onProgress: (progress: ProofProgress) => void }) => Promise<PrivateSend>) => {
      const abort = new AbortController();
      controller.current = abort;
      setProof({ share: 0, began: Date.now(), checking: false, total: estimate(kind).expected * 1000, stage: null, left: null });
      // Store prover duration separately from submission time.
      const timed: PrivateProver = {
        prove: async (input, options) => {
          const began = Date.now();
          const made = await prover.prove(input, options);
          history.setProofSeconds(`${kind}:${proverThreads()}`, Math.max(1, Math.round((Date.now() - began) / 1000)));
          return made;
        },
      };
      try {
        await work({
          prover: timed,
          signal: abort.signal,
          onProgress: ({ share, elapsedMillis }) => setProof((running) => running && advanced({ ...running, stage: { share, at: elapsedMillis } })),
        });
        notify("The private transaction went to the node. It stays on the way until a final cut runs it.");
      } catch (failure) {
        if (failure instanceof ProofFailure && failure.kind === "cancelled") {
          notify("The proof was cancelled. Nothing was sent; your notes and coins stay free.");
          return;
        }
        throw failure;
      } finally {
        controller.current = null;
        setProof(null);
        showLists();
      }
    },
    [notify, showLists, estimate, history],
  );

  const reserved = new Set(onTheWay.flatMap((entry) => entry.sources));
  const state: PrivateState = {
    available: status?.active === true,
    status,
    enabled,
    setEnabled,
    address,
    result,
    checking,
    problem,
    usability,
    registered,
    registering,
    planRegistration: async (maximumFeeAtoms) => {
      const open = notes.current;
      if (!open) throw new Error("The private notes are not open.");
      return open.planRegistration({ maximumFeeAtoms, change: { branch: "receive", index: 0 } });
    },
    cancelRegistration: (quote) => notes.current?.cancelRegistration(quote),
    register: async (quote) => {
      const open = notes.current;
      if (!open) throw new Error("The private notes are not open.");
      // The registration uses the head at signing. Refresh after submission.
      let sent;
      try { sent = await open.register(quote); }
      finally { showLists(); }
      setRegistering(true);
      notify(`The registration was sent. Funding transaction: ${sent.digest}`);
    },
    onTheWay,
    recent,unknownPage,unknownOutcome,
    refresh,
    page:async(after)=>{
      const open=notes.current;const previous=result;
      if(!open||!previous)return;
      try{
        const page=await open.page(after===undefined?{}:{after});
        if(notes.current===open)setResult(current=>current===previous?{...current,notes:page.notes,nextNote:page.nextNote}:current);
      }catch(error){notify("The local private note page could not be read: "+problemText(error));}
    },
    retry: async (digest) => {
      const open = notes.current;
      if (!open) throw new Error("the private notes are not open");
      try {
        if (!open.onTheWay().some((send) => send.digest === digest && send.kind === "private_register")) await open.refresh();
        await open.retry(digest);
        notify("The original private payment was retried with the same proof and digest.");
      } finally { showLists(); }
    },
    freeNotes: (result?.notes ?? []).filter((note) => !reserved.has(note.note)),
    proof,
    estimate,
    cancel: () => controller.current?.abort(),
    enter: (amount, to) => {
      const open = notes.current;
      if (!open) throw new Error("the private notes are not open");
      return prove("large", (options) => open.enter({ amount, ...(to === undefined ? {} : { to }) }, options));
    },
    transfer: (amount, to) => {
      const open = notes.current;
      if (!open) throw new Error("the private notes are not open");
      return prove("large", (options) => open.transfer({ to, amount }, options));
    },
    exit: (to, chosen) => {
      const open = notes.current;
      if (!open) throw new Error("the private notes are not open");
      return prove("exit", (options) => open.exit({ to, notes: chosen }, options));
    },
    isRecipient: (recipient) => notes.current?.registered(recipient) ?? Promise.resolve(false),
    open: (send) => {
      preset.current = send ?? null;
      onOpen();
    },
    takePreset: () => {
      const taken = preset.current;
      preset.current = null;
      return taken;
    },
  };
  return <PrivateContext.Provider value={state}>{children}</PrivateContext.Provider>;
}
