/* CircuitSim: a small SPICE-style circuit engine for the browser.

   The same method as modern-bioelectricity/hw2-debug/sim/sim.py, made general:

   * Modified nodal analysis.  Unknowns are node voltages, plus one current for
     every voltage source and inductor, plus one internal node per op amp.
   * Static (resistive) part F(x) and its Jacobian J(x) are stamped by every
     element; nonlinear elements (diode, BJT, MOSFET, op-amp clamp) are solved
     with damped Newton-Raphson (no voltage moves more than VSTEP per iteration).
   * Reactive part is a constant matrix Cm (capacitors, inductors, op-amp pole):
     q = Cm x.  Transient: backward Euler or trapezoidal on dq/dt.
     AC: Y = J(x_op) + j w Cm.  Noise: adjoint solve of Y^T y = e_out.
   * DC operating point: Newton, then gmin stepping, then source stepping.
   * Dense LU with partial pivoting: fine up to roughly 100 unknowns.

   Two ways to build a circuit:
     var c = new CircuitSim.Circuit();             // programmatic
     c.add('R', 'R1', ['in', 'out'], {value: 1e3});
     var doc = CircuitSim.parseDoc(text);          // from a schematic document
     var built = CircuitSim.buildFromDoc(doc);     // -> {circuit, ...}
   Then
     var s = new CircuitSim.Sim(circuit);
     s.op(); s.v('out'); s.step(1e-5); s.ac(1e3); s.noise('out', '0', freqs);

   No dependencies.  Values use SPICE suffixes: f p n u m k meg g t (m = milli).
*/
(function (global) {
  'use strict';

  var VT = 0.025852;                    // kT/q at 300 K
  var KT = 1.380649e-23 * 300;          // J
  var QE = 1.602176634e-19;             // C
  var GMIN = 1e-12;                     // S, every node to ground
  var EXPLIM = 40;                      // exp() continues linearly above this argument
  var VSTEP = 0.5;                      // V, Newton step limit for nonlinear circuits

  /* ================= numbers ================= */
  var SI = {t: 1e12, g: 1e9, meg: 1e6, k: 1e3, m: 1e-3, u: 1e-6, 'µ': 1e-6, n: 1e-9, p: 1e-12, f: 1e-15};
  function num(s) {
    if (typeof s === 'number') return s;
    var m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(meg|[tgkmuµnpf])?/i.exec(String(s));
    if (!m) return NaN;
    var v = parseFloat(m[1]);
    if (m[2]) v *= SI[m[2].toLowerCase()];
    return v;
  }
  var PREFIX = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']];
  function fmt(v, unit, digits) {
    unit = unit || ''; digits = digits || 3;
    if (v === 0) return '0 ' + unit;
    if (!isFinite(v)) return '—';
    var a = Math.abs(v);
    for (var i = 0; i < PREFIX.length; i++) {
      if (a >= PREFIX[i][0] * 0.99995) {
        var s = (v / PREFIX[i][0]).toPrecision(digits);
        if (s.indexOf('e') < 0 && s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
        return s + ' ' + PREFIX[i][1] + unit;
      }
    }
    return v.toExponential(2) + ' ' + unit;
  }
  /* SPICE-style text for export: 4.99k, 1meg, 4.7n */
  function spiceNum(v) {
    if (v === 0) return '0';
    var a = Math.abs(v), tab = [[1e12, 't'], [1e9, 'g'], [1e6, 'meg'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'u'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']];
    for (var i = 0; i < tab.length; i++) if (a >= tab[i][0] * 0.99995) return +(v / tab[i][0]).toPrecision(6) + tab[i][1];
    return String(v);
  }

  /* ================= waveforms ================= */
  /* "PULSE(v1 v2 td tr tf pw per)", "SIN(vo va f td theta phase)", "PWL(t1 v1 t2 v2 ...)", or a number */
  function makeWave(spec) {
    if (spec === undefined || spec === null || spec === '') return {dc: 0, at: function () { return 0; }, text: '0'};
    if (typeof spec === 'number') return constWave(spec);
    var m = /^\s*(PULSE|SIN|PWL|SQUARE)\s*\(([^)]*)\)\s*$/i.exec(spec);
    if (!m) { var v = num(spec); return constWave(isNaN(v) ? 0 : v); }
    var kind = m[1].toUpperCase(), a = m[2].trim().split(/[\s,]+/).map(num);
    var w;
    if (kind === 'SIN') {
      var vo = a[0] || 0, va = a[1] || 0, f = a[2] || 0, td = a[3] || 0, th = a[4] || 0, ph = (a[5] || 0) * Math.PI / 180;
      w = function (t) {
        if (t < td) return vo + va * Math.sin(ph);
        var tt = t - td;
        return vo + va * Math.exp(-tt * th) * Math.sin(2 * Math.PI * f * tt + ph);
      };
      return {dc: vo, at: w, kind: kind, args: a, text: spec, freq: f, amp: va};
    }
    if (kind === 'PULSE' || kind === 'SQUARE') {
      if (kind === 'SQUARE') {                        // SQUARE(lo hi f): 50 % duty, fast edges
        var per0 = 1 / (a[2] || 1);
        a = [a[0] || 0, a[1] || 0, 0, per0 * 1e-4, per0 * 1e-4, per0 / 2 - per0 * 1e-4, per0];
      }
      var v1 = a[0] || 0, v2 = a[1] || 0, d = a[2] || 0, tr = a[3] || 1e-9, tf = a[4] || 1e-9, pw = a[5] === undefined ? Infinity : a[5], per = a[6] || Infinity;
      w = function (t) {
        if (t < d) return v1;
        var tt = (t - d) % per;
        if (tt < tr) return v1 + (v2 - v1) * tt / tr;
        if (tt < tr + pw) return v2;
        if (tt < tr + pw + tf) return v2 + (v1 - v2) * (tt - tr - pw) / tf;
        return v1;
      };
      return {dc: v1, at: w, kind: 'PULSE', args: a, text: spec, freq: isFinite(per) ? 1 / per : 0, amp: (v2 - v1) / 2};
    }
    /* PWL */
    w = function (t) {
      if (a.length < 2) return 0;
      if (t <= a[0]) return a[1];
      for (var i = 2; i < a.length; i += 2) {
        if (t <= a[i]) return a[i - 1] + (a[i + 1] - a[i - 1]) * (t - a[i - 2]) / (a[i] - a[i - 2]);
      }
      return a[a.length - 1];
    };
    return {dc: a[1] || 0, at: w, kind: 'PWL', args: a, text: spec};
  }
  function constWave(v) { return {dc: v, at: function () { return v; }, kind: 'DC', text: String(v)}; }

  /* ================= math helpers ================= */
  function lexp(x) {                                 // exp and derivative, linear above EXPLIM
    if (x > EXPLIM) { var e = Math.exp(EXPLIM); return [e * (1 + x - EXPLIM), e]; }
    var e2 = Math.exp(x); return [e2, e2];
  }
  function softplus(u, s) {                          // s*ln(1+e^(u/s)) and its slope
    var z = u / s;
    if (z > 30) return [u, 1];
    if (z < -30) return [s * Math.exp(z), Math.exp(z)];
    var e = Math.exp(z);
    return [s * Math.log1p(e), e / (1 + e)];
  }

  /* LU solve, partial pivoting, in place.  A is n*n (row major), b length n.  Returns false if singular. */
  function solveReal(A, b, n) {
    for (var c = 0; c < n; c++) {
      var p = c, best = Math.abs(A[c * n + c]);
      for (var r = c + 1; r < n; r++) { var v = Math.abs(A[r * n + c]); if (v > best) { best = v; p = r; } }
      if (best < 1e-300) return false;
      if (p !== c) {
        for (var k = c; k < n; k++) { var t = A[c * n + k]; A[c * n + k] = A[p * n + k]; A[p * n + k] = t; }
        var tb = b[c]; b[c] = b[p]; b[p] = tb;
      }
      var pv = A[c * n + c];
      for (r = c + 1; r < n; r++) {
        var f = A[r * n + c] / pv;
        if (f === 0) continue;
        for (k = c + 1; k < n; k++) A[r * n + k] -= f * A[c * n + k];
        b[r] -= f * b[c];
      }
    }
    for (r = n - 1; r >= 0; r--) {
      var s = b[r];
      for (k = r + 1; k < n; k++) s -= A[r * n + k] * b[k];
      b[r] = s / A[r * n + r];
    }
    return true;
  }
  /* complex version: (Ar + j Ai) x = (br + j bi) */
  function solveComplex(Ar, Ai, br, bi, n) {
    for (var c = 0; c < n; c++) {
      var p = c, best = Ar[c * n + c] * Ar[c * n + c] + Ai[c * n + c] * Ai[c * n + c];
      for (var r = c + 1; r < n; r++) {
        var v = Ar[r * n + c] * Ar[r * n + c] + Ai[r * n + c] * Ai[r * n + c];
        if (v > best) { best = v; p = r; }
      }
      if (best < 1e-300) return false;
      if (p !== c) {
        for (var k = c; k < n; k++) {
          var t = Ar[c * n + k]; Ar[c * n + k] = Ar[p * n + k]; Ar[p * n + k] = t;
          t = Ai[c * n + k]; Ai[c * n + k] = Ai[p * n + k]; Ai[p * n + k] = t;
        }
        t = br[c]; br[c] = br[p]; br[p] = t; t = bi[c]; bi[c] = bi[p]; bi[p] = t;
      }
      var pr = Ar[c * n + c], pi = Ai[c * n + c], pd = pr * pr + pi * pi;
      for (r = c + 1; r < n; r++) {
        var ar = Ar[r * n + c], ai = Ai[r * n + c];
        if (ar === 0 && ai === 0) continue;
        var fr = (ar * pr + ai * pi) / pd, fi = (ai * pr - ar * pi) / pd;     // f = a / p
        for (k = c + 1; k < n; k++) {
          var cr = Ar[c * n + k], ci = Ai[c * n + k];
          Ar[r * n + k] -= fr * cr - fi * ci; Ai[r * n + k] -= fr * ci + fi * cr;
        }
        var bcr = br[c], bci = bi[c];
        br[r] -= fr * bcr - fi * bci; bi[r] -= fr * bci + fi * bcr;
      }
    }
    for (r = n - 1; r >= 0; r--) {
      var sr = br[r], si = bi[r];
      for (k = r + 1; k < n; k++) {
        var mr = Ar[r * n + k], mi = Ai[r * n + k];
        sr -= mr * br[k] - mi * bi[k]; si -= mr * bi[k] + mi * br[k];
      }
      var dr = Ar[r * n + r], di = Ai[r * n + r], dd = dr * dr + di * di;
      br[r] = (sr * dr + si * di) / dd; bi[r] = (si * dr - sr * di) / dd;
    }
    return true;
  }

  /* ================= circuit ================= */
  var TYPES = {
    R: {pins: 2}, C: {pins: 2}, L: {pins: 2, br: 1}, V: {pins: 2, br: 1}, I: {pins: 2},
    D: {pins: 2}, SW: {pins: 2}, Q: {pins: 3}, M: {pins: 3}, U: {pins: 3, xi: 1}
  };

  function Circuit() {
    this.elements = [];
    this.byName = {};
    this.nodeNames = ['0'];
    this.nodeIdx = {'0': 0, gnd: 0, GND: 0};
  }
  Circuit.prototype.node = function (name) {
    name = String(name);
    if (this.nodeIdx[name] === undefined) { this.nodeIdx[name] = this.nodeNames.length; this.nodeNames.push(name); }
    return this.nodeIdx[name];
  };
  /* add('R','R1',['a','b'],{value:1e3}) ; Q: nodes [c,b,e], p.type 'npn'|'pnp' ; M: [d,g,s] ; U: [in+, in-, out] */
  Circuit.prototype.add = function (type, name, nodes, p) {
    var T = TYPES[type];
    if (!T) throw new Error('unknown element type ' + type);
    if (nodes.length !== T.pins) throw new Error(name + ': needs ' + T.pins + ' nodes');
    if (this.byName[name]) throw new Error('duplicate element name ' + name);
    var self = this;
    var el = {type: type, name: name, nodes: nodes.map(function (n) { return self.node(n); }), p: normParams(type, p || {})};
    this.elements.push(el); this.byName[name] = el;
    return el;
  };
  Circuit.prototype.R = function (n, a, b, v) { return this.add('R', n, [a, b], {value: v}); };
  Circuit.prototype.C = function (n, a, b, v) { return this.add('C', n, [a, b], {value: v}); };
  Circuit.prototype.L = function (n, a, b, v) { return this.add('L', n, [a, b], {value: v}); };
  Circuit.prototype.V = function (n, a, b, p) { return this.add('V', n, [a, b], typeof p === 'object' ? p : {wave: p}); };
  Circuit.prototype.I = function (n, a, b, p) { return this.add('I', n, [a, b], typeof p === 'object' ? p : {wave: p}); };
  Circuit.prototype.U = function (n, ip, im, o, p) { return this.add('U', n, [ip, im, o], p); };

  var DEFAULTS = {
    D: {IS: 2.52e-9, N: 1.752, BV: 0, CJ: 4e-12},                        // 1N4148-like
    Q: {type: 'npn', IS: 6.7e-15, BF: 200, BR: 0.74, CJE: 4.5e-12, CJC: 3.6e-12},   // 2N3904-like
    M: {type: 'nmos', KP: 2e-3, VT: 1, LAMBDA: 0.01},
    U: {A0: 1e5, GBW: 1e6, VMAX: 12, VMIN: -12, ROUT: 10, ILIM: 0, VOS: 0, EN: 0, FC: 0, IN: 0},
    SW: {on: true, RON: 0.05, ROFF: 1e12}
  };
  function normParams(type, p) {
    var out = {}, d = DEFAULTS[type] || {}, k;
    for (k in d) out[k] = d[k];
    for (k in p) out[k] = p[k];
    if (type === 'Q' && out.type === 'pnp' && p.IS === undefined) { out.IS = 1e-14; }
    if (type === 'Q' && out.type === 'pnp' && p.BF === undefined) { out.BF = 150; }
    if (type === 'Q' && out.type === 'pnp' && p.BR === undefined) { out.BR = 4; }
    if (type === 'Q' && out.type === 'pnp' && p.CJE === undefined) { out.CJE = 8e-12; }
    if (type === 'Q' && out.type === 'pnp' && p.CJC === undefined) { out.CJC = 8e-12; }
    if (type === 'V' || type === 'I') {
      out.w = makeWave(out.wave !== undefined ? out.wave : (out.dc !== undefined ? out.dc : out.value));
      if (out.ac === undefined) out.ac = 0;
      if (out.acph === undefined) out.acph = 0;
      if (out.NOISE === undefined) out.NOISE = 0;
      if (out.VC === undefined) out.VC = 0;
    }
    ['value', 'IS', 'N', 'BV', 'BF', 'BR', 'CJ', 'CJE', 'CJC', 'KP', 'VT', 'LAMBDA', 'A0', 'GBW', 'VMAX', 'VMIN', 'ROUT', 'ILIM', 'VOS', 'EN', 'FC', 'IN',
      'RON', 'ROFF', 'ac', 'acph', 'NOISE', 'VC'].forEach(function (key) {
      if (typeof out[key] === 'string') out[key] = num(out[key]);
    });
    if (typeof out.on === 'string') out.on = !/^(off|0|false|open)$/i.test(out.on);
    return out;
  }

  /* ================= simulator ================= */
  function Sim(circuit, opts) {
    opts = opts || {};
    this.c = circuit;
    this.method = opts.method || 'be';
    this.temp = 300;
    this.setup();
  }

  Sim.prototype.setup = function () {
    var c = this.c, nn = c.nodeNames.length - 1, k = nn;
    this.nNodes = nn;
    this.linear = true;
    for (var i = 0; i < c.elements.length; i++) {
      var el = c.elements[i], T = TYPES[el.type];
      el.u = el.nodes.map(function (n) { return n - 1; });        // unknown index, -1 = ground
      el.br = T.br ? k++ : -1;
      el.xi = T.xi ? k++ : -1;
      if (el.type === 'D' || el.type === 'Q' || el.type === 'M' || el.type === 'U' ||
          (el.type === 'I' && el.p.VC)) this.linear = false;
    }
    this.n = k;
    this.x = new Float64Array(k);
    this.xprev = new Float64Array(k);
    this.qprev = new Float64Array(k);
    this.iq = new Float64Array(k);
    this.F = new Float64Array(k);
    this.J = new Float64Array(k * k);
    this.A = new Float64Array(k * k);
    this.dx = new Float64Array(k);
    this.t = 0;
    this.dt = 0;
    this.restart = true;
    this.buildCm();
  };

  Sim.prototype.buildCm = function () {
    var n = this.n, Cm = this.Cm = new Float64Array(n * n), els = this.c.elements;
    function g(a, b, v) {
      if (a >= 0) Cm[a * n + a] += v;
      if (b >= 0) Cm[b * n + b] += v;
      if (a >= 0 && b >= 0) { Cm[a * n + b] -= v; Cm[b * n + a] -= v; }
    }
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.type === 'C') g(el.u[0], el.u[1], el.p.value);
      else if (el.type === 'D' && el.p.CJ) g(el.u[0], el.u[1], el.p.CJ);       // constant junction capacitance
      else if (el.type === 'Q') {                                           // constant B-E and B-C capacitances
        if (el.p.CJE) g(el.u[1], el.u[2], el.p.CJE);
        if (el.p.CJC) g(el.u[1], el.u[0], el.p.CJC);
      }
      else if (el.type === 'L') Cm[el.br * n + el.br] -= el.p.value;   // branch row: va - vb - d(L i)/dt = 0
      else if (el.type === 'U') Cm[el.xi * n + el.xi] += opampCx(el.p);
    }
    this.dirty = false;
  };

  function opampGm() { return 1e-3; }
  function opampCx(p) { return opampGm() / (2 * Math.PI * Math.max(p.GBW, 1)); }

  /* set a parameter on an element (value, on, wave, ...) */
  Sim.prototype.set = function (name, key, val) {
    var el = this.c.byName[name];
    if (!el) return;
    if (key === 'wave') { el.p.wave = val; el.p.w = makeWave(val); }
    else if (key === 'on') el.p.on = !!val;
    else if (key === 'type') el.p.type = val;
    else el.p[key] = typeof val === 'string' ? num(val) : val;
    if (el.type === 'C' || el.type === 'L' || /^(GBW|CJ|CJE|CJC)$/.test(key)) this.buildCm();
    this.restart = true;
    this._JopValid = false;
  };
  Sim.prototype.get = function (name) { return this.c.byName[name]; };

  /* ---------------- stamping ---------------- */
  Sim.prototype.load = function (x, t, dc, scale, gmin) {
    var n = this.n, F = this.F, J = this.J, els = this.c.elements, nn = this.nNodes;
    F.fill(0); J.fill(0);
    function V(i) { return i < 0 ? 0 : x[i]; }
    function aJ(i, j, v) { if (i >= 0 && j >= 0) J[i * n + j] += v; }
    function aF(i, v) { if (i >= 0) F[i] += v; }
    function G(a, b, g) {
      var cur = g * (V(a) - V(b));
      aF(a, cur); aF(b, -cur);
      aJ(a, a, g); aJ(a, b, -g); aJ(b, a, -g); aJ(b, b, g);
    }
    for (var i = 0; i < nn; i++) { F[i] += gmin * x[i]; J[i * n + i] += gmin; }
    for (var e = 0; e < els.length; e++) {
      var el = els[e], p = el.p, u = el.u, a = u[0], b = u[1];
      switch (el.type) {
        case 'R': G(a, b, 1 / p.value); break;
        case 'SW': G(a, b, 1 / (p.on ? p.RON : p.ROFF)); break;
        case 'C': break;
        case 'L': {
          var k = el.br;
          aF(a, x[k]); aF(b, -x[k]); aJ(a, k, 1); aJ(b, k, -1);
          F[k] += V(a) - V(b); aJ(k, a, 1); aJ(k, b, -1);
          break;
        }
        case 'V': {
          var kb = el.br, val = (dc ? p.w.dc : p.w.at(t)) * scale;
          aF(a, x[kb]); aF(b, -x[kb]); aJ(a, kb, 1); aJ(b, kb, -1);
          F[kb] += V(a) - V(b) - val; aJ(kb, a, 1); aJ(kb, b, -1);
          break;
        }
        case 'I': {
          var iv = (dc ? p.w.dc : p.w.at(t)) * scale;
          if (p.VC) {                                   // compliance: fades out as v(n+) - v(n-) -> 0
            var uu = V(a) - V(b), gg, di;
            if (uu >= 0) { var ex = Math.exp(-uu / p.VC); gg = 1 - ex; di = ex / p.VC; }
            else { gg = uu / p.VC; di = 1 / p.VC; }
            var ii = iv * gg, gd = iv * di;
            aF(a, ii); aF(b, -ii);
            aJ(a, a, gd); aJ(a, b, -gd); aJ(b, a, -gd); aJ(b, b, gd);
          } else { aF(a, iv); aF(b, -iv); }
          break;
        }
        case 'D': {
          var vd = V(a) - V(b), nvt = p.N * VT, ef = lexp(vd / nvt);
          var id = p.IS * (ef[0] - 1), gdd = p.IS * ef[1] / nvt;
          if (p.BV > 0) { var eb = lexp(-(vd + p.BV) / nvt); id -= p.IS * eb[0]; gdd += p.IS * eb[1] / nvt; }
          aF(a, id); aF(b, -id);
          aJ(a, a, gdd); aJ(a, b, -gdd); aJ(b, a, -gdd); aJ(b, b, gdd);
          break;
        }
        case 'Q': {
          var r = bjt(p.type, V(u[0]), V(u[1]), V(u[2]), p);
          for (var tt = 0; tt < 3; tt++) {
            var row = u[tt];
            if (row < 0) continue;
            F[row] += r.i[tt];
            for (var s = 0; s < 3; s++) aJ(row, u[s], r.d[tt * 3 + s]);
          }
          break;
        }
        case 'M': {
          var m = mosfet(p, V(u[0]), V(u[1]), V(u[2]));
          // m.id flows into drain, out of source; partials wrt (vd, vg, vs)
          aF(u[0], m.id); aF(u[2], -m.id);
          for (var q = 0; q < 3; q++) { aJ(u[0], u[q], m.d[q]); aJ(u[2], u[q], -m.d[q]); }
          break;
        }
        case 'U': {
          var xi = el.xi, gm = opampGm(), A0 = Math.max(p.A0, 1), gx = gm / A0, gc = 1e3 * gm, sc = 0.01;
          var vhi = p.VMAX, vlo = p.VMIN, vmid = (vhi + vlo) / 2, xv = x[xi];
          var vdiff = V(u[0]) - V(u[1]) + p.VOS;
          var s1 = softplus(xv - vhi, sc), s2 = softplus(vlo - xv, sc);
          F[xi] += -gm * vdiff + gx * (xv - vmid) + gc * (s1[0] - s2[0]);
          aJ(xi, u[0], -gm); aJ(xi, u[1], gm);
          J[xi * n + xi] += gx + gc * (s1[1] + s2[1]);
          var o = u[2], vo = V(o), ro = Math.max(p.ROUT, 1e-3);
          if (p.ILIM > 0) {
            var z = (xv - vo) / (ro * p.ILIM), th = Math.tanh(z), go = (1 - th * th) / ro, io = p.ILIM * th;
            aF(o, -io); aJ(o, o, go); aJ(o, xi, -go);
          } else {
            aF(o, (vo - xv) / ro); aJ(o, o, 1 / ro); aJ(o, xi, -1 / ro);
          }
          break;
        }
      }
    }
  };

  /* Ebers-Moll transport model: currents INTO (C,B,E) and Jacobian rows (same as sim.py) */
  var BJT_OUT = {i: [0, 0, 0], d: [0, 0, 0, 0, 0, 0, 0, 0, 0]};
  function bjt(kind, vc, vb, ve, p) {
    var i = BJT_OUT.i, d = BJT_OUT.d, k = 1 + 1 / p.BR, ef, er, If, Ir, gf, gr;
    if (kind === 'npn') {
      ef = lexp((vb - ve) / VT); er = lexp((vb - vc) / VT);
      If = p.IS * (ef[0] - 1); gf = p.IS * ef[1] / VT;
      Ir = p.IS * (er[0] - 1); gr = p.IS * er[1] / VT;
      i[0] = If - Ir * k; i[1] = If / p.BF + Ir / p.BR;
      d[0] = gr * k; d[1] = gf - gr * k; d[2] = -gf;
      d[3] = -gr / p.BR; d[4] = gf / p.BF + gr / p.BR; d[5] = -gf / p.BF;
    } else {
      ef = lexp((ve - vb) / VT); er = lexp((vc - vb) / VT);
      If = p.IS * (ef[0] - 1); gf = p.IS * ef[1] / VT;
      Ir = p.IS * (er[0] - 1); gr = p.IS * er[1] / VT;
      i[0] = -(If - Ir * k); i[1] = -(If / p.BF + Ir / p.BR);
      d[0] = gr * k; d[1] = gf - gr * k; d[2] = -gf;
      d[3] = -gr / p.BR; d[4] = gf / p.BF + gr / p.BR; d[5] = -gf / p.BF;
    }
    i[2] = -i[0] - i[1];
    d[6] = -(d[0] + d[3]); d[7] = -(d[1] + d[4]); d[8] = -(d[2] + d[5]);
    return BJT_OUT;
  }

  /* Level-1 MOSFET with a smooth turn-on (softplus overdrive), symmetric in drain/source */
  function mosfet(p, vd, vg, vs) {
    var sgn = p.type === 'pmos' ? -1 : 1;
    vd *= sgn; vg *= sgn; vs *= sgn;
    var swap = vd < vs;
    var D = swap ? vs : vd, S = swap ? vd : vs;
    var vgs = vg - S, vds = D - S;
    var sp = softplus(vgs - p.VT, 0.02), vov = sp[0], sg = sp[1], lam = 1 + p.LAMBDA * vds;
    var id, dgs, dds;
    if (vds < vov) {
      var core = vov * vds - vds * vds / 2;
      id = p.KP * core * lam;
      dgs = p.KP * vds * sg * lam;
      dds = p.KP * (vov - vds) * lam + p.KP * core * p.LAMBDA;
    } else {
      id = p.KP / 2 * vov * vov * lam;
      dgs = p.KP * vov * sg * lam;
      dds = p.KP / 2 * vov * vov * p.LAMBDA;
    }
    // partials of id (into D, in scaled frame) wrt (vD, vg, vS)
    var dD = dds, dG = dgs, dS = -dgs - dds;
    var out;
    if (!swap) out = {id: id, d: [dD, dG, dS]};
    else out = {id: -id, d: [-dS, -dG, -dD]};   // current into the real drain is -id; real drain = scaled S
    // undo the PMOS sign: id -> sgn*id, d/dv -> d (sgn^2 = 1)
    out.id *= sgn;
    out.gm = dgs;
    return out;
  }

  /* ---------------- Newton ---------------- */
  /* mode: {dc:true} or {dc:false, t, a, b}  (a,b: integrator coefficients) */
  Sim.prototype.newton = function (mode, maxit, scale, gmin) {
    var n = this.n, x = this.x, F = this.F, J = this.J, A = this.A, dx = this.dx, Cm = this.Cm;
    var nv = this.nNodes, lim = this.linear ? Infinity : VSTEP;
    scale = scale === undefined ? 1 : scale; gmin = gmin === undefined ? GMIN : gmin;
    for (var it = 0; it < maxit; it++) {
      this.load(x, mode.t || 0, !!mode.dc, scale, gmin);
      if (!mode.dc) {
        var ac = mode.a, qp = this.qprev, iqp = this.iq;
        for (var r = 0; r < n; r++) {
          var q = 0, row = r * n;
          for (var c = 0; c < n; c++) { var cv = Cm[row + c]; if (cv !== 0) { q += cv * x[c]; J[row + c] += ac * cv; } }
          F[r] += ac * (q - qp[r]) - mode.b * iqp[r];
        }
      }
      A.set(J);
      for (var i = 0; i < n; i++) dx[i] = -F[i];
      if (!solveReal(A, dx, n)) { this.failInfo = {reason: 'singular', it: it}; return false; }
      var mxv = 0, mxi = 0;
      for (i = 0; i < n; i++) {
        var ad = Math.abs(dx[i]);
        if (i < nv || this.isInternal(i)) { if (ad > mxv) mxv = ad; } else if (ad > mxi) mxi = ad;
      }
      var s = mxv > lim ? lim / mxv : 1;
      var conv = true;
      for (i = 0; i < n; i++) {
        x[i] += s * dx[i];
        var tol = (i < nv || this.isInternal(i)) ? 1e-6 + 1e-6 * Math.abs(x[i]) : 1e-12 + 1e-6 * Math.abs(x[i]);
        if (Math.abs(dx[i]) > tol) conv = false;
      }
      if (s === 1 && (conv || this.linear)) { this.lastIters = it + 1; return true; }
    }
    this.lastIters = maxit;
    this.failInfo = {reason: 'maxit', dx: Array.from(dx), x: Array.from(x)};
    return false;
  };
  Sim.prototype.isInternal = function (i) {
    if (!this._internal) {
      var set = {}, els = this.c.elements;
      for (var k = 0; k < els.length; k++) if (els[k].xi >= 0) set[els[k].xi] = true;
      this._internal = set;
    }
    return !!this._internal[i];
  };

  /* DC operating point.  guess: {node: volts} */
  Sim.prototype.op = function (guess) {
    var x = this.x, self = this;
    x.fill(0);
    if (guess) for (var nm in guess) { var id = this.c.nodeIdx[nm]; if (id > 0) x[id - 1] = guess[nm]; }
    var start = Float64Array.from(x), how = 'newton';
    var ok = this.newton({dc: true}, 200);
    if (!ok) {                                        // gmin stepping
      how = 'gmin'; x.set(start);
      for (var g = 1e-3; g > GMIN * 1.01; g /= 10) this.newton({dc: true}, 100, 1, g);
      ok = this.newton({dc: true}, 200);
    }
    if (!ok) {                                        // source stepping
      how = 'source'; x.fill(0);
      var sc = 0, step = 0.1;
      while (sc < 1) {
        var next = Math.min(1, sc + step), save = Float64Array.from(x);
        if (this.newton({dc: true}, 100, next, 1e-9)) { sc = next; step = Math.min(step * 1.5, 0.2); }
        else { x.set(save); step /= 2; if (step < 1e-4) break; }
      }
      ok = sc >= 1 && this.newton({dc: true}, 200);
    }
    this.afterDC();
    return {ok: ok, method: how, iters: this.lastIters};
  };
  Sim.prototype.afterDC = function () {
    this._JopValid = false;
    this.xprev.set(this.x);
    this.iq.fill(0);
    this.restart = true;
    this.t = 0;
  };
  /* start a transient from all-zero state ("power on") */
  Sim.prototype.powerOn = function () { this.x.fill(0); this.afterDC(); };

  /* one transient step of dt; falls back to sub-steps (backward Euler) when Newton fails */
  Sim.prototype.step = function (dt) {
    if (this.dirty) this.buildCm();
    this._JopValid = false;
    if (this._step(dt, this.restart || this.method === 'be' ? 'be' : 'trap', 60)) {
      this.t += dt; this.restart = false; this.substeps = 0;
      return true;
    }
    /* Newton failed (typically a fast regenerative switch inside one step): cut the step with
       backward Euler, grow it again after each success, like SPICE's time-step control */
    var left = dt, h = dt / 8, hmin = Math.min(dt * 1e-9, 1e-14), ok = true, n = 0;
    while (left > dt * 1e-12 && n++ < 20000) {
      if (h > left) h = left;
      if (this._step(h, 'be', 60)) { this.t += h; left -= h; h *= 2; }
      else if ((h /= 4) < hmin) { ok = false; this.t += left; break; }
    }
    this.substeps = n;
    this.restart = true;               // the trapezoidal rule needs one clean BE step after this
    return ok;
  };
  Sim.prototype._step = function (dt, method, maxit) {
    var n = this.n, x = this.x, Cm = this.Cm, qp = this.qprev, xp = this.xprev;
    for (var r = 0; r < n; r++) {                         // q_prev = Cm * x_prev
      var q = 0, row = r * n;
      for (var c = 0; c < n; c++) { var cv = Cm[row + c]; if (cv !== 0) q += cv * xp[c]; }
      qp[r] = q;
    }
    var mode = method === 'be' ? {t: this.t + dt, a: 1 / dt, b: 0} : {t: this.t + dt, a: 2 / dt, b: 1};
    if (method === 'be') this.iq.fill(0);
    var ok = this.newton(mode, maxit);
    if (!ok) { x.set(xp); return false; }
    for (r = 0; r < n; r++) {                             // reactive current for the trapezoidal rule
      var q2 = 0, row2 = r * n;
      for (c = 0; c < n; c++) { var cv2 = Cm[row2 + c]; if (cv2 !== 0) q2 += cv2 * x[c]; }
      this.iq[r] = mode.a * (q2 - qp[r]) - mode.b * this.iq[r];
    }
    this.dt = dt;
    if (!this.xlast) this.xlast = new Float64Array(n);
    this.xlast.set(xp);
    xp.set(x);
    return true;
  };

  /* ---------------- readouts ---------------- */
  Sim.prototype.v = function (node) {
    var id = typeof node === 'number' ? node : this.c.nodeIdx[node];
    if (id === undefined) return NaN;
    return id === 0 ? 0 : this.x[id - 1];
  };
  /* current through an element, from its first pin to its second (into C for BJTs, out of the op amp for U) */
  Sim.prototype.i = function (name) {
    var el = typeof name === 'string' ? this.c.byName[name] : name;
    if (!el) return NaN;
    var x = this.x, p = el.p, u = el.u;
    function V(i) { return i < 0 ? 0 : x[i]; }
    switch (el.type) {
      case 'R': return (V(u[0]) - V(u[1])) / p.value;
      case 'SW': return (V(u[0]) - V(u[1])) / (p.on ? p.RON : p.ROFF);
      case 'C': {
        if (!this.dt || !this.xlast) return 0;
        var xl = this.xlast, la = u[0] < 0 ? 0 : xl[u[0]], lb = u[1] < 0 ? 0 : xl[u[1]];
        return p.value * ((V(u[0]) - V(u[1])) - (la - lb)) / this.dt;
      }
      case 'L': case 'V': return x[el.br];
      case 'I': {
        var iv = p.w.at(this.t);
        if (p.VC) { var uu = V(u[0]) - V(u[1]); iv *= uu >= 0 ? 1 - Math.exp(-uu / p.VC) : uu / p.VC; }
        return iv;
      }
      case 'D': {
        var vd = V(u[0]) - V(u[1]), id = p.IS * (lexp(vd / (p.N * VT))[0] - 1);
        if (p.BV > 0) id -= p.IS * lexp(-(vd + p.BV) / (p.N * VT))[0];
        return id;
      }
      case 'Q': return bjt(p.type, V(u[0]), V(u[1]), V(u[2]), p).i[0];
      case 'M': return mosfet(p, V(u[0]), V(u[1]), V(u[2])).id;
      case 'U': {
        var ro = Math.max(p.ROUT, 1e-3), dv = x[el.xi] - V(u[2]);
        return p.ILIM > 0 ? p.ILIM * Math.tanh(dv / (ro * p.ILIM)) : dv / ro;
      }
    }
    return NaN;
  };
  /* all three terminal currents of a 3-pin element, into each pin */
  Sim.prototype.pinCurrents = function (name) {
    var el = typeof name === 'string' ? this.c.byName[name] : name, x = this.x, u = el.u;
    function V(i) { return i < 0 ? 0 : x[i]; }
    if (el.type === 'Q') { var r = bjt(el.p.type, V(u[0]), V(u[1]), V(u[2]), el.p); return [r.i[0], r.i[1], r.i[2]]; }
    if (el.type === 'M') { var m = mosfet(el.p, V(u[0]), V(u[1]), V(u[2])); return [m.id, 0, -m.id]; }
    if (el.type === 'U') return [0, 0, -this.i(el)];
    var i2 = this.i(el); return [i2, -i2];
  };
  Sim.prototype.snapshot = function () { return Float64Array.from(this.x); };
  Sim.prototype.restore = function (s) { this.x.set(s); this.afterDC(); };
  /* full transient state, so an analysis (op / ac / sweep) can run in the middle of a transient */
  Sim.prototype.saveState = function () {
    return {x: Float64Array.from(this.x), xprev: Float64Array.from(this.xprev), iq: Float64Array.from(this.iq),
      xlast: this.xlast ? Float64Array.from(this.xlast) : null, t: this.t, dt: this.dt, restart: this.restart};
  };
  Sim.prototype.loadState = function (s) {
    this.x.set(s.x); this.xprev.set(s.xprev); this.iq.set(s.iq);
    if (s.xlast) { if (!this.xlast) this.xlast = new Float64Array(this.n); this.xlast.set(s.xlast); }
    this.t = s.t; this.dt = s.dt; this.restart = s.restart; this._JopValid = false;
  };

  /* ---------------- AC small signal ---------------- */
  /* Linearise at the present x (call op() first).  src: {name: [mag, phaseDeg]}; default: every
     source's own AC= value.  Returns {re, im} per unknown; use vac(res, node). */
  Sim.prototype.acMatrix = function (f) {
    var n = this.n;
    if (!this._JopValid) this.linearize();
    var w = 2 * Math.PI * f, Ar = Float64Array.from(this._Jop), Ai = new Float64Array(n * n), Cm = this.Cm;
    for (var i = 0; i < n * n; i++) Ai[i] = w * Cm[i];
    return {Ar: Ar, Ai: Ai};
  };
  /* small-signal conductances at the present x (op() leaves x at the operating point) */
  Sim.prototype.linearize = function () {
    if (this.dirty) this.buildCm();
    this.load(this.x, 0, true, 1, GMIN);
    this._Jop = Float64Array.from(this.J);
    this._JopValid = true;
  };
  Sim.prototype.ac = function (f, src) {
    var n = this.n, M = this.acMatrix(f), br = new Float64Array(n), bi = new Float64Array(n), els = this.c.elements;
    for (var e = 0; e < els.length; e++) {
      var el = els[e];
      if (el.type !== 'V' && el.type !== 'I') continue;
      var mag, ph;
      if (src) { if (!src[el.name]) continue; mag = src[el.name][0]; ph = (src[el.name][1] || 0) * Math.PI / 180; }
      else { mag = el.p.ac; ph = el.p.acph * Math.PI / 180; }
      if (!mag) continue;
      var re = mag * Math.cos(ph), im = mag * Math.sin(ph);
      if (el.type === 'V') { br[el.br] += re; bi[el.br] += im; }
      else {
        var a = el.u[0], b = el.u[1];
        if (a >= 0) { br[a] -= re; bi[a] -= im; }
        if (b >= 0) { br[b] += re; bi[b] += im; }
      }
    }
    if (!solveComplex(M.Ar, M.Ai, br, bi, n)) return null;
    return {re: br, im: bi};
  };
  Sim.prototype.vac = function (res, node) {
    var id = typeof node === 'number' ? node : this.c.nodeIdx[node];
    if (!res || !id) return [0, 0];
    return [res.re[id - 1], res.im[id - 1]];
  };
  /* sweep: returns [{f, re, im}] of v(outP) - v(outN) */
  Sim.prototype.acSweep = function (f0, f1, npts, outP, outN, src) {
    var out = [];
    for (var k = 0; k < npts; k++) {
      var f = f0 * Math.pow(f1 / f0, npts > 1 ? k / (npts - 1) : 0), r = this.ac(f, src);
      var a = this.vac(r, outP), b = outN ? this.vac(r, outN) : [0, 0];
      out.push({f: f, re: a[0] - b[0], im: a[1] - b[1]});
    }
    return out;
  };

  /* ---------------- noise (adjoint) ----------------
     Output noise density of v(outP) - v(outN) at each frequency, with every element's share.
     Sources: resistor 4kT/R, diode shot 2qI, BJT shot 2qIc (C-E) and 2qIb (B-E), MOSFET 8kT gm/3,
     op amp EN (V/rtHz, 1/f corner FC) and IN (A/rtHz per input), V/I sources with NOISE=. */
  Sim.prototype.noise = function (outP, outN, freqs) {
    var n = this.n, els = this.c.elements, self = this, x = this.x;
    var ip = this.c.nodeIdx[outP], im = outN ? this.c.nodeIdx[outN] : 0;
    var total = new Float64Array(freqs.length), parts = {};
    function V(i) { return i < 0 ? 0 : x[i]; }
    els.forEach(function (el) { parts[el.name] = new Float64Array(freqs.length); });
    this.linearize();
    for (var k = 0; k < freqs.length; k++) {
      var M = this.acMatrix(freqs[k]), Tr = new Float64Array(n * n), Ti = new Float64Array(n * n);
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) { Tr[c * n + r] = M.Ar[r * n + c]; Ti[c * n + r] = M.Ai[r * n + c]; }
      var yr = new Float64Array(n), yi = new Float64Array(n);
      if (ip > 0) yr[ip - 1] += 1;
      if (im > 0) yr[im - 1] -= 1;
      if (!solveComplex(Tr, Ti, yr, yi, n)) continue;
      var f = freqs[k];
      var mag2 = function (a, b) {
        var ar = a >= 0 ? yr[a] : 0, ai = a >= 0 ? yi[a] : 0, br2 = b >= 0 ? yr[b] : 0, bi2 = b >= 0 ? yi[b] : 0;
        return (ar - br2) * (ar - br2) + (ai - bi2) * (ai - bi2);
      };
      for (var e = 0; e < els.length; e++) {
        var el = els[e], p = el.p, u = el.u, s = 0;
        switch (el.type) {
          case 'R': s = 4 * KT / p.value * mag2(u[0], u[1]); break;
          case 'D': s = 2 * QE * Math.abs(self.i(el)) * mag2(u[0], u[1]); break;
          case 'Q': {
            var pc = self.pinCurrents(el);
            s = 2 * QE * Math.abs(pc[0]) * mag2(u[0], u[2]) + 2 * QE * Math.abs(pc[1]) * mag2(u[1], u[2]);
            break;
          }
          case 'M': s = 8 / 3 * KT * Math.abs(mosfet(p, V(u[0]), V(u[1]), V(u[2])).gm) * mag2(u[0], u[2]); break;
          case 'U': {
            var gm = opampGm();
            if (p.EN) s += gm * gm * p.EN * p.EN * (1 + (p.FC || 0) / f) * mag2(el.xi, -1);
            if (p.IN) s += p.IN * p.IN * (mag2(u[0], -1) + mag2(u[1], -1));
            break;
          }
          case 'V': if (p.NOISE) s = p.NOISE * p.NOISE * mag2(el.br, -1); break;
          case 'I': if (p.NOISE) s = p.NOISE * p.NOISE * mag2(u[0], u[1]); break;
        }
        parts[el.name][k] = s; total[k] += s;
      }
    }
    return {f: freqs, total: total, parts: parts};
  };
  /* integrate a PSD (V^2/Hz) over [fa, fb] on the given grid (trapezoid, log-log interpolation) */
  function integrate(freqs, psd, fa, fb) {
    var s = 0;
    for (var k = 1; k < freqs.length; k++) {
      var x0 = Math.max(freqs[k - 1], fa), x1 = Math.min(freqs[k], fb);
      if (x1 <= x0) continue;
      var y0 = interp(freqs[k - 1], freqs[k], psd[k - 1], psd[k], x0), y1 = interp(freqs[k - 1], freqs[k], psd[k - 1], psd[k], x1);
      s += (x1 - x0) * (y0 + y1) / 2;
    }
    return s;
    function interp(a, b, ya, yb, xq) {
      if (ya > 0 && yb > 0) return Math.exp(Math.log(ya) + (Math.log(yb) - Math.log(ya)) * Math.log(xq / a) / Math.log(b / a));
      return ya + (yb - ya) * (xq - a) / (b - a);
    }
  }
  function logspace(a, b, n) {
    var out = [];
    for (var k = 0; k < n; k++) out.push(a * Math.pow(b / a, n > 1 ? k / (n - 1) : 0));
    return out;
  }

  /* ---------------- DC sweep ---------------- */
  /* sweep el.key over values; record(sim) is called after each point */
  Sim.prototype.dcSweep = function (name, key, values, record) {
    var el = this.c.byName[name], keep = key === 'wave' ? el.p.wave : el.p[key], out = [], guess = null;
    for (var k = 0; k < values.length; k++) {
      this.set(name, key, values[k]);
      var r;
      if (guess) { this.x.set(guess); r = {ok: this.newton({dc: true}, 200)}; if (!r.ok) r = this.op(); else this.afterDC(); }
      else r = this.op();
      guess = Float64Array.from(this.x);
      out.push({value: values[k], ok: r.ok, data: record(this)});
    }
    this.set(name, key, keep);
    return out;
  };

  /* ================= schematic documents =================
     One element per line, positions on an integer grid as "x,y":
       R  R1  0,0 4,0  1k            two-pin parts: R C L V I D SW
       V  V1  0,4 0,0  SIN(0 1 1k) AC=1
       Q  Q1  6,2 npn [h|v|hv]  BF=200    anchor = base; C at (+2,-2), E at (+2,+2)
       M  M1  6,2 nmos                    anchor = gate; D at (+2,-2), S at (+2,+2)
       U  U1  8,4 [v]  GBW=1meg            anchor = (-) input; (+) at (0,+1)... see pinsOf()
       W  0,4 4,4                          wire
       GND 0,4                             ground symbol
       NODE out 4,0                        net label (same name = same net)
       SCOPE out vin                       default scope probes
       TITLE text
     Nets come from coincident points (union-find), net labels and ground symbols. */
  function tokenize(line) {
    var out = [], cur = '', depth = 0;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (/\s/.test(ch) && depth === 0) { if (cur) { out.push(cur); cur = ''; } }
      else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }
  function pt(s) { var m = /^(-?\d+),(-?\d+)$/.exec(s); return m ? [+m[1], +m[2]] : null; }

  function pinsOf(type, at, flag) {
    var x = at[0], y = at[1], h = /h/.test(flag || '') ? -1 : 1, v = /v/.test(flag || '') ? -1 : 1;
    if (type === 'Q' || type === 'M') return [[x + 2 * h, y - 2 * v], [x, y], [x + 2 * h, y + 2 * v]];   // C/D, B/G, E/S
    if (type === 'U') return [[x, y + v], [x, y - v], [x + 4 * h, y]];                                   // in+, in-, out
    return [];
  }

  function parseDoc(text) {
    var doc = {title: '', parts: [], wires: [], grounds: [], labels: [], scope: [], directives: {}, errors: []};
    String(text).split(/\r?\n/).forEach(function (raw, ln) {
      var line = raw.replace(/(^|\s)[#;].*$/, '').trim();
      if (!line) return;
      var tk = tokenize(line), kw = tk[0].toUpperCase();
      function err(msg) { doc.errors.push('第 ' + (ln + 1) + ' 行：' + msg); }
      if (kw === 'TITLE') { doc.title = line.slice(5).trim(); return; }
      if (kw === 'W') {
        var a = pt(tk[1]), b = pt(tk[2]);
        if (!a || !b) return err('W 需要兩個座標');
        doc.wires.push({a: a, b: b, line: ln}); return;
      }
      if (kw === 'GND') { var g = pt(tk[1]); if (!g) return err('GND 需要座標'); doc.grounds.push({at: g}); return; }
      if (kw === 'NODE') {
        var q = pt(tk[2]); if (!q) return err('NODE 需要名稱和座標');
        doc.labels.push({name: tk[1], at: q, flag: tk[3] && /^\[.*\]$/.test(tk[3]) ? tk[3].slice(1, -1) : ''}); return;
      }
      if (kw === 'SCOPE') { doc.scope = tk.slice(1); return; }
      if (kw === 'TRAN' || kw === 'AC' || kw === 'NOISE' || kw === 'DCSWEEP' || kw === 'MC') {
        var d = {};
        tk.slice(1).forEach(function (t) { var kv = t.split('='); d[kv[0].toLowerCase()] = kv.length > 1 ? kv.slice(1).join('=') : true; });
        doc.directives[kw.toLowerCase()] = d; return;
      }
      var type = kw;
      if (!TYPES[type]) return err('不認得的元件類型 ' + tk[0]);
      var name = tk[1], rest = tk.slice(2), part = {type: type, name: name, params: {}, line: ln, flag: ''};
      if (TYPES[type].pins === 2) {
        var p1 = pt(rest[0]), p2 = pt(rest[1]);
        if (!p1 || !p2) return err(name + ' 需要兩個座標');
        part.pts = [p1, p2]; part.pins = [p1, p2]; rest = rest.slice(2);
        if (rest[0] && /^\[.*\]$/.test(rest[0])) { part.flag = rest[0].slice(1, -1); rest = rest.slice(1); }
      } else {
        var at = pt(rest[0]);
        if (!at) return err(name + ' 需要錨點座標');
        rest = rest.slice(1);
        if (type !== 'U') { part.params.type = (rest[0] || (type === 'Q' ? 'npn' : 'nmos')).toLowerCase(); rest = rest.slice(1); }
        if (rest[0] && /^\[.*\]$/.test(rest[0])) { part.flag = rest[0].slice(1, -1); rest = rest.slice(1); }
        part.at = at; part.pins = pinsOf(type, at, part.flag);
      }
      rest.forEach(function (t, i) {
        var kv = /^([A-Za-z]\w*)=(.*)$/.exec(t);
        if (kv) {
          var key = kv[1].toUpperCase();
          if (key === 'AC') { var ap = kv[2].split(','); part.params.ac = num(ap[0]); part.params.acph = num(ap[1] || 0); }
          else part.params[key] = kv[2];
        } else if (i === 0 || part.params.value === undefined) {
          if (type === 'SW') part.params.on = !/^(off|open|0)$/i.test(t);
          else if (type === 'V' || type === 'I') part.params.wave = /^\s*(PULSE|SIN|PWL|SQUARE)/i.test(t) ? t : num(t);
          else part.params.value = num(t);
        }
      });
      if ((type === 'R' || type === 'C' || type === 'L') && !(part.params.value > 0)) return err(name + ' 數值不正確');
      doc.parts.push(part);
    });
    return doc;
  }

  /* nets from geometry; returns {circuit, netOfPoint(key), netName[], pinNets} */
  function buildFromDoc(doc) {
    var parent = {};
    function key(p) { return p[0] + ',' + p[1]; }
    function find(k) { if (parent[k] === undefined) parent[k] = k; while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; }
    function union(a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }
    doc.wires.forEach(function (w) { union(key(w.a), key(w.b)); });
    doc.parts.forEach(function (p) { p.pins.forEach(function (q) { find(key(q)); }); });
    doc.grounds.forEach(function (g) { union(key(g.at), '__gnd'); });
    var byLabel = {};
    doc.labels.forEach(function (l) {
      find(key(l.at));
      if (byLabel[l.name]) union(key(l.at), byLabel[l.name]); else byLabel[l.name] = key(l.at);
      if (l.name === '0' || /^gnd$/i.test(l.name)) union(key(l.at), '__gnd');
    });
    find('__gnd');
    /* name every net: ground -> '0', label -> its name, else n1, n2 ... */
    var netName = {}, used = {}, auto = 1;
    netName[find('__gnd')] = '0'; used['0'] = true;
    doc.labels.forEach(function (l) {
      var r = find(key(l.at));
      if (!netName[r]) { netName[r] = l.name; used[l.name] = true; }
    });
    function nameOf(k) {
      var r = find(k);
      if (!netName[r]) { while (used['n' + auto]) auto++; netName[r] = 'n' + auto; used['n' + auto] = true; }
      return netName[r];
    }
    var c = new Circuit(), errors = doc.errors.slice();
    doc.parts.forEach(function (p) {
      var nodes = p.pins.map(function (q) { return nameOf(key(q)); });
      try { c.add(p.type, p.name, nodes, p.params); } catch (e) { errors.push(e.message); }
      p.nets = nodes;
    });
    /* connection count per point, for junction dots and floating-pin warnings */
    var count = {};
    function bump(p) { var k = key(p); count[k] = (count[k] || 0) + 1; }
    doc.wires.forEach(function (w) { bump(w.a); bump(w.b); });
    doc.parts.forEach(function (p) { p.pins.forEach(bump); });
    doc.grounds.forEach(function (g) { bump(g.at); });
    var netCount = {};
    Object.keys(count).forEach(function (k) { var nm = nameOf(k); netCount[nm] = (netCount[nm] || 0) + count[k]; });
    doc.parts.forEach(function (p) {
      p.nets.forEach(function (nm) { if (netCount[nm] < 2 && nm !== '0') errors.push(p.name + ' 有一腳浮接（' + nm + '）'); });
    });
    if (!doc.grounds.length && !doc.labels.some(function (l) { return l.name === '0' || /^gnd$/i.test(l.name); }))
      errors.push('電路沒有接地（GND）：所有電壓都相對於一個浮接點');
    return {
      circuit: c, errors: errors, count: count,
      netAt: function (pnt) { return nameOf(key(pnt)); }
    };
  }

  /* ================= SPICE export ================= */
  function toSpice(circuit, opts) {
    opts = opts || {};
    var L = ['* ' + (opts.title || 'CircuitSim export'), '* generated by circuit-sim (lucassullivan0219.github.io)'], models = {};
    function nm(i) { return circuit.nodeNames[i]; }
    circuit.elements.forEach(function (el) {
      var p = el.p, n = el.nodes.map(nm), name = el.name;
      switch (el.type) {
        case 'R': L.push(pre('R', name) + ' ' + n[0] + ' ' + n[1] + ' ' + spiceNum(p.value)); break;
        case 'C': L.push(pre('C', name) + ' ' + n[0] + ' ' + n[1] + ' ' + spiceNum(p.value)); break;
        case 'L': L.push(pre('L', name) + ' ' + n[0] + ' ' + n[1] + ' ' + spiceNum(p.value)); break;
        case 'SW': L.push(pre('R', name) + ' ' + n[0] + ' ' + n[1] + ' ' + spiceNum(p.on ? p.RON : p.ROFF) + ' ; switch ' + (p.on ? 'closed' : 'open')); break;
        case 'V': case 'I': {
          var w = p.w, s = pre(el.type, name) + ' ' + n[0] + ' ' + n[1] + ' DC ' + spiceNum(w.dc);
          if (p.ac) s += ' AC ' + spiceNum(p.ac) + (p.acph ? ' ' + p.acph : '');
          if (w.kind && w.kind !== 'DC') s += ' ' + w.kind + '(' + w.args.map(spiceNum).join(' ') + ')';
          if (p.VC) s += ' ; compliance ' + p.VC + ' V not exported';
          L.push(s); break;
        }
        case 'D': {
          var dm = 'D_' + name; models[dm] = '.model ' + dm + ' D(IS=' + p.IS + ' N=' + p.N + (p.BV ? ' BV=' + p.BV : '') + (p.CJ ? ' CJO=' + spiceNum(p.CJ) + ' M=0' : '') + ')';
          L.push(pre('D', name) + ' ' + n[0] + ' ' + n[1] + ' ' + dm); break;
        }
        case 'Q': {
          var qm = 'Q_' + name; models[qm] = '.model ' + qm + ' ' + p.type.toUpperCase() + '(IS=' + p.IS + ' BF=' + p.BF + ' BR=' + p.BR +
            (p.CJE ? ' CJE=' + spiceNum(p.CJE) + ' MJE=0' : '') + (p.CJC ? ' CJC=' + spiceNum(p.CJC) + ' MJC=0' : '') + ')';
          L.push(pre('Q', name) + ' ' + n[0] + ' ' + n[1] + ' ' + n[2] + ' ' + qm); break;
        }
        case 'M': {
          var mm = 'M_' + name; models[mm] = '.model ' + mm + ' ' + p.type.toUpperCase() + '(LEVEL=1 KP=' + p.KP + ' VTO=' + (p.type === 'pmos' ? -p.VT : p.VT) + ' LAMBDA=' + p.LAMBDA + ')';
          L.push(pre('M', name) + ' ' + n[0] + ' ' + n[1] + ' ' + n[2] + ' ' + n[2] + ' ' + mm); break;
        }
        case 'U': {
          /* linear single-pole macro: gm stage into Rx || Cx, unity buffer.  Rails not exported. */
          var gm = 1e-3, rx = p.A0 / gm, cx = gm / (2 * Math.PI * p.GBW), xi = 'x_' + name;
          L.push('* ' + name + ': op amp A0=' + p.A0 + ' GBW=' + spiceNum(p.GBW) + ' (rails ' + p.VMIN + '..' + p.VMAX + ' V not modelled here)');
          L.push('G' + name + ' 0 ' + xi + ' ' + n[0] + ' ' + n[1] + ' ' + gm);
          L.push('R' + name + 'x ' + xi + ' 0 ' + spiceNum(rx));
          L.push('C' + name + 'x ' + xi + ' 0 ' + spiceNum(cx));
          L.push('E' + name + ' ' + xi + '_b 0 ' + xi + ' 0 1');
          L.push('R' + name + 'o ' + xi + '_b ' + n[2] + ' ' + spiceNum(p.ROUT));
          break;
        }
      }
    });
    Object.keys(models).forEach(function (k) { L.push(models[k]); });
    if (opts.tran) L.push('.tran ' + spiceNum(opts.tran.step) + ' ' + spiceNum(opts.tran.stop));
    if (opts.ac) L.push('.ac dec 50 ' + spiceNum(opts.ac.f0) + ' ' + spiceNum(opts.ac.f1));
    L.push('.end');
    return L.join('\n');
    function pre(letter, name) { return name.charAt(0).toUpperCase() === letter ? name : letter + '_' + name; }
  }

  /* ================= small utilities shared with the pages ================= */
  function rng(seed) {                               // deterministic uniform [0,1)
    var s = seed >>> 0 || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function gauss(r) {                                // standard normal from a uniform generator
    var u = 0, v = 0;
    while (u === 0) u = r();
    v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  global.CircuitSim = {
    Circuit: Circuit, Sim: Sim, parseDoc: parseDoc, buildFromDoc: buildFromDoc, toSpice: toSpice,
    num: num, fmt: fmt, spiceNum: spiceNum, makeWave: makeWave, integrate: integrate, logspace: logspace,
    rng: rng, gauss: gauss, pinsOf: pinsOf, TYPES: TYPES, KT: KT, QE: QE, VT: VT,
    _solveReal: solveReal, _solveComplex: solveComplex
  };
})(typeof window !== 'undefined' ? window : this);
