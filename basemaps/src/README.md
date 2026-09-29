# basemaps: vendored library

**Do not edit anything in this directory.** It is a copy of
`FleetShareableCodeComponents/basemaps/src`, placed here by Statehouse's
`sync-shared-code.py --lib basemaps`. Fix it there, bump `VERSION`, and sync.

The fleet's base map switcher: Streets (CARTO Voyager) / Aerial (Ohio Statewide
Imagery Program orthophotos via OGRIP's tile cache) / Aerial + labels. The
aerial choices zoom one level closer (21) than streets (19); that extra level
was the request that started this (Sep 2026).

```tsx
import { useBaseMap } from "../vendor/basemaps/useBaseMap";        // App.tsx
import BaseMapLayers from "../vendor/basemaps/BaseMapLayers";       // inside <MapContainer>
import BaseMapPicker from "../vendor/basemaps/BaseMapPicker";       // in the Layers panel
import type { BaseMapId } from "../vendor/basemaps/basemaps";

const [baseMap, setBaseMap] = useBaseMap();                 // remembered in localStorage
<BaseMapLayers baseMap={baseMap} />                          // CARTO no-labels + labels pane (parcels apps)
<BaseMapLayers baseMap={baseMap} streets={OSM} streetsLabels={null} />  // apps that keep plain OSM
<BaseMapPicker value={baseMap} onChange={setBaseMap} />
```

- `basemaps.ts`: ids, tile specs, zoom rules, localStorage read/write. Pure; its
  suite lives in the library repo (`basemaps/test/`), not here, because not
  every app that vendors this carries vitest.
- `BaseMapLayers.tsx`: the tile layers, keyed by choice, plus the maxZoom sync.
- `BaseMapPicker.tsx`: the radio group. Inline-styled so no app CSS changes.
- `useBaseMap.ts`: state + persistence under the shared key `fleet-basemap`.

The app keeps its own `MapContainer maxZoom={19}`; `BaseMapLayers` raises and
lowers the live map's ceiling as the choice changes.

Service worker: the aerial tiles come from `maps.ohio.gov`. Each app's
`vite.config.ts` Workbox `runtimeCaching` carries an `osip-tiles` CacheFirst
entry beside `carto-tiles` so the aerial works offline the same way streets do.
