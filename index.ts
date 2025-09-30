/**
 * @license
 * Copyright 2021 Google LLC.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Google Maps + Deck.gl integration:
 * - Connection type filters (N/C/H)
 * - Pin group filters
 * - Toggles to hide connections that touch specific coordinates (-82.492696, 27.8602) and (9.077841, 48.73448)
 * - On-map persistent labels for connections (source name/coords, target name/coords, and type) and pins (name + coordinates)
 *
 * NOTE: Native map labels are permanently hidden via map styles to prioritize custom tooltips.
 * This file has been modified to include an on-map label feature for all connections.
 */

// Tell TypeScript that 'deck' is a global object, loaded via a script tag.
declare const deck: any;

import type * as GeoJSON from "geojson";

// Deck.gl Layer constructors
const ScatterplotLayer = deck.ScatterplotLayer;
const ArcLayer = deck.ArcLayer;
const GoogleMapsOverlay = deck.GoogleMapsOverlay;
const iconLayer = deck.IconLayer;
const DataFilterExtension = deck.DataFilterExtension;
const TextLayer = deck.TextLayer; // TextLayer for persistent labels

// Icon asset URLs
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

// ---------------------- Permanent Map Style (Hides All Native Labels) ----------------------

// Style aggressively hides all map labels and most road lines to guarantee custom tooltips are visible.
const PERMANENT_HIDE_LABELS_STYLE: google.maps.MapTypeStyle[] = [
    // Target all label types (administrative areas, points of interest, transit)
    { featureType: "administrative", elementType: "labels", stylers: [{ visibility: "off" }] },
    { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
    { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
    
    // Target road labels explicitly
    { featureType: "road", elementType: "labels", stylers: [{ visibility: "off" }] },
    
    // Target road geometry/lines themselves, as they often carry associated labels
    { featureType: "road.highway", elementType: "geometry", stylers: [{ visibility: "off" }] },
    { featureType: "road.arterial", elementType: "geometry", stylers: [{ visibility: "off" }] },
    { featureType: "road.local", elementType: "geometry", stylers: [{ visibility: "off" }] },
    
    // Fallback for all elements
    { featureType: "all", elementType: "labels", stylers: [{ visibility: "off" }] }
];


// ---------------------- Types & Data ----------------------

type Properties = {
    scalerank?: number;
    Connection_type?: string;
    from?: any;
    to?: any;
    name?: string;
};
type Feature = GeoJSON.Feature<GeoJSON.Geometry, Properties>;
type Data = GeoJSON.FeatureCollection<GeoJSON.Geometry, Properties> | any[];

// Data sources
const CONNECTIONS_DATA_URL: string = "database/connections_geojson_like.json";
const POINTS_DATA_URL: string = "database/points.json";

let processedConnections: any[] = [];
let processedPins: any[] = [];
let processedIcons: any[] = [];

// Example feature for pin display testing
const feature = {
    type: "Feature",
    properties: { name: "E6" },
    geometry: { type: "Point", coordinates: [-124.122174, 39.676226] }
};

// ---------------------- Helper Functions ----------------------

/**
 * Retrieve a property from an object, optionally checking nested 'properties'.
 */
function getProp(d: any, key: string): any {
    return d?.[key] ?? d?.properties?.[key] ?? d?.connectionType;
}

/**
 * Normalize and return the connection type for a feature.
 */
function getConnType(d: any): string {
    const t = getProp(d, "Connection_type") ?? getProp(d, "connection_type");
    const up = String(t ?? "").trim().toUpperCase();
    if (up === "N_TYPE") return "N";
    return up; // "N" | "C" | "HF" | (others)
}

/**
 * Retrieve the name property from a feature.
 */
function getPointName(d: any): string {
    return getProp(d, "name") ?? "";
}

/**
 * Toggle display of a DOM element.
 * Retained for filter controls, but not used for the connections list anymore.
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

/**
 * Pin group logic for mapping pin names to colors and types.
 */
const PinLogic = {
    ALL_POINT_TYPES: [
        "RED_GROUP", "TURQUOISE_GROUP", "YELLOW_GROUP", "GREEN_GROUP",
        "PURPLE_GROUP", "ORANGE_GROUP", "BLUE_GROUP", "VIOLET_GROUP", "PINK_GROUP", "WHITE_GROUP"
    ] as PointType[],

    // RGBA color map for each pin group
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
        WHITE_GROUP:     [197, 110, 255, 255]
    } as Record<PointType, [number, number, number, number]>,

    // Pin name to group mapping
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
        "COS": 	"TURQUOISE_GROUP",
        "TB": 	"TURQUOISE_GROUP",
        "RR": 	"TURQUOISE_GROUP",
        "AZ": 	"TURQUOISE_GROUP",
        "IP": 	"TURQUOISE_GROUP",

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

let activePointTypes = new Set<PointType>(PinLogic.ALL_POINT_TYPES);

/**
 * Determine pin type (group) from a feature.
 */
function getPinType(d: any): PointType {
    const name = getPointName(d);
    return PinLogic.PIN_LOOKUP_MAP[name] ?? "BLUE_GROUP";
}

/**
 * Get RGBA color for a pin feature based on type.
 */
function colorPinkByType(d: any): [number, number, number, number] {
    return PinLogic.PIN_COLOR_MAP[getPinType(d)];
}

// ---------------------- Connection Styling & Labeling ----------------------

type ConnType = "N" | "C" | "HF";
const ALL_TYPES: ConnType[] = ["N", "C", "HF"];
let activeTypes = new Set<ConnType>(["HF"]); // Initial active type set

// NEW GLOBAL STATE: Flag to control visibility of on-map connection labels
let showConnectionLabels = false;
// NEW GLOBAL STATE: Flag to control visibility of on-map pin labels
let showPinLabels = false;

/**
 * Get RGBA color for a connection feature based on type.
 */
function colorByTypeRGBA(d: any): [number, number, number, number] {
    switch (getConnType(d)) {
        case "N": return [0, 128, 200, 220];
        case "C": return [0, 200, 0, 220];
        case "HF": return [200, 0, 0, 220];
        default: 	return [128, 128, 128, 200];
    }
}

/**
 * Get color string (rgb) for use in HTML/CSS based on connection type.
 */
function colorByTypeRGB(d: any): string {
    const [r, g, b] = colorByTypeRGBA(d);
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Get tilt value for a connection feature based on type.
 */
function tiltByType(d: any): number {
    switch (getConnType(d)) {
        case "N": return 5;
        case "C": return 10;
        case "HF": return 0;
        default: 	return 0;
    }
}

/**
 * Get source coordinates for a connection feature.
 */
function getSourcePos(d: any): [number, number] {
    const src = d._sourcePos ?? getProp(d, "from")?.coordinates ?? getProp(d, "coordinates")?.[0];
    return src as [number, number];
}

/**
 * Get target coordinates for a connection feature.
 */
function getTargetPos(d: any): [number, number] {
    const tgt = d._targetPos ?? getProp(d, "to")?.coordinates ?? getProp(d, "coordinates")?.slice(-1)[0];
    return tgt as [number, number];
}

/**
 * Return a darker shade of the given RGBA color.
 */
function darker([r, g, b, a]: [number, number, number, number]): [number, number, number, number] {
    return [Math.floor(r * 0.5), Math.floor(g * 0.5), Math.floor(b * 0.5), a ?? 255];
}

/**
 * Format a number to a string with fixed decimal places.
 */
function fmt(n?: number, p = 5) {
    return typeof n === "number" ? n.toFixed(p) : "";
}

/**
 * Extract longitude/latitude coordinates from a feature or geometry/properties.
 * Handles both GeoJSON Feature structure and embedded object structures.
 */
function asLngLat(obj: any): [number, number] | null {
    // Check if it's a GeoJSON Point Feature
    if (obj?.geometry?.type === "Point") return obj.geometry.coordinates as [number, number];
    // Check if it's a "from"/"to" object with coordinates property
    if (Array.isArray(obj?.coordinates) && obj.coordinates.length >= 2 && typeof obj.coordinates[0] === 'number') {
        return obj.coordinates.slice(0, 2) as [number, number];
    }
    // Check if coordinates are nested inside properties (e.g., from connection source data)
    if (obj?.properties) return asLngLat(obj.properties);
    
    return null;
}

/**
 * Calculates a point along the arc's chord, used as the label position.
 * For simple line layers, this is the midpoint.
 */
function getLabelMidpoint(d: any): [number, number] {
    const s = getSourcePos(d);
    const t = getTargetPos(d);
    if (!Array.isArray(s) || !Array.isArray(t)) return [0, 0];
    
    // Simple midpoint calculation
    const lng = (s[0] + t[0]) / 2;
    const lat = (s[1] + t[1]) / 2;
    
    // Return world coordinate [lng, lat]
    return [lng, lat];
}

// ---------------------- Filtering (GPU) ----------------------

// Hub coordinates
const HUB_LNG 	= -82.492696;
const HUB_LAT 	= 27.8602;
const HUB_EPS 	= 1e-6;
let hideHubConnections = false;

const HUB2_LNG = 9.077841;
const HUB2_LAT = 48.734481;
let hideHub2Connections = false;
let showIcons = true;


/**
 * Helper for proximity comparison.
 */
function near(a: number, b: number, eps = HUB_EPS) {
    return Math.abs(a - b) <= eps;
}

/**
 * Return true if a connection touches HUB 1 coordinates.
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
 * Return true if a connection touches HUB 2 coordinates.
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
 * Generate a key representing the current filter state for Deck.gl update triggers.
 */
function filterKey() {
    return [
        Array.from(activeTypes).sort().join(","),
        `hub1:${hideHubConnections ? 1 : 0}`,
        `hub2:${hideHub2Connections ? 1 : 0}`,
        Array.from(activePointTypes).sort().join(",")
    ].join("|") + `|icons:${showIcons ? 1 : 0}` + 
      `|connLabels:${showConnectionLabels ? 1 : 0}` + 
      `|pinLabels:${showPinLabels ? 1 : 0}`;
}

// ---------------------- Build Layers ----------------------

/**
 * Build and return all Deck.gl layers for the overlay.
 */
function buildLayers(connectionsData: any[], pinsData: any[], iconsData: any[]) {
    // Shared filtering logic for connections, used by both ArcLayer and Connection TextLayer
    const getConnectionFilterValue = (d: any) =>
        (
            activeTypes.has(d._connType) &&
            (!hideHubConnections 	|| !d._isHub1) 	&&
            (!hideHub2Connections || !d._isHub2)
        ) ? 1 : 0;

    // Connection arcs
    const connectionsLayer = new ArcLayer({
        id: "flights",
        data: connectionsData,
        getSourcePosition: (d: any) => getSourcePos(d),
        getTargetPosition: (d: any) => getTargetPos(d),
        getSourceColor: (d: any) => colorByTypeRGBA(d),
        getTargetColor: (d: any) => darker(colorByTypeRGBA(d)),
        getTilt: (d: any) => tiltByType(d),
        getWidth: 2,
        pickable: true,
        getFilterValue: getConnectionFilterValue,
        filterRange: [1, 1],
        extensions: [dataFilterExt],
        updateTriggers: { getFilterValue: filterKey() }
    });

    // Layer for Connection Labels (FIX: Force SDF, set characterSet, increase size)
    const connectionTextLayer = new TextLayer({
        id: 'connection-labels',
        // Only display connections if showConnectionLabels is true
        data: showConnectionLabels ? connectionsData : [],
        pickable: false,
        // Position label at the midpoint of the connection's chord
        getPosition: getLabelMidpoint,
        getText: (d: any) => {
            const fromObj = d?.from ?? d?.properties?.from;
            const toObj 	= d?.to 	?? d?.properties?.to;
            
            const fromName = fromObj?.name ?? "Unknown Start";
            const toName 	= toObj?.name 	?? "Unknown End";
            const connType = getConnType(d);

            // Get coordinates (or use 0,0 if missing for safe formatting)
            const [flng, flat] = asLngLat(fromObj) ?? [0, 0];
            const [tlng, tlat] = asLngLat(toObj) 	?? [0, 0];
            
            // Multi-line string with highlighting for Start/End and coordinates
            // Using \u25b6 as the START/END marker
            return `\u25b6 START: ${fromName}\nLat: ${fmt(flat, 4)}, Lng: ${fmt(flng, 4)}\n\u25b6 END: ${toName}\nLat: ${fmt(tlat, 4)}, Lng: ${fmt(tlng, 4)}\n(${connType})`;
        },
        // Use background for the black box effect
        background: true,
        getBackgroundColor: [0, 0, 0, 200], // Black background (Opacity 200/255)
        getColor: [255, 255, 255, 255], 		// White text
        
        // --- TEXT RENDERING FIXES ---
        getSize: 12, // Increased from 10
        fontSettings: {
            sdf: true // Use Signed Distance Field textures for robustness
        },
        // Explicitly list all characters used in the label for robust texture atlas generation
        characterSet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:()[]- \n\u25b6', 
        // -----------------------------
        
        getPixelOffset: [0, -10], // Offset to appear slightly above the line
        getAlignmentBaseline: 'center',
        getTextAnchor: 'middle',
        padding: [4, 6], 
        
        // Use the same filtering logic as the ArcLayer to ensure labels only appear on visible lines
        getFilterValue: getConnectionFilterValue,
        filterRange: [1, 1],
        extensions: [dataFilterExt],
        updateTriggers: { getFilterValue: filterKey() },
        
        // Ensure connection labels are drawn on top of everything
        getZLevel: 2, 
        parameters: {
            depthTest: false, // Disables depth culling so the TextLayer is always visible
            depthMask: false
        }
    });

    // Pin scatterplot
    const pinsLayer = new ScatterplotLayer({
        id: "pins",
        data: pinsData,
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
        getFilterValue: (d: any) => activePointTypes.has(d._pinType) ? 1 : 0,
        filterRange: [1, 1],
        extensions: [dataFilterExt],
        updateTriggers: { getFilterValue: filterKey() }
    });

    // Icon layer for aircraft/boat/truck/trailer pins
    const icons = new deck.IconLayer({
        id: 'aircraft-icon',
        data: iconsData,
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

    // TextLayer for persistent Pin Labels (name, lat, and lng)
    const pinTextLayer = new TextLayer({
        id: 'pin-labels',
        // Only display if showPinLabels is true
        data: showPinLabels ? [...pinsData, ...iconsData] : [],
        pickable: false,
        getPosition: (d: any) => d.geometry.coordinates,
        getText: (d: any) => {
            const name = d.properties?.name || '';
            const [lng, lat] = asLngLat(d) ?? []; 
            // Create a multi-line string for name, lat, and lng
            return `${name}\nLat: ${fmt(lat, 4)}\nLng: ${fmt(lng, 4)}`;
        },
        getColor: [255, 255, 255, 255],
        getSize: 12,
        getPixelOffset: [0, 20], // Offset to appear below the pin/icon
        getFilterValue: (d: any) => activePointTypes.has(d._pinType) ? 1 : 0,
        filterRange: [1, 1],
        extensions: [dataFilterExt],
        updateTriggers: { getFilterValue: filterKey() },
        background: true,
        getBackgroundColor: [0, 0, 0, 200], // Dark background
        padding: [4, 6], 
        getAlignmentBaseline: 'top', 
        getTextAnchor: 'middle',
        
        getZLevel: 0, 
        parameters: {
            depthTest: true, 
            depthMask: true 	
        }
    });

    // Connection text layer should be listed after the ArcLayer, but before the Pin layers for depth ordering
    return [connectionsLayer, connectionTextLayer, pinsLayer, icons, pinTextLayer];
}

// ---------------------- UI: Legend and Controls ----------------------

/**
 * Add UI panels for multi-filter controls (connections and pins).
 */
function addMultiFilterControls(map: google.maps.Map, onChange: () => void) {
    const connItems: { key: ConnType; label: string; color: string }[] = [
        { key: "N", 	label: "N", 	color: "rgb(0,128,200)" },
        { key: "C", 	label: "C", 	color: "rgb(0,200,0)" },
        { key: "HF", label: "HF", color: "rgb(200,0,0)" }
    ];
    const pinItems: { key: PointType; label: string; color: string }[] = [
        { key: "PINK_GROUP", 	 	label: "F", 	color: "rgb(255, 105, 180)" },
        { key: "VIOLET_GROUP", 		label: "SB", color: "rgb(130, 42, 245)" },
        { key: "RED_GROUP", 	 	label: "P", 	color: "rgb(200, 0, 0)" },
        { key: "TURQUOISE_GROUP", label: "D", 	color: "rgb(64, 224, 208)" },
        { key: "YELLOW_GROUP", 		label: "G", 	color: "rgb(255, 255, 0)" },
        { key: "GREEN_GROUP", 		label: "M", 	color: "rgb(0, 128, 0)" },
        { key: "PURPLE_GROUP", 		label: "T", 	color: "rgb(128, 0, 128)" },
        { key: "ORANGE_GROUP", 		label: "B", 	color: "rgb(255, 165, 0)" },
        { key: "BLUE_GROUP", 		label: "S", 	color: "rgb(0, 120, 255)" },
        { key: "WHITE_GROUP", 		label: "W", 	color: "rgb(197, 110, 255)" }
    ];

    const controlsContainer = document.createElement('div');
    controlsContainer.innerHTML = `
        <button id="filters-toggle" title="Show/Hide filters" style="position: absolute; z-index: 10; top: 10px; left: 190px; padding:8px 10px; border:1px solid #ccc; border-radius:8px; background:#ffffff; box-shadow:0 2px 8px rgba(0,0,0,.15); font: 13px system-ui, sans-serif; cursor:pointer;">Filters</button>
        <div id="controls-container" style="position:absolute; z-index:5; top:60px; left:10px; font: 13px system-ui, sans-serif; display:flex; flex-direction:column; gap:10px; max-width: 200px;">
            
            <div id="connection-legend-box" class="legend-box">
                <h2 style="font-size:16px; margin:0;">Connections</h2>
                <div id="conn-button-section" class="button-section">
                    <button id="all-conn-btn">All / None</button>
                    </div>
                <div class="filter-toggles-section">
                    <label><input type="checkbox" id="hub1-cb" ${hideHubConnections ? 'checked' : ''}> Hide FL</label>
                    <label><input type="checkbox" id="hub2-cb" ${hideHub2Connections ? 'checked' : ''}> Hide EU</label>
                </div>
                ${connItems.map(({ key, label, color }) => `
                    <label>
                        <input type="checkbox" class="conn-cb" data-key="${key}" ${activeTypes.has(key) ? 'checked' : ''}>
                        <span class="swatch" style="background:${color};"></span>
                        ${label}
                    </label>
                `).join('')}
            </div>
            <div class="legend-box">
                <h2 style="font-size:16px; margin:0;">Pins</h2>
                <div class="button-section">
                    <button id="all-pins-btn">All / None</button>
                    <label style="flex-grow: 1;"><input type="checkbox" id="icon-toggle-cb" ${showIcons ? 'checked' : ''}> Show Icons</label>
                    <button id="tooltip-btn">${showPinLabels ? 'Hide Labels' : 'Show Labels'}</button>
                </div>
                ${pinItems.map(({ key, label, color }) => `
                    <label>
                        <input type="checkbox" class="pin-cb" data-key="${key}" ${activePointTypes.has(key) ? 'checked' : ''}>
                        <span class="swatch" style="background:${color};"></span>
                        ${label}
                    </label>
                `).join('')}
            </div>
        </div>
        <div id="top-right-panel" style="position: absolute; z-index: 10; top: 10px; right: 10px;">
            </div>
        <style>
            .legend-box { background:#fff; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,.15); padding:8px 10px; display:flex; flex-direction:column; gap:10px; }
            .legend-box label { display:flex; align-items:center; gap:6px; }
            .button-section { 
                display:flex; 
                flex-wrap:wrap; 
                gap:8px; 
                border-bottom: 1px solid #eee; 
                padding-bottom: 8px;
            }
            .filter-toggles-section {
                 display:flex; 
                flex-wrap:wrap; 
                gap:8px; 
                border-bottom: 1px solid #eee;
                padding-bottom: 8px;
            }
            .button-section button { 
                padding:6px 10px; 
                border:1px solid #ccc; 
                border-radius:6px; 
                background:#f7f7f7; 
                cursor:pointer; 
                flex-grow: 1;
            }
            /* Decreased swatch size for smaller box */
            .swatch { display:inline-block; width:8px; height:8px; border-radius:2px; border:1px solid rgba(0,0,0,.2); } 
        </style>
    `;
    document.body.appendChild(controlsContainer);

    // --- NEW: Add the Connection Details Button to its new location ---
    const connButtonSection = document.getElementById('conn-button-section');
    const connLabelButton = document.createElement('button');
    connLabelButton.id = 'toggle-conn-labels-btn';
    connLabelButton.textContent = showConnectionLabels ? 'Hide Details' : 'Show Details';
    connLabelButton.title = 'Toggle on-map connection details (Source/Target Names & Coords)';
    if (connButtonSection) {
        // Append the new button after the "All/None" button
        connButtonSection.appendChild(connLabelButton);
    }
    // --- END NEW ---

    // --- Attach Event Listeners ---
    document.getElementById('filters-toggle')?.addEventListener('click', () => {
        const container = document.getElementById('controls-container');
        if (container) toggleDisplay(container);
    });
    
    // Function to handle map layer update
    const updateMap = () => {
        onChange(); 
    };

    document.getElementById('all-conn-btn')?.addEventListener('click', () => {
        const isAllActive = activeTypes.size === connItems.length;
        activeTypes.clear();
        if (!isAllActive) connItems.forEach(item => activeTypes.add(item.key));
        document.querySelectorAll<HTMLInputElement>('.conn-cb').forEach(cb => cb.checked = !isAllActive);
        updateMap();
    });

    document.getElementById('hub1-cb')?.addEventListener('change', (e) => {
        hideHubConnections = (e.target as HTMLInputElement).checked;
        updateMap();
    });

    document.getElementById('hub2-cb')?.addEventListener('change', (e) => {
        hideHub2Connections = (e.target as HTMLInputElement).checked;
        updateMap();
    });

    document.querySelectorAll<HTMLInputElement>('.conn-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            const key = cb.dataset.key as ConnType;
            if (cb.checked) activeTypes.add(key); else activeTypes.delete(key);
            updateMap();
        });
    });
    
    // Listener for the new connection label button
    connLabelButton.addEventListener('click', () => {
        showConnectionLabels = !showConnectionLabels;
        connLabelButton.textContent = showConnectionLabels ? 'Hide Details' : 'Show Details';
        updateMap();
    });
    // --- END Connection Button Logic ---


    document.getElementById('all-pins-btn')?.addEventListener('click', () => {
        const isAllActive = activePointTypes.size === pinItems.length;
        activePointTypes.clear();
        if (!isAllActive) pinItems.forEach(item => activePointTypes.add(item.key));
        document.querySelectorAll<HTMLInputElement>('.pin-cb').forEach(cb => cb.checked = !isAllActive);
        updateMap();
    });

    document.getElementById('icon-toggle-cb')?.addEventListener('change', (e) => {
        showIcons = (e.target as HTMLInputElement).checked;
        updateMap();
    });

    // Logic for the "Show Labels" button to toggle the persistent TextLayer for PINS
    document.getElementById('tooltip-btn')?.addEventListener('click', (e) => {
        showPinLabels = !showPinLabels;
        (e.target as HTMLButtonElement).textContent = showPinLabels ? 'Hide Labels' : 'Show Labels';
        updateMap();
    });

    document.querySelectorAll<HTMLInputElement>('.pin-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            const key = cb.dataset.key as PointType;
            if (cb.checked) activePointTypes.add(key); else activePointTypes.delete(key);
            updateMap();
        });
    });
}

// ---------------------- Connection Label Button UI (REMOVED: Now handled in addMultiFilterControls) ----------------------

/**
 * Add the "Show Connection Types" button to the DOM and manage the connection TextLayer visibility.
 */
function addConnectionsPanelUI(onChange: () => void) {
    // This function is now empty as the button logic has been moved to addMultiFilterControls
    // It remains as a placeholder to avoid breaking the calling structure in initMap
}


// ---------------------- Clicked Coordinates Display ----------------------

/**
 * Add UI panel to display coordinates of last map click.
 */
function addCoordinatesUI() {
    const coordsContainer = document.createElement("div");
    coordsContainer.id = "coords-container";
    // *** MODIFIED: Changed position from 'left: 10px;' to 'right: 10px;' ***
    coordsContainer.style.cssText = `
        position: absolute; z-index: 5; bottom: 30px; right: 60px;
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
 * Update displayed map click coordinates in the UI.
 */
function updateCoordinatesUI(lat: number | null, lng: number | null) {
    const latEl = document.getElementById("lat-display");
    const lngEl = document.getElementById("lng-display");
    if (latEl && lngEl) {
        latEl.textContent = `Latitude: ${lat !== null ? lat.toFixed(6) : '-'}`;
        lngEl.textContent = `Longitude: ${lng !== null ? lng.toFixed(6) : '-'}`;
    }
}

// ---------------------- Data Pre-processing ----------------------

/**
 * Fetches and pre-processes data to optimize rendering.
 * This computes values once on load rather than on every render.
 */
async function preprocessData() {
    const [connectionsJson, pointsJson] = await Promise.all([
        fetch(CONNECTIONS_DATA_URL).then(res => res.json()),
        fetch(POINTS_DATA_URL).then(res => res.json())
    ]);

    // Pre-process connections
    processedConnections = connectionsJson.map((c: any) => ({
        ...c,
        _connType: getConnType(c),
        _isHub1: connectsToHub(c),
        _isHub2: connectsToHub2(c),
    }));

    // Pre-process and split points into pins and icons
    const allPoints = (pointsJson?.type === "FeatureCollection" ? pointsJson.features : pointsJson);
    processedPins = [];
    processedIcons = [];
    allPoints.forEach((p: any) => {
        p._pinType = getPinType(p); // Pre-calculate pin type for all points
        if (p.properties?.icon) {
            processedIcons.push(p);
        } else {
            processedPins.push(p);
        }
    });
}

// ---------------------- Initialization ----------------------

/**
 * Initialize Google Map, Deck.gl overlay, controls, and event listeners.
 */
async function initMap(): Promise<void> {
    const map = new google.maps.Map(
        document.getElementById("map") as HTMLElement,
        {
            center: { lat: 39.5, lng: -98.35 },
            zoom: 4,
            tilt: 30,
            mapId: "90f87356969d889c",
            // Cursor logic
            draggableCursor: 'default', 
            draggingCursor: 'grabbing', 
            // PERMANENTLY apply the style to hide native labels
            styles: PERMANENT_HIDE_LABELS_STYLE 
        }
    );

    // Fetch and process data before rendering layers
    await preprocessData();

    // Define the update function shared by all controls
    const layerUpdateCallback = () => {
        overlay.setProps({ layers: buildLayers(processedConnections, processedPins, processedIcons) });
    };

    // Add UI components
    addCoordinatesUI();
    // addConnectionsPanelUI is now a NO-OP, but keeps the calling structure
    addConnectionsPanelUI(layerUpdateCallback); 

    // Add multi-filter controls, which now includes the connection button logic
    addMultiFilterControls(map, layerUpdateCallback);

    map.addListener("click", (e: google.maps.MapMouseEvent) => {
        const ll = e.latLng;
        if (ll) updateCoordinatesUI(ll.lat(), ll.lng());
    });
    
    // Initialize the overlay with the first set of layers
    overlay = new GoogleMapsOverlay({
        layers: buildLayers(processedConnections, processedPins, processedIcons),
        
        // getTooltip remains for hover-based tooltips
        getTooltip: ({ object, layer }) => {
            if (!object) return null;
            
            // Tooltips for pins and icons (these are the hover tooltips)
            if (layer?.id === 'aircraft-icon' || layer?.id === "pins") {
                const name = object?.properties?.name ?? (layer?.id === "pins" ? "Pin" : "Icon");
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
            
            // Tooltips for connections
            const fromObj = object?.from ?? object?.properties?.from;
            const toObj 	= object?.to 	?? object?.properties?.to;
            const fromName = fromObj?.name ?? "From";
            const toName 	= toObj?.name 	?? "To";
            const connType = getConnType(object);
            const fromTech = fromObj?.tech ?? fromObj?.properties?.tech;
            const toTech 	= toObj?.tech 	?? toObj?.properties?.properties?.tech;
            const from = getSourcePos(object);
            const to 	= getTargetPos(object);
            const [flng, flat] = Array.isArray(from) ? from : [];
            const [tlng, tlat] = Array.isArray(to) 	? to 	 : [];
            return {
                html: `
                    <div style="font-family:system-ui; font-size:12px; line-height:1.35; color: white">
                        <div style="margin-bottom:4px;">
                            <b>${fromName}</b> &rarr; <b>${toName}</b>
                            <span style="opacity:.7;">(${connType})</span>
                        </div>
                        <div><b>${fromName}</b> <span style="opacity:1;">(${fromTech})</span></div>
                        <div><b>Lat:</b> ${fmt(flat)}, <b>Lng:</b> ${fmt(flng)}</div>
                        <div style="margin-top:4px;"><b>${toName}</b> &nbsp;&nbsp;<span style="opacity:1;">(${toTech})</span></div>
                        <div><b>Lat:</b> ${fmt(tlat)}, <b>Lng:</b> ${fmt(tlng)}</div>
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