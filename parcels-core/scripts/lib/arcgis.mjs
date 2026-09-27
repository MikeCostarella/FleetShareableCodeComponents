/**
 * ArcGIS request, paging and completeness helpers for the harvest pipeline.
 *
 * Extracted from the ten county fetch-parcels.mjs scripts (Statehouse issue
 * #10) and the eight inspect-source.mjs scripts (issue #17), which had grown
 * four incompatible copies of the request helper and three of the paging loop.
 *
 * No I/O beyond fetch, no globals: everything a script configures is a
 * parameter, so every helper here is unit-testable with a stub client.
 *
 * WHY POST AND NOT GET
 * --------------------
 * The id sweep passes a list of object ids, and 200 ids is about 1,800
 * characters of query string. ArcGIS does not answer an over-long GET with
 * 414 Request-URI Too Long — it answers with a bare HTTP 404 whose body is an
 * HTML error page. The caller then tries to JSON.parse "<!DOCTYPE html..." and
 * dies with a syntax error pointing at the parser rather than at the request.
 * That is exactly how Delaware failed: the sweep ran fine for 600 parcels and
 * then threw `Unexpected token '<'`. Greene hit the same wall and the same fix
 * applied. POST removes the entire class of failure and costs nothing.
 *
 * ArcGIS also reports failures as HTTP 200 with an error body, so `res.ok` is
 * never a sufficient guard — the payload shape is what gets checked.
 */

/** A 200 response whose body is an HTML error page rather than JSON. */
export const looksLikeHtml = (text) => /^\s*</.test(text);

/**
 * Are these numbers longitudes/latitudes, or projected State Plane feet?
 * Franklin's X_COORD runs to 1,892,494; degrees never leave [-180, 180].
 */
export const looksLikeDegrees = (values) =>
  values.length > 0 && Math.max(...values.map((v) => Math.abs(Number(v) || 0))) < 200;

export const chunk = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Build an `ask(base, params)` function: POST, `f=json` injected, HTML sniffed,
 * error-in-a-200 body raised, per-request timeout, exponential backoff.
 *
 * The timeout is not optional dressing. Cuyahoga, Delaware and Franklin all
 * shipped without one, and a half-open socket hangs a 494,525-parcel harvest
 * indefinitely: the retry loop never fires because fetch never settles.
 */
export function makeArcgisClient({
  fetchImpl = globalThis.fetch,
  retries = 4,
  timeoutMs = 60_000,
  backoff = (attempt) => 1000 * 2 ** attempt,
  sleep = defaultSleep,
  snippet = 120,
  onRetry = null,
} = {}) {
  return async function ask(base, params, { path = "/query" } = {}) {
    const body = new URLSearchParams({ f: "json", ...params });
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchImpl(`${base}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
        });
        const text = await res.text();
        if (looksLikeHtml(text)) {
          throw new Error(
            `HTTP ${res.status}: service returned HTML, not JSON — ` +
              `${text.slice(0, snippet).replace(/\s+/g, " ")}`,
          );
        }
        const data = JSON.parse(text);
        if (data.error) {
          throw new Error(`service error ${data.error.code}: ${data.error.message}`);
        }
        return data;
      } catch (err) {
        lastErr = err;
        if (attempt >= retries) break;
        if (onRetry) onRetry(err, attempt + 1);
        await sleep(backoff(attempt));
      }
    }
    throw lastErr;
  };
}

/** Copy the requested attributes off a feature, dropping helper columns. */
export function pick(attributes, fields, { drop = [] } = {}) {
  const rec = {};
  for (const name of fields) rec[name] = attributes?.[name] ?? null;
  for (const name of drop) delete rec[name];
  return rec;
}

/**
 * Spread a sample across the whole id range.
 *
 * Delaware's first inspector took the first 4,000 rows by OBJECTID and got one
 * rural corner of the county — it reported MUN_NAME as 100% blank and nearly
 * filed every city as a township. A contiguous slice of a parcel layer is a
 * contiguous piece of the county.
 */
export function spreadSample(ids, n) {
  if (n >= ids.length) return [...ids];
  const step = Math.max(1, Math.floor(ids.length / n));
  const picked = [];
  for (let i = 0; i < ids.length && picked.length < n; i += step) picked.push(ids[i]);
  return picked;
}

/** Object ids the paged pass never returned. */
export const missingIds = (allIds, have) =>
  allIds.filter((id) => !(have instanceof Set ? have.has(id) : have.includes(id)));

/**
 * The feature count and the id list rarely agree exactly, and the direction
 * matters: more features than parcels means multi-feature parcels the build
 * must merge; fewer means a filtered view or a short harvest.
 *
 * Franklin's version wrapped the difference in Math.abs and then asserted
 * "more features than the count" regardless of sign. Say what is true.
 */
export function reconcileIdsAndCount(idsLength, total) {
  const diff = idsLength - total;
  if (diff === 0) return null;
  const n = Math.abs(diff).toLocaleString();
  return diff > 0
    ? `${n} more ids than the reported count — multi-feature parcels or a stale count. ` +
        `The build must merge features per parcel number.`
    : `${n} fewer ids than the reported count — a filtered view, or the count is stale.`;
}

export const resolveOidField = (meta, fields = meta?.fields ?? []) =>
  meta?.objectIdField || fields.find((f) => f.type === "esriFieldTypeOID")?.name || "OBJECTID";

/**
 * Offset paging, advancing by what actually arrived.
 *
 * Every lineage-B script advanced by the PAGE constant regardless of how many
 * features came back, while its own termination test explicitly anticipated a
 * short-but-not-final page — so in exactly that case the next request started
 * PAGE - features.length rows past the end of what was received, and those
 * rows were never fetched.
 *
 * `orderByFields` is not cosmetic either. Paging without a stable sort is
 * undefined behaviour: the server may return rows in a different order each
 * time, so a parcel can appear on two pages and another on none.
 */
export async function pageAll({
  ask,
  base,
  total,
  page,
  params = {},
  startOffset = 0,
  orderBy = "OBJECTID",
  onFeatures,
  onPage = null,
  onShortPage = null,
}) {
  let offset = startOffset;
  let consumed = 0;
  while (total == null || offset < total) {
    const data = await ask(base, {
      ...params,
      orderByFields: orderBy,
      resultOffset: String(offset),
      resultRecordCount: String(page),
    });
    const features = data.features ?? [];
    const requestedAt = offset;
    if (!features.length) {
      if (onShortPage) onShortPage({ offset: requestedAt, got: 0 });
      break;
    }
    await onFeatures(features);
    offset += features.length;
    consumed += features.length;
    if (onPage) onPage({ offset, consumed, got: features.length });
    if (features.length < page && !data.exceededTransferLimit && onShortPage) {
      onShortPage({ offset: requestedAt, got: features.length });
    }
  }
  return { offset, consumed };
}

/**
 * Refuse to page a service that ignores resultOffset.
 *
 * A service that silently ignores the offset returns page 1 forever, and the
 * loop would spin until it hit the cap having harvested the same 1,000 parcels
 * a hundred times. Ask for one row at offset 0 and one at offset 1; if they
 * are the same row, offset is not honoured.
 */
export async function probeOffsetHonored({ ask, base, keyField, orderBy = "OBJECTID", params = {} }) {
  const at = async (offset) => {
    const data = await ask(base, {
      ...params,
      outFields: keyField,
      returnGeometry: "false",
      orderByFields: orderBy,
      resultOffset: String(offset),
      resultRecordCount: "1",
    });
    return data.features?.[0]?.attributes?.[keyField];
  };
  const [first, second] = [await at(0), await at(1)];
  return { honored: first !== second || first === undefined, first, second };
}

/** Fetch rows by object id in batches, folding each page through `onFeatures`. */
export async function fetchByIds({ ask, base, ids, batch = 150, params = {}, onFeatures, onBatch = null }) {
  for (const [i, slice] of chunk(ids, batch).entries()) {
    const data = await ask(base, { ...params, objectIds: slice.join(",") });
    await onFeatures(data.features ?? []);
    if (onBatch) onBatch({ done: Math.min((i + 1) * batch, ids.length), total: ids.length });
  }
}
