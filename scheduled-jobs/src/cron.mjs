// Just enough cron for GitHub Actions `on: schedule` lines: parse the five
// POSIX fields, find the next occurrences (GitHub cron is always UTC), and
// describe a schedule in plain words in a chosen time zone.
//
// Pure functions, no I/O. Supported syntax is what GitHub supports: *,
// numbers, a-b ranges, /n steps, comma lists, and JAN-DEC / SUN-SAT names.
// Day-of-week 7 is accepted as Sunday.
//
// Part of FleetShareableCodeComponents/scheduled-jobs - edit it THERE.
const FIELDS = [
  { name: "minute", lo: 0, hi: 59 },
  { name: "hour", lo: 0, hi: 23 },
  { name: "dom", lo: 1, hi: 31 },
  { name: "month", lo: 1, hi: 12, names: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], base: 1 },
  { name: "dow", lo: 0, hi: 7, names: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"], base: 0 },
];

function atom(s, f) {
  const up = s.toUpperCase();
  if (f.names) {
    const i = f.names.indexOf(up);
    if (i >= 0) return i + f.base;
  }
  if (!/^\d+$/.test(s)) throw new Error(`bad ${f.name} value "${s}"`);
  const n = Number(s);
  if (n < f.lo || n > f.hi) throw new Error(`${f.name} ${n} out of range ${f.lo}-${f.hi}`);
  return n;
}

function parseField(text, f) {
  const out = new Set();
  for (const part of text.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad step in ${f.name} "${part}"`);
    let lo, hi;
    if (rangePart === "*") { lo = f.lo; hi = f.name === "dow" ? 6 : f.hi; }
    else if (rangePart.includes("-")) { const [a, b] = rangePart.split("-"); lo = atom(a, f); hi = atom(b, f); }
    else { lo = atom(rangePart, f); hi = stepPart === undefined ? lo : (f.name === "dow" ? 6 : f.hi); }
    if (hi < lo) throw new Error(`backwards range in ${f.name} "${part}"`);
    for (let v = lo; v <= hi; v += step) out.add(f.name === "dow" && v === 7 ? 0 : v);
  }
  return out;
}

/** "17 7 * * *" -> { minute:Set, hour:Set, dom:Set, month:Set, dow:Set, domStar, dowStar } */
export function parseCron(expr) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`expected 5 fields, got ${parts.length}: "${expr}"`);
  const c = {};
  FIELDS.forEach((f, i) => { c[f.name] = parseField(parts[i], f); });
  // Standard cron: when BOTH day fields are restricted, a day matches if
  // EITHER does. A "*" (even "*/1") counts as unrestricted.
  c.domStar = parts[2].startsWith("*");
  c.dowStar = parts[4].startsWith("*");
  return c;
}

function dayMatches(c, d) {
  const domOk = c.dom.has(d.getUTCDate());
  const dowOk = c.dow.has(d.getUTCDay());
  if (c.domStar && c.dowStar) return true;
  if (c.domStar) return dowOk;
  if (c.dowStar) return domOk;
  return domOk || dowOk;
}

/** The next `count` run times (Date, UTC) strictly after `from`. */
export function nextRuns(expr, from = new Date(), count = 1) {
  const c = typeof expr === "string" ? parseCron(expr) : expr;
  const out = [];
  const d = new Date(from.getTime());
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);
  // Jumps by month / day / hour when a coarser field fails, so even a
  // once-a-year schedule resolves in a few hundred steps.
  for (let guard = 0; out.length < count && guard < 200_000; guard++) {
    if (!c.month.has(d.getUTCMonth() + 1)) {
      d.setUTCMonth(d.getUTCMonth() + 1, 1); d.setUTCHours(0, 0, 0, 0); continue;
    }
    if (!dayMatches(c, d)) { d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(0, 0, 0, 0); continue; }
    if (!c.hour.has(d.getUTCHours())) { d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0); continue; }
    if (!c.minute.has(d.getUTCMinutes())) { d.setUTCMinutes(d.getUTCMinutes() + 1); continue; }
    out.push(new Date(d.getTime()));
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  return out;
}

const DOW_NAMES = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function listWords(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const sorted = (set) => [...set].sort((a, b) => a - b);

/** [3,4,5,6,9] -> [[3,6],[9,9]]: consecutive values collapse once there are 3+. */
function runs(nums) {
  const out = [];
  for (const n of nums) {
    const last = out[out.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out.flatMap(([a, b]) => (b - a >= 2 ? [[a, b]] : Array.from({ length: b - a + 1 }, (_, i) => [a + i, a + i])));
}

/** "3:17 AM" for a Date, in the given IANA zone. */
export function timeIn(d, tz) {
  return d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
}

/** YYYY-MM-DD of a Date as seen in `tz`. */
function dateIn(d, tz) {
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}

/**
 * Plain-words description: { text, utc, dayShift }.
 *   "17 7 * * *"  -> "daily at 3:17 AM"
 *   "0 12 8 * *"  -> "monthly on the 8th at 8:00 AM"
 *   "0 7 * * 1"   -> "Mondays at 3:00 AM"
 * Local times come from the actual upcoming occurrences, so DST is right for
 * the next run (GitHub cron is UTC; the local time moves an hour at DST).
 * dayShift is true when, in `tz`, the run lands on a different calendar day
 * than its UTC date - "the 8th" is then the 7th locally, and the text says so.
 */
export function describeCron(expr, tz = "America/New_York", from = new Date()) {
  const c = parseCron(expr);
  const mins = sorted(c.minute), hours = sorted(c.hour);
  const pad = (n) => String(n).padStart(2, "0");

  let when;
  if (hours.length === 24 && mins.length === 1) when = `hourly at :${pad(mins[0])}`;
  else if (hours.length === 24 && mins.length > 1) when = `every ${60 / mins.length} minutes`;
  else if (hours.length * mins.length > 3) when = `${hours.length * mins.length} times a day`;
  else {
    const upcoming = nextRuns(c, from, 6);
    const times = [...new Set(upcoming.map((d) => timeIn(d, tz)))].slice(0, hours.length * mins.length);
    when = `at ${listWords(times)}`;
  }

  let days;
  const dows = sorted(c.dow);
  if (c.domStar && c.dowStar) days = "daily";
  else if (c.domStar) {
    if (dows.join() === "1,2,3,4,5") days = "weekdays";
    else if (dows.join() === "0,6") days = "weekends";
    else days = listWords(dows.map((d) => DOW_NAMES[d]));
  } else {
    const restricted = sorted(c.month).length < 12;
    days = `${restricted ? "on the" : "monthly on the"} ${listWords(runs(sorted(c.dom)).map(([a, b]) => (a === b ? ordinal(a) : `${ordinal(a)}\u2013${ordinal(b)}`)))}`;
    if (!c.dowStar) days += ` or ${listWords(dows.map((d) => DOW_NAMES[d]))}`;
  }
  const months = sorted(c.month);
  if (months.length < 12) days += ` in ${listWords(months.map((m) => MONTHS[m - 1]))}`;

  const next = nextRuns(c, from, 1)[0];
  const dayShift = !!next && dateIn(next, "UTC") !== dateIn(next, tz);
  // "daily hourly at :05" reads badly - a sub-daily rhythm already implies it.
  let text = days === "daily" && !when.startsWith("at ") ? when : `${days} ${when}`;
  if (dayShift && !(c.domStar && c.dowStar)) text += " (the evening before, local)";

  const utc = hours.length * mins.length <= 3
    ? hours.flatMap((h) => mins.map((m) => `${pad(h)}:${pad(m)}`)).join(", ") + " UTC"
    : "UTC";
  return { text, utc, dayShift };
}
