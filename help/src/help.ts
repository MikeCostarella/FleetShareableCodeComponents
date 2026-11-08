import type { ReactNode } from "react";

/**
 * One help topic. An app registers an array of these with <HelpProvider>; the
 * drawer renders them in order, grouped by `group`, and the search box matches
 * the title, keywords and the rendered text of the body.
 *
 * Bodies are plain JSX, so a topic can quote live numbers (build the array in
 * a useMemo over the app's data) and link to other topics with <HelpLink>.
 */
export interface HelpTopic {
  /** Stable id: used by useHelp().open(id), <HelpButton topic>, and #help-<id> anchors. */
  id: string;
  title: string;
  /** Heading the topic is listed under in the contents ("Getting started", "Views" …). */
  group?: string;
  /** Extra words the search should match that the text may not contain. */
  keywords?: string[];
  body: ReactNode;
  /** Ids of topics shown as "See also" links under this one. */
  related?: string[];
}

/** Lower-case, strip accents and punctuation, collapse spaces. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True when every word of the query appears (as a word prefix) in the haystack. */
export function matches(query: string, haystack: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const words = ` ${normalize(haystack)} `;
  return q.split(" ").every((w) => words.includes(` ${w}`));
}

/** Topics in their registered order, grouped; groups keep first-appearance order. */
export function groupTopics(topics: HelpTopic[]): { group: string; topics: HelpTopic[] }[] {
  const out: { group: string; topics: HelpTopic[] }[] = [];
  for (const t of topics) {
    const g = t.group ?? "";
    let bucket = out.find((b) => b.group === g);
    if (!bucket) out.push((bucket = { group: g, topics: [] }));
    bucket.topics.push(t);
  }
  return out;
}

/** Anchor id of a topic's section inside the drawer. */
export const anchorId = (id: string) => `help-${id}`;
