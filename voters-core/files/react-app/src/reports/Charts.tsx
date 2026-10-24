import type { ReactNode } from "react";
import CountLink from "../components/CountLink";

/**
 * The chart primitives the Reports view is built from.
 *
 * Everything here is one series. That is a deliberate constraint rather than a
 * limitation of the data: each of these reports has a single thing to say, and
 * a categorical palette would spend the one free channel - hue - on identity
 * nobody needs, while burying the number that matters. Magnitude gets bar
 * length; the sequential ramp appears once, on the heatmap, which is the only
 * place a continuous value is encoded as color.
 *
 * The ramp itself (--viz-1 .. --viz-6 in tokens.css) is a single cyan hue,
 * monotone in lightness, validated against this app's own navy surface
 * (#1a2a3a) rather than a generic dark: light end 2.45:1, hue spread 6 degrees.
 * Cyan and not blue because the surface IS blue - a blue ramp's low end would
 * dissolve into the page.
 */

// -------------------------------------------------------------------- bars ---

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** 0-1. Bar length. Kept separate from `value` so a bar can be scaled to a
   *  maximum, a total, or a rate without the component guessing which. */
  fraction: number;
  /** Right-hand text. The direct label - every bar carries its own value, so
   *  no reading depends on the tooltip. */
  valueLabel: string;
  /** Extra context in the hover title only. */
  hint?: string;
  /** Marks the bar as the one the report is about. */
  emphasis?: boolean;
  note?: string;
  /**
   * Optional stacked breakdown of the bar, left to right. Each fraction is of
   * the SAME scale as `fraction` (so they sum to it), and each carries its own
   * colour: this is the one chart where identity - party - is the point, so
   * hue is spent on it. Omit for a plain single-colour bar.
   */
  segments?: {
    key: string;
    fraction: number;
    color: string;
    title?: string;
    /** The voters in this one segment. The row's own click stays the whole bar. */
    onPick?: () => void;
  }[];
}

interface BarListProps {
  data: BarDatum[];
  onPick?: (key: string) => void;
  /** Announced to screen readers and shown above the bars. */
  caption?: ReactNode;
}

/**
 * Horizontal bars, one per row, label outside on the left and value outside on
 * the right. Horizontal because every one of these categories has a long name -
 * "Feb 2026 Cortland Special" will not fit under a column - and long names are
 * exactly the case the form guide sends horizontal.
 */
export function BarList({ data, onPick, caption }: BarListProps) {
  return (
    <div className="viz-bars">
      {caption && <div className="viz-caption">{caption}</div>}
      {data.map((d) => {
        const title = d.hint ? `${d.label} — ${d.hint}` : d.label;
        const pick = onPick ? () => onPick(d.key) : undefined;
        const width = `${Math.max(0, Math.min(1, d.fraction)) * 100}%`;
        const label = (
          <span className="viz-bar-label">
            {d.label}
            {d.note && <span className="viz-bar-note">{d.note}</span>}
          </span>
        );
        const value = <span className="viz-bar-value">{d.valueLabel}</span>;
        const track = (
          <span className="viz-bar-track">
            {d.segments ? (
              <span className="viz-bar-stack" style={{ width }}>
                {d.segments.map((seg) =>
                  seg.onPick ? (
                    <button
                      type="button"
                      key={seg.key}
                      className="viz-bar-seg is-clickable"
                      title={seg.title}
                      aria-label={seg.title}
                      style={{
                        flexGrow: Math.max(0, seg.fraction),
                        background: seg.color,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        seg.onPick?.();
                      }}
                    />
                  ) : (
                    <span
                      key={seg.key}
                      className="viz-bar-seg"
                      title={seg.title}
                      style={{
                        // Flex-grow in proportion, so rounding never leaves a gap.
                        flexGrow: Math.max(0, seg.fraction),
                        background: seg.color,
                      }}
                    />
                  ),
                )}
              </span>
            ) : (
              <span
                className={`viz-bar-fill${d.emphasis ? " emphasis" : ""}`}
                style={{ width }}
              />
            )}
          </span>
        );
        if (!pick) {
          return (
            <div className="viz-bar-row" key={d.key} title={title}>
              {label}
              {track}
              {value}
            </div>
          );
        }
        // A clickable row is one button - unless its segments carry clicks of
        // their own. A button may not contain buttons, so that row is a div:
        // the label is the keyboard-reachable button for the whole bar, the
        // segments are their own buttons, and the div answers a mouse click
        // anywhere else on the row.
        if (!d.segments?.some((seg) => seg.onPick)) {
          return (
            <button
              type="button"
              className="viz-bar-row is-clickable"
              key={d.key}
              title={title}
              onClick={pick}
            >
              {label}
              {track}
              {value}
            </button>
          );
        }
        return (
          <div
            className="viz-bar-row is-clickable"
            key={d.key}
            title={title}
            onClick={pick}
          >
            <button
              type="button"
              className="viz-bar-pick"
              aria-label={`${d.label}: ${d.valueLabel}`}
              onClick={(e) => {
                e.stopPropagation();
                pick();
              }}
            >
              {label}
            </button>
            {track}
            {value}
          </div>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------- heatmap ---

/** Six steps, lightest first. Indexes into the --viz-N custom properties. */
export const RAMP_STEPS = 6;

/**
 * Which ramp step a 0-1 value lands on. Values are bucketed rather than
 * interpolated so the scale legend below the grid names exactly the colors the
 * grid uses - an interpolated fill has no legend a reader can match a cell to.
 */
export function rampStep(fraction: number): number {
  const f = Math.max(0, Math.min(0.999, fraction));
  return Math.floor(f * RAMP_STEPS) + 1;
}

export interface HeatCell {
  key: string;
  /** 0-1, drives the fill. */
  fraction: number;
  /** Text drawn in the cell. Every cell is labelled: the color is a second
   *  encoding of a number that is already written down, never the only one. */
  text: string;
  title: string;
  diagonal?: boolean;
  onPick?: () => void;
}

interface HeatGridProps {
  columnLabels: string[];
  rowLabels: string[];
  cells: HeatCell[][];
  /** Header above the column labels, e.g. "…also voted in". */
  columnHeading: string;
  rowHeading: string;
}

export function HeatGrid({
  columnLabels,
  rowLabels,
  cells,
  columnHeading,
  rowHeading,
}: HeatGridProps) {
  return (
    <div className="viz-heat-wrap">
      <div className="viz-heat-axis-note">
        <span className="viz-heat-row-heading">{rowHeading}</span>
        <span className="viz-heat-col-heading">{columnHeading}</span>
      </div>
      <div className="viz-heat-scroll">
        <table className="viz-heat">
          <thead>
            <tr>
              <th scope="col" className="viz-heat-corner" />
              {columnLabels.map((c) => (
                <th scope="col" key={c}>
                  <span>{c}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowLabels.map((r, i) => (
              <tr key={r}>
                <th scope="row">{r}</th>
                {cells[i].map((cell) => (
                  <td key={cell.key} className={cell.diagonal ? "diagonal" : ""}>
                    {cell.diagonal ? (
                      <span className="viz-heat-cell diagonal" title={cell.title}>
                        —
                      </span>
                    ) : (
                      <span
                        className={`viz-heat-cell step-${rampStep(cell.fraction)}`}
                        title={cell.title}
                        onClick={cell.onPick}
                      >
                        {cell.text}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="viz-scale" aria-hidden="true">
        <span className="viz-scale-end">0%</span>
        {Array.from({ length: RAMP_STEPS }, (_, i) => (
          <span key={i} className={`viz-scale-swatch step-${i + 1}`} />
        ))}
        <span className="viz-scale-end">100%</span>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- stat tiles ---

export interface StatTileProps {
  label: string;
  value: string;
  note?: string;
  /** Makes the value a link to the voters it counts. */
  onPick?: () => void;
  /** Hover and accessible text for that link: "Show the 14,481 voters who…". */
  pickTitle?: string;
}

/**
 * A single number is a stat tile, not a one-bar bar chart. Proportional figures
 * here on purpose - tabular-nums makes a large standalone number look loose.
 */
export function StatTile({ label, value, note, onPick, pickTitle }: StatTileProps) {
  return (
    <div className="viz-stat">
      <div className="viz-stat-value">
        {onPick ? (
          <CountLink title={pickTitle ?? `Show these voters`} onClick={onPick}>
            {value}
          </CountLink>
        ) : (
          value
        )}
      </div>
      <div className="viz-stat-label">{label}</div>
      {note && <div className="viz-stat-note">{note}</div>}
    </div>
  );
}

// -------------------------------------------------------------- line chart ---

interface LinePoint {
  x: string;
  y: number;
  label: string;
}

interface LineChartProps {
  points: LinePoint[];
  /** Points worth naming on the plot. Labelling every point is chaos; these are
   *  the ones the reader is meant to notice. */
  marked?: Set<string>;
  height?: number;
}

/**
 * Registrations over time. A line because the x axis is continuous months and
 * the question is shape, not the value of any one month.
 */
export function LineChart({ points, marked, height = 150 }: LineChartProps) {
  if (points.length < 2) return null;
  const W = 720;
  const H = height;
  const padL = 8;
  const padR = 8;
  const padT = 14;
  const padB = 22;
  const max = Math.max(...points.map((p) => p.y)) || 1;
  const xAt = (i: number) =>
    padL + (i / (points.length - 1)) * (W - padL - padR);
  const yAt = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const d = points.map((p, i) => `${i ? "L" : "M"}${xAt(i)},${yAt(p.y)}`).join(" ");

  // Roughly one tick per year, so the axis stays readable at any window length.
  const ticks = points.filter((p) => p.x.endsWith("-01"));

  return (
    <div className="viz-line-wrap">
      <svg
        className="viz-line"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Registrations per month"
      >
        <line
          className="viz-axis"
          x1={padL}
          y1={H - padB}
          x2={W - padR}
          y2={H - padB}
        />
        <path className="viz-line-path" d={d} />
        {points.map((p, i) =>
          marked?.has(p.x) ? (
            <circle
              key={p.x}
              className="viz-line-dot"
              cx={xAt(i)}
              cy={yAt(p.y)}
              r={4}
            >
              <title>{p.label}</title>
            </circle>
          ) : null,
        )}
      </svg>
      <div className="viz-line-ticks">
        {ticks.map((t) => (
          <span key={t.x}>{t.x.slice(0, 4)}</span>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- table + bar ---

/** One figure in a RankRow: plain text, or text that links to its voters. */
export type RankFigure =
  | string
  | { text: string; title: string; onPick: () => void };

export interface RankRow {
  key: string;
  name: string;
  /** Right-aligned figures, rendered in order. A figure with an `onPick` is a
   *  link to exactly the voters it counts; the row's own click is the fallback
   *  for the rest. */
  figures: RankFigure[];
  /** 0-1, the inline bar behind the name. */
  fraction: number;
  title?: string;
  onPick?: () => void;
}

interface RankTableProps {
  columns: string[];
  rows: RankRow[];
  /** Rows past this many are hidden behind a "show all" toggle by the caller. */
  nameHeading: string;
}

/**
 * A ranked table with the rate drawn as a bar behind the row. Past about seven
 * classes a chart stops being readable and a table starts being the right
 * answer; this is both, which keeps the exact value legible while the bar
 * carries the comparison.
 */
export function RankTable({ columns, rows, nameHeading }: RankTableProps) {
  return (
    <div className="viz-rank-scroll">
      <table className="viz-rank">
        <thead>
          <tr>
            <th scope="col">{nameHeading}</th>
            {columns.map((c) => (
              <th scope="col" key={c} className="num">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.key}
              title={r.title}
              className={r.onPick ? "is-clickable" : ""}
              onClick={r.onPick}
            >
              <th scope="row">
                <span
                  className="viz-rank-bar"
                  style={{ width: `${Math.max(0, Math.min(1, r.fraction)) * 100}%` }}
                  aria-hidden="true"
                />
                <span className="viz-rank-name">{r.name}</span>
              </th>
              {r.figures.map((f, i) => (
                <td key={i} className="num">
                  {typeof f === "string" ? (
                    f
                  ) : (
                    <CountLink title={f.title} onClick={f.onPick}>
                      {f.text}
                    </CountLink>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
