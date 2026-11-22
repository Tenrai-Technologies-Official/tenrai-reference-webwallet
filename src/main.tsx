import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ToastProvider } from "./components/toast.tsx";
import { warnInConsole } from "./consoleWarning.ts";
import "./styles.css";

if (window.top !== window.self) throw new Error("the wallet does not run inside a frame");

warnInConsole();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
