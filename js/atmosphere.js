// =============================================================================
// atmosphere.js  --  LOCAL SPEED OF SOUND physics for "Science Maps"
// =============================================================================
//
// This module is PURE MATH. It never touches the network. Give it a few
// numbers describing the air (temperature, humidity, pressure) and it tells
// you how fast sound travels through that air, in metres per second (m/s).
//
// Why does this matter for a maps app? Because if we know the local speed of
// sound, we can express any travel speed as a "Mach number" (a multiple of the
// speed of sound) -- a fun scientific way to look at how fast you're moving.
//
// Everything here is an ES module: we use `export` so other files can `import`
// these functions. There is NO build step -- the browser loads this directly.
//
// -----------------------------------------------------------------------------
// THE PHYSICS, in plain language
// -----------------------------------------------------------------------------
// Sound is a pressure wave. How fast it travels depends mostly on how "springy"
// and how "heavy" the gas is. The clean physics formula for the speed of sound
// in an ideal gas is:
//
//        c = sqrt( gamma * R * T / M )
//
//   where
//     c     = speed of sound          (m/s)
//     gamma = adiabatic index         (dimensionless; ~1.4 for dry air)
//     R     = universal gas constant  = 8.314462618 J/(mol*K)
//     T     = absolute temperature    (kelvin, K)
//     M     = molar mass of the gas   (kg/mol; ~0.0289645 for dry air)
//
// Notice humidity is NOT in that basic formula. Water vapor matters because a
// water molecule (H2O, ~18 g/mol) is LIGHTER than the average air molecule
// (~29 g/mol). Replacing some heavy air with lighter water vapor lowers the
// average molar mass M, and a smaller M makes c bigger. So humid air carries
// sound slightly FASTER than dry air at the same temperature. We model this by
// mixing the dry-air and water-vapor properties according to how much water
// vapor is present (its "mole fraction").
// =============================================================================


// -----------------------------------------------------------------------------
// Physical constants
// -----------------------------------------------------------------------------

/**
 * Mach 1 reference at the ISA (International Standard Atmosphere) sea level,
 * i.e. the speed of sound in dry air at 15 degrees Celsius.
 *
 * We use this as a sensible default when we have no live weather data, and as
 * the safe fallback whenever the temperature input is missing or invalid.
 *
 * @type {number}  speed of sound in m/s
 */
export const ISA_SEA_LEVEL_SOUND = 340.29; // m/s, at 15 C standard atmosphere

/**
 * Universal (molar) gas constant.
 * @type {number}  R, in J/(mol*K)
 */
const R = 8.314462618; // J/(mol*K)

// Molar masses (how much one mole of the gas weighs), in kilograms per mole.
const M_DRY = 0.0289645; // kg/mol -- average dry air
const M_VAP = 0.0180160; // kg/mol -- water vapor (H2O)

// Adiabatic index gamma (ratio of specific heats) for each gas. Dry air is a
// mix of mostly diatomic molecules (~1.4); water vapor is triatomic (~1.33).
const GAMMA_DRY = 1.4;
const GAMMA_VAP = 1.33;


// -----------------------------------------------------------------------------
// Small internal helper
// -----------------------------------------------------------------------------

/**
 * Clamp a number into the inclusive range [min, max].
 * Used to keep water-vapor pressure physically sensible (never below 0,
 * never above the total air pressure).
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}


// -----------------------------------------------------------------------------
// Saturation vapor pressure  --  Arden Buck equation
// -----------------------------------------------------------------------------

/**
 * Saturation vapor pressure of water over liquid water, in pascals (Pa).
 *
 * This is the MAXIMUM partial pressure water vapor can have at a given
 * temperature (i.e. the pressure at 100% relative humidity). We need it so we
 * can turn a relative-humidity percentage into an actual vapor pressure.
 *
 * Formula -- Arden Buck equation (1981/1996), a refined fit for moist-air
 * meteorology:
 *
 *     es = 611.21 * exp( (18.678 - tempC/234.5) * ( tempC / (257.14 + tempC) ) )
 *
 * with es in Pa and tempC in degrees Celsius.
 *
 * @param {number} tempC  air temperature in degrees Celsius
 * @returns {number}      saturation vapor pressure in pascals (Pa)
 */
export function saturationVaporPressure(tempC) {
  // Defensive: a non-finite temperature has no meaningful vapor pressure.
  if (!Number.isFinite(tempC)) return 0;

  return (
    611.21 *
    Math.exp((18.678 - tempC / 234.5) * (tempC / (257.14 + tempC)))
  );
}


// -----------------------------------------------------------------------------
// Speed of sound in (possibly humid) air
// -----------------------------------------------------------------------------

/**
 * Compute the speed of sound in air, in metres per second (m/s).
 *
 * Two modes:
 *
 *  1. FULL HUMID-AIR MODEL  (when both `humidity` and `pressureHpa` are given):
 *       T_K   = temperatureC + 273.15                  // absolute temperature
 *       P     = pressureHpa * 100                       // total pressure, Pa
 *       e     = (humidity/100) * saturationVaporPressure(temperatureC)
 *               // actual water-vapor partial pressure, Pa, clamped to 0..P
 *       xw    = e / P                                   // mole fraction of vapor
 *       M     = (1 - xw)*M_DRY   + xw*M_VAP             // mixed molar mass
 *       gamma = (1 - xw)*GAMMA_DRY + xw*GAMMA_VAP       // mixed adiabatic index
 *       c     = sqrt( gamma * R * T_K / M )
 *
 *  2. DRY-AIR FALLBACK  (when humidity and/or pressure are missing):
 *       c = 331.3 * sqrt( 1 + temperatureC/273.15 )
 *     This is the classic textbook approximation for dry air, anchored at
 *     331.3 m/s at 0 C.
 *
 * If `temperatureC` is not a finite number we cannot compute anything sensible,
 * so we return the ISA sea-level reference value.
 *
 * @param {object} params
 * @param {number} params.temperatureC  air temperature in degrees Celsius
 * @param {number} [params.humidity]    relative humidity in percent (0..100)
 * @param {number} [params.pressureHpa] air pressure in hectopascals (hPa = mbar)
 * @returns {number} speed of sound in m/s
 */
export function speedOfSound({ temperatureC, humidity, pressureHpa } = {}) {
  // Without a valid temperature we cannot do the physics -- fall back safely.
  if (!Number.isFinite(temperatureC)) {
    return ISA_SEA_LEVEL_SOUND;
  }

  // Absolute temperature in kelvin (0 C = 273.15 K).
  const T_K = temperatureC + 273.15;

  // Decide whether we have enough good data for the full humid-air model.
  const haveHumidity = Number.isFinite(humidity);
  const havePressure = Number.isFinite(pressureHpa) && pressureHpa > 0;

  if (haveHumidity && havePressure) {
    // ----- FULL HUMID-AIR MODEL -----

    // Total air pressure in pascals.
    const P = pressureHpa * 100; // hPa -> Pa

    // Relative humidity as a fraction, clamped to a sane 0..100% range.
    const rh = clamp(humidity, 0, 100) / 100;

    // Actual partial pressure of water vapor. It can never exceed the total
    // pressure P, and can never be negative, so clamp it into [0, P].
    const e = clamp(rh * saturationVaporPressure(temperatureC), 0, P);

    // Mole fraction of water vapor (what share of the molecules are H2O).
    const xw = e / P;

    // Mix the dry-air and water-vapor properties by that mole fraction.
    const M = (1 - xw) * M_DRY + xw * M_VAP; // mixed molar mass, kg/mol
    const gamma = (1 - xw) * GAMMA_DRY + xw * GAMMA_VAP; // mixed adiabatic index

    // Ideal-gas speed of sound: c = sqrt(gamma * R * T / M).
    return Math.sqrt((gamma * R * T_K) / M);
  }

  // ----- DRY-AIR FALLBACK -----
  // Classic approximation anchored at 331.3 m/s at 0 C.
  return 331.3 * Math.sqrt(1 + temperatureC / 273.15);
}


// -----------------------------------------------------------------------------
// Mach number
// -----------------------------------------------------------------------------

/**
 * Convert a speed (m/s) into a Mach number: how many times the local speed of
 * sound it is. Mach 1 means "exactly the speed of sound".
 *
 * @param {number} speedMps              the speed to convert, in m/s
 * @param {number} [speedOfSoundMps]     local speed of sound in m/s
 *                                       (defaults to the ISA sea-level value)
 * @returns {number} the Mach number (dimensionless)
 */
export function machNumber(speedMps, speedOfSoundMps = ISA_SEA_LEVEL_SOUND) {
  // Guard against bad inputs and division by zero / non-positive sound speeds.
  if (!Number.isFinite(speedMps)) return NaN;
  if (!Number.isFinite(speedOfSoundMps) || speedOfSoundMps <= 0) return NaN;

  return speedMps / speedOfSoundMps;
}


// -----------------------------------------------------------------------------
// Human-friendly description
// -----------------------------------------------------------------------------

/**
 * Compute the speed of sound AND a short, human-readable note explaining which
 * inputs were actually used (handy for showing in the UI so the user knows
 * whether the value came from live weather or a fallback).
 *
 * @param {object} params
 * @param {number} params.temperatureC  air temperature in degrees Celsius
 * @param {number} [params.humidity]    relative humidity in percent (0..100)
 * @param {number} [params.pressureHpa] air pressure in hectopascals (hPa)
 * @returns {{ speedOfSound: number, basis: string }}
 *          `speedOfSound` in m/s and `basis` describing the inputs used.
 */
export function describeSpeedOfSound({ temperatureC, humidity, pressureHpa } = {}) {
  const value = speedOfSound({ temperatureC, humidity, pressureHpa });

  let basis;
  if (!Number.isFinite(temperatureC)) {
    // No usable temperature -> we returned the ISA standard value.
    basis = "ISA standard sea-level (15 C), no live data";
  } else {
    const haveHumidity = Number.isFinite(humidity);
    const havePressure = Number.isFinite(pressureHpa) && pressureHpa > 0;

    if (haveHumidity && havePressure) {
      // Full humid-air model used all three inputs.
      basis =
        `humid air: ${temperatureC.toFixed(1)} C, ` +
        `${clamp(humidity, 0, 100).toFixed(0)}% RH, ` +
        `${pressureHpa.toFixed(0)} hPa`;
    } else {
      // Dry-air fallback used temperature only.
      basis = `dry air: ${temperatureC.toFixed(1)} C (temperature only)`;
    }
  }

  return { speedOfSound: value, basis };
}
