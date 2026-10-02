import { useEffect, useRef } from "react";
import { FOCUSABLE_SELECTOR, trapTarget } from "./a11y";

interface Options {
  /** Close on Escape (default true). Drop the app's own Escape listener. */
  escape?: boolean;
  /** Keep Tab inside (default true). Pass false for non-modal drawers
   *  (Filters, Layers, Help): focus still moves in on open and back on close. */
  trap?: boolean;
  /** Selector to focus on close when the opener is gone, e.g. a hamburger
   *  menu item that unmounted with the menu: 'button[aria-label="Main menu"]'. */
  fallbackFocus?: string;
}

/**
 * Makes a modal dialog (or, with trap: false, a drawer) keyboard-safe
 * (WCAG 2.1.1, 2.1.2, 2.4.3):
 *   - on open, remembers what had focus and moves focus into the dialog
 *     (an element marked data-autofocus, else the dialog itself);
 *   - keeps Tab / Shift+Tab inside the dialog while it is open;
 *   - Escape closes;
 *   - on close, puts focus back where it was (the row button or marker that
 *     opened it), so keyboard users don't land at the top of the page.
 *
 * Attach the returned ref to the dialog box and give it
 * role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}.
 */
export function useDialogA11y<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void,
  { escape = true, trap = true, fallbackFocus }: Options = {},
) {
  const ref = useRef<T | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    // What had focus when it opened. <body> means the opener already went
    // away (a menu item that closed with its menu), so use fallbackFocus.
    const active0 = document.activeElement as HTMLElement | null;
    const opener = active0 && active0 !== document.body ? active0 : null;

    const focusFirst = () => {
      const box = ref.current;
      if (!box) return;
      const auto = box.querySelector<HTMLElement>("[data-autofocus]");
      (auto ?? box).focus();
    };
    // After paint, so the dialog is in the DOM and visible.
    const raf = window.requestAnimationFrame(focusFirst);

    const onKey = (e: KeyboardEvent) => {
      const box = ref.current;
      if (!box) return;
      if (e.key === "Escape" && escape) {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !trap) return;
      const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      const idx = items.indexOf(document.activeElement as HTMLElement);
      // Focus that escaped the box (e.g. a click on the backdrop) comes back in.
      const inside = box.contains(document.activeElement);
      const target = trapTarget(inside ? idx : -1, items.length, e.shiftKey);
      if (target === null) return;
      e.preventDefault();
      (target === -1 ? box : items[target]).focus();
    };
    document.addEventListener("keydown", onKey, true);

    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey, true);
      // Only pull focus back if it is still inside the box (or lost to
      // <body>); never steal it from somewhere the user moved on to.
      const active = document.activeElement;
      const box = ref.current;
      const lost = !active || active === document.body || (box && box.contains(active));
      if (!lost) return;
      if (opener && opener.isConnected && typeof opener.focus === "function") {
        opener.focus();
      } else if (fallbackFocus) {
        document.querySelector<HTMLElement>(fallbackFocus)?.focus();
      }
    };
  }, [open, escape, trap, fallbackFocus]);

  return ref;
}

export default useDialogA11y;
