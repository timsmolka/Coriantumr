/**
 * estimates.js — the ways of travelling no free routing service covers: by air
 * and by boat.
 *
 * There is no free source of flight schedules or of shipping lanes, so these are
 * not routes, they are ESTIMATES, and the app says so wherever they show. The
 * path is the shortest one over the globe (a great circle — the curve you see on
 * an airline's route map) and the time is the distance at a typical speed. A
 * boat is drawn the same way, and cannot know where land is.
 *
 * Pure functions, no network and no page.
 */

import { distanceMeters } from "./navigation.js";

/**
 * The estimated modes: how fast they go, how far a trip must be before Google
 * would offer them, and the words to use.
 */
export const ESTIMATE_MODES = {
  flight: {
    label: "Flight",
    verb: "Fly",
    minMeters: 300_000,           // shorter than this, nobody flies
    speedMps: 830 / 3.6,          // a jet's cruising speed
    extraSeconds: 25 * 60,        // climbing and coming down
    note: "Flight is an estimate: a straight path over the globe at jet speed. There are no timetables here, and it does not include the airport.",
  },
  boat: {
    label: "Boat",
    verb: "Sail",
    minMeters: 100_000,           // a boat trip worth estimating is a long one
    speedMps: 35 / 3.6,           // a fast ferry
    extraSeconds: 0,
    note: "Boat is a rough estimate: a straight line at ferry speed. It cannot see land, so use it only across open water.",
  },
};

/** Is this one of the estimated modes? */
export const isEstimateMode = (mode) => Object.prototype.hasOwnProperty.call(ESTIMATE_MODES, mode);

/** Is that way of travelling worth offering for a trip of this many metres? */
export function estimateAvailable(mode, meters) {
  return isEstimateMode(mode) && Number.isFinite(meters) && meters >= ESTIMATE_MODES[mode].minMeters;
}

/**
 * Points along the great circle from one place to the other, longitudes kept
 * continuous (they may pass 180) so that the line is drawn in one piece.
 * @returns {Array<{lat:number, lon:number}>}
 */
export function greatCirclePath(from, to, count = 96) {
  const rad = Math.PI / 180;
  const p1 = from.lat * rad, l1 = from.lon * rad, p2 = to.lat * rad, l2 = to.lon * rad;
  const angle = 2 * Math.asin(Math.min(1, Math.sqrt(
    Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2)));
  const s = Math.sin(angle);
  if (!(s > 1e-9)) return [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }];
  const path = [];
  let lastLon = from.lon;
  for (let i = 0; i <= count; i++) {
    const f = i / count;
    const a = Math.sin((1 - f) * angle) / s, b = Math.sin(f * angle) / s;
    const x = a * Math.cos(p1) * Math.cos(l1) + b * Math.cos(p2) * Math.cos(l2);
    const y = a * Math.cos(p1) * Math.sin(l1) + b * Math.cos(p2) * Math.sin(l2);
    const z = a * Math.sin(p1) + b * Math.sin(p2);
    const lat = Math.atan2(z, Math.hypot(x, y)) / rad;
    let lon = Math.atan2(y, x) / rad;
    while (lon - lastLon > 180) lon -= 360;      // keep it continuous across the date line
    while (lon - lastLon < -180) lon += 360;
    lastLon = lon;
    path.push({ lat, lon });
  }
  return path;
}

/** The way to head at the start, in words: "north-east". */
export function compassWord(from, to) {
  const rad = Math.PI / 180;
  const dl = (to.lon - from.lon) * rad;
  const y = Math.sin(dl) * Math.cos(to.lat * rad);
  const x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad) - Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos(dl);
  const bearing = (Math.atan2(y, x) / rad + 360) % 360;
  return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(bearing / 45) % 8];
}

/** How long the trip would take by this estimated mode, in seconds. */
export function estimateSeconds(mode, meters) {
  const m = ESTIMATE_MODES[mode];
  return m.extraSeconds + meters / m.speedMps;
}

/**
 * A trip in the same shape as a real route (see services.js), so everything that
 * draws or lists one works on it — plus `estimate: true`, so it is never mistaken
 * for a real one.
 */
export function estimateTrip(from, to, mode) {
  const m = ESTIMATE_MODES[mode];
  const meters = distanceMeters(from, to);
  const seconds = estimateSeconds(mode, meters);
  const geometry = greatCirclePath(from, to);
  const heading = compassWord(from, to);
  return {
    distanceMeters: meters,
    durationSeconds: seconds,
    geometry,
    rawGeoJSON: { type: "LineString", coordinates: geometry.map((p) => [p.lon, p.lat]) },
    steps: [
      { instruction: `${m.verb} ${heading}, straight to your destination`, distanceMeters: meters, durationSeconds: seconds, name: "", location: { lat: from.lat, lon: from.lon } },
      { instruction: "Arrive at your destination", distanceMeters: 0, durationSeconds: 0, name: "", location: { lat: to.lat, lon: to.lon } },
    ],
    via: "",
    estimate: true,
    mode,
    alternatives: [],
  };
}
