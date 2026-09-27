/**
 * One-line carriage-return progress, padded (Statehouse #10).
 *
 * Nine of the ten harvest scripts wrote `\r` without padding, so when a counter
 * line shortened — the transition from "1,000,000 / 1,000,000 features" back to
 * a short sweep counter — the tail of the previous line stayed on screen and
 * the run looked like it was reporting something it was not.
 */
export function progress({ label = "", total = null, stream = process.stdout, width = 60 } = {}) {
  let n = 0;
  const render = (text) => {
    if (!stream || !stream.write) return;
    stream.write(`\r  ${text}`.padEnd(width));
  };
  const line = () =>
    total == null
      ? `${label}${n.toLocaleString()}`
      : `${label}${n.toLocaleString()} / ${total.toLocaleString()}`;

  return {
    tick(by = 1) {
      n += by;
      render(line());
      return n;
    },
    set(value) {
      n = value;
      render(line());
      return n;
    },
    note(text) {
      render(text);
    },
    done(text = null) {
      if (text !== null) render(text);
      if (stream && stream.write) stream.write("\n");
      return n;
    },
    get count() {
      return n;
    },
    /** Exposed for tests: the string that would be rendered right now. */
    _line: line,
  };
}
