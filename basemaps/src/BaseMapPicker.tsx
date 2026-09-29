import type { CSSProperties } from "react";
import { BASE_MAP_HINTS, BASE_MAP_IDS, BASE_MAP_LABELS } from "./basemaps";
import type { BaseMapId } from "./basemaps";

export interface BaseMapPickerProps {
  value: BaseMapId;
  onChange: (id: BaseMapId) => void;
  /** Group heading. Default "Base map"; pass "" when the panel supplies its own. */
  title?: string;
  /** Class for each option's <label>; apps pass their own toggle-row class. */
  optionClassName?: string;
  /** Class for the heading; when given, the heading takes only that class
   *  (no inline styling) so it matches the panel's other section heads. */
  titleClassName?: string;
  /** Show the one-line hint under each option. Default true. */
  hints?: boolean;
}

// Small inline swatches so the picker looks right in every app's Layers panel
// without a CSS change in 99 repos. Streets: paper with a road; aerial: field
// and roof; hybrid: aerial with a label stripe.
const SWATCH: Record<BaseMapId, CSSProperties> = {
  streets: {
    background:
      "linear-gradient(135deg, #f4efe6 0 45%, #ffffff 45% 55%, #f4efe6 55%)",
    border: "1px solid #c9c2b4",
  },
  aerial: {
    background:
      "linear-gradient(135deg, #3e6b3a 0 60%, #6b5f4b 60% 80%, #4d7a44 80%)",
    border: "1px solid #2f4a2c",
  },
  hybrid: {
    background:
      "linear-gradient(135deg, #3e6b3a 0 45%, #f5f5f0 45% 55%, #4d7a44 55%)",
    border: "1px solid #2f4a2c",
  },
};

const swatchBase: CSSProperties = {
  display: "inline-block",
  width: 16,
  height: 16,
  borderRadius: 3,
  flex: "0 0 auto",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  cursor: "pointer",
};

const hintStyle: CSSProperties = {
  margin: "0 0 6px 32px",
  fontSize: "0.8em",
  opacity: 0.75,
};

/**
 * Radio group for the Layers panel: Streets / Aerial / Aerial + labels.
 * Style-agnostic: layout is inline, colours inherit from the panel.
 */
export default function BaseMapPicker({
  value,
  onChange,
  title = "Base map",
  optionClassName,
  titleClassName,
  hints = true,
}: BaseMapPickerProps) {
  return (
    <fieldset
      role="radiogroup"
      aria-label={title || "Base map"}
      style={{ border: 0, margin: "0 0 10px", padding: 0, minWidth: 0 }}
    >
      {title === "" ? null : titleClassName ? (
        <legend className={titleClassName} style={{ padding: 0 }}>{title}</legend>
      ) : (
        <legend style={{ fontWeight: 600, padding: 0, marginBottom: 6 }}>{title}</legend>
      )}
      {BASE_MAP_IDS.map((id) => (
        <div key={id}>
          <label className={optionClassName} style={rowStyle}>
            <input
              type="radio"
              name="fleet-basemap"
              value={id}
              checked={value === id}
              onChange={() => onChange(id)}
              style={{ margin: 0, cursor: "pointer" }}
            />
            <span aria-hidden="true" style={{ ...swatchBase, ...SWATCH[id] }} />
            {BASE_MAP_LABELS[id]}
          </label>
          {hints && <p style={hintStyle}>{BASE_MAP_HINTS[id]}</p>}
        </div>
      ))}
    </fieldset>
  );
}
