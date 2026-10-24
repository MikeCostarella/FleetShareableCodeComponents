import type { ReactNode } from "react";
import { useDialogA11y } from "../vendor/a11y/useDialogA11y";
import { inertWhen } from "../vendor/a11y/inert";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Accessible name of the pane, e.g. "Help". */
  label: string;
  className?: string;
  children: ReactNode;
}

/**
 * The fleet's slide-out pane, anchored to the right edge. Non-modal: there is
 * no backdrop, the page behind stays usable, and Tab is not trapped - focus
 * moves in when it opens and back to the opener when it closes, Escape
 * closes, and while closed the pane is inert so nothing in it can take focus.
 */
export default function Drawer({
  open,
  onClose,
  title,
  label,
  className = "",
  children,
}: DrawerProps) {
  const boxRef = useDialogA11y<HTMLElement>(open, onClose, {
    trap: false,
    fallbackFocus: "#help-btn",
  });
  return (
    <aside
      className={`side-drawer ${className} ${open ? "open" : ""}`}
      ref={boxRef}
      tabIndex={-1}
      {...inertWhen(!open)}
      aria-label={label}
    >
      <div className="side-drawer-head">
        <h2>{title}</h2>
        <button
          type="button"
          className="side-drawer-close"
          onClick={onClose}
          aria-label={`Close ${label}`}
          title="Close (Esc)"
        >
          ×
        </button>
      </div>
      <div className="side-drawer-body">{children}</div>
    </aside>
  );
}
