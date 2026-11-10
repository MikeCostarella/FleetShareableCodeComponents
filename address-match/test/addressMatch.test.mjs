import { strict as assert } from "node:assert";
import { splitAddress, splitCompound, coreName, tokenize, buildIndex, matchAddress, TIER, buildPolygonIndex, placeKey } from "../src/addressMatch.mjs";
assert.deepEqual(tokenize("3910 EAST RIVER ROAD SW"), ["3910","E","RIVER","RD","SW"]);
assert.deepEqual(coreName(splitAddress("3910 EAST RIVER ROAD SW").rest), ["E","RIVER"]);
assert.deepEqual(tokenize("STATE ROUTE 46"), ["SR","46"]);
assert.deepEqual(splitCompound("1810-12 N 4TH ST"), ["1810 N 4TH ST","1812 N 4TH ST"]);
assert.deepEqual(splitCompound("1088 & 1100 N HIGH ST"), ["1088 N HIGH ST","1100 N HIGH ST"]);
assert.deepEqual(splitCompound("16 S MARKET ST & 103-05 W LIBERTY ST"), ["16 S MARKET ST","103 W LIBERTY ST","105 W LIBERTY ST"]);
const ix = buildIndex({
  parcels: [{ n: "010-1", f: "281 E WHITTIER ST", z: "43206", y: 39.94, x: -82.98, j: "Columbus" }, { n: "010-2", f: "1025 - 1027 COLUMBUS ST", z: "43206", y: 39.95, x: -82.99 }],
  voters: { fields: ["street","city","zip","lat","lon","precinct"], cities: ["COLUMBUS"], zips: ["43206"], precincts: ["COLS 01-A"], voters: [["281 E WHITTIER ST",0,0,39.9401,-82.9801,0]] },
});
let m = matchAddress(ix, { street: "281 EAST WHITTIER STREET", city: "COLUMBUS", zip: "43206" });
assert.equal(m.tier, TIER.PARCEL); assert.equal(m.parcelId, "010-1"); assert.equal(m.precinct, "COLS 01-A");
m = matchAddress(ix, { street: "1027 COLUMBUS ST", city: "COLUMBUS" });
assert.equal(m.parcelId, "010-2");
m = matchAddress(ix, { street: "999 NOWHERE LN", city: "COLUMBUS" });
assert.equal(m.tier, TIER.NONE);
const poly = buildPolygonIndex({ type: "FeatureCollection", features: [{ type: "Feature", properties: { NAME: "Box" }, geometry: { type: "Polygon", coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } }] }, (f) => f.properties.NAME);
assert.equal(poly.locate(0.5, 0.5), "Box"); assert.equal(poly.locate(2, 2), null);
// 1.1.0 — spellings met in the DOLC permit file
const core = (a) => coreName(splitAddress(a).rest).join(" ");
assert.equal(core("6362 SR598"), core("6362 ST RT 598"));
assert.equal(core("7231 OH-14"), core("7231 STATE ROUTE 14"));
assert.equal(core("7558 CR16"), core("7558 COUNTY ROAD 16"));
assert.equal(core("3038 W 117TH ST"), core("3038 W 117 ST"));
assert.equal(core("296 E 4TH ST"), core("296 E FOURTH ST"));
assert.equal(core("26485 CTR RIDGE RD"), core("26485 CENTER RIDGE RD"));
assert.equal(core("7668 WOOSTER PK"), core("7668 WOOSTER PIKE"));
assert.equal(core("2820 S 3RD ST"), core("2820 SO 3RD ST"));
assert.deepEqual(splitAddress("1050 1/2 S REYNOLDS RD"), splitAddress("1050 S REYNOLDS RD"));
assert.deepEqual(splitAddress("610 1 2 W MAIN ST"), splitAddress("610 W MAIN ST"));
assert.deepEqual(splitAddress("18334-B BAGLEY RD"), splitAddress("18334 BAGLEY RD"));
assert.deepEqual(splitAddress("590 D OAKLAND PARK AVE"), splitAddress("590 OAKLAND PARK AVE"));
assert.deepEqual(splitAddress("530C QUALITY BLVD"), splitAddress("530 QUALITY BLVD"));
assert.deepEqual(splitAddress("09891 CR33A  1ST FL"), splitAddress("9891 COUNTY ROAD 33A"));
assert.equal(core("123 B ST"), "B"); assert.equal(core("100 E MAIN ST"), "E MAIN");
assert.equal(core("2154 SOUTH AVE"), "S"); assert.equal(core("438 N PARK AVE"), "N PARK");
assert.equal(core("932 HURON ST 1ST FL"), "HURON"); assert.equal(core("5834 MONROE ST SUITES B"), "MONROE");
assert.equal(core("1256 BROADWAY UNITS 1 2"), "BROADWAY"); assert.equal(core("1881 7 MILE DR"), "7 MILE");
assert.deepEqual(splitCompound("5676-78-80 MAYBERRY SQ"), ["5676 MAYBERRY SQ", "5678 MAYBERRY SQ", "5680 MAYBERRY SQ"]);
assert.deepEqual(splitCompound("1291  1295  GRANDVIEW AVE"), ["1291 GRANDVIEW AVE", "1295 GRANDVIEW AVE"]);
assert.deepEqual(splitCompound("1955 & 1959 & 1961 E MAPLE ST"), ["1955 E MAPLE ST", "1959 E MAPLE ST", "1961 E MAPLE ST"]);
assert.deepEqual(splitCompound("46638 Y & O RD"), ["46638 Y & O RD"]);
assert.deepEqual(splitCompound("222 1 2 & 224 PUTNAM ST"), ["222 PUTNAM ST", "224 PUTNAM ST"]);
assert.equal(core("46638 Y & O RD"), "Y O"); assert.equal(core("4715 HILLS & DALES RD NW"), "HILLS DALES");
assert.equal(core("4715 HILLS AND DALES RD NW"), "HILLS DALES");
assert.deepEqual(splitCompound("2092 Woodville Rd & Patios"), ["2092 WOODVILLE RD"]);
assert.deepEqual(splitCompound("1900 RANDOLPH RD & GOLF COURSE"), ["1900 RANDOLPH RD"]);
assert.deepEqual(splitAddress("1470 A N BRIDGE ST"), splitAddress("1470 N BRIDGE ST"));
assert.deepEqual(splitCompound("3946 MORSE CROSSING & MEZZANINES"), ["3946 MORSE CROSSING"]);
assert.equal(core("313 E NORTH ST"), "E N"); assert.equal(core("100 HIGH N ST"), "HIGH");
assert.equal(core("3519 S COUNTY RD 25-A"), core("3519 S CR 25A")); assert.equal(core("6566 SR503N"), core("6566 STATE ROUTE 503 N"));
{
  const w = buildIndex({ parcels: [
    { n: "E", f: "275 PARK AVE E", z: "44902", y: 40.76, x: -82.50, j: "Mansfield" },
    { n: "W", f: "275 PARK AVE W", z: "44902", y: 40.76, x: -82.53, j: "Mansfield" },
    { n: "W2", f: "301 PARK AVE W", z: "44902", y: 40.76, x: -82.535, j: "Mansfield" },
  ] });
  assert.equal(matchAddress(w, { street: "275 PARK AVE W", city: "MANSFIELD", zip: "44902" }).parcelId, "W");
  const near = matchAddress(w, { street: "281 PARK AVE W", city: "MANSFIELD", zip: "44902" });
  assert.equal(near.tier, TIER.STREET); assert.ok(Math.abs(near.lon + 82.53) < 1e-6);
}
assert.deepEqual(splitCompound("1881 7 MILE DR"), ["1881 7 MILE DR"]);
assert.deepEqual(splitCompound("KENWOOD TOWNE CENTRE\n7801 MONTGOMERY RD"), ["KENWOOD TOWNE CENTRE", "7801 MONTGOMERY RD"]);
assert.deepEqual(splitCompound("12700 TWP RD 477 NE\nAKA 9090 VETERANS WAY"), ["12700 TWP RD 477 NE", "9090 VETERANS WAY"]);
assert.deepEqual(splitCompound("Arts Center Annex, 6620 Montgomery Road, unit 2"), ["6620 MONTGOMERY ROAD"]);
assert.equal(placeKey("Liberty Twp"), placeKey("LIBERTY TOWNSHIP")); assert.equal(placeKey("The Village Of Indian Hill"), "INDIAN HILL");
assert.equal(placeKey("Shaker Hgts"), placeKey("Shaker Heights")); assert.equal(placeKey("Toledo city"), "TOLEDO");
{
  // A roll with no ZIPs (Hamilton): the parcel's jurisdiction is the geography.
  const h = buildIndex({ parcels: [
    { n: "A", f: "4835 WOOSTER PK", z: "", y: 39.14, x: -84.39, j: "Cincinnati" },
    { n: "B", f: "430 N SUPERIOR ST", z: "43604", y: 41.65, x: -83.53, j: "Toledo city" },
    { n: "C", f: "3920 W 117 ST", z: "44111", y: 41.45, x: -81.77, j: "Cleveland" },
  ] });
  let r = matchAddress(h, { street: "4841 WOOSTER PK", city: "CINCINNATI", zip: "45226" });
  assert.equal(r.tier, TIER.STREET);
  r = matchAddress(h, { street: "430 SUPERIOR ST", city: "TOLEDO", zip: "43604" });
  assert.equal(r.parcelId, "B");
  r = matchAddress(h, { street: "3920 W 117TH ST", city: "CLEVELAND", zip: "44111" });
  assert.equal(r.parcelId, "C");
}
console.log("address-match: all tests passed");
