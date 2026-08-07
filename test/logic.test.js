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

  /* 7b. memory you can type a program into */
  {
    /* a ROM reads back exactly what was stored, at every address */
    const b = L.builder('rom test');
    const a = [0,1,2,3].map(i => b.pin('A'+i, 0, i*70));
    const rom = b.add('ROM', 250, 0, { abits: 4, dbits: 8,
      data: [1,2,4,8,16,32,64,128,255,0,170,85,15,240,3,12] });
    a.forEach((p, i) => b.w(p, 0, rom, i));
    const outs = [];
    for (let i = 0; i < 8; i++) { const o = b.out('D'+i, 600, i*70); b.w(rom, i, o, 0); outs.push(o); }
    const io = L.ioOrder(b.def);
    const c = L.compile(b.def);
    let bad = null;
    for (let addr = 0; addr < 16; addr++) {
      io.ins.forEach((p, i) => { p.value = (addr >> i) & 1; });
      const sim = new L.Sim(c);
      sim.settle(200, 0);
      let got = 0;
      io.outs.forEach((p) => {
        const bit = +p.label.slice(1);
        got |= sim.val(c.portNet.get(p.id + '.i0')) << bit;
      });
      if (got !== rom.data[addr]) bad = 'addr ' + addr + ' gave ' + got + ' not ' + rom.data[addr];
    }
    ok('a ROM gives back what you stored at every address', !bad, bad);
  }
  {
    /* a RAM takes a value on the clock edge, but only while WRITE is high */
    const b = L.builder('ram test');
    const a0 = b.pin('A0', 0, 0), a1 = b.pin('A1', 0, 60);
    const d0 = b.pin('D0', 0, 120), d1 = b.pin('D1', 0, 180);
    const wr = b.pin('WR', 0, 240), ck = b.pin('CK', 0, 300);
    const ram = b.add('RAM', 300, 0, { abits: 2, dbits: 2, data: [] });
    b.w(a0,0,ram,0); b.w(a1,0,ram,1); b.w(d0,0,ram,2); b.w(d1,0,ram,3);
    b.w(wr,0,ram,4); b.w(ck,0,ram,5);
    const q0 = b.out('Q0', 700, 0), q1 = b.out('Q1', 700, 60);
    b.w(ram,0,q0,0); b.w(ram,1,q1,0);
    const c = L.compile(b.def);
    const sim = new L.Sim(c);
    const io = L.ioOrder(b.def);
    const pin = (nm) => io.ins.find(p => p.label === nm);
    const nets = io.outs.map(p => c.portNet.get(p.id + '.i0'));
    const run = (n) => { for (let i = 0; i < n; i++) sim.tick(0); };
    const set = (o) => { for (const k in o) pin(k).value = o[k]; };
    const readBack = () => (sim.val(nets[0]) | (sim.val(nets[1]) << 1));
    // store 3 at address 1
    set({ A0:1, A1:0, D0:1, D1:1, WR:1, CK:0 }); run(20);
    set({ CK:1 }); run(20);
    set({ CK:0, WR:0 }); run(20);
    const stored = readBack();
    // a clock edge with WRITE low must not change it
    set({ D0:0, D1:0, CK:1 }); run(20);
    set({ CK:0 }); run(20);
    const untouched = readBack();
    // and a different address is still empty
    set({ A0:0 }); run(20);
    const elsewhere = readBack();
    ok('a RAM stores on the clock edge, and only when told to',
      stored === 3 && untouched === 3 && elsewhere === 0,
      [stored, untouched, elsewhere].join(','));
  }
  {
    /* the stored-program example really does walk its ROM */
    const def = L.examples.EDITOR_EXAMPLES[8].make().work;
    const c = L.compile(def);
    const sim = new L.Sim(c);
    const rom = def.nodes.find(n => n.type === 'ROM');
    const prim = c.prims.find(p => p.node === rom);
    const seen = [];
    let t = 0;
    for (let step = 0; step < 40; step++) {
      t += 200;
      for (let i = 0; i < 20; i++) sim.tick(t);
      let word = 0;
      for (let i = 0; i < 8; i++) word |= sim.val(prim.outs[i]) << i;
      if (!seen.length || seen[seen.length-1] !== word) seen.push(word);
    }
    const inRom = seen.every(w => rom.data.includes(w));
    ok('the stored-program example walks through its ROM',
      seen.length > 4 && inRom, seen.join(','));
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

    /* the ROM recipe must hold the numbers its caption claims: 1, 2, 3, 0 */
    {
      // truth-table rows count with the FIRST pin as the high bit, so read the
      // address off the input columns rather than assuming row order
      const t = L.computeTruthTable(L.RECIPES.ROM.make());
      const words = [0, 0, 0, 0];
      for (const r of t.rows) words[r.in[0] + r.in[1] * 2] = r.out[0] + r.out[1] * 2;
      ok('the ROM diagram really stores 1, 2, 3, 0', words.join(',') === '1,2,3,0', words.join(','));
    }

    /* the generated array must behave like the RAM part it explains: write to
       one address, read it back, and check the others were left alone */
    {
      const def = L.ramArray(2, 2);
      const io = L.ioOrder(def);
      const c = L.compile(def);
      const sim = new L.Sim(c);
      const pin = (nm) => io.ins.find(p => p.label === nm);
      const qNet = io.outs.map(p => c.portNet.get(p.id + '.i0'));
      const run = (n) => { for (let i = 0; i < n; i++) sim.tick(0); };
      const set = (o) => { for (const k in o) pin(k).value = o[k]; };
      const addr = (a) => set({ A0: a & 1, A1: (a >> 1) & 1 });
      const read = () => sim.val(qNet[0]) | (sim.val(qNet[1]) << 1);
      const store = (a, v) => {
        addr(a); set({ D0: v & 1, D1: (v >> 1) & 1, WRITE: 1, CLK: 0 }); run(40);
        set({ CLK: 1 }); run(40); set({ CLK: 0, WRITE: 0 }); run(40);
      };
      store(0, 3); store(1, 1); store(2, 2); store(3, 0);
      const back = [];
      for (let a = 0; a < 4; a++) { addr(a); run(40); back.push(read()); }
      ok('the generated RAM array stores and reads back four separate words',
        back.join(',') === '3,1,2,0', back.join(','));
      // a write to one address must not disturb its neighbours
      store(1, 3);
      const after = [];
      for (let a = 0; a < 4; a++) { addr(a); run(40); after.push(read()); }
      ok('writing one word leaves the others alone', after.join(',') === '3,3,2,0', after.join(','));
      ok('the array is the three regions it claims', (() => {
        const kinds = {};
        for (const n of def.nodes) kinds[n.type] = (kinds[n.type] || 0) + 1;
        // 4 words x 2 bits: 2 inverters, 4 decode ANDs, 4 write gates,
        // 8 flip-flops, 8 read gates, 2 x 3 collecting ORs
        return kinds.NOT === 2 && kinds.DFF === 8 && kinds.OR === 6 && kinds.AND === 16;
      })(), JSON.stringify((() => { const k = {}; for (const n of def.nodes) k[n.type] = (k[n.type] || 0) + 1; return k; })()));
    }
    /* a bigger one still adds up, and stays inside what the editor can run */
    {
      const big = L.ramArray(4, 8);
      const c = L.compile(big);
      ok('a 16 x 8 array is buildable', big.nodes.length > 400 && big.nodes.length < 700
        && c.errors.length === 0, big.nodes.length + ' parts, ' + c.prims.length + ' primitives');
      // the count shown on the button has to be the count you actually get
      let sizeBad = null;
      for (const [ab, db] of [[1, 1], [2, 2], [3, 4], [4, 8], [2, 16]]) {
        const n = L.ramArray(ab, db).nodes.length, said = L.ramArraySize(ab, db);
        if (n !== said) sizeBad = ab + 'x' + db + ': built ' + n + ', promised ' + said;
      }
      ok('the part count on the button is the real one', !sizeBad, sizeBad);
    }

    /* the RAM-cell recipe must behave like one bit of RAM */
    {
      const def = L.RECIPES.RAM.cell();
      const io = L.ioOrder(def);
      const c = L.compile(def);
      const sim = new L.Sim(c);
      const pin = (nm) => io.ins.find(p => p.label === nm);
      const qNet = c.portNet.get(io.outs[0].id + '.i0');
      const run = (n) => { for (let i = 0; i < n; i++) sim.tick(0); };
      const set = (o) => { for (const k in o) pin(k).value = o[k]; };
      const pulse = () => { set({ CLK: 0 }); run(25); set({ CLK: 1 }); run(25); set({ CLK: 0 }); run(25); };
      // chosen and writing: it takes the 1
      set({ D: 1, SELECT: 1, WRITE: 1, CLK: 0 }); run(25);
      pulse();
      const stored = sim.val(qNet);
      // writing but not chosen: it must ignore the edge
      set({ D: 0, SELECT: 0, WRITE: 1 }); pulse();
      set({ SELECT: 1, WRITE: 0 }); run(25);
      const ignored = sim.val(qNet);
      // chosen and writing a 0: it takes that
      set({ D: 0, WRITE: 1 }); pulse();
      set({ WRITE: 0 }); run(25);
      const overwritten = sim.val(qNet);
      // and an unchosen cell reads back 0 whatever it holds
      set({ D: 1, WRITE: 1 }); pulse();
      set({ WRITE: 0 }); run(25);
      const held = sim.val(qNet);
      set({ SELECT: 0 }); run(25);
      const quiet = sim.val(qNet);
      ok('the RAM-cell diagram behaves like one bit of RAM',
        stored === 1 && ignored === 1 && overwritten === 0 && held === 1 && quiet === 0,
        [stored, ignored, overwritten, held, quiet].join(','));
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

  /* 9b. taking a whole circuit apart a layer at a time. The claim the button
         makes is that the picture is still the same circuit, so the tests are
         about behaviour, not about part counts. */
  {
    const types = (def) => {
      const k = {};
      for (const n of def.nodes) if (n.type !== 'IN' && n.type !== 'OUT') k[n.type] = (k[n.type] || 0) + 1;
      return k;
    };

    /* a 4 x 2 RAM, broken down, must still be a 4 x 2 RAM */
    {
      const flat = L.expandOnce(L.ramArray(2, 2));
      const io = L.ioOrder(flat);
      const c = L.compile(flat);
      ok('the broken-down RAM still wires up cleanly', c.errors.length === 0, JSON.stringify(c.errors));
      const sim = new L.Sim(c);
      const pin = (nm) => io.ins.find(p => p.label === nm);
      const qNet = io.outs.map(p => c.portNet.get(p.id + '.i0'));
      const run = (n) => { for (let i = 0; i < n; i++) sim.tick(0); };
      const set = (o) => { for (const k in o) pin(k).value = o[k]; };
      const addr = (a) => set({ A0: a & 1, A1: (a >> 1) & 1 });
      const read = () => sim.val(qNet[0]) | (sim.val(qNet[1]) << 1);
      const store = (a, v) => {
        addr(a); set({ D0: v & 1, D1: (v >> 1) & 1, WRITE: 1, CLK: 0 }); run(120);
        set({ CLK: 1 }); run(120); set({ CLK: 0, WRITE: 0 }); run(120);
      };
      store(0, 3); store(1, 1); store(2, 2); store(3, 0);
      const back = [];
      for (let a = 0; a < 4; a++) { addr(a); run(120); back.push(read()); }
      ok('a RAM broken down into NANDs still stores four separate words',
        back.join(',') === '3,1,2,0', back.join(','));
      store(1, 3);
      const after = [];
      for (let a = 0; a < 4; a++) { addr(a); run(120); after.push(read()); }
      ok('the broken-down RAM keeps the words it was not asked to change',
        after.join(',') === '3,3,2,0', after.join(','));
      const k = types(flat);
      ok('one press turns the whole RAM into nothing but NANDs',
        Object.keys(k).join(',') === 'NAND' && !L.anySimpler(flat), JSON.stringify(k));
      ok('and it is bigger than what it replaced, as it should be',
        k.NAND > L.ramArray(2, 2).nodes.length, k.NAND + ' NANDs');
    }

    /* opening up one kind of part at a time — all eight flip-flops inside a
       RAM as NANDs, with the decoder around them left standing */
    {
      const ram = L.ramArray(2, 2);
      const only = L.expandOnce(ram, 'DFF');
      const k = types(only);
      ok('opening up just the flip-flops leaves everything else alone',
        k.DFF === undefined && k.NAND === 48 && k.AND === types(ram).AND
        && k.OR === types(ram).OR && k.NOT === types(ram).NOT, JSON.stringify(k));

      /* and the RAM has to still be a RAM afterwards */
      const io = L.ioOrder(only);
      const c = L.compile(only);
      const sim = new L.Sim(c);
      const pin = (nm) => io.ins.find(p => p.label === nm);
      const qNet = io.outs.map(p => c.portNet.get(p.id + '.i0'));
      const run = (n) => { for (let i = 0; i < n; i++) sim.tick(0); };
      const set = (o) => { for (const key in o) pin(key).value = o[key]; };
      const addr = (a) => set({ A0: a & 1, A1: (a >> 1) & 1 });
      const store = (a, v) => {
        addr(a); set({ D0: v & 1, D1: (v >> 1) & 1, WRITE: 1, CLK: 0 }); run(100);
        set({ CLK: 1 }); run(100); set({ CLK: 0, WRITE: 0 }); run(100);
      };
      store(0, 2); store(1, 3); store(2, 0); store(3, 1);
      const back = [];
      for (let a = 0; a < 4; a++) { addr(a); run(100); back.push(sim.val(qNet[0]) | (sim.val(qNet[1]) << 1)); }
      ok('a RAM with only its flip-flops opened up still works as a RAM',
        back.join(',') === '2,3,0,1', back.join(','));

      /* the buttons that offer this have to name what is really in there */
      const offered = L.openableTypes(ram).map(([t, n]) => t + ':' + n).join(' ');
      ok('the "open up every…" buttons count what is really in the picture',
        offered === 'AND:16 DFF:8 OR:6 NOT:2', offered);
      ok('and once a kind is opened up it is no longer offered',
        !L.openableTypes(only).some(([t]) => t === 'DFF'),
        L.openableTypes(only).map(([t, n]) => t + ':' + n).join(' '));
      ok('asking for a kind that is not there changes nothing',
        L.expandOnce(ram, 'XOR') === null);
    }

    /* pressing it repeatedly has to stop, and stop at NANDs */
    {
      const seed = L.builder('a bit of everything');
      const sa = seed.pin('A', 0, 0), sb = seed.pin('B', 0, 100), sc = seed.pin('CLK', 0, 200);
      const sx = seed.add('XNOR', 200, 0), sn = seed.add('NOT', 380, 0);
      const sf = seed.add('DFF', 540, 0), so = seed.add('OR', 720, 0, { n: 3 });
      const sq = seed.out('Q', 900, 0);
      seed.w(sa, 0, sx, 0); seed.w(sb, 0, sx, 1); seed.w(sx, 0, sn, 0);
      seed.w(sn, 0, sf, 0); seed.w(sc, 0, sf, 1);
      seed.w(sf, 0, so, 0); seed.w(sf, 1, so, 1); seed.w(sa, 0, so, 2);
      seed.w(so, 0, sq, 0);
      let def = seed.def;
      let rounds = 0, sizes = [def.nodes.length];
      while (rounds < 12) {
        const next = L.expandOnce(def);
        if (!next) break;
        def = next; rounds++; sizes.push(def.nodes.length);
      }
      ok('breaking a circuit down keeps going until there is nothing left to break',
        rounds > 0 && rounds < 12 && !L.anySimpler(def), rounds + ' rounds: ' + sizes.join(' → '));
      ok('what it bottoms out at is NANDs and nothing else',
        Object.keys(types(def)).join(',') === 'NAND', JSON.stringify(types(def)));
      ok('every round is bigger than the last', sizes.every((n, i) => !i || n > sizes[i - 1]), sizes.join(','));
    }

    /* the adder still adds after it has been taken apart */
    {
      const b = L.builder('one bit of adding');
      const A = b.pin('A', 0, 0), B = b.pin('B', 0, 100), Ci = b.pin('Cin', 0, 200);
      const x1 = b.add('XOR', 200, 0), x2 = b.add('XOR', 380, 60);
      const a1 = b.add('AND', 200, 200), a2 = b.add('AND', 380, 260);
      const or = b.add('OR', 560, 240);
      const S = b.out('S', 740, 60), Co = b.out('C', 740, 250);
      b.w(A, 0, x1, 0); b.w(B, 0, x1, 1);
      b.w(x1, 0, x2, 0); b.w(Ci, 0, x2, 1); b.w(x2, 0, S, 0);
      b.w(A, 0, a1, 0); b.w(B, 0, a1, 1);
      b.w(x1, 0, a2, 0); b.w(Ci, 0, a2, 1);
      b.w(a1, 0, or, 0); b.w(a2, 0, or, 1); b.w(or, 0, Co, 0);
      const row = (def) => L.computeTruthTable(def).rows
        .map(r => r.in.join('') + '=' + r.out.join('')).join(' ');
      const want = row(b.def);
      let def = b.def, depth = 0, same = true;
      for (;;) {
        const next = L.expandOnce(def);
        if (!next) break;
        def = next; depth++;
        if (row(def) !== want) { same = false; break; }
      }
      ok('a full adder adds the same at every level it is broken down to',
        same && depth === 2, depth + ' levels, ' + want);
    }

    /* the floor, and the things it must not touch */
    {
      const b = L.builder('all NANDs already');
      const x = b.pin('A', 0, 0), y = b.pin('B', 0, 100);
      const g = b.add('NAND', 200, 0), o = b.out('out', 400, 0);
      b.w(x, 0, g, 0); b.w(y, 0, g, 1); b.w(g, 0, o, 0);
      ok('a circuit that is already NANDs cannot be broken down further',
        L.expandOnce(b.def) === null && !L.anySimpler(b.def));

      const w = L.builder('wide XOR');
      const p = [0, 1, 2].map(i => w.pin('P' + i, 0, i * 100));
      const gx = w.add('XOR', 200, 0, { n: 3 }), oo = w.out('out', 400, 0);
      p.forEach((q, i) => w.w(q, 0, gx, i)); w.w(gx, 0, oo, 0);
      ok('a three-input XOR is left alone rather than silently losing an input',
        L.expandOnce(w.def) === null && !L.anySimpler(w.def));
    }

    /* the census has to add up to the total the caption quotes, pins included */
    {
      const flat = L.expandOnce(L.ramArray(2, 1));
      const line = L.partsCensus(flat);
      const sum = [...line.matchAll(/(\d+) ×/g)].reduce((t, m) => t + +m[1], 0);
      ok('the census adds up to the number of parts it is describing',
        sum === flat.nodes.length && /^\d+ × NAND/.test(line),
        line + ' vs ' + flat.nodes.length + ' parts');
    }
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
    await clickSel('#modal-close');
    await wait(250);

    /* drilling down: RAM -> flip-flop -> NAND, and back up again */
    await ev(`(()=>{const L=LogicLab;
      const b=L.builder('drill'); const r=b.add('RAM',0,0,{abits:2,dbits:2,data:[]});
      L.S.work=b.def; L.S.dirty=true; L.S.sel.clear(); L.S.sel.add(r.id);
      L.renderInspector(); return 1;})()`);
    await wait(350);
    await ev(`document.querySelector('#inspector canvas.preview').click()`);
    await wait(400);
    const clickInside = async (type) => {
      const pt = await ev(`(()=>{const L=LogicLab;
        const c=document.querySelector('#modal canvas.preview.big');
        const r=c.getBoundingClientRect(), cam=c._cam;
        const def=c._def || null;
        const nodes=L.S.diagNodes || [];
        return {x:r.left, y:r.top, w:r.width, h:r.height, cx:cam.x, cy:cam.y, cz:cam.z};})()`);
      const target = await ev(`(()=>{const L=LogicLab;
        const c=document.querySelector('#modal canvas.preview.big');
        const cam=c._cam; const def=L.__diagDef;
        const n=def.nodes.find(x=>x.type===${JSON.stringify(type)});
        if(!n) return null; const g=L.geom(n);
        return {x:(g.x+g.w/2)*cam.z+cam.x, y:(g.y+g.h/2)*cam.z+cam.y};})()`);
      if (!target) return false;
      await clickAt(pt.x + target.x, pt.y + target.y);
      await wait(400);
      return true;
    };
    const depth = () => ev(`LogicLab.__diagTrail().length`);
    report('the diagram opens at the top level', (await depth()) === 1, await depth());
    await clickInside('DFF');
    report('clicking a flip-flop inside the RAM goes a level down', (await depth()) === 2, await depth());
    const secondTitle = await ev(`LogicLab.__diagTrail()[1].title`);
    report('and the trail names where you are', secondTitle === 'D FLIP-FLOP', secondTitle);
    await clickInside('NAND');
    report('clicking a NAND inside the flip-flop goes down again', (await depth()) === 3, await depth());
    /* an AND is made of NANDs and a NAND is described as an AND with the answer
       flipped — the obvious circle. Going one more step must not offer it. */
    await clickInside('AND');
    report('and once more, into the AND', (await depth()) === 4, await depth());
    const loop = await ev(`(()=>{const L=LogicLab; const def=L.__diagDef;
      const nands=def.nodes.filter(n=>n.type==='NAND');
      return nands.length + '|' + nands.some(n=>L.__descendable(n));})()`);
    report('the NANDs in there are not clickable, so it cannot go round in a circle',
      /^[1-9]\d*\|false$/.test(loop), loop);
    await ev(`[...document.querySelectorAll('#modal footer .btn')].find(b=>b.textContent.includes('Back up')).click()`);
    await wait(350);
    report('back up returns a level', (await depth()) === 3, await depth());
    /* and the trail itself jumps straight back to where you started */
    await ev(`document.querySelector('.diagtrail button').click()`);
    await wait(350);
    report('the trail jumps back to the top in one click', (await depth()) === 1, await depth());

    /* the other direction: instead of going into one part, break the whole
       picture down at once, over and over, until it is all NANDs */
    const simpler = () => ev(`(()=>{const b=[...document.querySelectorAll('#modal footer .btn')]
      .find(x=>x.textContent.includes('Simpler')); if(!b) return 'gone'; b.click(); return 'ok';})()`);
    const census = () => ev(`(()=>{const L=LogicLab; const k={};
      for(const n of L.__diagDef.nodes) if(n.type!=='IN'&&n.type!=='OUT') k[n.type]=(k[n.type]||0)+1;
      return Object.keys(k).sort().join('+') + '|' + L.__diagDef.nodes.length;})()`);
    const wasMadeOf = await census();
    await simpler();
    await wait(400);
    const nowMadeOf = await census();
    report('the whole RAM breaks down into NANDs in one press',
      (await depth()) === 2 && /^NAND\|/.test(nowMadeOf)
      && +nowMadeOf.split('|')[1] > +wasMadeOf.split('|')[1], wasMadeOf + ' → ' + nowMadeOf);
    const label = await ev(`(()=>{const b=[...document.querySelectorAll('#modal footer .btn')]
      .find(x=>/Simpler|All NANDs/.test(x.textContent)); return b.textContent+'|'+b.disabled;})()`);
    report('and the button then says there is nowhere further to go',
      label === 'All NANDs|true', label);
    const trailTitle = await ev(`LogicLab.__diagTrail()[1].title`);
    report('the trail counts what you are now looking at', /^simpler · \d+ parts$/.test(trailTitle), trailTitle);
    /* having just been told a NAND is the floor, the NANDs must not be doors
       back up into "an AND and a NOT" */
    const floor = await ev(`(()=>{const L=LogicLab;
      return L.__diagDef.nodes.filter(n=>n.type==='NAND').some(n=>L.__descendable(n))
        + '|' + document.querySelector('#modal .zoomhint').textContent;})()`);
    report('after breaking it all down, nothing on screen claims to go further',
      /^false\|/.test(floor) && /Nothing here goes any simpler/.test(floor), floor);
    /* a hundred gates fitted into one box are unreadable, so the picture moves */
    const cam = () => ev(`(()=>{const c=LogicLab.__diagTrail().slice(-1)[0].cam;
      return c ? [Math.round(c.x), Math.round(c.y), +c.z.toFixed(3)].join(',') : 'none';})()`);
    const restCam = await cam();
    const canvasBox = await ev(`(()=>{const r=document.querySelector('#modal canvas.preview.big')
      .getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2};})()`);
    await send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: canvasBox.x, y: canvasBox.y, deltaX: 0, deltaY: -240,
    });
    await wait(250);
    const zoomed = await cam();
    report('scrolling on the diagram zooms it in',
      zoomed !== restCam && +zoomed.split(',')[2] > +restCam.split(',')[2], restCam + ' → ' + zoomed);
    await mouse('mousePressed', canvasBox.x, canvasBox.y);
    await mouse('mouseMoved', canvasBox.x - 60, canvasBox.y + 25);
    await mouse('mouseReleased', canvasBox.x - 60, canvasBox.y + 25);
    await wait(250);
    const panned = await cam();
    report('dragging the diagram moves it rather than opening a part',
      +panned.split(',')[0] === +zoomed.split(',')[0] - 60
      && +panned.split(',')[1] === +zoomed.split(',')[1] + 25
      && (await depth()) === 2, zoomed + ' → ' + panned + ' at depth ' + (await depth()));
    await ev(`document.querySelector('#modal .zoomhint .linky').click()`);
    await wait(300);
    report('"fit it all in" puts it back', (await cam()) === restCam, (await cam()) + ' vs ' + restCam);

    /* the diagram can take the whole window, which matters most where real
       fullscreen is not allowed — an embed, a chat panel */
    const sheetBox = () => ev(`(()=>{const r=document.querySelector('#modal-sheet').getBoundingClientRect();
      const c=document.querySelector('#modal canvas.preview.big').getBoundingClientRect();
      return [Math.round(r.width), Math.round(r.height), Math.round(c.height)].join(',');})()`);
    const small = await sheetBox();
    await clickSel('#modal-grow');
    await wait(400);
    const huge = await sheetBox();
    report('the diagram can be grown to fill the window',
      +huge.split(',')[0] > +small.split(',')[0]
      && +huge.split(',')[2] > +small.split(',')[2], small + ' → ' + huge);
    const refit = await ev(`(()=>{const c=LogicLab.__diagTrail().slice(-1)[0].cam;
      const r=document.querySelector('#modal canvas.preview.big').getBoundingClientRect();
      const b=LogicLab.__diagDef.nodes.length;
      return c && c.x > -r.width && c.x < r.width ? 'in view' : 'lost';})()`);
    report('and growing it re-fits the picture rather than leaving it off-screen',
      refit === 'in view', refit);
    /* the sticky footer must not sit on top of the controls under the picture */
    const clear = await ev(`(()=>{
      const f=document.querySelector('#modal-sheet footer').getBoundingClientRect();
      const gaps=['.zoomhint','.openups']
        .map(s=>document.querySelector('#modal '+s))
        .filter(Boolean).map(e=>f.top - e.getBoundingClientRect().bottom);
      return Math.round(Math.min(...gaps));})()`);
    report('nothing under the grown picture hides behind the footer', clear >= 0, clear + 'px clear');
    await clickSel('#modal-grow');
    await wait(400);
    report('and shrinks back again', (await sheetBox()) === small, (await sheetBox()) + ' vs ' + small);

    await ev(`[...document.querySelectorAll('#modal footer .btn')].find(b=>b.textContent.includes('Back up')).click()`);
    await wait(350);
    report('backing out of a breakdown returns to the whole part', (await depth()) === 1, await depth());

    /* opening up one kind of part at a time, through its button */
    const chips = () => ev(`[...document.querySelectorAll('#modal .openups button')]
      .map(b=>b.textContent).join(' · ')`);
    report('the diagram offers each kind of part it could open up',
      (await chips()) === 'AND (16) · D FLIP-FLOP (8) · OR (6) · NOT (2)', await chips());
    await ev(`[...document.querySelectorAll('#modal .openups button')]
      .find(b=>b.textContent.startsWith('D FLIP-FLOP')).click()`);
    await wait(400);
    const opened = await ev(`(()=>{const L=LogicLab; const k={};
      for(const n of L.__diagDef.nodes) k[n.type]=(k[n.type]||0)+1;
      return L.__diagTrail().slice(-1)[0].title + '|' + k.NAND + '|' + k.AND + '|' + (k.DFF||0);})()`);
    report('opening up every flip-flop leaves the rest of the RAM standing',
      opened === 'D FLIP-FLOP opened up · 80 parts|48|16|0', opened);
    report('and the flip-flop is no longer on offer',
      !(await chips()).includes('D FLIP-FLOP'), await chips());
    /* this level has the fullest set of controls under the picture — caption
       over two lines, the hint, and a row of buttons — so it is the one that
       proves the grown sheet leaves room for all of them */
    const gaps = () => ev(`(()=>{
      const f=document.querySelector('#modal-sheet footer').getBoundingClientRect();
      return ['.zoomhint','.openups'].map(s=>document.querySelector('#modal '+s))
        .filter(Boolean).map(e=>Math.round(f.top - e.getBoundingClientRect().bottom)).join(',');})()`);
    await clickSel('#modal-grow');
    await wait(400);
    const grownGaps = await gaps();
    report('grown, the hint and the button row still clear the footer',
      grownGaps.split(',').every(n => +n >= 0), grownGaps);
    await clickSel('#modal-grow');
    await wait(300);
    await clickSel('#modal-close');
    await wait(250);

    /* the top bar says what "Untitled" is, and lets you change it */
    /* fullscreen, and what it does when the frame around the page says no */
    {
      const has = await ev(`(()=>{const b=document.querySelector('#btn-full');
        return b ? b.title : 'missing';})()`);
      report('there is a fullscreen button and it says the shortcut',
        /Fullscreen \(Shift\+F\)/.test(has), has);
      /* pretend the embedding frame refuses, the way a sandboxed one does */
      const refused = await ev(`(()=>{
        const el=document.documentElement, real=el.requestFullscreen;
        el.requestFullscreen = () => Promise.reject(new Error('denied'));
        document.querySelector('#btn-full').click();
        return new Promise(r => setTimeout(()=>{
          el.requestFullscreen = real;
          const t=document.querySelector('#hint');
          r(t && t.classList.contains('show') ? t.textContent : 'no toast');
        }, 300));})()`);
      report('a frame that refuses fullscreen gets an explanation, not silence',
        /own browser tab/.test(refused) && /F11/.test(refused), refused);
    }

    await ev(`(()=>{const L=LogicLab; L.S.work.name='Untitled'; L.renderCrumbs(); return 1;})()`);
    await wait(150);
    const crumb = await ev(`document.querySelector('#crumbs').textContent`);
    report('the top bar explains the circuit name', /Circuit:.*click to name it/.test(crumb), crumb);
    await ev(`document.querySelector('#crumbs .crumb-name').click()`);
    await wait(300);
    await ev(`(()=>{const i=document.querySelector('#modal input[type=text]');
      i.value='My Machine'; return 1;})()`);
    await clickSel('#modal footer .primary');
    await wait(300);
    const renamed = await ev(`LogicLab.S.work.name + '|' + document.querySelector('#crumbs').textContent`);
    report('renaming from the top bar works', /^My Machine\|Circuit: My Machine/.test(renamed), renamed);

    /* put the half adder back for the checks that follow */
    await ev(`(()=>{const L=LogicLab; L.S.work=L.examples.EDITOR_EXAMPLES[0].make().work;
      L.S.dirty=true; const n=L.S.work.nodes.find(x=>x.type==='XOR');
      L.S.sel.clear(); L.S.sel.add(n.id); L.renderInspector(); return 1;})()`);
    await wait(350);

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

    /* ---- the decoder behind a hex digit ---- */
    {
      /* The claim is that this circuit lights the same bars the display does.
         So drive it with all sixteen numbers and compare against the very
         table the display draws from — nothing else is proof. */
      const got = await ev(`(()=>{const L=LogicLab;
        const def=L.RECIPES.HEX.make();
        const io=L.ioOrder(def), c=L.compile(def);
        if(c.errors.length) return 'errors: '+JSON.stringify(c.errors);
        const sim=new L.Sim(c);
        const nets=io.outs.map(p=>c.portNet.get(p.id+'.i0'));
        const order=io.outs.map(p=>p.label).join('');
        const out=[];
        for(let n=0;n<16;n++){
          io.ins.forEach(p=>{
            const w={'8':8,'4':4,'2':2,'1':1}[p.label];
            p.value=(n & w)?1:0;});
          for(let t=0;t<40;t++) sim.tick(0);
          let bits=0;
          io.outs.forEach((p,i)=>{ if(sim.val(nets[i])) bits |= 1<<'abcdefg'.indexOf(p.label); });
          out.push(bits);
        }
        return order+'|'+out.join(',');})()`);
      const want = await ev(`'abcdefg|' + LogicLab.SEG_BITS.join(',')`);
      report('the hex decoder lights exactly the bars the display draws',
        got === want, got + '  vs  ' + want);

      const size = await ev(`(()=>{const L=LogicLab; const d=L.RECIPES.HEX.make(); const k={};
        for(const n of d.nodes) k[n.type]=(k[n.type]||0)+1;
        return JSON.stringify(k);})()`);
      report('and it is one AND per number, shared between all seven bars',
        /"AND":16/.test(size) && /"NOT":4/.test(size), size);

      /* and it goes all the way down like everything else */
      const down = await ev(`(()=>{const L=LogicLab;
        let d=L.RECIPES.HEX.make(), rounds=0;
        while(rounds<8){ const nx=L.expandOnce(d); if(!nx) break; d=nx; rounds++; }
        const k={}; for(const n of d.nodes) if(n.type!=='IN'&&n.type!=='OUT') k[n.type]=(k[n.type]||0)+1;
        return rounds+':'+Object.keys(k).join(',');})()`);
      report('the decoder breaks down into NANDs like the rest of it',
        /^[12]:NAND$/.test(down), down);
    }

    /* ---- naming a part where it stands ---- */
    {
      await ev(`(()=>{const L=LogicLab;
        const b=L.builder('chain');
        const id=Object.keys(L.lib)[0];
        [0,1,2].forEach(i=>b.add('CHIP', 80+i*220, 80, {chip:id}));
        L.S.work=b.def; L.S.dirty=true;
        L.S.sel.clear(); L.S.sel.add(b.def.nodes[1].id);
        L.renderInspector(); L.fitView(); return 1;})()`);
      await wait(300);
      const box = await ev(`(()=>{const i=[...document.querySelectorAll('#inspector input[type=text]')]
        .find(e=>/module 0/.test(e.placeholder)); return !!i;})()`);
      report('a placed part offers a name of its own, beside its type', box === true);
      await ev(`(()=>{const i=[...document.querySelectorAll('#inspector input[type=text]')]
        .find(e=>/module 0/.test(e.placeholder));
        i.value='module 1'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
      await wait(250);
      const named = await ev(`(()=>{const L=LogicLab;
        return L.S.work.nodes.map(n=>n.tag||'-').join(',');})()`);
      report('naming one leaves its neighbours alone', named === '-,module 1,-', named);
      report('the name is part of the circuit, so it saves with it',
        await ev(`JSON.parse(JSON.stringify(LogicLab.S.work)).nodes[1].tag === 'module 1'`));
      /* two copies of one chip keep their own names */
      await ev(`(()=>{const L=LogicLab; L.S.sel.clear(); L.S.sel.add(L.S.work.nodes[0].id);
        L.renderInspector(); return 1;})()`);
      await wait(250);
      await ev(`(()=>{const i=[...document.querySelectorAll('#inspector input[type=text]')]
        .find(e=>/module 0/.test(e.placeholder));
        i.value='module 0'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
      await wait(250);
      report('every copy of the same chip can be called something different',
        (await ev(`LogicLab.S.work.nodes.map(n=>n.tag||'-').join(',')`)) === 'module 0,module 1,-',
        await ev(`LogicLab.S.work.nodes.map(n=>n.tag||'-').join(',')`));
    }

    /* ---- crossings get a bridge, joins get a dot ---- */
    {
      const hops = () => ev(`LogicLab.wireHops().length`);
      /* the stored-program example has genuine crossings in it */
      await ev(`(()=>{const L=LogicLab; const e=L.examples.EDITOR_EXAMPLES[8].make();
        L.S.work=e.work||e; L.S.dirty=true; L.fitView(); return 1;})()`);
      await wait(300);
      const real = await hops();
      report('wires that cross without joining are bridged', real === 3, real);

      /* one signal reaching two places is a join, and must never be bridged —
         otherwise a fan-out would look like two unrelated wires */
      await ev(`(()=>{const L=LogicLab;
        const b=L.builder('same');
        const a1=b.pin('A',0,140);
        const o1=b.out('X',520,40), o2=b.out('Y',520,240);
        b.w(a1,0,o1,0); b.w(a1,0,o2,0);
        L.S.work=b.def; L.S.dirty=true; L.fitView(); return 1;})()`);
      await wait(300);
      report('but one signal reaching two places is never bridged',
        (await hops()) === 0, await hops());
    }

    /* ---- junctions you can put on a wire on purpose ---- */
    {
      await ev(`(()=>{const L=LogicLab;
        const b=L.builder('tee');
        const i=b.pin('A',0,60), o1=b.out('X',420,20), o2=b.out('Y',420,140);
        b.w(i,0,o1,0);
        L.S.work=b.def; L.S.dirty=true; L.S.sel.clear(); L.S.selWires.clear();
        L.S.undo=[]; L.S.redo=[]; L.fitView(); return 1;})()`);
      await wait(300);
      const shape = () => ev(`(()=>{const L=LogicLab;
        return L.S.work.nodes.filter(n=>n.type==='JOINT').length + '/' + L.S.work.wires.length;})()`);
      report('nothing there to start with', (await shape()) === '0/1', await shape());

      /* refuses politely when nothing is selected */
      await ev(`LogicLab.addJointToSelection(null)`);
      await wait(200);
      report('asks for a wire first when none is selected',
        (await shape()) === '0/1'
        && /Click a wire first/.test(await ev(`document.querySelector('#hint').textContent`)));

      /* select the wire, then put a junction on it */
      await ev(`(()=>{const L=LogicLab; L.S.selWires.clear();
        L.S.selWires.add(L.S.work.wires[0].id); return 1;})()`);
      await ev(`LogicLab.addJointToSelection(null)`);
      await wait(250);
      report('adding a junction splits the wire in two and leaves a joint',
        (await shape()) === '1/2', await shape());

      /* the junction has to be ON the wire, not off to one side */
      const onLine = await ev(`(()=>{const L=LogicLab;
        const j=L.S.work.nodes.find(n=>n.type==='JOINT');
        const a=L.S.work.nodes.find(n=>n.type==='IN'), o=L.S.work.nodes.find(n=>n.type==='OUT');
        const ga=L.geom(a), go=L.geom(o), gj=L.geom(j);
        const jx=gj.x+gj.w/2, jy=gj.y+gj.h/2;
        return jx > ga.x && jx < go.x + go.w && Math.abs(jy - ga.ins.concat(ga.outs)[0].y) < 60;})()`);
      report('and it lands on the wire rather than off to one side', onLine === true, onLine);

      /* now branch off it — one input feeding two outputs, which is the point */
      await ev(`(()=>{const L=LogicLab;
        const j=L.S.work.nodes.find(n=>n.type==='JOINT');
        const y=L.S.work.nodes.find(n=>n.type==='OUT' && n.label==='Y');
        L.S.work.wires.push({id:'w-tee', a:{n:j.id,s:'out',i:0}, b:{n:y.id,s:'in',i:0}});
        L.S.dirty=true; return 1;})()`);
      await wait(250);
      const tee = await ev(`LogicLab.computeTruthTable(LogicLab.S.work).rows
        .map(r=>r.in.join('')+'='+r.out.join('')).join(' ')`);
      report('a junction really does feed every branch off it',
        tee === '0=00 1=11', tee);

      /* the branches must part company AT the dot, not run together first */
      const split = await ev(`(()=>{const L=LogicLab;
        const j=L.S.work.nodes.find(n=>n.type==='JOINT'); const gj=L.geom(j);
        const jx=gj.x+gj.w/2;
        const at=(e)=>{const n=L.S.work.nodes.find(x=>x.id===e.n); const g=L.geom(n);
          return (e.s==='in'?g.ins:g.outs)[e.i];};
        const legs=L.S.work.wires.filter(w=>w.a.n===j.id);
        if(legs.length<2) return 'only '+legs.length+' leg';
        /* how far right of the dot each leg runs before it turns */
        const runs=legs.map(w=>{
          const pts=L.wirePoints(at(w.a), at(w.b), 60, w);
          const y0=pts[0].y;
          const turn=pts.find(p=>Math.abs(p.y-y0)>2);
          return turn ? Math.round(turn.x - jx) : 0;});
        return Math.max(...runs);})()`);
      report('branches leave the junction near the dot, not half a board later',
        typeof split === 'number' && split < 90, split);

      /* and the dot itself is easy to hit */
      const grab = await ev(`(()=>{const L=LogicLab;
        const j=L.S.work.nodes.find(n=>n.type==='JOINT'); const g=L.geom(j);
        L.S.cam.z=1;
        const hit=(dx,dy)=>{const h=L.hitTest({x:g.x+g.w/2+dx, y:g.y+g.h/2+dy}, false);
          return h && h.node===j.id;};
        return hit(0,0) && hit(14,0) && hit(0,-14) && !hit(90,90);})()`);
      report('a junction catches clicks from a little way off', grab === true, grab);

      /* and it is one undo step */
      await clickSel('#btn-undo');
      await wait(250);
      report('adding a junction is a single undo',
        (await shape()) === '0/1' || (await shape()) === '0/2', await shape());
    }

    /* ---- wires route round the parts instead of through them ---- */
    {
      const crossings = async (exampleIx) => {
        await ev(`(()=>{const L=LogicLab; const e=L.examples.EDITOR_EXAMPLES[${exampleIx}].make();
          L.S.work=e.work||e; L.S.dirty=true; L.S.sel.clear(); L.fitView(); return 1;})()`);
        await wait(300);
        return ev(`(()=>{const L=LogicLab;
          const boxes=L.S.work.nodes.map(n=>{const g=L.geom(n);
            return {id:n.id, x0:g.x, y0:g.y, x1:g.x+g.w, y1:g.y+g.h};});
          const at=(e)=>{const n=L.S.work.nodes.find(x=>x.id===e.n); const g=L.geom(n);
            return (e.s==='in'?g.ins:g.outs)[e.i];};
          let bad=0, total=0;
          for(const w of L.S.work.wires){
            const a=at(w.a), b=at(w.b); if(!a||!b) continue;
            total++;
            const pts=L.wirePoints(a,b,60,w);
            const skip=new Set([w.a.n,w.b.n]);
            for(const box of boxes){
              if(skip.has(box.id)) continue;
              if(pts.some(p=>p.x>box.x0+1&&p.x<box.x1-1&&p.y>box.y0+1&&p.y<box.y1-1)){bad++;break;}
            }
          }
          return bad+'/'+total;})()`);
      };
      /* the hard case: a chip's own output looping back to its own input has
         to go round the outside, not straight through the chip */
      const loopBack = await ev(`(()=>{const L=LogicLab;
        const b=L.builder('loop');
        const d=b.add('DFF', 300, 200);
        const clk=b.pin('CLK', 60, 260);
        b.w(d,1,d,0);                                  // Qbar back to D
        b.w(clk,0,d,1);
        L.S.work=b.def; L.S.dirty=true; L.fitView();
        const g=L.geom(d);
        const at=(e)=>{const n=L.S.work.nodes.find(x=>x.id===e.n); const gg=L.geom(n);
          return (e.s==='in'?gg.ins:gg.outs)[e.i];};
        const w=L.S.work.wires[0];
        const pts=L.wirePoints(at(w.a), at(w.b), 80, w);
        const inside=pts.filter(p=>p.x>g.x+1&&p.x<g.x+g.w-1&&p.y>g.y+1&&p.y<g.y+g.h-1).length;
        return inside;})()`);
      report('a wire looping back to its own part goes round it, not through it',
        loopBack === 0, loopBack + ' points inside the box');

      const adder = await crossings(1);
      report('no wire in the full adder runs through a part',
        adder === '0/12', adder);
      const counter = await crossings(7);
      report('nor in the counter', counter === '0/16', counter);
      const prog = await crossings(8);
      report('nor in the stored-program example', prog === '0/32', prog);
    }

    /* ---- lining parts up so the wires run straight ---- */
    {
      /* Two gates on the grid, wired. Their PORTS are at fractional offsets
         inside the boxes, so grid-aligned boxes still leave a kinked wire —
         which is the whole reason this feature has to exist. */
      /* the gap between the two PORTS a wire joins — wireHandles samples the
         drawn curve, which is not the same thing */
      const skew = () => ev(`(()=>{const L=LogicLab;
        const at=(e)=>{const n=L.S.work.nodes.find(x=>x.id===e.n); const g=L.geom(n);
          return (e.s==='in'?g.ins:g.outs)[e.i];};
        return L.S.work.wires.map(w=>Math.round(Math.abs(at(w.b).y-at(w.a).y))).join(',');})()`);
      await ev(`(()=>{const L=LogicLab;
        const b=L.builder('lineup');
        const i=b.pin('A',0,0), g=b.add('AND',200,30), o=b.out('Q',420,70);
        b.w(i,0,g,0); b.w(g,0,o,0);
        L.S.work=b.def; L.S.dirty=true; L.S.sel.clear(); L.S.undo=[]; L.S.redo=[];
        L.fitView(); return 1;})()`);
      await wait(300);
      const before = await skew();
      report('parts on the grid still leave the wires between them kinked',
        before.split(',').some(n => +n !== 0), before);

      const table = () => ev(`LogicLab.computeTruthTable(LogicLab.S.work).rows
        .map(r=>r.in.join('')+'='+r.out.join('')).join(' ')`);
      const want = await table();
      await ev(`LogicLab.straightenWires(null)`);
      await wait(250);
      report('lining up makes every wire dead level',
        (await skew()).split(',').every(n => +n === 0), await skew());
      report('and lining up cannot change what the circuit does',
        (await table()) === want, await table());

      /* dragging: come near level with something you are wired to and it pulls */
      const pulled = await ev(`(()=>{const L=LogicLab;
        L.S.cam.z = 1;                                // reach is in screen pixels
        const g=L.S.work.nodes.find(n=>n.type==='AND');
        g.y += 5;                                     // just off level
        const hit=L.alignOffset([g]);
        return hit ? Math.round(hit.gap) : 'no pull';})()`);
      report('a part a few pixels off level is pulled the rest of the way',
        pulled === -5, pulled);
      const tooFar = await ev(`(()=>{const L=LogicLab;
        const g=L.S.work.nodes.find(n=>n.type==='AND');
        g.y += 120;
        const hit=L.alignOffset([g]);
        g.y -= 120;
        return hit ? 'pulled' : 'left alone';})()`);
      report('but one nowhere near level is left where you put it',
        tooFar === 'left alone', tooFar);
      await ev(`(()=>{const L=LogicLab; const g=L.S.work.nodes.find(n=>n.type==='AND');
        g.y -= 5; L.S.dirty=true; return 1;})()`);
    }

    /* ---- turning parts, one at a time and in a block ---- */
    {
      /* a half adder, so there is something with a known truth table to turn */
      await ev(`(()=>{const L=LogicLab; L.S.work=L.examples.EDITOR_EXAMPLES[0].make().work;
        L.S.dirty=true; L.S.sel.clear(); L.S.undo=[]; L.S.redo=[]; L.fitView(); return 1;})()`);
      await wait(300);
      /* Read the table keyed by pin NAME. Pin order is worked out from where
         the pins sit, so turning the board legitimately renumbers them — what
         must not change is what each named input does to each named output. */
      const table = () => ev(`(()=>{const L=LogicLab;
        const io=L.ioOrder(L.S.work), t=L.computeTruthTable(L.S.work);
        return t.rows.map(r=>{
          const inp=io.ins.map((p,i)=>p.label+'='+r.in[i]).sort().join(',');
          const out=io.outs.map((p,i)=>p.label+'='+r.out[i]).sort().join(',');
          return inp+' -> '+out;}).sort().join(' | ');})()`);
      const want = await table();

      /* one part: it spins where it stands, and its ports move with it */
      const one = await ev(`(()=>{const L=LogicLab;
        const n=L.S.work.nodes.find(x=>x.type==='XOR');
        const b=L.geom(n);
        L.S.sel.clear(); L.S.sel.add(n.id);
        L.rotateSelection(1);
        const a=L.geom(n);
        return {rot:n.rot, wasW:Math.round(b.w), wasH:Math.round(b.h),
          nowW:Math.round(a.w), nowH:Math.round(a.h),
          inWasLeft: b.ins.every(p=>Math.abs(p.x-b.x)<1),
          inNowTop: a.ins.every(p=>Math.abs(p.y-a.y)<1),
          outNowBottom: a.outs.every(p=>Math.abs(p.y-(a.y+a.h))<1),
          midMoved: Math.abs((a.x+a.w/2)-(b.x+b.w/2)) + Math.abs((a.y+a.h/2)-(b.y+b.h/2))};})()`);
      report('turning one part swaps its width and height',
        one.rot === 90 && one.nowW === one.wasH && one.nowH === one.wasW, JSON.stringify(one));
      report('its inputs move from the left edge to the top',
        one.inWasLeft && one.inNowTop && one.outNowBottom, JSON.stringify(one));
      report('and it stays where it was, give or take the snap to the grid',
        one.midMoved <= 10, one.midMoved);
      report('turning a part changes nothing about what the circuit does',
        (await table()) === want, await table());

      /* four quarter turns is where you started */
      await ev(`(()=>{const L=LogicLab; L.rotateSelection(1); L.rotateSelection(1); L.rotateSelection(1); return 1;})()`);
      const back = await ev(`(LogicLab.S.work.nodes.find(x=>x.type==='XOR')||{}).rot`);
      report('four quarter turns is back to upright', back === 0, back);

      /* a block: a row of parts must come out as a column */
      const block = await ev(`(()=>{const L=LogicLab;
        const before=L.S.work.nodes.map(n=>{const g=L.geom(n);
          return {id:n.id, cx:g.x+g.w/2, cy:g.y+g.h/2};});
        const wide=Math.max(...before.map(b=>b.cx))-Math.min(...before.map(b=>b.cx));
        const tall=Math.max(...before.map(b=>b.cy))-Math.min(...before.map(b=>b.cy));
        L.S.sel.clear(); L.S.work.nodes.forEach(n=>L.S.sel.add(n.id));
        L.rotateSelection(1);
        const after=L.S.work.nodes.map(n=>{const g=L.geom(n);
          return {id:n.id, cx:g.x+g.w/2, cy:g.y+g.h/2};});
        const wide2=Math.max(...after.map(b=>b.cx))-Math.min(...after.map(b=>b.cx));
        const tall2=Math.max(...after.map(b=>b.cy))-Math.min(...after.map(b=>b.cy));
        return {wide:Math.round(wide), tall:Math.round(tall),
          wide2:Math.round(wide2), tall2:Math.round(tall2),
          turned: L.S.work.nodes.every(n=>n.rot===90)};})()`);
      report('turning a whole selection lays a wide arrangement out tall',
        block.turned && block.wide2 <= block.tall + 4 && block.tall2 >= block.wide - 4,
        JSON.stringify(block));
      report('and the circuit still does exactly what it did',
        (await table()) === want, await table());

      /* pin order comes from pin position, so that turn renumbered them —
         which silently rewires every copy of the chip, and must be said */
      const warned = await ev(`(()=>{const t=document.querySelector('#hint');
        return t && t.classList.contains('show') ? t.textContent : 'silent';})()`);
      report('turning a whole circuit warns that its pin numbering changed',
        /pin numbering/.test(warned), warned);

      /* it is one undo step, not one per part */
      await clickSel('#btn-undo');
      await wait(250);
      report('turning a group is a single undo',
        await ev(`LogicLab.S.work.nodes.every(n=>!n.rot)`));

      /* turning survives being packaged and reloaded */
      const kept = await ev(`(()=>{const L=LogicLab;
        const n=L.S.work.nodes[0]; L.S.sel.clear(); L.S.sel.add(n.id);
        L.rotateSelection(-1);
        const saved=JSON.parse(JSON.stringify(L.S.work));
        return saved.nodes[0].rot;})()`);
      report('a turn is part of the circuit, so it saves and loads with it', kept === 270, kept);
      await ev(`(()=>{const L=LogicLab; L.S.sel.clear(); L.S.undo=[]; L.S.redo=[]; return 1;})()`);
    }

    /* ---- the gates are drawn as their real schematic shapes ---- */
    {
      const syms = await ev(`(()=>{const L=LogicLab;
        const want=['AND','OR','NAND','NOR','XOR','XNOR','NOT','BUFFER'];
        const got=[...document.querySelectorAll('.pal-item')]
          .filter(b=>want.includes(b.textContent.trim()))
          .map(b=>b.textContent.trim()+':'+(b.querySelector('svg.symsw')?'sym':'square'));
        return got.join(' ');})()`);
      report('every gate in the palette shows its symbol next to its name',
        syms.split(' ').length === 8 && !/square/.test(syms), syms);
      const bubbles = await ev(`(()=>{
        const of=(n)=>{const b=[...document.querySelectorAll('.pal-item')]
          .find(x=>x.textContent.trim()===n); return b && !!b.querySelector('svg circle');};
        return ['NAND','NOR','XNOR','NOT'].every(of) && !['AND','OR','XOR','BUFFER'].some(of);})()`);
      report('and only the inverting ones carry the little circle', bubbles === true, bubbles);

      /* an AND and an OR must not draw the same picture */
      const shapes = await ev(`(()=>{const L=LogicLab;
        const pix=(type)=>{
          const c=document.createElement('canvas'); c.width=c.height=1;
          const b=L.builder('sym'); b.add(type, 0, 0);
          const g=L.geom(b.def.nodes[0]);
          return Math.round(g.w)+'x'+Math.round(g.h);
        };
        return pix('AND')===pix('OR');})()`);
      report('the symbol never changes the footprint of a gate, so nothing else moves',
        shapes === true, shapes);
    }

    /* ---- Use mode: a click works the circuit and cannot change it ---- */
    {
      /* a switch, a button and a gate, so every kind of click can be tried */
      await ev(`(()=>{const L=LogicLab;
        const b=L.builder('use me');
        const sw=b.pin('SW',60,60), btn=b.pin('BTN',60,180);
        btn.momentary=true;
        const g=b.add('OR',260,90), o=b.out('lit',460,100);
        b.w(sw,0,g,0); b.w(btn,0,g,1); b.w(g,0,o,0);
        L.S.work=b.def; L.S.dirty=true; L.S.sel.clear(); L.S.undo=[]; L.S.redo=[];
        L.fitView(); return 1;})()`);
      await wait(300);
      const shape = () => ev(`LogicLab.S.work.nodes.length + '/' + LogicLab.S.work.wires.length`);
      const at = (label) => ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
        const n=L.S.work.nodes.find(x=>x.label===${JSON.stringify(label)}); const g=L.geom(n);
        const s=L.toScreen(g.x+g.w/2,g.y+g.h/2); return {x:r.left+s.x, y:r.top+s.y};})()`);
      const val = (label) => ev(`(LogicLab.S.work.nodes.find(x=>x.label===${JSON.stringify(label)})||{}).value`);
      const before = await shape();

      await clickSel('#act-run');
      await wait(250);
      report('the Use button lights up and says what clicking now does',
        await ev(`document.querySelector('#act-run').classList.contains('on')
          && /Use mode/.test(document.querySelector('#status-tip').textContent)`));

      /* clicking a switch flips it */
      const swPt = await at('SW');
      await clickAt(swPt.x, swPt.y);
      await wait(200);
      report('in Use mode a click flips a switch', (await val('SW')) === 1, await val('SW'));
      await clickAt(swPt.x, swPt.y);
      await wait(200);
      report('and flips it back', (await val('SW')) === 0, await val('SW'));

      /* a momentary button is held down and springs back on release */
      const btnPt = await at('BTN');
      await mouse('mousePressed', btnPt.x, btnPt.y);
      const held = await val('BTN');
      await mouse('mouseReleased', btnPt.x, btnPt.y);
      await wait(200);
      report('a button is down while held and springs back after',
        held === 1 && (await val('BTN')) === 0, held + ' then ' + (await val('BTN')));

      /* you should not have to hit a switch exactly */
      const offBy = async (dx, dy) => {
        const q = await at('SW');
        await clickAt(q.x + dx, q.y + dy);
        await wait(200);
        const v = await val('SW');
        if (v) { await clickAt(q.x, q.y); await wait(200); }   // put it back
        return v;
      };
      report('a click near a switch still flips it', (await offBy(26, 18)) === 1);
      report('and one from the other side too', (await offBy(-24, -20)) === 1);
      report('but a click well away from everything does not',
        (await offBy(300, 240)) === 0);
      /* a gate standing near a pin must keep its own clicks */
      const orPick = await ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
        const n=L.S.work.nodes.find(x=>x.type==='OR'); const g=L.geom(n);
        const s=L.toScreen(g.x+g.w/2,g.y+g.h/2); return {x:r.left+s.x, y:r.top+s.y, id:n.id};})()`);
      await clickAt(orPick.x, orPick.y);
      await wait(220);
      report('landing squarely on a gate selects it rather than flipping a nearby pin',
        await ev(`(()=>{const L=LogicLab;
          return L.S.sel.has(${JSON.stringify(orPick.id)})
            && L.S.work.nodes.filter(n=>n.type==='IN').every(n=>!n.value);})()`));

      /* the left button must never slide the board out from under a switch */
      const camBefore2 = await ev(`JSON.stringify(LogicLab.S.cam)`);
      await mouse('mousePressed', swPt.x + 260, swPt.y + 200);
      await mouse('mouseMoved', swPt.x + 380, swPt.y + 280);
      await mouse('mouseReleased', swPt.x + 380, swPt.y + 280);
      await wait(250);
      report('a left-drag on empty space does not move the view in Use mode',
        (await ev(`JSON.stringify(LogicLab.S.cam)`)) === camBefore2);
      /* right-hold is what pans now — and must not delete on release */
      const shapeBeforePan = await shape();
      await mouse('mousePressed', swPt.x + 260, swPt.y + 200, { button: 'right', buttons: 2 });
      await mouse('mouseMoved', swPt.x + 340, swPt.y + 250, { button: 'right', buttons: 2 });
      await mouse('mouseReleased', swPt.x + 340, swPt.y + 250, { button: 'right', buttons: 0 });
      await wait(250);
      report('right-drag moves the view instead',
        (await ev(`JSON.stringify(LogicLab.S.cam)`)) !== camBefore2);
      await mouse('mousePressed', swPt.x + 300, swPt.y + 230, { button: 'right', buttons: 2 });
      await mouse('mouseReleased', swPt.x + 300, swPt.y + 230, { button: 'right', buttons: 0 });
      await wait(250);
      report('and a right-click deletes nothing in Use mode',
        (await shape()) === shapeBeforePan, (await shape()) + ' vs ' + shapeBeforePan);
      await ev(`(()=>{const L=LogicLab; L.fitView(); return 1;})()`);
      await wait(250);

      /* now the things it must refuse: dragging from a port, dragging a gate,
         and pressing Delete on a selection */
      const port = await ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
        const n=L.S.work.nodes.find(x=>x.type==='OR'); const g=L.geom(n);
        const s=L.toScreen(g.x+g.w, g.y+g.h/2); return {x:r.left+s.x, y:r.top+s.y};})()`);
      await mouse('mousePressed', port.x, port.y);
      await mouse('mouseMoved', port.x + 120, port.y + 60);
      await mouse('mouseReleased', port.x + 120, port.y + 60);
      await wait(250);
      report('dragging from a port draws no wire in Use mode',
        (await shape()) === before, (await shape()) + ' vs ' + before);

      const orPt = await ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
        const n=L.S.work.nodes.find(x=>x.type==='OR'); const g=L.geom(n);
        const s=L.toScreen(g.x+g.w/2,g.y+g.h/2); return {x:r.left+s.x, y:r.top+s.y, gx:n.x, gy:n.y};})()`);
      await mouse('mousePressed', orPt.x, orPt.y);
      await mouse('mouseMoved', orPt.x + 140, orPt.y + 90);
      await mouse('mouseReleased', orPt.x + 140, orPt.y + 90);
      await wait(250);
      const moved = await ev(`(()=>{const n=LogicLab.S.work.nodes.find(x=>x.type==='OR');
        return n.x + ',' + n.y;})()`);
      report('dragging a gate pans the view instead of moving it',
        moved === orPt.gx + ',' + orPt.gy, moved + ' vs ' + orPt.gx + ',' + orPt.gy);

      await ev(`(()=>{const L=LogicLab; const n=L.S.work.nodes.find(x=>x.type==='OR');
        L.S.sel.clear(); L.S.sel.add(n.id); return 1;})()`);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
      await wait(250);
      report('Delete does nothing in Use mode', (await shape()) === before, await shape());
      report('and there is no ✕ offering to delete the selection',
        !(await ev(`!!LogicLab.deleteHandle()`)));

      /* reaching for the palette is unambiguously an edit, so it switches back */
      await clickSel(`.pal-item[data-type="NOT"]`);
      await wait(300);
      report('clicking a part in the palette puts you back in Edit',
        await ev(`!LogicLab.S.play && document.querySelector('#act-edit').classList.contains('on')`));
      await ev(`LogicLab.S.armed=null`);
    }

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

    /* Use mode on the breadboard: buttons and DIP switches work, chips do not
       slide and jumpers cannot be laid */
    {
      await ev(`(()=>{const L=LogicLab; L.S.board=L.examples.BOARD_EXAMPLES[1].make();
        L.S.bundo=[]; L.S.bredo=[]; L.S.bdirty=true; L.S.bsel=null; L.fitView(); return 1;})()`);
      await wait(300);
      await clickSel('#act-run');
      await wait(250);
      const bShape = () => ev(`(()=>{const L=LogicLab;
        return L.S.board.parts.length + '/' + L.S.board.parts.map(p=>p.col).join(',');})()`);
      const bBefore = await bShape();
      const btn = await ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
        const p=L.S.board.parts.find(x=>x.k==='btn'); if(!p) return null;
        const s=L.toScreen(L.holeX(p.col+1), (L.holeY(4)+L.holeY(5))/2);
        return {x:r.left+s.x, y:r.top+s.y};})()`);
      /* a stretch of board with nothing on or near it, for the drag checks */
      const chipFree = await ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
        const far=Math.max(...L.S.board.parts.map(p=>p.col||0)) + 8;
        const s=L.toScreen(L.holeX(far), L.holeY(2));
        return {x:r.left+s.x, y:r.top+s.y};})()`);
      if (btn) {
        await mouse('mousePressed', btn.x, btn.y);
        const down = await ev(`(LogicLab.S.board.parts.find(x=>x.k==='btn')||{}).pressed`);
        await mouse('mouseReleased', btn.x, btn.y);
        await wait(200);
        const up = await ev(`(LogicLab.S.board.parts.find(x=>x.k==='btn')||{}).pressed`);
        report('a breadboard button still presses in Use mode', down === true && up === false,
          down + ' then ' + up);
        /* and you should not have to land on it exactly */
        await mouse('mousePressed', btn.x + 22, btn.y - 16);
        const nearDown = await ev(`(LogicLab.S.board.parts.find(x=>x.k==='btn')||{}).pressed`);
        await mouse('mouseReleased', btn.x + 22, btn.y - 16);
        await wait(200);
        report('a press near a breadboard button still works', nearDown === true, nearDown);
      }
      /* left-drag must not slide the board out from under a button */
      const bcamBefore = await ev(`JSON.stringify(LogicLab.S.bcam)`);
      await mouse('mousePressed', chipFree.x, chipFree.y);
      await mouse('mouseMoved', chipFree.x + 130, chipFree.y + 70);
      await mouse('mouseReleased', chipFree.x + 130, chipFree.y + 70);
      await wait(250);
      report('a left-drag on bare board does not move the view in Use mode',
        (await ev(`JSON.stringify(LogicLab.S.bcam)`)) === bcamBefore);
      await mouse('mousePressed', chipFree.x, chipFree.y, { button: 'right', buttons: 2 });
      await mouse('mouseMoved', chipFree.x + 90, chipFree.y + 50, { button: 'right', buttons: 2 });
      await mouse('mouseReleased', chipFree.x + 90, chipFree.y + 50, { button: 'right', buttons: 0 });
      await wait(250);
      report('right-drag moves the board view instead',
        (await ev(`JSON.stringify(LogicLab.S.bcam)`)) !== bcamBefore);
      const bkeep = await ev(`LogicLab.S.board.parts.length`);
      await mouse('mousePressed', chipFree.x + 45, chipFree.y + 25, { button: 'right', buttons: 2 });
      await mouse('mouseReleased', chipFree.x + 45, chipFree.y + 25, { button: 'right', buttons: 0 });
      await wait(250);
      report('and a right-click removes no board part in Use mode',
        (await ev(`LogicLab.S.board.parts.length`)) === bkeep);
      await ev(`(()=>{LogicLab.fitView(); return 1;})()`);
      await wait(250);
      const chip = await ev(`(()=>{const L=LogicLab, r=document.querySelector('#cv').getBoundingClientRect();
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
      await ev(`LogicLab.saveNow()`);
      await wait(200);
      await send('Page.reload');
      await wait(2200);
      report('the Edit / Use choice survives a reload',
        await ev(`(()=>{const L=window.LogicLab; return !!L && L.S.play
          && document.querySelector('#act-run').classList.contains('on');})()`));
      await ev(`LogicLab.setPlay(false)`);
      await wait(200);
    }
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
    /* save through the app's own path rather than waiting on a debounce timer
       that some earlier action happened to start */
    await ev(`LogicLab.saveNow()`);
    await wait(200);
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
      ['ram-inside', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         const x=document.querySelector('#modal-close'); if(x) x.click();
         document.querySelector('#mode-editor').click();
         const b=L.builder('ram'); const r=b.add('RAM', 0, 0, {abits:4,dbits:8,data:[]});
         L.S.work=b.def; L.S.dirty=true; L.S.sel.clear(); L.S.sel.add(r.id);
         L.renderInspector(); L.fitView();
         setTimeout(()=>{const c=document.querySelector('#inspector canvas.preview'); if(c) c.click();}, 250);
         return 1;})()`],
      ['drilldown', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         const x=document.querySelector('#modal-close'); if(x) x.click();
         document.querySelector('#mode-editor').click();
         const b=L.builder('drill'); const r=b.add('RAM',0,0,{abits:2,dbits:2,data:[]});
         L.S.work=b.def; L.S.dirty=true; L.S.sel.clear(); L.S.sel.add(r.id);
         L.renderInspector();
         setTimeout(()=>{
           document.querySelector('#inspector canvas.preview').click();
           setTimeout(()=>{
             const c=document.querySelector('#modal canvas.preview.big');
             const cam=c._cam, def=L.__diagDef;
             const n=def.nodes.find(z=>z.type==='DFF'); const g=L.geom(n);
             const rect=c.getBoundingClientRect();
             c.dispatchEvent(new MouseEvent('click',{bubbles:true,
               clientX:rect.left+(g.x+g.w/2)*cam.z+cam.x,
               clientY:rect.top+(g.y+g.h/2)*cam.z+cam.y}));
           }, 300);
         }, 200);
         return 1;})()`],
      ['simpler-whole-ram', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         const x=document.querySelector('#modal-close'); if(x) x.click();
         document.querySelector('#mode-editor').click();
         const b=L.builder('simpler'); const r=b.add('RAM',0,0,{abits:2,dbits:2,data:[]});
         L.S.work=b.def; L.S.dirty=true; L.S.sel.clear(); L.S.sel.add(r.id);
         L.renderInspector();
         setTimeout(()=>{
           document.querySelector('#inspector canvas.preview').click();
           setTimeout(()=>{
             const s=[...document.querySelectorAll('#modal footer .btn')]
               .find(z=>z.textContent.includes('Simpler'));
             if(s) s.click();
           }, 300);
         }, 200);
         return 1;})()`],
      ['open-up-flipflops', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         const x=document.querySelector('#modal-close'); if(x) x.click();
         document.querySelector('#mode-editor').click();
         const b=L.builder('open up'); const r=b.add('RAM',0,0,{abits:2,dbits:2,data:[]});
         L.S.work=b.def; L.S.dirty=true; L.S.sel.clear(); L.S.sel.add(r.id);
         L.renderInspector();
         setTimeout(()=>{
           document.querySelector('#inspector canvas.preview').click();
           setTimeout(()=>{
             const s=[...document.querySelectorAll('#modal .openups button')]
               .find(z=>z.textContent.startsWith('D FLIP-FLOP'));
             if(s) s.click();
             /* zoom onto the grid of cells, so the clumps of six NANDs that
                each used to be one flip-flop are legible */
             setTimeout(()=>{
               const t=L.__diagTrail().slice(-1)[0];
               t.cam={x:-1020, y:30, z:0.56};
               const c=document.querySelector('#modal canvas.preview.big');
               c.dispatchEvent(new WheelEvent('wheel',{deltaY:0,bubbles:true,cancelable:true,
                 clientX:c.getBoundingClientRect().left+400,
                 clientY:c.getBoundingClientRect().top+180}));
             }, 300);
           }, 300);
         }, 200);
         return 1;})()`],
      ['hex-decoder', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         const x=document.querySelector('#modal-close'); if(x) x.click();
         document.querySelector('#mode-editor').click(); L.setPlay(false);
         const b=L.builder('digit'); const h=b.add('HEX',0,0);
         L.S.work=b.def; L.S.dirty=true; L.S.sel.clear(); L.S.sel.add(h.id);
         L.renderInspector();
         setTimeout(()=>{const c=document.querySelector('#inspector canvas.preview');
           if(c) c.click();}, 250);
         return 1;})()`],
      ['named-modules', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         const x=document.querySelector('#modal-close'); if(x) x.click();
         document.querySelector('#mode-editor').click(); L.setPlay(false);
         const id=Object.keys(L.lib).find(k=>/full adder/i.test(L.lib[k].name)) || Object.keys(L.lib)[0];
         const b=L.builder('adder chain');
         const A=[0,1,2,3].map(i=>b.pin('A'+i, 0, 40+i*170));
         const B=[0,1,2,3].map(i=>b.pin('B'+i, 0, 100+i*170));
         const S2=[0,1,2,3].map(i=>b.out('S'+i, 640, 60+i*170));
         const ch=[0,1,2,3].map(i=>{const c=b.add('CHIP', 300, 30+i*170, {chip:id});
           c.tag='module '+i; return c;});
         ch.forEach((c,i)=>{ b.w(A[i],0,c,0); b.w(B[i],0,c,1); b.w(c,0,S2[i],0);
           if(i) b.w(ch[i-1],1,c,2); });
         L.S.work=b.def; L.S.dirty=true;
         L.S.sel.clear(); L.renderInspector(); L.fitView(); return 1;})()`],
      ['junctions', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         const x=document.querySelector('#modal-close'); if(x) x.click();
         document.querySelector('#mode-editor').click(); L.setPlay(false);
         const b=L.builder('tees');
         const src=b.pin('IN',0,200); src.value=1;
         const outs=[0,1,2].map(i=>b.out('Q'+i, 620, 60+i*140));
         b.w(src,0,outs[0],0);
         L.S.work=b.def; L.S.dirty=true;
         L.S.selWires.clear(); L.S.selWires.add(L.S.work.wires[0].id);
         L.addJointToSelection({x:200,y:210});
         const j1=L.S.work.nodes.find(n=>n.type==='JOINT');
         L.S.work.wires.push({id:'t1', a:{n:j1.id,s:'out',i:0}, b:{n:outs[1].id,s:'in',i:0}});
         L.S.work.wires.push({id:'t2', a:{n:j1.id,s:'out',i:0}, b:{n:outs[2].id,s:'in',i:0}});
         L.S.sel.clear(); L.S.selWires.clear(); L.S.dirty=true;
         L.renderInspector(); L.fitView(); return 1;})()`],
      ['lined-up', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         const x=document.querySelector('#modal-close'); if(x) x.click();
         document.querySelector('#mode-editor').click(); L.setPlay(false);
         L.S.work=L.examples.EDITOR_EXAMPLES[1].make().work; L.S.dirty=true;
         L.S.sel.clear(); L.straightenWires(null); L.fitView(); return 1;})()`],
      ['rotated', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         const x=document.querySelector('#modal-close'); if(x) x.click();
         document.querySelector('#mode-editor').click(); L.setPlay(false);
         const b=L.builder('turned');
         const kinds=['AND','OR','NAND','XOR','NOT','DFF'];
         const ns=kinds.map((k,i)=>b.add(k, 80+(i%3)*240, 60+((i/3)|0)*230));
         L.S.work=b.def; L.S.dirty=true;
         ns.forEach((n,i)=>{ L.S.sel.clear(); L.S.sel.add(n.id);
           for(let t=0;t<i%4;t++) L.rotateSelection(1); });
         L.S.sel.clear(); L.renderInspector(); L.fitView(); return 1;})()`],
      ['use-mode', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         const x=document.querySelector('#modal-close'); if(x) x.click();
         document.querySelector('#mode-board').click();
         L.S.board=L.examples.BOARD_EXAMPLES[5].make();
         L.S.board.parts.filter(p=>p.k==='btn').forEach(b=>{b.pressed=true;});
         L.S.bsel=null; L.S.bdirty=true; L.setPlay(true); L.fitView();
         L.S.bcam.z*=1.5; L.S.bcam.x=-30; L.S.bcam.y=-100; return 1;})()`],
      ['diagram-grown', `(()=>{const b=document.querySelector('#modal-grow');
         if(b) b.click(); return 1;})()`],
      ['ram-array-built', `(()=>{const L=LogicLab;
         const x=document.querySelector('#modal-close'); if(x) x.click();
         const b=L.builder('array'); L.S.work=b.def;
         L.S.work.nodes.push(...L.ramArray(3,4).nodes);
         L.S.work.wires.push(...L.ramArray(3,4).wires);
         L.S.work = L.ramArray(3,4);
         L.S.dirty=true; L.S.sel.clear(); L.renderInspector(); L.fitView();
         return 1;})()`],
      ['stored-program', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         const x=document.querySelector('#modal-close'); if(x) x.click();
         document.querySelector('#mode-editor').click();
         L.S.work=L.examples.EDITOR_EXAMPLES[8].make().work; L.S.dirty=true;
         const rom=L.S.work.nodes.find(n=>n.type==='ROM');
         L.S.sel.clear(); L.S.sel.add(rom.id); L.renderInspector(); L.fitView();
         return 1;})()`],
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
         const x=document.querySelector('#modal-close'); if(x) x.click();
         document.querySelector('#mode-board').click();
         L.S.board=L.examples.BOARD_EXAMPLES[5].make();
         L.S.board.parts.filter(p=>p.k==='btn').forEach(b=>{b.pressed=true;});
         L.S.bsel=L.S.board.parts.find(p=>p.k==='npn').id;
         L.S.bdirty=true; L.renderInspector(); L.fitView();
         L.S.bcam.z*=1.7; L.S.bcam.x=-40; L.S.bcam.y=-120; return 1;})()`],
      ['two-boards', `(()=>{const L=LogicLab; document.documentElement.dataset.theme='dark';
         const x=document.querySelector('#modal-close'); if(x) x.click();
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
         document.querySelector('#modal-close').click();
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
