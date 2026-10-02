# a11y: vendored library

**Do not edit anything in this directory.** It is a copy of
`FleetShareableCodeComponents/a11y/src`, placed here by Statehouse's
`sync-shared-code.py --lib a11y`. Fix it there, bump `VERSION`, and sync.

The fleet's accessibility kit. Target: **WCAG 2.1 Level AA**, the standard the
DOJ ADA Title II web rule and the HHS Section 504 rule both name.

The map apps conform through a *conforming alternate version*: the list view
has to do everything the map does, from the keyboard and with a screen reader.
The map itself only has to avoid the "non-interference" failures (keyboard
traps, flashing, endless motion). This kit covers both halves.

```tsx
import "./vendor/a11y/a11y.css";                                   // main.tsx, after global.css
import SortHeader from "../vendor/a11y/SortHeader";                // list header cells
import RowButton from "../vendor/a11y/RowButton";                  // first cell of each row
import LiveStatus from "../vendor/a11y/LiveStatus";                // once, in App
import SkipLink from "../vendor/a11y/SkipLink";                    // first child of App
import { useDialogA11y } from "../vendor/a11y/useDialogA11y";      // every modal dialog and drawer
import { inertWhen } from "../vendor/a11y/inert";                  // closed drawers, hidden map pane
import { useMenuKeyboard } from "../vendor/a11y/useMenuKeyboard";  // hamburger menu
import { useViewParam } from "../vendor/a11y/useViewParam";        // replaces useState("map")
import { ariaSortFor, countMessage } from "../vendor/a11y/a11y";
```

| Piece | WCAG | What it does |
|---|---|---|
| `SortHeader` | 2.1.1, 4.1.2 | `<th scope="col" aria-sort>` with a real `<button>` inside |
| `RowButton` | 2.1.1 | button around the row's name/ID; opens the same detail dialog as the marker |
| `LiveStatus` | 4.1.3 | polite live region; announces "34 of 120 providers" after filtering |
| `SkipLink` | 2.4.1 | "Skip to list view": switches to the list and focuses it |
| `useDialogA11y` | 2.1.2, 2.4.3 | focus into the dialog, Tab trapped, Escape closes, focus returns to the opener; `trap: false` for drawers |
| `labelMarker` / `setMarkerLabel` | 4.1.2 | accessible name on each Leaflet marker icon |
| `inertWhen` | 2.4.3, 4.1.2 | closed drawers / hidden panes leave the Tab order and the accessibility tree (`inert` + `aria-hidden`) |
| `useMenuKeyboard` | 2.1.1, 2.4.3 | hamburger menu: focus to first item, arrow keys / Home / End, Escape returns focus to the button (works for `role="menu"` panels and plain button panels) |
| `useViewParam` | — | `?view=list` opens the list; the address bar always links to the current view |
| `a11y.css` | 2.2.2, 2.3.3, 2.4.7 | pulses stop after 2 cycles, none at all under reduced motion; focus rings; sr-only |

`a11y.ts` holds the pure logic (sorting state, count sentences, view param,
menu index, focus-trap wrap) so its suite runs in plain Node in the library
repo (`a11y/test/`), not here.

## Wiring a list view

```tsx
<table>
  <caption className="a11y-sr-only">Providers, sorted by {label}</caption>
  <thead><tr>
    <SortHeader sort={ariaSortFor("name", sortKey, asc)} onSort={() => onSort("name")}>Name</SortHeader>
  </tr></thead>
  <tbody>
    <tr onClick={() => onSelect(r)}>                    {/* mouse: unchanged */}
      <td><RowButton onActivate={() => onSelect(r)}>{r.name}</RowButton></td>
```

## Wiring a dialog

```tsx
const boxRef = useDialogA11y(!!item, onClose);   // remove the app's own Escape listener
<div ref={boxRef} role="dialog" aria-modal="true" aria-labelledby="dlg-title" tabIndex={-1}>
  <h2 id="dlg-title">…</h2>
```

## Wiring a drawer (Filters, Layers, Help)

```tsx
const boxRef = useDialogA11y<HTMLElement>(open, onClose, {
  trap: false,                                   // non-modal: the map stays usable
  fallbackFocus: 'button[aria-label="Main menu"]', // the menu item that opened it is gone
});
<aside ref={boxRef} tabIndex={-1} aria-label="Filters" {...inertWhen(!open)}>
```

Map markers need a name too. Leaflet makes every icon a focusable
`role="button"`; a divIcon gives it no text:

```tsx
import { labelMarker, setMarkerLabel } from "../vendor/a11y/markerLabel";
labelMarker(L.marker(ll, { icon }), `Hydrant, ${h.street}`);                 // plain Leaflet
<Marker eventHandlers={{ add: (e) => setMarkerLabel(e.target, r.name) }} />   // react-leaflet
```
