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

/**
 * Create the Leaflet map, add the OpenStreetMap tile layer (keeping the
 * required attribution), and let the user click the map to set a destination.
 */
function initMap() {
  // Start with a gentle world view (centered roughly on the Atlantic) so the
  // map looks sensible before we know where the user is.
  map = L.map("map", {
    center: [20, 0],
    zoom: 3,
    zoomControl: false, // we add our own zoom control in the bottom-right (Google-style)
  });

  // CARTO "Voyager" basemap — a clean, colorful, Google-Maps-like style built
  // on OpenStreetMap data. It is free and keyless. The attribution (OSM + CARTO)
  // is REQUIRED and must stay visible, so we set it here on the tile layer.
  // The {r} placeholder lets Leaflet load sharper @2x tiles on retina screens.
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    {
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
      subdomains: "abcd",
      maxZoom: 20,
    }
  ).addTo(map);

  // Zoom buttons in the bottom-right corner, like Google Maps. The required
  // attribution keeps its default bottom-right spot — the bottom sheet sits at
  // the bottom-left, so it won't cover the credits.
  L.control.zoom({ position: "bottomright" }).addTo(map);

  // Clicking anywhere on the map sets that point as the destination. This is a
  // handy alternative to typing a search query.
  map.on("click", (event) => {
    const { lat, lng } = event.latlng;
    setDestination(lat, lng, "Dropped pin");
  });
}

/**
 * Place (or move) the ORIGIN marker on the map.
 * @param {number} lat
 * @param {number} lon
 * @param {string} label - a popup label
 */
function placeOriginMarker(lat, lon, label) {
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
    originMarker = L.marker([lat, lon], { icon, title: "Start" }).addTo(map);
  }
  originMarker.bindPopup(`<strong>Start</strong><br>${label}`);
}

/**
 * Place (or move) the DESTINATION marker on the map.
 * @param {number} lat
 * @param {number} lon
 * @param {string} label - a popup label
 */
function placeDestinationMarker(lat, lon, label) {
  // A Google-style red map pin, drawn as an inline SVG so it needs no image file.
  const icon = L.divIcon({
    className: "gm-pin-icon",
    html:
      '<svg width="26" height="38" viewBox="0 0 26 38" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M13 0C5.82 0 0 5.82 0 13c0 9.5 13 25 13 25s13-15.5 13-25C26 5.82 20.18 0 13 0z" fill="#ea4335"/>' +
      '<circle cx="13" cy="13" r="5" fill="#fff"/></svg>',
    iconSize: [26, 38],
    iconAnchor: [13, 38],
    popupAnchor: [0, -34],
  });
  if (destinationMarker) {
    destinationMarker.setLatLng([lat, lon]);
  } else {
    destinationMarker = L.marker([lat, lon], { icon, title: "Destination" }).addTo(map);
  }
  destinationMarker.bindPopup(`<strong>Destination</strong><br>${label}`);
}

/**
 * Draw the route polyline from a list of {lat, lon} points, replacing any
 * existing line, and zoom the map to fit the whole route.
 * @param {Array<{lat:number, lon:number}>} geometry
 */
function drawRoute(geometry) {
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
  map.fitBounds(line.getBounds(), { padding: [60, 60] });
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

  setMapStatus("Locating you…");

  navigator.geolocation.getCurrentPosition(
    // SUCCESS callback.
    async (position) => {
      const { latitude, longitude } = position.coords;
      setMapStatus("");

      // Set this as the origin and center the map there.
      await setOrigin(latitude, longitude, "Your location");
      map.setView([latitude, longitude], 13);
    },
    // ERROR callback — show a friendly message instead of crashing.
    (error) => {
      let message = "Could not get your location.";
      if (error.code === error.PERMISSION_DENIED) {
        message =
          "Location permission denied. You can still search for places or click the map.";
      }
      setMapStatus(message, true);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
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
  placeDestinationMarker(lat, lon, label);

  if (state.origin) {
    await requestRoute();
  } else {
    // No origin yet — nudge the user toward setting one.
    setMapStatus("Destination set. Tap the location button to set your start and get a route.");
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
    state.routeData = result;
    drawRoute(result.geometry);
    setMapStatus("");
  } catch (err) {
    // Don't crash — explain what happened and clear any stale route.
    state.routeData = null;
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


// --- SEARCH -----------------------------------------------------------------

/**
 * Run a geocoding search for the text in the search box and show the results in
 * the dropdown. Debounced by the caller so we respect Nominatim's etiquette.
 * @param {string} query
 */
async function runSearch(query) {
  const trimmed = query.trim();
  const list = el("search-results");

  // Empty (or too-short) query: hide the dropdown and do nothing.
  if (trimmed.length < 3) {
    list.hidden = true;
    list.innerHTML = "";
    return;
  }

  try {
    const results = await geocode(trimmed);
    showSearchResults(results);
  } catch (err) {
    // A failed search shouldn't break the page; show a single info row.
    list.hidden = false;
    list.innerHTML = `<li class="result-detail">Search failed: ${err.message}</li>`;
  }
}

/**
 * Render the geocoding results into the dropdown. Clicking a result sets it as
 * the destination.
 * @param {Array<{name:string, displayName:string, lat:number, lon:number, type:string}>} results
 */
function showSearchResults(results) {
  const list = el("search-results");
  list.innerHTML = "";

  if (!results || results.length === 0) {
    list.hidden = false;
    list.innerHTML = `<li class="result-detail">No matches found.</li>`;
    return;
  }

  for (const place of results) {
    const item = document.createElement("li");

    // A bold short name on top, a quieter full address underneath.
    const name = document.createElement("div");
    name.className = "result-name";
    name.textContent = place.name || place.displayName;

    const detail = document.createElement("div");
    detail.className = "result-detail";
    detail.textContent = place.displayName;

    item.appendChild(name);
    item.appendChild(detail);

    // Clicking a result: hide the dropdown, set the destination, center there.
    item.addEventListener("click", () => {
      list.hidden = true;
      el("search-input").value = place.name || place.displayName;
      map.setView([place.lat, place.lon], 13);
      setDestination(place.lat, place.lon, place.name || place.displayName);
    });

    list.appendChild(item);
  }

  list.hidden = false;
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
  const details = el("route-details");

  // Find (or create) the container that holds the steps heading + list.
  let container = el("route-steps");
  if (!container) {
    container = document.createElement("div");
    container.id = "route-steps";

    const heading = document.createElement("div");
    heading.className = "metric-label";
    heading.textContent = "Turn-by-turn directions";
    heading.style.marginTop = "12px";

    const ol = document.createElement("ol");
    ol.id = "route-steps-list";
    ol.className = "steps-list";

    container.appendChild(heading);
    container.appendChild(ol);
    details.appendChild(container);
  }

  const ol = el("route-steps-list");
  ol.innerHTML = ""; // clear any previous route's steps

  const steps = state.routeData.steps || [];
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

  // Hide the search dropdown when the user clicks elsewhere on the page.
  document.addEventListener("click", (e) => {
    const wrap = document.querySelector(".search-wrap");
    if (wrap && !wrap.contains(e.target)) {
      el("search-results").hidden = true;
    }
  });

  // The bottom sheet's grab handle expands/collapses the panel, like the
  // draggable bottom sheet in Google Maps.
  const sheet = el("sheet");
  const handle = el("sheet-handle");
  if (sheet && handle) {
    handle.addEventListener("click", () => sheet.classList.toggle("expanded"));
  }
}

/**
 * The entry point: set up the map, controls, and the first render. Runs once
 * the HTML has finished parsing.
 */
function init() {
  initMap();
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
