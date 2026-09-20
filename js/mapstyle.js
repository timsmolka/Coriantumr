// =============================================================================
// mapstyle.js — Science Maps' own map design.
// -----------------------------------------------------------------------------
// The map is drawn in the browser from vector data rather than shown as
// pre-made pictures, so every colour, road width and label below is a choice
// made here. The look is deliberately close to the familiar "big consumer map"
// look — pale land, light-blue water, soft green parks, white streets with a
// grey edge, warm yellow highways, dark grey labels with a white halo — because
// that is what reads best on a phone.
//
// What is and is not borrowed, so this stays on the right side of the line:
//   * The DATA is OpenStreetMap's (via OpenFreeMap's free, keyless hosting of
//     OpenMapTiles). It is licensed ODbL and needs the credit in ATTRIBUTION,
//     which the map always shows. No Google data or tiles are used at all.
//   * The DESIGN is ours. Colours and the general conventions of a street map
//     are not anyone's property; the actual artwork, icons, fonts and name of
//     any commercial map are, and none of them appear here.
// =============================================================================

export const TILE_SOURCE = "https://tiles.openfreemap.org/planet";
export const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

/** Shown in the corner of the map. Required by the licences of the data. */
export const ATTRIBUTION =
  '&copy; <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '&copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

// ---- palette ---------------------------------------------------------------
const COLOR = {
  land: "#f5f4f0",
  water: "#a8d2f2",
  waterLabel: "#4c7fbf",
  park: "#cbe7b6",
  wood: "#d5e9c3",
  grass: "#dcedca",
  sand: "#f1ebd8",
  building: "#edeae3",
  buildingEdge: "#e2ded5",
  text: "#3c4043",
  textSoft: "#5f6368",
  textFaint: "#80868b",
  halo: "#ffffff",
  boundary: "#b4b6bb",
};

// Label fonts must exist on the glyph server; these three do.
const REGULAR = ["Noto Sans Regular"];
const BOLD = ["Noto Sans Bold"];
const ITALIC = ["Noto Sans Italic"];

// Prefer the English name, then the Latin-script one, then whatever the map has.
const NAME = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]];

const NOTHING = "rgba(0,0,0,0)";
const SRC = "openmaptiles";

/** A value that changes smoothly with zoom: zoomed(4, 1, 10, 3) is 1 at z4, 3 at z10. */
const zoomed = (...stops) => ["interpolate", ["exponential", 1.4], ["zoom"], ...stops];
/** Multiply the values (odd positions) of a stop list. */
const times = (stops, k) => stops.map((v, i) => (i % 2 ? v * k : v));
/** The same stops, each value widened for a road's outline. */
const outlined = (stops) => stops.map((v, i) => (i % 2 ? v + Math.max(0.8, v * 0.2) : v));

const isOneOf = (property, list) => ["match", ["get", property], list, true, false];

// ---- roads -----------------------------------------------------------------
// Ordered from the smallest street to the biggest, so bigger roads paint over
// smaller ones where they cross.
const ROADS = [
  { id: "service", classes: ["service", "track", "busway", "bus_guideway", "raceway"], minzoom: 14,
    fill: "#ffffff", casing: "#dedcd5", w: [14, 0.5, 16, 3, 19, 12] },
  { id: "minor", classes: ["minor"], minzoom: 12.5,
    fill: "#ffffff", casing: "#d8d6ce", w: [12.5, 0.5, 14, 2.5, 16, 7, 19, 20] },
  { id: "tertiary", classes: ["tertiary"], minzoom: 11,
    fill: "#ffffff", casing: "#d4d2ca", w: [11, 0.6, 14, 3.5, 16, 9, 19, 24] },
  { id: "secondary", classes: ["secondary"], minzoom: 9,
    fill: "#fffbe8", casing: "#d6d0bb", w: [9, 0.6, 12, 2, 14, 4.5, 16, 11, 19, 28] },
  { id: "primary", classes: ["primary"], minzoom: 7, ramps: true,
    fill: "#fff0b4", casing: "#dfc06c", w: [7, 0.6, 10, 1.6, 12, 3, 14, 5.5, 16, 13, 19, 32] },
  { id: "trunk", classes: ["trunk"], minzoom: 5, ramps: true,
    fill: "#ffdf88", casing: "#e3a83f", w: [5, 0.5, 8, 1, 10, 2, 12, 3.4, 14, 6.5, 16, 14, 19, 34] },
  { id: "motorway", classes: ["motorway"], minzoom: 4, ramps: true,
    fill: "#fbc65d", casing: "#df992d", w: [4, 0.5, 8, 1.2, 10, 2.2, 12, 3.8, 14, 7, 16, 15, 19, 36] },
];

/** Roads as a stack of layers for one situation: on the ground, on a bridge
    or in a tunnel. Every outline goes down first, then every road surface, so
    that a junction reads as one shape rather than as a pile of boxes. */
function roadLayers(kind) {
  const layers = [];
  const where = kind === "road"
    ? ["match", ["get", "brunnel"], ["bridge", "tunnel"], false, true]
    : ["==", ["get", "brunnel"], kind];
  const variants = [];
  for (const r of ROADS) {
    variants.push({ r, ramp: false });
    if (r.ramps) variants.push({ r, ramp: true });
  }
  const filterFor = ({ r, ramp }) => ["all", isOneOf("class", r.classes), where,
    ramp ? ["==", ["get", "ramp"], 1] : ["!=", ["get", "ramp"], 1]];

  for (const v of variants) {
    const w = v.ramp ? times(v.r.w, 0.55) : v.r.w;
    layers.push({
      id: `${kind}-${v.r.id}${v.ramp ? "-ramp" : ""}-casing`,
      type: "line", source: SRC, "source-layer": "transportation",
      minzoom: v.ramp ? v.r.minzoom + 1.5 : v.r.minzoom,
      filter: filterFor(v),
      layout: { "line-cap": kind === "tunnel" ? "butt" : "round", "line-join": "round" },
      paint: {
        "line-color": kind === "bridge" ? "#b9b5aa" : v.r.casing,
        "line-width": zoomed(...outlined(kind === "bridge" ? w.map((n, i) => (i % 2 ? n + 1.2 : n)) : w)),
        ...(kind === "tunnel" ? { "line-dasharray": [2, 1.4], "line-opacity": 0.7 } : {}),
      },
    });
  }
  for (const v of variants) {
    const w = v.ramp ? times(v.r.w, 0.55) : v.r.w;
    layers.push({
      id: `${kind}-${v.r.id}${v.ramp ? "-ramp" : ""}`,
      type: "line", source: SRC, "source-layer": "transportation",
      minzoom: v.ramp ? v.r.minzoom + 1.5 : v.r.minzoom,
      filter: filterFor(v),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": v.r.fill,
        "line-width": zoomed(...w),
        ...(kind === "tunnel" ? { "line-opacity": 0.55 } : {}),
      },
    });
  }
  return layers;
}

// ---- points of interest ----------------------------------------------------
// One colour per kind of place, the way a printed map colour-codes them. Each
// kind also gets a small round marker, drawn by us (see registerMarkers), so a
// marker and its name are one symbol and always appear or vanish together.
const POI_KINDS = [
  { kind: "food", color: "#e8710a",
    classes: ["restaurant", "fast_food", "cafe", "bar", "pub", "ice_cream", "bakery", "food_court", "biergarten"] },
  { kind: "shop", color: "#1a73e8",
    classes: ["shop", "grocery", "supermarket", "clothing_store", "department_store", "jewelry", "furniture", "florist",
      "convenience", "mall", "butcher", "alcohol_shop", "bicycle", "hairdresser", "laundry", "marketplace", "car"] },
  { kind: "stay", color: "#d6409f", classes: ["lodging", "campsite", "hostel", "hotel"] },
  { kind: "health", color: "#d93025", classes: ["hospital", "pharmacy", "doctor", "dentist", "veterinary", "clinic"] },
  { kind: "green", color: "#188038",
    classes: ["park", "garden", "dog_park", "playground", "pitch", "golf", "stadium", "swimming", "zoo", "picnic_site"] },
  { kind: "sight", color: "#0e9aa7",
    classes: ["museum", "attraction", "monument", "theatre", "cinema", "library", "art_gallery", "castle", "information"] },
  { kind: "travel", color: "#3b78e7",
    classes: ["bus", "railway", "airport", "harbor", "ferry_terminal", "bicycle_rental", "charging_station", "fuel", "parking"] },
];
const POI_OTHER = "#5f6368";
const kindMatch = (pick, fallback) => ["match", ["get", "class"],
  ...POI_KINDS.flatMap((k) => [k.classes, pick(k)]), fallback];
const POI_COLOR = kindMatch((k) => k.color, POI_OTHER);
const POI_ICON = kindMatch((k) => `poi-${k.kind}`, "poi-other");

/**
 * Give a MapLibre map the round markers the style asks for. MapLibre calls
 * "styleimagemissing" the first time a layer wants one it has not been given,
 * which is the moment to paint it: a coloured disc with a white ring, drawn at
 * double resolution so it stays crisp on phone screens.
 */
export function registerMarkers(glMap) {
  const colors = { other: POI_OTHER };
  for (const k of POI_KINDS) colors[k.kind] = k.color;
  glMap.on("styleimagemissing", (e) => {
    if (!e.id.startsWith("poi-")) return;
    const color = colors[e.id.slice(4)] || POI_OTHER;
    const size = 28, c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    g.beginPath(); g.arc(size / 2, size / 2, 11, 0, Math.PI * 2);
    g.fillStyle = "#ffffff"; g.fill();
    g.beginPath(); g.arc(size / 2, size / 2, 8.2, 0, Math.PI * 2);
    g.fillStyle = color; g.fill();
    g.beginPath(); g.arc(size / 2, size / 2, 2.6, 0, Math.PI * 2);
    g.fillStyle = "rgba(255,255,255,0.9)"; g.fill();
    glMap.addImage(e.id, g.getImageData(0, 0, size, size), { pixelRatio: 2 });
  });
}

function poiLayers() {
  const point = ["==", ["geometry-type"], "Point"];
  const tiers = [
    { id: "r1", minzoom: 15, rank: ["all", [">=", ["get", "rank"], 1], ["<", ["get", "rank"], 7]] },
    { id: "r7", minzoom: 16, rank: ["all", [">=", ["get", "rank"], 7], ["<", ["get", "rank"], 20]] },
    { id: "r20", minzoom: 17, rank: [">=", ["get", "rank"], 20] },
  ];
  const layers = [];
  for (const t of tiers) {
    layers.push({
      id: `poi-label-${t.id}`, type: "symbol", source: SRC, "source-layer": "poi",
      minzoom: t.minzoom, filter: ["all", point, t.rank, ["has", "name"]],
      layout: {
        // Marker and name are one symbol, so they appear or vanish together.
        "icon-image": POI_ICON, "icon-allow-overlap": false,
        "text-field": NAME, "text-font": REGULAR, "text-size": 11,
        "text-anchor": "top", "text-offset": [0, 0.9], "text-max-width": 7,
        "text-optional": true, "text-padding": 3, "symbol-sort-key": ["get", "rank"],
      },
      paint: { "text-color": POI_COLOR, "text-halo-color": COLOR.halo, "text-halo-width": 1.6 },
    });
  }
  return layers;
}

// ---- places (countries, cities, neighbourhoods) ----------------------------
function placeLabel(id, cls, extra) {
  return {
    id, type: "symbol", source: SRC, "source-layer": "place",
    filter: Array.isArray(cls) ? isOneOf("class", cls) : ["==", ["get", "class"], cls],
    ...extra.top,
    layout: {
      "text-field": NAME, "text-font": REGULAR, "text-max-width": 8, "symbol-sort-key": ["get", "rank"],
      ...extra.layout,
    },
    paint: { "text-color": COLOR.text, "text-halo-color": COLOR.halo, "text-halo-width": 1.8, ...extra.paint },
  };
}

// ---- the style -------------------------------------------------------------
export function buildStyle() {
  const layers = [
    { id: "background", type: "background", paint: { "background-color": COLOR.land } },

    // Land cover and use: kept faint, so the map reads as streets and water first.
    {
      id: "landcover", type: "fill", source: SRC, "source-layer": "landcover",
      paint: {
        "fill-color": ["match", ["get", "class"],
          "wood", COLOR.wood, "grass", COLOR.grass, "sand", COLOR.sand,
          "ice", "#ffffff", "wetland", "#d7ebdf", NOTHING],
        "fill-opacity": zoomed(3, 0.35, 10, 0.8),
      },
    },
    {
      id: "landuse", type: "fill", source: SRC, "source-layer": "landuse", minzoom: 8,
      paint: {
        "fill-color": ["match", ["get", "class"],
          ["retail", "commercial"], "#f2ecdf",
          "industrial", "#eceae4",
          "hospital", "#fbe6e4",
          ["school", "college", "university", "kindergarten"], "#f1ecdf",
          "cemetery", "#dcecd2",
          ["stadium", "pitch", "playground", "theme_park", "zoo"], "#d0e8c0",
          "railway", "#eeede9",
          NOTHING],
        "fill-opacity": zoomed(8, 0.4, 13, 1),
      },
    },
    {
      id: "park", type: "fill", source: SRC, "source-layer": "park",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": COLOR.park, "fill-opacity": zoomed(5, 0.35, 11, 1) },
    },

    // Water.
    { id: "water", type: "fill", source: SRC, "source-layer": "water", paint: { "fill-color": COLOR.water } },
    {
      id: "waterway", type: "line", source: SRC, "source-layer": "waterway", minzoom: 8,
      filter: ["match", ["get", "class"], ["river", "canal", "stream", "drain", "ditch"], true, false],
      layout: { "line-cap": "round" },
      paint: {
        "line-color": COLOR.water,
        "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 8, 0.5, 12, 1.4, 16, 4, 19, 10],
      },
    },

    // Airports.
    {
      id: "aeroway-area", type: "fill", source: SRC, "source-layer": "aeroway", minzoom: 10,
      filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#eceae6" },
    },
    {
      id: "aeroway-line", type: "line", source: SRC, "source-layer": "aeroway", minzoom: 10,
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": "#dedcd6",
        "line-width": zoomed(10, 1, 14, ["match", ["get", "class"], "runway", 6, 2], 18, ["match", ["get", "class"], "runway", 24, 8]),
      },
    },

    // Buildings.
    {
      id: "building", type: "fill", source: SRC, "source-layer": "building", minzoom: 14,
      paint: {
        "fill-color": COLOR.building, "fill-outline-color": COLOR.buildingEdge,
        "fill-opacity": zoomed(14, 0.5, 16, 1),
      },
    },

    // Boundaries under the roads.
    {
      id: "boundary-state", type: "line", source: SRC, "source-layer": "boundary", minzoom: 4, maxzoom: 12,
      filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
      paint: { "line-color": "#cfd0d4", "line-dasharray": [3, 2], "line-width": zoomed(4, 0.5, 10, 1.2) },
    },

    ...roadLayers("tunnel"),

    // Footpaths, rail and ferries.
    {
      id: "path", type: "line", source: SRC, "source-layer": "transportation", minzoom: 15,
      filter: ["all", ["==", ["get", "class"], "path"], ["match", ["get", "brunnel"], ["tunnel"], false, true]],
      layout: { "line-cap": "round" },
      paint: { "line-color": "#cbc7bd", "line-width": zoomed(15, 0.7, 19, 2.4), "line-dasharray": [2, 2] },
    },
    {
      id: "rail", type: "line", source: SRC, "source-layer": "transportation", minzoom: 10,
      filter: isOneOf("class", ["rail", "transit"]),
      paint: { "line-color": "#d3d3cf", "line-width": zoomed(10, 0.8, 16, 2.4) },
    },
    {
      id: "rail-ties", type: "line", source: SRC, "source-layer": "transportation", minzoom: 13,
      filter: isOneOf("class", ["rail", "transit"]),
      paint: { "line-color": "#ffffff", "line-width": zoomed(13, 0.5, 16, 1.5), "line-dasharray": [3, 3] },
    },
    {
      id: "ferry", type: "line", source: SRC, "source-layer": "transportation", minzoom: 8,
      filter: ["==", ["get", "class"], "ferry"],
      paint: { "line-color": "#86b4ef", "line-width": 1.2, "line-dasharray": [3, 3] },
    },

    ...roadLayers("road"),
    ...roadLayers("bridge"),

    // National borders sit above the roads so they are never lost under a highway.
    {
      id: "boundary-country", type: "line", source: SRC, "source-layer": "boundary", minzoom: 1,
      filter: ["all", ["<=", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
      layout: { "line-join": "round" },
      paint: { "line-color": COLOR.boundary, "line-dasharray": [4, 2.5], "line-width": zoomed(1, 0.6, 8, 1.6, 14, 2.4) },
    },

    // ---- labels ----
    {
      id: "water-label-line", type: "symbol", source: SRC, "source-layer": "water_name",
      filter: ["==", ["geometry-type"], "LineString"],
      layout: {
        "symbol-placement": "line", "text-field": NAME, "text-font": ITALIC,
        "text-size": 12, "text-letter-spacing": 0.08, "symbol-spacing": 380,
      },
      paint: { "text-color": COLOR.waterLabel, "text-halo-color": "rgba(255,255,255,0.6)", "text-halo-width": 1.4 },
    },
    {
      id: "water-label", type: "symbol", source: SRC, "source-layer": "water_name",
      filter: ["==", ["geometry-type"], "Point"],
      layout: {
        "text-field": NAME, "text-font": ITALIC, "text-size": zoomed(3, 11, 14, 14),
        "text-letter-spacing": 0.1, "text-max-width": 6,
      },
      paint: { "text-color": COLOR.waterLabel, "text-halo-color": "rgba(255,255,255,0.6)", "text-halo-width": 1.4 },
    },
    {
      id: "park-label", type: "symbol", source: SRC, "source-layer": "park", minzoom: 12,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "name"]],
      layout: { "text-field": NAME, "text-font": ITALIC, "text-size": zoomed(12, 10, 17, 13), "text-max-width": 7 },
      paint: { "text-color": "#2e7d32", "text-halo-color": COLOR.halo, "text-halo-width": 1.6 },
    },
    {
      id: "road-label-major", type: "symbol", source: SRC, "source-layer": "transportation_name", minzoom: 11,
      filter: isOneOf("class", ["motorway", "trunk", "primary", "secondary"]),
      layout: {
        "symbol-placement": "line", "text-field": ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"], ["get", "ref"]],
        "text-font": REGULAR, "text-size": zoomed(11, 10, 16, 12.5, 19, 15), "symbol-spacing": 330,
        "text-letter-spacing": 0.02,
      },
      paint: { "text-color": COLOR.textSoft, "text-halo-color": COLOR.halo, "text-halo-width": 2 },
    },
    {
      id: "road-label-minor", type: "symbol", source: SRC, "source-layer": "transportation_name", minzoom: 14.5,
      filter: isOneOf("class", ["tertiary", "minor", "service", "track", "path"]),
      layout: {
        "symbol-placement": "line", "text-field": NAME, "text-font": REGULAR,
        "text-size": zoomed(14.5, 10, 19, 14), "symbol-spacing": 280,
      },
      paint: { "text-color": COLOR.textSoft, "text-halo-color": COLOR.halo, "text-halo-width": 2 },
    },
    {
      id: "housenumber", type: "symbol", source: SRC, "source-layer": "housenumber", minzoom: 18,
      layout: { "text-field": ["get", "housenumber"], "text-font": REGULAR, "text-size": 10 },
      paint: { "text-color": COLOR.textFaint, "text-halo-color": COLOR.halo, "text-halo-width": 1.2 },
    },
    {
      id: "peak", type: "symbol", source: SRC, "source-layer": "mountain_peak", minzoom: 11,
      filter: ["has", "name"],
      layout: { "text-field": NAME, "text-font": REGULAR, "text-size": 11, "text-anchor": "top", "text-offset": [0, 0.4] },
      paint: { "text-color": "#8a6d4e", "text-halo-color": COLOR.halo, "text-halo-width": 1.6 },
    },

    ...poiLayers(),
    {
      id: "poi-transit", type: "symbol", source: SRC, "source-layer": "poi", minzoom: 15,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["match", ["get", "class"], ["railway", "airport"], true, false], ["has", "name"]],
      layout: {
        "text-field": NAME, "text-font": REGULAR, "text-size": 11, "text-anchor": "left",
        "text-offset": [0.9, 0], "text-max-width": 8, "symbol-sort-key": ["get", "rank"],
      },
      paint: { "text-color": "#3b78e7", "text-halo-color": COLOR.halo, "text-halo-width": 1.6 },
    },
    {
      id: "airport-label", type: "symbol", source: SRC, "source-layer": "aerodrome_label", minzoom: 9,
      filter: ["has", "name"],
      layout: { "text-field": NAME, "text-font": REGULAR, "text-size": 11, "text-max-width": 7 },
      paint: { "text-color": "#3b78e7", "text-halo-color": COLOR.halo, "text-halo-width": 1.6 },
    },

    // Places, biggest last so they win any collision.
    placeLabel("place-neighbourhood", ["neighbourhood", "quarter", "isolated_dwelling"], {
      top: { minzoom: 14 },
      layout: { "text-size": zoomed(14, 10, 18, 13), "text-transform": "uppercase", "text-letter-spacing": 0.08, "text-font": REGULAR },
      paint: { "text-color": COLOR.textFaint },
    }),
    placeLabel("place-suburb", ["suburb", "hamlet"], {
      top: { minzoom: 11 },
      layout: { "text-size": zoomed(11, 10, 16, 14) },
      paint: { "text-color": COLOR.textSoft },
    }),
    placeLabel("place-village", "village", {
      top: { minzoom: 9 },
      layout: { "text-size": zoomed(9, 10, 14, 14) },
      paint: { "text-color": COLOR.textSoft },
    }),
    placeLabel("place-town", "town", {
      top: { minzoom: 6 },
      layout: { "text-size": zoomed(6, 11, 12, 16), "text-font": BOLD },
    }),
    placeLabel("place-island", ["island"], {
      top: { minzoom: 7 },
      layout: { "text-size": zoomed(7, 10, 14, 14), "text-font": ITALIC },
      paint: { "text-color": COLOR.textSoft },
    }),
    placeLabel("place-city", "city", {
      top: { minzoom: 3 },
      layout: {
        "text-size": ["interpolate", ["linear"], ["zoom"], 3, 11, 8, 15, 12, 20],
        "text-font": BOLD,
      },
    }),
    placeLabel("place-state", "state", {
      top: { minzoom: 4, maxzoom: 9 },
      layout: {
        "text-size": zoomed(4, 10, 8, 13), "text-transform": "uppercase",
        "text-letter-spacing": 0.12, "text-font": REGULAR,
      },
      paint: { "text-color": COLOR.textFaint },
    }),
    placeLabel("place-country", "country", {
      top: { minzoom: 1, maxzoom: 9 },
      layout: {
        "text-size": zoomed(1, 10, 4, 13, 8, 18), "text-transform": "uppercase",
        "text-letter-spacing": 0.12, "text-font": BOLD,
      },
      paint: { "text-color": COLOR.textSoft },
    }),
  ];

  return {
    version: 8,
    name: "Science Maps",
    sources: { [SRC]: { type: "vector", url: TILE_SOURCE } },
    glyphs: GLYPHS,
    layers,
  };
}
