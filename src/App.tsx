import { useCallback, useState } from "react";
import { Gate, type Opened } from "./gate/Gate.tsx";
import { WalletApp } from "./wallet/WalletApp.tsx";

export function App() {
  const [opened, setOpened] = useState<Opened>();
  const lock = useCallback(() => setOpened(undefined), []);

  if (!opened) {
    return <Gate onOpen={setOpened} />;
  }
  return <WalletApp wallet={opened.wallet} network={opened.network} history={opened.history} onLock={lock} />;
}
