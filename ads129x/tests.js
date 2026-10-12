/* ADS129x model tests: register encodings against datasheet examples, data rates, noise tables,
   sinc3, and front-end circuit sanity checks (PDK test 8.2 noise, WCT, lead-off, bias). */
var TESTS = [];
function test(name, fn) { TESTS.push({name: name, fn: fn}); }
function close(a, b, tol, msg) { if (!(Math.abs(a - b) <= tol)) throw new Error((msg || '') + ' expected ' + b + ' ± ' + tol + ', got ' + a); }
function ok(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }
function reg(R, name) { for (var i = 0; i < R.length; i++) if (R[i].name === name) return R[i].v; throw new Error('no register ' + name); }
/* the hard-coded datasheet front end (Fig. 73: SRB1 reference, RC to ground, BIAS feedback on the board) */
function st1299() { var s = AFE.defaultState('ads1299'); delete s.doc; s.srb1 = true; s.srb2 = 0; s.biasP = 0xFF; s.biasN = 0; return s; }
function st1294() { return AFE.defaultState('ads1294'); }
/* the page default: OpenBCI Cyton schematic */
function cyton() { return AFE.defaultState('ads1299'); }
function analyzeDoc(s) { var fe = AFE.build(s); return {fe: fe, r: AFE.analyze(fe)}; }
function hasNote(fe, r, re) { return fe.notes.concat(r.warn).some(function (n) { return re.test(n); }); }
/* the same circuit as the datasheet builder, drawn as a schematic document */
function datasheetDoc(labels) {
  var L = ['V VAVDD 0,0 0,4 2.5', 'GND 0,4', 'NODE AVDD 0,0', 'V VAVSS 4,0 4,4 -2.5', 'GND 4,4', 'NODE AVSS 4,0',
    'V VDVDD 8,0 8,4 3.3', 'GND 8,4', 'NODE DVDD 8,0', 'IC U1 ads1299 40,10',
    'NODE AVDD 44,8', 'NODE AVSS 45,60', 'GND 49,60', 'NODE DVDD 54,60', 'NODE DVDD 60,60', 'NODE AVSS 53,8'];
  function row(y, name) {
    L.push('W 72,' + y + ' 74,' + y, 'W 74,' + y + ' 76,' + y, 'C CF' + name + ' 74,' + y + ' 74,' + (y + 2) + ' 4.7n', 'GND 74,' + (y + 2),
      'R RF' + name + ' 76,' + y + ' 80,' + y + ' 4.99k', 'W 80,' + y + ' 84,' + y);
  }
  labels.forEach(function (nm, k) { row(12 + 4 * k, nm); });
  row(44, 'REF');
  L.push('W 38,50 36,50', 'W 38,54 36,54', 'R RBF 36,50 36,54 1meg', 'C CBF 34,50 34,54 1.5n', 'W 36,50 34,50', 'W 36,54 34,54',
    'R RPROT 30,50 34,50 10k', 'W 26,50 30,50');
  labels.forEach(function (nm, k) { L.push('ELEC ' + nm + ' 84,' + (12 + 4 * k) + ' [r]'); });
  L.push('ELEC REF 84,44 [r]', 'ELEC BIAS 26,50 [l]');
  return L.join('\n');
}

test('ADS1299 registers match the datasheet power-up flow (Fig. 67)', function () {
  var s = st1299(); s.mux = [1, 1, 1, 1, 1, 1, 1, 1]; s.gain = [1, 1, 1, 1, 1, 1, 1, 1]; s.biasOn = false; s.biasRefInt = false; s.srb1 = false; s.refBuf = true;
  var R = AFE.registers(s);
  ok(reg(R, 'CONFIG1') === 0x96, 'CONFIG1 96h, got ' + reg(R, 'CONFIG1').toString(16));
  ok(reg(R, 'CONFIG2') === 0xC0, 'CONFIG2 C0h');
  ok(reg(R, 'CONFIG3') === 0xE0, 'CONFIG3 E0h (internal reference)');
  ok(reg(R, 'CH1SET') === 0x01, 'CHnSET 01h (input short, gain 1)');
  s.testInt = true; s.mux = [5, 5, 5, 5, 5, 5, 5, 5]; R = AFE.registers(s);
  ok(reg(R, 'CONFIG2') === 0xD0, 'CONFIG2 D0h (internal test signal)');
  ok(reg(R, 'CH8SET') === 0x05, 'CHnSET 05h (test signal, gain 1)');
  s.biasOn = true; s.biasRefInt = true; R = AFE.registers(s);
  ok(reg(R, 'CONFIG3') === 0xEC, 'CONFIG3 ECh (bias on, internal BIASREF), got ' + reg(R, 'CONFIG3').toString(16));
  s = st1299(); R = AFE.registers(s);
  ok(reg(R, 'CH1SET') === 0x60, 'gain 24 normal electrode = 60h');
  ok(reg(R, 'MISC1') === 0x20, 'SRB1 bit');
});

test('ADS1299 lead-off register: DC, 6 nA, 95 % = 00h; AC fDR/4, 24 nA = 07h', function () {
  var s = st1299(); s.loffMode = 'dc'; s.ilead = 0; s.compTh = 0;
  ok(reg(AFE.registers(s), 'LOFF') === 0x00);
  s.loffMode = 'acdr4'; s.ilead = 1;
  ok(reg(AFE.registers(s), 'LOFF') === 0x07);
});

test('ADS1294 gain codes (6 = 000, 1 = 001) and CONFIG3', function () {
  var s = st1294(); var R = AFE.registers(s);
  ok(reg(R, 'CH1SET') === 0x00, 'gain 6 normal = 00h, got ' + reg(R, 'CH1SET').toString(16));
  s.gain = [1, 2, 12, 8]; R = AFE.registers(s);
  ok(reg(R, 'CH1SET') === 0x10 && reg(R, 'CH2SET') === 0x20 && reg(R, 'CH3SET') === 0x60 && reg(R, 'CH4SET') === 0x50, 'gain codes');
  s.biasOn = false; R = AFE.registers(s);
  ok(reg(R, 'CONFIG3') === 0xC8, 'ref buffer on, 2.4 V, RLD off (BIASREF_INT kept) = C8h, got ' + reg(R, 'CONFIG3').toString(16));
  s.biasOn = true; s.vref4 = true; R = AFE.registers(s);
  ok(reg(R, 'CONFIG3') === 0xEC, 'VREF 4 V + RLD on + internal RLDREF = ECh');
  ok(reg(R, 'CONFIG1') === 0x86, 'HR, 500 SPS = 86h');
  ok(reg(R, 'WCT1') === 0x09 && reg(R, 'WCT2') === 0xC2, 'WCTA = IN1N, WCTB = IN1P, WCTC = IN2P: ' + reg(R, 'WCT1').toString(16) + ' ' + reg(R, 'WCT2').toString(16));
});

test('data rates', function () {
  var a = AFE.CHIPS.ads1299, b = AFE.CHIPS.ads1294, s = st1299();
  s.dr = 6; close(AFE.fdr(a, s), 250, 1e-9); s.dr = 0; close(AFE.fdr(a, s), 16000, 1e-6);
  var t = st1294(); t.hr = true; t.dr = 0; close(AFE.fdr(b, t), 32000, 1e-6); t.dr = 6; close(AFE.fdr(b, t), 500, 1e-9);
  t.hr = false; t.dr = 6; close(AFE.fdr(b, t), 250, 1e-9);
});

test('noise tables', function () {
  var s = st1299(); s.dr = 6;
  close(AFE.chipNoise(AFE.CHIPS.ads1299, s, 24).rms, 0.14e-6, 1e-12);
  close(AFE.chipNoise(AFE.CHIPS.ads1299, s, 1).pp, 7.59e-6, 1e-12);
  var t = st1294(); t.avdd = 3; t.hr = true; t.dr = 6;
  close(AFE.chipNoise(AFE.CHIPS.ads1294, t, 6).rms, 0.6e-6, 1e-12, '3 V HR 500 SPS G6');
  close(AFE.chipNoise(AFE.CHIPS.ads1294, t, 6).pp, 3.5e-6, 1e-12);
  t.avdd = 5; t.hr = false; t.dr = 6;
  close(AFE.chipNoise(AFE.CHIPS.ads1294, t, 12).rms, 0.4e-6, 1e-12, '5 V LP 250 SPS G12');
});

test('sinc3: -3 dB at 0.262 fDR, notches at fDR; CIC at R x fDR agrees within 0.3 dB', function () {
  var fm = 1.024e6, N = 4096, fD = fm / N;
  close(20 * Math.log10(AFE.sinc3(0.262 * fD, fm, N)), -3, 0.05);
  ok(AFE.sinc3(fD, fm, N) < 1e-9, 'notch at fDR');
  var R = 8, taps = AFE.sincTaps(R), s = taps.reduce(function (a, b) { return a + b; }, 0);
  close(s, 1, 1e-12, 'taps sum to 1');
  [5, 20, 0.262 * fD, 100].forEach(function (f) {
    var fs = R * fD, re = 0, im = 0;
    taps.forEach(function (h, k) { re += h * Math.cos(2 * Math.PI * f * k / fs); im -= h * Math.sin(2 * Math.PI * f * k / fs); });
    close(20 * Math.log10(Math.hypot(re, im)), 20 * Math.log10(AFE.sinc3(f, fm, N)), 0.3, 'f = ' + f);
  });
});

test('ADS1299 default: inputs inside the PGA common-mode range, body biased to mid-supply', function () {
  var s = st1299(), fe = AFE.build(s), r = AFE.analyze(fe);
  ok(r.op.ok, 'op converged');
  r.ch.forEach(function (c, i) { ok(c.headroom > 0, 'CH' + (i + 1) + ' headroom ' + c.headroom); });
  close(r.bodyDC, 0, 0.05, 'body near 0 V (bipolar mid-supply)');
});

test('PDK test 8.2 (inputs to VCM through the 4.99 kOhm filters): resistor noise ~0.10 µVrms at 250 SPS', function () {
  var s = AFE.defaultState('pdk'); s.dr = 6; s.mux = [0, 0, 0, 0, 0, 0, 0, 0]; s.gain = [24, 24, 24, 24, 24, 24, 24, 24];
  var r = AFE.analyze(AFE.build(s)), c = r.ch[0];
  ok(r.op.ok);
  /* 2 x 4.99 kOhm: sqrt(4kT*9.98k) = 12.9 nV/rtHz; equivalent noise bandwidth of sinc3 at 250 SPS ~ 0.29*fDR? use 65 Hz from the guide */
  close(c.circRms * 1e6, 0.104, 0.02, 'circuit noise µVrms');
  var pp = 6.6 * Math.sqrt(c.circRms * c.circRms + c.chipNoise.rms * c.chipNoise.rms) * 1e6;
  close(pp, 1.27, 0.2, 'total µVpp vs SLAU443B §8.2 measured 1.27 µVpp');
});

test('ADS1294 WCT: chest-lead channel sees V1 minus the average of RA, LA, LL', function () {
  var s = st1294(), fe = AFE.build(s), r = AFE.analyze(fe), names = fe.elecs.map(function (e) { return e.name; });
  var m = r.ch[2].mix, g = function (n) { return m[names.indexOf(n)]; };
  close(g('V1'), 1, 0.01, 'V1'); close(g('RA'), -1 / 3, 0.01, 'RA'); close(g('LA'), -1 / 3, 0.01, 'LA'); close(g('LL'), -1 / 3, 0.01, 'LL');
  var m1 = r.ch[0].mix;
  close(m1[names.indexOf('LA')], 1, 0.01, 'lead I: +LA'); close(m1[names.indexOf('RA')], -1, 0.01, 'lead I: -RA');
});

test('DC lead-off: an open electrode is flagged, a connected one is not', function () {
  var s = st1299(); s.loffMode = 'dc'; s.ilead = 0; s.compOn = true; s.loffP = 0xFF; s.contact = {C3: false};
  var r = AFE.analyze(AFE.build(s));
  ok(r.ch[2].loffP, 'C3 (CH3) off'); ok(!r.ch[0].loffP, 'Fp1 (CH1) on');
  ok(r.ch[2].vp > r.rails.avdd - 0.3, 'pulled up to AVDD: ' + r.ch[2].vp);
});

test('AC lead-off 6 µA at 31.2 Hz across 5 kOhm per input gives about 120 mVpp (SLAU443B §7.2.2)', function () {
  var s = AFE.defaultState('pdk'); s.mux = [0, 0, 0, 0, 0, 0, 0, 0]; s.gain = [1, 1, 1, 1, 1, 1, 1, 1];
  s.loffMode = 'ac31'; s.ilead = 2; s.loffP = 0x01; s.loffN = 0x01; s.loffFlip = 0;
  /* in the guide the inputs see 5 kOhm each; here: the 4.99 kOhm filter plus VCM through 4.99 kOhm R10 shared */
  var r = AFE.analyze(AFE.build(s)), h = r.ch[0].loffAC[0], amp = 4 / Math.PI * Math.hypot(h[0], h[1]);
  ok(amp * 2 > 0.08 && amp * 2 < 0.16, 'fundamental pp ' + (amp * 2).toFixed(3) + ' V');
});

/* ---------------- schematic-driven front end ---------------- */
test('schematic parity: the datasheet circuit drawn as a document gives the builder\'s DC, 60 Hz, mixing and noise', function () {
  var s = st1299(), ref = AFE.analyze(AFE.build(s));
  var d = st1299(); d.doc = datasheetDoc(d.labels);
  var x = analyzeDoc(d), r = x.r;
  ok(r.op.ok, 'op');
  close(r.rails.avdd, 2.5, 1e-9, 'AVDD from the drawing'); close(r.rails.avss, -2.5, 1e-9, 'AVSS from the drawing');
  close(r.bodyDC, ref.bodyDC, 1e-6, 'body DC');
  ref.ch.forEach(function (a, i) {
    var b = r.ch[i];
    close(b.vp, a.vp, 1e-6, 'CH' + (i + 1) + ' V(INP)'); close(b.vn, a.vn, 1e-6, 'CH' + (i + 1) + ' V(INN)');
    var ma = Math.hypot(a.mains1[0], a.mains1[1]), mb = Math.hypot(b.mains1[0], b.mains1[1]);
    close(mb, ma, ma * 1e-3 + 1e-12, 'CH' + (i + 1) + ' 60 Hz differential');
    a.mix.forEach(function (m, j) { close(b.mix[j], m, 1e-4, 'CH' + (i + 1) + ' mix ' + j); });
    close(b.circRms, a.circRms, a.circRms * 0.02, 'CH' + (i + 1) + ' circuit noise');
  });
  ok(x.fe.channels[0].label === 'Fp1 − REF', 'label ' + x.fe.channels[0].label);
});

test('Cyton default: ±2.5 V and VREF 4.5 V from the drawing, every channel is REF − electrode, no design warnings', function () {
  var x = analyzeDoc(cyton()), fe = x.fe, r = x.r;
  ok(r.op.ok, 'op converged');
  close(fe.rails.avdd, 2.5, 1e-9); close(fe.rails.avss, -2.5, 1e-9); close(r.vref, 4.5, 1e-6, 'VREF');
  ok(fe.clk.internal, 'CLKSEL tied to DVDD: internal oscillator');
  ok(fe.notes.length === 0 && r.warn.length === 0, 'warnings: ' + fe.notes.concat(r.warn).join(' / '));
  ['Fp1', 'Fp2', 'C3', 'C4', 'P3', 'P4', 'O1', 'O2'].forEach(function (n, i) { ok(fe.channels[i].label === 'REF − ' + n, 'CH' + (i + 1) + ': ' + fe.channels[i].label); });
  var names = fe.elecs.map(function (e) { return e.name; });
  close(r.ch[0].mix[names.indexOf('REF')], 1, 0.01, 'REF on SRB2 -> INxP'); close(r.ch[0].mix[names.indexOf('Fp1')], -1, 0.01, 'Fp1 on IN1N');
  r.ch.forEach(function (c, i) { ok(c.headroom > 1, 'CH' + (i + 1) + ' headroom ' + c.headroom); });
  close(r.bodyDC, 0, 0.02, 'body held near 0 V by the bias loop through the body');
  ok(Math.abs(r.biasOut) < 0.1, 'BIAS_OUT ' + r.biasOut);
});

test('Cyton with the datasheet montage (electrodes on INxP, reference on SRB1): channels are electrode − REF', function () {
  var s = cyton(); s.doc = AFE.boards.cyton({montage: 'srb1'}); s.srb1 = true; s.srb2 = 0; s.biasN = 0;
  var x = analyzeDoc(s);
  ok(x.fe.channels[6].label === 'O1 − REF', x.fe.channels[6].label);
  ok(x.fe.notes.length === 0 && x.r.warn.length === 0, x.fe.notes.concat(x.r.warn).join(' / '));
  /* forgetting MISC1.SRB1 leaves the reference out of every channel */
  s.srb1 = false; x = analyzeDoc(s);
  ok(hasNote(x.fe, x.r, /REF 電極沒有進到任何通道/), 'warns that REF reaches no channel');
});

test('design checks: VCAP1 removed, VREFN off AVSS, CLKSEL low without a clock, external clock sets the data rate', function () {
  var CS = window.CircuitSim, base = cyton();
  function edit(fn) { var s = cyton(), d = CS.parseDoc(s.doc); fn(d); s.doc = CS.docToText(d); return analyzeDoc(s); }
  var x = edit(function (d) { d.parts = d.parts.filter(function (p) { return p.name !== 'C2'; }); });
  ok(hasNote(x.fe, x.r, /VCAP1 對 AVSS/), 'VCAP1 warning');
  x = edit(function (d) { d.wires = d.wires.filter(function (w) { return !(w.a[0] === 53 && w.a[1] === 8); }); });
  ok(hasNote(x.fe, x.r, /VREFN 要接到 AVSS/), 'VREFN warning');
  x = edit(function (d) { d.wires = d.wires.filter(function (w) { return !(w.a[0] === 60 && w.a[1] === 60); }); d.grounds.push({at: [60, 60]}); });
  ok(!x.fe.clk.internal && hasNote(x.fe, x.r, /CLK 腳沒有接時脈源/), 'CLKSEL low without clock');
  x = edit(function (d) {
    d.wires = d.wires.filter(function (w) { return !(w.a[0] === 60 && w.a[1] === 60); }); d.grounds.push({at: [60, 60]});
    d.parts = d.parts.filter(function (p) { return p.name !== 'J:CLK'; });
    d.parts.push({type: 'V', name: 'VCLK', params: {wave: 'SQUARE(0 3.3 2.06848meg)'}, pts: [[66, 62], [66, 66]], pins: [[66, 62], [66, 66]], flag: ''}); d.grounds.push({at: [66, 66]});
  });
  ok(!x.fe.clk.internal && x.fe.clk.src === 'VCLK', 'external clock found');
  close(x.r.fdr, 250 * 1.01, 1e-6, 'fDR follows the 2.068 MHz clock');
  void base;
});

test('Cyton lead-off: O1 removed, DC lead-off on the N side (where the electrodes are) flags LOFF_STATN bit 6', function () {
  var s = cyton(); s.loffMode = 'dc'; s.ilead = 0; s.compTh = 0; s.loffP = 0; s.loffN = 0xFF; s.compOn = true; s.contact = {O1: false};
  var r = analyzeDoc(s).r;
  ok(r.ch[6].loffN, 'O1 flagged'); ok(!r.ch[0].loffN, 'Fp1 not flagged');
  ok(r.ch[6].vn < r.rails.avss + 0.3, 'IN7N pulled to AVSS: ' + r.ch[6].vn);
  ok(((AFE.statusWord(r) >> 4) & 0xFF) === 0x40, 'status word LOFF_STATN = 40h');
});

test('single 5 V supply with the BIAS electrode grounded: rails 5 V / 0 V from the drawing, every PGA out of range', function () {
  var s = cyton(); s.doc = AFE.boards.cyton({supply: 'uni', biasToGnd: true}); s.biasOn = false;
  var r = analyzeDoc(s).r;
  close(r.rails.avdd, 5, 1e-9); close(r.rails.avss, 0, 1e-9);
  r.ch.forEach(function (c, i) { ok(c.headroom < 0, 'CH' + (i + 1) + ' headroom ' + c.headroom); });
});

test('an electrode whose lead is not connected: floating-lead and no-channel warnings', function () {
  var CS = window.CircuitSim, s = cyton(), d = CS.parseDoc(s.doc);
  d.wires = d.wires.filter(function (w) { return !(w.a[0] === 15 && w.a[1] === 16); });
  s.doc = CS.docToText(d);
  var x = analyzeDoc(s);
  ok(hasNote(x.fe, x.r, /Fp2 電極沒有接到電路/), 'floating lead');
  ok(hasNote(x.fe, x.r, /Fp2 電極沒有進到任何通道/), 'reaches no channel');
  ok(x.fe.channels[1].label === 'REF', 'CH2 now sees only REF: ' + x.fe.channels[1].label);
});

test('SPICE export of the drawn front end includes the TVS pairs and the chip model', function () {
  var fe = AFE.build(cyton()), sp = window.CircuitSim.toSpice(fe.circuit, {title: 't'});
  ok(/D_D1Na /.test(sp) && /\.model DZ_D1N D\(/.test(sp), 'TVS exported as two zeners');
  ok(/U1:BIAS/.test(sp) && /R2N /.test(sp), 'chip bias amp and resistors');
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
