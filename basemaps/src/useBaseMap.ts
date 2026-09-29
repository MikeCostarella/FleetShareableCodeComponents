import { useCallback, useState } from "react";
import { readStoredBaseMap, writeStoredBaseMap } from "./basemaps";
import type { BaseMapId } from "./basemaps";

/**
 * The user's base map choice, remembered in localStorage under the shared
 * fleet key so it carries from one county app to the next.
 *
 *   const [baseMap, setBaseMap] = useBaseMap();
 *   <BaseMapLayers baseMap={baseMap} />
 *   <BaseMapPicker value={baseMap} onChange={setBaseMap} />
 */
export function useBaseMap(): [BaseMapId, (id: BaseMapId) => void] {
  const [baseMap, setState] = useState<BaseMapId>(() => readStoredBaseMap());
  const setBaseMap = useCallback((id: BaseMapId) => {
    setState(id);
    writeStoredBaseMap(id);
  }, []);
  return [baseMap, setBaseMap];
}
