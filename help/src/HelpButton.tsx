import { useHelp } from "./HelpContext";

interface Props {
  /** Topic to open on; omitted = the top of the contents. */
  topic?: string;
  /** Accessible name and tooltip; defaults to "Help". */
  label?: string;
  /** "dark" for buttons on the dark masthead / stats bar. */
  tone?: "light" | "dark";
  /** Larger round button (the masthead one); default is the small inline "?". */
  size?: "sm" | "md";
  className?: string;
}

/** The round "?" that opens the help drawer, optionally on one topic. */
export default function HelpButton({ topic, label = "Help", tone = "light", size = "sm", className = "" }: Props) {
  const help = useHelp();
  return (
    <button
      type="button"
      className={`fh-btn fh-btn-${tone} fh-btn-${size} ${className}`.trim()}
      onClick={(e) => { e.stopPropagation(); help.open(topic); }}
      aria-label={label}
      title={label}
    >
      ?
    </button>
  );
}

/** Inline link to another topic, for use inside topic bodies. */
export function HelpLink({ topic, children }: { topic: string; children: React.ReactNode }) {
  const help = useHelp();
  return (
    <a href={`#help-${topic}`} className="fh-link" onClick={(e) => { e.preventDefault(); help.open(topic); }}>
      {children}
    </a>
  );
}
