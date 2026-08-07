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

**Edit or Use.** A switch in the top bar (or the <kbd>E</kbd> key) decides what a
click does. In **Edit** it builds — place, wire, move, delete. In **Use** a click
only works the thing you have already built: it flips a switch, holds a button
down, and shows you what a part is, but it cannot start a wire, move a part or
delete anything, in either workspace. Reaching for the palette puts you back in
Edit by itself, since that is unambiguous. On a phone it collapses to a single
✎/▶ button, which is where it matters most.

Two things make Use mode actually usable rather than merely safe. You do not
have to hit a switch exactly — the nearest one within reach is the one that
flips, measured in screen pixels so it still works zoomed out, though anything
you land squarely on wins, so a gate beside a pin keeps its own clicks. And the
left button never moves the view: reaching for a switch and missing used to
drag the whole board out from under you. **Right-hold** pans instead, and does
not delete on release the way it does in Edit. A finger still pans with one
drag, having no second button to use.

**Junctions.** One signal often has to feed several inputs. A junction catches
clicks from a little way outside the dot it draws, in both the body and the
ports — eighteen units across is a hard thing to hit with a mouse and a harder
one with a finger.  Select a wire and
press <kbd>J</kbd> (or the **Add a junction** button) and one is spliced in
where you are pointing — the wire becomes two, with a junction between them you
can run as many more wires from as you like. That is the T, and the cross, that
a schematic draws as a solder dot; it is drawn as one, with a short stub towards
every wire meeting on it, so it reads as a deliberate join rather than two wires
happening to cross. Dropping a wire onto a wire still splices one in too — the
difference is that this is a way to ask for one.

**Wires go round things.** A wire is planned as a few straight runs that dodge
every box — including the two it belongs to, which is what stops a signal
looping back to its own chip from taking the short cut straight through it
instead of round the outside. Only the two short stubs at the ports are exempt,
because a port sits on the edge of a box and cannot help touching it. A wire
that must come back on itself is offered lanes above and below, and a step out
past the side first for when those are blocked too. A wire leaving a junction
parts company with its siblings **at** the junction rather than running with
them across half the board, so the dot is where the picture actually splits.

Corners are rounded off so it still reads as a wire rather than a
circuit-board trace. Candidates are tried cheapest-looking first — dead
straight, then a single dog-leg at one of a few likely places, then out and
around the outside when the target is *behind* the source, which is where most
of the spaghetti used to come from: a curve to something on its left looped
right back over itself. If every candidate is blocked it falls back to the old
curve, because a wire drawn awkwardly beats a wire not drawn. Routes are
remembered until something moves, and skipped entirely above a few hundred
parts, where the generated arrays are laid out by machine anyway. The counter
and stored-program examples now have no wire crossing a part at all.

**Things line up.** A part lands on a ten-unit grid, but its ports do not —
they are spaced down the middle of a box whose height depends on how many there
are — so two gates can sit perfectly on the grid and the wire between them still
has a kink in it. What has to line up is the ports.

Drag a part and any wire it already carries is watched: come within a few screen
pixels of level with the thing at the other end and it is pulled the rest of the
way, with a dashed guide to say why it jumped. **Line up the wires** (or
<kbd>L</kbd>) does the whole board at once — every wire within half a gate's
height of straight gets the part at one end nudged until it is exactly straight,
and a level wire is then drawn as a real straight line rather than a curve that
merely looks like one. It works left to right, so a chain settles from its source
outwards, and it decides which wires to fix *before* moving anything: judged
after the fact, straightening one wire talks the next one out of happening.

**Parts turn.** <kbd>R</kbd> turns the selection a quarter turn and
<kbd>Shift</kbd>+<kbd>R</kbd> goes the other way, with buttons in the side panel
for both. One part spins where it stands. Several turn **as a block** — each one
turns on the spot and its place turns about the middle of the group — so a row of
gates becomes a column, not a row of sideways gates. Inputs move from the left
edge to the top, the width and height swap, and everything downstream (wires,
hit-testing, the marquee, the diagrams) reads the turned geometry without
knowing an angle was involved. Lettering stays upright at every angle.

One consequence is worth knowing: a circuit's pins are numbered by where they
sit, so turning a whole circuit can renumber them — which rewires every copy of
that chip already on a board. Dragging a pin has always been able to do that;
turning makes it easy to do to all of them at once, so it now says so when it
happens.

**The gates look like gates.** Each one is drawn as the distinctive shape every
schematic in the world uses — a D for AND, a pointed shield for OR, a second
curved back for XOR, a triangle for a plain pass-through, and the small circle
on the nose for the inverting half of each pair — with the **name still written
inside it**, because someone who has not learned the shapes yet needs both to
learn either. The same symbols appear beside each name in the palette and next
to the type in the side panel. The shape is drawn inside the box the gate always
occupied, so nothing about ports, wiring or layout moved.

**Circuit editor.** Drop gates on a board, drag between ports to wire them, and
click an input pin to flip it. Give a circuit input and output pins and you can
**package it as a chip**, which then appears in the palette and can be dropped
into bigger circuits — chips inside chips, as deep as you like. Edit a chip once
and every copy of it updates. There is a truth-table generator, undo/redo, and
export/import to JSON. Built-in examples run from a half adder up to a four-bit
adder and a counter driving a hex display.

There is **ROM and RAM you can type into**, which is what turns a pile of gates
into something you can write a program for: put an address in, get your stored
value out. The panel shows every word at once and lights up the one being read,
so you can watch a program being walked through. The "stored program" example
is a counter walking a ROM — the idea a computer is built on, with the
instruction decoding left out. **Number in** and **number out** parts save
lining up eight pins by hand.

Selecting a part shows **what it is made of**, and the diagram goes down as far
as you care to follow: click a flip-flop inside a RAM and you get its six NANDs,
click one of those and you get the gates it is described by. A trail across the
top says where you are. Anything already on that trail is not clickable, which
is what stops the obvious circle — an AND is made of NANDs, and a NAND is an AND
with the answer flipped. It bottoms out at the NAND; below that are transistors,
and those live on the breadboard.

**Simpler ↓** does the same thing to the whole picture at once instead of to one
part of it. Every part that has a simpler form is swapped for that form, wired
into the same place, and the caption says what you now have: a 4 × 2 RAM is 40
parts, and one press turns it into 100 NAND gates. Press it again where anything
is left — a full adder takes two, because its XORs become ORs and ANDs and NOTs
first — until there is nothing left that goes any simpler.

Doing the lot at once is often too much, so there is also a row of **open up
every…** buttons, one per kind of part in the picture, with how many of each
there are. Press *D FLIP-FLOP (8)* on that RAM and all eight flip-flops become
their six NANDs apiece — 48 of them — while the decoder around them is still
recognisably ANDs and inverters, so you can see which clump of six used to be
which bit. The picture scrolls to zoom and drags to move, because a hundred gates
fitted into one box are too small to read, and the **⤢** in the corner of the
diagram stretches it to fill the window. There is a **⛶ fullscreen** button in
the top bar too (Shift+F). Fullscreen is the one thing an embedded copy cannot
always have — a frame that was not granted permission refuses the request — so
when that happens it says to open the page in its own tab rather than doing
nothing; the ⤢ always works, since it only uses the space the page already has.

It is the same circuit at every level, which is a claim the tests check by
running the truth table and the store-and-read-back at each step rather than by
counting gates.

**Breadboard.** A solderless breadboard wired the way a real one is: five-hole
columns, four rails, a channel down the middle. Drop real 74-series DIP chips
with their actual pinouts, plus jumpers, resistors, LEDs, push buttons, DIP
switches and a seven-segment display. The chips, by family:

| | |
|---|---|
| Gates | 7400 NAND · 7402 NOR · 7404 inverter · 7408 AND · 7410/7411 3-input · 7432 OR · 7486 XOR · 74125 three-state buffer |
| Arithmetic | 7483 4-bit adder · 7485 4-bit comparator |
| Decoders & selectors | 7447 / 7448 BCD to 7-segment · 74138 3-to-8 decoder · 74151 8-to-1 selector · 74157 quad 2-to-1 selector |
| Memory & counting | 7474 D flip-flop · 7475 quad latch · 7476 JK flip-flop · 7493 ripple counter · 74161 loadable counter · 74164 shift register · 74595 shift register with latch · 74173 bus register · 74245 octal transceiver |
| Clock | a canned oscillator module |

The 74125 and the 74595's output-enable both leave their pins genuinely
undriven, which is how several chips share one wire.

There are **NPN and PNP transistors** too, so you can go a layer below the
chips and build a gate yourself. A transistor is modelled at switch level: the
level on its base decides whether collector and emitter are joined, one tick
later. That is enough for the real thing — a pull-up resistor and one
transistor is a working inverter, two in series is a NAND, two in parallel is a
NOR — and two of the worked examples build exactly that, with buttons and a
light, out of nothing but transistors and resistors.

How much fits is what decides whether a design is buildable, so the bench is
adjustable in both directions: boards are **30 to 180 columns** wide (90 by
default) and you can stack **up to four** of them, the way they would sit on a
desk. A 14-pin package covers seven columns and every chip has to straddle the
one channel, so that ranges from about four chips to roughly ninety. Boards are
separate slabs — nothing crosses from one to the next until you run a jumper,
rails included. That is enough room for a small CPU: the 74173 register and 74245 transceiver both
genuinely let go of their pins when switched off, so several of them can share
one set of wires the way a real bus does.

Selecting any part explains it: what it is in plain words, what it does, and
the specific thing that will catch you out. Chips also show what is inside
them — how many gates, and a diagram of one. Nothing works until you power the chips, and the
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
