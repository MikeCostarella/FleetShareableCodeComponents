import { useEffect, useState } from "react";

interface LiveStatusProps {
  /** Sentence to announce, e.g. countMessage(shown, "provider"). */
  message: string;
  /** Wait for the value to settle before announcing, so typing in a search
   *  box announces the final count, not every keystroke. */
  delayMs?: number;
}

/**
 * Visually hidden polite live region (WCAG 4.1.3 Status Messages). Screen
 * readers announce the message whenever it changes, without moving focus.
 * Render it once, always mounted, near the top of the app.
 */
export default function LiveStatus({ message, delayMs = 600 }: LiveStatusProps) {
  const [spoken, setSpoken] = useState("");
  useEffect(() => {
    const id = window.setTimeout(() => setSpoken(message), delayMs);
    return () => window.clearTimeout(id);
  }, [message, delayMs]);
  return (
    <div className="a11y-sr-only" role="status" aria-live="polite" aria-atomic="true">
      {spoken}
    </div>
  );
}
