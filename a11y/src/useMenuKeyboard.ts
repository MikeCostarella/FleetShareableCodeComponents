import { useEffect, type RefObject } from "react";
import { nextMenuIndex, type MenuKey } from "./a11y";

const MENU_ITEMS =
  '[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled]),[role="menuitemcheckbox"]:not([disabled])';
const PLAIN_ITEMS = "button:not([disabled]),a[href]";

interface Args {
  open: boolean;
  /** The menu panel. */
  panelRef: RefObject<HTMLElement | null>;
  /** The hamburger button that opens it. */
  buttonRef: RefObject<HTMLElement | null>;
  close: () => void;
}

/**
 * Keyboard support for the fleet's hamburger menu. The fleet has two styles
 * and this handles both:
 *
 *   - ARIA menu (panel has role="menu", items role="menuitem"...): the
 *     pattern promises arrow keys, so ArrowDown / ArrowUp move and wrap,
 *     Home / End jump, Tab closes the menu and moves on.
 *   - Disclosure (a plain panel of buttons and links): Tab moves between
 *     items as normal; the arrow keys work too, as a bonus.
 *
 * Either way, opening moves focus to the first item, and Escape closes and
 * returns focus to the hamburger button (WCAG 2.1.1, 2.4.3).
 */
export function useMenuKeyboard({ open, panelRef, buttonRef, close }: Args) {
  useEffect(() => {
    if (!open) return;
    const items = () => {
      const panel = panelRef.current;
      if (!panel) return [];
      const sel = panel.getAttribute("role") === "menu" ? MENU_ITEMS : PLAIN_ITEMS;
      return Array.from(panel.querySelectorAll<HTMLElement>(sel));
    };
    const raf = window.requestAnimationFrame(() => items()[0]?.focus());

    const onKey = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        buttonRef.current?.focus();
        return;
      }
      if (!panel.contains(document.activeElement)) return;
      if (e.key === "Tab") {
        if (panel.getAttribute("role") === "menu") close();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const list = items();
        const i = list.indexOf(document.activeElement as HTMLElement);
        const next = nextMenuIndex(i, list.length, e.key as MenuKey);
        if (next >= 0) list[next].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, panelRef, buttonRef, close]);
}

export default useMenuKeyboard;
