import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { HelpTopic } from "./help";

interface HelpState {
  topics: HelpTopic[];
  title: string;
  isOpen: boolean;
  /** Topic the drawer was last opened on (null = top of the contents). */
  topic: string | null;
  /** Open the drawer, on a topic when given. Remembers what had focus, to return it on close. */
  open: (topic?: string | null) => void;
  close: () => void;
  /** Bumped on every open() so the drawer re-scrolls even when the topic is unchanged. */
  seq: number;
  /** Element that had focus when the drawer opened. */
  opener: React.MutableRefObject<HTMLElement | null>;
}

const Ctx = createContext<HelpState | null>(null);

interface ProviderProps {
  topics: HelpTopic[];
  /** Drawer heading. */
  title?: string;
  /** Open on "?" (Shift+/) when focus is not in a text field. Default true. */
  shortcut?: boolean;
  children: ReactNode;
}

/** Holds the app's help topics and the drawer's open state. Render <HelpDrawer /> anywhere inside it. */
export function HelpProvider({ topics, title = "Help", shortcut = true, children }: ProviderProps) {
  const [isOpen, setOpen] = useState(false);
  const [topic, setTopic] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  const opener = useRef<HTMLElement | null>(null);

  const open = useCallback((t?: string | null) => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !active.closest(".fh-drawer")) opener.current = active;
    setTopic(t ?? null);
    setSeq((n) => n + 1);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    const el = opener.current;
    if (el && document.contains(el)) window.setTimeout(() => el.focus({ preventScroll: true }), 0);
  }, []);

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      open();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut, open]);

  const value = useMemo(() => ({ topics, title, isOpen, topic, open, close, seq, opener }), [topics, title, isOpen, topic, open, close, seq]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** open(topicId?), close(), isOpen … Throws outside <HelpProvider> so a missing provider is caught early. */
export function useHelp(): HelpState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHelp() must be used inside <HelpProvider>");
  return v;
}
