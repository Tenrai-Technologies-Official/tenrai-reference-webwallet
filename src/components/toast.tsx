import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type Tone = "good" | "bad";
type Notify = (message: string, tone?: Tone) => void;

const ToastContext = createContext<Notify>(() => {});

/** One short message at a time, gone after a few seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; tone: Tone; at: number }>();

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(undefined), 5_000);
    return () => clearTimeout(timer);
  }, [toast]);

  const notify = useCallback<Notify>((message, tone = "good") => setToast({ message, tone, at: Date.now() }), []);

  return (
    <ToastContext value={notify}>
      {children}
      {toast && (
        <div key={toast.at} className="toast" data-tone={toast.tone} role="status">
          {toast.message}
        </div>
      )}
    </ToastContext>
  );
}

export function useToast(): Notify {
  return useContext(ToastContext);
}
