// =============================================================================
// units.js  —  SMART UNIT MODE
// =============================================================================
//
// THE SMART-MODE PHILOSOPHY
// -------------------------
// Numbers are easiest to understand when their magnitude is small and friendly.
// "384,400,000 m" is technically correct but hard to feel; "1.28 light-seconds"
// is the same distance expressed at a scale a human can picture. So this module
// answers one question for any raw value:
//
//     "Given this distance/speed, which unit makes the number most readable?"
//
// We do that by walking up a ladder of unit thresholds: tiny things use cm,
// room-sized things use m, neighborhoods use light-microseconds, and so on up to
// interstellar light-years. Each rung is chosen so the displayed number stays in
// a comfortable range (roughly single to triple digits) instead of exploding
// into scientific notation.
//
// Smart mode is deliberately "scientific-flavored": it reaches for light-based
// units (light-microseconds, light-milliseconds, light-seconds, light-years) and
// astronomical units, because the whole point of Science Maps is to show the
// universe's yardsticks alongside everyday travel.
//
// THE FAMILIAR-UNIT COMPANION
// ---------------------------
// A clever unit is useless if the reader can't anchor it to something they know.
// So every smart value is meant to be shown ABOVE a familiar one:
//
//     1.28 light-seconds        <- smart  (primary line)
//     238,855 mi                <- familiar (second line)
//
// The familiar* functions below pick that down-to-earth companion unit (feet or
// miles for distance, miles-per-hour for speed). The UI stacks the two lines
// using pairDisplay(). Result: always-readable magnitudes on top, always-relatable
// reference underneath.
//
// IMPORTANT: This module imports NOTHING. It only returns unit *keys* (short
// strings like 'lus' or 'mach'). Those keys must match the unit definitions in
// distance.js and speed.js, which do the actual number conversion + formatting.
// =============================================================================


// -----------------------------------------------------------------------------
// DISTANCE — SMART UNIT
// -----------------------------------------------------------------------------

/**
 * Pick the most meaningful distance unit KEY for a given length.
 *
 * Walks a ladder of scale thresholds (from centimeters up to light-years) and
 * returns the key whose typical displayed magnitude is most readable. The
 * returned string is a unit key understood by distance.js, not a converted value.
 *
 * Thresholds (meters):
 *   < 0.3        -> 'cm'   centimeters        (very small lengths)
 *   < 100        -> 'm'    meters             (rooms, buildings)
 *   < 5000       -> 'lus'  light-microseconds (the "scientific small distance")
 *   < 300000     -> 'mi'   miles              (city distances)
 *   < 9e6        -> 'lms'  light-milliseconds (regional)
 *   < 1.5e9      -> 'ls'   light-seconds      (Earth-Moon ~ 1.28 light-s)
 *   < 1.5e13     -> 'au'   astronomical units (planetary)
 *   otherwise    -> 'ly'   light-years        (interstellar)
 *
 * @param {number} meters - The distance in meters.
 * @returns {string} A distance unit key ('cm' | 'm' | 'lus' | 'mi' | 'lms' | 'ls' | 'au' | 'ly').
 */
export function smartDistanceUnit(meters) {
  if (meters < 0.3)    return 'cm';   // sub-30 cm: show in centimeters
  if (meters < 100)    return 'm';    // up to 100 m: plain meters
  if (meters < 5000)   return 'lus';  // up to 5 km: light-microseconds
  if (meters < 300000) return 'mi';   // up to 300 km: miles (city scale)
  if (meters < 9e6)    return 'lms';  // up to 9,000 km: light-milliseconds (regional)
  if (meters < 1.5e9)  return 'ls';   // up to 1.5 million km: light-seconds (Earth-Moon)
  if (meters < 1.5e13) return 'au';   // up to ~100 AU: astronomical units (planetary)
  return 'ly';                        // beyond that: light-years (interstellar)
}

/**
 * Pick the familiar (everyday) distance unit KEY shown underneath the smart unit.
 *
 * Uses feet for short distances and switches to miles past roughly a quarter mile
 * (402 m ~ 1320 ft), so the companion line never shows an awkward number of feet.
 *
 * @param {number} meters - The distance in meters.
 * @returns {string} 'ft' if under ~quarter mile, otherwise 'mi'.
 */
export function familiarDistanceUnit(meters) {
  return meters < 402 ? 'ft' : 'mi';
}


// -----------------------------------------------------------------------------
// SPEED — SMART UNIT
// -----------------------------------------------------------------------------

// Speed of light in meters per second. 1% of c is the threshold at which we
// switch to showing speeds as a percentage of light speed.
const ONE_PERCENT_OF_C = 2.997925e6; // m/s  (1% of 299,792,458 m/s)

/**
 * Pick the most meaningful speed unit KEY for a given speed.
 *
 * Thresholds (meters per second):
 *   >= 2.997925e6 (>= 1% c) -> 'pct_c'  percent of light speed (relativistic)
 *   >= 0.5                   -> 'mach'   Mach number (everyday speeds, per spec example)
 *   otherwise                -> 'mps'    meters per second (very slow / near-still)
 *
 * Everyday speeds are intentionally shown as Mach numbers to match the Science
 * Maps spec: it keeps the "scientific" flavor even for a walk or a car ride.
 *
 * @param {number} mps - The speed in meters per second.
 * @returns {string} A speed unit key ('pct_c' | 'mach' | 'mps').
 */
export function smartSpeedUnit(mps) {
  if (mps >= ONE_PERCENT_OF_C) return 'pct_c'; // 1% of light speed or faster
  if (mps >= 0.5)              return 'mach';   // everyday speeds shown as Mach
  return 'mps';                                 // very slow: plain meters/second
}

/**
 * Pick the familiar (everyday) speed unit KEY shown underneath the smart unit.
 *
 * Always miles-per-hour: it's the speed everyone has an instinct for, so it makes
 * the most relatable companion line regardless of how fast the smart unit reports.
 *
 * @param {number} mps - The speed in meters per second (unused; kept for a
 *   consistent signature with the other smart/familiar pairs).
 * @returns {string} Always 'mph'.
 */
export function familiarSpeedUnit(mps) {
  return 'mph';
}


// -----------------------------------------------------------------------------
// DISPLAY HELPER
// -----------------------------------------------------------------------------

/**
 * Bundle a smart (primary) string and a familiar (companion) string for the UI.
 *
 * This is a trivial passthrough object — it exists so the rendering code has one
 * obvious shape to expect for the two-line "smart on top, familiar underneath"
 * display, instead of juggling loose arguments.
 *
 * @param {string} primaryFormatted  - Already-formatted smart-unit string (e.g. "1.28 light-seconds").
 * @param {string} familiarFormatted - Already-formatted familiar-unit string (e.g. "238,855 mi").
 * @returns {{ primary: string, familiar: string }} Object ready for the UI to render.
 */
export function pairDisplay(primaryFormatted, familiarFormatted) {
  return { primary: primaryFormatted, familiar: familiarFormatted };
}
