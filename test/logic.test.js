/* ===========================================================================
   Checks for logic.html.

     node test/logic.test.js               # run the checks
     SHOT=1 node test/logic.test.js        # ...and save screenshots as well

   It opens the real page in headless Chromium and then does two things: calls
   the simulator directly through `window.LogicLab` (truth tables, latches,
   breadboard netlists), and drives the actual interface with synthetic mouse
   events (place a part, drag a wire, lay a jumper, package a chip, reload).

   No dependencies — it talks to the browser over the DevTools protocol using
   the WebSocket and fetch built into Node 22. Set CHROME=/path/to/chrome if it
   cannot find a browser on its own.
   =========================================================================== */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PAGE = 'file://' + path.resolve(process.argv[2] || path.join(__dirname, '..', 'logic.html'));
const SHOT_DIR = process.env.SHOT_DIR || path.join(os.tmpdir(), 'logic-lab-shots');

function findChrome() {
  if (process.env.CHROME) {
    try { fs.statSync(process.env.CHROME); } catch (e) {
      console.error('CHROME is set to ' + process.env.CHROME + ', which does not exist.');
      process.exit(2);
    }
    return process.env.CHROME;
  }
  const guesses = [
    '/opt/pw-browsers/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const g of guesses) { try { if (fs.statSync(g).isFile()) return g; } catch (e) { /* next */ } }
  for (const name of ['google-chrome', 'chromium', 'chromium-browser', 'chrome']) {
    try { return execSync('command -v ' + name, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
    catch (e) { /* next */ }
  }
  return null;
}
const CHROME = findChrome();

const TESTS = String.raw`
(async () => {
  const L = window.LogicLab;
  const out = [];
  const ok = (name, cond, extra) => out.push({ name, pass: !!cond, extra: extra === undefined ? '' : String(extra) });

  /* ---------- helper: run a def's truth table ---------- */
  const tt = (def) => L.computeTruthTable(def);
  const rowStr = (r) => r.in.join('') + '->' + r.out.join('');

  /* 1. half adder */
  {
    const t = tt(L.examples.EDITOR_EXAMPLES[0].make().work);
    const got = t.rows.map(rowStr).join(' ');
    ok('half adder truth table', got === '00->00 01->10 10->10 11->01', got + ' | ins=' + t.ins + ' outs=' + t.outs);
  }

  /* 2. full adder */
  {
    const t = tt(L.examples.EDITOR_EXAMPLES[1].make().work);
    let good = t.rows.length === 8;
    for (const r of t.rows) {
      const sum = r.in[0] + r.in[1] + r.in[2];
      if (r.out[0] !== (sum & 1) || r.out[1] !== (sum > 1 ? 1 : 0)) good = false;
    }
    ok('full adder arithmetic', good, t.rows.map(rowStr).join(' '));
  }

  /* 3. 4-bit adder (exercises chip flattening two levels deep) */
  {
    const ex = L.examples.EDITOR_EXAMPLES[2].make();
    for (const c of ex.chips) L.lib[c.id] = c;
    const def = ex.work;
    const io = L.ioOrder(def);
    const c = L.compile(def);
    ok('4-bit adder compiles clean', c.errors.length === 0, c.errors.join(';'));
    // 4 full adders x 5 gates each, expanded out of the chip instances
    const gates = c.prims.filter(p => ['XOR', 'AND', 'OR'].includes(p.type)).length;
    ok('4-bit adder flattens to 20 gates', gates === 20, gates + ' of ' + c.prims.length);
    let bad = null;
    for (const [a, b] of [[0, 0], [1, 1], [5, 3], [9, 7], [15, 15], [8, 8], [12, 5]]) {
      io.ins.forEach((p) => {
        const m = p.label.match(/^([AB])(\d)$/);
        const v = m[1] === 'A' ? a : b;
        p.value = (v >> +m[2]) & 1;
      });
      const sim = new L.Sim(c);
      const settled = sim.settle(300, 0);
      let s = 0;
      io.outs.forEach((p) => {
        const bit = sim.val(c.portNet.get(p.id + '.i0'));
        const w = p.label === 'Cout' ? 4 : +p.label.slice(1);
        s |= bit << w;
      });
      if (!settled || s !== a + b) bad = a + '+' + b + '=' + s;
    }
    ok('4-bit adder adds', !bad, bad);
  }

  /* 4. SR latch holds state */
  {
    const def = L.examples.EDITOR_EXAMPLES[3].make().work;
    const io = L.ioOrder(def);
    const c = L.compile(def);
    const S = io.ins.find(p => p.label === 'S'), R = io.ins.find(p => p.label === 'R');
    const Q = io.outs.find(p => p.label === 'Q');
    const qNet = c.portNet.get(Q.id + '.i0');
    const sim = new L.Sim(c);
    const run = (n) => { for (let i = 0; i < n; i++) sim.tick(0); };
    S.value = 1; R.value = 0; run(20);
    const setQ = sim.val(qNet);
    S.value = 0; run(20);
    const heldQ = sim.val(qNet);
    R.value = 1; run(20);
    const resetQ = sim.val(qNet);
    R.value = 0; run(20);
    const heldQ2 = sim.val(qNet);
    ok('SR latch sets, holds, resets, holds', setQ === 1 && heldQ === 1 && resetQ === 0 && heldQ2 === 0,
       [setQ, heldQ, resetQ, heldQ2].join(','));
  }

  /* 4b. an idle latch must settle rather than ring — the metastability case */
  {
    const def = L.examples.EDITOR_EXAMPLES[3].make().work;
    const c = L.compile(def);
    const sim = new L.Sim(c);
    const io = L.ioOrder(def);
    io.ins.forEach(p => { p.value = 0; });
    const settled = sim.settle(200, 0);
    const q = sim.val(c.portNet.get(io.outs[0].id + '.i0'));
    const qb = sim.val(c.portNet.get(io.outs[1].id + '.i0'));
    ok('idle SR latch settles instead of oscillating', settled && q !== qb, 'settled=' + settled + ' Q=' + q + ' Qb=' + qb);
  }

  /* 5. six-NAND D flip-flop behaves like an edge-triggered flip-flop */
  {
    const def = L.examples.EDITOR_EXAMPLES[4].make().work;
    const io = L.ioOrder(def);
    const c = L.compile(def);
    const D = io.ins.find(p => p.label === 'D'), CK = io.ins.find(p => p.label === 'CLK');
    const Q = io.outs.find(p => p.label === 'Q');
    const qNet = c.portNet.get(Q.id + '.i0');
    const sim = new L.Sim(c);
    const run = (n) => { for (let i = 0; i < n; i++) sim.tick(0); };
    const pulse = () => { CK.value = 0; run(30); CK.value = 1; run(30); };
    D.value = 1; CK.value = 0; run(40);
    const before = sim.val(qNet);
    pulse();
    const afterHigh = sim.val(qNet);
    D.value = 0; run(40);
    const stillHigh = sim.val(qNet);      // D changed but no clock edge yet
    pulse();
    const afterLow = sim.val(qNet);
    ok('NAND D flip-flop latches on the edge only',
       afterHigh === 1 && stillHigh === 1 && afterLow === 0,
       'before=' + before + ' afterHigh=' + afterHigh + ' stillHigh=' + stillHigh + ' afterLow=' + afterLow);
  }

  /* 6. ring oscillator actually oscillates */
  {
    const def = L.examples.EDITOR_EXAMPLES[6].make().work;
    const c = L.compile(def);
    const sim = new L.Sim(c);
    const o = L.ioOrder(def).outs[0];
    const net = c.portNet.get(o.id + '.i0');
    const seen = new Set();
    for (let i = 0; i < 40; i++) { sim.tick(0); seen.add(sim.val(net)); }
    ok('ring oscillator toggles', seen.size === 2 && !sim.settle(20, 0), [...seen].join(','));
  }

  /* 7. counter counts */
  {
    const def = L.examples.EDITOR_EXAMPLES[7].make().work;
    const io = L.ioOrder(def);
    const c = L.compile(def);
    const nets = io.outs.map(p => c.portNet.get(p.id + '.i0'));
    const sim = new L.Sim(c);
    const clk = c.prims.find(p => p.type === 'CLOCK');
    const read = () => nets.reduce((a, n, i) => a | (sim.val(n) << i), 0);
    // drive the clock by hand through simulated time
    let t = 0, seq = [];
    for (let e = 0; e < 20; e++) { t += 400; for (let i = 0; i < 12; i++) sim.tick(t); seq.push(read()); }
    const uniq = [...new Set(seq)];
    let mono = true;
    for (let i = 1; i < seq.length; i++) if (seq[i] !== (seq[i - 1] + 1) % 16 && seq[i] !== seq[i - 1]) mono = false;
    ok('4-bit counter counts up in order', uniq.length > 4 && mono, seq.join(','));
  }

  /* 8. tunnels join nets with the same name */
  {
    const b = L.builder('tunnel test');
    const a = b.pin('a', 0, 0), o = b.out('o', 400, 0);
    const t1 = b.add('TUNNEL', 100, 0, { label: 'bus' });
    const t2 = b.add('TUNNEL', 250, 0, { label: 'BUS' });   // case-insensitive
    b.w(a, 0, t1, 0); b.w(t2, 0, o, 0);
    const t = L.computeTruthTable(b.def);
    ok('tunnels connect by name', t.rows.map(r => r.in[0] + '' + r.out[0]).join(' ') === '00 11',
       JSON.stringify(t.rows));
  }

  /* 9. two outputs on one net is reported as a clash */
  {
    const b = L.builder('clash');
    const c0 = b.add('CONST', 0, 0, { value: 0 });
    const c1 = b.add('CONST', 0, 100, { value: 1 });
    const o = b.out('o', 300, 50);
    b.def.wires.push({ id: 'w1', a: { n: c0.id, s: 'out', i: 0 }, b: { n: o.id, s: 'in', i: 0 } });
    b.def.wires.push({ id: 'w2', a: { n: c1.id, s: 'out', i: 0 }, b: { n: o.id, s: 'in', i: 0 } });
    const c = L.compile(b.def);
    const sim = new L.Sim(c);
    sim.tick(0);
    ok('conflicting drivers flagged', sim.clash[c.portNet.get(o.id + '.i0')] === 1);
  }

  /* 9b. every "what it's made of" recipe must really behave like the part it
         claims to explain — a wrong one would teach the wrong thing */
  {
    const sig = (def) => {
      const t = L.computeTruthTable(def);
      return t.error ? 'ERR:' + t.error : t.rows.map(r => r.in.join('') + '>' + r.out.join('')).join(' ');
    };
    const reference = (type, n) => {
      const b = L.builder('ref');
      const pins = [];
      for (let i = 0; i < n; i++) pins.push(b.pin(String.fromCharCode(65 + i), 0, i * 100));
      const g = b.add(type, 200, 0), o = b.out('out', 420, 0);
      pins.forEach((p, i) => b.w(p, 0, g, i));
      b.w(g, 0, o, 0);
      return b.def;
    };
    for (const [type, n] of [['NOT', 1], ['BUF', 1], ['AND', 2], ['OR', 2],
    ['NAND', 2], ['NOR', 2], ['XOR', 2], ['XNOR', 2]]) {
      const rec = L.RECIPES[type];
      const got = sig(rec.make()), want = sig(reference(type, n));
      ok('the ' + type + ' recipe behaves like a real ' + type, got === want, got + '  vs  ' + want);
    }

    /* the two with memory need a sequence rather than a table */
    const trace = (def, names, steps) => {
      const io = L.ioOrder(def);
      const c = L.compile(def);
      const sim = new L.Sim(c);
      const pins = names.map(nm => io.ins.find(p => p.label === nm));
      const net = c.portNet.get(io.outs[0].id + '.i0');
      let s = '';
      for (const step of steps) {
        pins.forEach((p, i) => { p.value = step[i]; });
        for (let k = 0; k < 60; k++) sim.tick(0);
        s += sim.val(net);
      }
      return s;
    };
    const latchRef = (() => {
      const b = L.builder('ref latch');
      const d = b.pin('D', 0, 0), e = b.pin('E', 0, 100);
      const g = b.add('DLATCH', 200, 0), q = b.out('Q', 420, 0);
      b.w(d, 0, g, 0); b.w(e, 0, g, 1); b.w(g, 0, q, 0);
      return b.def;
    })();
    const latchSteps = [[1, 1], [1, 0], [0, 0], [0, 1], [1, 0], [1, 1]];
    const gotL = trace(L.RECIPES.DLATCH.make(), ['D', 'E'], latchSteps);
    const wantL = trace(latchRef, ['D', 'E'], latchSteps);
    ok('the D latch recipe follows D while enabled and holds after',
      gotL === wantL && gotL === '111001', gotL + ' vs ' + wantL);

    const ffRef = (() => {
      const b = L.builder('ref ff');
      const d = b.pin('D', 0, 0), c2 = b.pin('CLK', 0, 100);
      const g = b.add('DFF', 200, 0), q = b.out('Q', 420, 0);
      b.w(d, 0, g, 0); b.w(c2, 0, g, 1); b.w(g, 0, q, 0);
      return b.def;
    })();
    const ffSteps = [[1, 0], [1, 1], [0, 1], [0, 0], [1, 0], [0, 0], [0, 1], [1, 1]];
    const gotF = trace(L.RECIPES.DFF.make(), ['D', 'CLK'], ffSteps);
    const wantF = trace(ffRef, ['D', 'CLK'], ffSteps);
    ok('the D flip-flop recipe copies D only on the clock edge',
      gotF === wantF && gotF === '01111100', gotF + ' vs ' + wantF);
  }

  /* ---------- breadboard ---------- */
  const boardRun = (board, ticks) => {
    const c = L.compileBoard(board);
    const sim = new L.BoardSim(c);
    for (let i = 0; i < (ticks || 40); i++) sim.tick(1000 + i);
    return { c, sim };
  };
  const findPart = (board, k, type) => board.parts.find(p => p.k === k && (!type || p.type === type));

  /* 10. board copper: a column ties five holes, rails run the length,
         and the two halves of a column are separate */
  {
    const b = { cols: 60, parts: [] };
    const c = L.compileBoard(b);
    const n = (r, col) => c.holeNet.get(L.tieKey(r, col));
    ok('column A-E is one net', n(0, 7) === n(4, 7));
    ok('column F-J is one net', n(5, 7) === n(9, 7));
    ok('the channel separates the halves', n(4, 7) !== n(5, 7));
    ok('a rail runs the whole length', n(100, 0) === n(100, 59));
    ok('the two + rails are separate strips', n(100, 0) !== n(103, 0));
    ok('+ and − rails are separate', n(100, 0) !== n(101, 0));
    ok('neighbouring columns are separate', n(0, 7) !== n(0, 8));
  }

  /* 11. an unpowered chip does nothing */
  {
    const b = { cols: 60, parts: [{ k: 'ic', id: 'x', type: '7400', col: 5 }] };
    const { sim } = boardRun(b, 10);
    ok('unpowered chip is reported', sim.unpowered.length === 1, sim.unpowered.join(','));
  }

  /* 12. a powered 7400 NANDs, and a floating input reads high */
  {
    const P = (r, c2) => ({ r, c: c2 });
    const parts = [
      { k: 'vcc', id: 'v1', a: P(100, 0) }, { k: 'gnd', id: 'g1', a: P(101, 0) },
      { k: 'ic', id: 'ic', type: '7400', col: 5 },     // pin 14 -> (4,5), pin 7 -> (5,11)
      { k: 'wire', id: 'w1', a: P(2, 5), b: P(100, 5) },
      { k: 'wire', id: 'w2', a: P(7, 11), b: P(101, 11) },
    ];
    const b = { cols: 60, parts };
    let { c, sim } = boardRun(b, 20);
    const hn = (r, col) => c.holeNet.get(L.tieKey(r, col));
    // gate 1: 1A pin1 (5,5), 1B pin2 (5,6), 1Y pin3 (5,7)
    ok('7400 is powered', sim.unpowered.length === 0, sim.unpowered.join(','));
    ok('floating inputs NAND to 0', sim.val[hn(5, 7)] === 0 && sim.str[hn(5, 7)] === 2,
       'y=' + sim.val[hn(5, 7)] + ' str=' + sim.str[hn(5, 7)]);
    // now tie 1A to ground -> output must go high
    parts.push({ k: 'wire', id: 'w3', a: P(7, 5), b: P(101, 5) });
    ({ c, sim } = boardRun(b, 20));
    const hn2 = (r, col) => c.holeNet.get(L.tieKey(r, col));
    ok('7400 with one input low outputs 1', sim.val[hn2(5, 7)] === 1, sim.val[hn2(5, 7)]);
  }

  /* 12b. every chip, exercised on a powered board through its real pins.
          Wires drive the input pins; the outputs are read back off the nets. */
  {
    const rig = (type, drive) => {
      // pin -> hole, using the part's own leg positions, then a clip on each
      const parts = [{ k: 'ic', id: 'u1', type, col: 4 }];
      const p0 = { k: 'ic', id: 'u1', type, col: 4 };
      const holes = {};
      for (const h of L.partHoles(p0)) holes[h.pin] = h;
      const spec = L.ICS[type];
      const free = (h, i) => ({ r: h.r >= 5 ? 6 + i : 3 - i, c: h.c });
      parts.push({ k: 'vcc', id: 'v', a: free(holes[spec.vcc], 0) });
      parts.push({ k: 'gnd', id: 'g', a: free(holes[spec.gnd], 0) });
      let n = 0;
      for (const pin in drive) {
        const h = holes[pin];
        parts.push(drive[pin]
          ? { k: 'vcc', id: 'd' + (n++), a: free(h, 1) }
          : { k: 'gnd', id: 'd' + (n++), a: free(h, 1) });
      }
      const board = { cols: 60, parts };
      const c = L.compileBoard(board);
      const sim = new L.BoardSim(c);
      for (let i = 0; i < 30; i++) sim.tick(1000 + i);
      const read = (pin) => {
        const net = c.holeNet.get(L.tieKey(holes[pin].r, holes[pin].c));
        return sim.str[net] === 0 ? 'Z' : sim.val[net];
      };
      return { read, sim, board, c, holes, free, parts };
    };
    const bits = (read, pins) => pins.map(read).join('');

    /* 7483: 5 + 6 + carry 1 = 12 -> S=1100, C4=0 */
    {
      const r = rig('7483', {
        10: 1, 8: 0, 3: 1, 1: 0,       // A = 0101 = 5
        11: 0, 7: 1, 4: 1, 16: 0,      // B = 0110 = 6
        13: 1,                          // carry in
      });
      const sum = (r.read(9) ? 1 : 0) + (r.read(6) ? 2 : 0) + (r.read(2) ? 4 : 0)
        + (r.read(15) ? 8 : 0) + (r.read(14) ? 16 : 0);
      ok('7483 adds 5 + 6 + 1', sum === 12, sum);
    }
    /* 7485: 9 vs 4 */
    {
      const r = rig('7485', {
        10: 1, 12: 0, 13: 0, 15: 1,    // A = 1001 = 9
        9: 0, 11: 0, 14: 1, 1: 0,      // B = 0100 = 4
        4: 0, 3: 1, 2: 0,              // cascade: equal
      });
      ok('7485 sees 9 > 4', bits(r.read, [5, 6, 7]) === '100', bits(r.read, [5, 6, 7]));
    }
    /* 74151: select 5 picks D5 */
    {
      const r = rig('74151', {
        11: 1, 10: 0, 9: 1,            // C B A = 101 = 5
        7: 0,                           // strobe low = enabled
        14: 1, 13: 0,                   // D5 high, D6 low
      });
      ok('74151 routes the input you select', bits(r.read, [5, 6]) === '10', bits(r.read, [5, 6]));
    }
    /* 74157: SELECT low passes A, high passes B */
    {
      const a = rig('74157', { 15: 0, 1: 0, 2: 1, 3: 0 });
      const b = rig('74157', { 15: 0, 1: 1, 2: 1, 3: 0 });
      ok('74157 switches between its A and B inputs',
        a.read(4) === 1 && b.read(4) === 0, a.read(4) + '/' + b.read(4));
    }
    /* 7448: 3 lights a b c d g, and unlike the 7447 it drives them high */
    {
      const r = rig('7448', { 7: 1, 1: 1, 2: 0, 6: 0, 3: 1, 5: 1, 4: 1 });
      const seg = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
      const pin = { a: 13, b: 12, c: 11, d: 10, e: 9, f: 15, g: 14 };
      const lit = seg.filter((s) => r.read(pin[s]) === 1).join('');
      ok('7448 spells a 3 with its outputs high', lit === 'abcdg', lit);
    }
    /* 74125: enabled passes through, disabled leaves the wire floating */
    {
      const on = rig('74125', { 1: 0, 2: 1 });
      const off = rig('74125', { 1: 1, 2: 1 });
      ok('74125 passes through, then lets go of the wire',
        on.read(3) === 1 && off.read(3) === 'Z', on.read(3) + '/' + off.read(3));
    }
    /* 74245: passes eight signals one way, and lets go when disabled */
    {
      const on = rig('74245', { 19: 0, 1: 1, 2: 1, 3: 0 });      // enabled, A -> B
      const off = rig('74245', { 19: 1, 1: 1, 2: 1 });           // disabled
      const back = rig('74245', { 19: 0, 1: 0, 18: 1, 17: 0 });  // enabled, B -> A
      ok('74245 passes A across to B', on.read(18) === 1 && on.read(17) === 0,
        on.read(18) + '' + on.read(17));
      // pin 3 is A2, which the rig is not driving — so if the chip is quiet it floats
      ok('74245 lets go of both sides when disabled',
        off.read(18) === 'Z' && off.read(3) === 'Z', off.read(18) + '/' + off.read(3));
      ok('74245 goes the other way when told to',
        back.read(2) === 1 && back.read(3) === 0, back.read(2) + '' + back.read(3));
    }
    /* 7475: transparent while enabled, holds when the enable drops */
    {
      const board = (() => {
        const p0 = { k: 'ic', id: 'u1', type: '7475', col: 4 };
        const holes = {}; for (const h of L.partHoles(p0)) holes[h.pin] = h;
        const free = (h, i) => ({ r: h.r >= 5 ? 6 + i : 3 - i, c: h.c });
        const parts = [p0,
          { k: 'vcc', id: 'v', a: free(holes[5], 0) },
          { k: 'gnd', id: 'g', a: free(holes[12], 0) },
          { k: 'vcc', id: 'd', a: free(holes[2], 1) },        // 1D high
          { k: 'vcc', id: 'e', a: free(holes[13], 1) }];      // enable 1-2 high
        return { parts, holes, free };
      })();
      let c = L.compileBoard({ cols: 60, parts: board.parts });
      let sim = new L.BoardSim(c);
      for (let i = 0; i < 30; i++) sim.tick(1000 + i);
      const q = () => {
        const h = board.holes[16];
        return sim.val[c.holeNet.get(L.tieKey(h.r, h.c))];
      };
      const held1 = q();
      board.parts = board.parts.filter((p) => p.id !== 'e');   // drop the enable
      board.parts.push({ k: 'gnd', id: 'e2', a: board.free(board.holes[13], 1) });
      board.parts = board.parts.filter((p) => p.id !== 'd');   // and change D
      board.parts.push({ k: 'gnd', id: 'd2', a: board.free(board.holes[2], 1) });
      const prev = sim;
      c = L.compileBoard({ cols: 60, parts: board.parts });
      sim = new L.BoardSim(c, prev);
      for (let i = 0; i < 30; i++) sim.tick(2000 + i);
      ok('7475 holds its bit once the enable drops', held1 === 1 && q() === 1, held1 + '/' + q());
    }
    /* 74161, 74164, 74595, 7476 all need a clock, so drive one by hand */
    const clocked = (type, statics, clkPin, steps) => {
      const p0 = { k: 'ic', id: 'u1', type, col: 4 };
      const holes = {}; for (const h of L.partHoles(p0)) holes[h.pin] = h;
      const spec = L.ICS[type];
      const free = (h, i) => ({ r: h.r >= 5 ? 6 + i : 3 - i, c: h.c });
      const base = [p0,
        { k: 'vcc', id: 'v', a: free(holes[spec.vcc], 0) },
        { k: 'gnd', id: 'g', a: free(holes[spec.gnd], 0) }];
      let n = 0;
      for (const pin in statics) {
        base.push(statics[pin]
          ? { k: 'vcc', id: 's' + (n++), a: free(holes[pin], 1) }
          : { k: 'gnd', id: 's' + (n++), a: free(holes[pin], 1) });
      }
      let sim = null, c = null;
      const out = [];
      for (const step of steps) {
        const parts = base.concat([step.clk
          ? { k: 'vcc', id: 'clk', a: free(holes[clkPin], 2) }
          : { k: 'gnd', id: 'clk', a: free(holes[clkPin], 2) }]);
        let e = 0;
        for (const pin in (step.also || {})) {
          parts.push(step.also[pin]
            ? { k: 'vcc', id: 'x' + (e++), a: free(holes[pin], 3) }
            : { k: 'gnd', id: 'x' + (e++), a: free(holes[pin], 3) });
        }
        const prev = sim;
        c = L.compileBoard({ cols: 60, parts });
        sim = new L.BoardSim(c, prev);
        for (let i = 0; i < 25; i++) sim.tick(1000 + out.length * 100 + i);
        const rd = (pin) => {
          const h = holes[pin];
          const net = c.holeNet.get(L.tieKey(h.r, h.c));
          return sim.str[net] === 0 ? 'Z' : sim.val[net];
        };
        if (step.read) out.push(step.read.map(rd).join(''));
      }
      return out;
    };
    /* 74161 counts 0,1,2,3 on rising edges (QD QC QB QA) */
    {
      const seq = [];
      for (let i = 0; i < 5; i++) { seq.push({ clk: 0 }); seq.push({ clk: 1, read: [11, 12, 13, 14] }); }
      const got = clocked('74161', { 1: 1, 9: 1, 7: 1, 10: 1 }, 2, seq);
      ok('74161 counts up on each clock edge',
        got.join(' ') === '0001 0010 0011 0100 0101', got.join(' '));
    }
    /* 74164 walks a 1 along its outputs */
    {
      const seq = [];
      for (let i = 0; i < 3; i++) { seq.push({ clk: 0 }); seq.push({ clk: 1, read: [3, 4, 5, 6] }); }
      const got = clocked('74164', { 9: 1, 1: 1, 2: 1 }, 8, seq);
      ok('74164 shifts a bit along one place per clock',
        got.join(' ') === '1000 1100 1110', got.join(' '));
    }
    /* 7476 with J=K=1 toggles on each falling edge */
    {
      const seq = [];
      for (let i = 0; i < 4; i++) { seq.push({ clk: 1 }); seq.push({ clk: 0, read: [15] }); }
      const got = clocked('7476', { 2: 1, 3: 1, 4: 1, 16: 1 }, 1, seq);
      ok('7476 toggles on the falling edge when J and K are high',
        got.join('') === '1010', got.join(''));
    }
    /* 74173: loads on a clock edge, and only speaks when its outputs are on */
    {
      const seq = [
        { clk: 0 }, { clk: 1 }, { clk: 0, read: [3, 4, 5, 6] },
      ];
      // D1..D4 = 1010, both input enables low, clear low, outputs on
      const got = clocked('74173', { 14: 1, 13: 0, 12: 1, 11: 0, 9: 0, 10: 0, 15: 0, 1: 0, 2: 0 }, 7, seq);
      ok('74173 loads four bits on the clock edge', got[0] === '1010', got[0]);
      const quiet = clocked('74173', { 14: 1, 13: 0, 12: 1, 11: 0, 9: 0, 10: 0, 15: 0, 1: 1, 2: 0 }, 7, seq);
      ok('74173 lets go of the bus when its outputs are switched off',
        quiet[0] === 'ZZZZ', quiet[0]);
    }
    /* 74595: shift three bits in, then pulse the latch clock */
    {
      const shift = [
        { clk: 0, also: { 12: 0 } }, { clk: 1, also: { 12: 0 } },
        { clk: 0, also: { 12: 0 } }, { clk: 1, also: { 12: 0 } },
        { clk: 0, also: { 12: 0 } }, { clk: 1, also: { 12: 0 } },
        { clk: 0, also: { 12: 0 }, read: [15, 1, 2] },
      ];
      const latch = shift.concat([
        { clk: 0, also: { 12: 1 }, read: [15, 1, 2] },
      ]);
      const got = clocked('74595', { 14: 1, 13: 0, 10: 1 }, 11, latch);
      ok('74595 keeps its outputs still until the latch clock ticks',
        got[0] === '000' && got[1] === '111', got.join(' then '));

      /* and with output-enable high it drives nothing at all */
      const off = clocked('74595', { 14: 1, 13: 1, 10: 1 }, 11, latch);
      ok('74595 lets go of its outputs when disabled', off[1] === 'ZZZ', off.join(' then '));
    }
  }

  /* 12c. gates built out of transistors, with no chip involved */
  {
    const run = (board, ticks) => {
      const c = L.compileBoard(board);
      const sim = new L.BoardSim(c);
      for (let i = 0; i < (ticks || 40); i++) sim.tick(1000 + i);
      return sim;
    };
    /* the inverter: button up = light on, button down = light off */
    {
      const board = L.examples.BOARD_EXAMPLES[4].make();
      const btn = board.parts.find(p => p.k === 'btn');
      const led = board.parts.find(p => p.k === 'led');
      let sim = run(board);
      const idle = led._lit, shorts1 = sim.shorts;
      btn.pressed = true;
      sim = run(board);
      const pressed = led._lit;
      ok('one transistor makes a working NOT gate',
        idle === true && pressed === false, 'idle=' + idle + ' pressed=' + pressed);
      ok('the transistor inverter has no shorts',
        shorts1 === 0 && sim.shorts === 0, shorts1 + '/' + sim.shorts);
      btn.pressed = false;
    }
    /* the NAND: only both-pressed puts the light out */
    {
      const board = L.examples.BOARD_EXAMPLES[5].make();
      const [a, b] = board.parts.filter(p => p.k === 'btn');
      const led = board.parts.find(p => p.k === 'led');
      const table = [];
      for (const [pa, pb] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
        a.pressed = !!pa; b.pressed = !!pb;
        const sim = run(board, 60);
        table.push(led._lit ? 1 : 0);
        if (sim.shorts) table.push('SHORT');
      }
      ok('two transistors make a working NAND gate', table.join('') === '1110', table.join(''));
      a.pressed = false; b.pressed = false;
    }
    /* the switch itself: base high joins collector to emitter, base low parts them */
    {
      const mk = (baseHigh) => ({
        cols: 60, parts: [
          { k: 'npn', id: 't', r: 7, c: 10 },
          { k: 'gnd', id: 'g', a: { r: 9, c: 10 } },              // emitter to ground
          { k: 'res', id: 'r', a: { r: 9, c: 12 }, b: { r: 0, c: 40 }, ohms: 1000 },
          { k: 'vcc', id: 'v', a: { r: 1, c: 40 } },              // pull-up on the collector
          baseHigh
            ? { k: 'vcc', id: 'b', a: { r: 9, c: 11 } }
            : { k: 'gnd', id: 'b', a: { r: 9, c: 11 } },
        ],
      });
      const readC = (board) => {
        const c = L.compileBoard(board);
        const sim = new L.BoardSim(c);
        for (let i = 0; i < 30; i++) sim.tick(1000 + i);
        const net = c.holeNet.get(L.tieKey(7, 12));
        return sim.str[net] === 0 ? 'Z' : String(sim.val[net]) + (sim.str[net] === 2 ? '!' : '~');
      };
      ok('a transistor pulls its collector down when the base is high',
        readC(mk(true)) === '0!', readC(mk(true)));
      ok('and lets the pull-up win when the base is low',
        readC(mk(false)) === '1~', readC(mk(false)));
    }
  }

  /* 12d. more than one board on the bench */
  {
    const BB0 = (board, local) => board * 1000 + local;
    const b2 = { cols: 60, boards: 2, parts: [] };
    const c = L.compileBoard(b2);
    const n = (r, col) => c.holeNet.get(L.tieKey(r, col));
    ok('a second board doubles the tie points', c.nets === 2 * (60 * 2 + 4), c.nets);
    ok('the same column on two boards is two different nets',
      n(0, 7) !== n(1000, 7), n(0, 7) + '/' + n(1000, 7));
    ok('the rails do not carry across from one board to the next',
      n(100, 0) !== n(1100, 0), n(100, 0) + '/' + n(1100, 0));
    ok('a jumper is what joins them', (() => {
      b2.parts.push({ k: 'wire', id: 'j', a: { r: 100, c: 3 }, b: { r: 1100, c: 3 } });
      const c2 = L.compileBoard(b2);
      return c2.holeNet.get(L.tieKey(100, 0)) === c2.holeNet.get(L.tieKey(1100, 0));
    })());

    /* a chip on the second board works exactly like one on the first */
    const board = {
      cols: 60, boards: 2, parts: [
        { k: 'ic', id: 'u', type: '7400', col: 5, board: 1 },
        { k: 'vcc', id: 'v', a: { r: BB0(1, 2), c: 5 } },
        { k: 'gnd', id: 'g', a: { r: BB0(1, 7), c: 11 } },
        { k: 'gnd', id: 'a', a: { r: BB0(1, 7), c: 5 } },
      ],
    };
    const cc = L.compileBoard(board);
    const sim = new L.BoardSim(cc);
    for (let i = 0; i < 30; i++) sim.tick(1000 + i);
    const y = cc.holeNet.get(L.tieKey(BB0(1, 7), 7));   // gate 1 output, pin 3
    ok('a chip on the second board runs the same as on the first',
      sim.unpowered.length === 0 && sim.val[y] === 1,
      'unpowered=' + sim.unpowered.join(',') + ' y=' + sim.val[y]);
  }

  /* 12e. the boards can be made wider */
  {
    const wide = { cols: 150, boards: 1, parts: [] };
    const c = L.compileBoard(wide);
    ok('a wider board has more tie points', c.nets === 150 * 2 + 4, c.nets);
    ok('a chip can sit out past the old right-hand edge', (() => {
      wide.parts.push({ k: 'ic', id: 'far', type: '7400', col: 140, board: 0 });
      wide.parts.push({ k: 'vcc', id: 'v', a: { r: 2, c: 140 } });
      wide.parts.push({ k: 'gnd', id: 'g', a: { r: 7, c: 146 } });
      wide.parts.push({ k: 'gnd', id: 'a', a: { r: 7, c: 140 } });
      const c2 = L.compileBoard(wide);
      const sim = new L.BoardSim(c2);
      for (let i = 0; i < 30; i++) sim.tick(1000 + i);
      const y = c2.holeNet.get(L.tieKey(7, 142));      // gate 1 output, pin 3
      return sim.unpowered.length === 0 && sim.val[y] === 1;
    })());
    /* how much actually fits, which is the point of the whole exercise */
    const perBoard = Math.floor(150 / 8);
    ok('a 150-column board holds this many 16-pin chips', perBoard >= 18, perBoard);
  }

  /* 13. short circuit detection */
  {
    const b = { cols: 60, parts: [
      { k: 'vcc', id: 'v', a: { r: 0, c: 3 } },
      { k: 'gnd', id: 'g', a: { r: 1, c: 3 } },      // same column: dead short
    ] };
    const { sim } = boardRun(b, 5);
    ok('short circuit caught', sim.shorts === 1, sim.shorts);
  }

  /* 14. a resistor passes a weak level, and a strong driver overrides it */
  {
    const b = { cols: 60, parts: [
      { k: 'vcc', id: 'v', a: { r: 100, c: 0 } },
      { k: 'res', id: 'r', a: { r: 100, c: 4 }, b: { r: 0, c: 8 }, ohms: 10000 },
    ] };
    let { c, sim } = boardRun(b, 5);
    const net = c.holeNet.get(L.tieKey(0, 8));
    ok('pull-up gives a weak 1', sim.val[net] === 1 && sim.str[net] === 1, sim.val[net] + '/' + sim.str[net]);
    b.parts.push({ k: 'gnd', id: 'g', a: { r: 2, c: 8 } });
    ({ c, sim } = boardRun(b, 5));
    const net2 = c.holeNet.get(L.tieKey(0, 8));
    ok('a strong driver beats the pull-up', sim.val[net2] === 0 && sim.str[net2] === 2 && sim.shorts === 0,
       sim.val[net2] + '/' + sim.str[net2] + ' shorts=' + sim.shorts);
  }

  /* 15. the blinking-LED example blinks */
  {
    const board = L.examples.BOARD_EXAMPLES[0].make();
    const c = L.compileBoard(board);
    const sim = new L.BoardSim(c);
    const led = board.parts.find(p => p.k === 'led');
    const seen = new Set();
    let t = 0;
    for (let i = 0; i < 40; i++) { t += 130; for (let j = 0; j < 4; j++) sim.tick(t); seen.add(!!led._lit); }
    ok('blinking LED example blinks', seen.size === 2 && sim.shorts === 0, [...seen].join(',') + ' shorts=' + sim.shorts);
  }

  /* 16. button / pull-down / inverter example */
  {
    const board = L.examples.BOARD_EXAMPLES[1].make();
    const btn = board.parts.find(p => p.k === 'btn');
    const led = board.parts.find(p => p.k === 'led');
    let r = boardRun(board, 30);
    const idle = led._lit;
    btn.pressed = true;
    r = boardRun(board, 30);
    const pressed = led._lit;
    ok('pull-down example inverts the button', idle === true && pressed === false,
       'idle=' + idle + ' pressed=' + pressed + ' shorts=' + r.sim.shorts);
    ok('pull-down example has no shorts', r.sim.shorts === 0, r.sim.shorts);
    btn.pressed = false;
  }

  /* 17. NAND latch on a 7400 — pressing a button re-cuts the netlist, exactly
         as it does in the app, so this also checks that state survives that */
  {
    const board = L.examples.BOARD_EXAMPLES[2].make();
    const [set, reset] = board.parts.filter(p => p.k === 'btn');
    const [ledQ, ledQb] = board.parts.filter(p => p.k === 'led');
    let prev = null, r = null;
    const step = (n) => {
      const c = L.compileBoard(board);
      const sim = new L.BoardSim(c, prev);
      for (let i = 0; i < (n || 40); i++) sim.tick(1000 + i);
      prev = sim;
      return (r = { c, sim });
    };
    step();
    set.pressed = true; step();
    const s1 = ledQ._lit, s1b = ledQb._lit;
    set.pressed = false; step();
    const h1 = ledQ._lit;
    reset.pressed = true; step();
    const r1 = ledQ._lit;
    reset.pressed = false; step();
    const h2 = ledQ._lit;
    ok('7400 latch: set, hold, reset, hold',
       s1 === true && s1b === false && h1 === true && r1 === false && h2 === false,
       [s1, s1b, h1, r1, h2].join(','));
    // and the same metastability check on the bench: one LED on, one off
    const fresh = boardRun(L.examples.BOARD_EXAMPLES[2].make(), 60);
    const board2 = L.examples.BOARD_EXAMPLES[2].make();
    const c2 = L.compileBoard(board2);
    const sim2 = new L.BoardSim(c2);
    for (let i = 0; i < 80; i++) sim2.tick(1000 + i);
    const l2 = board2.parts.filter(p => p.k === 'led');
    const a1 = l2[0]._lit, b1 = l2[1]._lit;
    for (let i = 0; i < 9; i++) sim2.tick(1100 + i);
    ok('idle 7400 latch settles into one state',
       a1 !== b1 && l2[0]._lit === a1 && l2[1]._lit === b1, a1 + '/' + b1 + ' then ' + l2[0]._lit + '/' + l2[1]._lit);

    ok('7400 latch has no shorts and no unpowered chips',
       r.sim.shorts === 0 && r.sim.unpowered.length === 0, r.sim.shorts + '/' + r.sim.unpowered.join(','));
  }

  /* 18. counter -> 7493 -> 7447 -> display */
  {
    const board = L.examples.BOARD_EXAMPLES[3].make();
    const c = L.compileBoard(board);
    const sim = new L.BoardSim(c);
    const seg = board.parts.find(p => p.k === 'seg');
    const digits = [];
    let t = 0;
    for (let i = 0; i < 60; i++) { t += 130; for (let j = 0; j < 6; j++) sim.tick(t); digits.push(seg._bits); }
    const uniq = [...new Set(digits)];
    const SEGS = [63, 6, 91, 79, 102, 109, 124, 7, 127, 103, 88, 76, 98, 105, 120, 0];
    const allValid = uniq.every(b => SEGS.includes(b));
    ok('counting digit shows real digits', uniq.length > 3 && allValid, uniq.join(' '));
    ok('counting digit has no shorts / unpowered chips',
       sim.shorts === 0 && sim.unpowered.length === 0, sim.shorts + '/' + [...new Set(sim.unpowered)].join(','));
    const order = digits.filter((d, i) => i === 0 || d !== digits[i - 1]).map(b => SEGS.indexOf(b));
    let seqOK = true;
    for (let i = 1; i < order.length; i++) if (order[i] !== (order[i - 1] + 1) % 16) seqOK = false;
    ok('counting digit counts in order', seqOK && order.length > 3, order.join(','));
  }

  /* 19. 7447 drives a common-cathode display dark (right chip, wrong display) */
  {
    const board = L.examples.BOARD_EXAMPLES[3].make();
    board.parts.find(p => p.k === 'seg').anode = false;
    const c = L.compileBoard(board);
    const sim = new L.BoardSim(c);
    let t = 0;
    for (let i = 0; i < 30; i++) { t += 130; sim.tick(t); }
    const seg = board.parts.find(p => p.k === 'seg');
    ok('common-cathode display stays dark behind a 7447', seg._bits === 0, seg._bits);
  }

  /* 20. UI smoke: the app booted, drew, and has a library */
  {
    ok('app state exists', !!L.S && !!L.S.work && !!L.S.board);
    ok('canvas has a size', document.querySelector('#cv').width > 0);
    ok('palette rendered', document.querySelectorAll('.pal-item').length > 5,
       document.querySelectorAll('.pal-item').length);
  }

  return out;
})()
`;

/* ---- drive Chromium over CDP, with no npm dependencies ---- */
(async () => {
  if (!CHROME) {
    console.error('No Chrome or Chromium found. Set CHROME=/path/to/chrome and try again.');
    process.exit(2);
  }
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logiclab-cdp-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=0',
    '--user-data-dir=' + userDir, '--window-size=1440,900', '--hide-scrollbars',
    '--allow-file-access-from-files', 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  chrome.stderr.on('data', (d) => { stderr += d; });

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* Chrome writes the port it actually picked into the profile directory. */
  let port = null;
  for (let i = 0; i < 80 && !port; i++) {
    await wait(150);
    try { port = fs.readFileSync(path.join(userDir, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); }
    catch (e) { /* not written yet */ }
  }
  if (!port) { console.error('chrome never came up\n' + stderr); process.exit(1); }

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await wait(150);
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { /* not up yet */ }
  }
  if (!target) { console.error('no debuggable page\n' + stderr); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value || a.description || '').join(' '));
    }
    if (m.method === 'Page.javascriptDialogOpening') {
      ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception
        ? m.params.exceptionDetails.exception.description
        : m.params.exceptionDetails.text));
    }
  };
  const send = (method, params) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  await new Promise((r) => { ws.onopen = r; });
  await send('Runtime.enable');
  await send('Page.enable');
  /* Install the error collector before the page's own script runs, so a boot
     failure or a throw inside the animation loop is caught, not missed. */
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__errs = [];
      window.addEventListener('error', (e) => window.__errs.push(String(e.message) + ' @ ' + (e.filename||'') + ':' + e.lineno));
      window.addEventListener('unhandledrejection', (e) => window.__errs.push('rejection: ' + e.reason));`,
  });
  await send('Page.navigate', { url: PAGE });
  await wait(2000);

  const ev = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (res.result.exceptionDetails) {
      throw new Error('eval failed: ' + JSON.stringify(res.result.exceptionDetails.exception || res.result.exceptionDetails.text)
        + '\nexpr: ' + expr.slice(0, 200));
    }
    return res.result.result.value;
  };
  const mouse = async (type, x, y, extra) => {
    await send('Input.dispatchMouseEvent', Object.assign({
      type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1,
      buttons: type === 'mouseReleased' ? 0 : 1,
    }, extra || {}));
    await wait(45);
  };
  const clickAt = async (x, y) => { await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); };
  const clickSel = async (sel) => {
    const box = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});
      if(!e) return null;
      e.scrollIntoView({block:'center'});
      const r=e.getBoundingClientRect();
      return {x:r.left+r.width/2, y:r.top+r.height/2};})()`);
    if (!box) throw new Error('no element ' + sel);
    await clickAt(box.x, box.y);
  };
  /* Replacing something you have already built asks first; say yes. */
  const confirmIfAsked = async () => {
    if (await ev(`!!document.querySelector('#modal footer .wreck')`)) {
      await clickSel('#modal footer .wreck');
      await wait(350);
    }
  };
  const dragAt = async (x0, y0, x1, y1) => {
    await mouse('mousePressed', x0, y0);
    await mouse('mouseMoved', (x0 + x1) / 2, (y0 + y1) / 2);
    await mouse('mouseMoved', x1, y1);
    await mouse('mouseReleased', x1, y1);
  };

  const r = await send('Runtime.evaluate', {
    expression: TESTS, awaitPromise: true, returnByValue: true,
  });

  if (r.result.exceptionDetails) {
    console.error('TEST HARNESS THREW:\n', JSON.stringify(r.result.exceptionDetails, null, 1));
    console.error('page logs:\n' + logs.join('\n'));
    chrome.kill(); process.exit(1);
  }
  const results = r.result.result.value || [];
  let fails = 0;
  const report = (name, pass, extra) => {
    results.push({ name, pass, extra: extra === undefined ? '' : String(extra) });
  };

  /* ---------- UI: drive the real thing with real mouse events ---------- */
  try {
    /* a clean editor with a predictable camera, so screen maths is easy */
    await ev(`(()=>{const L=LogicLab;
      L.S.work = L.newDef('ui'); L.S.editing=null; L.S.sel.clear(); L.S.selWires.clear();
      L.S.dirty=true; L.S.cam.x=380; L.S.cam.y=300; L.S.cam.z=1; return 1;})()`);
    await wait(200);

    /* place a NOT gate from the palette */
    await clickSel('.pal-item[data-type="NOT"]');
    const armed = await ev('!!LogicLab.S.armed && LogicLab.S.armed.type');
    report('palette click arms a part', armed === 'NOT', armed);

    const cvBox = await ev(`(()=>{const r=document.querySelector('#cv').getBoundingClientRect();
      return {l:r.left, t:r.top, w:r.width, h:r.height};})()`);
    const world = (wx, wy) => ev(`(()=>{const s=LogicLab.toScreen(${wx},${wy});
      const r=document.querySelector('#cv').getBoundingClientRect();
      return {x:r.left+s.x, y:r.top+s.y};})()`);

    let pt = await world(200, 0);
    await clickAt(pt.x, pt.y);
    const placed = await ev(`LogicLab.S.work.nodes.map(n=>n.type).join(',')`);
    report('clicking the board places the armed part', placed === 'NOT', placed);
    report('placing disarms the palette', !(await ev('!!LogicLab.S.armed')));

    /* place an input pin, then wire it to the NOT gate by dragging */
    await clickSel('.pal-item[data-type="IN"]');
    pt = await world(0, 0);
    await clickAt(pt.x, pt.y);
    const two = await ev(`LogicLab.S.work.nodes.length`);
    report('second part placed', two === 2, two);

    const ports = await ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
      const inn=L.S.work.nodes.find(n=>n.type==='IN'), not=L.S.work.nodes.find(n=>n.type==='NOT');
      const a=L.geom(inn).outs[0], b=L.geom(not).ins[0];
      const sa=L.toScreen(a.x,a.y), sb=L.toScreen(b.x,b.y);
      return {ax:r.left+sa.x, ay:r.top+sa.y, bx:r.left+sb.x, by:r.top+sb.y};})()`);
    await dragAt(ports.ax, ports.ay, ports.bx, ports.by);
    const wires = await ev(`LogicLab.S.work.wires.length`);
    report('dragging port to port makes a wire', wires === 1, wires);

    /* clicking the input pin toggles it, and the NOT gate follows */
    const pinPt = await ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
      const n=L.S.work.nodes.find(x=>x.type==='IN'); const g=L.geom(n);
      const s=L.toScreen(g.x+g.w/2, g.y+g.h/2); return {x:r.left+s.x, y:r.top+s.y};})()`);
    const v0 = await ev(`LogicLab.S.work.nodes.find(n=>n.type==='IN').value`);
    await clickAt(pinPt.x, pinPt.y);
    await wait(200);
    const v1 = await ev(`LogicLab.S.work.nodes.find(n=>n.type==='IN').value`);
    report('clicking an input pin flips it', !!v1 !== !!v0, v0 + '->' + v1);
    const notOut = await ev(`(()=>{const L=LogicLab, c=L.S.compiled, s=L.S.sim;
      const n=L.S.work.nodes.find(x=>x.type==='NOT');
      return s.val(c.portNet.get(n.id+'.o0'));})()`);
    report('the wired NOT gate inverts the live signal', notOut === (v1 ? 0 : 1), notOut);

    /* undo takes the wire back */
    await clickSel('#btn-undo');
    await wait(150);
    report('undo removes the wire', (await ev('LogicLab.S.work.wires.length')) === 0);

    /* ---- breadboard: place a jumper with two clicks ---- */
    await clickSel('#mode-board');
    await wait(300);
    await ev(`(()=>{const L=LogicLab; L.S.board={cols:60,parts:[]}; L.S.bdirty=true;
      L.S.bcam.x=40; L.S.bcam.y=60; L.S.bcam.z=1; return 1;})()`);
    await wait(200);
    const hole = (r2, c2) => ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
      const s=L.toScreen(L.holeX(${c2}), L.holeY(${r2}));
      return {x:r.left+s.x, y:r.top+s.y};})()`);
    await clickSel('.pal-item[data-type="wire"]');
    const h1 = await hole(0, 3), h2 = await hole(2, 8);
    await clickAt(h1.x, h1.y);
    await clickAt(h2.x, h2.y);
    const jump = await ev(`(()=>{const p=LogicLab.S.board.parts[0];
      return p ? p.k+':'+p.a.r+','+p.a.c+'-'+p.b.r+','+p.b.c : 'none';})()`);
    report('two clicks lay a jumper between the right holes', jump === 'wire:0,3-2,8', jump);
    const joined = await ev(`(()=>{const L=LogicLab; L.S.bdirty=true;
      const c=L.compileBoard(L.S.board);
      return c.holeNet.get(L.tieKey(4,3)) === c.holeNet.get(L.tieKey(0,8));})()`);
    report('the jumper actually joins the two columns', joined === true, joined);

    /* a chip needs a legal column and lands across the channel */
    await clickSel('.pal-item[data-chip="7400"]');
    const h3 = await hole(5, 20);
    await clickAt(h3.x, h3.y);
    const ic = await ev(`(()=>{const p=LogicLab.S.board.parts.find(x=>x.k==='ic');
      return p ? p.type+'@'+p.col : 'none';})()`);
    report('a 74-series chip drops onto the board', ic === '7400@20', ic);

    const palette = await ev(`(()=>{const L=LogicLab;
      const names=[...document.querySelectorAll('.pal-item')].map(e=>{
        const top=e.querySelector('.top'); return (top||e).textContent.trim();});
      const missing=Object.keys(L.ICS).filter(k=>!names.includes(L.ICS[k].name));
      const groups=[...document.querySelectorAll('.pal-group h3')].map(e=>e.textContent);
      return (missing.join(',')||'none') + '|' + groups[0] + '|' + groups.length;})()`);
    report('every chip is in the palette, board controls first',
      /^none\|Board\|[6-9]$/.test(palette), palette);

    /* every chip carries a plain-English name and an explanation */
    const plainness = await ev(`(()=>{const L=LogicLab;
      const bad=Object.keys(L.ICS).filter(k=>{const c=L.ICS[k];
        return !c.nick || !c.plain || c.plain.length < 40;});
      const shown=[...document.querySelectorAll('.pal-item.named[data-type="ic"] .sub')].map(e=>e.textContent);
      return (bad.join(',')||'none') + '|' + shown.length;})()`);
    report('every chip has a plain name and an explanation, shown in the palette',
      plainness === 'none|' + (await ev(`Object.keys(LogicLab.ICS).length`)), plainness);

    /* selecting one explains it on the side */
    const explains = await ev(`(()=>{const L=LogicLab;
      L.S.board={cols:60,parts:[{k:'ic',id:'z',type:'74595',col:6}]};
      L.S.bsel='z'; L.S.bdirty=true; L.renderInspector();
      const t=document.querySelector('#inspector').textContent;
      return t.includes('What it does') + '|' + t.includes('eight outputs from three wires')
        + '|' + t.includes('Watch out');})()`);
    report('selecting a chip explains it on the side', explains === 'true|true|true', explains);

    /* a chip on the breadboard shows what is inside it, and a gate diagram */
    const inside = await ev(`(()=>{const L=LogicLab;
      L.S.board={cols:60,parts:[{k:'ic',id:'z2',type:'7400',col:6}]};
      L.S.bsel='z2'; L.S.bdirty=true; L.renderInspector();
      const t=document.querySelector('#inspector').textContent;
      const cv2=document.querySelector('#inspector canvas.preview');
      return t.includes('What’s inside') + '|' + t.includes('4 separate NAND gates')
        + '|' + t.includes('transistors') + '|' + !!cv2;})()`);
    report('a breadboard chip shows what is inside it', inside === 'true|true|true|true', inside);

    /* the editor explains its parts the same way the breadboard does */
    const editorSays = await ev(`(()=>{const L=LogicLab;
      document.querySelector('#mode-editor').click();
      L.S.work=L.examples.EDITOR_EXAMPLES[0].make().work; L.S.dirty=true;
      const n=L.S.work.nodes.find(x=>x.type==='XOR');
      L.S.sel.clear(); L.S.sel.add(n.id); L.renderInspector();
      const t=document.querySelector('#inspector').textContent;
      return t.includes('In plain words') + '|' + t.includes('different')
        + '|' + t.includes('What it does');})()`);
    report('the circuit editor explains its parts too', editorSays === 'true|true|true', editorSays);
    await clickSel('#mode-board');
    await wait(250);

    const explainsPart = await ev(`(()=>{const L=LogicLab;
      L.S.board={cols:60,parts:[{k:'res',id:'r1',a:{r:0,c:2},b:{r:0,c:9},ohms:220}]};
      L.S.bsel='r1'; L.S.bdirty=true; L.renderInspector();
      const t=document.querySelector('#inspector').textContent;
      return t.includes('What it does') + '|' + t.includes('Holds current back');})()`);
    report('selecting a resistor explains it too', explainsPart === 'true|true', explainsPart);

    /* power the rails, drop a DIP switch, throw one of its levers */
    await clickSel('#palette button.btn.danger');            // clear the board...
    await wait(250);
    await clickSel('#modal footer .wreck');                   // ...and confirm it
    await wait(250);
    report('the breadboard clears when confirmed', (await ev(`LogicLab.S.board.parts.length`)) === 0,
      await ev(`LogicLab.S.board.parts.length`));
    await ev(`(()=>{const b=[...document.querySelectorAll('#palette button')]
      .find(x=>x.textContent==='Power the rails'); b.click(); return 1;})()`);
    await wait(300);
    const powered = await ev(`(()=>{const L=LogicLab; L.S.bdirty=true;
      const c=L.compileBoard(L.S.board); const s=new L.BoardSim(c);
      for(let i=0;i<6;i++) s.tick(1000+i);
      const plus=c.holeNet.get(L.tieKey(100,0)), minus=c.holeNet.get(L.tieKey(101,0));
      return L.S.board.parts.length + '|' + s.val[plus] + s.str[plus] + '|' + s.val[minus] + s.str[minus];})()`);
    report('"power the rails" energises both + and − rails', powered === '4|12|02', powered);

    await clickSel('.pal-item[data-type="dip"]');
    const h4 = await hole(5, 30);
    await clickAt(h4.x, h4.y);
    const dipPt = await ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
      const p=L.S.board.parts.find(x=>x.k==='dip');
      const s=L.toScreen(L.holeX(p.col+1), (L.holeY(4)+L.holeY(5))/2);
      return {x:r.left+s.x, y:r.top+s.y};})()`);
    await clickAt(dipPt.x, dipPt.y);
    await wait(250);
    const dip = await ev(`(()=>{const L=LogicLab; const p=L.S.board.parts.find(x=>x.k==='dip');
      if(!p) return 'none';
      const c=L.compileBoard(L.S.board);
      const joined = c.holeNet.get(L.tieKey(9,p.col+1))===c.holeNet.get(L.tieKey(0,p.col+1));
      return p.on.map(Number).join('') + '|' + joined;})()`);
    report('a DIP switch lever closes its own contact', dip === '0100|true', dip);

    /* ---- clearing, which used to rely on window.confirm ---- */
    await clickSel('#mode-editor');
    await wait(250);
    await ev(`(()=>{const L=LogicLab; L.S.work=L.examples.EDITOR_EXAMPLES[0].make().work;
      L.S.dirty=true; L.S.sel.clear(); return 1;})()`);
    await wait(200);
    /* Nothing on the page may call window.confirm: it is ignored outright in a
       sandboxed frame, which is how the clear buttons came to do nothing. */
    await ev(`(()=>{window.__confirmCalls=0;
      window.confirm=function(){ window.__confirmCalls++; return false; }; return 1;})()`);
    await ev(`(()=>{const b=[...document.querySelectorAll('#inspector button')]
      .find(x=>x.textContent==='Clear the board'); b.click(); return 1;})()`);
    await wait(300);
    const asked = await ev(`!!document.querySelector('#modal').classList.contains('open')`);
    report('clearing asks in the page, not with a browser popup', asked === true, asked);
    await clickSel('#modal footer .wreck');
    await wait(300);
    const cleared = await ev(`LogicLab.S.work.nodes.length + '|' + window.__confirmCalls`);
    report('confirming actually clears the board', cleared === '0|0', cleared);
    await clickSel('#btn-undo');
    await wait(250);
    report('and undo brings the circuit back', (await ev(`LogicLab.S.work.nodes.length`)) === 6);

    /* ---- re-routing a wire by dragging its end ----
       A -> AND.in0, B -> AND.in1, AND -> OUT, and a spare NOT with nothing in
       it, so there is somewhere free to drag a connection to. */
    const rewireSetup = async () => {
      await ev(`(()=>{const L=LogicLab;
        const b=L.builder('rewire');
        const a=b.pin('A',0,0), c2=b.pin('B',0,140);
        const g=b.add('AND',240,20), nt=b.add('NOT',240,240), o=b.out('out',480,36);
        b.w(a,0,g,0); b.w(c2,0,g,1); b.w(g,0,o,0);
        L.S.work=b.def; L.S.dirty=true; L.S.sel.clear(); L.S.selWires.clear(); L.S.hover=null;
        L.S.cam.x=140; L.S.cam.y=150; L.S.cam.z=1; return 1;})()`);
      await wait(250);
    };
    /* where A's wire ends up: which part, which input */
    const aWire = () => ev(`(()=>{const L=LogicLab;
      const A=L.S.work.nodes.find(x=>x.label==='A');
      const ws=L.S.work.wires.filter(x=>x.a.n===A.id);
      if(!ws.length) return 'none';
      return ws.map(w=>{const t=L.S.work.nodes.find(n=>n.id===w.b.n);
        return (t.type==='CHIP'?'CHIP':t.type)+'.'+w.b.i;}).sort().join(',');})()`);
    const wireCount = () => ev(`LogicLab.S.work.wires.length`);

    await rewireSetup();
    report('A starts wired to the first input of the AND', (await aWire()) === 'AND.0', await aWire());

    const ends = await ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
      const A=L.S.work.nodes.find(x=>x.label==='A');
      const w=L.S.work.wires.find(x=>x.a.n===A.id);
      L.S.selWires.clear(); L.S.selWires.add(w.id);
      const hs=L.wireHandles(w);
      const nt=L.S.work.nodes.find(x=>x.type==='NOT'); const gn=L.geom(nt);
      const hb=L.toScreen(hs.b.x,hs.b.y), pn=L.toScreen(gn.ins[0].x,gn.ins[0].y);
      return {hx:r.left+hb.x, hy:r.top+hb.y, px:r.left+pn.x, py:r.top+pn.y};})()`);
    await dragAt(ends.hx, ends.hy, ends.px, ends.py);
    await wait(300);
    report('dragging a wire end moves the connection', (await aWire()) === 'NOT.0', await aWire());
    report('re-routing leaves no spare wire behind', (await wireCount()) === 3, await wireCount());
    await clickSel('#btn-undo');
    await wait(250);
    report('and the whole re-route is one undo step',
      (await aWire()) === 'AND.0' && (await wireCount()) === 3, (await aWire()) + '/' + (await wireCount()));

    /* the middle of a wire still branches, so one output can feed two inputs */
    await rewireSetup();
    const mid = await ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
      const A=L.S.work.nodes.find(x=>x.label==='A');
      const w=L.S.work.wires.find(x=>x.a.n===A.id);
      const a=L.S.work.nodes.find(x=>x.id===w.a.n), g=L.S.work.nodes.find(x=>x.id===w.b.n);
      const ga=L.geom(a), gg=L.geom(g);
      const m={x:(ga.outs[0].x+gg.ins[0].x)/2, y:(ga.outs[0].y+gg.ins[0].y)/2};
      const nt=L.S.work.nodes.find(x=>x.type==='NOT'); const gn=L.geom(nt);
      const sm=L.toScreen(m.x,m.y), sn=L.toScreen(gn.ins[0].x,gn.ins[0].y);
      return {mx:r.left+sm.x, my:r.top+sm.y, ox:r.left+sn.x, oy:r.top+sn.y};})()`);
    await dragAt(mid.mx, mid.my, mid.ox, mid.oy);
    await wait(300);
    report('dragging the middle of a wire still branches it',
      (await aWire()) === 'AND.0,NOT.0' && (await wireCount()) === 4,
      (await aWire()) + '/' + (await wireCount()));

    /* pulling the plug out of an input and dropping it somewhere that cannot
       take it puts the wire back rather than losing it */
    await rewireSetup();
    const plug = await ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
      const g=L.S.work.nodes.find(x=>x.type==='AND'); const gg=L.geom(g);
      const s=L.toScreen(gg.ins[0].x,gg.ins[0].y);
      const b2=L.S.work.nodes.find(x=>x.label==='B'); const gb=L.geom(b2);
      const s2=L.toScreen(gb.x+gb.w/2, gb.y+gb.h/2);   // an input pin has no inputs
      return {x:r.left+s.x, y:r.top+s.y, ox:r.left+s2.x, oy:r.top+s2.y};})()`);
    await dragAt(plug.x, plug.y, plug.ox, plug.oy);
    await wait(300);
    report('a plug dropped where it cannot go returns to its socket',
      (await aWire()) === 'AND.0' && (await wireCount()) === 3, (await aWire()) + '/' + (await wireCount()));

    /* ---- easier ways to add a wire ---- */
    const wireSetup = async () => {
      await ev(`(()=>{const L=LogicLab;
        const b=L.builder('wiring');
        const a=b.pin('A',0,0);
        const g=b.add('AND',260,0), nt=b.add('NOT',260,220), o=b.out('out',520,16);
        b.w(g,0,o,0);
        L.S.work=b.def; L.S.dirty=true; L.S.sel.clear(); L.S.selWires.clear(); L.S.hover=null;
        L.S.pendingWire=null; L.S.cam.x=150; L.S.cam.y=170; L.S.cam.z=1; return 1;})()`);
      await wait(250);
    };
    const portPt = (find, side, i) => ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
      const n=L.S.work.nodes.find(${find}); const g=L.geom(n);
      const p=(${JSON.stringify(side)}==='in'?g.ins:g.outs)[${i}];
      const s=L.toScreen(p.x,p.y); return {x:r.left+s.x, y:r.top+s.y};})()`);

    /* click once on a port, then once on the target — no dragging at all */
    await wireSetup();
    const src = await portPt(`x=>x.label==='A'`, 'out', 0);
    const dst = await portPt(`x=>x.type==='AND'`, 'in', 0);
    await clickAt(src.x, src.y);
    await wait(250);
    report('one click on a port starts a wire', (await ev(`!!LogicLab.S.pendingWire`)) === true);
    await clickAt(dst.x, dst.y);
    await wait(250);
    report('a second click finishes it without dragging',
      (await ev(`LogicLab.S.work.wires.length`)) === 2 && !(await ev(`!!LogicLab.S.pendingWire`)),
      await ev(`LogicLab.S.work.wires.length`));

    /* Esc gets you out of it */
    await wireSetup();
    await clickAt(src.x, src.y);
    await wait(200);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await wait(250);
    report('Esc abandons a half-drawn wire',
      !(await ev(`!!LogicLab.S.pendingWire`)) && (await ev(`LogicLab.S.work.wires.length`)) === 1);

    /* a second click on nothing cancels rather than leaving a stray junction */
    await wireSetup();
    await clickAt(src.x, src.y);
    await wait(200);
    await clickAt(src.x + 330, src.y + 260);
    await wait(250);
    report('clicking empty space cancels instead of leaving clutter',
      (await ev(`LogicLab.S.work.wires.length`)) === 1
      && (await ev(`LogicLab.S.work.nodes.filter(n=>n.type==='JOINT').length`)) === 0
      && !(await ev(`!!LogicLab.S.pendingWire`)),
      await ev(`LogicLab.S.work.wires.length + '/' + LogicLab.S.work.nodes.length`));

    /* you no longer have to hit the port exactly */
    await wireSetup();
    const nearMiss = await ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
      const g=L.S.work.nodes.find(x=>x.type==='NOT'); const gg=L.geom(g);
      const p=gg.ins[0]; const s=L.toScreen(p.x-38, p.y-24);   // well short of the port
      return {x:r.left+s.x, y:r.top+s.y};})()`);
    await dragAt(src.x, src.y, nearMiss.x, nearMiss.y);
    await wait(300);
    const landed = await ev(`(()=>{const L=LogicLab;
      const A=L.S.work.nodes.find(x=>x.label==='A');
      const w=L.S.work.wires.find(x=>x.a.n===A.id);
      if(!w) return 'none';
      const t=L.S.work.nodes.find(n=>n.id===w.b.n); return t.type;})()`);
    report('a wire dropped near a port snaps onto it', landed === 'NOT', landed);

    /* dropping a wire onto another wire makes a junction they share */
    await wireSetup();
    await dragAt(src.x, src.y, dst.x, dst.y);          // A -> AND.in0
    await wait(250);
    const onWire = await ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
      const A=L.S.work.nodes.find(x=>x.label==='A');
      const w=L.S.work.wires.find(x=>x.a.n===A.id);
      const a=L.S.work.nodes.find(n=>n.id===w.a.n), b2=L.S.work.nodes.find(n=>n.id===w.b.n);
      const ga=L.geom(a), gb=L.geom(b2);
      const m={x:(ga.outs[0].x+gb.ins[0].x)/2, y:(ga.outs[0].y+gb.ins[0].y)/2};
      const nt=L.S.work.nodes.find(x=>x.type==='NOT'); const gn=L.geom(nt);
      const sm=L.toScreen(m.x,m.y), sn=L.toScreen(gn.ins[0].x,gn.ins[0].y);
      return {mx:r.left+sm.x, my:r.top+sm.y, nx:r.left+sn.x, ny:r.top+sn.y};})()`);
    /* drag from the NOT's input onto the middle of the existing wire */
    await dragAt(onWire.nx, onWire.ny, onWire.mx, onWire.my);
    await wait(300);
    const junction = await ev(`(()=>{const L=LogicLab;
      const js=L.S.work.nodes.filter(x=>x.type==='JOINT');
      if(js.length!==1) return 'joints:'+js.length;
      const j=js[0];
      const outs=L.S.work.wires.filter(w=>w.a.n===j.id).length;
      const ins=L.S.work.wires.filter(w=>w.b.n===j.id).length;
      return ins+'in,'+outs+'out';})()`);
    report('dropping a wire on a wire makes a junction feeding both',
      junction === '1in,2out', junction);

    /* and the junction really does carry the signal to both places */
    const bothFed = await ev(`(()=>{const L=LogicLab;
      const c=L.compile(L.S.work);
      const A=L.S.work.nodes.find(x=>x.label==='A');
      const g=L.S.work.nodes.find(x=>x.type==='AND');
      const nt=L.S.work.nodes.find(x=>x.type==='NOT');
      const src=c.portNet.get(A.id+'.o0');
      return src===c.portNet.get(g.id+'.i0') && src===c.portNet.get(nt.id+'.i0');})()`);
    report('the junction really joins all three points', bothFed === true, bothFed);

    /* ---- "what it's made of" panel ---- */
    await ev(`(()=>{const L=LogicLab; L.S.work=L.examples.EDITOR_EXAMPLES[0].make().work;
      L.S.dirty=true; L.S.sel.clear(); return 1;})()`);
    await wait(200);
    const xorSel = await ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
      const n=L.S.work.nodes.find(x=>x.type==='XOR'); const g=L.geom(n);
      const s=L.toScreen(g.x+g.w/2,g.y+g.h/2); return {x:r.left+s.x, y:r.top+s.y};})()`);
    await clickAt(xorSel.x, xorSel.y);
    await wait(400);
    const panel = await ev(`(()=>{const b=document.querySelector('#inspector .madeof');
      if(!b) return 'missing';
      const cv2=b.querySelector('canvas.preview');
      return (b.textContent.includes('What it') ? 'titled' : 'untitled')
        + '|' + (cv2 && cv2.width > 100 ? 'sized' : 'blank');})()`);
    report('selecting a gate explains what it is made of', panel === 'titled|sized', panel);

    /* the diagram must actually have been painted, not left empty */
    const painted = await ev(`(()=>{const c=document.querySelector('#inspector canvas.preview');
      const g=c.getContext('2d'); const d=g.getImageData(0,0,c.width,c.height).data;
      let first=null, varied=false;
      for(let i=0;i<d.length;i+=4){ const k=d[i]+','+d[i+1]+','+d[i+2];
        if(first===null) first=k; else if(k!==first){ varied=true; break; } }
      return varied;})()`);
    report('the diagram is actually drawn', painted === true, painted);

    /* clicking the thumbnail opens a readable version */
    await ev(`document.querySelector('#inspector canvas.preview').click()`);
    await wait(400);
    const big = await ev(`(()=>{const c=document.querySelector('#modal canvas.preview.big');
      if(!c) return 'no dialog';
      const g=c.getContext('2d'); const d=g.getImageData(0,0,c.width,c.height).data;
      let first=null, varied=false;
      for(let i=0;i<d.length;i+=4){ const k=d[i]+','+d[i+1]+','+d[i+2];
        if(first===null) first=k; else if(k!==first){ varied=true; break; } }
      return (c.width>400?'wide':'narrow') + '|' + varied;})()`);
    report('clicking the diagram opens a readable copy', big === 'wide|true', big);
    await clickSel('#modal header .btn');
    await wait(250);

    const beforeBuild = await ev(`LogicLab.S.work.nodes.length`);
    await ev(`(()=>{const b=[...document.querySelectorAll('#inspector .madeof button')][0];
      b.click(); return 1;})()`);
    await wait(300);
    const afterBuild = await ev(`LogicLab.S.work.nodes.length`);
    report('"build it on the board" drops the recipe in',
      afterBuild === beforeBuild + 7, beforeBuild + ' -> ' + afterBuild);
    await clickSel('#btn-undo');
    await wait(250);
    report('and that is one undo step', (await ev(`LogicLab.S.work.nodes.length`)) === beforeBuild);

    /* the main canvas must still be intact after lending itself to a preview */
    const mainOK = await ev(`(()=>{const L=LogicLab;
      return L.S.work.nodes.length + '|' + (L.S.mode==='editor') + '|' + (L.S.sim!=null);})()`);
    report('borrowing the renderer leaves the board unharmed', mainOK === beforeBuild + '|true|true', mainOK);

    /* ---- delete shortcuts ---- */
    const partCount = () => ev(`LogicLab.S.work.nodes.length`);
    const firstGate = await ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
      const n=L.S.work.nodes.find(x=>x.type==='AND'); L.S.sel.clear(); L.S.sel.add(n.id);
      const g=L.geom(n); const s=L.toScreen(g.x+g.w/2,g.y+g.h/2);
      return {x:r.left+s.x, y:r.top+s.y, id:n.id};})()`);
    await wait(150);
    const xBtn = await ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
      const hd=L.deleteHandle(); return hd ? {x:r.left+hd.x, y:r.top+hd.y} : null;})()`);
    report('a ✕ appears next to the selection', !!xBtn, JSON.stringify(xBtn));
    if (xBtn) {
      await clickAt(xBtn.x, xBtn.y);
      await wait(250);
      report('tapping the ✕ deletes the selected part', (await partCount()) === 5, await partCount());
    }
    /* right-click deletes, but a right-drag still pans */
    const xorPt = await ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
      const n=L.S.work.nodes.find(x=>x.type==='XOR'); const g=L.geom(n);
      const s=L.toScreen(g.x+g.w/2,g.y+g.h/2); return {x:r.left+s.x, y:r.top+s.y};})()`);
    const camBefore = await ev(`JSON.stringify(LogicLab.S.cam)`);
    await mouse('mousePressed', xorPt.x, xorPt.y, { button: 'right', buttons: 2 });
    await mouse('mouseMoved', xorPt.x + 90, xorPt.y + 40, { button: 'right', buttons: 2 });
    await mouse('mouseReleased', xorPt.x + 90, xorPt.y + 40, { button: 'right', buttons: 0 });
    await wait(250);
    const afterDrag = await partCount();
    const camAfter = await ev(`JSON.stringify(LogicLab.S.cam)`);
    report('a right-drag pans and deletes nothing', afterDrag === 5 && camAfter !== camBefore,
      afterDrag + ' cam moved: ' + (camAfter !== camBefore));
    const xorPt2 = await ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
      const n=L.S.work.nodes.find(x=>x.type==='XOR'); const g=L.geom(n);
      const s=L.toScreen(g.x+g.w/2,g.y+g.h/2); return {x:r.left+s.x, y:r.top+s.y};})()`);
    await mouse('mousePressed', xorPt2.x, xorPt2.y, { button: 'right', buttons: 2 });
    await mouse('mouseReleased', xorPt2.x, xorPt2.y, { button: 'right', buttons: 0 });
    await wait(250);
    report('a right-click deletes what is under it', (await partCount()) === 4, await partCount());

    /* the breadboard has its own undo, so deleting there is reversible too */
    await clickSel('#mode-board');
    await wait(300);
    const bParts = () => ev(`LogicLab.S.board.parts.length`);
    await ev(`(()=>{const L=LogicLab; L.S.board=L.examples.BOARD_EXAMPLES[0].make();
      L.S.bundo=[]; L.S.bredo=[]; L.S.bdirty=true; L.S.bsel=null; L.fitView(); return 1;})()`);
    await wait(300);
    const n0 = await bParts();
    const icPt = await ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
      const p=L.S.board.parts.find(x=>x.k==='ic');
      const s=L.toScreen(L.holeX(p.col+1), (L.holeY(4)+L.holeY(5))/2);
      return {x:r.left+s.x, y:r.top+s.y};})()`);
    await mouse('mousePressed', icPt.x, icPt.y, { button: 'right', buttons: 2 });
    await mouse('mouseReleased', icPt.x, icPt.y, { button: 'right', buttons: 0 });
    await wait(250);
    report('right-click removes a breadboard part', (await bParts()) === n0 - 1, await bParts());
    await clickSel('#btn-undo');
    await wait(250);
    report('breadboard undo puts it back', (await bParts()) === n0, await bParts());
    const circuitIntact = await ev(`LogicLab.S.work.nodes.length`);
    report('undoing on the breadboard leaves the circuit alone', circuitIntact === 4, circuitIntact);

    /* ---- load an example through the real dialog ---- */
    await clickSel('#mode-editor');
    await wait(250);
    await clickSel('#mode-editor');
    await wait(200);
    await clickSel('#btn-examples');
    await wait(250);
    const cards = await ev(`document.querySelectorAll('#modal .card').length`);
    report('the examples dialog lists circuits', cards >= 8, cards);
    await clickSel('#modal .card:nth-child(3)');       // 4-bit adder, which installs chips
    await wait(400);
    await confirmIfAsked();
    const loaded = await ev(`(()=>{const L=LogicLab;
      return L.S.work.name + '|' + Object.keys(L.lib).length + '|' + L.S.work.nodes.length;})()`);
    report('loading an example installs its chips too', /^4-bit adder\|[2-9]/.test(loaded), loaded);
    report('the examples dialog closed', (await ev(`!document.querySelector('#modal').classList.contains('open')`)));
    report('the palette shows the new chips',
      (await ev(`[...document.querySelectorAll('.pal-item')].some(e=>e.textContent==='Full adder')`)));

    /* loading it again must not stack up a second copy of the same chips */
    const libBefore = await ev(`Object.keys(LogicLab.lib).length`);
    await clickSel('#btn-examples');
    await wait(250);
    await clickSel('#modal .card:nth-child(3)');
    await wait(400);
    await confirmIfAsked();
    const reload = await ev(`(()=>{const L=LogicLab;
      const names=Object.values(L.lib).map(d=>d.name);
      const used=new Set(L.S.work.nodes.filter(n=>n.type==='CHIP').map(n=>n.chip));
      const live=[...used].every(id=>!!L.lib[id]);
      return names.length + '|' + new Set(names).size + '|' + live;})()`);
    report('re-loading an example reuses the chips it already installed',
      reload === libBefore + '|' + libBefore + '|true', reload + ' was ' + libBefore);

    /* ---- truth table ---- */
    await ev(`(()=>{const L=LogicLab; L.S.work=L.examples.EDITOR_EXAMPLES[1].make().work;
      L.S.dirty=true; L.S.ttable=null; return 1;})()`);
    await wait(200);
    const tt = await ev(`(()=>{const b=[...document.querySelectorAll('#inspector button')]
      .find(x=>x.textContent==='Truth table'); b.click();
      const rows=document.querySelectorAll('.ttable tbody tr');
      return rows.length + '|' + (rows[7] ? rows[7].textContent : '');})()`);
    // last row of a full adder: 1+1+1 = sum 1, carry 1
    report('the truth table renders every row', tt === '8|11111', tt);

    /* ---- package the current circuit as a chip, through the dialog ---- */
    await ev(`(()=>{const L=LogicLab; L.S.work=L.examples.EDITOR_EXAMPLES[0].make().work;
      L.S.dirty=true; L.S.ttable=null; return 1;})()`);
    await wait(150);
    await clickSel('#btn-chip');
    await wait(250);
    await ev(`(()=>{const i=document.querySelector('#modal input[type=text]');
      i.value='My Adder'; return 1;})()`);
    const before = await ev(`Object.keys(LogicLab.lib).length`);
    await clickSel('#modal footer .primary');
    await wait(350);
    const after = await ev(`(()=>{const L=LogicLab;
      return Object.keys(L.lib).length + '|' + L.S.work.nodes.length + '|'
        + Object.values(L.lib).some(d=>d.name==='My Adder');})()`);
    report('packaging adds the chip and clears the board', after === (before + 1) + '|0|true', after);

    /* the new chip works when placed and wired */
    const chipWorks = await ev(`(()=>{const L=LogicLab;
      const id=Object.keys(L.lib).find(k=>L.lib[k].name==='My Adder');
      const b=L.builder('use'); const a=b.pin('a',0,0), c2=b.pin('b',0,90);
      const chip=b.add('CHIP',200,20,{chip:id});
      const s=b.out('s',400,0), co=b.out('c',400,90);
      b.w(a,0,chip,0); b.w(c2,0,chip,1); b.w(chip,0,s,0); b.w(chip,1,co,0);
      const t=L.computeTruthTable(b.def);
      return t.rows.map(r=>r.in.join('')+'>'+r.out.join('')).join(' ');})()`);
    report('a packaged chip behaves like the circuit inside it',
      chipWorks === '00>00 01>10 10>10 11>01', chipWorks);

    /* ---- persistence across a reload ---- */
    await ev(`LogicLab.S.work.name='persist me'; LogicLab.S.dirty=true;`);
    await ev(`(()=>{const L=LogicLab; L.S.board={cols:60,parts:[{k:'ic',id:'zz',type:'7486',col:9}]};
      L.S.bdirty=true; return 1;})()`);
    await ev(`window.__saveProbe = 1`);
    await wait(900);                                   // let the debounced save land
    await send('Page.reload');
    await wait(2200);
    const restored = await ev(`(()=>{const L=window.LogicLab; if(!L) return 'no app';
      return L.S.work.name + '|' + Object.values(L.lib).some(d=>d.name==='My Adder')
        + '|' + (L.S.board.parts[0]||{}).type;})()`);
    report('everything comes back after a reload', restored === 'persist me|true|7486', restored);
    report('the reloaded page still runs', (await ev(`window.__errs.length===0 && LogicLab.S.sim!=null`)));
  } catch (e) {
    report('UI walkthrough completed', false, e.message);
  }

  for (const t of results) {
    if (!t.pass) fails++;
    console.log((t.pass ? '  ok  ' : 'FAIL  ') + t.name + (t.pass ? '' : '   [' + t.extra + ']'));
  }
  console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');

  const pageErrs = (await ev('window.__errs || []')) || [];
  const errs = logs.filter((l) => l.startsWith('EXCEPTION') || l.startsWith('error')).concat(pageErrs);
  if (errs.length) { console.log('\nPAGE ERRORS:\n' + errs.join('\n')); fails++; }

  /* screenshots, so the look can be checked too */
  if (process.env.SHOT) {
    const shots = [
      ['gallery', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         document.querySelector('#mode-editor').click();
         const b=L.builder('gallery');
         const types=['IN','OUT','CONST','CLOCK','AND','OR','NAND','NOR','XOR','XNOR','NOT','BUF',
                      'DFF','DLATCH','LED','HEX','SEG7','JOINT','TUNNEL'];
         types.forEach((t,i)=>{ const n=b.add(t, (i%5)*230, Math.floor(i/5)*210); if(t==='IN') n.value=1; });
         const one=b.add('CONST', 1160, 40, {value:1});
         const seg=b.def.nodes.find(n=>n.type==='SEG7');
         for(let i=0;i<8;i++) b.w(one,0,seg,i);
         const hex=b.def.nodes.find(n=>n.type==='HEX');
         b.w(one,0,hex,1); b.w(one,0,hex,3);
         const led=b.def.nodes.find(n=>n.type==='LED'); b.w(one,0,led,0);
         L.S.work=b.def; L.S.dirty=true; L.S.sel.clear(); L.fitView(); return 1;})()`],
      ['wire-aim', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         document.querySelector('#mode-editor').click();
         const b=L.builder('aim'); const a=b.pin('A',0,0);
         const g=b.add('AND',300,0), o=b.out('out',560,16);
         b.w(g,0,o,0);
         L.S.work=b.def; L.S.dirty=true; L.S.sel.clear(); L.S.selWires.clear();
         L.fitView();
         const ga=L.geom(a), gg=L.geom(g);
         L.S.pendingWire={end:{n:a.id,s:'out',i:0}, from:ga.outs[0], rev:false};
         L.S.hover={kind:'aim', world:{x:gg.ins[0].x-26, y:gg.ins[0].y-17}};
         return 1;})()`],
      ['wire-handles', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         document.querySelector('#mode-editor').click();
         L.S.work=L.examples.EDITOR_EXAMPLES[0].make().work; L.S.dirty=true; L.S.sel.clear();
         L.fitView(); L.S.cam.z*=0.9;
         const A=L.S.work.nodes.find(x=>x.label==='A');
         const w=L.S.work.wires.find(x=>x.a.n===A.id);
         L.S.selWires.clear(); L.S.selWires.add(w.id); L.renderInspector(); return 1;})()`],
      ['made-of', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         document.querySelector('#mode-editor').click();
         L.S.work=L.examples.EDITOR_EXAMPLES[7].make().work; L.S.dirty=true; L.fitView();
         const n=L.S.work.nodes.find(x=>x.type==='DFF');
         L.S.sel.clear(); L.S.sel.add(n.id); L.renderInspector(); return 1;})()`],
      ['made-of-big', `(()=>{document.querySelector('#inspector canvas.preview').click(); return 1;})()`],
      ['delete-handle', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         document.querySelector('#mode-editor').click();
         L.S.work=L.examples.EDITOR_EXAMPLES[1].make().work; L.S.dirty=true;
         L.fitView();
         const n=L.S.work.nodes.find(x=>x.type==='OR');
         L.S.sel.clear(); L.S.sel.add(n.id); return 1;})()`],
      ['transistor-nand', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         const x=document.querySelector('#modal .btn.icon'); if(x) x.click();
         document.querySelector('#mode-board').click();
         L.S.board=L.examples.BOARD_EXAMPLES[5].make();
         L.S.board.parts.filter(p=>p.k==='btn').forEach(b=>{b.pressed=true;});
         L.S.bsel=L.S.board.parts.find(p=>p.k==='npn').id;
         L.S.bdirty=true; L.renderInspector(); L.fitView();
         L.S.bcam.z*=1.7; L.S.bcam.x=-40; L.S.bcam.y=-120; return 1;})()`],
      ['two-boards', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         const x=document.querySelector('#modal .btn.icon'); if(x) x.click();
         document.querySelector('#mode-board').click();
         const chips=['74173','74173','7483','74245','74161','7485','74151','7400',
                      '74138','7475','7486','74595','7404','74157','7474','7432'];
         const parts=[]; let col=1, board=0;
         for(const t of chips){
           const w=L.ICS[t].pins/2;
           if(col+w > 88){ col=1; board++; }
           parts.push({k:'ic',id:'u'+parts.length,type:t,col,board});
           col+=w+1;
         }
         L.S.board={cols:90, boards:2, parts};
         L.S.bsel=null; L.S.bdirty=true; L.renderPalette(); L.renderInspector(); L.fitView();
         return 1;})()`],
      ['chip-list', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         document.querySelector('#modal .btn.icon').click();
         document.querySelector('#mode-board').click();
         L.S.board={cols:60,parts:[{k:'ic',id:'z',type:'74595',col:8}]};
         L.S.bsel='z'; L.S.bdirty=true; L.renderInspector(); L.fitView(); return 1;})()`],
      ['board-counter', `(()=>{const L=LogicLab; document.querySelector('#mode-board').click();
         L.S.board = L.examples.BOARD_EXAMPLES[3].make(); L.S.bdirty=true; L.S.bsel=null; L.fitView();
         L.S.bcam.z*=1.9; L.S.bcam.x=-330; L.S.bcam.y=-20; return 1;})()`],
      ['board-latch', `(()=>{const L=LogicLab; L.S.board = L.examples.BOARD_EXAMPLES[2].make();
         L.S.bdirty=true; L.fitView(); L.S.bcam.z*=1.8; L.S.bcam.x=-60; L.S.bcam.y=-30; return 1;})()`],
      ['editor-dark', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         document.querySelector('#mode-editor').click();
         const ex=L.examples.EDITOR_EXAMPLES[2].make();
         for(const c of ex.chips) L.lib[c.id]=c;
         L.S.work=ex.work; L.S.dirty=true; L.S.sel.clear(); L.fitView(); return 1;})()`],
      ['editor-counter', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         L.S.work=L.examples.EDITOR_EXAMPLES[7].make().work; L.S.dirty=true; L.fitView(); return 1;})()`],
    ];
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const grab = async (name) => {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(shot.result.data, 'base64'));
    };
    for (const [name, setup] of shots) {
      await ev(setup);
      await wait(1200);
      await grab(name);
    }
    /* phone layout: the rails become drawers */
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 780, deviceScaleFactor: 2, mobile: true,
    });
    await ev(`(()=>{const L=LogicLab; document.querySelector('#mode-editor').click();
      L.S.work=L.examples.EDITOR_EXAMPLES[0].make().work; L.S.dirty=true; L.fitView(); return 1;})()`);
    await wait(1000);
    await grab('phone');
    await ev(`document.querySelector('#btn-pal').click()`);
    await wait(600);
    await grab('phone-drawer');
    await send('Emulation.clearDeviceMetricsOverride');
    console.log('screenshots in ' + SHOT_DIR);
  }

  chrome.kill();
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) { /* leave it */ }
  process.exit(fails ? 1 : 0);
})();
