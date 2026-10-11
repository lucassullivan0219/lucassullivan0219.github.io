/* Engine tests: analytic answers, and the HW2 #2-2 membrane against the Python sim.py.
   Run by opening test.html; every test prints ok / FAIL. */
var CS = window.CircuitSim, TESTS = [];
function test(name, fn) { TESTS.push({name: name, fn: fn}); }
function close(a, b, tol, msg) {
  if (!(Math.abs(a - b) <= tol)) throw new Error((msg || '') + ' expected ' + b + ' ± ' + tol + ', got ' + a);
}
function ok(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }
function mag(z) { return Math.hypot(z.re, z.im); }

test('SPICE suffixes', function () {
  close(CS.num('4.99k'), 4990, 1e-9); close(CS.num('1meg'), 1e6, 1e-6); close(CS.num('2.2n'), 2.2e-9, 1e-21);
  close(CS.num('10u'), 1e-5, 1e-17); close(CS.num('5m'), 5e-3, 1e-15); close(CS.num('1e3'), 1000, 1e-9);
  close(CS.num('47nF'), 47e-9, 1e-20); close(CS.num('-3.3'), -3.3, 1e-12);
});

test('voltage divider DC', function () {
  var c = new CS.Circuit();
  c.V('V1', 'in', '0', 10); c.R('R1', 'in', 'out', 3e3); c.R('R2', 'out', '0', 1e3);
  var s = new CS.Sim(c), r = s.op();
  ok(r.ok); close(s.v('out'), 2.5, 1e-6); close(s.i('V1'), -10 / 4e3, 1e-9);
});

test('RC step: backward Euler and trapezoidal against 1 - exp(-t/RC)', function () {
  ['be', 'trap'].forEach(function (m) {
    var c = new CS.Circuit();
    c.V('V1', 'in', '0', 'PULSE(0 1 0 1n 1n 1 2)'); c.R('R1', 'in', 'out', 1e3); c.C('C1', 'out', '0', 1e-6);
    var s = new CS.Sim(c, {method: m}); s.powerOn();
    var dt = 1e-5, worst = 0;
    for (var k = 0; k < 300; k++) { s.step(dt); worst = Math.max(worst, Math.abs(s.v('out') - (1 - Math.exp(-s.t / 1e-3)))); }
    ok(worst < (m === 'be' ? 6e-3 : 2e-3), m + ' max error ' + worst);
  });
});

test('series RLC: resonance and Q in AC analysis', function () {
  var c = new CS.Circuit();
  c.V('V1', 'in', '0', {dc: 0, ac: 1}); c.R('R1', 'in', 'a', 10); c.L('L1', 'a', 'b', 1e-3); c.C('C1', 'b', '0', 1e-6);
  var s = new CS.Sim(c); s.op();
  var f0 = 1 / (2 * Math.PI * Math.sqrt(1e-3 * 1e-6)), r = s.ac(f0);
  var vc = s.vac(r, 'b');                     // |Vc| = Q at resonance
  close(Math.hypot(vc[0], vc[1]), Math.sqrt(1e-3 / 1e-6) / 10, 1e-3, 'Q');
  var vr = s.vac(r, 'in'), va = s.vac(r, 'a'); // all of V1 drops on R at resonance
  close(Math.hypot(vr[0] - va[0], vr[1] - va[1]), 1, 1e-6);
});

test('diode with series resistor matches bisection', function () {
  var c = new CS.Circuit();
  c.V('V1', 'in', '0', 5); c.R('R1', 'in', 'a', 1e3); c.add('D', 'D1', ['a', '0'], {});
  var s = new CS.Sim(c); ok(s.op().ok);
  var Is = 2.52e-9, nvt = 1.752 * CS.VT, lo = 0, hi = 1;
  for (var k = 0; k < 200; k++) { var m = (lo + hi) / 2; if (Is * (Math.exp(m / nvt) - 1) > (5 - m) / 1e3) hi = m; else lo = m; }
  close(s.v('a'), lo, 1e-5);
});

test('inverting op amp: gain, -3 dB point and rail clipping', function () {
  var c = new CS.Circuit();
  c.V('V1', 'in', '0', {dc: 0.1, ac: 1}); c.R('R1', 'in', 'm', 1e3); c.R('R2', 'm', 'out', 10e3);
  c.U('U1', '0', 'm', 'out', {A0: 1e5, GBW: 1e6, VMAX: 5, VMIN: -5});
  var s = new CS.Sim(c); ok(s.op().ok);
  close(s.v('out'), -1, 2e-3, 'dc gain');
  var lo = s.ac(10), g10 = Math.hypot.apply(null, s.vac(lo, 'out'));
  close(g10, 10, 0.01, 'ac gain');
  var g3 = Math.hypot.apply(null, s.vac(s.ac(1e6 / 11), 'out'));
  close(g3, 10 / Math.SQRT2, 0.15, '-3 dB at GBW/(1+Rf/Ri)');
  s.set('V1', 'wave', 2); ok(s.op().ok);
  ok(s.v('out') < -4.9 && s.v('out') > -5.05, 'clips near -5 V, got ' + s.v('out'));
});

test('kT/C noise of an RC low-pass', function () {
  var c = new CS.Circuit();
  c.R('R1', 'out', '0', 10e3); c.C('C1', 'out', '0', 1e-9);
  var s = new CS.Sim(c); s.op();
  var f = CS.logspace(1, 1e9, 400), r = s.noise('out', '0', f);
  var vrms = Math.sqrt(CS.integrate(f, r.total, 1, 1e9));
  close(vrms, Math.sqrt(CS.KT / 1e-9), 0.01 * Math.sqrt(CS.KT / 1e-9), 'sqrt(kT/C)');
});

test('BJT common emitter operating point', function () {
  var c = new CS.Circuit();
  c.V('VCC', 'vcc', '0', 12); c.R('RB', 'vcc', 'b', 1e6); c.R('RC', 'vcc', 'c', 4.7e3);
  c.add('Q', 'Q1', ['c', 'b', '0'], {type: 'npn'});
  var s = new CS.Sim(c); ok(s.op().ok);
  var ib = (12 - s.v('b')) / 1e6, ic = (12 - s.v('c')) / 4.7e3;
  close(ic / ib, 200, 2, 'beta');
  ok(s.v('b') > 0.55 && s.v('b') < 0.7, 'Vbe ' + s.v('b'));
});

test('current source with compliance stops at the rail', function () {
  var c = new CS.Circuit();
  c.V('VDD', 'vdd', '0', 5); c.I('I1', 'vdd', 'in', {dc: 6e-9, VC: 0.05}); c.R('R1', 'in', '0', 1e9);
  var s = new CS.Sim(c); ok(s.op().ok);
  ok(s.v('in') < 5 && s.v('in') > 4.7, 'pinned near the rail, got ' + s.v('in'));
  s.set('R1', 'value', 1e5); ok(s.op().ok);
  close(s.v('in'), 6e-4, 1e-5, 'I*R when far from the rail');
});

test('schematic document: wires, labels and ground make nets', function () {
  var doc = CS.parseDoc(['V V1 0,0 0,4 1', 'R R1 0,0 4,0 1k', 'R R2 4,0 4,4 1k', 'W 0,4 4,4', 'GND 0,4', 'NODE out 4,0',
    'R R3 8,0 8,4 2k', 'NODE out 8,0', 'GND 8,4'].join('\n'));
  ok(doc.errors.length === 0, doc.errors.join(';'));
  var b = CS.buildFromDoc(doc); ok(b.errors.length === 0, b.errors.join(';'));
  var s = new CS.Sim(b.circuit); s.op();
  close(s.v('out'), 1 * (1e3 * 2e3 / 3e3) / (1e3 + 1e3 * 2e3 / 3e3), 1e-6);
});

/* ---- HW2 #2-2 active membrane, fix 1 + 2, built like sim.py (Circuit(r_so_r2=1e6, extra=[22k, 11k])) ---- */
function membrane(sw) {
  var c = new CS.Circuit(), Q4403 = {type: 'pnp', IS: 1e-14, BF: 150, BR: 4}, Q3904 = {type: 'npn', IS: 6.7e-15, BF: 200, BR: 0.74};
  c.V('VB', 'V+', '0', 7.8);
  c.add('SW', 'SW', ['V+', 'ST.P'], {on: sw, RON: 0.05, ROFF: 1e13});
  c.R('pot', 'ST.P', 'ST.K', 1); c.R('R1', 'ST.K', 'ST.Q', 7e3);
  c.add('Q', 'Qpass', ['Vm', 'ST.R', 'ST.Q'], Q4403); c.add('Q', 'Qsense', ['ST.R', 'ST.Q', 'V+'], Q4403);
  c.R('R2', 'ST.R', '0', 7e3); c.R('Rx', 'ST.Q', 'ST.R', 22e3);
  c.C('LKC', 'Vm', '0', 1e-6); c.R('LKR', 'Vm', '0', 100e3);
  c.add('D', 'FID', ['Vm', 'FI.B3'], {}); c.R('FIR1', 'FI.B3', '0', 3e6);
  c.add('Q', 'FIQ3', ['FI.B4', 'FI.B3', 'FI.E3'], Q3904); c.R('FIR2', 'FI.E3', '0', 100e3);
  c.add('Q', 'FIQ4', ['Vm', 'FI.B4', 'FI.E4'], Q4403); c.R('R13', 'FI.E4', 'V+', 100e3); c.R('R13p', 'V+', 'FI.E4', 11e3);
  c.R('SOR1', 'Vm', 'SO.S', 100e3); c.C('SOC1', 'SO.S', '0', 1e-6);
  c.add('D', 'SOD', ['SO.S', 'SO.B3'], {}); c.R('SOR2', 'SO.B3', '0', 1e6);
  c.add('Q', 'SOQ3', ['SO.B4', 'SO.B3', '0'], Q3904); c.add('Q', 'SOQ4', ['SO.C4', 'SO.B4', 'Vm'], Q4403);
  c.R('SOR3', 'SO.C4', '0', 1e3); c.R('probe', 'Vm', '0', 10e6);
  return c;
}
test('HW2 membrane DC matches sim.py (SW released and pressed)', function () {
  var ref = [
    {sw: false, Vm: 0.000111, 'ST.Q': 7.145433, 'FI.B4': 7.499274, 'FI.E4': 7.799989},
    {sw: true, Vm: 0.786479, 'ST.Q': 7.147694, 'ST.R': 6.560936, 'FI.B3': 0.587622, 'FI.E3': 0.100973, 'FI.B4': 5.690718,
      'FI.E4': 6.296539, 'SO.S': 0.735943, 'SO.B3': 0.495648, 'SO.B4': 0.171738}
  ];
  ref.forEach(function (r) {
    var s = new CS.Sim(membrane(r.sw)), res = s.op();
    ok(res.ok, 'op converged (sw ' + r.sw + ')');
    Object.keys(r).forEach(function (k) { if (k !== 'sw') close(s.v(k), r[k], 2e-3, k + ' (sw ' + r.sw + ')'); });
  });
});
test('HW2 membrane AP: press SW 5-15 ms, peak 5.504 V at 34.6 ms like sim.py', function () {
  var c = membrane(false), s = new CS.Sim(c); s.op();
  var dt = 2e-4, peak = -1, tp = 0;
  for (var k = 0; k < 300; k++) {
    var t = k * dt;
    if (Math.abs(t - 0.005) < 1e-9) s.set('SW', 'on', true);
    if (Math.abs(t - 0.015) < 1e-9) s.set('SW', 'on', false);
    s.step(dt);
    if (s.v('Vm') > peak) { peak = s.v('Vm'); tp = s.t; }
  }
  close(peak, 5.5041, 0.02, 'peak');
  close(tp * 1000, 34.6, 0.6, 'time of peak (ms)');
});
test('astable multivibrator oscillates with half periods 0.69*RB*C (step cutting at each switch)', function () {
  var c = new CS.Circuit();
  c.V('VCC', 'vcc', '0', 9);
  c.R('RC1', 'vcc', 'c1', 1e3); c.R('RC2', 'vcc', 'c2', 1e3); c.R('RB1', 'vcc', 'b1', 47e3); c.R('RB2', 'vcc', 'b2', 47e3);
  c.add('Q', 'Q1', ['c1', 'b1', '0'], {type: 'npn'}); c.add('Q', 'Q2', ['c2', 'b2', '0'], {type: 'npn'});
  c.C('C1', 'c1', 'b2', 10e-6); c.C('C2', 'c2', 'b1', 4.7e-6);
  var s = new CS.Sim(c); s.powerOn();
  var edges = [], prev = s.v('c1'), fails = 0;
  for (var k = 0; k < 2000; k++) {
    if (!s.step(1e-3)) fails++;
    var v = s.v('c1'); if ((prev < 4.5) !== (v < 4.5)) edges.push(s.t); prev = v;
  }
  ok(fails === 0, fails + ' steps failed');
  ok(edges.length >= 6, 'only ' + edges.length + ' edges');
  var a = edges[3] - edges[2], b = edges[4] - edges[3], lo = Math.min(a, b), hi = Math.max(a, b);
  close(lo, 0.693 * 47e3 * 4.7e-6, 0.08 * 0.153, 'short half period');
  close(hi, 0.693 * 47e3 * 10e-6, 0.08 * 0.326, 'long half period');
});
test('SPICE export lists every element', function () {
  var txt = CS.toSpice(membrane(true), {title: 'membrane'});
  ok(/^Qpass Vm ST\.R ST\.Q Q_Qpass$/m.test(txt), 'BJT line');
  ok(/\.model Q_Qpass PNP\(IS=1e-14 BF=150 BR=4 CJE=8p MJE=0 CJC=8p MJC=0\)/.test(txt), 'model line');
  ok(/\.end$/.test(txt));
});

function runTests(out) {
  var pass = 0;
  TESTS.forEach(function (t) {
    var li = document.createElement('li'), t0 = performance.now();
    try { t.fn(); pass++; li.textContent = 'ok  ' + t.name + '  (' + (performance.now() - t0).toFixed(0) + ' ms)'; li.className = 'ok'; }
    catch (e) { li.textContent = 'FAIL  ' + t.name + ': ' + e.message; li.className = 'fail'; }
    out.appendChild(li);
  });
  document.title = pass + '/' + TESTS.length + ' passed';
  return {pass: pass, total: TESTS.length};
}
