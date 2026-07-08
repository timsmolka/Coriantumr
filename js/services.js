// =============================================================================
// services.js  —  Network services for Science Maps
// =============================================================================
//
// This module wraps every external network call the app makes. Every service
// here is FREE and KEYLESS: there are no API keys, tokens, or sign-ups
// anywhere. We rely only on public, CORS-enabled endpoints that a browser can
// call directly with `fetch()` (no proxy/server needed):
//
//   - Nominatim  (OpenStreetMap)   -> search & reverse geocoding
//   - OSRM demo  (project-osrm.org)-> turn-by-turn routing
//   - Open-Meteo (open-meteo.com)  -> live weather (for speed-of-sound math)
//
// "CORS-enabled" means these servers send the right `Access-Control-Allow-*`
// headers, so the browser is allowed to read their responses from our page.
// That is what lets a pure static site (no build step, no backend) talk to
// them safely.
//
// Each exported function returns a CLEAN, NORMALIZED object (the same shape no
// matter what the raw API gives back) and THROWS a clear Error when something
// goes wrong, so the rest of the app can rely on predictable data.
//
// This file is a native ES module: it uses `export` so other modules can
// `import` from it. No bundler or framework is involved.
// =============================================================================


// -----------------------------------------------------------------------------
// WMO weather interpretation codes
// -----------------------------------------------------------------------------
// Open-Meteo reports the current weather as a numeric "weather_code" that
// follows the WMO (World Meteorological Organization) standard. These numbers
// are not human-friendly on their own, so we map each one to a short
// description. (Not every WMO code is used by Open-Meteo; we cover the common
// ones plus a few extras.)
export const WMO_DESCRIPTIONS = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snowfall",
  73: "Moderate snowfall",
  75: "Heavy snowfall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};


// -----------------------------------------------------------------------------
// fetchJson — the small helper every service uses internally
// -----------------------------------------------------------------------------
/**
 * Fetch a URL and parse the response as JSON.
 *
 * This is the single place where we talk to the network. It centralizes our
 * error handling: if the HTTP response is not OK (status outside 200–299),
 * we throw a clear Error that includes the status code and status text, so
 * callers never have to second-guess whether the data is valid.
 *
 * @param {string} url - The full URL to request.
 * @param {RequestInit} [options] - Optional `fetch` options (headers, etc.).
 * @returns {Promise<any>} The parsed JSON body.
 * @throws {Error} If the network request fails or the status is not OK.
 */
export async function fetchJson(url, options) {
  // `fetch` itself only rejects on network-level failures (e.g. offline,
  // DNS error, CORS block). It does NOT reject on HTTP errors like 404 or 500,
  // so we have to check `res.ok` ourselves below.
  const res = await fetch(url, options);

  if (!res.ok) {
    // `res.ok` is true only for 2xx statuses. Anything else is a problem.
    throw new Error(`Request failed: ${res.status} ${res.statusText} (${url})`);
  }

  return res.json();
}


// -----------------------------------------------------------------------------
// geocode — turn a text query into a list of places (search)
// -----------------------------------------------------------------------------
/**
 * Search for places by free-text query using Nominatim (OpenStreetMap).
 *
 * Endpoint (keyless, CORS-enabled):
 *   GET https://nominatim.openstreetmap.org/search
 *       ?format=jsonv2&limit=5&addressdetails=1&q=<query>
 *
 * We send an `Accept-Language` header (when the browser exposes one) so place
 * names come back in the user's preferred language where possible.
 *
 * @param {string} query - The text to search for (e.g. "Eiffel Tower").
 * @returns {Promise<Array<{name: string, displayName: string, lat: number, lon: number, type: string}>>}
 *   A list of up to 5 matches. Returns an empty array if nothing is found.
 * @throws {Error} If the network request fails or returns a non-OK status.
 */
export async function geocode(query) {
  // Build the URL. We always encode the user's query so special characters
  // (spaces, &, #, etc.) don't break the request.
  const url =
    "https://nominatim.openstreetmap.org/search" +
    "?format=jsonv2" +
    "&limit=5" +
    "&addressdetails=1" +
    "&q=" +
    encodeURIComponent(query);

  // Nominatim's usage policy appreciates an Accept-Language header. We only add
  // it if the browser actually tells us a language (it usually does).
  const options = {};
  if (typeof navigator !== "undefined" && navigator.language) {
    options.headers = { "Accept-Language": navigator.language };
  }

  const data = await fetchJson(url, options);

  // Nominatim returns an array of result objects. If it's empty (or somehow not
  // an array), return [] so callers can safely do `results.length`.
  if (!Array.isArray(data) || data.length === 0) {
    return [];
  }

  // Normalize each raw result into our clean shape. Nominatim gives `lat`/`lon`
  // as STRINGS, so we convert them to numbers with parseFloat.
  return data.map((item) => ({
    // A short label. Nominatim's `name` is sometimes empty for addresses, so we
    // fall back to the first chunk of the full display string.
    name: item.name || (item.display_name ? item.display_name.split(",")[0] : ""),
    displayName: item.display_name || "",
    lat: parseFloat(item.lat),
    lon: parseFloat(item.lon),
    // e.g. "city", "restaurant", "peak" — handy for showing an icon/label.
    type: item.type || "",
  }));
}


// -----------------------------------------------------------------------------
// reverseGeocode — turn coordinates back into a place name (optional nicety)
// -----------------------------------------------------------------------------
/**
 * Look up a human-readable address for a latitude/longitude pair.
 *
 * Endpoint (keyless, CORS-enabled):
 *   GET https://nominatim.openstreetmap.org/reverse
 *       ?format=jsonv2&lat=<lat>&lon=<lon>
 *
 * This is a small convenience used, for example, when the user clicks a point
 * on the map and we want to show "where" that is in words.
 *
 * @param {number} lat - Latitude in decimal degrees.
 * @param {number} lon - Longitude in decimal degrees.
 * @returns {Promise<{displayName: string}>} The best-guess address string.
 * @throws {Error} If the network request fails or returns a non-OK status.
 */
export async function reverseGeocode(lat, lon) {
  const url =
    "https://nominatim.openstreetmap.org/reverse" +
    "?format=jsonv2" +
    "&lat=" +
    encodeURIComponent(lat) +
    "&lon=" +
    encodeURIComponent(lon);

  // Same language courtesy header as geocode().
  const options = {};
  if (typeof navigator !== "undefined" && navigator.language) {
    options.headers = { "Accept-Language": navigator.language };
  }

  const data = await fetchJson(url, options);

  // The reverse endpoint returns a single object with `display_name`.
  return {
    displayName: data.display_name || "",
  };
}


// -----------------------------------------------------------------------------
// route — get a driving route (distance, time, geometry, turn-by-turn steps)
// -----------------------------------------------------------------------------
/**
 * Compute a route between two points using the public OSRM demo server.
 *
 * Endpoint (keyless, CORS-enabled):
 *   GET https://router.project-osrm.org/route/v1/<profile>/
 *       <from.lon>,<from.lat>;<to.lon>,<to.lat>
 *       ?overview=full&geometries=geojson&steps=true
 *
 * IMPORTANT: OSRM expects coordinates in LON,LAT order (longitude first),
 * which is the opposite of the usual "lat, lon" we say out loud. We handle
 * that ordering here so the rest of the app can keep thinking in {lat, lon}.
 *
 * NOTE: The free public OSRM demo server only hosts the CAR ("driving")
 * profile. So even if you pass profile='walking' or 'cycling', the server
 * effectively falls back to CAR routing. The parameter is kept for forward
 * compatibility in case the app later points at a self-hosted OSRM.
 *
 * @param {{lat: number, lon: number}} from - Start point.
 * @param {{lat: number, lon: number}} to - Destination point.
 * @param {string} [profile='driving'] - OSRM profile (see note above).
 * @returns {Promise<{
 *   distanceMeters: number,
 *   durationSeconds: number,
 *   geometry: Array<{lat: number, lon: number}>,
 *   rawGeoJSON: {type: string, coordinates: Array<[number, number]>},
 *   steps: Array<{instruction: string, distanceMeters: number, durationSeconds: number, name: string}>
 * }>}
 * @throws {Error} If the request fails or no route is found.
 */
export async function route(from, to, profile = "driving") {
  // OSRM wants "lon,lat;lon,lat". Note the longitude-first ordering.
  const coordinates =
    `${from.lon},${from.lat};${to.lon},${to.lat}`;

  const url =
    "https://router.project-osrm.org/route/v1/" +
    encodeURIComponent(profile) +
    "/" +
    coordinates +
    "?overview=full" + // give us the whole route geometry, not a simplified one
    "&geometries=geojson" + // return geometry as GeoJSON coordinates
    "&steps=true"; // include turn-by-turn maneuvers

  const data = await fetchJson(url);

  // If OSRM can't find a route it returns code "NoRoute" and/or an empty
  // routes array. Either way, we throw so the caller can show a friendly error.
  if (!data.routes || data.routes.length === 0) {
    throw new Error("No route found between the two points.");
  }

  // Use the first (best) route OSRM returned.
  const best = data.routes[0];

  // The raw GeoJSON LineString: coordinates are [lon, lat] pairs.
  const rawGeoJSON = best.geometry;

  // Leaflet (and humans) prefer {lat, lon}. Convert each [lon, lat] pair.
  const geometry = (rawGeoJSON.coordinates || []).map(([lon, lat]) => ({
    lat,
    lon,
  }));

  // A route is split into "legs" (one per via-point); each leg has "steps"
  // (individual maneuvers). We have only one leg here (A -> B), but we flatten
  // across all legs to be safe, building a readable instruction for each step.
  const steps = [];
  for (const leg of best.legs || []) {
    for (const step of leg.steps || []) {
      steps.push({
        instruction: buildInstruction(step),
        distanceMeters: step.distance,
        durationSeconds: step.duration,
        // The road/street name for this step (may be empty for unnamed roads).
        name: step.name || "",
      });
    }
  }

  return {
    distanceMeters: best.distance, // total route distance in meters
    durationSeconds: best.duration, // total estimated time in seconds
    geometry, // [{lat, lon}, ...] — easy to drop into Leaflet
    rawGeoJSON, // original [lon, lat] GeoJSON, in case it's needed
    steps, // flattened, human-readable turn-by-turn list
  };
}


/**
 * Turn one OSRM "maneuver" into a readable instruction like
 * "Turn left onto Main St" or "Arrive at your destination".
 *
 * OSRM describes each maneuver with a `type` (e.g. "turn", "depart",
 * "arrive", "roundabout") and often a `modifier` (e.g. "left", "right",
 * "slight left"). We combine those with the road name to make a sentence.
 * This is intentionally simple and readable rather than exhaustive.
 *
 * @param {object} step - One OSRM step object (has `.maneuver` and `.name`).
 * @returns {string} A human-friendly instruction.
 */
function buildInstruction(step) {
  const maneuver = step.maneuver || {};
  const type = maneuver.type || "";
  const modifier = maneuver.modifier || ""; // e.g. "left", "right", "straight"
  const road = step.name || ""; // street/road name, may be empty

  // "onto <road>" only makes sense when we actually know the road name.
  const onto = road ? ` onto ${road}` : "";

  switch (type) {
    case "depart":
      // Start of the trip.
      return road ? `Head out on ${road}` : "Head out";

    case "arrive":
      // End of the trip. A modifier can say which side the destination is on.
      if (modifier) {
        return `Arrive at your destination (on the ${modifier})`;
      }
      return "Arrive at your destination";

    case "turn":
      // The most common maneuver: "Turn left onto Main St".
      return `Turn ${modifier || "ahead"}${onto}`;

    case "new name":
      // The road changes name but you keep going straight.
      return road ? `Continue onto ${road}` : "Continue straight";

    case "continue":
      return modifier
        ? `Continue ${modifier}${onto}`
        : `Continue${onto}`;

    case "merge":
      return `Merge${modifier ? ` ${modifier}` : ""}${onto}`;

    case "on ramp":
      return `Take the ramp${onto}`;

    case "off ramp":
      return `Take the exit${onto}`;

    case "fork":
      return `Keep ${modifier || "ahead"} at the fork${onto}`;

    case "roundabout":
    case "rotary":
      // `exit` (1-based) tells which exit to take, when provided.
      if (maneuver.exit) {
        return `At the roundabout, take exit ${maneuver.exit}${onto}`;
      }
      return `Enter the roundabout${onto}`;

    case "end of road":
      return `At the end of the road, turn ${modifier || "ahead"}${onto}`;

    default:
      // Fallback for any maneuver type we didn't explicitly handle.
      if (modifier) {
        return `Continue ${modifier}${onto}`;
      }
      return road ? `Continue on ${road}` : "Continue";
  }
}


// -----------------------------------------------------------------------------
// getWeather — fetch live conditions used for the speed-of-sound calculation
// -----------------------------------------------------------------------------
/**
 * Fetch current weather for a coordinate from Open-Meteo.
 *
 * Endpoint (keyless, CORS-enabled):
 *   GET https://api.open-meteo.com/v1/forecast
 *       ?latitude=<lat>&longitude=<lon>
 *       &current=temperature_2m,relative_humidity_2m,surface_pressure,
 *                wind_speed_10m,weather_code
 *       &wind_speed_unit=ms&timezone=auto
 *
 * We ask for `wind_speed_unit=ms` so wind comes back in meters per second
 * (handy for physics) and `timezone=auto` so the observation timestamp is in
 * local time for the queried location.
 *
 * The values returned here (especially temperature and humidity) are what the
 * app uses to compute the LOCAL speed of sound.
 *
 * @param {number} lat - Latitude in decimal degrees.
 * @param {number} lon - Longitude in decimal degrees.
 * @returns {Promise<{
 *   temperatureC: number,
 *   humidity: number,
 *   pressureHpa: number,
 *   elevationM: number,
 *   windSpeedMps: number,
 *   weatherCode: number,
 *   description: string,
 *   observedAt: string
 * }>}
 * @throws {Error} If the request fails or returns a non-OK status.
 */
export async function getWeather(lat, lon) {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    "?latitude=" +
    encodeURIComponent(lat) +
    "&longitude=" +
    encodeURIComponent(lon) +
    "&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,weather_code" +
    "&wind_speed_unit=ms" + // wind in meters/second
    "&timezone=auto"; // timestamps in the location's local time

  const data = await fetchJson(url);

  // `current` holds the live readings; `elevation` sits at the top level.
  const current = data.current || {};
  const weatherCode = current.weather_code;

  return {
    temperatureC: current.temperature_2m, // air temperature in Celsius
    humidity: current.relative_humidity_2m, // relative humidity in percent
    pressureHpa: current.surface_pressure, // surface air pressure in hectopascals
    elevationM: data.elevation, // ground elevation in meters
    windSpeedMps: current.wind_speed_10m, // wind speed in meters/second
    weatherCode: weatherCode, // raw WMO code
    // Look up a friendly description; fall back gracefully if it's unknown.
    description: WMO_DESCRIPTIONS[weatherCode] || "Unknown",
    observedAt: current.time || "", // ISO-8601 local timestamp of the reading
  };
}
