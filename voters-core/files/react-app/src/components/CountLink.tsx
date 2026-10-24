import type { ReactNode } from "react";

interface CountLinkProps {
  /**
   * What the click gives the reader, as a sentence that carries the number:
   * "Show the 3,862 voters who returned a ballot on Mon Oct 19". It is the
   * hover text and the accessible name, so a screen reader hears what the
   * link does rather than a bare figure.
   */
  title: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * A count that is also a link to the voters behind it.
 *
 * A button styled as a link, not an anchor: it narrows the app rather than
 * navigating, and an <a> without an href would promise assistive tech a
 * destination that is not there. The click does not bubble, because counts
 * usually sit inside a row, bar or tile that has a click of its own.
 */
export default function CountLink({
  title,
  onClick,
  children,
  className,
}: CountLinkProps) {
  return (
    <button
      type="button"
      className={`count-link${className ? ` ${className}` : ""}`}
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
