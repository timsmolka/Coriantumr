// =============================================================================
// speed.js — The SPEED CONVERSION ENGINE for Science Maps
// =============================================================================
//
// This module converts speeds between everyday units (mph, km/h) and
// scientific units (Mach, percent of light speed, etc.).
//
// THE BIG IDEA: pick ONE "base unit" and convert everything through it.
// Our base unit is METERS PER SECOND (m/s) — the SI unit of speed.
//
//   - To go FROM m/s TO some unit:  divide by that unit's size in m/s.
//   - To go FROM some unit TO m/s:  multiply by that unit's size in m/s.
//
// Each unit below stores "mpsPerUnit" = how many m/s ONE of that unit equals.
// Example: 1 mph = 0.44704 m/s, so SPEED_UNITS.mph.mpsPerUnit = 0.44704.
//
// SPECIAL CASE — Mach: the speed of sound is NOT constant. It changes with
// air temperature (and therefore with the weather). So "mach" is marked
// `dynamic: true`. Its stored mpsPerUnit (340.29) is only a sensible DEFAULT
// (the ISA sea-level value at 15 C). When we know the real local speed of
// sound, we pass it in via `opts.speedOfSound` and use that instead.
// =============================================================================

/**
 * The catalog of every speed unit this app understands.
 *
 * Each entry has the shape:
 *   {
 *     key:        string  // short id used in code (matches the object key)
 *     label:      string  // human-friendly full name
 *     abbr:       string  // short symbol shown in the UI
 *     mpsPerUnit: number  // how many meters/second ONE of this unit equals
 *     dynamic?:   boolean // true if mpsPerUnit can change at run time (Mach)
 *   }
 *
 * @type {Readonly<Record<string, {key:string,label:string,abbr:string,mpsPerUnit:number,dynamic?:boolean}>>}
 */
export const SPEED_UNITS = {
  // ---- Everyday units --------------------------------------------------------
  mph:   { key: 'mph',   label: 'miles per hour',       abbr: 'mph',  mpsPerUnit: 0.44704 },
  kmh:   { key: 'kmh',   label: 'kilometers per hour',  abbr: 'km/h', mpsPerUnit: 1000 / 3600 }, // = 0.2777777777777778
  mps:   { key: 'mps',   label: 'meters per second',    abbr: 'm/s',  mpsPerUnit: 1 },
  fps:   { key: 'fps',   label: 'feet per second',      abbr: 'ft/s', mpsPerUnit: 0.3048 },

  // ---- Fast everyday / engineering units ------------------------------------
  mi_s:  { key: 'mi_s',  label: 'miles per second',     abbr: 'mi/s', mpsPerUnit: 1609.344 },
  km_s:  { key: 'km_s',  label: 'kilometers per second',abbr: 'km/s', mpsPerUnit: 1000 },

  // ---- Scientific units ------------------------------------------------------
  // Mach is DYNAMIC: 340.29 m/s is just the default (ISA sea level, 15 C).
  // The real local speed of sound is supplied via opts.speedOfSound.
  mach:  { key: 'mach',  label: 'Mach number',          abbr: 'Mach', mpsPerUnit: 340.29, dynamic: true },

  // 1 %c = 1% of the speed of light = 0.01 * 299792458 = 2997924.58 m/s (exact).
  pct_c: { key: 'pct_c', label: 'percent of light speed',abbr: '%c',  mpsPerUnit: 2997924.58 },
};

// -----------------------------------------------------------------------------
// Internal helper: look up a unit and figure out its "size" in m/s right now.
// -----------------------------------------------------------------------------

/**
 * Find a unit definition by its key, throwing a clear error if it is unknown.
 *
 * @param {string} unitKey - one of the keys in SPEED_UNITS (e.g. 'mph').
 * @returns {{key:string,label:string,abbr:string,mpsPerUnit:number,dynamic?:boolean}}
 */
function getUnit(unitKey) {
  const unit = SPEED_UNITS[unitKey];
  if (!unit) {
    throw new Error(`Unknown speed unit: "${unitKey}". Valid keys: ${Object.keys(SPEED_UNITS).join(', ')}`);
  }
  return unit;
}

/**
 * Work out how many m/s ONE of the given unit equals RIGHT NOW.
 *
 * For normal units this is just the fixed `mpsPerUnit`. For the dynamic
 * 'mach' unit we use the live speed of sound when one is supplied.
 *
 * @param {string} unitKey - the unit to size.
 * @param {{speedOfSound?: number}} [opts] - optional settings.
 *   opts.speedOfSound — the real local speed of sound in m/s (used for Mach only).
 * @returns {number} how many m/s one of this unit currently equals.
 */
function metersPerSecondPerUnit(unitKey, opts = {}) {
  const unit = getUnit(unitKey);

  // Only the dynamic Mach unit cares about the live speed of sound.
  if (unit.dynamic && unitKey === 'mach') {
    // Use the supplied speed of sound if it is a sensible positive number;
    // otherwise fall back to the ISA sea-level default stored on the unit.
    const sos = opts.speedOfSound;
    return (typeof sos === 'number' && sos > 0) ? sos : unit.mpsPerUnit;
  }

  return unit.mpsPerUnit;
}

// -----------------------------------------------------------------------------
// Core conversion functions
// -----------------------------------------------------------------------------

/**
 * Convert a speed FROM meters/second INTO some other unit.
 *
 * @param {number} mps - the speed in meters per second.
 * @param {string} unitKey - the target unit's key (e.g. 'mph', 'mach').
 * @param {{speedOfSound?: number}} [opts] - optional settings (speedOfSound for Mach).
 * @returns {number} the speed expressed in the requested unit.
 *
 * @example
 * fromMps(31.2928, 'mph');                       // 70
 * fromMps(31.2928, 'mach', {speedOfSound: 343}); // ~0.0912
 */
export function fromMps(mps, unitKey, opts = {}) {
  return mps / metersPerSecondPerUnit(unitKey, opts);
}

/**
 * Convert a speed FROM some unit INTO meters/second.
 *
 * @param {number} value - the speed expressed in `unitKey`.
 * @param {string} unitKey - the source unit's key (e.g. 'mph', 'mach').
 * @param {{speedOfSound?: number}} [opts] - optional settings (speedOfSound for Mach).
 * @returns {number} the speed in meters per second.
 *
 * @example
 * toMps(70, 'mph');   // 31.2928
 * toMps(1, 'pct_c');  // 2997924.58
 */
export function toMps(value, unitKey, opts = {}) {
  return value * metersPerSecondPerUnit(unitKey, opts);
}

/**
 * Convert a speed directly from one unit to another.
 *
 * Internally this just hops through the base unit (m/s):
 *   value -> m/s -> target unit.
 *
 * @param {number} value - the speed expressed in `fromKey`.
 * @param {string} fromKey - the source unit's key.
 * @param {string} toKey - the target unit's key.
 * @param {{speedOfSound?: number}} [opts] - optional settings (speedOfSound for Mach).
 * @returns {number} the speed expressed in `toKey`.
 *
 * @example
 * convert(70, 'mph', 'kmh'); // ~112.654
 */
export function convert(value, fromKey, toKey, opts = {}) {
  const mps = toMps(value, fromKey, opts);
  return fromMps(mps, toKey, opts);
}

// -----------------------------------------------------------------------------
// Formatting helpers
// -----------------------------------------------------------------------------

/**
 * Round a number to a given count of SIGNIFICANT FIGURES, then drop any
 * trailing zeros so the result reads cleanly.
 *
 * Significant figures (not decimal places) keep both tiny and huge numbers
 * readable: 0.0912 and 2997925 each show a similar amount of useful detail.
 *
 * @param {number} n - the number to round.
 * @param {number} sigFigs - how many significant figures to keep (>= 1).
 * @returns {string} the rounded number as a plain string (e.g. "0.0912").
 */
function toSignificant(n, sigFigs) {
  // Zero (and anything not finite) has no meaningful "significant figures";
  // just hand back a simple, safe string.
  if (!Number.isFinite(n) || n === 0) {
    return String(n);
  }

  // Number.prototype.toPrecision does the actual sig-fig rounding for us.
  // It may return scientific notation (e.g. "3.00e+6") for very large/small
  // numbers; Number(...) turns that back into a normal number, and String(...)
  // then prints it without trailing zeros (3000000 instead of "3.00e+6").
  const rounded = Number(n.toPrecision(sigFigs));
  return String(rounded);
}

/**
 * Format a speed (given in m/s) as a friendly string in the chosen unit.
 *
 * Mach is written with the word "Mach" BEFORE the number ("Mach 0.091").
 * Every other unit puts its abbreviation AFTER the number ("70 mph").
 *
 * @param {number} mps - the speed in meters per second.
 * @param {string} unitKey - the unit to display in.
 * @param {{speedOfSound?: number, sigFigs?: number, withAbbr?: boolean}} [opts]
 *   opts.speedOfSound — live speed of sound in m/s (Mach only).
 *   opts.sigFigs      — significant figures to show (default 3).
 *   opts.withAbbr     — include the unit label/abbr (default true).
 * @returns {string} the formatted speed, e.g. "Mach 0.091" or "70 mph".
 *
 * @example
 * formatSpeed(31.2928, 'mph');                        // "70 mph"
 * formatSpeed(31.2928, 'mach', {speedOfSound: 343});  // "Mach 0.0912"
 */
export function formatSpeed(mps, unitKey, opts = {}) {
  const unit = getUnit(unitKey);
  const sigFigs = (typeof opts.sigFigs === 'number' && opts.sigFigs >= 1) ? opts.sigFigs : 3;
  const withAbbr = opts.withAbbr !== false; // default true; only false turns it off.

  const value = fromMps(mps, unitKey, opts);
  const numberText = toSignificant(value, sigFigs);

  // No label requested? Just return the bare number.
  if (!withAbbr) {
    return numberText;
  }

  // Mach is special: the word goes in FRONT of the number.
  if (unitKey === 'mach') {
    return `Mach ${numberText}`;
  }

  // Everything else: number first, then the abbreviation.
  return `${numberText} ${unit.abbr}`;
}

/**
 * Express one speed in EVERY known unit at once — handy for a results panel
 * that lists the same journey speed across all the scientific units.
 *
 * @param {number} mps - the speed in meters per second.
 * @param {{speedOfSound?: number, sigFigs?: number, withAbbr?: boolean}} [opts]
 *   Same options as formatSpeed (speedOfSound, sigFigs, withAbbr).
 * @returns {Array<{key:string,label:string,abbr:string,value:number,formatted:string}>}
 *   one row per unit, in the order they appear in SPEED_UNITS.
 *
 * @example
 * speedInAllUnits(31.2928);
 * // [ {key:'mph', label:'miles per hour', abbr:'mph', value:70, formatted:'70 mph'}, ... ]
 */
export function speedInAllUnits(mps, opts = {}) {
  return Object.keys(SPEED_UNITS).map((key) => {
    const unit = SPEED_UNITS[key];
    return {
      key: unit.key,
      label: unit.label,
      abbr: unit.abbr,
      value: fromMps(mps, key, opts),
      formatted: formatSpeed(mps, key, opts),
    };
  });
}
