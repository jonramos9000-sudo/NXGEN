/**
 * @license
 * Copyright 2021 Google LLC.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Google Maps + Deck.gl with:
 *  - Connection type filters (N/C/H)
 *  - Pin group filters
 *  - Toggles to hide connections that touch (-82.492696, 27.8602) and (9.077841, 48.73448)
 */

// Tell TypeScript that 'deck' is a global object, loaded via a script tag.
declare const deck: any;

import type * as GeoJSON from "geojson";

const ScatterplotLayer = deck.ScatterplotLayer;
const ArcLayer = deck.ArcLayer;
const GoogleMapsOverlay = deck.GoogleMapsOverlay;
const iconLayer = deck.IconLayer;
const DataFilterExtension = deck.DataFilterExtension;
const airplaneIcon = "database/icons/airplane.png";
const boatIcon = "database/icons/a-large-navy-ship-silhouette-vector.png";
const truckIcon = "database/icons/truck.png";
const trailerIcon = "database/icons/trailer.png";

const ICON_MAP = {
  airplane: airplaneIcon,
  boat: boatIcon,
  truck: truckIcon,
  trailer: trailerIcon,
};

// ---------------------- Types & Data ----------------------

type Properties = { scalerank?: number; Connection_type?: string; from?: any; to?: any; name?: string };
type Feature = GeoJSON.Feature<GeoJSON.Geometry, Properties>;
type Data = GeoJSON.FeatureCollection<GeoJSON.Geometry, Properties> | any[];

// Data sources (can be strings representing file paths or already loaded datasets)
const connections: string | Data = "database/connections_geojson_like.json";
const points: string | Data = "database/points.json";

// Example icon pin feature
const feature = {
  type: "Feature",
  properties: { name: "E6" },
  geometry: { type: "Point", coordinates: [-124.122174, 39.676226] }
};

// ---------------------- Helper Functions ----------------------

/**
 * Get a property value from a data object.
 */
function getProp(d: any, key: string): any {
  return d?.[key] ?? d?.properties?.[key] ?? d?.connectionType;
}

/**
 * Extracts and normalizes the connection type from a feature.
 */
function getConnType(d: any): string {
  const t = getProp(d, "Connection_type") ?? getProp(d, "connection_type");
  const up = String(t ?? "").trim().toUpperCase();
  if (up === "N_TYPE") return "N";
  return up; // "N" | "C" | "HF" | (others)
}

/**
 * Gets the name property from a point feature.
 */
function getPointName(d: any): string {
  return getProp(d, "name") ?? "";
}

/**
 * Toggles the display property of a DOM element.
 */
function toggleDisplay(el: HTMLElement, force?: boolean) {
  const shouldShow = force !== undefined ? force : el.style.display === "none";
  el.style.display = shouldShow ? "flex" : "none";
}

// ---------------------- Pin Type Logic ----------------------

type PointType =
  | "YELLOW_GROUP"
  | "PURPLE_GROUP"
  | "ORANGE_GROUP"
  | "GREEN_GROUP"
  | "RED_GROUP"
  | "TURQUOISE_GROUP"
  | "VIOLET_GROUP"
  | "BLUE_GROUP"
  | "PINK_GROUP"
  | "WHITE_GROUP";

// Logic for pin color/group lookups and mapping
const PinLogic = {
  ALL_POINT_TYPES: [
    "RED_GROUP", "TURQUOISE_GROUP", "YELLOW_GROUP", "GREEN_GROUP",
    "PURPLE_GROUP", "ORANGE_GROUP", "BLUE_GROUP", "VIOLET_GROUP", "PINK_GROUP", "WHITE_GROUP"
  ] as PointType[],

  PIN_COLOR_MAP: {
    RED_GROUP:       [200, 0, 0, 220],
    TURQUOISE_GROUP: [64, 224, 208, 220],
    YELLOW_GROUP:    [255, 255, 0, 220],
    GREEN_GROUP:     [0, 128, 0, 220],
    PURPLE_GROUP:    [128, 0, 128, 220],
    ORANGE_GROUP:    [255, 165, 0, 220],
    BLUE_GROUP:      [0, 120, 255, 220],
    VIOLET_GROUP:    [130, 42, 245, 220],
    PINK_GROUP:      [255, 105, 180, 220],
    WHITE_GROUP:     [197, 110, 255, 220]
  } as Record<PointType, [number, number, number, number]>,

  PIN_LOOKUP_MAP: {
    // VIOLET_GROUP
    "sb": "VIOLET_GROUP",

    // YELLOW_GROUP
    "H_AK": "YELLOW_GROUP",
    "Point 13": "YELLOW_GROUP",
    "E6": "YELLOW_GROUP",
    "Point 6": "YELLOW_GROUP",

    // PURPLE_GROUP
    "Support Team": "PURPLE_GROUP",

    // ORANGE_GROUP
    "B": "ORANGE_GROUP",

    // GREEN_GROUP
    "M": "GREEN_GROUP",

    // RED_GROUP
    "HUB": "RED_GROUP",

    // TURQUOISE_GROUP
    "PENT": "TURQUOISE_GROUP",
    "COS":  "TURQUOISE_GROUP",
    "TB":   "TURQUOISE_GROUP",
    "RR":   "TURQUOISE_GROUP",
    "AZ":   "TURQUOISE_GROUP",
    "IP":   "TURQUOISE_GROUP",

    // PINK_GROUP
    "SAN": "PINK_GROUP",
    "SBL": "PINK_GROUP",
    "LUL": "PINK_GROUP",

    // WHITE_GROUP
    "Cutler": "WHITE_GROUP",
    "Grindavik": "WHITE_GROUP",
    "Awase": "WHITE_GROUP",
    "Harold E. Holt": "WHITE_GROUP",
    "Aguada": "WHITE_GROUP",
    "Wahiawa": "WHITE_GROUP",
    "Naples": "WHITE_GROUP",
    "Dixon": "WHITE_GROUP",
    "Jim Creek": "WHITE_GROUP",
    "La Moure": "WHITE_GROUP",
    "Norfolk": "WHITE_GROUP",
    "Yokosuka": "WHITE_GROUP",
    "Oklahoma City": "WHITE_GROUP"
  } as Record<string, PointType>,
};

// Set of active point types for filtering pins
let activePointTypes = new Set<PointType>(PinLogic.ALL_POINT_TYPES);

/**
 * Gets the group for a pin based on its name.
 */
function getPinkType(d: any): PointType {
  const name = getPointName(d);
  return PinLogic.PIN_LOOKUP_MAP[name] ?? "BLUE_GROUP";
}

/**
 * Gets the color for a pin based on its group type.
 */
function colorPinkByType(d: any): [number, number, number, number] {
  return PinLogic.PIN_COLOR_MAP[getPinkType(d)];
}

// ---------------------- Connection Styling ----------------------

/**
 * Gets the RGBA color for a connection based on type.
 */
function colorByTypeRGBA(d: any): [number, number, number, number] {
  switch (getConnType(d)) {
    case "N": return [0, 128, 200, 220];
    case "C": return [0, 200, 0, 220];
    case "HF": return [200, 0, 0, 220];
    default:  return [128, 128, 128, 200];
  }
}

/**
 * Gets the tilt value for a connection based on type.
 */
function tiltByType(d: any): number {
  switch (getConnType(d)) {
    case "N": return 5;
    case "C": return 10;
    case "HF": return 0;
    default:  return 0;
  }
}

/**
 * Gets the source position (lng, lat) for a connection.
 */
function getSourcePos(d: any): [number, number] {
  const src = getProp(d, "from")?.coordinates ?? getProp(d, "coordinates")?.[0];
  return src as [number, number];
}

/**
 * Gets the target position (lng, lat) for a connection.
 */
function getTargetPos(d: any): [number, number] {
  const tgt = getProp(d, "to")?.coordinates ?? getProp(d, "coordinates")?.slice(-1)[0];
  return tgt as [number, number];
}

/**
 * Returns a darker version of an RGBA color.
 */
function darker([r, g, b, a]: [number, number, number, number]): [number, number, number, number] {
  return [Math.floor(r * 0.5), Math.floor(g * 0.5), Math.floor(b * 0.5), a ?? 255];
}

/**
 * Formats a number to fixed decimal places.
 */
function fmt(n?: number, p = 5) {
  return typeof n === "number" ? n.toFixed(p) : "";
}

/**
 * Returns coordinates from a GeoJSON-like object as [lng, lat].
 */
function asLngLat(obj: any): [number, number] | null {
  if (obj?.geometry?.type === "Point") return obj.geometry.coordinates as [number, number];
  if (Array.isArray(obj?.coordinates))  return obj.coordinates as [number, number];
  return null;
}

// ---------------------- Filtering (GPU) ----------------------

type ConnType = "N" | "C" | "HF";
const ALL_TYPES: ConnType[] = ["N", "C", "HF"];
let activeTypes = new Set<ConnType>(["HF"]);

// Hub coordinates for filtering connections
const HUB_LNG  = -82.492696;
const HUB_LAT  = 27.8602;
const HUB_EPS  = 1e-6;
let hideHubConnections = false;

const HUB2_LNG = 9.077841;
const HUB2_LAT = 48.734481;
let hideHub2Connections = false;
let showIcons = true;

/**
 * Checks if two coordinates are within a small epsilon.
 */
function near(a: number, b: number, eps = HUB_EPS) {
  return Math.abs(a - b) <= eps;
}

/**
 * Returns true if a connection touches the first hub.
 */
function connectsToHub(d: any): boolean {
  const s = getSourcePos(d);
  const t = getTargetPos(d);
  if (!Array.isArray(s) || !Array.isArray(t)) return false;
  const [slng, slat] = s;
  const [tlng, tlat] = t;
  return (near(slng, HUB_LNG) && near(slat, HUB_LAT)) ||
         (near(tlng, HUB_LNG) && near(tlat, HUB_LAT));
}

/**
 * Returns true if a connection touches the second hub.
 */
function connectsToHub2(d: any): boolean {
  const s = getSourcePos(d);
  const t = getTargetPos(d);
  if (!Array.isArray(s) || !Array.isArray(t)) return false;
  const [slng, slat] = s;
  const [tlng, tlat] = t;
  return (near(slng, HUB2_LNG) && near(slat, HUB2_LAT)) ||
         (near(tlng, HUB2_LNG) && near(tlat, HUB2_LAT));
}

let overlay: any;
const dataFilterExt = new deck.DataFilterExtension({ filterSize: 1 });

/**
 * Returns a key string representing the current filter state.
 */
function filterKey() {
  return [
    Array.from(activeTypes).sort().join(","),
    `hub1:${hideHubConnections ? 1 : 0}`,
    `hub2:${hideHub2Connections ? 1 : 0}`,
    Array.from(activePointTypes).sort().join(",")
  ].join("|") + `|icons:${showIcons ? 1 : 0}`;
}

// ---------------------- Build Layers ----------------------

/**
 * Builds and returns the Deck.gl layers used for visualization.
 */
function buildLayers() {
  // Connections: ArcLayer for connection lines
  const connectionsLayer = new ArcLayer({
    id: "flights",
    data: connections,
    getSourcePosition: (d: any) => getSourcePos(d),
    getTargetPosition: (d: any) => getTargetPos(d),
    getSourceColor: (d: any) => colorByTypeRGBA(d),
    getTargetColor: (d: any) => darker(colorByTypeRGBA(d)),
    getTilt: (d: any) => tiltByType(d),
    getWidth: 2,
    pickable: true,
    getFilterValue: (d: any) =>
      (
        activeTypes.has(getConnType(d) as ConnType) &&
        (!hideHubConnections  || !connectsToHub(d))  &&
        (!hideHub2Connections || !connectsToHub2(d))
      ) ? 1 : 0,
    filterRange: [1, 1],
    extensions: [dataFilterExt],
    updateTriggers: { getFilterValue: filterKey() }
  });

  // Pins: ScatterplotLayer for map pins
  const pinsLayer = new ScatterplotLayer({
    id: "pins",
    data: points,
    dataTransform: (d: any) => (d && d.type === "FeatureCollection" ? d.features : d),
    pickable: true,
    autoHighlight: true,
    getPosition: (d: any) => d.geometry.coordinates,
    radiusUnits: "pixels",
    radiusMinPixels: 11,
    radiusMaxPixels: 18,
    getFillColor: (d: any) => colorPinkByType(d),
    stroked: true,
    getLineColor: [0, 0, 0, 200],
    lineWidthMinPixels: 1,
    getFilterValue: (d: any) => (activePointTypes.has(getPinkType(d)) && !d.properties.icon) ? 1 : 0,
    filterRange: [1, 1],
    extensions: [dataFilterExt],
    updateTriggers: { getFilterValue: filterKey() }
  });

  // Icons: IconLayer for special point icons
  const icons = new deck.IconLayer({
    id: 'aircraft-icon',
    data: points,
    dataTransform: (d: any) => (d && d.type === "FeatureCollection" ? d.features.filter((f: any) => f.properties.icon) : d),
    pickable: true,
    sizeUnits: 'pixels',
    getSize: () => 50,
    sizeMinPixels: 40,
    sizeMaxPixels: 60,
    getPosition: (d: any) => d.geometry.coordinates,
    getIcon: (d: any) => {
      const iconName = d.properties.icon?.toLowerCase();
      return {
        url: ICON_MAP[iconName as keyof typeof ICON_MAP],
        width: 32,
        height: 32,
        anchorX: 16,
        anchorY: 16,
      };
    },
    loadOptions: { image: { crossOrigin: 'anonymous' } },
    getFilterValue: (d: any) => showIcons ? 1 : 0,
    filterRange: [1, 1],
    extensions: [dataFilterExt],
    updateTriggers: { getFilterValue: filterKey() },
    parameters: {
      depthTest: false,
      depthMask: false
    }
  });

  return [connectionsLayer, pinsLayer, icons];
}

// ---------------------- UI: Legend and Controls ----------------------

/**
 * Adds filter controls for connections and pins to the DOM.
 */
function addMultiFilterControls(onChange: () => void) {
  // Main window that holds the two panels
  const mainContainer = document.createElement("div");
  mainContainer.id = "controls-container";
  mainContainer.style.cssText = `
    position:absolute; z-index:5; top:50px; left:10px;
    font: 13px system-ui, sans-serif;
    display:flex; flex-direction:column; gap:10px;
    max-width: 320px;
  `;

  // Helper to create a legend box
  const makeLegendBox = () => {
    const box = document.createElement("div");
    box.style.cssText = `
      background:#fff; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,.15);
      padding:8px 10px; display:flex; flex-direction:column; gap:10px;
    `;
    return box;
  };

  // Helper to create a button
  const makeBtn = (txt: string, handler: () => void) => {
    const b = document.createElement("button");
    b.textContent = txt;
    b.style.cssText = `
      padding:6px 10px; border:1px solid #ccc; border-radius:6px;
      background:#f7f7f7; cursor:pointer;
    `;
    b.onclick = handler;
    return b;
  };

  // --- Connections Panel ---
  const connectionsLegend = makeLegendBox();

  const connHeader = document.createElement("h2");
  connHeader.textContent = "Connections";
  connHeader.style.cssText = `font-size:16px; margin:0;`;
  connectionsLegend.appendChild(connHeader);

  // Buttons section
  const connectionsButtonSection = document.createElement("div");
  connectionsButtonSection.style.cssText = `display:flex; flex-wrap:wrap; gap:8px;`;

  // All/None button for connection types
  const allConnBtn = makeBtn("All / None", () => {
    const ALL_TYPES: ConnType[] = ["N", "C", "HF"];
    const isAllActive = activeTypes.size === ALL_TYPES.length;
    activeTypes.clear();
    if (!isAllActive) ALL_TYPES.forEach(t => activeTypes.add(t));
    connCheckboxes.forEach(cb => cb.checked = !isAllActive);
    onChange();
  });
  connectionsButtonSection.appendChild(allConnBtn);

  // Hub toggles
  const hub1Wrap = document.createElement("label");
  hub1Wrap.style.cssText = `display:flex; align-items:center; gap:6px;`;
  const hub1Cb = document.createElement("input");
  hub1Cb.type = "checkbox";
  hub1Cb.checked = hideHubConnections;
  hub1Cb.onchange = () => { hideHubConnections = hub1Cb.checked; onChange(); };
  const hub1Txt = document.createElement("span");
  hub1Txt.textContent = "Hide connections to/from FL";
  hub1Wrap.appendChild(hub1Cb); hub1Wrap.appendChild(hub1Txt);

  const hub2Wrap = document.createElement("label");
  hub2Wrap.style.cssText = `display:flex; align-items:center; gap:6px;`;
  const hub2Cb = document.createElement("input");
  hub2Cb.type = "checkbox";
  hub2Cb.checked = hideHub2Connections;
  hub2Cb.onchange = () => { hideHub2Connections = hub2Cb.checked; onChange(); };
  const hub2Txt = document.createElement("span");
  hub2Txt.textContent = "Hide connections to/from EU";
  hub2Wrap.appendChild(hub2Cb); hub2Wrap.appendChild(hub2Txt);

  connectionsButtonSection.appendChild(hub1Wrap);
  connectionsButtonSection.appendChild(hub2Wrap);

  connectionsLegend.appendChild(connectionsButtonSection);

  // Connection type checkboxes
  const connCheckboxes: HTMLInputElement[] = [];
  const connItems: { key: ConnType; label: string; color: string }[] = [
    { key: "N",  label: "N",  color: "rgb(0,128,200)" },
    { key: "C",  label: "C",  color: "rgb(0,200,0)" },
    { key: "HF", label: "HF", color: "rgb(200,0,0)" }
  ];
  connItems.forEach(({ key, label, color }) => {
    const wrap = document.createElement("label");
    wrap.style.cssText = `display:flex; align-items:center; gap:6px;`;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = activeTypes.has(key);
    cb.onchange = () => {
      if (cb.checked) activeTypes.add(key);
      else activeTypes.delete(key);
      onChange();
    };
    connCheckboxes.push(cb);
    const swatch = document.createElement("span");
    swatch.style.cssText = `
      display:inline-block; width:10px; height:10px; background:${color};
      border-radius:2px; border:1px solid rgba(0,0,0,.2);
    `;
    const text = document.createElement("span");
    text.textContent = label;
    wrap.appendChild(cb);
    wrap.appendChild(swatch);
    wrap.appendChild(text);
    connectionsLegend.appendChild(wrap);
  });

  // --- Pins Panel ---
  const pinsLegend = makeLegendBox();

  const pinsHeader = document.createElement("h2");
  pinsHeader.textContent = "Pins";
  pinsHeader.style.cssText = `font-size:16px; margin:0;`;
  pinsLegend.appendChild(pinsHeader);

  const pinsButtonSection = document.createElement("div");
  pinsButtonSection.style.cssText = `display:flex; flex-wrap:wrap; gap:8px;`;

  // All/None button for pin groups
  const allPinsBtn = makeBtn("All / None", () => {
    const ALL = PinLogic.ALL_POINT_TYPES;
    const isAllActive = activePointTypes.size === ALL.length;
    activePointTypes.clear();
    if (!isAllActive) ALL.forEach(t => activePointTypes.add(t));
    pinCheckboxes.forEach(cb => cb.checked = !isAllActive);
    onChange();
  });
  pinsButtonSection.appendChild(allPinsBtn);

  // Icon toggle
  const iconToggleWrap = document.createElement("label");
  iconToggleWrap.style.cssText = `display:flex; align-items:center; gap:6px;`;
  const iconToggleCb = document.createElement("input");
  iconToggleCb.type = "checkbox";
  iconToggleCb.checked = showIcons;
  iconToggleCb.onchange = () => { showIcons = iconToggleCb.checked; onChange(); };
  const iconToggleTxt = document.createElement("span");
  iconToggleTxt.textContent = "Show Icons";
  iconToggleWrap.appendChild(iconToggleCb); iconToggleWrap.appendChild(iconToggleTxt);
  pinsButtonSection.appendChild(iconToggleWrap);
  pinsLegend.appendChild(pinsButtonSection);

  // Pin group checkboxes
  const pinCheckboxes: HTMLInputElement[] = [];
  const pinItems: { key: PointType; label: string; color: string }[] = [
    { key: "PINK_GROUP",      label: "F",  color: "rgb(255, 105, 180)" },
    { key: "VIOLET_GROUP",    label: "SB", color: "rgb(130, 42, 245)" },
    { key: "RED_GROUP",       label: "P",  color: "rgb(200, 0, 0)" },
    { key: "TURQUOISE_GROUP", label: "D",  color: "rgb(64, 224, 208)" },
    { key: "YELLOW_GROUP",    label: "G",  color: "rgb(255, 255, 0)" },
    { key: "GREEN_GROUP",     label: "M",  color: "rgb(0, 128, 0)" },
    { key: "PURPLE_GROUP",    label: "T",  color: "rgb(128, 0, 128)" },
    { key: "ORANGE_GROUP",    label: "B",  color: "rgb(255, 165, 0)" },
    { key: "BLUE_GROUP",      label: "S",  color: "rgb(0, 120, 255)" },
    { key: "WHITE_GROUP",     label: "W",  color: "rgb(197, 110, 255)" }
  ];
  pinItems.forEach(({ key, label, color }) => {
    const wrap = document.createElement("label");
    wrap.style.cssText = `display:flex; align-items:center; gap:6px;`;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = activePointTypes.has(key);
    cb.onchange = () => {
      if (cb.checked) activePointTypes.add(key);
      else activePointTypes.delete(key);
      onChange();
    };
    pinCheckboxes.push(cb);
    const swatch = document.createElement("span");
    swatch.style.cssText = `
      display:inline-block; width:10px; height:10px; background:${color};
      border-radius:2px; border:1px solid rgba(0,0,0,.2);
    `;
    const text = document.createElement("span");
    text.textContent = label;
    wrap.appendChild(cb);
    wrap.appendChild(swatch);
    wrap.appendChild(text);
    pinsLegend.appendChild(wrap);
  });

  // Mount panels
  mainContainer.appendChild(connectionsLegend);
  mainContainer.appendChild(pinsLegend);

  document.body.appendChild(mainContainer);

  // Floating button to show/hide the whole filters window
  const floatingBtn = document.createElement("button");
  floatingBtn.id = "filters-toggle";
  floatingBtn.textContent = "Filters";
  floatingBtn.title = "Show/Hide filters";
  floatingBtn.style.cssText = `
    position: absolute;
    z-index: 10;
    top: 10px;
    left: 190px;
    padding:8px 10px; border:1px solid #ccc; border-radius:8px;
    background:#ffffff; box-shadow:0 2px 8px rgba(0,0,0,.15);
    font: 13px system-ui, sans-serif; cursor:pointer;
  `;

  document.body.appendChild(floatingBtn);

  floatingBtn.onclick = () => {
    toggleDisplay(mainContainer);
  };
}

// ---------------------- Clicked Coordinates Display ----------------------

/**
 * Adds UI to display clicked coordinates at the bottom of the map.
 */
function addCoordinatesUI() {
  const coordsContainer = document.createElement("div");
  coordsContainer.id = "coords-container";
  coordsContainer.style.cssText = `
    position: absolute; z-index: 5; bottom: 30px; left: 10px;
    background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.15);
    padding: 8px 10px;
    font: 13px system-ui, sans-serif;
    display: flex; flex-direction: column; gap: 5px;
  `;

  const title = document.createElement("h3");
  title.textContent = "Clicked Coordinates";
  title.style.cssText = `font-size: 14px; margin: 0;`;
  coordsContainer.appendChild(title);

  const latText = document.createElement("div");
  latText.id = "lat-display";
  latText.textContent = "Latitude: -";
  coordsContainer.appendChild(latText);

  const lngText = document.createElement("div");
  lngText.id = "lng-display";
  lngText.textContent = "Longitude: -";
  coordsContainer.appendChild(lngText);

  const clearBtn = document.createElement("button");
  clearBtn.textContent = "Clear";
  clearBtn.style.cssText = `
    padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px;
    background: #f7f7f7; cursor: pointer; margin-top: 5px;
  `;
  clearBtn.onclick = () => updateCoordinatesUI(null, null);
  coordsContainer.appendChild(clearBtn);

  document.body.appendChild(coordsContainer);
}

/**
 * Updates the displayed coordinates in the UI.
 */
function updateCoordinatesUI(lat: number | null, lng: number | null) {
  const latEl = document.getElementById("lat-display");
  const lngEl = document.getElementById("lng-display");
  if (latEl && lngEl) {
    latEl.textContent = `Latitude: ${lat !== null ? lat.toFixed(6) : '-'}`;
    lngEl.textContent = `Longitude: ${lng !== null ? lng.toFixed(6) : '-'}`;
  }
}

// ---------------------- Initialization ----------------------

/**
 * Initializes the Google Map and overlays Deck.gl layers.
 */
function initMap(): void {
  const map = new google.maps.Map(
    document.getElementById("map") as HTMLElement,
    {
      center: { lat: 39.5, lng: -98.35 },
      zoom: 4,
      tilt: 30,
      mapId: "90f87356969d889c",
      styles: [
        { featureType: "all", elementType: "labels", stylers: [{ visibility: "off" }] },
        { featureType: "road", elementType: "all", stylers: [{ visibility: "off" }] },
        { featureType: "poi", elementType: "all", stylers: [{ visibility: "off" }] },
        { featureType: "administrative", elementType: "all", stylers: [{ visibility: "off" }] },
        { featureType: "transit", elementType: "all", stylers: [{ visibility: "off" }] },
        { featureType: "water", elementType: "labels", stylers: [{ visibility: "off" }] },
        { featureType: "landscape", elementType: "labels", stylers: [{ visibility: "off" }] }
      ]
    }
  );

  addCoordinatesUI();

  addMultiFilterControls(() => {
    overlay.setProps({ layers: buildLayers() });
  });

  map.addListener("click", (e: google.maps.MapMouseEvent) => {
    const ll = e.latLng;
    if (ll) updateCoordinatesUI(ll.lat(), ll.lng());
  });

  overlay = new GoogleMapsOverlay({
    layers: buildLayers(),
    getTooltip: ({ object, layer }) => {
      if (!object) return null;
      // Tooltip for icon layer
      if (layer?.id === 'aircraft-icon') {
        const name = object?.properties?.name ?? "Icon";
        const [lng, lat] = asLngLat(object) ?? [];
        return {
          html: `
            <div style="font-family:system-ui; font-size:12px; line-height:1.35; color:white">
              <div><b>${name}</b></div>
              <div><b>Lat</b>: ${fmt(lat)}</div>
              <div><b>Lng</b>: ${fmt(lng)}</div>
            </div>
          `
        };
      }
      // Tooltip for pins layer
      if (layer?.id === "pins") {
        const name = object?.properties?.name ?? "Pin";
        const [lng, lat] = asLngLat(object) ?? [];
        return {
          html: `
            <div style="font-family:system-ui; font-size:12px; line-height:1.35; color:white">
              <div><b>${name}</b></div>
              <div><b>Lat</b>: ${fmt(lat)}</div>
              <div><b>Lng</b>: ${fmt(lng)}</div>
            </div>
          `
        };
      }
      // Tooltip for connections layer
      const fromObj = object?.from ?? object?.properties?.from;
      const toObj   = object?.to   ?? object?.properties?.to;
      const fromName = fromObj?.name ?? "From";
      const toName   = toObj?.name   ?? "To";
      const connType = getConnType(object);
      const fromTech = fromObj?.tech ?? fromObj?.properties?.tech;
      const toTech   = toObj?.tech   ?? toObj?.properties?.tech;
      const from = fromObj?.coordinates;
      const to   = toObj?.coordinates;
      const [flng, flat] = Array.isArray(from) ? from : [];
      const [tlng, tlat] = Array.isArray(to)   ? to   : [];
      return {
        html: `
          <div style="font-family:system-ui; font-size:12px; line-height:1.35; color: white">
            <div style="margin-bottom:4px;">
              <b>${fromName}</b> &rarr; <b>${toName}</b>
              <span style="opacity:.7;">(${connType})</span>
            </div>
            <div><b>${fromName}</b> <span style="opacity:1;">(${fromTech})</span></div>
            <div><b>${toName}</b> &nbsp;&nbsp;<span style="opacity:1;">(${toTech})</span></div>
          </div>
        `
      };
    }
  });

  overlay.setMap(map);
}

// Export initMap globally for the Maps API to call it.
declare global {
  interface Window {
    initMap: () => void;
  }
}
window.initMap = initMap;

export {};