import { useEffect, useRef, type ReactNode } from "react";
import { CloseIcon } from "./icons.tsx";

/** Modal dialog; Escape and the close button call `onClose`, a sheet on phones. */
export function Dialog({
  title,
  onClose,
  actions,
  children,
}: {
  title: string;
  onClose: () => void;
  /** Small buttons beside the title. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  return (
    <dialog ref={ref} className="sheet" aria-label={title} onClose={onClose}>
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title-line">
            <h2 className="dialog__title">{title}</h2>
            {actions}
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
