import type { SyncStatus } from "@tenrai/sdk";
import { useEffect, useState } from "react";
import { count } from "./format.ts";
import { tenrai } from "./tenrai.ts";

const SEND_WAIT_MILLIS = 30_000;
const POLL_MILLIS = 2_000;
// Show syncing after two consecutive responses.
const WATCH_MILLIS = 5_000;

const sendAnyway: Promise<boolean> = fetch("/api/config")
  .then(async (response) => ((await response.json()) as { send_when_not_synced?: unknown }).send_when_not_synced === true)
  .catch(() => false);

/** `height 1,200, 340 cuts behind` or `height 120, no peers yet`. */
export function progress(status: SyncStatus): string {
  return status.peers === 0
    ? `height ${count(status.finalized_height)}, no peers yet`
    : `height ${count(status.finalized_height)}, ${count(status.behind_by)} cuts behind`;
}

export async function readyToSend(notify: (text: string) => void): Promise<void> {
  if (await sendAnyway) {
    return;
  }
  const started = Date.now();
  let told = false;
  for (;;) {
    let status: SyncStatus;
    try {
      status = await tenrai.node.sync();
    } catch {
      return;
    }
    if (status.synced) {
      return;
    }
    const left = SEND_WAIT_MILLIS - (Date.now() - started);
    if (left <= 0) {
      throw new Error(`The node is not synchronized (${progress(status)}), so it may not know your latest coins. Nothing was sent: try again once it has caught up.`);
    }
    if (!told) {
      notify(`The node is not synchronized yet (${progress(status)}); sending waits up to 30 s for it.`);
      told = true;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_MILLIS, left)));
  }
}

/** The node's state while it catches up, for the header; null while it is synchronized. */
export function useNodeSync(): SyncStatus | null {
  const [behind, setBehind] = useState<SyncStatus | null>(null);
  useEffect(() => {
    let stopped = false;
    let streak = 0;
    const read = async () => {
      try {
        const status = await tenrai.node.sync();
        streak = status.synced ? 0 : streak + 1;
        if (!stopped) {
          setBehind(streak >= 2 ? status : null);
        }
      } catch {
      }
    };
    void read();
    const timer = setInterval(() => void read(), WATCH_MILLIS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  return behind;
}
