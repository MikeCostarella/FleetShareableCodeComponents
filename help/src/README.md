# help: vendored library

**Do not edit anything in this directory.** It is a copy of
`FleetShareableCodeComponents/help/src`, placed here by Statehouse's
`sync-shared-code.py --lib help`. Fix it there, bump `VERSION`, and sync.

The fleet's help system: a slide-out pane on the right with a contents list,
search, and topics an app registers as data. Anything in the app can open it
on a topic, so every "?" beside a control lands on the paragraph about it.

```tsx
import "./vendor/help/help.css";                                   // once, main.tsx or App.tsx
import { HelpProvider, useHelp } from "./vendor/help/HelpContext";
import HelpDrawer from "./vendor/help/HelpDrawer";
import HelpButton, { HelpLink } from "./vendor/help/HelpButton";
import type { HelpTopic } from "./vendor/help/help";

const topics: HelpTopic[] = [                                     // the app's own file, e.g. src/help/topics.tsx
  { id: "overview", group: "Getting started", title: "What this is", body: <p>…</p> },
  { id: "filters",  group: "Finding permits", title: "Filters", keywords: ["facets"],
    body: <p>… see <HelpLink topic="map">the map</HelpLink>.</p>, related: ["map"] },
];

<HelpProvider topics={topics} title="Help">                       // wraps the app
  …
  <HelpButton topic="filters" label="Help: filters" />           // small "?" beside a control
  <HelpButton tone="dark" size="md" />                            // the masthead "?"
  <HelpDrawer />                                                  // once, anywhere inside
</HelpProvider>

const help = useHelp(); help.open("roll-ups");                    // from a menu item
```

- **Topics are data.** Adding help is adding an object to the array: id, title,
  optional group (the contents headings), keywords for search, JSX body,
  related ids for "See also". Build the array in a `useMemo` to quote live
  numbers. Order in the array is order in the pane.
- **Search** matches every word of the query (word-prefix, accent- and
  case-insensitive) against title, group, keywords and the topic's rendered
  text. `help.ts` holds the pure parts; its suite is in the library repo
  (`help/test/`).
- **Opening:** `useHelp().open(id?)`, `<HelpButton topic>`, `<HelpLink topic>`
  inside bodies, and the **?** key anywhere outside a text field
  (`<HelpProvider shortcut={false}>` turns that off).
- **Behaviour:** non-modal (no backdrop, the app stays usable), focus goes to
  the topic or the search box and returns to the opener on close, Escape
  closes, hidden from the tab order while closed; full width on phones.
- **Styling:** `help.css`, all classes prefixed `fh-`. Reads the app's
  `--btn-primary` and `--bg-masthead` custom properties when present.
