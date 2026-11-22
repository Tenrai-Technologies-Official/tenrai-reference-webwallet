import { useEffect, useId, useRef, useState } from "react";

/** A question mark beside a label that explains it on hover, on focus or when tapped. */
export function Hint({ label, children }: { label: string; children: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <span className="hint" data-open={open} ref={ref}>
      <button type="button" className="hint__button" aria-label={label} aria-describedby={id} onClick={() => setOpen((shown) => !shown)}>
        ?
      </button>
      <span className="hint__text" id={id} role="tooltip">
        {children}
      </span>
    </span>
  );
}
