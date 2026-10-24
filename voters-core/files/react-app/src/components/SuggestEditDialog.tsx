import { useEffect, useState } from "react";
import { UPDATE_RECIPIENT_EMAIL } from "../config/contact";
import { COUNTY_NAME } from "../config/county";
import type { Voter } from "../types/voter";
import { fullName, GEO_TIERS, PARTY_LABELS, partyLabel } from "../types/voter";

interface SuggestEditDialogProps {
  /** The voter being suggested for edit; null hides the dialog. */
  voter: Voter | null;
  onClose: () => void;
}

/** Editable form state mirrored from a Voter. */
interface EditForm {
  lastName: string;
  firstName: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  precinct: string;
  party: string;
  registered: string;
}

function formFromVoter(v: Voter): EditForm {
  return {
    lastName: v.lastName ?? "",
    firstName: v.firstName ?? "",
    street: v.street ?? "",
    city: v.city ?? "",
    state: v.state ?? "",
    zip: v.zip ?? "",
    precinct: v.precinct ?? "",
    party: v.party ?? "--",
    registered: v.registered ?? "",
  };
}

/** Human label for a field key, used in the change summary. */
const FIELD_LABELS: Record<keyof EditForm, string> = {
  lastName: "Last name",
  firstName: "First / middle",
  street: "Street",
  city: "City",
  state: "State",
  zip: "ZIP",
  precinct: "Precinct",
  party: "Party",
  registered: "Registered",
};

/** Render a field's display value (resolving the party code to its name). */
function displayValue(key: keyof EditForm, form: EditForm): string {
  if (key === "party") return `${partyLabel(form.party)} (${form.party})`;
  return form[key] === "" ? "(blank)" : String(form[key]);
}

/**
 * Open a mailto: WITHOUT navigating this tab away.
 *
 * `window.location.href = mailto:...` looks safe, and is what the fleet used to
 * do, because a native mail client intercepts the navigation and the page stays
 * put. But a visitor who has registered a WEB handler - Gmail, Outlook Web -
 * gets a real URL back, and assigning to location.href replaces this page with
 * the compose window. The app is gone, and when they finish sending there is
 * nothing to come back to.
 *
 * Opening in a new tab behaves correctly under both: a native client still
 * intercepts, a web handler gets its own tab, and this page survives either
 * way. If a popup blocker refuses the window we fall back to the old
 * behaviour, since losing the page beats losing the message.
 */
function openMail(url: string): void {
  const opened = window.open(url, "_blank", "noopener");
  if (!opened) window.location.href = url;
}

/**
 * "Suggest an Edit" form, matching the one in TrumbullCountyParcels. Pre-fills
 * the editable fields of the selected voter, lets the user correct any of them,
 * captures an optional note, then composes an email to the configured recipient
 * containing a field-by-field summary of only the values that changed, plus the
 * voter ID for locating the record. Primary action opens the mail client via
 * mailto; a secondary action copies the same body to the clipboard as a
 * fallback.
 *
 * A wrong dot on the map is a legitimate report even when every field above is
 * correct, so the record section carries the coordinates and how they were
 * derived, and a note on its own is enough to submit.
 */
export default function SuggestEditDialog({ voter, onClose }: SuggestEditDialogProps) {
  const [form, setForm] = useState<EditForm | null>(null);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);

  // Reset the form whenever a new voter is opened.
  useEffect(() => {
    setForm(voter ? formFromVoter(voter) : null);
    setNote("");
    setCopied(false);
  }, [voter]);

  useEffect(() => {
    if (!voter) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [voter, onClose]);

  if (!voter || !form) return null;

  const original = formFromVoter(voter);

  const set = <K extends keyof EditForm>(key: K, value: EditForm[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  // Build the list of fields the user actually changed.
  const changedKeys = (Object.keys(FIELD_LABELS) as (keyof EditForm)[]).filter(
    (k) => String(form[k]) !== String(original[k]),
  );

  const hasNote = note.trim().length > 0;
  const canSubmit = changedKeys.length > 0 || hasNote;

  const subject = `Voter edit suggestion: #${voter.id} ${fullName(voter)}`;

  const buildBody = (): string => {
    const lines: string[] = [];
    lines.push(`Suggested edit for a ${COUNTY_NAME} County voter record.`);
    lines.push("");
    lines.push("RECORD (original):");
    lines.push(`  Voter #: ${voter.id}`);
    lines.push(`  Name: ${original.lastName}, ${original.firstName || "(blank)"}`);
    lines.push(`  Street: ${original.street || "(blank)"}`);
    lines.push(`  City: ${original.city}, ${original.state} ${original.zip}`);
    lines.push(`  Precinct: ${original.precinct || "(blank)"}`);
    lines.push(`  Party: ${partyLabel(original.party)} (${original.party})`);
    lines.push(`  Registered: ${original.registered || "(blank)"}`);
    lines.push(`  Jurisdiction: ${voter.jurisdiction}`);
    lines.push(
      voter.lat != null && voter.lon != null
        ? `  Map position: ${voter.lat}, ${voter.lon} — ${GEO_TIERS[voter.geo] ?? "unknown"}`
        : "  Map position: not placed",
    );
    lines.push("");

    if (changedKeys.length === 0) {
      lines.push("PROPOSED CHANGES: (none entered)");
    } else {
      lines.push("PROPOSED CHANGES:");
      for (const k of changedKeys) {
        const from = displayValue(k, original);
        const to = displayValue(k, form);
        lines.push(`  ${FIELD_LABELS[k]}: ${from}  ->  ${to}`);
      }
    }

    lines.push("");
    lines.push("NOTE:");
    lines.push(`  ${note.trim() || "(none)"}`);
    lines.push("");
    lines.push(
      `Voted in: ${voter.elections.length ? voter.elections.join(", ") : "(none on file)"}`,
    );
    lines.push(`Source: Ohio Secretary of State ${COUNTY_NAME} County voter file.`);
    return lines.join("\n");
  };

  const submitMailto = () => {
    const url = `mailto:${UPDATE_RECIPIENT_EMAIL}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(buildBody())}`;
    openMail(url);
  };

  const copyBody = async () => {
    const text = `To: ${UPDATE_RECIPIENT_EMAIL}\nSubject: ${subject}\n\n${buildBody()}`;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      /* fall through to the textarea fallback */
    }
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <div
      id="dialog-overlay"
      className="active"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="dialog"
        className="suggest-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Suggest an edit"
      >
        <div id="dialog-header">
          <h2 id="dialog-title">Suggest an Edit</h2>
          <button id="dialog-close" onClick={onClose} aria-label="Close">
            &#x2715;
          </button>
        </div>
        <div id="dialog-body">
          <p className="se-intro">
            Correct any field below and submit. Your changes are emailed to the
            maintainer for review &mdash; the Board of Elections record is not
            updated, and the data here is not changed automatically. If the
            fields are right but the map dot is wrong, just leave a note.
          </p>

          <div className="se-field">
            <label htmlFor="se-id">Voter #</label>
            <input id="se-id" type="text" value={voter.id} readOnly />
          </div>

          <div className="se-row">
            <div className="se-field se-grow">
              <label htmlFor="se-last">Last name</label>
              <input
                id="se-last"
                type="text"
                value={form.lastName}
                onChange={(e) => set("lastName", e.target.value)}
              />
            </div>
            <div className="se-field se-grow">
              <label htmlFor="se-first">First / middle</label>
              <input
                id="se-first"
                type="text"
                value={form.firstName}
                onChange={(e) => set("firstName", e.target.value)}
              />
            </div>
          </div>

          <div className="se-field">
            <label htmlFor="se-street">Street</label>
            <input
              id="se-street"
              type="text"
              value={form.street}
              onChange={(e) => set("street", e.target.value)}
            />
          </div>

          <div className="se-row">
            <div className="se-field se-grow">
              <label htmlFor="se-city">City</label>
              <input
                id="se-city"
                type="text"
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
              />
            </div>
            <div className="se-field se-zip">
              <label htmlFor="se-zip">ZIP</label>
              <input
                id="se-zip"
                type="text"
                inputMode="numeric"
                value={form.zip}
                onChange={(e) => set("zip", e.target.value)}
              />
            </div>
          </div>

          <div className="se-row">
            <div className="se-field se-grow">
              <label htmlFor="se-precinct">Precinct</label>
              <input
                id="se-precinct"
                type="text"
                value={form.precinct}
                onChange={(e) => set("precinct", e.target.value)}
              />
            </div>
            <div className="se-field se-grow">
              <label htmlFor="se-party">Party</label>
              <select
                id="se-party"
                value={form.party}
                onChange={(e) => set("party", e.target.value)}
              >
                {Object.entries(PARTY_LABELS).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="se-field">
            <label htmlFor="se-registered">Registered</label>
            <input
              id="se-registered"
              type="date"
              value={form.registered}
              onChange={(e) => set("registered", e.target.value)}
            />
          </div>

          <div className="se-field">
            <label htmlFor="se-note">Note (optional)</label>
            <textarea
              id="se-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything else the maintainer should know? A wrong map position goes here."
            />
          </div>

        </div>

        {/* Outside #dialog-body, so the actions stay put while the form scrolls. */}
        <div id="dialog-footer">
          <p className="se-changecount">
            {changedKeys.length === 0
              ? hasNote
                ? "No fields changed — your note will be sent on its own."
                : "No changes yet — edit a field above, or leave a note."
              : `${changedKeys.length} field${
                  changedKeys.length === 1 ? "" : "s"
                } changed.`}
          </p>
          <div className="btn-row">
            <button
              className="map-btn btn-gmap"
              onClick={submitMailto}
              disabled={!canSubmit}
            >
              &#9993; Submit by Email
            </button>
            <button className="map-btn btn-dir" onClick={copyBody}>
              {copied ? "✓ Copied" : "⧉ Copy to Clipboard"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
