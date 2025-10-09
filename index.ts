/**
 * @license
 * Copyright 2021 Google LLC.
 *
 * Google Maps + Deck.gl integration:
 * - Renders connections (arcs) and points (pins, icons) on a Google Map.
 * - Provides UI controls for filtering connections by type and pins by group.
 * - Supports toggling persistent on-map labels for both connections and pins.
 *
 * NOTE: Native map labels are permanently hidden via map styles to prioritize custom tooltips.
 * This file has been modified to include an on-map label feature for all connections.
 */

// Tell TypeScript that 'deck' is a global object, loaded via a script tag.
declare const deck: any;

import type * as GeoJSON from 'geojson';

// Destructure Deck.gl layer constructors for easier access.
const { ScatterplotLayer, ArcLayer, GoogleMapsOverlay, DataFilterExtension, TextLayer } = deck;

// ---------------------- Permanent Map Style (Hides All Native Labels) ----------------------

/** Style to hide all native map labels and most road lines to ensure custom tooltips are visible. */
const PERMANENT_HIDE_LABELS_STYLE: google.maps.MapTypeStyle[] = [
    // Hide all labels by default
    { featureType: "all", elementType: "labels", stylers: [{ visibility: "off" }] },
    // Then, selectively turn on city labels
    {
        featureType: "administrative.locality",
        elementType: "labels",
        stylers: [{ visibility: "on" }],
    },

    // Target road geometry/lines themselves, as they often carry associated labels
    { featureType: "road.highway", elementType: "geometry", stylers: [{ visibility: "off" }] },
    { featureType: "road.arterial", elementType: "geometry", stylers: [{ visibility: "off" }] },
    { featureType: "road.local", elementType: "geometry", stylers: [{ visibility: "off" }] },
];

/** Style for a clean white map with basic labels hidden. */
const WHITE_MAP_STYLE: google.maps.MapTypeStyle[] = [
    // Make all geometry white or very light gray
    { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#dcdcdc" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#e0e0e0" }] },
    // Hide non-essential features
    { featureType: "poi", elementType: "all", stylers: [{ visibility: "off" }] },
    { featureType: "transit", elementType: "all", stylers: [{ visibility: "off" }] },
    // Hide street names and city labels
    {
        featureType: "road",
        elementType: "labels",
        stylers: [{ visibility: "off" }],
    },
    { featureType: "administrative", elementType: "labels", stylers: [{ visibility: "off" }] },
];

/** Style for a clean black map with white contrast elements. */
const BLACK_MAP_STYLE: google.maps.MapTypeStyle[] = [
    // Invert colors for a dark theme
    { featureType: "all", elementType: "geometry", stylers: [{ color: "#212121" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#000000" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#333333" }] },

    // Style labels for white contrast
    { featureType: "all", elementType: "labels.text.fill", stylers: [{ color: "#ffffff" }] },
    { featureType: "all", elementType: "labels.text.stroke", stylers: [{ color: "#212121" }] },

    // Hide non-essential features
    { featureType: "poi", elementType: "all", stylers: [{ visibility: "off" }] },
    { featureType: "transit", elementType: "all", stylers: [{ visibility: "off" }] },

    // Hide road labels to remove road name icons
    { featureType: "road", elementType: "labels", stylers: [{ visibility: "off" }] },

    // Make state lines visible and white
    {
        featureType: "administrative",
        elementType: "geometry.stroke",
        stylers: [{ color: "#ffffff" }, { weight: 0.5 }],
    },
];

// ---------------------- Types & Data ----------------------

/** Custom properties for GeoJSON features. */
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
const CONNECTIONS_DATA_URL: string = "database/connections.json";
const POINTS_DATA_URL: string = "database/points.json";

let processedConnections: any[] = [];
let processedPins: any[] = [];
let overlappingPins: any[] = [];
let aggregatedConnections: any[] = []; // Holds connections aggregated by source/target pair.

// ---------------------- Helper Functions ----------------------

/**
 * Retrieve a property from an object, optionally checking nested 'properties'.
 */
function getProp(d: any, key: string): any {
    return d?.[key] ?? d?.properties?.[key];
}

/**
 * Normalize and return the connection type for a feature.
 * Converts types like "N_TYPE" to "N" and ensures the result is uppercase. */
function getConnType(d: any): string {
    const t = getProp(d, "Connection_type") ?? getProp(d, "connection_type");
    const up = String(t ?? "").trim().toUpperCase();
    if (up === "N_TYPE") return "N";
    return up; // "N" | "C" | "HF" | (others)
}

/**
 * Get the IER property of a connection and return it as an uppercased string array.
 */
function getIERArray(d: any): string[] {
    const ierValue = getProp(d, "IER");
    if (Array.isArray(ierValue)) {
        return ierValue.map(item => String(item ?? '').toUpperCase());
    }
    return [];
}

/**
 * Retrieve the name property from a feature.
 */
function getPointName(d: any): string {
    return getProp(d, "name") ?? "";
}

/**
 * Toggle display of a DOM element.
 */
function toggleDisplay(el: HTMLElement, force?: boolean) {
    const shouldShow = force !== undefined ? force : el.style.display === "none";
    el.style.display = shouldShow ? "flex" : "none";
}

/**
 * Generates an SVG data URL for a pie chart icon.
 * @param colors - An array of RGBA color arrays for the pie slices.
 * @returns A string containing the data URL for the SVG icon.
 */
function createPieIcon(colors: [number, number, number, number][]): string {
    const radius = 12;
    const diameter = radius * 2;
    const numSlices = colors.length;

    if (numSlices === 0) return '';
    if (numSlices === 1) {
        const [r, g, b, a] = colors[0];
        return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${diameter}' height='${diameter}' viewBox='0 0 ${diameter} ${diameter}'%3E%3Ccircle cx='${radius}' cy='${radius}' r='${radius}' fill='rgba(${r},${g},${b},${a/255})' stroke='black' stroke-width='1' /%3E%3C/svg%3E`;
    }

    const sliceAngle = 360 / numSlices;
    let svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${diameter}' height='${diameter}' viewBox='0 0 ${diameter} ${diameter}'>`;

    let startAngle = -90;
    for (let i = 0; i < numSlices; i++) {
        const endAngle = startAngle + sliceAngle;
        const [r, g, b, a] = colors[i];
        const x1 = radius + radius * Math.cos(Math.PI * startAngle / 180);
        const y1 = radius + radius * Math.sin(Math.PI * startAngle / 180);
        const x2 = radius + radius * Math.cos(Math.PI * endAngle / 180);
        const y2 = radius + radius * Math.sin(Math.PI * endAngle / 180);
        const largeArcFlag = sliceAngle > 180 ? 1 : 0;
        svg += `<path d='M${radius},${radius} L${x1},${y1} A${radius},${radius} 0 ${largeArcFlag},1 ${x2},${y2} Z' fill='rgba(${r},${g},${b},${a/255})' stroke='black' stroke-width='1' />`;
        startAngle = endAngle;
    }

    svg += `</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ---------------------- Pin Type Logic ----------------------

/** Defines the possible color-coded groups for pins. */
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
    | "WHITE_GROUP"
    | "OKC_GROUP"
    | "MAGENTA_GROUP" | "GREY_GROUP";

/**
 * Encapsulates pin group logic for mapping pin names to colors and types.
 */
const PinLogic = {
    ALL_POINT_TYPES: [
        "RED_GROUP", "TURQUOISE_GROUP", "YELLOW_GROUP", "GREEN_GROUP",
        "PURPLE_GROUP", "ORANGE_GROUP", "BLUE_GROUP", "VIOLET_GROUP",
        "PINK_GROUP", "WHITE_GROUP", "MAGENTA_GROUP", "OKC_GROUP", "GREY_GROUP",
    ] as PointType[],

    // RGBA color map for each pin group
    PIN_COLOR_MAP: {
        RED_GROUP: [200, 0, 0, 220],
        TURQUOISE_GROUP: [64, 224, 208, 220],
        YELLOW_GROUP: [255, 255, 0, 220],
        GREEN_GROUP: [0, 128, 0, 220],
        PURPLE_GROUP: [128, 0, 128, 220],
        ORANGE_GROUP: [255, 165, 0, 220],
        BLUE_GROUP: [0, 120, 255, 220],
        VIOLET_GROUP: [130, 42, 245, 220],
        PINK_GROUP: [255, 105, 180, 220],
        WHITE_GROUP: [197, 110, 255, 255],
        MAGENTA_GROUP: [255, 0, 255, 255],
        GREY_GROUP: [169, 169, 169, 220],
        OKC_GROUP: [0, 255, 255, 220],
    } as Record<PointType, [number, number, number, number]>,

    // Pin name to group mapping
    // NOTE: There is a typo in the original data. "Site A", "Site B", and "Site C"
    // are assigned to ORANGE_GROUP under a WHITE_GROUP comment block. This has been preserved.
    // Similarly, "Beale HFCGS" is assigned to MAGENTA_GROUP under a comment for that group,
    // but "Bale HFCGS" is assigned to GREEN_GROUP.
    // Any pin name not found in this map will default to BLUE_GROUP.
    PIN_LOOKUP_MAP: {
        // VIOLET_GROUP
        "sb": "VIOLET_GROUP",
        "Ship" : "VIOLET_GROUP",

        // YELLOW_GROUP
        "Point 13": "YELLOW_GROUP",
        "E6-1": "YELLOW_GROUP",
        "E6-2": "YELLOW_GROUP",
        "Point 6": "YELLOW_GROUP",
        "E6-3": "YELLOW_GROUP",
        "E6-4": "YELLOW_GROUP",
        "E6-5": "YELLOW_GROUP",
        "E6-6": "YELLOW_GROUP",
        "E6-7": "YELLOW_GROUP",
        "E6-8": "YELLOW_GROUP",

        // PURPLE_GROUP
        "Support Team": "PURPLE_GROUP",
        "B": "PURPLE_GROUP",

        // GREEN_GROUP
        "Bale HFCGS": "GREEN_GROUP",
        "M": "GREEN_GROUP",
        "NE": "GREEN_GROUP",

        // RED_GROUP
        "FOB1": "RED_GROUP",
        "FOB2": "RED_GROUP",

        // TURQUOISE_GROUP
        "PENT": "TURQUOISE_GROUP",
        "COS": "TURQUOISE_GROUP",
        "TB": "TURQUOISE_GROUP",
        "RR": "TURQUOISE_GROUP",
        "AZ": "TURQUOISE_GROUP",
        "IP": "TURQUOISE_GROUP",

        // PINK_GROUP
        "SAN": "PINK_GROUP",
        "SBL": "PINK_GROUP",
        "LUL": "PINK_GROUP",

        // WHITE_GROUP
        "Site A": "ORANGE_GROUP",
        "Site B": "ORANGE_GROUP",
        "Site C": "ORANGE_GROUP",

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

        // MAGENTA_GROUP HFGCS
        "H_AK": "MAGENTA_GROUP",
        "Beale HFCGS": "MAGENTA_GROUP",
        "E": "MAGENTA_GROUP",

        "LRT1": "GREY_GROUP",
        "LRT2": "GREY_GROUP",
        "LRT3" : "GREY_GROUP",

        "MOB": "OKC_GROUP"

    } as Record<string, PointType>,
};

let activePointTypes = new Set<PointType>();
let activeTypes = new Set<string>();
let activeIerTypes = new Set<string>();

/**
 * Determine pin type (group) from a feature.
 */
function getPinType(d: any): PointType {
    const name = getPointName(d);
    return PinLogic.PIN_LOOKUP_MAP[name] ?? "BLUE_GROUP";
}

/**
 * Get RGBA color for a pin feature based on type.
 * Defaults to BLUE_GROUP color if the type is not found. */
function colorPinkByType(d: any): [number, number, number, number] {
    return PinLogic.PIN_COLOR_MAP[getPinType(d)] ?? [0, 120, 255, 220]; // Default to BLUE_GROUP color
}

// ---------------------- Connection Styling & Labeling ----------------------

type ConnType = "N" | "C" | "HF" | "RT" | "TR" | "SAT" | "HF L" | "U L" | "SL";
const ALL_TYPES: string[] = ["N", "C", "HF", "RT", "TR", "SAT", "HF L", "U L", "SL"];

/** Flag to control visibility of on-map connection labels. */
let showConnectionLabels = false;
/** Flag to control visibility of on-map pin labels. */
let showPinLabels = false;

/**
 * Get RGBA color for a connection feature based on type.
 */
function colorByTypeRGBA(d: any): [number, number, number, number] {
    switch (getConnType(d)) {
        case "N": return [0, 128, 200, 220]; // Blue
        case "TR": return [255, 165, 0, 220]; // Orange
        case "C": return [0, 200, 0, 220];
        case "RT": return [200, 0, 0, 220]; // Now Red
        case "HF": return [255, 105, 180, 220]; // Now Pink
        case "SAT": return [128, 0, 128, 220];
        case "HF L": return [255, 255, 0, 220];
        case "U L": return [8, 232, 222, 220]; // Turquoise-like
        case "SL": return [255, 0, 127, 220]; // Hot Pink

        default: return [128, 128, 128, 200]; // Default Grey
    }
}

/**
 * Get tilt value for a connection feature based on type.
 */
function getHeightByType(d: any): number {
    switch (getConnType(d)) {
        //case "N": return 5;
        //case "C": return 10; // Example of unused height
        case "SL": return 0.96;
        case "SAT": return 0.9;
        case "HF L": return 0.8;
        case "U L": return 0.7;
        case "HF": return 0.5;
        default: return 0.5;
    }
}

/**
 * Get source coordinates for a connection feature, using pre-processed `_sourcePos` if available.
 */ 
function getSourcePos(d: any): [number, number] {
    const src = d._sourcePos ?? getProp(d, "from")?.geometry?.coordinates ?? getProp(d, "coordinates")?.[0];
    return src as [number, number];
}

/**
 * Get target coordinates for a connection feature, using pre-processed `_targetPos` if available.
 */
function getTargetPos(d: any): [number, number] {
    const tgt = d._targetPos ?? getProp(d, "to")?.geometry?.coordinates ?? getProp(d, "coordinates")?.slice(-1)[0];
    return tgt as [number, number];
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
 * Calculates the midpoint of a connection's chord, used as the label position.
 * For simple line layers, this is the midpoint.
 */
function getLabelMidpoint(d: any): [number, number] {
    const s = getSourcePos(d);
    const t = getTargetPos(d);
    if (!Array.isArray(s) || !Array.isArray(t)) return [0, 0];

    // Simple midpoint calculation
    const lng = (s[0] + t[0]) / 2;
    const lat = (s[1] + t[1]) / 2;

    // Return world coordinate [lng, lat]. Note: This does not account for the arc's curve.
    return [lng, lat];
}

/**
 * Get RGBA color for an aggregated connection based on the count of unique connection types.
 */
function getAggregatedColor(d: any): [number, number, number, number] {
    const count = d?._connTypes?.length ?? 0;
    if (count >= 5) {
        return [255, 0, 0, 200]; // Red for 5+ types
    }
    if (count >= 3) {
        return [255, 165, 0, 160]; // Orange for 3-4 types
    }
    if (count >= 2) {
        return [255, 255, 0, 170]; // Yellow for 2 types
    }
    return [200, 200, 200, 150]; // Default: Light grey for 1 type
}

function getAggregatedWidth(d: any): number {
    const count = d?._connTypes?.length ?? 0;
    if (count == 1 ) {
        return 2;
    }
    if (count == 2) {
        return 9;
    }
    if (count >= 3) {
        return 25;
    }
    return 0; // Return 0 if count is 0
}

// ---------------------- Filtering (GPU) ----------------------

// Coordinates for specific locations used in filtering.
const HUB_LNG = -82.492696;
const HUB_LAT = 27.8602;
const HUB_EPS = 1e-6;
let hideHubConnections = false;

const HUB2_LNG = 9.077841; // EU
const HUB2_LAT = 48.734481;
let hideHub2Connections = false;

let showAggregatedConnections = false; // State for toggling aggregated layer

/** State for the demonstration sequence. */
let demoStep = 0;

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
 * Generates a key representing the current filter state for Deck.gl update triggers.
 */
function filterKey() {
    return [
        Array.from(activeTypes).sort().join(","),
        `hub1:${hideHubConnections ? 1 : 0}`,
        `hub2:${hideHub2Connections ? 1 : 0}`,
        Array.from(activePointTypes).sort().join(","),
        Array.from(activeIerTypes).sort().join(","),
        `aggregated:${showAggregatedConnections ? 1 : 0}`, // Add aggregated connections state
    ].join("|") + `|connLabels:${showConnectionLabels ? 1 : 0}` +
      `|pinLabels:${showPinLabels ? 1 : 0}`;
}

// ---------------------- Build Layers ----------------------

/**
 * Constructs and returns all Deck.gl layers for the map overlay.
 */
function buildLayers(connectionsData: any[], pinsData: any[]) {
    /**
     * Shared filtering logic for connections. A connection is visible if:
     * 1. Its connection type is active.
     * 2. It's not a hidden HUB connection.
     * 3. The pin types of BOTH its start and end points are active.
     */
    const getConnectionFilterValue = (d: any) => {
        const sourcePinTypeVisible = activePointTypes.has(d._sourcePinType);
        const targetPinTypeVisible = activePointTypes.has(d._targetPinType);
        // A connection is visible by IER if no IER filters are active, or if at least one of its IER types is active.
        const ierVisible = activeIerTypes.size === 0 || d._ierTypes.some((ierType: string) => activeIerTypes.has(ierType));

        return (
            activeTypes.has(d._connType) &&
            (!hideHubConnections || !d._isHub1) &&
            (!hideHub2Connections || !d._isHub2) && // Corrected inconsistent tabbing
            sourcePinTypeVisible && targetPinTypeVisible && ierVisible
        ) ? 1 : 0;
    };

    // Layer for the main connection lines (arcs).
    const connectionsLayer = new ArcLayer({
        id: "flights",
        // Hide this layer when aggregated connections are shown by providing empty data.
        data: showAggregatedConnections ? [] : connectionsData,
        getSourcePosition: (d: any) => getSourcePos(d),
        getTargetPosition: (d: any) => getTargetPos(d),
        getSourceColor: colorByTypeRGBA,
        getTargetColor: (d: any) => colorByTypeRGBA(d), // Use same color for target for a solid line
        getHeight: (d: any) => getHeightByType(d),
        getWidth: 2,
        pickable: true, // Allow picking (hover, click)
        greatCircle: true,
        getFilterValue: getConnectionFilterValue,
        filterRange: [1, 1],
        extensions: [dataFilterExt],
        updateTriggers: { getFilterValue: filterKey() }
    });

    // New layer for aggregated connections, showing thickness based on count
    const aggregatedConnectionsLayer = new ArcLayer({
        id: "aggregated-connections",
        data: showAggregatedConnections ? aggregatedConnections : [], // Use the new data source
        getSourcePosition: (d: any) => d._sourcePos,
        getTargetPosition: (d: any) => d._targetPos,
        getSourceColor: getAggregatedColor,
        getTargetColor: getAggregatedColor,
        // Thickness scales with the number of aggregated connections
        getWidth: (d: any) => getAggregatedWidth(d), // Adjust multiplier for desired thickness
        getHeight: (d: any) => 0.5, // Use a consistent height for aggregated arcs
        pickable: true,
        greatCircle: true,
        // Filter based on whether *any* of the constituent types are active
        getFilterValue: (d: any) => {
            const anyConnTypeActive = d._connTypes.some((type: string) => activeTypes.has(type));
            const sourcePinTypeVisible = activePointTypes.has(d._sourcePinType);
            const targetPinTypeVisible = activePointTypes.has(d._targetPinType);
            // An aggregated connection is visible by IER if no IER filters are active, or if at least one of its aggregated IER types is active.
            const ierVisible = activeIerTypes.size === 0 || d._ierTypes.some((ierType: string) => activeIerTypes.has(ierType));
            return (anyConnTypeActive && (!hideHubConnections || !d._isHub1) && (!hideHub2Connections || !d._isHub2) && sourcePinTypeVisible && targetPinTypeVisible && ierVisible) ? 1 : 0;
        },
        filterRange: [1, 1],
        extensions: [dataFilterExt],
        updateTriggers: { getFilterValue: filterKey() }
    });

    // New layer for persistent on-map aggregated connection labels.
    const aggregatedConnectionTextLayer = new TextLayer({
        id: 'aggregated-connection-labels',
        // Only display labels if showConnectionLabels is true AND aggregated view is on
        data: showConnectionLabels && showAggregatedConnections ? aggregatedConnections : [],
        pickable: false,
        // Position label at the midpoint of the connection's chord
        getPosition: getLabelMidpoint,
        getText: (d: any) => {
            const fromObj = d?.from;
            const toObj 	= d?.to;
            
            const fromName = fromObj?.properties?.name ?? "Unknown Start";
            const toName 	= toObj?.properties?.name 	?? "Unknown End";
            const fromTech = fromObj?.properties?.tech;
            const toTech 	= toObj?.properties?.tech;
            const connTypes = d?._connTypes?.join(', ') ?? "N/A";
            const count = d?._count ?? 0;

            // Multi-line string with start/end points, aggregated count, and types.
            return `\u25b6 ${fromName}${fromTech ? ` (${fromTech})` : ''}\n\u25b6 ${toName}${toTech ? ` (${toTech})` : ''}\n(${count} connections: ${connTypes})`;
        },
        // Use background for the black box effect
        background: true,
        getBackgroundColor: [0, 0, 0, 200], // Black background (Opacity 200/255)
        getColor: [255, 255, 255, 255], 		// White text
        
        // Text rendering settings for clarity and performance.
        getSize: 15,
        fontSettings: {
            sdf: true // Use Signed Distance Field textures for robustness
        },
        characterSet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:()[]- \n\u25b6', 
        
        getPixelOffset: [0, -10], // Offset to appear slightly above the line
        getAlignmentBaseline: 'center',
        getTextAnchor: 'middle',
        padding: [4, 6], 
        
        // Use the same filtering logic as the aggregatedConnectionsLayer
        getFilterValue: (d: any) => {
            const anyConnTypeActive = d._connTypes.some((type: string) => activeTypes.has(type));
            const sourcePinTypeVisible = activePointTypes.has(d._sourcePinType);
            const targetPinTypeVisible = activePointTypes.has(d._targetPinType);
            // An aggregated connection label is visible by IER if no IER filters are active, or if at least one of its aggregated IER types is active.
            const ierVisible = activeIerTypes.size === 0 || d._ierTypes.some((ierType: string) => activeIerTypes.has(ierType));
            return (anyConnTypeActive && (!hideHubConnections || !d._isHub1) && (!hideHub2Connections || !d._isHub2) && sourcePinTypeVisible && targetPinTypeVisible && ierVisible) ? 1 : 0;
        },
        filterRange: [1, 1],
        extensions: [dataFilterExt],
        updateTriggers: { getFilterValue: filterKey() },
        
        // Ensure aggregated connection labels are drawn on top of other layers.
        getZLevel: 3, // Higher Z-level than regular connection labels
        parameters: {
            depthTest: false, // Disables depth culling so the TextLayer is always visible
            depthMask: false
        }
    });

    // Layer for individual connection labels.
    const individualConnectionTextLayer = new TextLayer({
        id: 'connection-labels',
        // Show labels only when not in aggregated view
        data: showConnectionLabels && !showAggregatedConnections ? connectionsData : [],
        pickable: false,
        // Position label at the midpoint of the connection's chord.
        getPosition: getLabelMidpoint,
        getText: (d: any) => {
            const fromObj = d?.from;
            const toObj = d?.to;
            const fromName = fromObj?.properties?.name ?? "Unknown Start";
            const toName = toObj?.properties?.name ?? "Unknown End";
            const fromTech = fromObj?.properties?.tech;
            const toTech 	= toObj?.properties?.tech;
            const connType = getConnType(d);

            // Multi-line string with start/end points and connection type.
            return `\u25b6 ${fromName}${fromTech ? ` (${fromTech})` : ''}\n\u25b6 ${toName}${toTech ? ` (${toTech})` : ''}\n(Type: ${connType})`;
        },
        // Use background for a "black box" effect to improve readability.
        background: true,
        getBackgroundColor: [0, 0, 0, 200], // Semi-transparent black background
        getColor: [255, 255, 255, 255], // White text
        // Text rendering settings for clarity and performance.
        getSize: 15,
        fontSettings: {
            sdf: true // Use Signed Distance Field textures for robustness
        },
        characterSet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:()[]- \n\u25b6', 
        getPixelOffset: [0, -10], // Offset to appear slightly above the line.
        getAlignmentBaseline: 'center',
        getTextAnchor: 'middle',
        padding: [4, 6], 
        // Use the same filtering logic as the ArcLayer to ensure labels only appear on visible lines
        getFilterValue: getConnectionFilterValue,
        filterRange: [1, 1],
        extensions: [dataFilterExt],
        updateTriggers: { getFilterValue: filterKey() },
        // Ensure connection labels are drawn on top of other layers.
        getZLevel: 2,
        parameters: {
            depthTest: false, // Disables depth culling so the TextLayer is always visible.
            depthMask: false
        }
    });
    // Layer for circular "pin" markers.
    const pinsLayer = new deck.IconLayer({
        id: "pins",
        data: overlappingPins,
        pickable: true,
        autoHighlight: true,
        // Set to false to make icons lie flat on the map surface
        billboard: false,
        iconAtlas: null, // Using data URLs, so no atlas needed
        getIcon: (d: any) => ({
            url: d.iconUrl,
            width: 24,
            height: 24,
            anchorY: 12,
        }),
        getPosition: (d: any) => d.geometry.coordinates,
        sizeScale: 1,
        getSize: 24,
        // Filter based on whether any of the constituent pin types are active
        getFilterValue: (d: any) => d.pinTypes.some((type: PointType) => activePointTypes.has(type)) ? 1 : 0,
        filterRange: [1, 1],
        extensions: [dataFilterExt],
        updateTriggers: { getFilterValue: filterKey() }
    });

    // Layer for persistent on-map pin labels.
    const pinTextLayer = new TextLayer({
        id: 'pin-labels',
        // Only display if showPinLabels is true
        data: showPinLabels ? pinsData : [],
        pickable: false,
        getPosition: (d: any) => d.geometry.coordinates,
        getText: (d: any) => {
            const name = d.properties?.name || '';
            const tech = d.properties?.tech;
            // Display name, and tech on a new line if it exists.
            if (tech) return `${name}\n${tech}`;
            return name;
        },
        getColor: [255, 255, 255, 255],
        getSize: 14,
        getPixelOffset: (d: any) => d._labelOffset || [0, 20], // Use pre-calculated offset for overlapping pins.
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

    return [connectionsLayer, aggregatedConnectionsLayer, individualConnectionTextLayer, aggregatedConnectionTextLayer, pinsLayer, pinTextLayer];
}

// ---------------------- UI: Legend and Controls ----------------------

/**
 * Adds UI panels for multi-filter controls (connections and pins) to the document.
 */
function addMultiFilterControls(map: google.maps.Map, onChange: () => void) {
    const connItems: { key: string; label: string; color: string }[] = [
        { key: "N", label: "Blue", color: "rgb(0,128,200)" },
        { key: "C", label: "Green", color: "rgb(0,200,0)" },
        { key: "RT", label: "Red", color: "rgb(200,0,0)" },
        { key: "HF", label: "Pink", color: "rgb(255,105,180)" },
        { key: "TR", label: "Orange", color: "rgb(255,165,0)" },
        { key: "SAT", label: "Purple", color: "rgb(128,0,128)" },
        { key: "HF L", label: "Yellow", color: "rgb(255, 255, 0)" },
        { key: "U L", label: "Turquoise", color: "rgb(64,224,208)" },
        { key: "SL", label: "Hot Pink", color: "rgb(255,0,127)" },
    ];
    const pinItems: { key: PointType; label: string; color: string }[] = [
        { key: "PINK_GROUP", label: "Pink", color: "rgb(255, 105, 180)" },
        { key: "VIOLET_GROUP", label: "Violet", color: "rgb(130, 42, 245)" },
        { key: "RED_GROUP", label: "Red", color: "rgb(200, 0, 0)" },
        { key: "TURQUOISE_GROUP", label: "Turquoise", color: "rgb(64, 224, 208)" },
        { key: "YELLOW_GROUP", label: "Yellow", color: "rgb(255, 255, 0)" },
        { key: "GREEN_GROUP", label: "Green", color: "rgb(0, 128, 0)" },
        { key: "PURPLE_GROUP", label: "Purple", color: "rgb(128, 0, 128)" },
        { key: "ORANGE_GROUP", label: "Orange", color: "rgb(255, 165, 0)" },
        { key: "BLUE_GROUP", label: "Blue", color: "rgb(0, 120, 255)" },
        { key: "WHITE_GROUP", label: "White", color: "rgb(197, 110, 255)" },
        { key: "OKC_GROUP", label: "Cyan", color: "rgb(0, 255, 255)" },
        { key: "MAGENTA_GROUP", label: "Magenta", color: "rgb(255, 0, 255)" },
        { key: "GREY_GROUP", label: "Grey", color: "rgb(169, 169, 169)" },
    ];

    const ierItems: { key: string; label: string }[] = [
        { key: "LOCATION", label: "Location" },
        { key: "LOGISTICS", label: "Logistics" },
        { key: "NRP", label: "NRP" },
        { key: "SIT", label: "SIT" },
        { key: "MESSAGE", label: "Message" },
        { key: "DEFAULT", label: "Default" },
    ];
    const controlsContainer = document.createElement('div');
    controlsContainer.innerHTML = `<button id="filters-toggle" title="Show/Hide filters" style="position: absolute; z-index: 10; top: 60px; left: 220px; padding:8px 10px; border:1px solid #ccc; border-radius:8px; background:#ffffff; box-shadow:0 2px 8px rgba(0,0,0,.15); font: 13px system-ui, sans-serif; cursor:pointer;">Filters</button>`;
    document.body.appendChild(controlsContainer);

    const controlsAndButtonContainer = document.createElement('div');
    controlsAndButtonContainer.innerHTML = `
        <div id="controls-container" style="position:absolute; z-index:5; top:60px; left:10px; font: 13px system-ui, sans-serif; display:flex; flex-direction:column; gap:10px; max-width: 200px; max-height: calc(100vh - 80px); overflow-y: auto; padding-right: 5px;">
            
            <div id="connection-legend-box" class="legend-box">
                <div class="legend-header"><h2 style="font-size:16px; margin:0;">Connections</h2><button class="toggle-btn" data-target="connection-legend-box">-</button></div>
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
                <label>
                    <input type="checkbox" id="show-aggregated-cb" ${showAggregatedConnections ? 'checked' : ''}>
                    Aggregate Connections
                </label>
            </div>
            <div id="ier-legend-box" class="legend-box">
                <div class="legend-header"><h2 style="font-size:16px; margin:0;">IER Type</h2><button class="toggle-btn" data-target="ier-legend-box">-</button></div>
                <div id="ier-button-section" class="button-section">
                    <button id="all-ier-btn">All / None</button>
                </div>
                ${ierItems.map(({ key, label }) => `
                    <label>
                        <input type="checkbox" class="ier-cb" data-key="${key}" ${activeIerTypes.has(key) ? 'checked' : ''}>
                        ${label}
                    </label>
                `).join('')}
            </div>

            <div class="legend-box">
                <div class="legend-header"><h2 style="font-size:16px; margin:0;">Pins</h2><button class="toggle-btn" data-target="pins-legend-box">-</button></div>
                <div class="button-section">
                    <button id="all-pins-btn">All / None</button>
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
            .legend-header { display: flex; justify-content: space-between; align-items: center; }
            .toggle-btn { background: none; border: none; font-size: 20px; cursor: pointer; padding: 0 5px; line-height: 1; }
            .legend-box.minimized > *:not(.legend-header) { display: none; }
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
    document.body.appendChild(controlsAndButtonContainer);

    // Add the "Show Details" button for connection labels to the controls panel.
    const connButtonSection = document.getElementById('conn-button-section');
    const connLabelButton = document.createElement('button');

    connLabelButton.id = 'toggle-conn-labels-btn';
    connLabelButton.textContent = showConnectionLabels ? 'Hide Details' : 'Show Details';
    connLabelButton.title = 'Toggle on-map connection details (Source/Target Names & Coords)';
    if (connButtonSection) {
        // Append the new button after the "All/None" button
        connButtonSection.appendChild(connLabelButton);
    }

    // Attach all event listeners for the control panel.
    document.getElementById('filters-toggle')?.addEventListener('click', () => {
        const container = document.getElementById('controls-container');
        if (container) toggleDisplay(container);
    }); // Note: toggleDisplay is defined at the top of the file.
    
    // Add IDs to the legend boxes for targeting
    document.querySelector('.legend-box:nth-of-type(2)')?.setAttribute('id', 'pins-legend-box');


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
            const key = cb.dataset.key as string;
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

    document.getElementById('all-pins-btn')?.addEventListener('click', () => {
        const isAllActive = activePointTypes.size === PinLogic.ALL_POINT_TYPES.length;
        activePointTypes.clear();
        if (!isAllActive) PinLogic.ALL_POINT_TYPES.forEach(type => activePointTypes.add(type));
        document.querySelectorAll<HTMLInputElement>('.pin-cb').forEach(cb => cb.checked = !isAllActive);
        updateMap();
    });

    document.getElementById('all-ier-btn')?.addEventListener('click', () => {
        const isAllActive = activeIerTypes.size === ierItems.length;
        activeIerTypes.clear();
        if (!isAllActive) ierItems.forEach(item => activeIerTypes.add(item.key));
        document.querySelectorAll<HTMLInputElement>('.ier-cb').forEach(cb => cb.checked = !isAllActive);
        updateMap();
    });

    document.querySelectorAll<HTMLInputElement>('.ier-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            const key = cb.dataset.key as string;
            if (cb.checked) activeIerTypes.add(key); else activeIerTypes.delete(key);
            updateMap();
        });
    });

    document.getElementById('show-aggregated-cb')?.addEventListener('change', (e) => {
        showAggregatedConnections = (e.target as HTMLInputElement).checked;
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

    // Event listeners for the new minimize/maximize toggle buttons
    document.querySelectorAll<HTMLButtonElement>('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const legendBox = document.getElementById(targetId!);
            if (legendBox) {
                legendBox.classList.toggle('minimized');
                btn.textContent = legendBox.classList.contains('minimized') ? '+' : '-';
            }
        });
    });
}

// ---------------------- Clicked Coordinates Display ----------------------

/**
 * Adds a UI panel to display the coordinates of the last map click.
 */
function addCoordinatesUI() {
    const coordsContainer = document.createElement("div");
    coordsContainer.id = "coords-container";
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
 * Updates the displayed map click coordinates in the UI panel.
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
 * Fetches and pre-processes connection and point data to optimize rendering.
 * This computes values once on load rather than on every render.
 */
async function preprocessData() {
    const [connectionsJson, pointsJson] = await Promise.all([
        fetch(CONNECTIONS_DATA_URL).then(res => res.json()),
        fetch(POINTS_DATA_URL).then(res => res.json())
    ]);

    // Create a lookup map for points by name for efficient access.
    const allPoints = (pointsJson?.type === "FeatureCollection" ? pointsJson.features : pointsJson);
    const pointMap = new Map<string, Feature>();
    allPoints.forEach((p: Feature) => {
        const name = getPointName(p); // getPointName handles nested properties
        if (name) pointMap.set(name, p);
    });

    // Add HUB2 since it's referenced in connections but not in points.json
    pointMap.set("HUB2", {
        type: "Feature",
        properties: { name: "HUB2" },
        geometry: { type: "Point", coordinates: [HUB2_LNG, HUB2_LAT] }
    });

    // Pre-process connections: filter, resolve point references, and pre-calculate properties.
    processedConnections = connectionsJson
        .filter((c: any) => {
            const connType = getConnType(c);
            if (connType === 'TR') {
                const fromName = getProp(c, "from");
                const toPoint = pointMap.get(getProp(c, "to"));
                const toLng = toPoint?.geometry.type === 'Point' ? toPoint.geometry.coordinates[0] : undefined;
                if (toLng == null) return true; // Keep if destination is unknown.

                // Mississippi River is approximately at -90 longitude
                if (fromName === 'Ohio Pin') {
                    return toLng > -90; // East of Mississippi
                }
                if (fromName === 'FOB1') {
                    return toLng < -90; // West of Mississippi
                }
            } // Note: This logic seems very specific and might need review if data changes.
            return true; // Keep all other connections
        })
        .map((c: any) => {
            const fromPoint = pointMap.get(getProp(c, "from"));
            const toPoint = pointMap.get(getProp(c, "to"));
            // Pre-calculate pin types for the connection's endpoints.
            const sourcePinType = fromPoint ? getPinType(fromPoint) : "BLUE_GROUP";
            const targetPinType = toPoint ? getPinType(toPoint) : "BLUE_GROUP";

            return {
                ...c,
                from: fromPoint,
                to: toPoint,
                _sourcePos: fromPoint?.geometry?.type === 'Point' ? (fromPoint.geometry as GeoJSON.Point).coordinates : undefined,
                _targetPos: toPoint?.geometry?.type === 'Point' ? (toPoint.geometry as GeoJSON.Point).coordinates : undefined,
                _connType: getConnType(c),
                _ierTypes: getIERArray(c), // Pre-calculate IER types for filtering
                _sourcePinType: sourcePinType,
                _targetPinType: targetPinType,
                _isHub1: connectsToHub({ _sourcePos: (fromPoint?.geometry as GeoJSON.Point)?.coordinates, _targetPos: (toPoint?.geometry as GeoJSON.Point)?.coordinates }),
                _isHub2: connectsToHub2({ _sourcePos: (fromPoint?.geometry as GeoJSON.Point)?.coordinates, _targetPos: (toPoint?.geometry as GeoJSON.Point)?.coordinates })
            };
        })
        .filter(c => c._sourcePos && c._targetPos); // Filter out connections with missing point coordinates.

    // Pre-process points to calculate and cache their type.
    processedPins = allPoints.map((p: any) => {
        p._pinType = getPinType(p); // Pre-calculate pin type for all points
        // All points are treated as pins.
        return p;
    });

    // --- Group overlapping pins and create pie chart icons ---
    const pinsByLocation = new Map<string, any[]>();
    processedPins.forEach(p => {
        const coords = p.geometry.coordinates.join(',');
        if (!pinsByLocation.has(coords)) {
            pinsByLocation.set(coords, []);
        }
        pinsByLocation.get(coords)!.push(p);
    });

    overlappingPins = Array.from(pinsByLocation.values()).map(pins => {
        const firstPin = pins[0];
        const pinTypes = pins.map(p => p._pinType);
        const colors = pins.map(p => colorPinkByType(p));
        const iconUrl = createPieIcon(colors);

        return {
            ...firstPin, // Use first pin for position and base properties
            count: pins.length,
            pinTypes: pinTypes,
            originalPins: pins,
            iconUrl: iconUrl,
        };
    });

    // Aggregate connections for the new layer
    const aggregatedConnectionsMap = new Map<string, {
        from: Feature | undefined;
        to: Feature | undefined;
        _sourcePos: [number, number];
        _targetPos: [number, number];
        _connTypes: Set<string>;
        _ierTypes: Set<string>; // Add aggregated IER types
        _count: number;
        _sourcePinType: PointType;
        _targetPinType: PointType;
        _isHub1: boolean;
        _isHub2: boolean;
    }>();

    processedConnections.forEach(conn => {
        // Create a canonical key for each from/to pair of coordinates,
        // regardless of direction, by sorting the coordinate strings before creating the key.
        const pos1Str = conn._sourcePos.join(',');
        const pos2Str = conn._targetPos.join(',');
        const key = [pos1Str, pos2Str].sort().join('|');
        if (!aggregatedConnectionsMap.has(key)) {
            aggregatedConnectionsMap.set(key, {
                from: conn.from,
                to: conn.to,
                _sourcePos: conn._sourcePos,
                _targetPos: conn._targetPos,
                _connTypes: new Set<string>(),
                _ierTypes: new Set<string>(), // Initialize IER types set
                _count: 0,
                _sourcePinType: conn._sourcePinType, // Corrected from conn.sourcePinType
                _targetPinType: conn._targetPinType, // Corrected from conn.targetPinType
                _isHub1: false, // Will be OR-ed
                _isHub2: false  // Will be OR-ed
            });
        }
        const aggregated = aggregatedConnectionsMap.get(key)!;
        aggregated._connTypes.add(conn._connType);
        conn._ierTypes.forEach((ier: string) => aggregated._ierTypes.add(ier)); // Aggregate IER types
        aggregated._count++;
        aggregated._isHub1 = aggregated._isHub1 || conn._isHub1;
        aggregated._isHub2 = aggregated._isHub2 || conn._isHub2;
    });

    aggregatedConnections = Array.from(aggregatedConnectionsMap.values()).map(agg => ({
        ...agg,
        _connTypes: Array.from(agg._connTypes), // Convert Set to Array for easier use
        _ierTypes: Array.from(agg._ierTypes) // Convert IER Set to Array
    }));

    // --- Assign label offsets for overlapping pins ---
    overlappingPins.forEach(pinGroup => {
        if (pinGroup.count > 1) { // Only apply special offsets for overlapping pins
            const numSlices = pinGroup.count;
            const sliceAngle = 360 / numSlices;
            const offsetRadius = 45; // Distance of the label from the center of the icon

            pinGroup.originalPins.forEach((p: any, i: number) => {
                // Calculate the angle for the middle of the slice
                const midAngle = -90 + (i * sliceAngle) + (sliceAngle / 2);
                const midAngleRad = midAngle * (Math.PI / 180);

                // Convert polar coordinates (radius, angle) to Cartesian coordinates (x, y) for the offset
                const offsetX = offsetRadius * Math.cos(midAngleRad);
                const offsetY = offsetRadius * Math.sin(midAngleRad);
                p._labelOffset = [offsetX, offsetY];
            });
        }
    });

    // Flatten originalPins back into processedPins for the label layer
    processedPins = overlappingPins.flatMap(group => group.originalPins);
}

// ---------------------- Initialization ----------------------

/**
 * Initializes the Google Map, Deck.gl overlay, UI controls, and event listeners.
 */
async function initMap(): Promise<void> {
    const map = new google.maps.Map(
        document.getElementById("map") as HTMLElement,
        {
            center: { lat: 39.5, lng: -98.35 },
            zoom: 4,
            tilt: 30,
            mapId: "90f87356969d889c",
            draggableCursor: 'default',
            draggingCursor: 'grabbing',
            // Enable map type control to switch between styles
            mapTypeControl: true,
            mapTypeControlOptions: {
                style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
                position: google.maps.ControlPosition.TOP_LEFT,
                mapTypeIds: ["no_labels_map", "white_map", "black_map", "satellite"],
            },
        }
    );

    // Create a styled map type for the default view (no labels)
    const noLabelsMapType = new google.maps.StyledMapType(PERMANENT_HIDE_LABELS_STYLE, {
        name: "Map",
    });
    map.mapTypes.set("no_labels_map", noLabelsMapType);

    // Create a styled map type for the new white map with labels
    const whiteMapType = new google.maps.StyledMapType(WHITE_MAP_STYLE, {
        name: "White Map",
    });
    map.mapTypes.set("white_map", whiteMapType);

    // Create a styled map type for the new black map
    const blackMapType = new google.maps.StyledMapType(BLACK_MAP_STYLE, {
        name: "Black Map",
    });
    map.mapTypes.set("black_map", blackMapType);

    map.setMapTypeId("no_labels_map"); // Set the default map type

    // Fetch and process data before rendering layers
    await preprocessData();

    // Define the update function shared by all controls
    const layerUpdateCallback = () => {
        overlay.setProps({ layers: buildLayers(processedConnections, processedPins) });
    };

    // Add UI components
    addCoordinatesUI();
    // Add multi-filter controls, which includes all filtering and label toggles.
    addMultiFilterControls(map, layerUpdateCallback);

    // Initialize with all filters off by default.
    activeTypes = new Set();
    activePointTypes = new Set();
    activeIerTypes = new Set(); // Initialize IER filter set

    // Create and display the "Fly from OKC to HUB" button on load
    const flyToButton = document.createElement('button');
    flyToButton.id = 'fly-to-btn';
    flyToButton.textContent = 'Fly from OKC to HUB';
    flyToButton.style.cssText = `
        position: absolute; z-index: 10; top: 60px; left: 280px;
        padding: 8px 10px; border: 1px solid #ccc; border-radius: 8px;
        background: #ffffff; box-shadow: 0 2px 8px rgba(0,0,0,.15);
        font: 13px system-ui, sans-serif; cursor: pointer;
    `;
    flyToButton.addEventListener('click', () => {
        const okcCoords = { lat: 35.4676, lng: -97.5164 };
        const hubCoords = { lat: 39.4204, lng: -118.7242 };
        const ZOOM_DURATION = 1500; // 1.5 seconds for zoom
        const PAN_DURATION = 4000; // 4 seconds for pan
        const PAUSE_DURATION = 1000; // 1 second pause

        // 1. Animate zoom into OKC.
        const zoomStartTime = performance.now();
        const animateZoom = (currentTime: number) => {
            const elapsedTime = currentTime - zoomStartTime;
            const progress = Math.min(elapsedTime / ZOOM_DURATION, 1);
            const easedProgress = 1 - Math.pow(1 - progress, 3); // easeOutCubic

            const currentZoom = 5 + (10 - 5) * easedProgress; // Zoom from 5 to 10
            const currentTilt = 0 + (45 - 0) * easedProgress; // Tilt from 0 to 45

            map.moveCamera({ center: okcCoords, zoom: currentZoom, tilt: currentTilt });

            if (progress < 1) {
                requestAnimationFrame(animateZoom);
            } else {
                // 2. After zoom is complete, pause.
                setTimeout(() => {
                    // 3. Animate pan from OKC to HUB with a zoom-out/zoom-in effect.
                    const panStartTime = performance.now();
                    const animatePan = (panCurrentTime: number) => {
                        const panElapsedTime = panCurrentTime - panStartTime;
                        const panProgress = Math.min(panElapsedTime / PAN_DURATION, 1);
                        const panEasedProgress = 1 - Math.pow(1 - panProgress, 3); // easeOutCubic

                        // Interpolate zoom to create an "arc" effect
                        const startZoom = 10;
                        const midZoom = 6; // Zoom out to this level at the halfway point
                        let currentZoom;

                        if (panEasedProgress <= 0.5) {
                            // First half: Zoom out from 10 to 6
                            const zoomOutProgress = panEasedProgress * 2; // Map [0, 0.5] to [0, 1]
                            currentZoom = startZoom + (midZoom - startZoom) * zoomOutProgress;
                        } else {
                            // Second half: Zoom in from 6 to 10
                            const zoomInProgress = (panEasedProgress - 0.5) * 2; // Map [0.5, 1] to [0, 1]
                            currentZoom = midZoom + (startZoom - midZoom) * zoomInProgress;
                        }

                        const currentLat = okcCoords.lat + (hubCoords.lat - okcCoords.lat) * panEasedProgress;
                        const currentLng = okcCoords.lng + (hubCoords.lng - okcCoords.lng) * panEasedProgress;

                        map.moveCamera({
                            center: { lat: currentLat, lng: currentLng },
                            zoom: currentZoom,
                            tilt: 45,
                        });

                        if (panProgress < 1) {
                            requestAnimationFrame(animatePan);
                        }
                    };
                    requestAnimationFrame(animatePan);
                }, PAUSE_DURATION);
            }
        };

        // Set initial view and kick off the animation.
        map.moveCamera({ center: okcCoords, zoom: 5, heading: 0, tilt: 0 });
        requestAnimationFrame(animateZoom);
    });
    const mapDiv = document.getElementById('map');
    if (mapDiv) {
        mapDiv.appendChild(flyToButton);
    }

    // Create and display the new button underneath the "Fly to" button.
    const newButton = document.createElement('button');
    newButton.id = 'new-button';
    newButton.textContent = 'New Button';
    newButton.textContent = 'Demonstration';
    newButton.style.cssText = `
        position: absolute; z-index: 10; top: 105px; left: 280px;
        padding: 8px 10px; border: 1px solid #ccc; border-radius: 8px;
        background: #ffffff; box-shadow: 0 2px 8px rgba(0,0,0,.15);
        font: 13px system-ui, sans-serif; cursor: pointer;
    `;
    if (mapDiv) {
        mapDiv.appendChild(newButton);
    }

    // Function to update UI checkboxes based on active filter sets
    const updateCheckboxes = () => {
        document.querySelectorAll<HTMLInputElement>('.conn-cb').forEach(cb => {
            cb.checked = activeTypes.has(cb.dataset.key as ConnType);
        });
        document.querySelectorAll<HTMLInputElement>('.pin-cb').forEach(cb => {
            cb.checked = activePointTypes.has(cb.dataset.key as PointType);
        });
    };

    /**
     * Runs an automated demonstration sequence with delays.
     */
    async function runDemonstration() {
        // Helper to pause execution
        const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

        newButton.disabled = true;
        newButton.textContent = "Running Demo...";

        // Step 1: Turn off all filters, reveal OKC pin, and center camera.
        activeTypes.clear();
        activePointTypes.clear();
        activePointTypes.add("OKC_GROUP"); // "MOB" is in OKC_GROUP
        const okcPin = processedPins.find(p => getPointName(p) === "MOB");
        const okcCoords = okcPin && 'geometry' in okcPin && okcPin.geometry.type === 'Point' ? asLngLat(okcPin) : null;
        if (okcCoords) {
            map.panTo({ lat: okcCoords[1], lng: okcCoords[0] });
            map.setZoom(6);
        }
        updateCheckboxes(); // Sync UI with new filter state
        layerUpdateCallback();

        await delay(2000); // Wait for 2 seconds

        // Step 2: Reveal P nodes and RT connections
        activePointTypes.add("RED_GROUP"); // 'P' pins are in RED_GROUP
        map.setZoom(5);
        activeTypes.add("RT");
        updateCheckboxes();
        layerUpdateCallback();

        await delay(2000); // Wait for another 2 seconds

        // Step 3: Zoom out further, reveal S pins and TR connections
        map.setZoom(4); // Zoom out further
        activePointTypes.add("BLUE_GROUP"); // 'S' pins are in BLUE_GROUP
        activeTypes.add("TR");
        updateCheckboxes();
        layerUpdateCallback();

        newButton.disabled = false;
        newButton.textContent = "Run Demonstration";
    }

    // Initialize button text
    newButton.textContent = "Run Demonstration";

    newButton.addEventListener('click', () => {
        runDemonstration();
    });

    map.addListener('click', (e: google.maps.MapMouseEvent) => {
        const ll = e.latLng;
        if (ll) updateCoordinatesUI(ll.lat(), ll.lng());
    });
    
    // Initialize the overlay with the first set of layers
    overlay = new GoogleMapsOverlay({
        layers: buildLayers(processedConnections, processedPins),
        
        // Tooltip displayed on hover.
        getTooltip: ({ object, layer }) => {
            if (!object) return null;
            
            // Tooltip for pins and icons.
            if (layer?.id === 'pins' && object.count > 1) {
                const pinList = object.originalPins.map((p: any) => {
                    const name = p?.properties?.name ?? "Pin";
                    const [lng, lat] = asLngLat(p) ?? [];
                    return `<div><b>${name}</b></div><div>(Lat: ${fmt(lat)}, Lng: ${fmt(lng)})</div>`;
                }).join('<hr style="margin: 2px 0; border-color: #555;">');
                return {
                    html: `
                        <div style="font-family:system-ui; font-size:12px; line-height:1.35; color:white; max-width: 200px;">
                            <div><b>${object.count} overlapping pins</b></div>
                            <hr style="margin: 4px 0; border-color: #777;">
                            ${pinList}
                        </div>
                    `
                };
            } else if (layer?.id === 'pins') {
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
            
            // Tooltip for aggregated connections
            if (layer?.id === 'aggregated-connections') {
                const fromName = object?.from?.properties?.name ?? "Unknown Start";
                const toName = object?.to?.properties?.name ?? "Unknown End";
                const fromTech = object?.from?.properties?.tech;
                const toTech = object?.to?.properties?.tech;
                const connTypes = object?._connTypes?.join(', ') ?? "N/A";
                const count = object?._count ?? 0;
                const fromString = `"${fromName}"${fromTech ? ` (${fromTech})` : ''}`;
                const toString = `"${toName}"${toTech ? ` (${toTech})` : ''}`;
                return {
                    html: `
                        <div style="font-family:system-ui; font-size:12px; line-height:1.35; color:white">
                            <div><b>${fromString} &rarr; ${toString}</b></div>
                            <div style="margin-top:4px;">Types (${count}): ${connTypes || 'N/A'}</div>
                        </div>
                    `
                };
            }

            // Tooltip for connections.
            const fromObj = object?.from;
            const toObj = object?.to;
            const fromName = fromObj?.properties?.name ?? "From";
            const toName = toObj?.properties?.name ?? "To";
            const connType = getConnType(object);
            const fromTech = fromObj?.properties?.tech;
            const toTech = toObj?.properties?.tech;
            const ierArray = getIERArray(object);
            const ierHtml = ierArray.length > 0 ? `<div style="margin-top:4px;">IER: ${ierArray.join(', ')}</div>` : '';

            return {
                html: `
                    <div style="font-family:system-ui; font-size:12px; line-height:1.35; color: white">
                        <div>From: "${fromName}" (${fromTech ?? 'N/A'})</div>
                        <div>To: "${toName}" (${toTech ?? 'N/A'})</div>
                        <div style="margin-top:4px;">Type: ${connType}</div>
                        ${ierHtml}
                    </div>
                `
            };
        }
    });

    overlay.setMap(map);
}

// Export initMap to the global window object for the Maps API to call it.
declare global {
    interface Window {
        initMap: () => void;
    }
}
window.initMap = initMap;

export {};