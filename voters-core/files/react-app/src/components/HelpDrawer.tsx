import { useEffect, useRef } from "react";
import Drawer from "./Drawer";
import { COUNTY_NAME } from "../config/county";

export type HelpTopic =
  | "overview"
  | "search"
  | "elections"
  | "early-voting"
  | "filters"
  | "map"
  | "list"
  | "suggest-an-edit"
  | "data-notes"
  | "reports"
  | "on-a-phone"
  | "offline";

const TOC: { id: HelpTopic; label: string }[] = [
  { id: "overview", label: "What this is" },
  { id: "search", label: "Search" },
  { id: "elections", label: "Elections" },
  { id: "early-voting", label: "Early voting" },
  { id: "filters", label: "Filters" },
  { id: "map", label: "Map" },
  { id: "list", label: "List" },
  { id: "suggest-an-edit", label: "Suggest an edit" },
  { id: "data-notes", label: "Data notes" },
  { id: "reports", label: "Reports" },
  { id: "on-a-phone", label: "On a phone" },
  { id: "offline", label: "Offline" },
];

interface HelpDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Section to scroll to when opened, from a contextual link. */
  topic?: HelpTopic | null;
}

/**
 * "About this app", in the fleet's slide-out pane: it sits at the right edge
 * and the app stays usable beside it, so the reader can try what a section
 * describes while it is still on screen. Topics at the top jump within it.
 */
export default function HelpDrawer({ open, onClose, topic }: HelpDrawerProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // Scroll the requested topic into view each time the pane opens on one.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      const el = bodyRef.current?.querySelector<HTMLElement>(
        `#help-${topic ?? "overview"}`,
      );
      if (!el) return;
      if (topic) {
        el.scrollIntoView({ block: "start" });
      } else {
        // A plain open starts at the top, topic chips in view.
        const pane = bodyRef.current?.closest<HTMLElement>(".side-drawer-body");
        if (pane) pane.scrollTop = 0;
      }
      el.focus({ preventScroll: true });
    }, 240); // after the slide-in transition
    return () => window.clearTimeout(t);
  }, [open, topic]);

  const jump = (id: HelpTopic) => {
    const el = bodyRef.current?.querySelector<HTMLElement>(`#help-${id}`);
    if (el) {
      el.scrollIntoView({ block: "start", behavior: "smooth" });
      el.focus({ preventScroll: true });
    }
  };

  return (
    <Drawer open={open} onClose={onClose} title="About this app" label="Help" className="help-drawer">
      <div ref={bodyRef} className="help-body">
        <nav className="help-toc" aria-label="Help topics">
          {TOC.map((t) => (
            <button key={t.id} type="button" onClick={() => jump(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>

        <section className="help-section" id="help-overview" tabIndex={-1}>
          <h3>What this is</h3>
            <p className="help-intro">
              The registered voters of {COUNTY_NAME} County, Ohio, and their
              voting history: one record per voter, with the elections they
              turned out for since the first one listed in the header. The
              source is the Ohio Secretary of State's county voter file — the
              Board of Elections' own roll as the state publishes it, active
              and confirmation-status voters alike. A county's results reach
              that file some weeks after each election; the date it was
              downloaded is the <em>export run</em> date at the top right.
            </p>
        </section>

        <section className="help-section" id="help-search" tabIndex={-1}>
          <h3>Search</h3>
            <p>
              The search box matches on name, voter ID, street, city, ZIP and
              precinct at the same time — type any part of any of them. The
              <b>×</b> at the right of the box clears it, and so does
              <b>Esc</b> while the cursor is in it.
            </p>
        </section>
        <section className="help-section" id="help-elections" tabIndex={-1}>
          <h3>Elections</h3>
            <p>
              The <b>Elections</b> filter is where the voter history lives. Tick
              the elections you care about, then choose <b>any</b> or <b>all</b>:
              <em>any</em> gives everyone who turned out for at least one of them,
              <em>all</em> narrows to the people who turned out every time. The
              count beside each election is that election's turnout among the
              voters the other filters allow, so it does not move as you tick
              boxes. The last row, <b>No elections since …</b>, is the registered
              voters with no ballot in any election here; it is ticked by
              default so the list starts as the whole roll, and unticking it
              leaves only people who have voted at least once.
            </p>
            <p>
              Some elections are not county-wide — a ballot issue in one city, or
              a municipal primary held only where there was a contest. These are
              marked <em>part of county</em> in the filter and <b>*</b> in the
              bar above, and voters outside them are <b>not eligible</b> rather
              than no-shows — so <b>all</b> asks whether someone voted in every
              election <em>they could vote in</em>. Without that, a voter who
              never missed an election on their own ballot would fail the test
              because of one they were never offered.
            </p>
            <p>
              A voter appears once no matter how many elections they voted in.
              The <b>Voted In</b> column lists them all; their details show the
              most recent, with a <b>Voting history</b> button beside it when
              there is more than one — that opens every election on file,
              newest first, marking the ones they turned out for.
            </p>
        </section>
        <section className="help-section" id="help-early-voting" tabIndex={-1}>
          <h3>Early voting</h3>
            <p>
              While early voting is open, the Board of Elections publishes a
              daily file of every absentee and early ballot issued for the
              coming election. When that file is merged in, the election
              appears in the list marked <em>in progress</em>, and an
              <b> Early voting</b> filter is added with three states:
              <b> Voted early</b> (the ballot has come back — the only state
              that is a vote), <b>Ballot out</b> (issued but not yet returned)
              and <b>No ballot yet</b>. The <b>Early Voting</b> column and each
              voter's details show the state with its date and the kind of
              ballot — early in-person, by mail, military, overseas, nursing
              home — and the map legend can colour the dots by it. The <b>Reports</b>
              view gains an <b>Early voting</b> tab: ballots returned per day
              (in person versus mail), mail return rate by party, the pace in
              each place against the same voters' turnout in the last general
              of the same kind of year, and the early voters' own history.
            </p>
            <p>
              An election in progress never counts against anyone: a voter
              without a returned ballot is <em>not yet voted</em>, not a
              no-show, so <b>all</b> and every report leave it out of what
              a voter could have voted in. Its number in the counts bar is
              ballots returned so far. Voters whose first vote on file is this
              one are added from the absentee file itself, which carries the
              mailing address rather than the residence and no registration
              date; an e-mail or out-of-county mailing address is not kept as
              a street. Once the election is over, the Board's normal export
              replaces the file and all of this disappears.
            </p>
        </section>
        <section className="help-section" id="help-filters" tabIndex={-1}>
          <h3>Filters</h3>
            <p>
              Party, Jurisdiction and Precinct are multi-select. Each option
              shows how many voters it covers given the <em>other</em> filters,
              so the counts always reflect what you would actually see.
            </p>
            <p>
              <b>Jurisdiction is the municipality or township the address
              actually sits in</b>, not the mailing city. The two often
              disagree: the Girard post office serves 7,133 voters, but only
              3,857 of them live in the city of Girard — the rest are mostly in
              Liberty and Weathersfield townships. Voters with no
              boundary — almost always because their address could not be
              placed — fall in the <b>No jurisdiction</b> bucket. The mailing city
              is still in the search box, the list and each voter's details.
            </p>
        </section>
        <section className="help-section" id="help-map" tabIndex={-1}>
          <h3>Map</h3>
            <p>
              The menu switches between the map and the list; both answer to the
              same search and filters. Dots are coloured by party and grouped
              into counts until you zoom past street level, where each voter
              becomes one dot — hover for a summary, click for full details.
              Clicking a group zooms into it. The legend switches municipality,
              township and precinct outlines on and off.
            </p>
            <p>
              A voter's address is matched against the county's address-point
              and parcel files to place them, and about 9% of the roll has no
              match — those voters are in the list but not on the map, and the
              list caption says how many. Each dialog names the match it used
              under <b>Map position</b>, so an approximate placement says so.
            </p>
        </section>
        <section className="help-section" id="help-list" tabIndex={-1}>
          <h3>List</h3>
            <ul>
              <li>Click any column header to sort; click again to reverse.</li>
              <li>
                <b>Street</b> sorts by street name first and then up the street
                by house number, so one street stays together and 9 comes before
                10. Directionals are kept as written, so N Main and S Main sort
                separately.
              </li>
              <li>Click a row to open that voter's details.</li>
              <li>Use the pager at the bottom to move through the results.</li>
              <li>
                <b>Export CSV</b> downloads every row currently matching — not
                just the page on screen — with a Y/N column per election.
              </li>
            </ul>
        </section>
        <section className="help-section" id="help-suggest-an-edit" tabIndex={-1}>
          <h3>Suggest an edit</h3>
            <p>
              Every voter's details have a <b>Suggest an Edit</b> button. Correct
              any field, or just leave a note if the record is right but the map
              dot is wrong, and it opens an email to the maintainer summarising
              only what you changed. Nothing is updated automatically, and this
              does not reach the Board of Elections — to change an official
              record, contact them directly.
            </p>
        </section>
        <section className="help-section" id="help-data-notes" tabIndex={-1}>
          <h3>Data notes</h3>
            <p>
              The exports' AV, phone and date-of-birth columns were empty for
              every record, so they are not shown. Party reflects the ballot
              party recorded by the Board of Elections; Ohio has no party
              registration, and <em>Unaffiliated</em> ("--") covers voters with
              no party ballot on record.
            </p>
            <p>
              Name, address, precinct, party and registration date are the
              voter's <em>current</em> details, not what they were on any given
              election day — that is how the Board of Elections publishes them.
              Where two exports covered the same voter they agreed on every one
              of those fields.
            </p>
        </section>
        <section className="help-section" id="help-reports" tabIndex={-1}>
          <h3>Reports</h3>
            <p>
              The menu's <b>Reports</b> view answers questions about the whole
              set rather than one voter: turnout election by election, who came
              back for the next one, how often people turn out, which places
              turn out most, and how participation tracks with when someone
              registered. Every report describes <em>what the filters currently
              select</em>, not the whole county — the line at the top right says
              which — so filtering to one township and opening a report gives
              you that township. Each report exports to CSV.
            </p>
            <p>
              <b>Every count is a link to the voters it counts.</b> The numbers
              in the counts bar, the map legend, and every bar, tile, table
              cell and coloured segment in the reports open exactly those voters
              in the list. Each click adds a chip to a <b>Narrowed to</b> strip
              under the filters, and the chips stack: click a day's bar, then a
              party, and the list is that party on that day. Remove a chip with
              its ×, or <b>Reset</b> in the menu clears everything. Clicking a
              count in the map legend narrows the map in place instead of
              switching to the list.
            </p>
            <p>
              Every share in the reports is of the <b>registered voters</b> the
              current filters allow — the whole roll by default, including
              people who have not voted in any election here. Narrow the
              Elections filter and the shares become shares of that narrower
              group; the basis line at the top of the reports says which.
            </p>
        </section>
        <section className="help-section" id="help-on-a-phone" tabIndex={-1}>
          <h3>On a phone</h3>
            <p>
              The voter list becomes one card per person, since ten columns do
              not fit across a phone. The column headers are replaced by the
              <b>Sort</b> control above the list — pick a field and use the
              arrow to reverse it. Tap a card for the same full details a click
              gives on a desktop. On the map, the filters sit in a row you can
              swipe across and the legend starts closed; tap it to open.
            </p>
        </section>
        <section className="help-section" id="help-offline" tabIndex={-1}>
          <h3>Offline</h3>
            <p>
              This is an installable app — after the first visit it works
              without a connection.
            </p>
        </section>
      </div>
    </Drawer>
  );
}
