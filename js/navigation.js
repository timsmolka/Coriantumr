// =============================================================================
// navigation.js — the arithmetic behind "Start": where you are along a route,
// what the next turn is, how far is left, and whether you have wandered off.
// -----------------------------------------------------------------------------
// Pure functions on plain data — no map, no page, no GPS — so the whole thing
// can be tested by feeding it made-up positions. app.js supplies real ones.
//
// A route is { geometry: [{lat, lon}, ...], steps: [...] } and each step is
//   { instruction, distanceMeters, durationSeconds, name, location: {lat, lon} }
// where `location` is where that step's manoeuvre happens — the place you turn.
// Step 0 is "head out" and the last one is "arrive".
// =============================================================================

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance between two {lat, lon} points, in metres. */
export function distanceMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * How far a point is from a route line, in metres: the distance to the nearest
 * point on any segment (not just the nearest vertex, which would flag someone
 * driving down a long straight road as "off route" between two points).
 * Works in a flat local approximation, which is exact enough over a few hundred
 * metres — the only scale this is ever asked about.
 */
export function distanceToRoute(geometry, point) {
  if (!geometry || geometry.length === 0) return Infinity;
  if (geometry.length === 1) return distanceMeters(geometry[0], point);
  const kx = Math.cos(toRad(point.lat)) * 111320;    // metres per degree of longitude here
  const ky = 110540;                                  // metres per degree of latitude
  let best = Infinity;
  for (let i = 0; i < geometry.length - 1; i++) {
    const ax = (geometry[i].lon - point.lon) * kx;
    const ay = (geometry[i].lat - point.lat) * ky;
    const bx = (geometry[i + 1].lon - point.lon) * kx;
    const by = (geometry[i + 1].lat - point.lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    // Where along the segment the point's shadow falls, kept within the segment.
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Move the "next turn" marker forward as you pass turns. `next` is the index of
 * the manoeuvre you are heading for. If you are within `reach` metres of it (or
 * of a later one — you may have skipped a fix), it becomes the one after.
 * Never goes past the final step, "arrive".
 */
export function advanceStep(steps, next, position, reach = 35) {
  let n = Math.max(1, next);
  const last = steps.length - 1;
  // Look a few turns ahead, not only at the next: a GPS reading can arrive
  // after the one right by the turn was missed, and being at the later turn
  // means the earlier ones are behind you.
  for (let k = n; k <= Math.min(n + 3, last - 1); k++) {
    if (steps[k].location && distanceMeters(position, steps[k].location) <= reach) n = k + 1;
  }
  return Math.min(n, last);
}

/** True once you are at the final step's location. */
export function hasArrived(steps, position, reach = 30) {
  const last = steps[steps.length - 1];
  return Boolean(last && last.location && distanceMeters(position, last.location) <= reach);
}

/**
 * What is left of the trip from here: the straight run to the next turn, plus
 * every step after it. Time is scaled the same way from each step's own pace.
 */
export function remaining(steps, next, position) {
  const upcoming = steps[Math.min(next, steps.length - 1)];
  const toNext = upcoming && upcoming.location ? distanceMeters(position, upcoming.location) : 0;
  let meters = toNext;
  let seconds = 0;
  // The leg you are on ends at the next turn; its pace is that of the step before it.
  const current = steps[Math.max(0, next - 1)];
  if (current && current.distanceMeters > 0) seconds += (toNext / current.distanceMeters) * current.durationSeconds;
  for (let i = next; i < steps.length; i++) {
    meters += steps[i].distanceMeters || 0;
    seconds += steps[i].durationSeconds || 0;
  }
  return { meters, seconds, toNextMeters: toNext };
}

/** "3:42 PM" for now + a number of seconds. */
export function arrivalClock(seconds, now = new Date()) {
  const at = new Date(now.getTime() + seconds * 1000);
  return at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "12 min", "1 hr 5 min", "45 s". */
export function shortDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (h >= 48) {                                            // a long sea crossing: days and hours
    const d = Math.floor(h / 24), rest = h % 24;
    return rest ? `${d} d ${rest} hr` : `${d} d`;
  }
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** A big arrow to go with an instruction, picked from the words in it. */
export function arrowFor(instruction) {
  const t = String(instruction || "").toLowerCase();
  if (t.includes("arrive")) return "📍";
  if (t.includes("roundabout") || t.includes("rotary")) return "⟳";
  if (t.includes("u-turn") || t.includes("uturn")) return "↶";
  if (t.includes("sharp left")) return "↰";
  if (t.includes("sharp right")) return "↱";
  if (t.includes("slight left") || t.includes("keep left")) return "↖";
  if (t.includes("slight right") || t.includes("keep right")) return "↗";
  if (t.includes("left")) return "↰";
  if (t.includes("right")) return "↱";
  return "↑";
}

/** "300 ft" / "0.4 mi" style words for a short distance to the next turn. */
export function nextTurnDistance(meters) {
  const feet = meters * 3.28084;
  if (feet < 1000) return `${Math.max(10, Math.round(feet / 10) * 10)} ft`;
  return `${(meters / 1609.344).toFixed(meters < 16093 ? 1 : 0)} mi`;
}
