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
export const ATTRIBUTION_OVERTURE = ATTRIBUTION +
  ' &copy; <a href="https://docs.overturemaps.org/attribution" target="_blank" rel="noopener">Overture Maps Foundation</a>';

// ---- palette ---------------------------------------------------------------
const COLOR = {
  land: "#f5f5f5",
  water: "#90daee",
  waterLabel: "#5b8fc9",
  park: "#c4f0d4",
  wood: "#cdf5dc",
  grass: "#d6f7e3",
  sand: "#f6eee6",
  building: "#e9e9ea",
  buildingEdge: "#dcdcde",
  text: "#3c4043",
  textSoft: "#5f6368",
  textFaint: "#80868b",
  halo: "#ffffff",
  boundary: "#a8adb8",
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
  { id: "service", classes: ["service", "track", "busway", "bus_guideway", "raceway"], minzoom: 13.2,
    fill: "#ffffff", casing: "#d3d6db", w: [13.2, 0.5, 15, 1.6, 16, 3, 19, 12] },
  { id: "minor", classes: ["minor"], minzoom: 11,
    fill: "#ffffff", casing: "#cdd1d6", w: [11, 0.5, 12.5, 1.1, 14, 2.6, 16, 7, 19, 20] },
  { id: "tertiary", classes: ["tertiary"], minzoom: 9.5,
    fill: "#ffffff", casing: "#c4c9cf", w: [9.5, 0.5, 11, 1, 12.5, 2, 14, 3.8, 16, 9, 19, 24] },
  { id: "secondary", classes: ["secondary"], minzoom: 9,
    fill: "#ffffff", casing: "#bcc2ca", w: [9, 0.6, 12, 2, 14, 4.5, 16, 11, 19, 28] },
  { id: "primary", classes: ["primary"], minzoom: 7, ramps: true,
    fill: "#a9bfd8", casing: "#8b9db4", w: [7, 0.6, 10, 1.6, 12, 3, 14, 5.5, 16, 13, 19, 32] },
  { id: "trunk", classes: ["trunk"], minzoom: 5, ramps: true,
    fill: "#94acc8", casing: "#7c90a8", w: [5, 0.5, 8, 1, 10, 2, 12, 3.4, 14, 6.5, 16, 14, 19, 34] },
  { id: "motorway", classes: ["motorway"], minzoom: 4, ramps: true,
    fill: "#94acc8", casing: "#7c90a8", w: [4, 0.5, 8, 1.2, 10, 2.2, 12, 3.8, 14, 7, 16, 15, 19, 36] },
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

  /* A small white picture in the middle of each disc — a fork, a bag, a bed, a
     cross, a tree, a star, a bus — so a marker says what it is before you read
     it. Each is a handful of strokes on a 0-24 grid centred on the disc. */
  const glyphs = {
    food(g) {                                          // fork and knife
      g.lineWidth = 1.6; g.beginPath();
      g.moveTo(-3.4, -5); g.lineTo(-3.4, -0.6); g.moveTo(-1.5, -5); g.lineTo(-1.5, -0.6);
      g.moveTo(-5.3, -5); g.lineTo(-5.3, -0.6);
      g.moveTo(-3.4, -0.6); g.lineTo(-3.4, 5.5);
      g.moveTo(3, 5.5); g.lineTo(3, -5); g.quadraticCurveTo(5.4, -2.5, 3.6, 0.6); g.lineTo(3, 0.6);
      g.stroke();
    },
    shop(g) {                                          // shopping bag
      g.lineWidth = 1.6; g.beginPath();
      g.rect(-4.6, -2, 9.2, 7.4); g.moveTo(-2.2, -2); g.quadraticCurveTo(-2.2, -5.6, 0, -5.6);
      g.quadraticCurveTo(2.2, -5.6, 2.2, -2); g.stroke();
    },
    stay(g) {                                          // bed
      g.lineWidth = 1.6; g.beginPath();
      g.moveTo(-5.5, -4); g.lineTo(-5.5, 5); g.moveTo(-5.5, 2.4); g.lineTo(5.5, 2.4); g.lineTo(5.5, 5);
      g.moveTo(-5.5, 0); g.lineTo(5.5, 0); g.lineTo(5.5, 2.4); g.stroke();
      g.beginPath(); g.arc(-3, -1.6, 1.3, 0, Math.PI * 2); g.fill();
    },
    health(g) {                                        // cross
      g.fillRect(-1.7, -5.6, 3.4, 11.2); g.fillRect(-5.6, -1.7, 11.2, 3.4);
    },
    green(g) {                                         // tree
      g.beginPath(); g.moveTo(0, -6); g.lineTo(4.8, 1.2); g.lineTo(-4.8, 1.2); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(0, -2.6); g.lineTo(5.6, 4); g.lineTo(-5.6, 4); g.closePath(); g.fill();
      g.fillRect(-0.9, 3.5, 1.8, 3);
    },
    sight(g) {                                         // star
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 2.7 : 6.2, a = -Math.PI / 2 + (i * Math.PI) / 5;
        g[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath(); g.fill();
    },
    travel(g) {                                        // bus
      g.lineWidth = 1.6; g.beginPath();
      g.rect(-4.6, -5.4, 9.2, 9); g.moveTo(-4.6, 0.4); g.lineTo(4.6, 0.4); g.stroke();
      g.beginPath(); g.arc(-2.6, 2.2, 0.9, 0, 7); g.arc(2.6, 2.2, 0.9, 0, 7); g.fill();
      g.fillRect(-3.4, 4.6, 1.8, 1.6); g.fillRect(1.6, 4.6, 1.8, 1.6);
    },
    other(g) { g.beginPath(); g.arc(0, 0, 2.8, 0, Math.PI * 2); g.fill(); },
  };

  glMap.on("styleimagemissing", (e) => {
    if (e.id.startsWith("shield-")) { addShield(glMap, e.id); return; }
    if (!e.id.startsWith("poi-")) return;
    const kind = e.id.slice(4), color = colors[kind] || POI_OTHER;
    const size = 40, mid = size / 2, c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    g.beginPath(); g.arc(mid, mid, 17, 0, Math.PI * 2);           // soft shadow
    g.fillStyle = "rgba(60,64,67,0.28)"; g.fill();
    g.beginPath(); g.arc(mid, mid - 0.6, 16, 0, Math.PI * 2);      // the coloured disc
    g.fillStyle = color; g.fill();
    g.save(); g.translate(mid, mid - 0.6); g.scale(1.25, 1.25);
    g.fillStyle = "#ffffff"; g.strokeStyle = "#ffffff"; g.lineCap = "round"; g.lineJoin = "round";
    (glyphs[kind] || glyphs.other)(g);
    g.restore();
    glMap.addImage(e.id, g.getImageData(0, 0, size, size), { pixelRatio: 2 });
  });
}

/** A road-number plaque: a rounded box that stretches to fit the number written
    on it. Interstates get a blue one, every other numbered road a white one. */
function addShield(glMap, id) {
  const interstate = id === "shield-interstate";
  const size = 40, c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const box = (inset, radius) => {
    g.beginPath();
    g.roundRect(inset, inset, size - inset * 2, size - inset * 2, radius);
  };
  box(2, 12); g.fillStyle = interstate ? "#ffffff" : "#7c90a8"; g.fill();       // outline
  box(4.5, 10); g.fillStyle = interstate ? "#3d5ea8" : "#ffffff"; g.fill();     // face
  glMap.addImage(id, g.getImageData(0, 0, size, size), {
    pixelRatio: 2, stretchX: [[14, 26]], stretchY: [[14, 26]], content: [10, 10, 30, 30],
  });
}

function poiLayers(ov) {
  // With Overture drawing the businesses, OpenStreetMap only supplies the places
  // a business list would not have: parks, sights and transport.
  const point = ov
    ? ["all", ["==", ["geometry-type"], "Point"], isOneOf("class", POI_KINDS.filter((k) => ["green", "sight", "travel"].includes(k.kind)).flatMap((k) => k.classes))]
    : ["==", ["geometry-type"], "Point"];
  const tiers = [
    { id: "r1", minzoom: 12.5, rank: ["all", [">=", ["get", "rank"], 1], ["<", ["get", "rank"], 7]] },
    { id: "r7", minzoom: 13.6, rank: ["all", [">=", ["get", "rank"], 7], ["<", ["get", "rank"], 20]] },
    { id: "r20", minzoom: 14.8, rank: [">=", ["get", "rank"], 20] },
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
        "text-anchor": "top", "text-offset": [0, 1.35], "text-max-width": 7,
        "text-optional": true, "text-padding": 3, "symbol-sort-key": ["get", "rank"],
      },
      paint: { "text-color": POI_COLOR, "text-halo-color": COLOR.halo, "text-halo-width": 1.6 },
    });
  }
  if (ov) {
    // Overture's businesses only exist from about street-block zoom, so until
    // then the big everyday landmarks — hospitals, hotels, colleges, stadiums
    // and shopping centres — come from OpenStreetMap, from much further out.
    // They hand over to Overture where its labels start, so nothing doubles up.
    layers.push({
      id: "poi-label-early", type: "symbol", source: SRC, "source-layer": "poi",
      minzoom: 12.5, maxzoom: 14,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "name"], ["<", ["get", "rank"], 7],
        ["any", isOneOf("class", ["hospital", "lodging", "college", "stadium"]),
          isOneOf("subclass", ["mall", "department_store"])]],
      layout: {
        "icon-image": POI_ICON, "icon-allow-overlap": false,
        "text-field": NAME, "text-font": REGULAR, "text-size": 11,
        "text-anchor": "top", "text-offset": [0, 1.35], "text-max-width": 7,
        "text-optional": true, "text-padding": 3, "symbol-sort-key": ["get", "rank"],
      },
      paint: { "text-color": POI_COLOR, "text-halo-color": COLOR.halo, "text-halo-width": 1.6 },
    });
  }
  return layers;
}

// ---- Overture Maps: satellite land cover and real businesses -----------------
// OpenStreetMap is the backbone, but two things Google shows are thin in it:
// natural ground (bare lakebed, scrub, wetland — what the land is actually
// covered by, seen from space) and everyday businesses. Overture Maps publishes
// both openly: land cover derived from satellite data, and ~60 million places
// merged from several sources. Each theme is one file read a slice at a time
// straight from Overture's own storage (PMTiles), so there is nothing to host.
//
// Data licences: base data is ODbL (as OpenStreetMap), places are CDLA-Permissive
// 2.0 — both need credit, which ATTRIBUTION carries. Overture publishes a new
// release every month and keeps only recent ones, so if these files ever
// disappear the map quietly falls back to OpenStreetMap alone.
export const OVERTURE_RELEASE = "2026-08-19.0";
const OVERTURE = `https://overturemaps-extras-us-west-2.s3.amazonaws.com/tiles/${OVERTURE_RELEASE}`;

const OV_KINDS = {
  food: ["restaurant", "casual_eatery", "coffee_shop", "fast_food_restaurant", "bar", "food_truck_stand", "smoothie_juice_bar",
    "winery", "bakery", "ice_cream_shop", "brewery", "dessert_shop", "pub", "cafe", "pizza_restaurant", "bar_and_grill"],
  shop: ["convenience_store", "discount_store", "department_store", "fashion_and_apparel_store", "hardware_home_and_garden_store",
    "electronics_store", "food_and_beverage_store", "specialty_store", "arts_crafts_and_hobby_store", "sporting_goods_store",
    "books_music_and_video_store", "flowers_and_gifts_store", "animal_and_pet_store", "toys_and_games_store", "second_hand_store",
    "vehicle_parts_store", "musical_instrument_and_pro_audio_store", "personal_care_and_beauty_store", "shopping",
    "grocery_store", "supermarket", "shopping_mall", "furniture_store", "jewelry_store", "gift_shop"],
  stay: ["hotel", "motel", "hostel", "resort", "bed_and_breakfast", "lodging"],
  health: ["hospital", "pharmacy_and_drug_store", "dental_clinic", "primary_care_or_general_clinic", "urgent_care_clinic",
    "specialized_medical_facility", "vision_or_eye_care_clinic", "pediatric_clinic", "pharmacy"],
  green: ["park", "sport_field", "swimming_pool", "amusement_park", "campground", "zoo", "golf_course", "sport_court", "playground"],
  sight: ["museum", "monument", "historic_site", "performing_arts_venue", "music_venue", "library", "event_venue",
    "christian_place_of_worship", "place_of_worship", "art_gallery", "cinema", "movie_theater", "attraction"],
  travel: ["gas_station", "train_station", "airport", "bus_station", "ev_charging_station", "parking"],
  other: ["elementary_school", "high_school", "preschool", "college_university", "place_of_learning", "bank_or_credit_union",
    "atm", "courthouse", "police_station", "government_office", "fire_station", "post_office", "gym", "fitness_studio",
    "sport_or_fitness_facility", "auto_dealer", "campus_building"],
};
// What deserves to be seen first as you zoom in, and what waits until you are close.
const OV_FIRST = ["hospital", "hotel", "museum", "college_university", "amusement_park", "department_store", "train_station",
  "airport", "park", "zoo", "library", "courthouse", "police_station", "fire_station", "shopping_mall", "resort"];
const OV_LAST = ["dental_clinic", "primary_care_or_general_clinic", "specialized_medical_facility", "vision_or_eye_care_clinic",
  "pediatric_clinic", "gym", "fitness_studio", "sport_or_fitness_facility", "arts_crafts_and_hobby_store",
  "musical_instrument_and_pro_audio_store", "toys_and_games_store", "second_hand_store", "vehicle_parts_store",
  "personal_care_and_beauty_store", "books_music_and_video_store", "animal_and_pet_store", "flowers_and_gifts_store",
  "specialty_store", "sport_field", "sport_court", "swimming_pool", "christian_place_of_worship", "place_of_worship",
  "event_venue", "auto_dealer", "campus_building", "preschool", "place_of_learning", "government_office", "post_office",
  "gift_shop", "jewelry_store", "furniture_store", "playground", "music_venue", "performing_arts_venue"];
const OV_ALL = Object.values(OV_KINDS).flat();
const OV_CATEGORY = ["get", "basic_category"];
const ovKindMatch = (pick, fallback) => ["match", OV_CATEGORY,
  ...Object.entries(OV_KINDS).flatMap(([kind, list]) => [list, pick(kind)]), fallback];
const KIND_COLOR = Object.fromEntries(POI_KINDS.map((k) => [k.kind, k.color]));
KIND_COLOR.other = POI_OTHER;

function overturePlaceLayers() {
  const tiers = [
    { id: "first", minzoom: 14, filter: isOneOf("basic_category", OV_FIRST) },
    { id: "middle", minzoom: 14.15, filter: ["all", isOneOf("basic_category", OV_ALL),
      ["!", isOneOf("basic_category", OV_FIRST)], ["!", isOneOf("basic_category", OV_LAST)]] },
    { id: "last", minzoom: 14.5, filter: isOneOf("basic_category", OV_LAST) },
  ];
  return tiers.map((t) => ({
    id: `ov-place-${t.id}`, type: "symbol", source: "ovplaces", "source-layer": "place", minzoom: t.minzoom,
    filter: ["all", t.filter, ["has", "@name"], [">=", ["get", "confidence"], 0.55]],
    layout: {
      "icon-image": ovKindMatch((kind) => `poi-${kind}`, "poi-other"), "icon-allow-overlap": false,
      "text-field": ["get", "@name"], "text-font": REGULAR, "text-size": 11,
      "text-anchor": "top", "text-offset": [0, 1.35], "text-max-width": 7,
      "text-optional": true, "text-padding": 3,
      "symbol-sort-key": ["-", 1, ["get", "confidence"]],       // the surest first
    },
    paint: {
      "text-color": ovKindMatch((kind) => KIND_COLOR[kind], POI_OTHER),
      "text-halo-color": COLOR.halo, "text-halo-width": 1.6,
    },
  }));
}

/** Satellite-derived ground cover, drawn over the low-detail version once you are zoomed in. */
function overtureLandCover() {
  return {
    id: "ov-landcover", type: "fill", source: "ovbase", "source-layer": "land_cover", minzoom: 8,
    paint: {
      "fill-color": ["match", ["get", "subtype"],
        "barren", COLOR.sand,
        ["grass", "shrub", "moss"], "#dcf6e6",
        "wetland", "#d0eee6",
        ["forest", "mangrove"], "#c9f0d8",
        "snow", "#ffffff",
        NOTHING],
      "fill-opacity": zoomed(8, 0.4, 11, 1),
    },
  };
}

/** House numbers from the National Address Database, via Overture: small grey
    numbers that appear once you are zoomed right in, one per address, and each
    one can be clicked to pin that address. */
function overtureAddressLayer() {
  return {
    id: "ov-address", type: "symbol", source: "ovaddr", "source-layer": "address", minzoom: 17,
    filter: ["has", "number"],
    layout: {
      "text-field": ["get", "number"], "text-font": REGULAR,
      "text-size": zoomed(17, 10, 19.5, 13), "text-padding": 3,
    },
    paint: { "text-color": "#5f6368", "text-halo-color": COLOR.halo, "text-halo-width": 1.3 },
  };
}

/** Every layer whose labels can be clicked to select what they name. */
export const CLICKABLE_LAYERS = [
  "ov-place-first", "ov-place-middle", "ov-place-last", "ov-address",
  "poi-label-early", "poi-label-r1", "poi-label-r7", "poi-label-r20", "poi-transit", "housenumber",
  // the map's own names: places, parks, water, peaks, airports and roads
  "place-neighbourhood", "place-suburb", "place-village", "place-town", "place-island", "place-city",
  "place-state", "place-country", "park-label", "water-label", "water-label-line", "peak", "airport-label",
  "road-label-major", "road-label-minor",
];

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

// ---- the satellite overlay -------------------------------------------------
// Over satellite pictures the map is only what a picture cannot say: names,
// faint road lines, borders and the place markers. Every filled shape (land,
// water, buildings) is dropped so the photograph shows through, and the words
// turn white with a soft dark edge so they read on forest and on sand alike.
const SAT_TEXT = { "water-label": "#bfdcff", "water-label-line": "#bfdcff", "park-label": "#c9f2cb", peak: "#f3dcc0" };

function satelliteOverlay(layers) {
  const drawn = (kind) => ["all", isOneOf("class", kind), ["match", ["get", "brunnel"], ["tunnel"], false, true]];
  const roads = (id, kind, minzoom, alpha, widths) => ({
    id, type: "line", source: SRC, "source-layer": "transportation", minzoom, filter: drawn(kind),
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": `rgba(255,255,255,${alpha})`, "line-width": zoomed(...widths) },
  });
  const borders = layers
    .filter((l) => l.id.startsWith("boundary"))
    .map((l) => ({ ...l, paint: { ...l.paint, "line-color": "rgba(255,255,255,0.7)" } }));
  const words = layers
    .filter((l) => l.type === "symbol")
    .map((l) => (l.id === "road-shield" ? l : {
      ...l,
      paint: {
        ...l.paint,
        "text-color": SAT_TEXT[l.id] || "#ffffff",
        "text-halo-color": "rgba(0,0,0,0.7)", "text-halo-width": 1.5, "text-halo-blur": 0.6,
      },
    }));
  return [
    roads("sat-street", ["minor", "service", "tertiary"], 13.5, 0.4, [13.5, 0.6, 16, 2, 19, 6]),
    roads("sat-road", ["secondary", "primary"], 9, 0.55, [9, 0.6, 12, 1.4, 16, 4, 19, 9]),
    roads("sat-highway", ["motorway", "trunk"], 6, 0.75, [6, 0.6, 10, 1.6, 14, 3.4, 19, 10]),
    ...borders,
    ...words,
  ];
}

// ---- the style -------------------------------------------------------------
export function buildStyle(options = {}) {
  const ov = !!options.overture;   // also draw Overture land cover and businesses
  const layers = [
    { id: "background", type: "background", paint: { "background-color": COLOR.land } },

    // Land cover and use: kept faint, so the map reads as streets and water first.
    {
      id: "landcover", type: "fill", source: SRC, "source-layer": "landcover",
      ...(ov ? { maxzoom: 9 } : {}),
      paint: {
        "fill-color": ["match", ["get", "class"],
          "wood", COLOR.wood, "grass", COLOR.grass, "sand", COLOR.sand,
          "ice", "#ffffff", "wetland", "#d7ebdf", NOTHING],
        "fill-opacity": zoomed(3, 0.5, 9, 1),
      },
    },
    ...(ov ? [overtureLandCover()] : []),
    {
      id: "landuse", type: "fill", source: SRC, "source-layer": "landuse", minzoom: 8,
      paint: {
        "fill-color": ["match", ["get", "class"],
          ["retail", "commercial"], "#f9f0dc",
          ["industrial", "military", "quarry", "garages"], "#e2e2e6",
          "hospital", "#fde8e6",
          ["school", "college", "university", "kindergarten"], "#f1ecdf",
          "cemetery", "#c4f0d4",
          ["stadium", "pitch", "playground", "theme_park", "zoo"], "#c4f0d4",
          "railway", "#eeeeee",
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
      filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#e0e0e4" },
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
      id: "road-shield", type: "symbol", source: SRC, "source-layer": "transportation_name", minzoom: 9,
      filter: ["all", isOneOf("class", ["motorway", "trunk", "primary"]), ["has", "ref"], ["<=", ["get", "ref_length"], 5]],
      layout: {
        "symbol-placement": "line", "symbol-spacing": 480,
        "icon-image": ["match", ["get", "network"], "us-interstate", "shield-interstate", "shield-road"],
        "icon-text-fit": "both", "icon-text-fit-padding": [1, 4, 1, 4],
        "icon-rotation-alignment": "viewport", "text-rotation-alignment": "viewport",
        "text-field": ["get", "ref"], "text-font": BOLD, "text-size": 10, "text-padding": 4,
      },
      paint: { "text-color": ["match", ["get", "network"], "us-interstate", "#ffffff", COLOR.text] },
    },
    ...(ov ? [overtureAddressLayer()] : [{
      id: "housenumber", type: "symbol", source: SRC, "source-layer": "housenumber", minzoom: 18,
      layout: { "text-field": ["get", "housenumber"], "text-font": REGULAR, "text-size": 10 },
      paint: { "text-color": COLOR.textFaint, "text-halo-color": COLOR.halo, "text-halo-width": 1.2 },
    }]),
    {
      id: "peak", type: "symbol", source: SRC, "source-layer": "mountain_peak", minzoom: 11,
      filter: ["has", "name"],
      layout: { "text-field": NAME, "text-font": REGULAR, "text-size": 11, "text-anchor": "top", "text-offset": [0, 0.4] },
      paint: { "text-color": "#8a6d4e", "text-halo-color": COLOR.halo, "text-halo-width": 1.6 },
    },

    ...poiLayers(ov),
    ...(ov ? overturePlaceLayers() : []),
    {
      id: "poi-transit", type: "symbol", source: SRC, "source-layer": "poi", minzoom: 13.5,
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
      layout: { "text-size": zoomed(11, 9.5, 16, 12.5), "text-transform": "uppercase", "text-letter-spacing": 0.1 },
      paint: { "text-color": COLOR.textFaint },
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
    sources: {
      [SRC]: { type: "vector", url: TILE_SOURCE },
      ...(ov ? {
        ovbase: { type: "vector", url: `pmtiles://${OVERTURE}/base.pmtiles` },
        ovplaces: { type: "vector", url: `pmtiles://${OVERTURE}/places.pmtiles` },
        ovaddr: { type: "vector", url: `pmtiles://${OVERTURE}/addresses.pmtiles` },
      } : {}),
    },
    glyphs: GLYPHS,
    layers: options.satellite ? satelliteOverlay(layers) : layers,
  };
}
