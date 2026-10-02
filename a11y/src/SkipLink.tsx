import type { ReactNode } from "react";

interface SkipLinkProps {
  /** id of the element to land on. */
  targetId: string;
  /** Runs before focus moves, e.g. switch to the list view. */
  onActivate?: () => void;
  children: ReactNode;
}

/**
 * First focusable thing on the page (WCAG 2.4.1 Bypass Blocks). Hidden until
 * it takes keyboard focus. In the map apps it says "Skip to list view": it
 * switches to the list and moves focus there, past the map entirely.
 */
export default function SkipLink({ targetId, onActivate, children }: SkipLinkProps) {
  return (
    <a
      className="a11y-skip-link"
      href={`#${targetId}`}
      onClick={(e) => {
        e.preventDefault();
        onActivate?.();
        // Let the view switch render before focusing the target.
        window.setTimeout(() => {
          const el = document.getElementById(targetId);
          if (!el) return;
          if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
          el.focus();
        }, 50);
      }}
    >
      {children}
    </a>
  );
}
