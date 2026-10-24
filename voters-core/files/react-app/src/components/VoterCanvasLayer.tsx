import { useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { Voter } from "../types/voter";
import {
  buildClusterPyramid,
  clusterRadius,
  packPoints,
  pointRadius,
  projectLatLon,
  UNCLUSTERED_ZOOM,
  type ClusterPyramid,
  type PackedPoints,
} from "../vendor/parcels-core/data/canvasRender";

/** A voter that has coordinates, plus the colour index the renderer draws by. */
export interface MappedVoter {
  voter: Voter;
  lat: number;
  lon: number;
  /**
   * Index into `colors` - a party, or an early-voting status when the map is
   * coloured that way - so the hot loop compares numbers not strings.
   */
  type: number;
}

/** What the cursor is over, surfaced for the hover card. */
export type HoverInfo =
  | { kind: "point"; voter: Voter; x: number; y: number }
  | { kind: "cluster"; count: number; x: number; y: number };

/** Hit-test record for click and hover resolution. */
interface DrawItem {
  x: number;
  y: number;
  r: number;
  kind: "point" | "cluster";
  idx?: number;
  lat?: number;
  lon?: number;
  count?: number;
}

interface VoterCanvasLayerProps {
  /** Every mapped voter. Filtering happens in the draw loop, not here. */
  points: MappedVoter[];
  /** Fill colour per `type` index, looked up in the draw loop. */
  colors: string[];
  /**
   * 1 = show, 0 = hide, aligned to `points`. null when nothing is filtered,
   * which is the case that gets to use the precomputed cluster pyramid.
   */
  mask: Uint8Array | null;
  onSelect: (v: Voter) => void;
  onHover?: (info: HoverInfo | null) => void;
}

/**
 * Canvas overlay drawing ~28k voter dots, coloured by party.
 *
 * Adapted from TrumbullCountyParcels' CanvasPointLayer and using the same
 * parcels-core helpers: inline Mercator projection, points in parallel typed
 * arrays, viewport culling, fills batched by colour, and a cluster pyramid
 * precomputed once at load. The parcel version carries three separate filter
 * inputs; a voter's visibility is a single yes/no that the list view has
 * already worked out, so this takes one mask instead.
 */
export default function VoterCanvasLayer({
  points,
  colors,
  mask,
  onSelect,
  onHover,
}: VoterCanvasLayerProps) {
  const map = useMap();

  // Pack + build the pyramid once per data change, never per filter change.
  const packed: PackedPoints = useMemo(() => packPoints(points), [points]);
  const pyramid: ClusterPyramid = useMemo(() => buildClusterPyramid(packed), [packed]);

  // Refs the draw loop reads, so it never has to be torn down and rebuilt.
  const stateRef = useRef({ packed, pyramid, mask, points, colors, onSelect, onHover });
  stateRef.current = { packed, pyramid, mask, points, colors, onSelect, onHover };

  const lastItemsRef = useRef<DrawItem[]>([]);
  const redrawRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Dedicated pane at z-index 450: above tiles and boundary outlines (350),
    // below the marker pane (600) so the "you are here" marker stays on top.
    const PANE_NAME = "voter-canvas-pane";
    let pane = map.getPane(PANE_NAME);
    if (!pane) {
      pane = map.createPane(PANE_NAME);
      pane.style.zIndex = "450";
      pane.style.pointerEvents = "none";
      // Hide during the zoom animation; we redraw crisply on zoomend.
      pane.classList.add("leaflet-zoom-hide");
    }

    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.pointerEvents = "none";
    const ctx = canvas.getContext("2d", { alpha: true })!;
    pane.appendChild(canvas);

    let scheduled = false;

    function positionCanvas() {
      const size = map.getSize();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== size.x * dpr || canvas.height !== size.y * dpr) {
        canvas.width = size.x * dpr;
        canvas.height = size.y * dpr;
        canvas.style.width = size.x + "px";
        canvas.style.height = size.y + "px";
      }
      // Draw in layer-point space so the canvas pans with the map for free.
      const topLeft = map.containerPointToLayerPoint([0, 0]);
      canvas.style.transform = "";
      L.DomUtil.setPosition(canvas, topLeft);
    }

    const colorOf = (type: number) => stateRef.current.colors[type] ?? "#8ab4cc";

    function draw() {
      const st = stateRef.current;
      if (!st.packed.n) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        lastItemsRef.current = [];
        return;
      }
      positionCanvas();
      const dpr = window.devicePixelRatio || 1;
      const size = map.getSize();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);

      const actualZoom = map.getZoom();
      const zoomLevel = Math.round(actualZoom);
      const items: DrawItem[] = [];

      // Offset so projectLatLon(...) - (ox,oy) lands in canvas-local pixels.
      const originLP = map.containerPointToLayerPoint([0, 0]);
      const anchorLat = 41.3171;
      const anchorLon = -80.7607;
      const [apx, apy] = projectLatLon(anchorLat, anchorLon, actualZoom);
      const al = map.latLngToLayerPoint([anchorLat, anchorLon]);
      const ox = apx - (al.x - originLP.x);
      const oy = apy - (al.y - originLP.y);

      const bounds = map.getBounds();
      const minLat = bounds.getSouth();
      const maxLat = bounds.getNorth();
      const minLon = bounds.getWest();
      const maxLon = bounds.getEast();

      if (zoomLevel < UNCLUSTERED_ZOOM && st.pyramid[zoomLevel] && !st.mask) {
        drawClusters(st.pyramid[zoomLevel], actualZoom, ox, oy, size, items);
      } else if (zoomLevel < UNCLUSTERED_ZOOM) {
        drawDynamicClusters(actualZoom, ox, oy, items, minLat, maxLat, minLon, maxLon);
      } else {
        drawIndividualPoints(actualZoom, ox, oy, items, minLat, maxLat, minLon, maxLon);
      }

      lastItemsRef.current = items;
    }

    function bubble(x: number, y: number, count: number, color: string, items: DrawItem[], lat: number, lon: number) {
      const rad = clusterRadius(count);
      ctx.fillStyle = color + "40";
      ctx.beginPath();
      ctx.arc(x, y, rad + 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = color;
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "white";
      ctx.font = `bold ${count < 100 ? 12 : count < 1000 ? 13 : 14}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillText(
        count >= 1000 ? (count / 1000).toFixed(count < 10000 ? 1 : 0) + "k" : String(count),
        x,
        y,
      );
      items.push({ kind: "cluster", x, y, r: rad + 4, lat, lon, count });
    }

    function drawClusters(
      layer: ClusterPyramid[number],
      actualZoom: number,
      ox: number,
      oy: number,
      size: L.Point,
      items: DrawItem[],
    ) {
      const n = layer.lats.length;
      const vL = -50;
      const vT = -50;
      const vR = size.x + 50;
      const vB = size.y + 50;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let i = 0; i < n; i++) {
        const [px, py] = projectLatLon(layer.lats[i], layer.lons[i], actualZoom);
        const x = px - ox;
        const y = py - oy;
        if (x < vL || x > vR || y < vT || y > vB) continue;
        bubble(x, y, layer.counts[i], colorOf(layer.dominant[i]), items, layer.lats[i], layer.lons[i]);
      }
    }

    /** Filters are active, so the cached pyramid is wrong — recluster live. */
    function drawDynamicClusters(
      zoom: number,
      ox: number,
      oy: number,
      items: DrawItem[],
      minLat: number,
      maxLat: number,
      minLon: number,
      maxLon: number,
    ) {
      const st = stateRef.current;
      const CELL_PX = 60;
      const scale = 256 * Math.pow(2, zoom);
      const cells = new Map<
        number,
        { sx: number; sy: number; c: number; types: Record<number, number> }
      >();
      const { lats, lons, types, n } = st.packed;
      const m = st.mask;
      for (let i = 0; i < n; i++) {
        const lat = lats[i];
        const lon = lons[i];
        if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) continue;
        if (m && !m[i]) continue;
        const sinLat = Math.sin((lat * Math.PI) / 180);
        const px = scale * (lon / 360 + 0.5);
        const py = scale * (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI));
        const key = Math.floor(px / CELL_PX) * 4194304 + Math.floor(py / CELL_PX);
        let cell = cells.get(key);
        if (!cell) {
          cell = { sx: 0, sy: 0, c: 0, types: {} };
          cells.set(key, cell);
        }
        cell.sx += lat;
        cell.sy += lon;
        cell.c += 1;
        cell.types[types[i]] = (cell.types[types[i]] ?? 0) + 1;
      }

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const cell of cells.values()) {
        const clat = cell.sx / cell.c;
        const clon = cell.sy / cell.c;
        const [px, py] = projectLatLon(clat, clon, zoom);
        const x = px - ox;
        const y = py - oy;
        let dom = 0;
        let best = -1;
        for (const k in cell.types) {
          if (cell.types[k] > best) {
            best = cell.types[k];
            dom = Number(k);
          }
        }
        if (cell.c === 1) {
          const r = pointRadius(zoom);
          ctx.fillStyle = colorOf(dom);
          ctx.strokeStyle = "rgba(255,255,255,0.95)";
          ctx.lineWidth = Math.max(1, r * 0.2);
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          items.push({ kind: "cluster", x, y, r: r + 2, lat: clat, lon: clon, count: 1 });
          continue;
        }
        bubble(x, y, cell.c, colorOf(dom), items, clat, clon);
      }
    }

    function drawIndividualPoints(
      zoom: number,
      ox: number,
      oy: number,
      items: DrawItem[],
      minLat: number,
      maxLat: number,
      minLon: number,
      maxLon: number,
    ) {
      const st = stateRef.current;
      const r = pointRadius(zoom);
      const { lats, lons, types, n } = st.packed;
      const m = st.mask;

      // Group visible indices by party so each colour is one batched fill.
      const byType = new Map<number, number[]>();
      for (let i = 0; i < n; i++) {
        const lat = lats[i];
        const lon = lons[i];
        if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) continue;
        if (m && !m[i]) continue;
        let arr = byType.get(types[i]);
        if (!arr) {
          arr = [];
          byType.set(types[i], arr);
        }
        arr.push(i);
      }

      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = Math.max(1, r * 0.2);
      for (const [type, indices] of byType) {
        ctx.fillStyle = colorOf(type);
        ctx.beginPath();
        for (let k = 0; k < indices.length; k++) {
          const i = indices[k];
          const [px, py] = projectLatLon(lats[i], lons[i], zoom);
          const x = px - ox;
          const y = py - oy;
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
          items.push({ kind: "point", x, y, r, idx: i });
        }
        ctx.fill();
        ctx.stroke();
      }
    }

    function scheduleDraw() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        draw();
      });
    }

    // Leaflet CSS-scales the pane during a zoom; our canvas is fixed-size, so
    // clear on zoomstart and redraw once the view settles.
    let zooming = false;
    function onZoomStart() {
      zooming = true;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    function settle() {
      zooming = false;
      positionCanvas();
      scheduleDraw();
    }
    function onMove() {
      if (zooming || (map as unknown as { _animatingZoom?: boolean })._animatingZoom) return;
      scheduleDraw();
    }

    function hitTest(cp: L.Point): DrawItem | null {
      const items = lastItemsRef.current;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        const dx = cp.x - it.x;
        const dy = cp.y - it.y;
        const hitR = Math.max(it.r, 14);
        if (dx * dx + dy * dy <= hitR * hitR) return it;
      }
      return null;
    }

    function onClick(e: L.LeafletMouseEvent) {
      const it = hitTest(e.containerPoint);
      if (!it) return;
      if (it.kind === "point" && it.idx != null) {
        const st = stateRef.current;
        st.onSelect(st.points[it.idx].voter);
      } else if (it.kind === "cluster" && it.lat != null && it.lon != null) {
        map.flyTo([it.lat, it.lon], Math.min(map.getZoom() + 2, 19), {
          animate: true,
          duration: 0.5,
        });
      }
    }

    let hoverScheduled = false;
    let pendingEvent: L.LeafletMouseEvent | null = null;
    let hovering = false;
    const container = map.getContainer();

    function emitHover(e: L.LeafletMouseEvent) {
      const st = stateRef.current;
      const cp = e.containerPoint;
      const it = hitTest(cp);
      if (it) {
        hovering = true;
        container.style.cursor = "pointer";
        if (it.kind === "point" && it.idx != null) {
          st.onHover?.({ kind: "point", voter: st.points[it.idx].voter, x: cp.x, y: cp.y });
        } else if (it.count != null) {
          st.onHover?.({ kind: "cluster", count: it.count, x: cp.x, y: cp.y });
        }
        return;
      }
      if (hovering) {
        hovering = false;
        container.style.cursor = "";
        st.onHover?.(null);
      }
    }

    function onMouseMove(e: L.LeafletMouseEvent) {
      pendingEvent = e;
      if (hoverScheduled) return;
      hoverScheduled = true;
      requestAnimationFrame(() => {
        hoverScheduled = false;
        if (pendingEvent) emitHover(pendingEvent);
      });
    }

    function clearHover() {
      hovering = false;
      container.style.cursor = "";
      stateRef.current.onHover?.(null);
    }

    function reposition() {
      positionCanvas();
      scheduleDraw();
    }

    map.on("move", onMove);
    map.on("moveend", settle);
    map.on("zoomstart", onZoomStart);
    map.on("zoomend", settle);
    map.on("viewreset", reposition);
    map.on("resize", reposition);
    map.on("click", onClick);
    map.on("mousemove", onMouseMove);
    map.on("mouseout", clearHover);
    map.on("movestart", clearHover);

    let resizeTimer: number | undefined;
    function handleContainerResize() {
      map.invalidateSize();
      reposition();
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        map.invalidateSize();
        reposition();
      }, 120);
    }
    const ro = new ResizeObserver(handleContainerResize);
    ro.observe(map.getContainer());

    redrawRef.current = reposition;
    scheduleDraw();

    return () => {
      ro.disconnect();
      window.clearTimeout(resizeTimer);
      map.off("move", onMove);
      map.off("moveend", settle);
      map.off("zoomstart", onZoomStart);
      map.off("zoomend", settle);
      map.off("viewreset", reposition);
      map.off("resize", reposition);
      map.off("click", onClick);
      map.off("mousemove", onMouseMove);
      map.off("mouseout", clearHover);
      map.off("movestart", clearHover);
      canvas.remove();
      redrawRef.current = null;
    };
  }, [map]);

  // The effect above runs once per map; this redraws when data or filters move.
  useEffect(() => {
    redrawRef.current?.();
  }, [packed, pyramid, mask, colors]);

  return null;
}
