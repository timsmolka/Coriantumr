// =============================================================================
// places.js — turning map features and searches into "places", and remembering
// the ones you have used.
// -----------------------------------------------------------------------------
// Pure helpers only (no DOM, no map): they take plain data in and hand plain
// data back, so they are easy to read and to test. app.js does the wiring.
//
// A "place" is:
//   { kind: "place" | "address" | "search", name, detail, lat, lon, category? }
// where `name` is the headline, `detail` the quiet second line.
// =============================================================================

export const RECENTS_KEY = "sciencemaps.recents";
export const MAX_RECENTS = 12;

// ---- wording ---------------------------------------------------------------

/** Words for the category codes the map data uses. Anything not listed is
    tidied up automatically ("coffee_shop" becomes "Coffee shop"). */
const CATEGORY_WORDS = {
  fast_food_restaurant: "Fast food",
  casual_eatery: "Casual eatery",
  pharmacy_and_drug_store: "Pharmacy",
  bank_or_credit_union: "Bank",
  hardware_home_and_garden_store: "Hardware & garden store",
  fashion_and_apparel_store: "Clothing store",
  food_and_beverage_store: "Food & drink store",
  primary_care_or_general_clinic: "Clinic",
  specialized_medical_facility: "Medical facility",
  sport_or_fitness_facility: "Fitness facility",
  christian_place_of_worship: "Church",
  college_university: "College",
  elementary_school: "Elementary school",
  gas_station: "Gas station",
  fuel: "Gas station",
  atm: "ATM",
};

/** "coffee_shop" -> "Coffee shop". */
export function prettyCategory(raw) {
  if (!raw) return "";
  if (CATEGORY_WORDS[raw]) return CATEGORY_WORDS[raw];
  const words = String(raw).replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Address data often arrives in SHOUTING CAPITALS ("GLASMANN Way"). Soften
    long shouted words to ordinary capitals and leave short ones alone, so "NW"
    and "N" survive but "OGDEN" becomes "Ogden". */
export function softCase(text) {
  return String(text || "")
    .split(/(\s+)/)
    .map((word) => {
      const shouted = word === word.toUpperCase() && /[A-Z]{3,}/.test(word);
      return shouted ? word.charAt(0) + word.slice(1).toLowerCase() : word;
    })
    .join("")
    .trim();
}

// ---- reading map data -------------------------------------------------------

/** Parse a JSON field that the tiles store as text; never throws. */
function parseJson(value) {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

/** The first web address in a stored list, if it is a real http(s) one. Never
    returns anything else — a link from outside data must not be able to run code. */
export function firstWebsite(raw) {
  const list = parseJson(raw);
  const url = Array.isArray(list) ? list.find((u) => typeof u === "string" && /^https?:\/\//i.test(u)) : null;
  return url || "";
}

/** The first phone number in a stored list, tidied for display. */
export function firstPhone(raw) {
  const list = parseJson(raw);
  const phone = Array.isArray(list) ? list.find((p) => typeof p === "string" && /\d{7,}/.test(p)) : null;
  return phone ? String(phone).trim() : "";
}

/** "320 W 1550 N, Layton, UT 84041" from a business's stored address list. */
export function businessAddress(rawAddresses) {
  const list = parseJson(rawAddresses);
  const a = Array.isArray(list) ? list[0] : null;
  if (!a) return "";
  const cityLine = [a.locality, [a.region, a.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.freeform, cityLine].filter(Boolean).join(", ");
}

/** The two lines for a street address feature: "4763 Glasmann Way" and
    "Ogden, UT 84403". The region hides in a small list of administrative levels. */
export function addressLines(props) {
  const number = String(props.number || "").trim();
  const street = softCase(props.street);
  const unit = props.unit ? ` #${props.unit}` : "";
  const levels = parseJson(props.address_levels);
  const region = Array.isArray(levels) && levels[0] ? String(levels[0].value || "") : "";
  const city = softCase(props.postal_city);
  const tail = [city, [region, props.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return { name: [number, street].filter(Boolean).join(" ") + unit, detail: tail };
}

/**
 * Turn one feature from the map (as returned by MapLibre's queryRenderedFeatures
 * or querySourceFeatures) into a place, or null if it is not one.
 */
export function placeFromFeature(feature) {
  if (!feature || !feature.geometry || feature.geometry.type !== "Point") return null;
  const [lon, lat] = feature.geometry.coordinates;
  const p = feature.properties || {};
  const layer = (feature.layer && feature.layer.id) || feature.sourceLayer || "";

  if (layer === "ov-address" || layer === "address") {
    const { name, detail } = addressLines(p);
    if (!name) return null;
    return { kind: "address", name, address: [name, detail].filter(Boolean).join(", "), detail, lat, lon };
  }
  if (layer.startsWith("ov-place") || layer === "place") {
    const name = p["@name"];
    if (!name) return null;
    const category = prettyCategory(p.basic_category);
    const address = businessAddress(p.addresses);
    return {
      kind: "place", name, category, address, lat, lon, rawCategory: p.basic_category || "",
      detail: [category, address].filter(Boolean).join(" · "),
      website: firstWebsite(p.websites), phone: firstPhone(p.phones),
    };
  }
  if (layer.startsWith("poi-label") || layer === "poi") {           // OpenStreetMap places
    const name = p["name:en"] || p.name;
    if (!name) return null;
    const category = prettyCategory(p.class);
    return { kind: "place", name, category, detail: category, lat, lon, rawCategory: p.class || "" };
  }
  return null;
}

// ---- searching what is already on the map -------------------------------------

const clean = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Pick the places whose name matches what was typed, best matches first: names
 * that start with the text, then names that contain it. Duplicates (the same
 * name in nearly the same spot, which happens across tile edges) are dropped.
 */
export function matchPlaces(places, query, limit = 5) {
  const q = clean(query);
  if (q.length < 2) return [];
  const scored = [];
  const seen = new Set();
  for (const place of places) {
    const key = `${clean(place.name)}|${place.lat.toFixed(4)}|${place.lon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = clean(place.name);
    const at = name.indexOf(q);
    if (at < 0) continue;
    scored.push({ place, rank: at === 0 ? 0 : name.split(" ").some((w) => w.startsWith(q)) ? 1 : 2 });
  }
  scored.sort((a, b) => a.rank - b.rank || a.place.name.length - b.place.name.length);
  return scored.slice(0, limit).map((s) => s.place);
}

/** True for text that starts like a street address ("320 W 1550 N"). */
export function looksLikeAddress(text) {
  return /^\s*\d+[a-z]?\s+\S+/i.test(String(text || ""));
}

// ---- recent searches ----------------------------------------------------------

/** localStorage can be missing or blocked (private windows, some embeds), so
    every use is wrapped: a failure means "no history", never a broken page. */
function store(storage) {
  try {
    return storage || globalThis.localStorage || null;
  } catch (err) {
    return null;
  }
}

const recentKey = (r) => `${clean(r.name)}|${Number(r.lat).toFixed(4)}|${Number(r.lon).toFixed(4)}`;

export function loadRecents(storage) {
  const s = store(storage);
  if (!s) return [];
  try {
    const list = JSON.parse(s.getItem(RECENTS_KEY) || "[]");
    return Array.isArray(list)
      ? list.filter((r) => r && r.name && Number.isFinite(r.lat) && Number.isFinite(r.lon)).slice(0, MAX_RECENTS)
      : [];
  } catch (err) {
    return [];
  }
}

function saveAll(list, storage) {
  const s = store(storage);
  if (!s) return;
  try {
    s.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch (err) {
    /* full or blocked: the history just is not kept */
  }
}

/** Remember a place, newest first. Using the same place again moves it to the
    top instead of listing it twice. Returns the updated list. */
export function addRecent(place, storage, now = Date.now()) {
  if (!place || !place.name || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return loadRecents(storage);
  const entry = {
    kind: place.kind || "search", name: place.name, detail: place.detail || "",
    category: place.category || "", lat: place.lat, lon: place.lon, savedAt: now,
    address: place.address || "", website: place.website || "", phone: place.phone || "",
  };
  const key = recentKey(entry);
  const list = [entry, ...loadRecents(storage).filter((r) => recentKey(r) !== key)].slice(0, MAX_RECENTS);
  saveAll(list, storage);
  return list;
}

export function removeRecent(place, storage) {
  const key = recentKey(place);
  const list = loadRecents(storage).filter((r) => recentKey(r) !== key);
  saveAll(list, storage);
  return list;
}

export function clearRecents(storage) {
  saveAll([], storage);
  return [];
}

/** The recents that match what is being typed (all of them when nothing is). */
export function filterRecents(recents, query) {
  const q = clean(query);
  if (!q) return recents;
  return recents.filter((r) => clean(`${r.name} ${r.detail}`).includes(q));
}

// ---- explore: category buttons ("Restaurants", "Pharmacies", ...) ----------------
// Each names the category codes (from Overture's business list) and the codes
// OpenStreetMap uses for the same thing, so one button can search both.

export const CATEGORIES = [
  { id: "restaurants", label: "Restaurants", icon: "🍴",
    codes: ["restaurant", "casual_eatery", "fast_food_restaurant", "pizza_restaurant", "bar_and_grill", "food_truck_stand"],
    osm: ["restaurant", "fast_food", "food_court"] },
  { id: "coffee", label: "Coffee", icon: "☕",
    codes: ["coffee_shop", "cafe", "smoothie_juice_bar", "bakery", "ice_cream_shop", "dessert_shop"],
    osm: ["cafe", "bakery", "ice_cream"] },
  { id: "hotels", label: "Hotels", icon: "🛏️",
    codes: ["hotel", "motel", "resort", "hostel", "bed_and_breakfast", "lodging"],
    osm: ["lodging", "hotel", "hostel", "campsite"] },
  { id: "things", label: "Things to do", icon: "📷",
    codes: ["museum", "monument", "historic_site", "attraction", "amusement_park", "zoo", "park", "performing_arts_venue", "music_venue", "art_gallery", "cinema", "movie_theater"],
    osm: ["attraction", "museum", "monument", "zoo", "park", "theatre", "cinema", "art_gallery", "castle", "garden"] },
  { id: "museums", label: "Museums", icon: "🏛️",
    codes: ["museum", "art_gallery"], osm: ["museum", "art_gallery"] },
  { id: "transit", label: "Transit", icon: "🚌",
    codes: ["train_station", "bus_station", "airport"], osm: ["bus", "railway", "airport", "ferry_terminal"] },
  { id: "pharmacies", label: "Pharmacies", icon: "💊",
    codes: ["pharmacy_and_drug_store", "pharmacy"], osm: ["pharmacy"] },
  { id: "atms", label: "ATMs", icon: "🏧",
    codes: ["atm", "bank_or_credit_union"], osm: ["atm", "bank"] },
  { id: "gas", label: "Gas", icon: "⛽",
    codes: ["gas_station", "ev_charging_station"], osm: ["fuel", "charging_station"] },
  { id: "groceries", label: "Groceries", icon: "🛒",
    codes: ["grocery_store", "supermarket", "food_and_beverage_store", "convenience_store", "discount_store", "department_store"],
    osm: ["grocery", "supermarket", "convenience", "department_store"] },
  { id: "health", label: "Health", icon: "🏥",
    codes: ["hospital", "urgent_care_clinic", "primary_care_or_general_clinic", "dental_clinic", "specialized_medical_facility"],
    osm: ["hospital", "doctor", "dentist", "clinic"] },
  { id: "parks", label: "Parks", icon: "🌳",
    codes: ["park", "sport_field", "playground", "campground", "golf_course", "swimming_pool"],
    osm: ["park", "garden", "playground", "dog_park", "golf", "pitch", "swimming", "picnic_site"] },
];

/** Does this place (as read from the map) belong to this category? */
export function matchesCategory(place, category) {
  const code = place.rawCategory || "";
  return category.codes.includes(code) || category.osm.includes(code);
}

/** The emoji that stands for a place in a list: its category's, or a plain pin. */
export function placeIcon(place) {
  if (place.kind === "address") return "🏠";
  if (place.kind === "dropped") return "📍";
  const cat = CATEGORIES.find((c) => matchesCategory(place, c));
  return cat ? cat.icon : "📍";
}

/** Sort places by how far they are from a point, nearest first, and attach the
    distance. `distance` is a function (a, b) -> metres. */
export function nearestFirst(places, from, distance) {
  return places
    .map((p) => ({ ...p, away: distance(from, p) }))
    .sort((a, b) => a.away - b.away);
}

// ---- saved places -------------------------------------------------------------

export const SAVED_KEY = "sciencemaps.saved";

const savedKeyOf = (p) => `${clean(p.name)}|${Number(p.lat).toFixed(4)}|${Number(p.lon).toFixed(4)}`;

function readList(key, storage) {
  const s = store(storage);
  if (!s) return [];
  try {
    const list = JSON.parse(s.getItem(key) || "[]");
    return Array.isArray(list) ? list.filter((r) => r && r.name && Number.isFinite(r.lat) && Number.isFinite(r.lon)) : [];
  } catch (err) {
    return [];
  }
}

export function loadSaved(storage) { return readList(SAVED_KEY, storage); }

export function isSaved(place, storage) {
  const key = savedKeyOf(place);
  return loadSaved(storage).some((r) => savedKeyOf(r) === key);
}

/** Save the place, or un-save it if it already is. Returns whether it is saved now. */
export function toggleSaved(place, storage) {
  const list = loadSaved(storage);
  const key = savedKeyOf(place);
  const have = list.some((r) => savedKeyOf(r) === key);
  const next = have
    ? list.filter((r) => savedKeyOf(r) !== key)
    : [{
      kind: place.kind || "search", name: place.name, detail: place.detail || "", category: place.category || "",
      lat: place.lat, lon: place.lon, address: place.address || "", website: place.website || "", phone: place.phone || "",
      rawCategory: place.rawCategory || "", savedAt: Date.now(),
    }, ...list];
  const s = store(storage);
  if (s) {
    try { s.setItem(SAVED_KEY, JSON.stringify(next)); } catch (err) { /* not kept */ }
  }
  return !have;
}

// ---- share links -----------------------------------------------------------------

/** A page link's "#place=lat,lon,Name" part for a place; opening it shows the place. */
export function placeToHash(place) {
  return `#place=${Number(place.lat).toFixed(6)},${Number(place.lon).toFixed(6)},${encodeURIComponent(place.name || "")}`;
}

/** The place a "#place=..." part names, or null if it is anything else. */
export function placeFromHash(hash) {
  const m = /^#place=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),?(.*)$/.exec(String(hash || ""));
  if (!m) return null;
  const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  let name = "";
  try { name = decodeURIComponent(m[3] || ""); } catch (err) { name = ""; }
  return { kind: name ? "search" : "dropped", name: name || "Dropped pin", lat, lon };
}
