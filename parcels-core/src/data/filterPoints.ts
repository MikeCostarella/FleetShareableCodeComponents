import type { Parcel } from "../types/point";

/** Numeric range filters for market value and acreage (undefined = no bound). */
export interface RangeFilter {
  minValue?: number;
  maxValue?: number;
  minAcres?: number;
  maxAcres?: number;
}

/**
 * Single source of truth for which parcels are visible given the active class,
 * jurisdiction, value/acreage, and text-search selections. The map layer and
 * the list view both rely on this (or its mask sibling) so they never disagree.
 *
 * - `selectedTypes`: keep a parcel only when its major class is in the set.
 * - `selectedJurisdictions`: keep a parcel only when its jurisdiction is in the set.
 * - `range`: keep a parcel only when its total market value / acres fall within bounds.
 * - `search`: keep a parcel only when the text matches its parcel #, address, or
 *   zip (and owner, when `searchOwner` is on); see `textMatches` for how a
 *   pasted mailing address is matched.
 * - `selectedTaxDistricts`: keep a parcel only when its taxing district is in the
 *   set. Counties whose Auditor publishes no taxing district leave
 *   `Parcel.taxingDistrict` empty and simply never pass this filter a set.
 *
 * When a selection is undefined/blank that dimension is not filtered. All apply
 * together (AND).
 *
 * Generic over `T extends Parcel` so a county that widens the record — Adams
 * adds census tract, food-desert flag and a full PIN — gets its own type back
 * rather than the narrowed core one. Without this the app stops compiling the
 * moment it reads a county-specific field off a filtered parcel.
 *
 * NOTE: seven positional parameters is past the point where this should be an
 * options object. Left as-is deliberately: the signature is shared with 88
 * repos that have not been migrated yet, and changing shape and semantics in
 * the same commit is how a fleet-wide sweep goes wrong. Worth its own issue.
 */
export function filterPoints<T extends Parcel>(
  points: T[],
  selectedTypes?: Set<number>,
  selectedJurisdictions?: Set<string>,
  range?: RangeFilter,
  search?: string,
  searchOwner = false,
  selectedTaxDistricts?: Set<string>,
): T[] {
  const q = (search ?? "").trim();
  if (
    !selectedTypes &&
    !selectedJurisdictions &&
    !hasRange(range) &&
    !q &&
    !selectedTaxDistricts
  ) {
    return points;
  }
  return points.filter((p) =>
    matches(p, selectedTypes, selectedJurisdictions, range, q, searchOwner, selectedTaxDistricts),
  );
}

/** True when any range bound is set. */
export function hasRange(range?: RangeFilter): boolean {
  if (!range) return false;
  return (
    range.minValue != null ||
    range.maxValue != null ||
    range.minAcres != null ||
    range.maxAcres != null
  );
}

/**
 * Whether a parcel matches a search query. Owner is searched only when
 * `includeOwner` is true (privacy setting).
 *
 * Two passes.
 *
 * 1. Literal: the whole query as a case-insensitive substring of the parcel #,
 *    address or zip (and owner). This is the pre-1.10 behaviour, kept as the
 *    first pass so partial typing ("4761 water", "01-023", "44201") and parcel
 *    numbers behave exactly as they always have.
 *
 * 2. Address-aware, only when the literal pass misses. Pasted mailing
 *    addresses are the common miss. Portage, Sept 2026: "4761 Waterloo Rd,
 *    Atwater, OH 44201" found nothing, because the parcel is stored as
 *    "4761 WATERLOO, Randolph Township, OH 44201". The Auditor leaves the
 *    street-suffix column blank on most parcels, and the city is the
 *    township, not the post-office name. So the query is read as an address
 *    and matched word by word:
 *    - The street part (before the first comma) must match word for word:
 *      numbers exactly, other words exactly or as the start of an address
 *      word.
 *    - Street suffixes (Rd/Road, St/Street, ...) and directionals (N/North,
 *      ...) match in either spelling. They are ignored when the stored street
 *      carries none, but "123 Maple Ave" still rejects "123 MAPLE ST".
 *    - The locality part (after the first comma) is only a hint, because a
 *      postal city name rarely equals the Auditor's jurisdiction. A ZIP there
 *      must still match. "OH"/"Ohio"/"USA" are ignored.
 *    - With no comma, words after the last street suffix count as the
 *      locality when they are all words or a ZIP:
 *      "123 main st north jackson oh 44451".
 *    - "State Route" also matches the Auditors' "ST RT".
 */
export function textMatches(p: Parcel, query: string, includeOwner = false): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (
    p.parcelNumber.toLowerCase().includes(q) ||
    p.address.toLowerCase().includes(q) ||
    p.zip.includes(q) ||
    (includeOwner && p.owner.toLowerCase().includes(q))
  ) {
    return true;
  }
  return addressMatches(p, parseAddressQuery(q), includeOwner);
}

/** Street-suffix spellings; the first entry in each group is canonical. Words
 *  that are just as often part of a street's name (Run, Way, Pike, Point,
 *  Path) are deliberately left out. */
const SUFFIX_GROUPS: string[][] = [
  ["rd", "road"], ["st", "street", "str"], ["ave", "av", "avenue"], ["dr", "drive"],
  ["ln", "lane"], ["ct", "court"], ["blvd", "boulevard"], ["pkwy", "parkway"],
  ["cir", "circle"], ["pl", "place"], ["trl", "trail"], ["hwy", "highway"],
  ["ter", "terrace"],
];
const DIRECTION_GROUPS: string[][] = [
  ["n", "north"], ["s", "south"], ["e", "east"], ["w", "west"],
  ["ne", "northeast"], ["nw", "northwest"], ["se", "southeast"], ["sw", "southwest"],
];
const SUFFIX = groupIndex(SUFFIX_GROUPS);
const DIRECTION = groupIndex(DIRECTION_GROUPS);
const IGNORED = new Set(["oh", "ohio", "usa"]);
/** Other exact spellings a required word may take in the stored address.
 *  Portage stores "9668 ST RT 224"; people type "9668 State Route 224". */
const VARIANTS = new Map<string, string[]>([
  ["state", ["st"]], ["route", ["rt", "rte"]], ["rte", ["rt", "route"]], ["rt", ["route", "rte"]],
]);
const ZIP_RE = /^\d{5}$/;

function groupIndex(groups: string[][]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const g of groups) for (const w of g) m.set(w, g);
  return m;
}

interface AddressQuery {
  /** Words that must each match a word of the address (or zip / owner). */
  required: string[];
  /** Suffix / directional words: each a spelling group, matched softly. */
  suffixes: string[][];
  directions: string[][];
  /** ZIPs named in the locality part; the parcel's zip must be one of them. */
  zips: string[];
}

function words(s: string): string[] {
  return s.split(/[^a-z0-9]+/).filter(Boolean);
}

// filterPoints calls textMatches once per parcel with the same query, so the
// parse is memoised on the last query seen.
let lastQuery = "";
let lastParsed: AddressQuery | null = null;

function parseAddressQuery(q: string): AddressQuery {
  if (lastParsed && q === lastQuery) return lastParsed;
  const cleaned = q.replace(/\b(\d{5})-\d{4}\b/g, "$1");
  const [streetPart, ...rest] = cleaned.split(",");
  let street = words(streetPart).filter((w) => !IGNORED.has(w));
  let locality = words(rest.join(" ")).filter((w) => !IGNORED.has(w));

  if (rest.length === 0) {
    // No comma: split after the last street suffix when what follows looks
    // like a locality (words and at most a ZIP, no other numbers).
    let last = -1;
    street.forEach((w, i) => { if (SUFFIX.has(w)) last = i; });
    const tail = street.slice(last + 1);
    if (last >= 0 && tail.length > 0 && tail.every((w) => /^[a-z]+$/.test(w) || ZIP_RE.test(w))) {
      locality = tail;
      street = street.slice(0, last + 1);
    }
  }

  const parsed: AddressQuery = { required: [], suffixes: [], directions: [], zips: [] };
  for (const w of street) {
    const sfx = SUFFIX.get(w);
    const dir = DIRECTION.get(w);
    if (sfx) parsed.suffixes.push(sfx);
    else if (dir) parsed.directions.push(dir);
    else parsed.required.push(w);
  }
  for (const w of locality) if (ZIP_RE.test(w)) parsed.zips.push(w);
  // A query that is only a locality ("Randolph Township, OH") has nothing else
  // to match on, so its words become the requirement.
  if (parsed.required.length === 0 && parsed.zips.length === 0) {
    parsed.required = locality.filter((w) => !ZIP_RE.test(w));
  }

  lastQuery = q;
  lastParsed = parsed;
  return parsed;
}

function wordMatches(queryWord: string, target: string[]): boolean {
  const numeric = /^\d+$/.test(queryWord);
  const alts = VARIANTS.get(queryWord);
  for (const t of target) {
    if (t === queryWord || (!numeric && t.startsWith(queryWord))) return true;
    if (alts && alts.includes(t)) return true;
  }
  return false;
}

function addressMatches(p: Parcel, aq: AddressQuery, includeOwner: boolean): boolean {
  // Nothing to require at all ("OH", ", ,") -> no match, rather than everything.
  if (aq.required.length === 0 && aq.zips.length === 0) return false;
  if (aq.zips.length > 0 && !aq.zips.includes(p.zip.slice(0, 5))) return false;

  const address = p.address.toLowerCase();
  const owner = includeOwner ? p.owner.toLowerCase() : "";
  // Cheap reject before tokenising: almost every parcel fails here on the
  // house number alone.
  for (const w of aq.required) {
    if (VARIANTS.has(w)) continue; // its other spellings are checked below
    if (!address.includes(w) && !p.zip.includes(w) && !(includeOwner && owner.includes(w))) {
      return false;
    }
  }

  const addrWords = words(address);
  const hay = includeOwner ? addrWords.concat(p.zip, words(owner)) : addrWords.concat(p.zip);
  for (const w of aq.required) if (!wordMatches(w, hay)) return false;

  if (aq.suffixes.length || aq.directions.length) {
    const streetWords = words(address.split(",")[0]);
    const endsWithSuffix = streetWords.length > 0 && SUFFIX.has(streetWords[streetWords.length - 1]);
    for (const g of aq.suffixes) {
      if (!g.some((v) => streetWords.includes(v)) && endsWithSuffix) return false;
    }
    const hasDirection = streetWords.some((w) => DIRECTION.has(w));
    for (const g of aq.directions) {
      if (!g.some((v) => streetWords.includes(v)) && hasDirection) return false;
    }
  }
  return true;
}

/** Whether a single parcel passes all active filters. */
export function matches(
  p: Parcel,
  selectedTypes?: Set<number>,
  selectedJurisdictions?: Set<string>,
  range?: RangeFilter,
  search?: string,
  searchOwner = false,
  selectedTaxDistricts?: Set<string>,
): boolean {
  if (selectedTypes && !selectedTypes.has(p.type)) return false;
  if (selectedJurisdictions && !selectedJurisdictions.has(p.jurisdiction)) return false;
  if (selectedTaxDistricts && !selectedTaxDistricts.has(p.taxingDistrict)) return false;
  if (range) {
    if (range.minValue != null && p.totalMarket < range.minValue) return false;
    if (range.maxValue != null && p.totalMarket > range.maxValue) return false;
    if (range.minAcres != null && p.acres < range.minAcres) return false;
    if (range.maxAcres != null && p.acres > range.maxAcres) return false;
  }
  if (search && search.trim() && !textMatches(p, search, searchOwner)) return false;
  return true;
}

/**
 * Find the first parcel matching the query by parcel number, address, or zip
 * (and owner when `includeOwner` is on). Used to fly the map to a search hit.
 */
export function findPoint<T extends Parcel>(
  points: T[],
  query: string,
  includeOwner = false,
): T | null {
  const q = query.trim();
  if (!q) return null;
  for (const p of points) {
    if (textMatches(p, q, includeOwner)) return p;
  }
  return null;
}
