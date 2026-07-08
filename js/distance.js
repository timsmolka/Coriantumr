// ============================================================================
// distance.js — The DISTANCE CONVERSION ENGINE for Science Maps
// ----------------------------------------------------------------------------
// Everything in this file is built around ONE base unit: the METER.
//
// The idea is simple: every length unit we know about is just "some number of
// meters". For example, 1 kilometer is 1000 meters, and 1 inch is 0.0254
// meters. If we store that "meters per unit" number for each unit, then we can
// convert ANY unit to ANY other unit by going through meters as a middle step.
//
//   value_in_meters = value * metersPerUnit
//   value_in_unit   = meters / metersPerUnit
//
// This file is an ES module: it uses `export` so other files can `import` the
// pieces they need.
// ============================================================================


// ----------------------------------------------------------------------------
// DISTANCE_UNITS
// ----------------------------------------------------------------------------
// An object that describes every distance unit the app supports.
//
// It is keyed by a short unit key (like 'km' or 'ly'). Each value is an object:
//   {
//     key:           the short string used to look the unit up (e.g. 'km')
//     label:         the full human-friendly name (e.g. 'kilometer')
//     abbr:          a short abbreviation to show on screen (e.g. 'km')
//     metersPerUnit: how many meters are in ONE of this unit (the magic number)
//     category:      a grouping: 'metric' | 'imperial' | 'light' | 'astronomical'
//   }
//
// The `metersPerUnit` values come from the project's EXACT physical constants.
// ----------------------------------------------------------------------------

/**
 * A lookup table of every supported distance unit.
 *
 * Keyed by unit key. Each entry is
 * `{ key, label, abbr, metersPerUnit, category }`.
 *
 * @type {Object<string, {key: string, label: string, abbr: string, metersPerUnit: number, category: ('metric'|'imperial'|'light'|'astronomical')}>}
 */
export const DISTANCE_UNITS = {
  // --- Metric (based on the meter) -----------------------------------------
  mm: { key: 'mm', label: 'millimeter', abbr: 'mm', metersPerUnit: 0.001, category: 'metric' },
  cm: { key: 'cm', label: 'centimeter', abbr: 'cm', metersPerUnit: 0.01, category: 'metric' },
  m: { key: 'm', label: 'meter', abbr: 'm', metersPerUnit: 1, category: 'metric' },
  km: { key: 'km', label: 'kilometer', abbr: 'km', metersPerUnit: 1000, category: 'metric' },

  // --- Imperial (exact definitions, all derived from 1 inch = 0.0254 m) -----
  in: { key: 'in', label: 'inch', abbr: 'in', metersPerUnit: 0.0254, category: 'imperial' },
  ft: { key: 'ft', label: 'foot', abbr: 'ft', metersPerUnit: 0.3048, category: 'imperial' },
  yd: { key: 'yd', label: 'yard', abbr: 'yd', metersPerUnit: 0.9144, category: 'imperial' },
  mi: { key: 'mi', label: 'mile', abbr: 'mi', metersPerUnit: 1609.344, category: 'imperial' },

  // --- Light (distance light travels in a given time; based on c) -----------
  // c = 299792458 m/s exactly, so light travels that many meters every second.
  lus: { key: 'lus', label: 'light-microsecond', abbr: 'light-us', metersPerUnit: 299.792458, category: 'light' },        // c * 1e-6
  lms: { key: 'lms', label: 'light-millisecond', abbr: 'light-ms', metersPerUnit: 299792.458, category: 'light' },        // c * 1e-3
  ls: { key: 'ls', label: 'light-second', abbr: 'light-s', metersPerUnit: 299792458, category: 'light' },                 // c
  lmin: { key: 'lmin', label: 'light-minute', abbr: 'light-min', metersPerUnit: 17987547480, category: 'light' },         // c * 60
  lhr: { key: 'lhr', label: 'light-hour', abbr: 'light-hr', metersPerUnit: 1079252848800, category: 'light' },            // c * 3600

  // --- Astronomical (huge distances used in space) --------------------------
  au: { key: 'au', label: 'astronomical unit', abbr: 'AU', metersPerUnit: 149597870700, category: 'astronomical' },       // IAU 2012, exact
  ly: { key: 'ly', label: 'light-year', abbr: 'ly', metersPerUnit: 9460730472580800, category: 'astronomical' },          // c * 31557600, exact
};


// ----------------------------------------------------------------------------
// A small private helper to look up a unit and complain loudly if it's missing.
// (Not exported — it's only used inside this file.)
// ----------------------------------------------------------------------------

/**
 * Find the unit definition for a key, or throw a clear error.
 * @param {string} unitKey - e.g. 'km'
 * @returns {{key:string,label:string,abbr:string,metersPerUnit:number,category:string}}
 */
function getUnit(unitKey) {
  const unit = DISTANCE_UNITS[unitKey];
  if (!unit) {
    throw new Error(`Unknown distance unit: "${unitKey}". Valid keys: ${Object.keys(DISTANCE_UNITS).join(', ')}`);
  }
  return unit;
}


// ----------------------------------------------------------------------------
// Core conversions
// ----------------------------------------------------------------------------

/**
 * Convert a value given in meters INTO some other unit.
 *
 * @param {number} meters - the distance in meters
 * @param {string} unitKey - the unit to convert to (e.g. 'km', 'ly')
 * @returns {number} the distance expressed in that unit
 * @example fromMeters(1000, 'km') // => 1
 */
export function fromMeters(meters, unitKey) {
  // To go from meters to a unit, divide by how many meters are in one unit.
  return meters / getUnit(unitKey).metersPerUnit;
}

/**
 * Convert a value given in some unit INTO meters.
 *
 * @param {number} value - the distance in `unitKey` units
 * @param {string} unitKey - the unit the value is currently in (e.g. 'mi')
 * @returns {number} the distance expressed in meters
 * @example toMeters(1, 'km') // => 1000
 */
export function toMeters(value, unitKey) {
  // To go from a unit to meters, multiply by how many meters are in one unit.
  return value * getUnit(unitKey).metersPerUnit;
}

/**
 * Convert a value directly from one unit to another, using meters in between.
 *
 * @param {number} value - the distance in `fromKey` units
 * @param {string} fromKey - the unit the value starts in (e.g. 'mi')
 * @param {string} toKey - the unit you want the answer in (e.g. 'km')
 * @returns {number} the distance expressed in `toKey` units
 * @example convert(1, 'mi', 'km') // => 1.609344
 */
export function convert(value, fromKey, toKey) {
  // Step 1: turn the starting value into meters.
  // Step 2: turn those meters into the target unit.
  return fromMeters(toMeters(value, fromKey), toKey);
}


// ----------------------------------------------------------------------------
// Number formatting helpers (private)
// ----------------------------------------------------------------------------

/**
 * Round a number to a given number of significant figures.
 *
 * Significant figures (rather than fixed decimal places) keep BOTH very small
 * and very large numbers readable. With 4 sig figs:
 *   0.0023456 -> 0.002346      (tiny number, keeps useful digits)
 *   2400000   -> 2400000       (huge number, no fake precision added)
 *
 * @param {number} num - the number to round
 * @param {number} sigFigs - how many significant figures to keep
 * @returns {number} the rounded number
 */
function roundToSigFigs(num, sigFigs) {
  // Zero has no "magnitude", so handle it directly to avoid log10(0) = -Infinity.
  if (num === 0) return 0;

  // Work with the absolute value for the math, then restore the sign at the end.
  const sign = num < 0 ? -1 : 1;
  const abs = Math.abs(num);

  // Find the power of ten of the most significant digit.
  // e.g. for 2345 the magnitude is 3 (because 2345 ~ 2.345 x 10^3).
  const magnitude = Math.floor(Math.log10(abs));

  // The factor lines the number up so we can round to a whole number, then
  // shift it back. (sigFigs - 1 - magnitude) is how many decimal places we keep.
  const factor = Math.pow(10, sigFigs - 1 - magnitude);

  return (sign * Math.round(abs * factor)) / factor;
}

/**
 * Turn a number into a tidy string with thousands separators on the integer
 * part, while preserving any decimal part exactly as given.
 *
 * Examples: 2400000 -> "2,400,000"   0.002346 -> "0.002346"
 *
 * @param {number} num - the (already rounded) number to display
 * @returns {string} the number as a grouped string
 */
function addThousandsSeparators(num) {
  // Split into the integer part and the (optional) decimal part.
  const numStr = String(num);

  // Very large or very small numbers may come out in exponential form (e.g.
  // "9.46073e+12"). Number.prototype.toLocaleString handles those nicely and
  // also adds grouping, so we lean on it but allow plenty of decimal digits.
  if (numStr.includes('e') || numStr.includes('E')) {
    return num.toLocaleString('en-US', { maximumFractionDigits: 20 });
  }

  const [intPart, decPart] = numStr.split('.');

  // Add commas every three digits in the integer part. The regex walks from the
  // right inserting a comma before each group of three digits.
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // Re-attach the decimal part (if there was one).
  return decPart !== undefined ? `${groupedInt}.${decPart}` : groupedInt;
}


// ----------------------------------------------------------------------------
// Human-readable formatting
// ----------------------------------------------------------------------------

/**
 * Format a distance (given in meters) as a friendly string in a chosen unit.
 *
 * @param {number} meters - the distance in meters
 * @param {string} unitKey - the unit to display in (e.g. 'lms', 'ly')
 * @param {Object} [opts] - formatting options
 * @param {number} [opts.sigFigs=4] - significant figures to round to
 * @param {boolean} [opts.withAbbr=true] - append the unit abbreviation
 * @returns {string} a readable string, e.g. "2.4 light-ms" or "1,609 m"
 * @example formatDistance(1609.344, 'lms') // => "0.005368 light-ms"
 */
export function formatDistance(meters, unitKey, opts = {}) {
  // Pull out the options, filling in defaults when they aren't provided.
  const { sigFigs = 4, withAbbr = true } = opts;

  const unit = getUnit(unitKey);

  // Convert into the requested unit, then round to the requested sig figs.
  const valueInUnit = fromMeters(meters, unitKey);
  const rounded = roundToSigFigs(valueInUnit, sigFigs);

  // Make the number pretty (thousands separators, sensible decimals).
  const numberText = addThousandsSeparators(rounded);

  // Optionally tack on the abbreviation, e.g. "1,609 m".
  return withAbbr ? `${numberText} ${unit.abbr}` : numberText;
}


// ----------------------------------------------------------------------------
// Show a distance in EVERY unit at once
// ----------------------------------------------------------------------------

/**
 * Express one distance (in meters) across every supported unit.
 *
 * Handy for a "see this distance in all units" panel.
 *
 * @param {number} meters - the distance in meters
 * @returns {Array<{key: string, label: string, abbr: string, value: number, formatted: string}>}
 *   one entry per unit, in the order they appear in DISTANCE_UNITS
 * @example distanceInAllUnits(1000)
 *   // => [..., { key: 'km', label: 'kilometer', abbr: 'km', value: 1, formatted: '1 km' }, ...]
 */
export function distanceInAllUnits(meters) {
  // Walk through every unit definition and build a row for it.
  return Object.values(DISTANCE_UNITS).map((unit) => ({
    key: unit.key,
    label: unit.label,
    abbr: unit.abbr,
    value: fromMeters(meters, unit.key),
    formatted: formatDistance(meters, unit.key),
  }));
}
