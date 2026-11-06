import { strict as assert } from "node:assert";
import { splitAddress, splitCompound, coreName, tokenize, buildIndex, matchAddress, TIER, buildPolygonIndex } from "../src/addressMatch.mjs";
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
console.log("address-match: all tests passed");
