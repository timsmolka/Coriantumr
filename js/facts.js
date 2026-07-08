// facts.js
// ---------------------------------------------------------------------------
// ASTRONOMY & PHYSICS FACTS for Science Maps.
//
// This module is PURE DATA + a little selection logic. It never touches the
// network. Given a distance (in meters) or a speed (in meters per second),
// it picks ONE engaging, accurate fact that fits the scale of the number.
//
// The idea: when the app shows you that a trip is, say, 12 km long, we can
// also whisper a fun truth like "light could cross this 25,000 times in a
// single second." It turns boring numbers into a sense of cosmic scale.
//
// Everything here is written to be readable and heavily commented, because
// the author is learning to code. Clarity beats cleverness.
// ---------------------------------------------------------------------------

// --- Exact physical constants (do not change these without good reason) ---

/** Speed of light in a vacuum, in meters per second (this value is EXACT). */
const SPEED_OF_LIGHT = 299792458; // m/s

/** One Astronomical Unit (average Earth–Sun distance), in meters (exact, IAU 2012). */
const AU = 149597870700; // m

/**
 * One light-year, in meters (exact).
 * A Julian year is 365.25 days = 31,557,600 seconds, so:
 *   1 ly = c * 31,557,600 s = 9,460,730,472,580,800 m
 */
const LIGHT_YEAR = 9460730472580800; // m

// ---------------------------------------------------------------------------
// Small formatting helper
// ---------------------------------------------------------------------------

/**
 * Turn a duration in seconds into a short, human-friendly string.
 * Used inside facts so the "light-travel time" reads naturally
 * (e.g. "1.3 seconds", "8 minutes 20 seconds", "3.4 years").
 *
 * @param {number} seconds - A non-negative duration in seconds.
 * @returns {string} A readable description of that duration.
 */
function formatDuration(seconds) {
  // Below a microsecond: report in nanoseconds for tiny, everyday distances.
  if (seconds < 1e-6) {
    return `${(seconds * 1e9).toFixed(1)} nanoseconds`;
  }
  // Below a millisecond: microseconds.
  if (seconds < 1e-3) {
    return `${(seconds * 1e6).toFixed(1)} microseconds`;
  }
  // Below a second: milliseconds.
  if (seconds < 1) {
    return `${(seconds * 1e3).toFixed(1)} milliseconds`;
  }
  // Below a minute: seconds.
  if (seconds < 60) {
    return `${seconds.toFixed(1)} seconds`;
  }
  // Below an hour: minutes (and leftover seconds, when there are any).
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const restSeconds = Math.round(seconds - minutes * 60);
    return restSeconds > 0
      ? `${minutes} minutes ${restSeconds} seconds`
      : `${minutes} minutes`;
  }
  // Below a day: hours.
  if (seconds < 86400) {
    return `${(seconds / 3600).toFixed(1)} hours`;
  }
  // Below a year: days.
  if (seconds < 31557600) {
    return `${(seconds / 86400).toFixed(1)} days`;
  }
  // A year or more: years (Julian years, matching our light-year definition).
  return `${(seconds / 31557600).toFixed(2)} years`;
}

// ---------------------------------------------------------------------------
// DISTANCE FACTS
// ---------------------------------------------------------------------------
//
// The table below is sorted ASCENDING by `maxMeters`. To pick a fact we walk
// the list and choose the first entry whose `maxMeters` is >= the distance.
// Each `fact` is a function so it can compute the light-travel time for the
// ACTUAL distance the user gave us — making the comparison concrete.
//
// Reminder: light-travel time = meters / SPEED_OF_LIGHT.
// ---------------------------------------------------------------------------

/**
 * The raw distance-fact table. Sorted ascending by `maxMeters`.
 * Each entry: { maxMeters: number, fact: (meters) => string }.
 * The final entry uses Infinity so every possible distance matches something.
 * @type {Array<{ maxMeters: number, fact: (meters: number) => string }>}
 */
const DISTANCE_FACTS = [
  {
    // Up to ~100 m: room / building scale.
    maxMeters: 100,
    fact: (meters) => {
      const t = meters / SPEED_OF_LIGHT; // seconds for light to cross this
      return `Light crosses this distance in about ${formatDuration(t)} — ` +
        `in everyday terms it is effectively instant, yet it is still a real, ` +
        `measurable delay.`;
    },
  },
  {
    // Up to ~10 km: neighborhood / city scale.
    maxMeters: 10000,
    fact: (meters) => {
      // How many times could light cover this distance in one second?
      const timesPerSecond = SPEED_OF_LIGHT / meters;
      return `A radio signal (which travels at the speed of light) would cross ` +
        `this in about ${formatDuration(meters / SPEED_OF_LIGHT)} — light could ` +
        `make this trip roughly ${Math.round(timesPerSecond).toLocaleString()} ` +
        `times every single second.`;
    },
  },
  {
    // Up to ~100 km: regional scale. Earth's circumference is ~40,075 km.
    maxMeters: 100000,
    fact: (meters) => {
      const t = meters / SPEED_OF_LIGHT;
      return `Light could travel this distance in about ${formatDuration(t)}. ` +
        `For comparison, light laps the entire Earth (~40,075 km) about ` +
        `7.5 times every second.`;
    },
  },
  {
    // Up to ~2,000 km: long-haul / country scale.
    maxMeters: 2000000,
    fact: (meters) => {
      const t = meters / SPEED_OF_LIGHT;
      return `At light speed this distance takes only about ${formatDuration(t)}, ` +
        `but a passenger jet (~900 km/h) would need many hours — light is roughly ` +
        `a million times faster than the fastest airliner.`;
    },
  },
  {
    // Up to ~20,000 km: planet scale (anywhere on Earth to anywhere else).
    maxMeters: 20000000,
    fact: (meters) => {
      const t = meters / SPEED_OF_LIGHT;
      return `This is on the scale of crossing the whole planet. Even so, light ` +
        `would make the journey in about ${formatDuration(t)} — fast enough to ` +
        `circle the globe about 7.5 times in one second.`;
    },
  },
  {
    // Up to ~500,000 km: out to the Moon (~384,400 km) and a bit beyond.
    maxMeters: 500000000,
    fact: (meters) => {
      const t = meters / SPEED_OF_LIGHT;
      return `The Moon is about 384,400 km away — roughly 1.28 light-seconds — ` +
        `so we always see it as it was just over a second ago. Light covers your ` +
        `distance in about ${formatDuration(t)}.`;
    },
  },
  {
    // Up to ~2 AU: inner Solar System. 1 AU = Earth–Sun distance.
    maxMeters: 2 * AU,
    fact: (meters) => {
      const t = meters / SPEED_OF_LIGHT;
      const inAU = meters / AU;
      return `Light from the Sun takes about 8 minutes 20 seconds to reach Earth ` +
        `(1 AU). Your distance is about ${inAU.toFixed(2)} AU, which light would ` +
        `cross in roughly ${formatDuration(t)}.`;
    },
  },
  {
    // Up to ~the edge of the planetary Solar System (Neptune ~30 AU, with margin).
    maxMeters: 50 * AU,
    fact: (meters) => {
      const t = meters / SPEED_OF_LIGHT;
      const inAU = meters / AU;
      return `Out here we measure in Astronomical Units (1 AU = Earth–Sun). At ` +
        `about ${inAU.toFixed(1)} AU, sunlight or a radio command would take ` +
        `roughly ${formatDuration(t)} — Neptune sits around 30 AU from the Sun.`;
    },
  },
  {
    // Up to ~5 light-years: into interstellar space (Proxima Centauri ~4.24 ly).
    maxMeters: 5 * LIGHT_YEAR,
    fact: (meters) => {
      const inLy = meters / LIGHT_YEAR;
      return `Proxima Centauri, the nearest star to the Sun, is about 4.24 ` +
        `light-years away. Your distance is about ${inLy.toFixed(2)} light-years, ` +
        `meaning light itself needs about ${formatDuration(meters / SPEED_OF_LIGHT)} ` +
        `to make the crossing.`;
    },
  },
  {
    // Everything larger: galactic and beyond. (The Milky Way is ~100,000 ly across.)
    maxMeters: Infinity,
    fact: (meters) => {
      const inLy = meters / LIGHT_YEAR;
      return `This spans about ${Math.round(inLy).toLocaleString()} light-years — ` +
        `galactic scale. The Milky Way is roughly 100,000 light-years across, so ` +
        `light leaving one edge takes about 100,000 years to reach the other.`;
    },
  },
];

/**
 * Return ONE engaging, accurate astronomy/physics fact appropriate to the
 * given distance. The fact is chosen by scale and computes the light-travel
 * time for the actual distance so the comparison feels concrete.
 *
 * @param {number} meters - The distance, in meters. Should be finite and >= 0.
 * @returns {string} A single self-contained fact about that distance.
 */
export function distanceFact(meters) {
  // Guard against bad input so the UI never shows "NaN" or a crash.
  if (!Number.isFinite(meters) || meters < 0) {
    return `Enter a distance and we will compare it to cosmic scales — ` +
      `from footsteps to light-years.`;
  }

  // Walk the ascending table and return the first entry that fits.
  for (const entry of DISTANCE_FACTS) {
    if (meters <= entry.maxMeters) {
      return entry.fact(meters);
    }
  }

  // Safety net: the table ends in Infinity, so we should never reach here,
  // but if we somehow do, fall back to the last (galactic) fact.
  return DISTANCE_FACTS[DISTANCE_FACTS.length - 1].fact(meters);
}

// ---------------------------------------------------------------------------
// SPEED FACTS
// ---------------------------------------------------------------------------
//
// Same pattern as distances: an ascending table keyed by `maxMps` (meters per
// second). We use the ISA sea-level speed of sound (340.29 m/s) as the
// reference for Mach numbers when no live weather is available.
// ---------------------------------------------------------------------------

/** ISA standard sea-level speed of sound (Mach 1 at 15 C), in m/s. */
const SPEED_OF_SOUND_ISA = 340.29; // m/s

/**
 * The raw speed-fact table. Sorted ascending by `maxMps`.
 * Each entry: { maxMps: number, fact: (mps) => string }.
 * The final entry uses Infinity so every possible speed matches something.
 * @type {Array<{ maxMps: number, fact: (mps: number) => string }>}
 */
const SPEED_FACTS = [
  {
    // Up to ~2 m/s: walking pace (a brisk walk is ~1.4 m/s, about 5 km/h).
    maxMps: 2,
    fact: (mps) => {
      const fractionOfLight = (mps / SPEED_OF_LIGHT) * 100;
      return `This is roughly walking pace (a brisk walk is about 1.4 m/s, or ` +
        `5 km/h). That is about ${fractionOfLight.toExponential(2)}% of the ` +
        `speed of light — light is unimaginably faster.`;
    },
  },
  {
    // Up to ~10 m/s: running / cycling (a fast sprinter peaks near 10 m/s).
    maxMps: 10,
    fact: (mps) => {
      const machFraction = mps / SPEED_OF_SOUND_ISA;
      return `Around this speed you are sprinting or cycling. The world's fastest ` +
        `humans peak near 10 m/s — still only about Mach ${machFraction.toFixed(3)} ` +
        `(${(machFraction * 100).toFixed(1)}% of the speed of sound).`;
    },
  },
  {
    // Up to ~40 m/s: highway driving (~120 km/h is about 33 m/s).
    maxMps: 40,
    fact: (mps) => {
      const kmh = mps * 3.6;
      const machFraction = mps / SPEED_OF_SOUND_ISA;
      return `This is highway speed — about ${Math.round(kmh)} km/h. Sound itself ` +
        `travels at roughly 340 m/s at sea level, so you are moving at about ` +
        `Mach ${machFraction.toFixed(2)}.`;
    },
  },
  {
    // Up to ~Mach 1 (~340.29 m/s): subsonic flight, up to the sound barrier.
    maxMps: SPEED_OF_SOUND_ISA,
    fact: (mps) => {
      const machFraction = mps / SPEED_OF_SOUND_ISA;
      return `A typical passenger jet cruises near Mach 0.85. You are at about ` +
        `Mach ${machFraction.toFixed(2)} — at sea level Mach 1 is 340.29 m/s, ` +
        `the speed at which sound waves themselves travel through the air.`;
    },
  },
  {
    // Up to ~Mach 5 (~1,701 m/s): supersonic, up to the hypersonic threshold.
    maxMps: 5 * SPEED_OF_SOUND_ISA,
    fact: (mps) => {
      const machFraction = mps / SPEED_OF_SOUND_ISA;
      return `You have broken the sound barrier — about Mach ${machFraction.toFixed(2)}. ` +
        `Above Mach 1 you would outrun your own sound, and the Concorde cruised ` +
        `near Mach 2. "Hypersonic" begins at Mach 5.`;
    },
  },
  {
    // Up to ~11,200 m/s: orbital and escape velocities.
    // Low-Earth orbital speed ~7.8 km/s; Earth escape velocity ~11.2 km/s.
    maxMps: 11200,
    fact: (mps) => {
      const kms = mps / 1000;
      return `This is spaceflight territory: about ${kms.toFixed(1)} km/s. ` +
        `Satellites in low Earth orbit travel near 7.8 km/s, and escaping ` +
        `Earth's gravity entirely takes about 11.2 km/s.`;
    },
  },
  {
    // Everything faster: a meaningful fraction of the speed of light.
    maxMps: Infinity,
    fact: (mps) => {
      const percentC = (mps / SPEED_OF_LIGHT) * 100;
      // Use more precision for very small fractions so it never reads as "0%".
      const shown = percentC < 0.01
        ? percentC.toExponential(2)
        : percentC.toFixed(2);
      return `Now we are measuring against light itself: about ${shown}% of the ` +
        `speed of light (c = 299,792,458 m/s). At these speeds, Einstein's ` +
        `relativity means time and distance themselves start to stretch.`;
    },
  },
];

/**
 * Return ONE engaging, accurate physics fact appropriate to the given speed.
 * The fact is chosen by scale and compares the speed to familiar references:
 * walking, highway driving, Mach numbers, orbital velocity, and the speed of
 * light.
 *
 * @param {number} mps - The speed, in meters per second. Should be finite and >= 0.
 * @returns {string} A single self-contained fact about that speed.
 */
export function speedFact(mps) {
  // Guard against bad input so the UI never shows "NaN" or a crash.
  if (!Number.isFinite(mps) || mps < 0) {
    return `Enter a speed and we will compare it to walking, jets, orbiting ` +
      `spacecraft, and even the speed of light.`;
  }

  // Walk the ascending table and return the first entry that fits.
  for (const entry of SPEED_FACTS) {
    if (mps <= entry.maxMps) {
      return entry.fact(mps);
    }
  }

  // Safety net (the table ends in Infinity, so this should be unreachable).
  return SPEED_FACTS[SPEED_FACTS.length - 1].fact(mps);
}

// ---------------------------------------------------------------------------
// TRANSPARENCY HELPER
// ---------------------------------------------------------------------------

/**
 * Return the underlying distance-fact table, sorted ascending by `maxMeters`.
 *
 * This is exposed for transparency and testing: it lets callers inspect every
 * threshold and see the exact wording for a sample distance. We evaluate each
 * fact at its own threshold (clamped just under Infinity) so the returned
 * `fact` strings are ready-to-read examples rather than functions.
 *
 * @returns {Array<{ maxMeters: number, fact: string }>}
 *   The fact table. `maxMeters` is the upper bound of each scale band; `fact`
 *   is a representative sentence for that band.
 */
export function allDistanceFacts() {
  return DISTANCE_FACTS.map((entry) => {
    // For finite bands, sample the fact at the band's upper bound.
    // For the open-ended final band (Infinity), sample at 1,000,000 light-years
    // so the example string is concrete instead of "Infinity light-years".
    const sampleMeters = Number.isFinite(entry.maxMeters)
      ? entry.maxMeters
      : 1000000 * LIGHT_YEAR;

    return {
      maxMeters: entry.maxMeters,
      fact: entry.fact(sampleMeters),
    };
  });
}
