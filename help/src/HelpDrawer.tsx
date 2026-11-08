import { useEffect, useMemo, useRef, useState } from "react";
import { useHelp } from "./HelpContext";
import { anchorId, groupTopics, matches } from "./help";

/**
 * The help pane: anchored to the right edge, non-modal (no backdrop; the app
 * stays usable beside it so a reader can try what a topic describes). Focus
 * moves in when it opens — to the requested topic, else the search box — and
 * back to whatever opened it on close. Escape closes. While closed it is
 * hidden from the tab order and from assistive tech.
 *
 * Search matches every word of the query against each topic's title,
 * keywords and rendered text; the contents and the sections filter together.
 */
export default function HelpDrawer() {
  const help = useHelp();
  const { topics, isOpen, topic, seq, close, open } = help;
  const [query, setQuery] = useState("");
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Index the rendered text of every topic once it has rendered (and when topics change).
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    const next: Record<string, string> = {};
    for (const t of topics) {
      const el = root.querySelector<HTMLElement>(`#${anchorId(t.id)} .fh-topic-body`);
      next[t.id] = el?.textContent ?? "";
    }
    setTexts(next);
  }, [topics]);

  const visible = useMemo(() => {
    const q = query.trim();
    if (!q) return new Set(topics.map((t) => t.id));
    return new Set(topics.filter((t) => matches(q, [t.title, t.group ?? "", ...(t.keywords ?? []), texts[t.id] ?? ""].join(" "))).map((t) => t.id));
  }, [query, topics, texts]);

  const groups = useMemo(() => groupTopics(topics), [topics]);
  const byId = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);

  // On every open(): clear a stale search, then go to the topic (or the top).
  useEffect(() => {
    if (!isOpen) return;
    if (topic) setQuery("");
    const t = window.setTimeout(() => {
      const pane = bodyRef.current;
      if (!pane) return;
      const el = topic ? pane.querySelector<HTMLElement>(`#${anchorId(topic)}`) : null;
      if (el) {
        pane.scrollTop = el.offsetTop - pane.offsetTop - 8;
        el.focus({ preventScroll: true });
        setFlash(topic);
        window.setTimeout(() => setFlash(null), 1600);
      } else {
        pane.scrollTop = 0;
        searchRef.current?.focus({ preventScroll: true });
      }
    }, 60);
    return () => window.clearTimeout(t);
  }, [isOpen, topic, seq]);

  const jump = (id: string) => {
    const pane = bodyRef.current;
    const el = pane?.querySelector<HTMLElement>(`#${anchorId(id)}`);
    if (!pane || !el) return;
    pane.scrollTo({ top: el.offsetTop - pane.offsetTop - 8, behavior: "smooth" });
    el.focus({ preventScroll: true });
  };

  const shown = topics.filter((t) => visible.has(t.id)).length;

  return (
    <aside
      className={"fh-drawer" + (isOpen ? " open" : "")}
      aria-label={help.title}
      aria-hidden={!isOpen}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}
    >
      <div className="fh-head">
        <h2>{help.title}</h2>
        <button type="button" className="fh-close" onClick={close} aria-label={`Close ${help.title.toLowerCase()}`} title="Close (Esc)" tabIndex={isOpen ? 0 : -1}>×</button>
      </div>
      <div className="fh-search">
        <input
          ref={searchRef}
          type="search"
          placeholder="Search help…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search help"
          tabIndex={isOpen ? 0 : -1}
        />
        {query && <span className="fh-count">{shown} of {topics.length}</span>}
      </div>
      <div className="fh-body" ref={bodyRef} tabIndex={-1}>
        <nav className="fh-toc" aria-label="Help topics">
          {groups.map((g) => {
            const items = g.topics.filter((t) => visible.has(t.id));
            if (!items.length) return null;
            return (
              <div key={g.group || "_"} className="fh-toc-group">
                {g.group && <div className="fh-toc-title">{g.group}</div>}
                <ul>
                  {items.map((t) => (
                    <li key={t.id}>
                      <button type="button" onClick={() => jump(t.id)} tabIndex={isOpen ? 0 : -1}>{t.title}</button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {!shown && <p className="fh-empty">No topics match “{query}”.</p>}
        </nav>

        {topics.map((t) => (
          <section
            key={t.id}
            id={anchorId(t.id)}
            className={"fh-topic" + (flash === t.id ? " fh-flash" : "")}
            tabIndex={-1}
            hidden={!visible.has(t.id)}
            aria-labelledby={`${anchorId(t.id)}-h`}
          >
            {t.group && <div className="fh-topic-group">{t.group}</div>}
            <h3 id={`${anchorId(t.id)}-h`}>{t.title}</h3>
            <div className="fh-topic-body">{t.body}</div>
            {t.related?.length ? (
              <div className="fh-related">
                See also:{" "}
                {t.related.filter((r) => byId.has(r)).map((r, i) => (
                  <span key={r}>
                    {i > 0 && " · "}
                    <a href={`#${anchorId(r)}`} onClick={(e) => { e.preventDefault(); open(r); }}>{byId.get(r)!.title}</a>
                  </span>
                ))}
              </div>
            ) : null}
          </section>
        ))}
        <p className="fh-foot">Press <kbd>?</kbd> anywhere to open help · <kbd>Esc</kbd> to close.</p>
      </div>
    </aside>
  );
}
