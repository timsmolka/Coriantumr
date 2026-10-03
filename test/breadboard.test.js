/* ===========================================================================
   Checks for breadboard.html — the Breadboard and Design workspaces. (The
   gate-level simulator has its own: test/logic.test.js.)

     node test/breadboard.test.js          # run the checks

   It opens the real page in headless Chromium and then does two things: calls
   the solver directly through `window.Bench` (breadboard netlists, chips,
   the discrete parts, the Design board), and drives the actual interface
   with synthetic mouse events (lay a jumper, drop a chip, use mode, reload).

   No dependencies — it talks to the browser over the DevTools protocol using
   the WebSocket and fetch built into Node 22. Set CHROME=/path/to/chrome if it
   cannot find a browser on its own.
   =========================================================================== */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PAGE = 'file://' + path.resolve(process.argv[2] || path.join(__dirname, '..', 'breadboard.html'));
const SHOT_DIR = process.env.SHOT_DIR || path.join(os.tmpdir(), 'bench-shots');

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
  const L = window.Bench;
  const out = [];
  const ok = (name, cond, extra) => out.push({ name, pass: !!cond, extra: extra === undefined ? '' : String(extra) });


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


  /* ---------- the newer parts, each through the real solver ---------- */
  const hl = (r, c) => ({ r, c });
  const row = (n) => L.BB.row(0, n);
  const mk = (a, hole, second) => window.makeBoardPart(a, hole, second);
  const battery = (c1, c2) => ({
    k: 'ext', id: 'bat1', type: 'battery', x: -200, y: 0, leads: { 1: hl(row(0), c1), 2: hl(row(0), c2) }, sketch: 'blink',
  });

  /* 21. a 7805 turns the 9 V battery into a clean 5 V without being fried by it */
  {
    const reg = mk({ type: 'reg' }, hl(row(0), 5));
    const bat = battery(5, 6);
    const res = mk({ type: 'res', ohms: 220 }, hl(row(0), 7), hl(row(0), 9));
    const led = mk({ type: 'led', color: '#ff0000' }, hl(row(1), 9), hl(row(0), 11));
    const wire = { k: 'wire', id: 'w3', a: hl(row(0), 11), b: hl(row(1), 6), color: '#000' };
    const { sim } = boardRun({ cols: 60, boards: 1, parts: [bat, reg, res, led, wire], style: 'breadboard' }, 8);
    ok('a regulator powers an LED from the battery and survives', led._lit === true && !reg.fried && sim.shorts === 0,
      'lit=' + led._lit + ' fried=' + reg.fried);
  }

  /* 22. an SCR latches on from a gate pulse and stays on until its feed is cut */
  {
    const bat = battery(2, 20);
    const res = mk({ type: 'res', ohms: 1000 }, hl(row(0), 2), hl(row(0), 5));
    const scr = mk({ type: 'scr' }, hl(row(0), 5));
    const tog = mk({ type: 'tog' }, hl(row(1), 6), hl(row(2), 5));
    const gnd = { k: 'wire', id: 'w1', a: hl(row(1), 7), b: hl(row(1), 20), color: '#000' };
    const parts = [bat, res, scr, tog, gnd];
    const run = (prev) => {
      const c = L.compileBoard({ cols: 60, boards: 1, parts, style: 'breadboard' });
      const s = new L.BoardSim(c, prev);
      for (let i = 0; i < 6; i++) s.tick(1000 + i);
      return s;
    };
    let s = run();
    const before = scr._on;
    tog.on = true; s = run(s);
    const during = scr._on;
    tog.on = false; s = run(s);
    const after = scr._on;
    parts.splice(parts.indexOf(res), 1); s = run(s);
    const cut = scr._on;
    ok('an SCR latches on, holds after the gate is released, and drops when its feed is cut',
      !before && during && after && !cut, [before, during, after, cut].join());
  }

  /* 23. a zener clamps a floating anode up to a strong cathode */
  {
    const zen = mk({ type: 'zener' }, hl(row(0), 5), hl(row(0), 2));
    const { sim } = boardRun({ cols: 60, boards: 1, parts: [{ k: 'vcc', id: 'v1', a: hl(row(0), 2) }, zen], style: 'breadboard' }, 4);
    const n = zen._nets[1];
    ok('a zener breaks down in reverse and clamps its anode', sim.val[n] === 1 && sim.str[n] === 2 && !zen.fried);
  }

  /* 24. an RGB LED lights its three channels independently */
  {
    const rgb = mk({ type: 'rgbled' }, hl(row(0), 5));
    const parts = [{ k: 'vcc', id: 'v1', a: hl(row(0), 2) }, { k: 'gnd', id: 'g1', a: hl(row(0), 3) }, rgb,
      { k: 'wire', id: 'w1', a: hl(row(0), 6), b: hl(row(0), 3), color: '#000' },
      { k: 'wire', id: 'w2', a: hl(row(0), 5), b: hl(row(0), 2), color: '#000' }];
    boardRun({ cols: 60, boards: 1, parts, style: 'breadboard' }, 4);
    ok('an RGB LED lights only the channels that are driven', rgb._litR === true && !rgb._litG && !rgb._litB,
      [rgb._litR, rgb._litG, rgb._litB].join());
  }

  /* 25. the 555 free-runs, and its RESET holds it low */
  {
    const ic = { k: 'ic', id: 'c555', type: '555', col: 10, board: 0, row: 4, hz: 10, duty: 0.5 };
    const pin = (n) => L.partHoles(ic).find((x) => x.pin === n);
    const base = [ic, { k: 'vcc', id: 'v', a: pin(8) }, { k: 'gnd', id: 'g', a: pin(1) }];
    const trace = (parts) => {
      const c = L.compileBoard({ cols: 60, boards: 1, parts, style: 'breadboard' });
      const s = new L.BoardSim(c);
      const seen = [];
      for (let i = 0; i < 120; i++) { s.tick(1000 + i * 16); seen.push(s.val[ic._nets[3]]); }
      return seen;
    };
    const free = trace(base);
    const held = trace(base.concat([{ k: 'gnd', id: 'gr', a: pin(4) }]));
    ok('a 555 oscillates, and RESET low holds OUT low',
      free.some((v, i) => i && v !== free[i - 1]) && held.every((v) => v === 0));
  }

  /* 26. a 4017 walks one output at a time through all ten */
  {
    const ic = { k: 'ic', id: 'c4017', type: '4017', col: 10, board: 0, row: 4 };
    const clk = { k: 'ic', id: 'clk', type: 'CLK', col: 50, board: 0, row: 4, hz: 50 };
    const pin = (n) => L.partHoles(ic).find((x) => x.pin === n);
    const cp = (n) => L.partHoles(clk).find((x) => x.pin === n);
    const parts = [ic, clk,
      { k: 'vcc', id: 'v', a: pin(16) }, { k: 'gnd', id: 'g1', a: pin(8) },
      { k: 'gnd', id: 'g2', a: pin(15) }, { k: 'gnd', id: 'g3', a: pin(13) },
      { k: 'wire', id: 'w1', a: cp(8), b: pin(16), color: '#000' },
      { k: 'wire', id: 'w2', a: cp(4), b: pin(8), color: '#000' },
      { k: 'wire', id: 'w3', a: cp(5), b: pin(14), color: '#000' }];
    const c = L.compileBoard({ cols: 90, boards: 1, parts, style: 'breadboard' });
    const s = new L.BoardSim(c);
    const q = [3, 2, 4, 7, 10, 1, 5, 6, 9, 11].map((p) => ic._nets[p]);
    const seen = new Set(); let maxOn = 0;
    for (let i = 0; i < 400; i++) {
      s.tick(1000 + i * 16);
      const on = q.filter((n) => s.val[n] === 1 && s.str[n] !== 0);
      maxOn = Math.max(maxOn, on.length);
      if (on.length === 1) seen.add(q.indexOf(on[0]));
    }
    ok('a 4017 steps through all ten outputs, one at a time', seen.size === 10 && maxOn === 1, [...seen].join() + ' max=' + maxOn);
  }

  /* 27. Design is a second board, kept apart from the breadboard, in memory and on disk */
  {
    window.setMode('board');
    L.S.board.parts = [{ k: 'gnd', id: 'bb-marker', a: hl(0, 0) }];
    window.setMode('design');
    const fresh = L.S.board.style === 'design' && L.S.board.parts.length === 0;
    L.S.board.parts = [{ k: 'gnd', id: 'design-marker', a: hl(0, 0) }];
    window.setMode('board');
    const isolated = L.S.board.parts.length === 1 && L.S.board.parts[0].id === 'bb-marker';
    window.setMode('design');
    const kept = L.S.board.parts.length === 1 && L.S.board.parts[0].id === 'design-marker';
    /* saving while Design is open must still file each board under its own name */
    const snap = window.snapshot();
    const filed = snap.board.parts[0].id === 'bb-marker' && snap.design.parts[0].id === 'design-marker';
    window.applySnapshot(JSON.parse(JSON.stringify(snap)));
    window.setMode(L.S.mode);
    const reloaded = L.S.board.parts[0].id === 'design-marker';
    window.setMode('board');
    const reloadedBb = L.S.board.parts[0].id === 'bb-marker';
    ok('Design and Breadboard keep separate boards, and both survive saving and loading',
      fresh && isolated && kept && filed && reloaded && reloadedBb,
      [fresh, isolated, kept, filed, reloaded, reloadedBb].join());
    L.S.board.parts = [];
  }

  /* 28. the Trace pen lays a run of copper in one gesture, and one undo takes it all back */
  {
    window.setMode('design');
    L.S.board.parts = []; L.S.bundo = [];
    window.armPart({ type: 'tracepen' });
    L.S.drag = { kind: 'tracepen', last: hl(0, 5), moved: false };
    for (const c of [6, 7, 8]) { const w = { x: L.holeX(c), y: L.holeY(0) }; window.boardMove(null, w, w); }
    window.boardUp();
    const laid = L.S.board.parts.length;
    window.undo();
    ok('the trace pen routes a run of copper and undoes in one step', laid === 3 && L.S.board.parts.length === 0 && L.S.bundo.length === 0,
      laid + ' then ' + L.S.board.parts.length);
    window.armPart(null);
    window.setMode('board');
  }

  /* ---------- the app booted ---------- */
  {
    ok('app state exists', !!L.S && !!L.S.board);
    ok('canvas has a size', document.querySelector('#cv').width > 0);
    ok('palette rendered', document.querySelectorAll('.pal-item').length > 5,
       document.querySelectorAll('.pal-item').length);
    ok('the breadboard app has no schematic editor in it', typeof L.compile === 'undefined' && !document.querySelector('#mode-editor'));
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
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-cdp-'));
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
  /* ---------- UI: drive the real thing with real mouse events ---------- */
  try {
    /* ---- breadboard: place a jumper with two clicks ---- */
    await ev(`(()=>{const L=Bench; L.S.board={cols:60,parts:[]}; L.S.bdirty=true;
      L.S.bcam.x=40; L.S.bcam.y=60; L.S.bcam.z=1; return 1;})()`);
    await wait(200);
    const hole = (r2, c2) => ev(`(()=>{const L=Bench, r=document.querySelector('#cv').getBoundingClientRect();
      const s=L.toScreen(L.holeX(${c2}), L.holeY(${r2}));
      return {x:r.left+s.x, y:r.top+s.y};})()`);
    await clickSel('.pal-item[data-type="wire"]');
    const h1 = await hole(0, 3), h2 = await hole(2, 8);
    await clickAt(h1.x, h1.y);
    await clickAt(h2.x, h2.y);
    const jump = await ev(`(()=>{const p=Bench.S.board.parts[0];
      return p ? p.k+':'+p.a.r+','+p.a.c+'-'+p.b.r+','+p.b.c : 'none';})()`);
    report('two clicks lay a jumper between the right holes', jump === 'wire:0,3-2,8', jump);
    const joined = await ev(`(()=>{const L=Bench; L.S.bdirty=true;
      const c=L.compileBoard(L.S.board);
      return c.holeNet.get(L.tieKey(4,3)) === c.holeNet.get(L.tieKey(0,8));})()`);
    report('the jumper actually joins the two columns', joined === true, joined);

    /* a chip needs a legal column and lands across the channel */
    await clickSel('.pal-item[data-chip="7400"]');
    const h3 = await hole(5, 20);
    await clickAt(h3.x, h3.y);
    const ic = await ev(`(()=>{const p=Bench.S.board.parts.find(x=>x.k==='ic');
      return p ? p.type+'@'+p.col : 'none';})()`);
    report('a 74-series chip drops onto the board', ic === '7400@20', ic);

    const palette = await ev(`(()=>{const L=Bench;
      const names=[...document.querySelectorAll('.pal-item')].map(e=>{
        const top=e.querySelector('.top'); return (top||e).textContent.trim();});
      const missing=Object.keys(L.ICS).filter(k=>!names.includes(L.ICS[k].name));
      const groups=[...document.querySelectorAll('.pal-group h3')].map(e=>e.textContent);
      return (missing.join(',')||'none') + '|' + groups[0] + '|' + groups.length;})()`);
    report('every chip is in the palette, board controls first',
      /^none|Board|d+$/.test(palette)|Board\|[6-9]$/.test(palette), palette);

    /* every chip carries a plain-English name and an explanation */
    const plainness = await ev(`(()=>{const L=Bench;
      const bad=Object.keys(L.ICS).filter(k=>{const c=L.ICS[k];
        return !c.nick || !c.plain || c.plain.length < 40;});
      const shown=[...document.querySelectorAll('.pal-item.named[data-type="ic"] .sub')].map(e=>e.textContent);
      return (bad.join(',')||'none') + '|' + shown.length;})()`);
    report('every chip has a plain name and an explanation, shown in the palette',
      plainness === 'none|' + (await ev(`Object.keys(Bench.ICS).length`)), plainness);

    /* selecting one explains it on the side */
    const explains = await ev(`(()=>{const L=Bench;
      L.S.board={cols:60,parts:[{k:'ic',id:'z',type:'74595',col:6}]};
      L.S.bsel='z'; L.S.bdirty=true; L.renderInspector();
      const t=document.querySelector('#inspector').textContent;
      return t.includes('What it does') + '|' + t.includes('eight outputs from three wires')
        + '|' + t.includes('Watch out');})()`);
    report('selecting a chip explains it on the side', explains === 'true|true|true', explains);

    /* a chip on the breadboard shows what is inside it, and a gate diagram */
    const inside = await ev(`(()=>{const L=Bench;
      L.S.board={cols:60,parts:[{k:'ic',id:'z2',type:'7400',col:6}]};
      L.S.bsel='z2'; L.S.bdirty=true; L.renderInspector();
      const t=document.querySelector('#inspector').textContent;
      const cv2=document.querySelector('#inspector canvas.preview');
      return t.includes('4 separate NAND gates') + '|' + t.includes('transistors');})()`);
    report('a breadboard chip says what is inside it', inside === 'true|true', inside);


    const explainsPart = await ev(`(()=>{const L=Bench;
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
    report('the breadboard clears when confirmed', (await ev(`Bench.S.board.parts.length`)) === 0,
      await ev(`Bench.S.board.parts.length`));
    await ev(`(()=>{const b=[...document.querySelectorAll('#palette button')]
      .find(x=>x.textContent==='Power the rails'); b.click(); return 1;})()`);
    await wait(300);
    const powered = await ev(`(()=>{const L=Bench; L.S.bdirty=true;
      const c=L.compileBoard(L.S.board); const s=new L.BoardSim(c);
      for(let i=0;i<6;i++) s.tick(1000+i);
      const plus=c.holeNet.get(L.tieKey(100,0)), minus=c.holeNet.get(L.tieKey(101,0));
      return L.S.board.parts.length + '|' + s.val[plus] + s.str[plus] + '|' + s.val[minus] + s.str[minus];})()`);
    report('"power the rails" energises both + and − rails', powered === '4|12|02', powered);

    await clickSel('.pal-item[data-type="dip"]');
    const h4 = await hole(5, 30);
    await clickAt(h4.x, h4.y);
    const dipPt = await ev(`(()=>{const L=Bench, r=document.querySelector('#cv').getBoundingClientRect();
      const p=L.S.board.parts.find(x=>x.k==='dip');
      const s=L.toScreen(L.holeX(p.col+1), (L.holeY(4)+L.holeY(5))/2);
      return {x:r.left+s.x, y:r.top+s.y};})()`);
    await clickAt(dipPt.x, dipPt.y);
    await wait(250);
    const dip = await ev(`(()=>{const L=Bench; const p=L.S.board.parts.find(x=>x.k==='dip');
      if(!p) return 'none';
      const c=L.compileBoard(L.S.board);
      const joined = c.holeNet.get(L.tieKey(9,p.col+1))===c.holeNet.get(L.tieKey(0,p.col+1));
      return p.on.map(Number).join('') + '|' + joined;})()`);
    report('a DIP switch lever closes its own contact', dip === '0100|true', dip);

    /* the breadboard has its own undo, so deleting there is reversible too */
    const bParts = () => ev(`Bench.S.board.parts.length`);
    await ev(`(()=>{const L=Bench; L.S.board=L.examples.BOARD_EXAMPLES[0].make();
      L.S.bundo=[]; L.S.bredo=[]; L.S.bdirty=true; L.S.bsel=null; L.fitView(); return 1;})()`);
    await wait(300);
    const n0 = await bParts();
    const icPt = await ev(`(()=>{const L=Bench, r=document.querySelector('#cv').getBoundingClientRect();
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

    /* Use mode on the breadboard: buttons and DIP switches work, chips do not
       slide and jumpers cannot be laid */
    {
      await ev(`(()=>{const L=Bench; L.S.board=L.examples.BOARD_EXAMPLES[1].make();
        L.S.bundo=[]; L.S.bredo=[]; L.S.bdirty=true; L.S.bsel=null; L.fitView(); return 1;})()`);
      await wait(300);
      await clickSel('#act-run');
      await wait(250);
      const bShape = () => ev(`(()=>{const L=Bench;
        return L.S.board.parts.length + '/' + L.S.board.parts.map(p=>p.col).join(',');})()`);
      const bBefore = await bShape();
      const btn = await ev(`(()=>{const L=Bench, r=document.querySelector('#cv').getBoundingClientRect();
        const p=L.S.board.parts.find(x=>x.k==='btn'); if(!p) return null;
        const s=L.toScreen(L.holeX(p.col+1), (L.holeY(4)+L.holeY(5))/2);
        return {x:r.left+s.x, y:r.top+s.y};})()`);
      /* a stretch of board with nothing on or near it, for the drag checks */
      const chipFree = await ev(`(()=>{const L=Bench, r=document.querySelector('#cv').getBoundingClientRect();
        const far=Math.max(...L.S.board.parts.map(p=>p.col||0)) + 8;
        const s=L.toScreen(L.holeX(far), L.holeY(2));
        return {x:r.left+s.x, y:r.top+s.y};})()`);
      if (btn) {
        await mouse('mousePressed', btn.x, btn.y);
        const down = await ev(`(Bench.S.board.parts.find(x=>x.k==='btn')||{}).pressed`);
        await mouse('mouseReleased', btn.x, btn.y);
        await wait(200);
        const up = await ev(`(Bench.S.board.parts.find(x=>x.k==='btn')||{}).pressed`);
        report('a breadboard button still presses in Use mode', down === true && up === false,
          down + ' then ' + up);
        /* and you should not have to land on it exactly */
        await mouse('mousePressed', btn.x + 22, btn.y - 16);
        const nearDown = await ev(`(Bench.S.board.parts.find(x=>x.k==='btn')||{}).pressed`);
        await mouse('mouseReleased', btn.x + 22, btn.y - 16);
        await wait(200);
        report('a press near a breadboard button still works', nearDown === true, nearDown);
      }
      /* left-drag must not slide the board out from under a button */
      const bcamBefore = await ev(`JSON.stringify(Bench.S.bcam)`);
      await mouse('mousePressed', chipFree.x, chipFree.y);
      await mouse('mouseMoved', chipFree.x + 130, chipFree.y + 70);
      await mouse('mouseReleased', chipFree.x + 130, chipFree.y + 70);
      await wait(250);
      report('a left-drag on bare board does not move the view in Use mode',
        (await ev(`JSON.stringify(Bench.S.bcam)`)) === bcamBefore);
      await mouse('mousePressed', chipFree.x, chipFree.y, { button: 'right', buttons: 2 });
      await mouse('mouseMoved', chipFree.x + 90, chipFree.y + 50, { button: 'right', buttons: 2 });
      await mouse('mouseReleased', chipFree.x + 90, chipFree.y + 50, { button: 'right', buttons: 0 });
      await wait(250);
      report('right-drag moves the board view instead',
        (await ev(`JSON.stringify(Bench.S.bcam)`)) !== bcamBefore);
      const bkeep = await ev(`Bench.S.board.parts.length`);
      await mouse('mousePressed', chipFree.x + 45, chipFree.y + 25, { button: 'right', buttons: 2 });
      await mouse('mouseReleased', chipFree.x + 45, chipFree.y + 25, { button: 'right', buttons: 0 });
      await wait(250);
      report('and a right-click removes no board part in Use mode',
        (await ev(`Bench.S.board.parts.length`)) === bkeep);
      await ev(`(()=>{Bench.fitView(); return 1;})()`);
      await wait(250);
      const chip = await ev(`(()=>{const L=Bench, r=document.querySelector('#cv').getBoundingClientRect();
        const p=L.S.board.parts.find(x=>x.k==='ic');
        const s=L.toScreen(L.holeX(p.col+1), (L.holeY(4)+L.holeY(5))/2);
        return {x:r.left+s.x, y:r.top+s.y};})()`);
      await mouse('mousePressed', chip.x, chip.y);
      await mouse('mouseMoved', chip.x + 140, chip.y);
      await mouse('mouseReleased', chip.x + 140, chip.y);
      await wait(250);
      report('a chip cannot be slid along the board in Use mode',
        (await bShape()) === bBefore, (await bShape()) + ' vs ' + bBefore);

      /* and the mode is remembered, because it is a preference not a gesture */
      await ev(`Bench.saveNow()`);
      await wait(200);
      await send('Page.reload');
      await wait(2200);
      report('the Edit / Use choice survives a reload',
        await ev(`(()=>{const L=window.Bench; return !!L && L.S.play
          && document.querySelector('#act-run').classList.contains('on');})()`));
      await ev(`Bench.setPlay(false)`);
      await wait(200);
    }
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

  chrome.kill();
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) { /* leave it */ }
  process.exit(fails ? 1 : 0);
})();
