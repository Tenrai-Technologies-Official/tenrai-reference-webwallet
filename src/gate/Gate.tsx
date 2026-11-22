import type { Network, NodeInfo } from "@tenrai/sdk";
import type { Wallet } from "@tenrai/sdk/wallet";
import { useEffect, useState } from "react";
import { AppBar, Footer } from "../components/layout.tsx";
import { ThemeToggle } from "../components/theme.tsx";
import { count } from "../format.ts";
import { problem } from "../problem.ts";
import { protocolReady, tenrai } from "../tenrai.ts";
import { savedNetwork } from "../vault.ts";
import type { History } from "../wallet/history.ts";
import { Create } from "./Create.tsx";
import { Restore } from "./Restore.tsx";
import { Unlock } from "./Unlock.tsx";
import { GateLifetime } from "./lifetime.ts";

export interface Opened {
  wallet: Wallet;
  network: Network;
  history: History;
}

type Mode = "unlock" | "create" | "restore";

/** A node that is away comes back: the page must not need a reload to notice. */
const NODE_RETRY_MILLIS = 3_000;

/** Everything before a wallet is open: unlock the saved one, create one or restore one. */
export function Gate({ onOpen }: { onOpen: (opened: Opened) => void }) {
  const [mode, setMode] = useState<Mode>(savedNetwork() ? "unlock" : "create");
  const [node, setNode] = useState<NodeInfo>();
  const [error, setError] = useState<string>();
  const [lifetime] = useState(() => new GateLifetime());
  useEffect(() => { lifetime.resume(); return () => { void lifetime.stop(); }; }, [lifetime]);
  const choose = (next: Mode) => {
    if (next === mode) return;
    void lifetime.cancel();
    setMode(next);
  };

  useEffect(() => {
    let open = true;
    let timer: ReturnType<typeof setTimeout>;
    const ask = () => {
      Promise.all([tenrai.node.info(), protocolReady]).then(
        ([info]) => {
          if (open) {
            setNode(info);
          }
        },
        (failure: unknown) => {
          if (open) {
            setError(problem(failure));
            timer = setTimeout(ask, NODE_RETRY_MILLIS);
          }
        },
      );
    };
    ask();
    return () => {
      open = false;
      clearTimeout(timer);
    };
  }, []);

  const network = node?.network;

  return (
    <div className="gate">
      <AppBar>
        <ThemeToggle />
      </AppBar>
      <main className="gate__center">
        <div className="gate__card">
          {mode === "unlock" ? (
            <Unlock network={network} lifetime={lifetime} onOpen={onOpen} onRestore={() => choose("restore")} onForget={() => choose("create")} />
          ) : (
            <>
              <div className="segment" role="tablist" aria-label="Set up a wallet">
                <button type="button" role="tab" aria-selected={mode === "create"} onClick={() => choose("create")}>
                  Create
                </button>
                <button type="button" role="tab" aria-selected={mode === "restore"} onClick={() => choose("restore")}>
                  Restore
                </button>
              </div>
              {mode === "create" ? <Create network={network} lifetime={lifetime} onOpen={onOpen} /> : <Restore network={network} lifetime={lifetime} onOpen={onOpen} />}
              {savedNetwork() && (
                <button type="button" className="link" onClick={() => choose("unlock")}>
                  Back to the wallet saved on this device
                </button>
              )}
            </>
          )}
          <div className="gate__network">
            <p className="net-line">
              <span className="dot" data-state={node ? "up" : undefined} />
              {node ? `${node.network} network, cut ${count(node.finalized.height)}` : (error ?? "Connecting to the node…")}
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export function passwordProblem(password: string, repeat: string): string | undefined {
  if (password.length < 12) {
    return "Choose a password of 12 characters or more.";
  }
  return password === repeat ? undefined : "The two passwords differ.";
}
