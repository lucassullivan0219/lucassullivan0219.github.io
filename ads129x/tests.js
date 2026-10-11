/* ADS129x model tests: register encodings against datasheet examples, data rates, noise tables,
   sinc3, and front-end circuit sanity checks (PDK test 8.2 noise, WCT, lead-off, bias). */
var TESTS = [];
function test(name, fn) { TESTS.push({name: name, fn: fn}); }
function close(a, b, tol, msg) { if (!(Math.abs(a - b) <= tol)) throw new Error((msg || '') + ' expected ' + b + ' ± ' + tol + ', got ' + a); }
function ok(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }
function reg(R, name) { for (var i = 0; i < R.length; i++) if (R[i].name === name) return R[i].v; throw new Error('no register ' + name); }
function st1299() { return AFE.defaultState('ads1299'); }
function st1294() { return AFE.defaultState('ads1294'); }

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
