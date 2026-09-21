// =============================================================================
// app.js — the UI "brain" that wires Science Maps together
// -----------------------------------------------------------------------------
// This is the only file that touches the page (the DOM) and the map. It imports
// the pure "engine" modules (distance/speed/atmosphere/units/facts/services)
// and uses them to turn user actions into on-screen numbers.
//
// HOW IT IS ORGANIZED (read top-to-bottom like a story):
//   1. Imports — pull in the engines + constants.
//   2. State   — ONE plain object holding everything the UI needs to know.
//   3. Helpers — tiny utilities (DOM lookup, formatting durations, debounce).
//   4. Map     — set up Leaflet, markers, the route line.
//   5. Actions — geolocation, search, routing, weather, live speed tracking.
//   6. render() — the SINGLE function that redraws the dashboard from `state`.
//   7. Wiring  — connect buttons/inputs to actions, then start the app.
//
// THE GOLDEN RULE: actions change `state`, then call render(). render() never
// changes state. This one-way flow keeps the app predictable and easy to read.
// =============================================================================


// -----------------------------------------------------------------------------
// 1. IMPORTS
// -----------------------------------------------------------------------------
import {
  DISTANCE_UNITS,
  formatDistance,
  distanceInAllUnits,
} from "./distance.js";

import {
  SPEED_UNITS,
  formatSpeed,
  speedInAllUnits,
} from "./speed.js";

import {
  ISA_SEA_LEVEL_SOUND,
  describeSpeedOfSound,
} from "./atmosphere.js";

import {
  smartDistanceUnit,
  familiarDistanceUnit,
  smartSpeedUnit,
  familiarSpeedUnit,
} from "./units.js";

import { distanceFact, speedFact } from "./facts.js";

import {
  buildStyle,
  registerMarkers,
  ATTRIBUTION,
  ATTRIBUTION_OVERTURE,
  CLICKABLE_LAYERS,
} from "./mapstyle.js";

import {
  placeFromFeature,
  matchPlaces,
  looksLikeAddress,
  loadRecents,
  addRecent,
  removeRecent,
  clearRecents,
  filterRecents,
  prettyCategory,
  CATEGORIES,
  matchesCategory,
  placeIcon,
  nearestFirst,
  loadSaved,
  isSaved,
  toggleSaved,
  placeToHash,
  placeFromHash,
} from "./places.js";

import {
  distanceMeters,
  distanceToRoute,
  advanceStep,
  hasArrived,
  remaining,
  arrivalClock,
  shortDuration,
  arrowFor,
  nextTurnDistance,
} from "./navigation.js";

import {
  geocode,
  reverseGeocode,
  route,
  getWeather,
} from "./services.js";


// The exact speed of light (m/s). Used for the "light travel time" readout.
const SPEED_OF_LIGHT = 299792458;


// -----------------------------------------------------------------------------
// 2. STATE — the single source of truth for the whole UI
// -----------------------------------------------------------------------------
// Every piece of information the dashboard needs lives here. When something
// changes (a new route, new weather, a new speed, a unit choice), we update
// this object and then call render(). Nothing else stores "truth".
const state = {
  // The two endpoints of a journey. Each is { lat, lon, label } or null.
  origin: null,
  destination: null,

  // The most recent route result from services.route(), or null.
  // Shape: { distanceMeters, durationSeconds, geometry, steps, ... }
  routeData: null,

  // The most recent weather reading from services.getWeather(), or null.
  weather: null,

  // The local speed of sound (m/s) computed from `weather`. Defaults to the
  // ISA sea-level value until we have live weather.
  speedOfSound: ISA_SEA_LEVEL_SOUND,

  // A short sentence explaining what the speed-of-sound value is based on.
  speedOfSoundBasis: "ISA standard sea-level (15 C), no live data",

  // The user's current speed in m/s (from GPS), or null if not tracking.
  currentSpeedMps: null,

  // Are we currently watching the GPS position for live speed? (toggle state)
  tracking: false,

  // The browser's geolocation watch id, so we can stop watching later.
  watchId: null,

  // The previous tracked position, used to estimate speed when the browser
  // does not provide coords.speed directly. { lat, lon, timestamp } or null.
  lastFix: null,

  // Which travel mode the user picked ('driving' | 'walking' | 'cycling').
  travelMode: "driving",

  // UNIT PREFERENCES.
  distanceUnit: "lms", // default scientific distance unit: light-milliseconds
  speedUnit: "mach", // default scientific speed unit: Mach
  smartMode: false, // when true, ignore the two selects above and auto-pick

  // THE PICK-A-PLACE FLOW (like Google Maps): click a place -> its card ->
  // Directions -> Start. Each step is a separate thing you have to ask for.
  selected: null, // a place that has been clicked but not asked directions to yet
  pendingStart: false, // "Start" was pressed before the route had arrived
  navigating: false, // following the route, turn by turn?
  navNext: 1, // index of the next manoeuvre (steps[0] is "head out")
  voice: false, // speak the directions aloud

  // WHERE YOU ARE. The browser reports a position and how much it doubts it.
  locationAccuracy: null, // metres of doubt in the blue dot, or null
  locationManual: false, // the user dragged the dot to where they really are

  // WHAT THE SIDE PANEL IS SHOWING (see renderMode).
  tab: null, // "saved" | "recents" | "science": opened from the left rail
  category: null, // a CATEGORIES entry while "Restaurants" and the like are being browsed
  categoryResults: null, // its places, nearest first, or null while searching
  searchFor: "destination", // what the search box is choosing: "destination", "origin" or "edit" (replace the destination)
  layerMode: "default", // "default" | "satellite" | "terrain"
  routes: [], // every route found for the trip (the first is the fastest)
  routeIndex: 0, // which of them is chosen
};


// -----------------------------------------------------------------------------
// 3. SMALL HELPERS
// -----------------------------------------------------------------------------

/**
 * Short alias for document.getElementById — we look up a LOT of elements.
 * @param {string} id - the element id (without the '#')
 * @returns {HTMLElement|null}
 */
function el(id) {
  return document.getElementById(id);
}

/**
 * Turn a duration in seconds into a friendly string for the route's travel
 * time, e.g. "1 hr 23 min" or "12 min" or "45 s".
 * @param {number} seconds
 * @returns {string}
 */
function formatTravelTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";

  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 1) return `${Math.round(seconds)} s`;
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

/**
 * Turn a duration in seconds into a compact physics-style string for the
 * light/sound travel-time readouts. Picks microseconds/milliseconds/seconds/
 * minutes/hours so the number stays readable.
 * @param {number} seconds
 * @returns {string}
 */
function formatPhysicsTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";

  if (seconds < 1e-3) return `${(seconds * 1e6).toFixed(1)} µs`; // microseconds
  if (seconds < 1) return `${(seconds * 1e3).toFixed(1)} ms`; // milliseconds
  if (seconds < 60) return `${seconds.toFixed(2)} s`; // seconds
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`; // minutes
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} hr`; // hours
  return `${(seconds / 86400).toFixed(1)} days`;
}

/**
 * A "debounce" wrapper: returns a function that, no matter how often it is
 * called, only actually runs `fn` once things have been quiet for `delayMs`.
 * We use this so we don't fire a search request on every keystroke.
 * @param {Function} fn - the function to debounce
 * @param {number} delayMs - how long to wait after the last call
 * @returns {Function}
 */
function debounce(fn, delayMs) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delayMs);
  };
}

/**
 * Show a friendly message in the map status line. Pass isError=true to style
 * it as an error. Pass an empty message to hide the line entirely.
 * @param {string} message
 * @param {boolean} [isError=false]
 */
function setMapStatus(message, isError = false) {
  const node = el("map-status");
  if (!node) return;

  if (!message) {
    node.hidden = true;
    node.textContent = "";
    node.classList.remove("error");
    return;
  }

  node.hidden = false;
  node.textContent = message;
  node.classList.toggle("error", isError);
}


// -----------------------------------------------------------------------------
// 4. THE MAP
// -----------------------------------------------------------------------------
// These variables hold the live Leaflet objects. They are module-level (not in
// `state`) because they are not "data to display" — they are the map itself.
let map = null; // the Leaflet map instance
let originMarker = null; // marker for the start point
let destinationMarker = null; // marker for the destination
let routeLine = null; // the polyline drawn along the route
let accuracyCircle = null; // the pale ring showing how sure the blue dot is
let vectorLayer = null; // our own map, drawn from vector data (null if this browser cannot)
let pictureLayer = null; // the ready-made picture map used when it cannot
let imageryLayer = null; // satellite pictures, when asked for
let topoLayer = null; // terrain map, when asked for
let labelsLayer = null; // place names drawn over the satellite pictures
let categoryDots = null; // the dots marking a category's results on the map
let categoryCenter = null; // where the map was looking when the category was searched
let glMap = null; // the vector map drawing underneath Leaflet (null on the picture fallback)

/**
 * Draw the map itself: our own style (js/mapstyle.js) rendered in the browser
 * from OpenStreetMap vector data. If this browser cannot do that — no WebGL,
 * or the libraries or the tile server could not be reached — fall back to a
 * ready-made picture map so there is always something to look at.
 */
function addBasemap() {
  const canUseVector = (() => {
    try {
      if (typeof maplibregl === "undefined" || typeof L.maplibreGL !== "function") return false;
      const probe = document.createElement("canvas");
      return !!(probe.getContext("webgl2") || probe.getContext("webgl"));
    } catch (err) {
      return false;
    }
  })();

  if (!canUseVector) {
    addPictureBasemap();
    return;
  }

  // Overture Maps adds satellite land cover and real businesses on top of
  // OpenStreetMap. It needs the PMTiles reader; without it, OpenStreetMap alone.
  const overture = typeof pmtiles !== "undefined";
  if (overture) maplibregl.addProtocol("pmtiles", new pmtiles.Protocol().tile);

  const vector = L.maplibreGL({
    style: buildStyle({ overture }),
    attribution: overture ? ATTRIBUTION_OVERTURE : ATTRIBUTION,
  });
  vector.addTo(map);
  vectorLayer = vector;

  // If the main map data cannot be had (tile server down, blocked network),
  // swap in the picture map rather than leaving an empty grey rectangle. One
  // stray error is not enough — a single tile can fail while the rest load —
  // so this waits a few seconds and only gives up if nothing ever arrived.
  const inner = vector.getMaplibreMap();
  glMap = inner;
  registerMarkers(inner); // draws our own round place markers on demand

  let mainDataArrived = false;
  inner.on("sourcedata", (event) => {
    if (event.sourceId === "openmaptiles" && event.isSourceLoaded) mainDataArrived = true;
  });
  let checking = false;
  inner.on("error", (event) => {
    // Only the main map data (or the style itself) failing means there is no
    // map. If the extras from Overture are unreachable, carry on without them.
    if (event.sourceId && event.sourceId !== "openmaptiles") return;
    if (checking) return;
    checking = true;
    setTimeout(() => {
      if (mainDataArrived || inner.isSourceLoaded("openmaptiles") || !map.hasLayer(vector)) return;
      map.removeLayer(vector);
      vectorLayer = null;
      glMap = null;
      addPictureBasemap();
    }, 8000);
  });
}


/**
 * The fallback basemap: Esri's "World Street Map", free and keyless. Its path
 * orders y before x, unlike the {z}/{x}/{y} most tile servers use — that is
 * not a typo. (This used to be CARTO's basemap until CARTO began requiring an
 * API key.) The attribution is required and must stay visible.
 */
function addPictureBasemap() {
  pictureLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    {
      attribution:
        "&copy; OpenStreetMap contributors — Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ",
      maxZoom: 19,
    }
  ).addTo(map);
}

/**
 * Create the Leaflet map, add the basemap (keeping the required attribution),
 * and let the user click the map to set a destination.
 */
function initMap() {
  // Start with a gentle world view (centered roughly on the Atlantic) so the
  // map looks sensible before we know where the user is.
  map = L.map("map", {
    center: [20, 0],
    zoom: 3,
    minZoom: 2,
    maxZoom: 19, // a vector layer has no limit of its own, so say it here
    zoomControl: false, // we add our own zoom control in the bottom-right (Google-style)
    keyboard: false, // Leaflet's own arrow keys only work while the map has focus; see setupKeyboardMoves()
  });

  addBasemap();

  // Zoom buttons in the bottom-right corner, like Google Maps. The required
  // attribution keeps its default bottom-right spot — the bottom sheet sits at
  // the bottom-left, so it won't cover the credits.
  L.control.zoom({ position: "bottomright" }).addTo(map);

  // A scale bar, in miles and kilometres, beside the layers button.
  L.control.scale({ position: "bottomleft", maxWidth: 110 }).addTo(map);

  // Right-click for "What's here?", directions from or to the spot, and its coordinates.
  map.on("contextmenu", (event) => {
    if (state.navigating) return;
    event.originalEvent.preventDefault();
    showContextMenu(event.containerPoint, event.latlng);
  });
  map.on("movestart zoomstart click", hideContextMenu);

  // When a category is on screen and the map has been moved away from where it
  // was searched, offer to search the new place.
  map.on("moveend", () => {
    if (!state.category || !categoryCenter) return;
    const size = map.getSize();
    const moved = map.latLngToContainerPoint(categoryCenter);
    const far = Math.hypot(moved.x - size.x / 2, moved.y - size.y / 2) > size.x * 0.3;
    el("search-area").hidden = !far;
  });

  // Clicking a named place or a house number selects it as the destination;
  // clicking bare map drops a pin there. Either way it is a quick alternative
  // to typing a search query.
  map.on("click", (event) => {
    if (state.navigating) return;                 // a stray tap must not end a trip
    const place = placeAtPoint(event.latlng);
    if (place) {
      selectPlace(place);
      return;
    }
    // Bare map: drop a pin there and say what is under it.
    const { lat, lng } = event.latlng;
    showPlaceCard({ kind: "dropped", name: "Dropped pin", category: "Dropped pin", address: "", lat, lon: lng });
  });

  // A pointing hand over anything clickable, so it is obvious what is.
  map.on("mousemove", (event) => {
    map.getContainer().style.cursor = placeAtPoint(event.latlng) ? "pointer" : "";
  });
}

/**
 * The named place or house number under a spot on the map, or null. Looks a few
 * pixels around it, so a small label is easy to hit, and takes whichever label
 * is nearest. The vector map is drawn a little larger than the visible window
 * (so panning never shows an edge), which means its pixels are not Leaflet's
 * pixels — so the spot goes in as a latitude and longitude and is converted.
 * @param {{lat:number, lng:number}} latlng
 */
function placeAtPoint(latlng) {
  if (!glMap || !latlng || state.layerMode !== "default") return null;
  const point = glMap.project([latlng.lng, latlng.lat]);
  const layers = CLICKABLE_LAYERS.filter((id) => glMap.getLayer(id));
  if (!layers.length) return null;
  const pad = 14;
  const found = glMap.queryRenderedFeatures(
    [[point.x - pad, point.y - pad], [point.x + pad, point.y + pad]],
    { layers }
  );
  let best = null;
  let bestDistance = Infinity;
  for (const feature of found) {
    const place = placeFromFeature(feature);
    if (!place) continue;
    const at = glMap.project([place.lon, place.lat]);
    const distance = Math.hypot(at.x - point.x, at.y - point.y);
    if (distance < bestDistance) {
      best = place;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Choose a place — from the map, a search result or the recent list — as the
 * destination: remember it, show its name in the search box, and (when it came
 * from a search, so it may be off screen) bring it into view.
 * @param {{kind:string, name:string, detail?:string, lat:number, lon:number}} place
 * @param {{show?: boolean}} [options] show: move the map to it
 */
function selectPlace(place, { show = false, keepCategory = false } = {}) {
  el("search-results").hidden = true;

  // "Your location" chosen from the start-point list.
  if (place.kind === "here") {
    endChoosing();
    state.locationManual = false;
    useMyLocation();
    return;
  }
  // The search box is choosing a starting point: that is all it does.
  if (state.searchFor === "origin") {
    endChoosing();
    chooseOrigin(place);
    return;
  }
  const replacing = state.searchFor === "edit";
  endChoosing();

  addRecent(place);
  el("search-input").value = place.name;
  if (show) {
    const broad = ["city", "town", "village", "hamlet", "suburb", "administrative", "state", "county", "country", "island", "peak", "lake", "bay"];
    const zoom = place.kind === "address" ? 18 : broad.includes(place.placeType) ? 12 : 17;
    map.setView([place.lat, place.lon], Math.max(map.getZoom(), zoom));
  }
  if (replacing) {
    state.selected = place;                               // change the destination of the trip in front of you
    getDirections();
  } else {
    if (!keepCategory) clearCategory();      // from a list of results, the list stays behind the card
    showPlaceCard(place);
  }
}

/**
 * A small popup body built from plain text, never HTML — place names come from
 * outside and must not be able to inject anything.
 * @param {string} title
 * @param {string} [detail]
 * @param {{label:string, onClick:Function}} [action]
 */
function popupNode(title, detail, action) {
  const box = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = title;
  box.appendChild(strong);
  if (detail) {
    const line = document.createElement("div");
    line.className = "popup-detail";
    line.textContent = detail;
    box.appendChild(line);
  }
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "popup-action";
    button.textContent = action.label;
    button.addEventListener("click", action.onClick);
    box.appendChild(button);
  }
  return box;
}

/**
 * Place (or move) the ORIGIN marker on the map.
 * @param {number} lat
 * @param {number} lon
 * @param {string} label - a popup label
 */
function placeOriginMarker(lat, lon, label, accuracy) {
  // A Google-style blue "you are here" dot, drawn purely with CSS (see .gm-here).
  const icon = L.divIcon({
    className: "gm-here-icon",
    html: '<span class="gm-here"></span>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
  if (originMarker) {
    originMarker.setLatLng([lat, lon]);
  } else {
    // Draggable, so if the browser's idea of where you are is a few houses off
    // (a computer has no GPS, only Wi-Fi and network guesses) you can put the
    // dot on your actual spot.
    originMarker = L.marker([lat, lon], { icon, title: "You are here", draggable: true, zIndexOffset: 500 }).addTo(map);
    originMarker.on("drag", () => {
      if (accuracyCircle) accuracyCircle.setLatLng(originMarker.getLatLng());
    });
    originMarker.on("dragend", onOriginDragged);
  }
  const doubt = Number.isFinite(accuracy) ? `Accurate to about ${Math.round(accuracy)} m. ` : "";
  originMarker.bindPopup(popupNode(label, `${doubt}Not right? Drag the dot to where you really are.`));

  // The ring is the browser's own admission of how far off it might be.
  if (Number.isFinite(accuracy) && accuracy > 8 && !state.locationManual) {
    if (accuracyCircle) {
      accuracyCircle.setLatLng([lat, lon]).setRadius(accuracy);
    } else {
      accuracyCircle = L.circle([lat, lon], {
        radius: accuracy, color: "#1a73e8", weight: 1, fillColor: "#1a73e8", fillOpacity: 0.12, interactive: false,
      }).addTo(map);
    }
  } else if (accuracyCircle) {
    accuracyCircle.remove();
    accuracyCircle = null;
  }
}

/**
 * Place (or move) the DESTINATION marker on the map.
 * @param {number} lat
 * @param {number} lon
 * @param {string} label - a popup label
 */
function placeDestinationMarker(lat, lon) {
  // A Google-style red map pin, drawn as an inline SVG so it needs no image file.
  const icon = L.divIcon({
    className: "gm-pin-icon",
    html:
      '<svg width="26" height="38" viewBox="0 0 26 38" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M13 0C5.82 0 0 5.82 0 13c0 9.5 13 25 13 25s13-15.5 13-25C26 5.82 20.18 0 13 0z" fill="#ea4335"/>' +
      '<circle cx="13" cy="13" r="5" fill="#fff"/></svg>',
    iconSize: [26, 38],
    iconAnchor: [13, 38],
  });
  if (destinationMarker) {
    destinationMarker.setLatLng([lat, lon]);
  } else {
    destinationMarker = L.marker([lat, lon], { icon, title: "Destination" }).addTo(map);
  }
}

/**
 * Draw the route polyline from a list of {lat, lon} points, replacing any
 * existing line, and zoom the map to fit the whole route.
 * @param {Array<{lat:number, lon:number}>} geometry
 */
function drawRoute(geometry, { fit = true } = {}) {
  // Remove the previous line if there was one.
  if (routeLine) {
    routeLine.remove();
    routeLine = null;
  }

  // Leaflet wants [lat, lon] pairs; our geometry is {lat, lon} objects.
  const latLngs = geometry.map((point) => [point.lat, point.lon]);

  // Draw the route as TWO stacked lines for the Google-Maps look: a wide white
  // "casing" underneath, then the blue route on top of it.
  const casing = L.polyline(latLngs, {
    color: "#ffffff",
    weight: 9,
    opacity: 1,
    lineJoin: "round",
    lineCap: "round",
  });
  const line = L.polyline(latLngs, {
    color: "#1a73e8", // Google blue
    weight: 6,
    opacity: 1,
    lineJoin: "round",
    lineCap: "round",
  });
  routeLine = L.layerGroup([casing, line]).addTo(map);

  // Fit the map view to the whole route, with a little padding.
  // (Not while navigating: the map is following you then, not the whole route.)
  // The left edge is kept clear of the trip sheet on wide screens.
  if (fit) {
    const wide = window.innerWidth > 720;
    map.fitBounds(line.getBounds(), { paddingTopLeft: [wide ? 460 : 40, 90], paddingBottomRight: [40, wide ? 40 : 260] });
  }
}


// -----------------------------------------------------------------------------
// 5. ACTIONS — things the user (or the browser) can trigger
// -----------------------------------------------------------------------------

/**
 * "Use my location": ask the browser for the user's position, then use it as
 * the origin, fetch weather for it, and (if a destination exists) re-route.
 */
function useMyLocation() {
  // Geolocation may not exist in very old browsers.
  if (!("geolocation" in navigator)) {
    setMapStatus("Your browser does not support geolocation.", true);
    return;
  }

  // Pressing this is asking to be found again: forget any hand-placed dot.
  state.locationManual = false;
  locatingMessage = true;
  setMapStatus("Locating you…");
  startLocationWatch();

  // Go to the last spot straight away; the live fix will refine it.
  if (state.origin) {
    map.setView([state.origin.lat, state.origin.lon], Math.max(map.getZoom(), 16));
  }
  // One direct reading as well, in case the watch is slow to report.
  navigator.geolocation.getCurrentPosition(onLocationFix, onLocationError, {
    enableHighAccuracy: true,
    timeout: 12000,
  });
}

// --- KNOWING WHERE YOU ARE -----------------------------------------------------
// The page finds you as soon as it opens (the browser asks permission the first
// time), keeps the blue dot up to date, and remembers the last spot so the map
// opens where you were rather than on the whole world.

const LASTFIX_KEY = "sciencemaps.lastfix";
let locationWatchId = null;
let liveFixSeen = false; // has a real reading arrived yet, as opposed to the remembered one?
let locatingMessage = false; // is "Locating you…" up, to be cleared by the next fix?

function loadLastFix() {
  try {
    const fix = JSON.parse(localStorage.getItem(LASTFIX_KEY) || "null");
    return fix && Number.isFinite(fix.lat) && Number.isFinite(fix.lon) ? fix : null;
  } catch (err) {
    return null;
  }
}
function saveLastFix(fix) {
  try {
    localStorage.setItem(LASTFIX_KEY, JSON.stringify(fix));
  } catch (err) {
    /* storage full or blocked: the map just opens on the world next time */
  }
}

/** Called once at start-up: open where you last were, then find where you are now. */
function locateOnStart() {
  const last = loadLastFix();
  if (last) {
    state.origin = { lat: last.lat, lon: last.lon, label: "Your location", stale: true };
    placeOriginMarker(last.lat, last.lon, "Your last known location", last.accuracy);
    map.setView([last.lat, last.lon], 15, { animate: false });
  }
  if (!("geolocation" in navigator)) return;
  // Ask only if the person has not already said no.
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: "geolocation" }).then(
      (status) => { if (status.state !== "denied") startLocationWatch(); },
      () => startLocationWatch()
    );
  } else {
    startLocationWatch();
  }
}

function startLocationWatch() {
  if (!("geolocation" in navigator) || locationWatchId !== null) return;
  locationWatchId = navigator.geolocation.watchPosition(onLocationFix, onLocationError, {
    enableHighAccuracy: true, // a phone uses GPS; a computer just asks for its best guess
    maximumAge: 5000,
    timeout: 30000,
  });
}

function onLocationError(error) {
  if (error.code === error.PERMISSION_DENIED) {
    setMapStatus("Location is turned off for this page — allow it in your browser to see where you are.", true);
    if (locationWatchId !== null) navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  } else if (locatingMessage) {
    setMapStatus("Could not find you just yet — still trying.", true);
  }
}

/** A new position reading arrived. */
async function onLocationFix(position) {
  const { latitude: lat, longitude: lon, accuracy } = position.coords;
  if (locatingMessage) { locatingMessage = false; setMapStatus(""); }

  // Someone who dragged the dot to their real spot has already said where they
  // are; the browser's guess must not yank it back — unless they are driving.
  if (state.locationManual && !state.navigating) return;

  saveLastFix({ lat, lon, accuracy });
  const first = !liveFixSeen;
  liveFixSeen = true;

  // A vaguer reading than the one we have, from nearly the same spot, is noise.
  if (!first && state.origin && state.locationAccuracy && accuracy > state.locationAccuracy * 1.5) {
    const drift = distanceMeters(state.origin, { lat, lon });
    if (drift < state.locationAccuracy) return;
  }

  const moved = state.origin ? distanceMeters(state.origin, { lat, lon }) : Infinity;
  const wasStale = Boolean(state.origin && state.origin.stale);
  state.locationAccuracy = accuracy;
  state.origin = { lat, lon, label: "Your location" };
  placeOriginMarker(lat, lon, "Your location", accuracy);

  // Weather and route only need refreshing when you have really gone somewhere.
  if (first || moved > 250) {
    loadWeather(lat, lon).then(render);
    if (state.destination && !state.navigating) requestRoute();
  }
  // The first reading brings the map to you — unless you are already looking at something.
  if (first && !state.selected && !state.destination) {
    map.setView([lat, lon], Math.max(map.getZoom(), 16), { animate: !wasStale });
  }
  if (state.navigating) navProgress({ lat, lon });
  render();
}

/** The blue dot was dragged: that is now where you are. */
async function onOriginDragged() {
  const { lat, lng } = originMarker.getLatLng();
  state.locationManual = true;
  state.locationAccuracy = null;
  if (accuracyCircle) { accuracyCircle.remove(); accuracyCircle = null; }
  state.origin = { lat, lon: lng, label: "Your location (set by hand)" };
  saveLastFix({ lat, lon: lng, accuracy: 0 });
  if (state.destination) requestRoute();
  render();
  loadWeather(lat, lng).then(render);
  try {
    const where = await reverseGeocode(lat, lng);
    if (state.locationManual && state.origin && state.origin.lat === lat) {
      state.origin.label = `Near ${where.shortAddress}`;
      render();
    }
  } catch (err) { /* the coordinates alone are fine */ }
}

/**
 * Set the ORIGIN point: store it in state, drop a marker, fetch the local
 * weather (for the speed-of-sound math), and re-route if we have a destination.
 * @param {number} lat
 * @param {number} lon
 * @param {string} label
 */
async function setOrigin(lat, lon, label) {
  state.origin = { lat, lon, label };
  placeOriginMarker(lat, lon, label);

  // Kick off weather + routing. These are independent, so let them run together.
  await Promise.all([
    loadWeather(lat, lon),
    state.destination ? requestRoute() : Promise.resolve(),
  ]);

  render();
}

/**
 * Set the DESTINATION point: store it, drop a marker, and request a route if we
 * already have an origin.
 * @param {number} lat
 * @param {number} lon
 * @param {string} label
 */
async function setDestination(lat, lon, label) {
  state.destination = { lat, lon, label };
  placeDestinationMarker(lat, lon);

  if (state.origin) {
    await requestRoute();
  } else {
    // We do not know where you are yet — find you, and the route follows.
    setMapStatus("Finding you so the route can start from where you are…");
    useMyLocation();
  }

  render();
}

/**
 * Ask the routing service for a route between origin and destination, draw it,
 * and store the result in state. Shows a friendly message on failure.
 */
async function requestRoute() {
  if (!state.origin || !state.destination) return;

  setMapStatus("Calculating route…");

  try {
    const result = await route(state.origin, state.destination, state.travelMode);
    state.routes = [result, ...(result.alternatives || [])];
    state.routeIndex = 0;
    state.routeData = result;
    drawRoutes({ fit: !state.navigating });
    setMapStatus("");
    if (state.navigating) state.navNext = 1;             // a fresh route starts from its first turn
    if (state.pendingStart) {
      state.pendingStart = false;
      startNavigation();
    }
  } catch (err) {
    // Don't crash — explain what happened and clear any stale route.
    state.routeData = null;
    state.pendingStart = false;
    setMapStatus(`Routing failed: ${err.message}`, true);
  }

  render();
}

/**
 * Fetch live weather for a point and compute the local speed of sound from it.
 * Falls back gracefully (to ISA sea level) if the weather service fails.
 * @param {number} lat
 * @param {number} lon
 */
async function loadWeather(lat, lon) {
  try {
    const weather = await getWeather(lat, lon);
    state.weather = weather;

    // describeSpeedOfSound returns BOTH the computed value AND a short note
    // about which inputs were used — perfect for the atmosphere card.
    const { speedOfSound, basis } = describeSpeedOfSound({
      temperatureC: weather.temperatureC,
      humidity: weather.humidity,
      pressureHpa: weather.pressureHpa,
    });
    state.speedOfSound = speedOfSound;
    state.speedOfSoundBasis = basis;
  } catch (err) {
    // Weather is a "nice to have". If it fails, fall back to the ISA standard
    // value and SAY SO, so the Mach numbers are still meaningful.
    state.weather = null;
    state.speedOfSound = ISA_SEA_LEVEL_SOUND;
    state.speedOfSoundBasis =
      "Live weather unavailable — using ISA standard sea-level (15 C).";
  }
}


// --- THE PLACE CARD, DIRECTIONS AND NAVIGATION -------------------------------
// Google Maps keeps these apart on purpose, and so does this: clicking a place
// only tells you about it (a card). "Directions" then shows the route and how
// long it takes. "Start" — on either — begins following it, turn by turn.

/**
 * Show a place: drop the pin on it and open its card. Nothing else happens until
 * a button on the card is pressed.
 * @param {{kind:string, name:string, category?:string, address?:string, detail?:string, lat:number, lon:number, website?:string, phone?:string}} place
 */
function showPlaceCard(place) {
  state.selected = place;
  placeDestinationMarker(place.lat, place.lon);
  el("search-results").hidden = true;

  el("place-name").textContent = place.name;
  el("place-kind").textContent =
    place.kind === "dropped"
      ? `${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`
      : place.category || (place.kind === "address" ? "Address" : "");

  const setRow = (id, text) => {
    el(id).textContent = text || "";
    el(id).parentElement.hidden = !text;
  };
  setRow("place-address", place.address);
  setRow("place-away", awayText(place));
  renderPlaceSave();

  // Contact links: only ones that are real web addresses or phone numbers.
  const links = el("place-links");
  links.innerHTML = "";
  const addLink = (icon, href, label, external) => {
    const row = document.createElement("div");
    row.className = "place-row";
    const i = document.createElement("span");
    i.className = "place-row-icon";
    i.setAttribute("aria-hidden", "true");
    i.textContent = icon;
    const a = document.createElement("a");
    a.href = href;
    a.textContent = label;
    if (external) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
    row.appendChild(i);
    row.appendChild(a);
    links.appendChild(row);
  };
  if (place.website) addLink("🌐", place.website, place.website.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, ""), true);
  if (place.phone) addLink("📞", `tel:${place.phone.replace(/[^\d+]/g, "")}`, place.phone, false);

  // Many places (parks, dropped pins) come without a street address — ask.
  if (!place.address) {
    reverseGeocode(place.lat, place.lon)
      .then((where) => {
        if (state.selected !== place) return;          // they have moved on
        place.address = where.shortAddress;
        setRow("place-address", place.address);
      })
      .catch(() => { /* no address is fine */ });
  }
  rememberInAddressBar(place);
  render();
}

/** Put the place in the page's address, so copying the link shares it. */
function rememberInAddressBar(place) {
  try {
    history.replaceState(null, "", place ? placeToHash(place) : location.pathname + location.search);
  } catch (err) { /* some embeds forbid it */ }
}

/** The Save button reflects whether this place is already saved. */
function renderPlaceSave() {
  const place = state.selected;
  const saved = Boolean(place) && isSaved(place);
  el("place-save-icon").textContent = saved ? "★" : "☆";
  el("place-save-label").textContent = saved ? "Saved" : "Save";
  el("place-save").classList.toggle("on", saved);
}

/** "1.9 km from you · 6.3 light-ms" — how far, in the units this app likes. */
function awayText(place) {
  if (!state.origin) return "";
  const meters = distanceMeters(state.origin, place);
  if (!Number.isFinite(meters)) return "";
  const near = formatDistance(meters, familiarDistanceUnit(meters));
  const science = formatDistance(meters, primaryDistanceUnit(meters));
  return near === science ? `${near} from you` : `${near} from you · ${science}`;
}

/** Close the card, and take the pin away unless directions are still using it. */
function closePlaceCard() {
  state.selected = null;
  rememberInAddressBar(null);
  if (!state.destination && destinationMarker) {
    destinationMarker.remove();
    destinationMarker = null;
  }
  render();
}

/**
 * "Directions" (or "Start") was pressed on the card: make this place the
 * destination and work out the route.
 */
async function getDirections({ start = false } = {}) {
  const place = state.selected;
  if (!place) return;
  state.selected = null;
  state.destination = { lat: place.lat, lon: place.lon, label: place.name };
  state.pendingStart = start;
  state.routeData = null;
  state.routes = [];
  el("search-input").value = place.name;
  addRecent(place);
  placeDestinationMarker(place.lat, place.lon);
  rememberInAddressBar(null);
  render();

  if (state.origin) {
    await requestRoute();
  } else {
    setMapStatus("Finding you so the route can start from where you are…");
    useMyLocation();                                    // the first fix triggers the route
  }
}

/** Take the whole trip away: the route, the destination and the pin. */
function clearDirections() {
  if (state.navigating) stopNavigation();
  state.destination = null;
  state.routeData = null;
  state.routes = [];
  state.routeIndex = 0;
  state.pendingStart = false;
  if (routeLine) { routeLine.remove(); routeLine = null; }
  if (destinationMarker) { destinationMarker.remove(); destinationMarker = null; }
  el("search-input").value = "";
  setMapStatus("");
  render();
}

/** Begin following the route: the map sticks to you and a banner names each turn. */
function startNavigation() {
  const steps = state.routeData && state.routeData.steps;
  if (!steps || steps.length === 0) return;
  state.navigating = true;
  state.navNext = 1;
  state.locationManual = false;                         // navigating means trusting the real position
  navOffRouteCount = 0;
  startLocationWatch();
  if (state.origin) {
    map.setView([state.origin.lat, state.origin.lon], 17);
    navProgress(state.origin);
  }
  speak(steps[0].instruction);
  render();
}

function stopNavigation() {
  state.navigating = false;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  render();
}

let navOffRouteCount = 0;
let lastReroute = 0;

/** A new position while navigating: pass the turns you have passed, follow, re-route if lost. */
function navProgress(position) {
  const data = state.routeData;
  if (!state.navigating || !data) return;
  const before = state.navNext;

  if (hasArrived(data.steps, position)) {
    setMapStatus("You have arrived.");
    speak("You have arrived.");
    stopNavigation();
    return;
  }
  state.navNext = advanceStep(data.steps, state.navNext, position);
  if (state.navNext !== before) speak(data.steps[state.navNext].instruction);

  // Well away from the line for two readings running: it is a wrong turn, not a wobble.
  if (distanceToRoute(data.geometry, position) > 70) navOffRouteCount++;
  else navOffRouteCount = 0;
  if (navOffRouteCount >= 2 && Date.now() - lastReroute > 15000) {
    lastReroute = Date.now();
    navOffRouteCount = 0;
    setMapStatus("Re-routing…");
    requestRoute();
  }

  map.panTo([position.lat, position.lon], { animate: true });
  render();
}

/** Say an instruction aloud, if the speaker button is on. */
function speak(text) {
  if (!state.voice || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

/** Show whichever panels the current stage of the flow calls for. */
function renderMode() {
  const hasRoute = Boolean(state.routeData && state.destination);
  const showHead = hasRoute && !state.navigating;

  // WHICH VIEW the side panel shows, most urgent first: following a route,
  // the Science panels (asked for from the rail), a place, a trip, category
  // results, then saved / recents, and otherwise the home view.
  let view = "home";
  if (state.navigating) view = "trip";
  else if (state.tab === "science") view = "science";
  else if (state.selected) view = "place";
  else if (state.destination) view = "trip";
  else if (state.category) view = "results";
  else if (state.tab === "saved" || state.tab === "recents") view = "list";
  const ids = { home: "view-home", list: "view-list", results: "view-results", place: "place-card", trip: "view-trip", science: "view-science" };
  el("side").dataset.view = view;
  for (const [name, id] of Object.entries(ids)) el(id).hidden = name !== view;

  document.body.classList.toggle("mode-place", view === "place");
  document.body.classList.toggle("mode-route", showHead);
  document.body.classList.toggle("mode-nav", state.navigating);
  el("route-head").hidden = !showHead;
  el("nav-banner").hidden = !state.navigating;
  el("nav-bar").hidden = !state.navigating;
  document.querySelectorAll(".rail-btn[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));

  if (view === "home") renderHome();
  if (view === "list") renderList();
  if (view === "results") renderResults();
  if (view === "trip") renderRouteOptions();

  if (showHead) {
    const r = state.routeData;
    el("route-head-time").textContent = shortDuration(r.durationSeconds);
    const near = formatDistance(r.distanceMeters, familiarDistanceUnit(r.distanceMeters));
    const science = formatDistance(r.distanceMeters, primaryDistanceUnit(r.distanceMeters));
    el("route-head-detail").textContent = near === science ? near : `${near} · ${science}`;
  }
  if (state.navigating && state.routeData && state.origin) renderNav();
  renderChips();
  renderWeatherChip();
}

// ---- the panel's lists ---------------------------------------------------------

/** One row in a list of places: an icon, the name, a quiet line, and how far. */
function placeRow(place) {
  const li = document.createElement("li");
  li.className = "place-item";
  const icon = document.createElement("span");
  icon.className = "place-item-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = placeIcon(place);
  const text = document.createElement("div");
  text.className = "place-item-text";
  const name = document.createElement("div");
  name.className = "place-item-name";
  name.textContent = place.name;
  const sub = document.createElement("div");
  sub.className = "place-item-sub";
  sub.textContent = place.detail || place.address || place.category || "";
  text.appendChild(name);
  text.appendChild(sub);
  li.appendChild(icon);
  li.appendChild(text);
  if (Number.isFinite(place.away)) {
    const away = document.createElement("span");
    away.className = "place-item-side";
    away.textContent = formatDistance(place.away, familiarDistanceUnit(place.away));
    li.appendChild(away);
  }
  li.addEventListener("click", () => selectPlace(place, { show: true, keepCategory: Boolean(state.category) }));
  return li;
}

function fillList(ul, places) {
  ul.replaceChildren(...places.map(placeRow));
}

/** Home: the explore buttons, then a few recent and saved places. */
function renderHome() {
  const explore = el("explore");
  if (!explore.children.length) {
    for (const cat of CATEGORIES.slice(0, 8)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "explore-btn";
      const i = document.createElement("span");
      i.className = "explore-icon";
      i.textContent = cat.icon;
      const t = document.createElement("span");
      t.textContent = cat.label;
      b.appendChild(i);
      b.appendChild(t);
      b.addEventListener("click", () => openCategory(cat));
      explore.appendChild(b);
    }
  }
  const recents = loadRecents().slice(0, 4);
  const saved = loadSaved().slice(0, 4);
  fillList(el("home-recents"), recents);
  fillList(el("home-saved"), saved);
  el("home-recents-head").hidden = recents.length === 0;
  el("home-saved-head").hidden = saved.length === 0;
}

/** Saved places, or recent searches — the two lists the rail opens. */
function renderList() {
  const saved = state.tab === "saved";
  const items = saved ? loadSaved() : loadRecents();
  el("list-title").textContent = saved ? "Saved places" : "Recent searches";
  el("list-clear").hidden = saved || items.length === 0;
  fillList(el("list-items"), items);
  const empty = el("list-empty");
  empty.hidden = items.length > 0;
  empty.textContent = saved
    ? "Nothing saved yet. Open a place and press Save."
    : "Nothing here yet. Places you look up will appear here.";
}

/** The places found for a category. */
function renderResults() {
  const cat = state.category;
  el("results-title").textContent = cat ? cat.label : "";
  const list = state.categoryResults;
  const empty = el("results-empty");
  if (list === null) {
    el("results-items").replaceChildren();
    empty.hidden = false;
    empty.textContent = "Looking around…";
  } else {
    fillList(el("results-items"), list);
    empty.hidden = list.length > 0;
    empty.textContent = "Nothing found in this part of the map. Move it, or zoom in a little, and try “Search this area”.";
  }
}

function renderNav() {
  const data = state.routeData;
  const next = data.steps[Math.min(state.navNext, data.steps.length - 1)];
  const left = remaining(data.steps, state.navNext, state.origin);
  el("nav-arrow").textContent = arrowFor(next.instruction);
  el("nav-distance").textContent = nextTurnDistance(left.toNextMeters);
  el("nav-instruction").textContent = next.instruction;
  el("nav-eta-time").textContent = shortDuration(left.seconds);
  const dist = formatDistance(left.meters, familiarDistanceUnit(left.meters));
  el("nav-eta-detail").textContent = `${dist} · arrive ${arrivalClock(left.seconds)}`;
  el("nav-voice").textContent = state.voice ? "🔊" : "🔇";
}


// --- GOOGLE-MAPS-STYLE EXTRAS ----------------------------------------------------
// The category chips, layers, right-click menu, weather, saved places, routes to
// choose between, and the left rail's tabs.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- category chips and "search nearby" --------------------------------------

/** The row of chips along the top of the map. Built once, then marked as on or off. */
function renderChips() {
  const bar = el("chips");
  if (!bar.children.length) {
    for (const cat of CATEGORIES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.cat = cat.id;
      const i = document.createElement("span");
      i.className = "chip-icon";
      i.setAttribute("aria-hidden", "true");
      i.textContent = cat.icon;
      const t = document.createElement("span");
      t.textContent = cat.label;
      b.appendChild(i);
      b.appendChild(t);
      b.addEventListener("click", () => (state.category && state.category.id === cat.id ? closeCategory() : openCategory(cat)));
      bar.appendChild(b);
    }
  }
  for (const b of bar.children) b.classList.toggle("on", Boolean(state.category) && b.dataset.cat === state.category.id);
}

/** Start browsing a category near where the map is looking. */
async function openCategory(cat) {
  if (state.navigating) return;
  if (state.destination) clearDirections();
  state.selected = null;
  state.tab = null;
  state.category = cat;
  state.categoryResults = null;
  el("search-input").value = "";
  el("search-area").hidden = true;
  rememberInAddressBar(null);
  // Businesses only load once the map is zoomed in far enough to draw them.
  if (map.getZoom() < 16) map.setZoom(16);
  render();
  await runCategorySearch();
}

/** Look at what the map has loaded for the chosen category and list it, nearest first. */
async function runCategorySearch() {
  const cat = state.category;
  if (!cat) return;
  categoryCenter = map.getCenter();
  state.categoryResults = null;
  el("search-area").hidden = true;
  render();

  let found = [];
  const view = map.getBounds().pad(0.1);
  for (let attempt = 0; attempt < 16; attempt++) {
    found = loadedPlaces("").filter((p) => matchesCategory(p, cat) && view.contains([p.lat, p.lon]));
    if (found.length >= 8 || (found.length > 0 && attempt >= 5)) break;
    await sleep(900);                                   // the tiles are still arriving
    if (state.category !== cat) return;                 // they picked something else
  }
  const seen = new Set();
  const unique = found.filter((p) => {
    const key = `${p.name}|${p.lat.toFixed(4)}|${p.lon.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const from = state.origin && view.contains([state.origin.lat, state.origin.lon])
    ? state.origin
    : { lat: categoryCenter.lat, lon: categoryCenter.lng };
  state.categoryResults = nearestFirst(unique, from, distanceMeters).slice(0, 40);
  drawCategoryDots(state.categoryResults);
  render();
}

/** Mark the results on the map so the list and the map agree. */
function drawCategoryDots(places) {
  if (categoryDots) categoryDots.remove();
  categoryDots = L.layerGroup(
    places.map((p) =>
      L.circleMarker([p.lat, p.lon], { radius: 7, color: "#ffffff", weight: 2, fillColor: "#ea4335", fillOpacity: 1 })
        .bindTooltip(p.name)
        .on("click", (e) => { L.DomEvent.stopPropagation(e); selectPlace(p, { show: false, keepCategory: true }); })
    )
  ).addTo(map);
}

function clearCategory() {
  state.category = null;
  state.categoryResults = null;
  categoryCenter = null;
  if (categoryDots) { categoryDots.remove(); categoryDots = null; }
  el("search-area").hidden = true;
}

function closeCategory() {
  clearCategory();
  render();
}

// ---- layers: map, satellite, terrain ------------------------------------------

const LAYER_KEY = "sciencemaps.layer";

function baseLayersOff() {
  for (const layer of [vectorLayer, pictureLayer, imageryLayer, topoLayer, labelsLayer]) {
    if (layer && map.hasLayer(layer)) map.removeLayer(layer);
  }
}

/** Switch what the map is drawn from. The dots, pin and route stay where they are. */
function setLayerMode(mode) {
  state.layerMode = mode;
  baseLayersOff();
  const esri = "https://server.arcgisonline.com/ArcGIS/rest/services";
  if (mode === "satellite") {
    imageryLayer = imageryLayer || L.tileLayer(`${esri}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    });
    imageryLayer.addTo(map);
    labelsLayer = labelsLayer || L.tileLayer(`${esri}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19 });
    if (el("layer-labels").checked) labelsLayer.addTo(map);
  } else if (mode === "terrain") {
    topoLayer = topoLayer || L.tileLayer(`${esri}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`, {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, USGS, NGA, and others",
    });
    topoLayer.addTo(map);
  } else if (vectorLayer) {
    vectorLayer.addTo(map);
  } else {
    if (!pictureLayer) addPictureBasemap(); else pictureLayer.addTo(map);
  }
  // The pin, dots and route belong on top of whichever is showing.
  for (const layer of [routeLine, categoryDots]) if (layer && map.hasLayer(layer)) layer.remove(), layer.addTo(map);

  const thumbs = {
    default: "linear-gradient(135deg, #f5f5f5 45%, #c4f0d4 45% 60%, #90daee 60%)",
    satellite: "linear-gradient(135deg, #3d5a3a, #24404f 55%, #57503b)",
    terrain: "linear-gradient(135deg, #d8cfa8, #a9c790 55%, #7aa06b)",
  };
  el("layers-btn").style.setProperty("--thumb", thumbs[mode]);
  document.querySelectorAll(".layer-opt").forEach((b) => b.classList.toggle("on", b.dataset.layer === mode));
  try { localStorage.setItem(LAYER_KEY, mode); } catch (err) { /* fine */ }
  // What the old map layer drew, the new one must be told about: the vector map
  // needs to know its container's size after being off screen.
  if (mode === "default") map.invalidateSize();
}

// ---- the right-click menu ------------------------------------------------------

let contextSpot = null;

function showContextMenu(point, latlng) {
  contextSpot = latlng;
  const menu = el("ctx-menu");
  menu.hidden = false;
  const size = map.getSize();
  menu.style.left = `${Math.min(point.x, size.x - menu.offsetWidth - 8)}px`;
  menu.style.top = `${Math.min(point.y, size.y - menu.offsetHeight - 8)}px`;
  menu.querySelector("li").focus();
}

function hideContextMenu() {
  el("ctx-menu").hidden = true;
}

function runContextAction(action) {
  hideContextMenu();
  const spot = contextSpot;
  if (!spot) return;
  const here = { kind: "dropped", name: "Dropped pin", category: "Dropped pin", address: "", lat: spot.lat, lon: spot.lng };
  if (action === "here") {
    clearCategory();
    showPlaceCard(here);
  } else if (action === "to") {
    clearCategory();
    showPlaceCard(here);
    getDirections();
  } else if (action === "from") {
    chooseOrigin({ ...here, name: "Chosen start" });
  } else if (action === "copy") {
    copyText(`${spot.lat.toFixed(6)}, ${spot.lng.toFixed(6)}`, "Coordinates copied.");
  }
}

/** Copy text to the clipboard and say so; where that is not allowed, show it to copy by hand. */
async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    setMapStatus(message);
    setTimeout(() => { if (el("map-status").textContent === message) setMapStatus(""); }, 2200);
  } catch (err) {
    window.prompt("Copy this:", text);
  }
}

// ---- weather chip ---------------------------------------------------------------

function renderWeatherChip() {
  const chip = el("weather-chip");
  const w = state.weather;
  if (!w) { chip.hidden = true; return; }
  const code = w.weatherCode;
  const icon = code === 0 ? "☀️" : code <= 2 ? "🌤️" : code === 3 ? "☁️" : code <= 48 ? "🌫️" : code <= 67 ? "🌧️" : code <= 77 ? "🌨️" : code <= 82 ? "🌦️" : "⛈️";
  const fahrenheit = /^en-(US|LR|MM)$/i.test(navigator.language || "en-US");
  const degrees = fahrenheit ? w.temperatureC * 9 / 5 + 32 : w.temperatureC;
  chip.textContent = `${icon} ${Math.round(degrees)}°${fahrenheit ? "F" : "C"}`;
  chip.title = `${w.description}. Mach 1 here is ${Math.round(state.speedOfSound * 2.23694)} mph.`;
  chip.hidden = false;
}

// ---- choosing the start and destination of a trip ------------------------------------

/** Make the search box choose something else: "origin" (the start) or "edit" (the destination). */
function beginChoosing(which) {
  state.searchFor = which;
  const input = el("search-input");
  input.value = "";
  input.placeholder = which === "origin" ? "Choose starting point" : "Choose destination";
  input.focus();
  runSearch("");
}

function endChoosing() {
  state.searchFor = "destination";
  el("search-input").placeholder = "Search Science Maps";
}

/** Set the start of the trip to a place, and take it from there. */
function chooseOrigin(place) {
  state.origin = { lat: place.lat, lon: place.lon, label: place.name };
  state.locationManual = true;                          // a chosen start is not the GPS's to move
  state.locationAccuracy = null;
  placeOriginMarker(place.lat, place.lon, place.name);
  if (accuracyCircle) { accuracyCircle.remove(); accuracyCircle = null; }
  if (state.selected && !state.destination) {
    setMapStatus(`Start set to ${place.name}.`);
  }
  if (state.destination) requestRoute();
  render();
}

/** Swap the start and the destination. */
function swapEnds() {
  if (!state.origin || !state.destination) return;
  const o = state.origin, d = state.destination;
  state.origin = { lat: d.lat, lon: d.lon, label: d.label };
  state.destination = { lat: o.lat, lon: o.lon, label: o.label };
  state.locationManual = true;
  placeOriginMarker(state.origin.lat, state.origin.lon, state.origin.label);
  placeDestinationMarker(state.destination.lat, state.destination.lon);
  requestRoute();
}

// ---- routes to choose between --------------------------------------------------------

/** Draw every route, the chosen one in blue on top and the others in grey to click. */
function drawRoutes({ fit = true } = {}) {
  if (routeLine) { routeLine.remove(); routeLine = null; }
  const parts = [];
  state.routes.forEach((r, i) => {
    if (i === state.routeIndex) return;
    const pts = r.geometry.map((p) => [p.lat, p.lon]);
    parts.push(L.polyline(pts, { color: "#ffffff", weight: 8, opacity: 1, lineCap: "round", lineJoin: "round" }));
    parts.push(L.polyline(pts, { color: "#9aa0a6", weight: 5, opacity: 1, lineCap: "round", lineJoin: "round" })
      .on("click", (e) => { L.DomEvent.stopPropagation(e); chooseRoute(i); }));
  });
  routeLine = L.layerGroup(parts).addTo(map);
  // The chosen route goes on last, so it is on top; drawRoute makes it and fits the view.
  const chosen = state.routes[state.routeIndex];
  const layer = routeLine;
  drawRoute(chosen.geometry, { fit });
  // drawRoute replaced routeLine with only the chosen one; put the greys back beneath it.
  const chosenGroup = routeLine;
  chosenGroup.remove();                     // so it is added after the greys, and so sits on top of them
  routeLine = L.layerGroup([layer, chosenGroup]).addTo(map);
}

function chooseRoute(index) {
  if (index === state.routeIndex || !state.routes[index]) return;
  state.routeIndex = index;
  state.routeData = state.routes[index];
  state.navNext = 1;
  drawRoutes({ fit: false });
  render();
}

/** The list of routes on offer, when there is more than one. */
function renderRouteOptions() {
  const box = el("route-options");
  if (state.routes.length < 2) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  box.replaceChildren(...state.routes.map((r, i) => {
    const row = document.createElement("div");
    row.className = "route-option" + (i === state.routeIndex ? " on" : "");
    const time = document.createElement("div");
    time.className = "route-option-time";
    time.textContent = shortDuration(r.durationSeconds);
    const text = document.createElement("div");
    text.className = "route-option-text";
    const via = document.createElement("div");
    via.className = "route-option-via";
    via.textContent = r.via ? `via ${r.via}` : "Route";
    const sub = document.createElement("div");
    sub.className = "route-option-sub";
    sub.textContent = i === 0 ? `${formatDistance(r.distanceMeters, familiarDistanceUnit(r.distanceMeters))} · Fastest route` : formatDistance(r.distanceMeters, familiarDistanceUnit(r.distanceMeters));
    text.appendChild(via);
    text.appendChild(sub);
    row.appendChild(time);
    row.appendChild(text);
    row.addEventListener("click", () => chooseRoute(i));
    return row;
  }));
}

// ---- the left rail -----------------------------------------------------------------------

/** Open Saved, Recents or Science from the rail; pressing the open one again closes it. */
function openTab(tab) {
  if (state.navigating) return;
  const closing = state.tab === tab;
  if (tab !== "science") {
    if (state.destination) clearDirections();
    state.selected = null;
    clearCategory();
  }
  state.tab = closing ? null : tab;
  document.body.classList.remove("panel-collapsed");
  map.invalidateSize();
  render();
}

/** The back arrow on a list, results or Science view. */
function goBack() {
  if (state.tab === "science") state.tab = null;
  else if (state.category) clearCategory();
  else state.tab = null;
  render();
}

/** Open a place given in the page's link (#place=lat,lon,Name). */
function openFromHash() {
  const place = placeFromHash(location.hash);
  if (!place) return;
  map.setView([place.lat, place.lon], 17, { animate: false });
  clearCategory();
  showPlaceCard(place);
}

// --- SEARCH -----------------------------------------------------------------

/**
 * Run a geocoding search for the text in the search box and show the results in
 * the dropdown. Debounced by the caller so we respect Nominatim's etiquette.
 * @param {string} query
 */
async function runSearch(query) {
  const trimmed = query.trim();
  const list = el("search-results");

  // Nothing typed: offer the places used before.
  if (trimmed.length === 0) {
    showRecents();
    return;
  }

  // Straight away, without waiting on the network: recent places that match,
  // and places already drawn on the map that match (businesses, addresses).
  const recents = filterRecents(loadRecents(), trimmed).slice(0, 4);
  const onMap = matchPlaces(loadedPlaces(trimmed), trimmed, 4);
  const early = [
    { title: "Recent", items: recents, icon: "🕘", removable: true },
    { title: "On the map", items: onMap, icon: "📍" },
  ];
  renderSearchList(early);

  // Too short to ask the online search about.
  if (trimmed.length < 3) return;

  try {
    const results = await geocode(trimmed, { viewbox: mapViewbox() });
    // The box may have changed while we waited; drop a stale answer.
    if (el("search-input").value.trim() !== trimmed) return;
    const online = results.map((r) => ({
      kind: looksLikeAddress(trimmed) ? "address" : "search",
      name: r.name || r.displayName,
      detail: r.displayName,
      lat: r.lat,
      lon: r.lon,
      placeType: r.type,
      category: r.type && r.type !== "yes" ? prettyCategory(r.type) : "",
    }));
    renderSearchList([...early, { title: "Places and addresses", items: online, icon: "🔎" }], true);
  } catch (err) {
    // A failed search shouldn't break the page; keep what we already have and say so.
    renderSearchList(early, true, `Online search failed: ${err.message}`);
  }
}

/** The area currently on screen, in the shape the search service wants. */
function mapViewbox() {
  const b = map.getBounds();
  return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
}

/**
 * Everything the map has already loaded that a name could match: businesses and
 * OpenStreetMap places, and — when what was typed looks like the start of a
 * street address — house numbers. Only what is near the view is loaded, which is
 * exactly what makes these suggestions "close to you".
 * @param {string} query
 */
function loadedPlaces(query) {
  if (!glMap) return [];
  const out = [];
  const collect = (source, sourceLayer, layerId) => {
    if (!glMap.getSource(source)) return;
    let features = [];
    try {
      features = glMap.querySourceFeatures(source, { sourceLayer });
    } catch (err) {
      return;        // the source may not have loaded yet
    }
    for (const f of features) {
      const place = placeFromFeature({ geometry: f.geometry, properties: f.properties, layer: { id: layerId } });
      if (place) out.push(place);
    }
  };
  collect("ovplaces", "place", "ov-place");
  collect("openmaptiles", "poi", "poi");
  if (looksLikeAddress(query)) collect("ovaddr", "address", "ov-address");
  return out;
}

/** With an empty box: the places used before, newest first. */
function showRecents() {
  const recents = loadRecents();
  const sections = [{ title: "Recent searches", items: recents, icon: "🕘", removable: true, clearable: true }];
  if (state.searchFor === "origin" && state.origin) {
    sections.unshift({ title: "", items: [{ kind: "here", name: "Your location", detail: "Use where I am now", lat: state.origin.lat, lon: state.origin.lon }], icon: "📍" });
  }
  if (recents.length === 0 && sections.length === 1) {
    el("search-results").hidden = true;
    return;
  }
  renderSearchList(sections);
}

/**
 * Render the geocoding results into the dropdown. Clicking a result sets it as
 * the destination.
 * @param {Array<{name:string, displayName:string, lat:number, lon:number, type:string}>} results
 */
function renderSearchList(sections, final = false, note = "") {
  const list = el("search-results");
  list.innerHTML = "";
  const seen = new Set();
  let count = 0;

  for (const section of sections) {
    // The same place can turn up in more than one section (a recent one that
    // is also on the map); show it once, under the first heading it fits.
    const items = section.items.filter((place) => {
      const key = `${place.name}|${place.lat.toFixed(4)}|${place.lon.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (items.length === 0) continue;

    const header = document.createElement("li");
    header.className = "result-heading";
    header.textContent = section.title;
    if (section.clearable) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "result-clear";
      clear.textContent = "Clear";
      clear.addEventListener("mousedown", (e) => e.preventDefault());
      clear.addEventListener("click", () => {
        clearRecents();
        list.hidden = true;
      });
      header.appendChild(clear);
    }
    list.appendChild(header);

    for (const place of items) {
      count++;
      const item = document.createElement("li");
      item.className = "result-row";

      const icon = document.createElement("span");
      icon.className = "result-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = place.kind === "address" ? "🏠" : section.icon;

      // A bold short name on top, a quieter line underneath (its kind and address).
      const text = document.createElement("div");
      text.className = "result-text";
      const name = document.createElement("div");
      name.className = "result-name";
      name.textContent = place.name;
      const detail = document.createElement("div");
      detail.className = "result-detail";
      detail.textContent = place.detail || "";
      text.appendChild(name);
      text.appendChild(detail);

      item.appendChild(icon);
      item.appendChild(text);

      if (section.removable) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "result-remove";
        remove.title = "Remove from recent searches";
        remove.textContent = "×";
        remove.addEventListener("click", (e) => {
          e.stopPropagation();
          removeRecent(place);
          item.remove();
        });
        item.appendChild(remove);
      }

      // Choosing a result: remember it, set it as the destination, go there.
      item.addEventListener("click", () => selectPlace(place, { show: true }));
      list.appendChild(item);
    }
  }

  if (note) {
    const li = document.createElement("li");
    li.className = "result-detail";
    li.textContent = note;
    list.appendChild(li);
  } else if (count === 0 && final) {
    const li = document.createElement("li");
    li.className = "result-detail";
    li.textContent = "No matches found.";
    list.appendChild(li);
  }

  list.hidden = list.children.length === 0;
}


// --- LIVE SPEED TRACKING ----------------------------------------------------

/**
 * Toggle GPS speed tracking on or off (wired to the "Start/Stop tracking" btn).
 */
function toggleTracking() {
  if (state.tracking) {
    stopTracking();
  } else {
    startTracking();
  }
}

/**
 * Begin watching the GPS position to read the user's current speed.
 * Uses position.coords.speed when the browser provides it; otherwise estimates
 * speed from how far we moved between two fixes (distance / time).
 */
function startTracking() {
  if (!("geolocation" in navigator)) {
    setMapStatus("Your browser does not support geolocation.", true);
    return;
  }

  state.tracking = true;
  state.lastFix = null;
  updateTrackButton();

  state.watchId = navigator.geolocation.watchPosition(
    // SUCCESS: a new position fix arrived.
    (position) => {
      const { latitude, longitude, speed } = position.coords;
      const timestamp = position.timestamp;

      let speedMps;

      // Best case: the device reports speed directly (in m/s).
      if (typeof speed === "number" && speed >= 0) {
        speedMps = speed;
      } else if (state.lastFix) {
        // Fallback: estimate from the distance between successive fixes.
        const meters = haversineMeters(
          state.lastFix.lat,
          state.lastFix.lon,
          latitude,
          longitude
        );
        const seconds = (timestamp - state.lastFix.timestamp) / 1000;
        speedMps = seconds > 0 ? meters / seconds : 0;
      } else {
        // First fix and no reported speed — assume stationary for now.
        speedMps = 0;
      }

      state.currentSpeedMps = speedMps;
      state.lastFix = { lat: latitude, lon: longitude, timestamp };
      render();
    },
    // ERROR: explain and turn tracking back off.
    (error) => {
      let message = "Could not track your position.";
      if (error.code === error.PERMISSION_DENIED) {
        message = "Location permission denied, so live speed is unavailable.";
      }
      setMapStatus(message, true);
      stopTracking();
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
  );
}

/**
 * Stop watching the GPS position and reset the live-speed readouts.
 */
function stopTracking() {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  state.tracking = false;
  state.currentSpeedMps = null;
  state.lastFix = null;
  updateTrackButton();
  render();
}

/**
 * Update the tracking button's label and styling to match the current state.
 */
function updateTrackButton() {
  const btn = el("track-btn");
  if (!btn) return;
  if (state.tracking) {
    btn.textContent = "■ Stop tracking";
    btn.classList.add("active");
  } else {
    btn.textContent = "▶ Start tracking";
    btn.classList.remove("active");
  }
}

/**
 * Great-circle distance between two lat/lon points, in meters (the Haversine
 * formula). Used to estimate speed when the device doesn't report it directly.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} distance in meters
 */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's mean radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}


// -----------------------------------------------------------------------------
// 6. RENDER — redraw the whole dashboard from `state`
// -----------------------------------------------------------------------------
// render() reads `state` and updates the page. It NEVER changes state. Any
// action that changes state finishes by calling render(), so the screen always
// reflects the latest truth.

/**
 * Decide which DISTANCE unit key to use for the PRIMARY line of a value.
 * In smart mode we auto-pick per value; otherwise we use the chosen select.
 * @param {number} meters
 * @returns {string} a distance unit key
 */
function primaryDistanceUnit(meters) {
  return state.smartMode ? smartDistanceUnit(meters) : state.distanceUnit;
}

/**
 * Decide which SPEED unit key to use for the PRIMARY line of a value.
 * @param {number} mps
 * @returns {string} a speed unit key
 */
function primarySpeedUnit(mps) {
  return state.smartMode ? smartSpeedUnit(mps) : state.speedUnit;
}

/**
 * The one render function. Calls focused sub-renderers for each card so each
 * piece stays small and readable.
 */
function render() {
  renderMode();
  renderTrip();
  renderUnitControls();
  renderRoute();
  renderDistanceTable();
  renderLiveSpeed();
  renderSpeedTable();
  renderAtmosphere();
  renderFacts();
}

/**
 * Update the directions panel's start/destination labels from `state`. Shows a
 * gentle hint (muted) until each endpoint is actually set.
 */
function renderTrip() {
  const originEl = el("origin-label");
  const destEl = el("dest-label");

  if (originEl) {
    const hasOrigin = Boolean(state.origin);
    originEl.textContent = hasOrigin
      ? state.origin.label
      : "Your location — tap the location button";
    originEl.classList.toggle("muted", !hasOrigin);
  }

  if (destEl) {
    const hasDest = Boolean(state.destination);
    destEl.textContent = hasDest
      ? state.destination.label
      : "Choose destination — search or tap the map";
    destEl.classList.toggle("muted", !hasDest);
  }
}

/**
 * Reflect the smart-mode toggle: dim the manual selects when smart mode is on.
 */
function renderUnitControls() {
  const card = document.querySelector(".unit-controls");
  if (card) card.classList.toggle("smart-active", state.smartMode);
}

/**
 * Render the ROUTE card: distance (dual display), travel time, and the
 * light/sound travel times to the destination.
 */
function renderRoute() {
  const empty = el("route-empty");
  const details = el("route-details");

  // No route yet: show the hint, hide the details.
  if (!state.routeData) {
    empty.hidden = false;
    details.hidden = true;
    return;
  }

  empty.hidden = true;
  details.hidden = false;

  const meters = state.routeData.distanceMeters;

  // DISTANCE — dual display. Primary line in the chosen/smart scientific unit;
  // familiar line in feet/miles via familiarDistanceUnit().
  const primaryUnit = primaryDistanceUnit(meters);
  const familiarUnit = familiarDistanceUnit(meters);
  el("route-distance-primary").textContent = formatDistance(meters, primaryUnit);
  el("route-distance-familiar").textContent =
    "(" + formatDistance(meters, familiarUnit) + ")";

  // Estimated travel time (from the routing service).
  el("route-time").textContent = formatTravelTime(state.routeData.durationSeconds);

  // Light travel time = distance / speed of light.
  const lightSeconds = meters / SPEED_OF_LIGHT;
  el("light-time").textContent = formatPhysicsTime(lightSeconds);

  // Sound travel time = distance / local speed of sound (hypothetical, in air).
  const soundSeconds = meters / state.speedOfSound;
  el("sound-time").textContent = formatPhysicsTime(soundSeconds);

  // Turn-by-turn steps live in their own renderer.
  renderSteps();
}

/**
 * Render the numbered turn-by-turn list. Each step shows its instruction plus
 * the step distance in BOTH the chosen/scientific unit and the familiar unit.
 *
 * The steps list is created on the fly inside #route-details (after the metrics)
 * so the HTML stays simple — app.js owns this dynamic chunk.
 */
function renderSteps() {
  const ol = el("trip-steps");
  ol.innerHTML = ""; // clear any previous route's steps

  const steps = (state.routeData && state.routeData.steps) || [];
  for (const step of steps) {
    const li = document.createElement("li");

    // The instruction text (e.g. "Turn left onto Main St").
    const instruction = document.createElement("div");
    instruction.className = "step-instruction";
    instruction.textContent = step.instruction;

    // The step distance, shown in the user's primary unit + familiar unit.
    const m = step.distanceMeters;
    const pUnit = primaryDistanceUnit(m);
    const fUnit = familiarDistanceUnit(m);
    const dist = document.createElement("div");
    dist.className = "step-distance";
    dist.textContent = `${formatDistance(m, pUnit)} (${formatDistance(m, fUnit)})`;

    li.appendChild(instruction);
    li.appendChild(dist);
    ol.appendChild(li);
  }
}

/**
 * Render the "Distance in many units" table — a meaningful subset of units
 * (m, km, mi, light-ms, light-s, AU, ly) from distanceInAllUnits().
 */
function renderDistanceTable() {
  const tbody = el("distance-table");

  if (!state.routeData) {
    tbody.innerHTML = `<tr><td class="empty-hint" colspan="2">No route yet.</td></tr>`;
    return;
  }

  // distanceInAllUnits gives every unit; we show a curated subset by key.
  const wanted = ["m", "km", "mi", "lms", "ls", "au", "ly"];
  const all = distanceInAllUnits(state.routeData.distanceMeters);
  const byKey = Object.fromEntries(all.map((row) => [row.key, row]));

  tbody.innerHTML = "";
  for (const key of wanted) {
    const row = byKey[key];
    if (!row) continue;
    tbody.appendChild(unitRow(row.label, row.formatted));
  }
}

/**
 * Render the LIVE SPEED card: current speed as a dual display.
 */
function renderLiveSpeed() {
  const primary = el("speed-primary");
  const familiar = el("speed-familiar");

  // Not tracking / no reading yet.
  if (state.currentSpeedMps === null) {
    primary.textContent = state.tracking ? "Waiting for GPS…" : "—";
    familiar.textContent = "—";
    return;
  }

  const mps = state.currentSpeedMps;

  // Primary line in the chosen/smart speed unit. Mach uses the live speed of
  // sound, so we pass it via opts.speedOfSound.
  const pUnit = primarySpeedUnit(mps);
  primary.textContent = formatSpeed(mps, pUnit, { speedOfSound: state.speedOfSound });

  // Familiar line (always mph via familiarSpeedUnit()).
  const fUnit = familiarSpeedUnit(mps);
  familiar.textContent =
    "(" + formatSpeed(mps, fUnit, { speedOfSound: state.speedOfSound }) + ")";
}

/**
 * Render the "speed in many units" mini table from speedInAllUnits(), using the
 * live speed of sound so the Mach row is accurate.
 */
function renderSpeedTable() {
  const tbody = el("speed-table");

  if (state.currentSpeedMps === null) {
    tbody.innerHTML = `<tr><td class="empty-hint" colspan="2">Start tracking to see your speed.</td></tr>`;
    return;
  }

  const rows = speedInAllUnits(state.currentSpeedMps, {
    speedOfSound: state.speedOfSound,
  });

  tbody.innerHTML = "";
  for (const row of rows) {
    tbody.appendChild(unitRow(row.label, row.formatted));
  }
}

/**
 * Render the ATMOSPHERE card: the computed local speed of sound, the basis note,
 * and the live weather readings the calculation depends on.
 */
function renderAtmosphere() {
  const empty = el("atmosphere-empty");
  const details = el("atmosphere-details");

  // Always show the speed-of-sound value once we have an origin (even on the
  // ISA fallback). If there's no origin at all, keep the hint.
  if (!state.origin) {
    empty.hidden = false;
    details.hidden = true;
    return;
  }

  empty.hidden = true;
  details.hidden = false;

  // The headline speed of sound (m/s) and what it is based on.
  el("sos-value").textContent = `${state.speedOfSound.toFixed(2)} m/s`;
  el("sos-basis").textContent = `Based on: ${state.speedOfSoundBasis}`;

  // The live weather readings (or em-dashes if weather is unavailable).
  const w = state.weather;
  el("weather-temp").textContent =
    w && Number.isFinite(w.temperatureC) ? `${w.temperatureC.toFixed(1)} °C` : "—";
  el("weather-humidity").textContent =
    w && Number.isFinite(w.humidity) ? `${Math.round(w.humidity)} %` : "—";
  el("weather-pressure").textContent =
    w && Number.isFinite(w.pressureHpa) ? `${Math.round(w.pressureHpa)} hPa` : "—";
  el("weather-elevation").textContent =
    w && Number.isFinite(w.elevationM) ? `${Math.round(w.elevationM)} m` : "—";
  el("weather-desc").textContent = w && w.description ? w.description : "—";
}

/**
 * Render the FACT box: a distance fact for the current route and a speed fact
 * for the current live speed.
 */
function renderFacts() {
  const distNode = el("distance-fact");
  const speedNode = el("speed-fact");

  if (state.routeData) {
    distNode.textContent = distanceFact(state.routeData.distanceMeters);
  } else {
    distNode.textContent =
      "Find a route to see how your trip compares to cosmic distances.";
  }

  if (state.currentSpeedMps !== null) {
    speedNode.textContent = speedFact(state.currentSpeedMps);
  } else {
    speedNode.textContent =
      "Start tracking to compare your speed to jets, orbits, and light itself.";
  }
}

/**
 * Build a single two-cell table row for the "in many units" tables:
 * a quiet label on the left, a bold mono value on the right.
 * @param {string} label
 * @param {string} value
 * @returns {HTMLTableRowElement}
 */
function unitRow(label, value) {
  const tr = document.createElement("tr");

  const tdLabel = document.createElement("td");
  tdLabel.className = "u-label";
  tdLabel.textContent = label;

  const tdValue = document.createElement("td");
  tdValue.className = "u-value";
  tdValue.textContent = value;

  tr.appendChild(tdLabel);
  tr.appendChild(tdValue);
  return tr;
}


// -----------------------------------------------------------------------------
// 7. WIRING — populate the unit selects and connect controls to actions
// -----------------------------------------------------------------------------

/**
 * Fill the DISTANCE unit <select>, grouping the units by category with
 * <optgroup> (metric / imperial / light / astronomical).
 */
function populateDistanceUnitSelect() {
  const select = el("distance-unit");

  // Friendly names for each category, in the order we want them to appear.
  const categories = {
    metric: "Metric",
    imperial: "Imperial",
    light: "Light-based",
    astronomical: "Astronomical",
  };

  // Build one <optgroup> per category, then add each matching unit to it.
  for (const [categoryKey, categoryLabel] of Object.entries(categories)) {
    const group = document.createElement("optgroup");
    group.label = categoryLabel;

    for (const unit of Object.values(DISTANCE_UNITS)) {
      if (unit.category !== categoryKey) continue;
      const option = document.createElement("option");
      option.value = unit.key;
      option.textContent = `${unit.label} (${unit.abbr})`;
      group.appendChild(option);
    }

    select.appendChild(group);
  }

  // Reflect the default choice from state.
  select.value = state.distanceUnit;
}

/**
 * Fill the SPEED unit <select> from SPEED_UNITS (no grouping needed here).
 */
function populateSpeedUnitSelect() {
  const select = el("speed-unit");

  for (const unit of Object.values(SPEED_UNITS)) {
    const option = document.createElement("option");
    option.value = unit.key;
    option.textContent = `${unit.label} (${unit.abbr})`;
    select.appendChild(option);
  }

  select.value = state.speedUnit;
}

/**
 * Connect every control on the page to the action it should trigger.
 */
function wireUpControls() {
  // "Use my location" button.
  el("locate-btn").addEventListener("click", useMyLocation);

  // The place card, the route strip and the navigation bar.
  el("place-close").addEventListener("click", closePlaceCard);
  el("place-directions").addEventListener("click", () => getDirections());
  el("place-start").addEventListener("click", () => getDirections({ start: true }));
  el("route-start").addEventListener("click", startNavigation);
  el("route-clear").addEventListener("click", clearDirections);
  el("nav-exit").addEventListener("click", () => { stopNavigation(); clearDirections(); });
  el("nav-voice").addEventListener("click", () => {
    state.voice = !state.voice;
    if (!state.voice && "speechSynthesis" in window) window.speechSynthesis.cancel();
    render();
  });
  // Escape steps back one stage: navigation, then the card, then the directions.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || /^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || "")) return;
    hideContextMenu();
    el("layers-menu").hidden = true;
    if (state.searchFor !== "destination") endChoosing();
    if (state.navigating) { stopNavigation(); clearDirections(); }
    else if (state.selected) closePlaceCard();
    else if (state.tab) { state.tab = null; render(); }
    else if (state.category) closeCategory();
    else if (state.destination) clearDirections();
  });

  // "Start/Stop tracking" button.
  el("track-btn").addEventListener("click", toggleTracking);

  // Travel mode: update state and re-route if a route already exists.
  el("travel-mode-select").addEventListener("change", (e) => {
    state.travelMode = e.target.value;
    if (state.origin && state.destination) requestRoute();
  });

  // Distance unit select: update state, then re-render.
  el("distance-unit").addEventListener("change", (e) => {
    state.distanceUnit = e.target.value;
    render();
  });

  // Speed unit select: update state, then re-render.
  el("speed-unit").addEventListener("change", (e) => {
    state.speedUnit = e.target.value;
    render();
  });

  // Smart-mode checkbox: update state, then re-render.
  el("smart-mode").addEventListener("change", (e) => {
    state.smartMode = e.target.checked;
    render();
  });

  // SEARCH input: debounce keystrokes (~400ms) so we respect Nominatim's
  // 1 request/second etiquette and don't spam the server.
  const debouncedSearch = debounce((value) => runSearch(value), 400);
  el("search-input").addEventListener("input", (e) => {
    debouncedSearch(e.target.value);
  });

  // Clicking into an empty box shows the places used before, like any map app.
  el("search-input").addEventListener("focus", (e) => {
    if (!e.target.value.trim()) showRecents();
  });
  // Enter picks the first suggestion, so a typed name or address needs no mouse.
  el("search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const pickFirst = () => {
        const first = el("search-results").querySelector(".result-row");
        if (first) first.click();
      };
      // If suggestions are not up yet (Enter came quickly), fetch them first.
      if (el("search-results").querySelector(".result-row")) pickFirst();
      else runSearch(e.target.value).then(pickFirst);
    } else if (e.key === "Escape") {
      el("search-results").hidden = true;
    }
  });

  // Hide the search dropdown when the user clicks elsewhere on the page.
  document.addEventListener("click", (e) => {
    const wrap = document.querySelector(".search-wrap");
    if (wrap && !wrap.contains(e.target)) {
      el("search-results").hidden = true;
    }
  });

  // The bottom sheet's grab handle expands/collapses the panel, like the
  // draggable bottom sheet in Google Maps.
  const side = el("side");
  const handle = el("sheet-handle");
  if (side && handle) {
    handle.addEventListener("click", () => side.classList.toggle("expanded"));
  }

  // The left rail, the back arrows, and the menu button that folds the panel away.
  document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => openTab(b.dataset.tab)));
  document.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", goBack));
  el("rail-menu").addEventListener("click", () => {
    document.body.classList.toggle("panel-collapsed");
    // The map's column just changed width; tell it.
    setTimeout(() => map.invalidateSize(), 50);
  });
  el("list-clear").addEventListener("click", () => { clearRecents(); render(); });

  // The place card's Save and Share.
  el("place-save").addEventListener("click", () => {
    if (!state.selected) return;
    toggleSaved(state.selected);
    renderPlaceSave();
    render();
  });
  el("place-share").addEventListener("click", () => {
    if (!state.selected) return;
    copyText(location.href.split("#")[0] + placeToHash(state.selected), "Link copied.");
  });

  // The trip: travel mode buttons, choosing the ends, swapping them.
  document.querySelectorAll(".mode-btn").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll(".mode-btn").forEach((x) => x.classList.toggle("on", x === b));
      const select = el("travel-mode-select");
      select.value = b.dataset.mode;
      select.dispatchEvent(new Event("change"));
    })
  );
  el("swap-btn").addEventListener("click", swapEnds);
  const activate = (row, which) => {
    row.addEventListener("click", () => beginChoosing(which));
    row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); beginChoosing(which); } });
  };
  activate(el("trip-origin-row"), "origin");
  activate(el("trip-dest-row"), "edit");

  // Layers, the right-click menu, and "Search this area".
  el("layers-btn").addEventListener("click", () => { el("layers-menu").hidden = !el("layers-menu").hidden; });
  document.querySelectorAll(".layer-opt").forEach((b) => b.addEventListener("click", () => setLayerMode(b.dataset.layer)));
  el("layer-labels").addEventListener("change", () => { if (state.layerMode === "satellite") setLayerMode("satellite"); });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".layers-wrap")) el("layers-menu").hidden = true;
    if (!e.target.closest(".ctx-menu")) hideContextMenu();
  });
  el("ctx-menu").querySelectorAll("li").forEach((li) => {
    li.addEventListener("click", () => runContextAction(li.dataset.act));
    li.addEventListener("keydown", (e) => { if (e.key === "Enter") runContextAction(li.dataset.act); });
  });
  el("search-area").addEventListener("click", runCategorySearch);
  window.addEventListener("hashchange", openFromHash);
}

/**
 * Move the map with the keyboard, like a game: hold the arrow keys or W A S D
 * and it glides, hold two at once to go diagonally, hold Shift to go faster.
 * + and − (or E and Q) zoom in and out. Works wherever the focus is on the
 * page — except while typing in a box, where the letters are for typing.
 *
 * Movement runs on the display's own frame clock, one small step per frame
 * scaled by real elapsed time, so it is smooth and the same speed on a slow
 * or a fast screen. It stops the instant the keys come up, and if the window
 * loses focus (so a key-up is never seen) it stops rather than run away.
 */
function setupKeyboardMoves() {
  const HELD = new Map();                      // key -> true, while it is down
  const DIRECTIONS = {
    arrowleft: [-1, 0], a: [-1, 0],
    arrowright: [1, 0], d: [1, 0],
    arrowup: [0, -1], w: [0, -1],
    arrowdown: [0, 1], s: [0, 1],
  };
  const SPEED = 520;                            // screen pixels per second
  const FAST = 2.4;                             // Shift multiplier
  let running = false;
  let last = 0;
  let fast = false;

  const typingInABox = (target) =>
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

  const step = (now) => {
    if (HELD.size === 0) { running = false; return; }
    const dt = Math.min(0.05, (now - last) / 1000);   // never leap after a hiccup
    last = now;
    let dx = 0, dy = 0;
    for (const key of HELD.keys()) {
      const dir = DIRECTIONS[key];
      if (dir) { dx += dir[0]; dy += dir[1]; }
    }
    if (dx || dy) {
      const length = Math.hypot(dx, dy);          // diagonals are not faster
      const pixels = SPEED * (fast ? FAST : 1) * dt;
      map.panBy([(dx / length) * pixels, (dy / length) * pixels], { animate: false });
    }
    requestAnimationFrame(step);
  };

  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || typingInABox(event.target)) return;
    const key = event.key.toLowerCase();

    if (key in DIRECTIONS) {
      event.preventDefault();                       // arrow keys must not also scroll the page
      HELD.set(key, true);
      fast = event.shiftKey;
      if (!running) {
        running = true;
        last = performance.now();
        requestAnimationFrame(step);
      }
    } else if (["+", "=", "e"].includes(key) && !event.repeat) {
      map.zoomIn();
    } else if (["-", "_", "q"].includes(key) && !event.repeat) {
      map.zoomOut();
    }
  });

  window.addEventListener("keyup", (event) => {
    HELD.delete(event.key.toLowerCase());
    fast = event.shiftKey;
  });
  // A held key that never reports its release (focus moved away) would keep going.
  window.addEventListener("blur", () => HELD.clear());
}

/**
 * The entry point: set up the map, controls, and the first render. Runs once
 * the HTML has finished parsing.
 */
function init() {
  initMap();
  setupKeyboardMoves();
  locateOnStart();
  // Come back to the map style last used, and to a place if the page's link names one.
  try {
    const mode = localStorage.getItem(LAYER_KEY);
    if (mode === "satellite" || mode === "terrain") setLayerMode(mode);
  } catch (err) { /* storage blocked: the default map */ }
  openFromHash();
  populateDistanceUnitSelect();
  populateSpeedUnitSelect();
  wireUpControls();
  updateTrackButton();

  // Draw the initial (empty) dashboard so all the hints show correctly.
  render();
}

// Start the app once the DOM is ready. If the script somehow runs after the
// DOM is already parsed, run init() immediately.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
