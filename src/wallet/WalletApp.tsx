import type { Network } from "@tenrai/sdk";
import type { Wallet } from "@tenrai/sdk/wallet";
import { type ReactNode, useEffect, useState } from "react";
import { ChatIcon, SettingsIcon, ShieldIcon, StakingIcon, WalletIcon } from "../components/icons.tsx";
import { AppBar, Footer } from "../components/layout.tsx";
import { ThemeToggle } from "../components/theme.tsx";
import { count } from "../format.ts";
import { progress, useNodeSync } from "../sync.ts";
import { CompoundReminder } from "./CompoundReminder.tsx";
import type { History } from "./history.ts";
import { Home } from "./Home.tsx";
import { MessengerTab } from "./Messenger.tsx";
import { MessengerProvider, useMessenger } from "./messengerState.tsx";
import { PrivateTab } from "./Private.tsx";
import { PrivateProvider, usePrivate } from "./privateState.tsx";
import { SessionProvider, useSession } from "./session.tsx";
import { Settings } from "./Settings.tsx";
import { Staking } from "./Staking.tsx";

type Tab = "wallet" | "private" | "messenger" | "staking" | "settings";

const TABS: [Tab, string, ReactNode][] = [
  ["wallet", "Wallet", <WalletIcon />],
  ["private", "Private", <ShieldIcon />],
  ["messenger", "Messenger", <ChatIcon />],
  ["staking", "Staking", <StakingIcon />],
  ["settings", "Settings", <SettingsIcon />],
];

export function WalletApp({ wallet, network, history, onLock }: { wallet: Wallet; network: Network; history: History; onLock: () => void }) {
  return (
    <SessionProvider wallet={wallet} network={network} history={history} onLock={onLock}>
      <Layout />
    </SessionProvider>
  );
}

function Layout() {
  const [tab, setTab] = useState<Tab>("wallet");
  return (
    <PrivateProvider onOpen={() => setTab("private")}>
      <MessengerProvider onOpen={() => setTab("messenger")}>
        <Shell tab={tab} setTab={setTab} />
      </MessengerProvider>
    </PrivateProvider>
  );
}

function Shell({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  const { network, data, lock } = useSession();
  const messenger = useMessenger();
  const sync = useNodeSync();
  const privately = usePrivate();
  const privateShown = privately.enabled && privately.available;
  const shown = TABS.filter(([id]) => (id !== "messenger" || messenger.active) && (id !== "private" || privateShown));
  useEffect(() => {
    if ((tab === "messenger" && !messenger.active) || (tab === "private" && !privateShown)) {
      setTab("wallet");
    }
  }, [tab, messenger.active, privateShown, setTab]);

  return (
    <div className="app">
      <AppBar>
        <ul className="pills">
          <li className="pills__network">{network}</li>
          {data && <li>cut {count(data.balance.indexedHeight)}</li>}
          {sync && (
            <li className="pills__syncing" title={`The node is not synchronized yet (${progress(sync)}); sending waits until it is.`}>
              not synced
            </li>
          )}
        </ul>
        <ThemeToggle />
        <button type="button" className="btn btn--ghost btn--small" onClick={lock}>
          Lock
        </button>
      </AppBar>
      <nav className="tabs" role="tablist" aria-label="Wallet sections">
        {shown.map(([id, label, icon]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {icon}
            <span>{label}</span>
            {id === "private" && privately.proof && <span className="tabs__count">{Math.round(privately.proof.share * 100)}%</span>}
            {id === "messenger" && messenger.unread > 0 && (
              <span className="tabs__count" aria-label={`${messenger.unread} unread`}>
                {messenger.unread > 99 ? "99+" : messenger.unread}
              </span>
            )}
          </button>
        ))}
      </nav>
      <main className="page">
        {tab === "wallet" && <Home />}
        {tab === "private" && <PrivateTab />}
        {tab === "messenger" && <MessengerTab />}
        {tab === "staking" && <Staking />}
        {tab === "settings" && <Settings />}
      </main>
      <Footer />
      <CompoundReminder />
    </div>
  );
}
