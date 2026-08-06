# 🛰️ Science Maps

A GPS navigation app that works like Google Maps, but shows every distance and
speed in **scientific units** — light-milliseconds, astronomical units, Mach
numbers, percent of light speed, and more — with a familiar unit shown
underneath for reference.

It also pulls **live weather** to compute the real local **speed of sound**, so
the Mach numbers reflect the actual air around you.

```
Distance:  2.4 light-ms   Speed:  Mach 0.092
           (447 mi)               (70 mph)
```

---

## How to run it

The app is a plain static website that uses native ES modules. Browsers block
ES modules on `file://`, so you need to open it over `http://`. A tiny
dependency-free server (`serve.ps1`) is included for Windows.

1. Open **PowerShell** in this folder (`science-maps`).
2. Run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File serve.ps1
   ```
3. Open the printed URL in your browser: **http://localhost:8137/**
4. Press **Ctrl+C** in PowerShell to stop the server.

> Want a different port? `... -File serve.ps1 -Port 9000`

If you have Python or Node installed, those work too:
`python -m http.server 8137` or `npx serve`.

> Only Science Maps needs the server. `logic.html` and `chernobyl.html` are
> single self-contained files — open either one directly in a browser.

### Using it
- Click **📍 Use my location** (allow the location prompt) to set your start.
- **Search** for a place, or **click the map** to drop a destination.
- A route appears with distance, time, and turn-by-turn directions.
- Pick your primary **distance/speed units**, or flip on **Smart unit mode** to
  let the app choose the most readable scientific unit automatically.
- **Start tracking** reads your live GPS speed (best on a phone, on the move).

> Location and live-speed tracking need a secure context — they work on
> `http://localhost` and on `https://` sites, but not from a `file://` page.

---

## Also on this site

Two standalone pages are published from this repository alongside Science Maps.
Each is a single self-contained file with no dependencies, so both open straight
from disk and keep working with no connection.

### ⚡ Logic Lab — `logic.html`

A digital logic simulator with two workspaces sharing one engine.

**Circuit editor.** Drop gates on a board, drag between ports to wire them, and
click an input pin to flip it. Give a circuit input and output pins and you can
**package it as a chip**, which then appears in the palette and can be dropped
into bigger circuits — chips inside chips, as deep as you like. Edit a chip once
and every copy of it updates. There is a truth-table generator, undo/redo, and
export/import to JSON. Built-in examples run from a half adder up to a four-bit
adder and a counter driving a hex display.

**Breadboard.** A solderless breadboard wired the way a real one is: five-hole
columns, four rails, a channel down the middle. Drop real 74-series DIP chips
(7400, 7402, 7404, 7408, 7410, 7411, 7432, 7447, 7474, 7486, 7493, 74138) with
their actual pinouts, plus jumpers, resistors, LEDs, push buttons, DIP switches
and a seven-segment display. Nothing works until you power the chips, and the
failure modes are reported rather than papered over — shorts, floating inputs,
unpowered chips, an LED with no series resistor. Hover any hole to light up
every hole it is already connected to.

**How it simulates.** Both modes compile to the same flat netlist of primitive
gates. Every tick, each gate reads its inputs and drives its outputs at the same
instant, so one gate costs one tick of delay — which is what lets cross-coupled
NANDs remember a bit and a ring of inverters oscillate. Gates are handed a small
spread of propagation delays, because two perfectly matched gates in a latch
would sit and ring forever; real ones escape that because one is a shade faster.
The breadboard adds drive strength on top: a chip output or supply clip drives
strongly, a resistor passes a weak copy, and an undriven net floats — which TTL
inputs read as 1, exactly as they do on the bench.

Work is saved in your browser as you go. Nothing is uploaded.

### ☢️ Chernobyl, 01:23:45 — `chernobyl.html`

A minute-by-minute factual reconstruction of the night of 26 April 1986.

---

## How the code is organized

Everything is vanilla HTML/CSS/JavaScript — no build step, no frameworks.

| File | What it does |
|------|--------------|
| `index.html` | Page structure (the skeleton). |
| `css/style.css` | All the styling, responsive layout, dark "space" header. |
| `js/distance.js` | **Distance engine** — converts meters ↔ 15 units (mm … light-years). |
| `js/speed.js` | **Speed engine** — converts m/s ↔ 8 units (mph … %c, Mach). |
| `js/atmosphere.js` | **Physics** — local speed of sound from temperature/humidity/pressure. |
| `js/units.js` | **Smart mode** — picks the most readable unit for any scale. |
| `js/facts.js` | Astronomy/physics "Did you know?" facts chosen by scale. |
| `js/services.js` | Network calls: search, routing, and weather. |
| `js/app.js` | The UI brain — wires the map + controls to the engines. |
| `serve.ps1` | Tiny local dev server (so ES modules load over http). |
| `logic.html` | **Logic Lab**, whole and entire — markup, styling, engine and examples. |
| `chernobyl.html` | **Chernobyl, 01:23:45**, likewise self-contained. |
| `sw.js` | Service worker; caches the two standalone pages for offline use. |

The golden rule in `app.js`: **actions change `state`, then call `render()`**.
`render()` only reads state and redraws — never the other way around. That
one-way flow keeps things predictable.

`logic.html` is one file on purpose: no build step, no modules, no CDN, so it
runs over `http://` and straight off the filesystem alike. Its sections are
numbered in comments — parts, model, compiler, simulator, renderer, editing,
breadboard, examples — and `window.LogicLab` exposes the engine for poking at
from the console.

### Checking Logic Lab still works

```
node test/logic.test.js            # run the checks
SHOT=1 node test/logic.test.js     # ...and save screenshots too
```

It opens the real page in headless Chromium and checks both halves: the
simulator directly (adder truth tables, a latch that holds its bit, a ring
oscillator that rings, breadboard nets, shorts, floating inputs, the 7493 →
7447 → display chain) and the interface through synthetic mouse events (place a
part, drag a wire, lay a jumper, package a chip, reload and find it all still
there). No dependencies — it drives the browser over the DevTools protocol with
what Node 22 already has. Set `CHROME=/path/to/chrome` if it cannot find a
browser by itself.

---

## Data sources (all free, no API keys)

- **Map & tiles:** [Leaflet](https://leafletjs.com/) + [CARTO Voyager](https://carto.com/basemaps/) basemap (built on [OpenStreetMap](https://www.openstreetmap.org/) data) — a clean, Google-Maps-like style
- **Search (geocoding):** [Nominatim](https://nominatim.org/)
- **Routing & turn-by-turn:** [OSRM](https://project-osrm.org/) public demo (car routing only)
- **Weather:** [Open-Meteo](https://open-meteo.com/) — keyless, used for the speed-of-sound math

> The project brief suggested OpenWeatherMap; Open-Meteo was used instead because
> it needs no API key, which keeps the app fully runnable out of the box.

---

## What's done vs. the roadmap

Done: distance engine, speed engine, local speed-of-sound, live weather, web
interface, interactive map, routing with turn-by-turn, and the scientific
dashboards (atmosphere, multi-unit tables, light/sound travel time, facts).

Future phase: packaging as a mobile app (React Native / Expo), and live traffic.

---

## Accuracy notes

- Distance conversions use **exact** definitions (1 mi = 1609.344 m, c =
  299,792,458 m/s, 1 AU = 149,597,870,700 m, 1 ly = c × 31,557,600 s).
- Speed of sound uses the ideal-gas formula `c = √(γRT/M)` with a humid-air
  correction (water vapor lowers the average molar mass, so humid air carries
  sound slightly faster). Falls back to the dry-air approximation, then to the
  ISA sea-level value (340.29 m/s), if inputs are missing.
