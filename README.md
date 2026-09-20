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

**A part has a type and a name.** What it *is* — "Full adder" — is written
inside it and never changes. What it is **here** goes in the **Called** box in
the side panel and is drawn above it: *module 0*, *module 1*, *carry stage*, or
whatever you like. A chain of four identical adders is four things all called
"Full adder", and telling them apart is the job real schematics give U1, U2, U3.
Every copy of a chip carries its own name, and it saves with the circuit.

**Are the displays made of gates?** Half of one is, and you can now open that
half up. Select a **hex digit** and "what it's made of" is the decoder itself:
four bits in, seven bars out, one AND per number wired to be on for exactly that
number, then each bar an OR of every number it appears in. Sixteen ANDs shared
between all seven bars — thirty gates, not two hundred. It is generated from
`SEG_BITS`, the same table the display draws from, so the picture cannot drift
away from the part it explains; a test drives all sixteen numbers through it and
compares. And it goes down like everything else: **Simpler ↓** twice and it is
NANDs. An **LED** is not gates at all: a real one is a diode, and light comes out
because electrons crossing a junction give up energy as photons — below it is
physics, not logic, which is why it has no "what it's made of". A **7-segment**
display is seven of those lamps in a package; it decides nothing. What decides
*which* bars light is pure logic — a decoder — and that you can build here out
of ANDs and ORs, or drop on the breadboard as the **7447**, which is exactly
that chip and nothing else. The **hex digit** part does both halves for you;
7-segment hands the deciding back.

**A port with a wire on it is not decorated.** Every port used to draw a stub
and a dot nearly seven across — more than twice the width of a wire — so every
connection on the board ended in a little whisker poking out past the body of
the part. The wire is already there and already runs up to the edge; anything
drawn on top of its end is a lump on an otherwise clean line. What the marks
were really for is the ports with *nothing* on them, which do need to say
"attach here", so those keep a dot and it is no wider than a wire. Hovering
rings whichever port you are pointing at, connected or not, which is what
actually tells you where a wire would land.

**Crossings and joins look different.** Two wires meeting at a dot are one
signal; two wires crossing are two, and drawn the same way there is no telling
which you are looking at. A crossing gets a **bridge**, and the bridge is a
break: the wire passing over simply stops for eleven units, and the two ends of
the break turn aside as they reach it. That is enough to read as one line
lifting around another, and it is nothing like the row of battlements a box
drawn over every crossing makes of a busy board — which is what a twelve by six
square step, twice the height of the wire it stepped over, actually looked like.

The gap has to be wider than a wire to clear the one hopping over it, and it is
cut across both of them, so the wire underneath is painted back in afterwards.
Without that both lines break at the crossing, which says nothing at all about
which of them passes over. Only one of each pair hops, and wires on the same
signal are never bridged, because a fan-out is a join.

Routes are worked out for the whole board in one pass rather than each wire on
its own, so every wire can see which lanes the ones before it have taken and
step off them. Left to reach for the midpoint independently, two wires with the
same start and end heights land exactly on top of each other — two signals drawn
as a single line, which is worse than an unmarked crossing because there is
nothing at all to see. Half the built-in examples had that; they now cross, and
the crossings are marked.

A wire that genuinely cannot get round something goes **over** it and bridges at
the edge, so a line disappearing behind a chip is never mistaken for a line that
stops there.

**Junctions.** One signal often has to feed several inputs. A junction catches
clicks from a long way outside the dot it draws, in both the body and the
ports — one grid square is a hard thing to hit with a mouse and a harder one
with a finger, so the catch is three times the dot.  Select a wire and
press <kbd>J</kbd> (or the **Add a junction** button) and one is spliced in
where you are pointing — the wire becomes two, with a junction between them you
can run as many more wires from as you like. That is the T, and the cross, that
a schematic draws as a solder dot, and it is drawn as one: a dot a little
fatter than the wire and nothing else. There used to be a stub drawn from the
middle towards each wire meeting there, to make the join read as a T or a
cross, but it was aimed at the far *end* of the wire — and a wire leaves square
and then turns, so the stub pointed somewhere the wire never went. What you got
was a dot with two or three diagonal spikes coming off it at angles that
matched nothing else on the board. The wires run right up to the dot; they draw
the T themselves. Dropping a wire onto a wire still splices one in too — the
difference is that this is a way to ask for one.

**Any wire joins any other wire, at any point.** A junction takes as many wires
in as out. It used to take exactly one, and that one limitation was doing a
surprising amount of damage: the only gesture that could make a junction was
dragging an *unconnected input* onto a wire, and every other way of saying "join
these two" — branching off a wire and dropping it on another, pulling a plug out
and dropping it on the wire you wanted it fed from, dragging straight from an
output onto a wire — was turned away with *two outputs cannot share a wire*.
Worse, the one case that was not refused was the destructive one: dropping a
wire onto an existing junction re-drove its single input, silently unplugging
whatever had been feeding it and re-pointing everything downstream at the new
source.

So a junction now gathers. Each wire that arrives takes a slot of its own,
nothing already joined is unplugged to make room, and the compiler fuses every
wire meeting there into one net. Dropping a live end on a wire splices a
junction in at that point and joins it whichever end you are holding: an input
looking for a source is fed by the junction, and an end that carries a signal
becomes another wire into it. The ports all sit on the dot rather than spreading
down an edge, so a junction with four wires on it is still one grid square.

That does let you join two wires driven by different outputs, which is a short.
It is allowed, and reported: a toast at the moment you make it, the net counted
in the warning bar, and the ports drawn in red once the two sources disagree.
The breadboard has always reported a short rather than refusing the jumper that
caused it, and this is the same bargain — you can build the wrong thing, and the
board tells you what is wrong with it.

**Everything measures a whole number of grid squares.** Parts land on the
ten-unit grid, and wires run on the half-lines between those lines — …5 rather
than …0. That only works if the two agree, and for a long time they did not.
Box heights were 38 for a one-input part, 56 for two, 26 for an LED, 18 for a
junction, so ports came out at 19, 18, 13 and 9 units down: three different
sub-grid offsets, none of them on a lane. The consequence is easy to miss and
impossible to unsee. Two parts sitting perfectly on the grid could not have a
straight wire between them, because their ports were a couple of units apart in
a direction the grid could not express — the router snapped to the nearest lane
and left a kink at every port on the board. The tidy-up button papered over it
by shoving parts a few units off the grid, which fixed the wire and broke the
thing the grid was for.

So heights are now always ten more than a multiple of twenty — 30, 50, 70 — with
ten units of padding above the first port and below the last. That puts every
port at h/2 for one port, and at 15, 35, 55… for several, whatever the part is:
one lane, shared by every kind of part. Widths round up to whole squares too, so
a chip measures the same in squares however long its name is. Across the
built-in examples that took ports off the lane from 193 to zero, and the number
of dead-level wires up by two thirds. Because a miss is now a whole square
rather than three units, the drag-time pull is a whole square as well, and
closing it leaves the part on the grid instead of parked between two lines.

**Wires go round things.** Parts sit on the ten-unit grid; wires run on the
lines halfway between them — ...5 rather than ...0 — so a wire can never lie
along a part's edge, where you cannot tell whether it is touching the part or
passing it. From there routing is a shortest-path search over those half-lines,
with two things added to the price of a step. **Turning costs twelve times what
going straight does**, so a route comes out with as few corners as it can manage
instead of staircasing. And **a lane somebody else is already on, in the
direction you are travelling, costs more than an empty one**, so wires spread
out rather than piling onto the same line.

That last one used to cost the same whether you were running *along* somebody
else's lane or *crossing* it, and the two are not remotely the same thing. Two
wires lying along one lane are a single line to look at, which is the ambiguity
the whole scheme exists to prevent; two wires crossing are a crossing, drawn
with a bridge, and perfectly readable. Charging for both meant wires bent round
each other to dodge crossings that were never a problem. The lane now records
which way it was claimed, so running along it still costs and crossing it is
free.

A part is dear to cross, not impossible. Hard walls meant a wire that was boxed
in found no route at all and fell back to a curve straight across the board,
which is worse in every way than stepping over one chip. But the price was four
hundred times an empty cell, and that is not "dear", it is "never": a wire would
walk the width of the board sooner than step over a single gate, and that long
way round is what you actually saw on screen. Sixty prices a crossing at roughly
what going round a gate costs, so the detour still wins wherever there is room
for it, and only a genuinely boxed-in wire goes over the top — where the
crossing is bridged.

Clearance is in proportion to the thing, too. Every part was fenced off by seven
units on each side, which is sensible for a chip and absurd for a junction: a
twenty-four unit no-go area around a dot seven across, which sent wires a long
way round something they could have passed within a hair of. Anything a couple
of grid squares or smaller gets two. Together those took the total slack across
the built-in examples — how much longer every wire is than the straight line
between its ports — from 6610 down to about 4950.

Routes are worked out for the whole board in one pass, so each wire can see the
lanes the ones before it have taken, and remembered until something moves.
Corners are rounded off so it still reads as a wire and not a circuit-board
trace. Above a few hundred parts routing is skipped, where the generated arrays
are laid out by machine anyway.

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
knowing an angle was involved. At a quarter turn the writing **rides with the part**, reading like the spine
of a book, so a long name fits down a tall narrow box instead of hanging out
either side of it. Half a turn is the exception: the box is the same shape
either way, and riding with it would only put the writing upside down.

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
part, drag a wire, join one wire to another, lay a jumper, package a chip,
reload and find it all still
there). No dependencies — it drives the browser over the DevTools protocol with
what Node 22 already has. Set `CHROME=/path/to/chrome` if it cannot find a
browser by itself.

---

## Data sources (all free, no API keys)

- **Map & tiles:** [Leaflet](https://leafletjs.com/) for markers and the route line, with the map itself drawn by [MapLibre GL](https://maplibre.org/) in our own style (`js/mapstyle.js`) from [OpenStreetMap](https://www.openstreetmap.org/) data served by [OpenFreeMap](https://openfreemap.org/), plus [Overture Maps](https://overturemaps.org/) for satellite land cover and real businesses (read straight from its PMTiles files) — no API key. If the browser cannot do WebGL or the tile server is unreachable, it falls back to Esri's World Street Map pictures.
- **Places, addresses and recent searches:** click a business marker or (zoomed in) a house number to select it as the destination; type a business name or an address in the search box (places already on the map are suggested instantly, plus online results); every place you choose is remembered in *Recent searches* (stored only in your browser, removable one by one or all at once). Logic in `js/places.js`.
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
