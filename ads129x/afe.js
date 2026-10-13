/* ADS129x front-end simulation core, shared by ads1299/, ads1294/ and ads1299-pdk/.

   Three layers:
   1. Chip data taken from TI datasheets SBAS499C (ADS1299) and SBAS459K (ADS1294): data rates,
      gains and their register codes, input-referred noise tables, lead-off, test signal, bias/RLD.
   2. The analog front end (electrodes, cables, input filters, chip input pins, BIAS/RLD loop, WCT,
      mains coupling through the body) is a real circuit solved with circuit-sim/engine.js:
      DC operating point, AC transfer at the mains frequency, EEG-band mixing, lead-off excitation,
      and adjoint noise of every resistor and amplifier.
   3. Inside the chip a behavioural model: PGA with its 200 mV output headroom, sinc3 decimation
      (computed at R x the output rate), datasheet noise added at the output rate, 24-bit codes,
      lead-off comparators, status word.

   AFE.build(state) -> front end;  AFE.analyze(fe) -> per-channel results;
   new AFE.Stream(fe, res, state) -> generates samples in real time.
*/
(function (global) {
  'use strict';
  var CS = global.CircuitSim;

  /* ===================== chip data ===================== */
  var CHIPS = {
    ads1299: {
      id: 'ads1299', name: 'ADS1299', nch: 8, fclk: 2.048e6,
      gains: [1, 2, 4, 6, 8, 12, 24], gainCode: {1: 0, 2: 1, 4: 2, 6: 3, 8: 4, 12: 5, 24: 6},
      /* SBAS499C Tables 1-4 (5 V supply, 4.5 V internal reference): [gain index][DR code 0..6], µV */
      noiseRms: [
        [21.70, 6.93, 4.33, 3.06, 2.17, 1.53, 1.08], [10.85, 3.65, 2.28, 1.61, 1.14, 0.81, 0.57],
        [5.60, 1.98, 1.24, 0.88, 0.62, 0.44, 0.31], [3.87, 1.31, 0.93, 0.66, 0.46, 0.33, 0.23],
        [3.05, 1.11, 0.79, 0.56, 0.39, 0.28, 0.20], [2.27, 0.92, 0.65, 0.46, 0.32, 0.23, 0.16],
        [1.66, 0.80, 0.56, 0.40, 0.28, 0.20, 0.14]],
      noisePp: [
        [151.89, 48.53, 30.34, 21.45, 15.17, 10.73, 7.59], [75.94, 25.52, 15.95, 11.29, 7.98, 5.65, 3.99],
        [39.23, 13.87, 8.66, 6.13, 4.34, 3.07, 2.16], [27.10, 9.19, 6.50, 4.60, 3.25, 2.30, 1.62],
        [21.32, 7.80, 5.52, 3.90, 2.76, 1.95, 1.38], [15.89, 6.41, 4.53, 3.20, 2.26, 1.61, 1.13],
        [11.64, 5.57, 3.94, 2.79, 1.97, 1.39, 0.98]],
      pgaBW: {1: 662e3, 2: 332e3, 4: 165e3, 6: 110e3, 8: 83e3, 12: 55e3, 24: 27e3},
      ibias: 200e-12,       // PDK user's guide §8.4: typical 200 pA per channel (datasheet max ±300 pA)
      rin: 1e9, cin: 20e-12, cmrrTyp: 120, offsetTyp: 60e-6,
      loffI: [6e-9, 24e-9, 6e-6, 24e-6],
      bias: {gbw: 100e3, isc: 1.1e-3, en: 2e-6 / Math.sqrt(150), rsum: 220e3, name: 'BIAS'},
      tempMv: 145.3, tempCoef: 0.49
    },
    ads1294: {
      id: 'ads1294', name: 'ADS1294', nch: 4, fclk: 2.048e6,
      gains: [1, 2, 3, 4, 6, 8, 12], gainCode: {6: 0, 1: 1, 2: 2, 3: 3, 4: 4, 8: 5, 12: 6},
      /* SBAS459K Tables 1-4, keyed by supply and mode; [gain index 1,2,3,4,6,8,12][DR code], µVrms and µVpp */
      noiseTables: {
        '3hr': [[335, 56, 12.4, 6.1, 4.1, 2.9, 2.1], [168, 28, 6.5, 3.2, 2.2, 1.6, 1.1], [112, 18.8, 4.5, 2.4, 1.6, 1.2, 0.9],
                [85, 14.3, 3.5, 1.9, 1.3, 1, 0.7], [58, 9.7, 2.6, 1.5, 1.1, 0.8, 0.6], [42.5, 7.4, 2.2, 1.3, 1, 0.7, 0.5], [28.6, 5.2, 1.8, 1.2, 0.9, 0.6, 0.5]],
        '3hrPp': [[3553, 613, 111, 44.8, 27.8, 19, 12.5], [1701, 295, 54, 23.3, 15.4, 10.1, 6.8], [1100, 188, 37.9, 17.1, 11, 7.5, 5.1],
                  [823, 143, 29.7, 14, 9.1, 6.2, 4.3], [529, 94, 21.7, 11.1, 7.3, 5, 3.5], [378, 69, 17.8, 9.7, 6.5, 4.6, 3.1], [248, 44.3, 13.8, 8.5, 6, 4.1, 2.9]],
        '3lp': [[333, 56, 12.5, 6.1, 4.1, 3, 2.1], [166, 28, 6.5, 3.2, 2.2, 1.6, 1.1], [111, 19, 4.5, 2.3, 1.6, 1.1, 0.8],
                [84, 14.3, 3.4, 1.8, 1.3, 0.9, 0.7], [56, 9.7, 2.4, 1.4, 1, 0.7, 0.5], [42, 7.4, 2, 1.2, 0.8, 0.6, 0.5], [28, 5, 1.5, 1, 0.7, 0.5, 0.4]],
        '3lpPp': [[3481, 554, 99, 41.8, 26.3, 17.9, 11.9], [1836, 272, 51, 22.2, 14.6, 9.8, 6.3], [1168, 177, 35, 15.9, 9.9, 6.8, 4.6],
                  [834, 133, 25.9, 12.1, 8.1, 5.7, 4], [576, 85, 18.8, 9.3, 6.2, 4.2, 3], [450, 64, 14.5, 7.8, 5.4, 3.6, 2.6], [284, 42.4, 11.3, 6.7, 4.7, 3.4, 2.4]],
        '5hr': [[521, 86, 17, 6.4, 4.2, 2.9, 2], [260, 43, 9, 3.4, 2.3, 1.6, 1.1], [173, 29, 6, 2.4, 1.6, 1.1, 0.8],
                [130, 22, 4, 1.9, 1.3, 0.9, 0.7], [87, 15, 3, 1.5, 1, 0.7, 0.5], [65, 11, 3, 1.3, 0.9, 0.6, 0.5], [44, 7, 2, 1.1, 0.8, 0.6, 0.4]],
        '5hrPp': [[5388, 1252, 207, 48.2, 29.9, 18.8, 12.8], [2900, 633, 112, 25.9, 15.9, 10.4, 7.2], [1946, 402, 71, 17.7, 11.1, 7.8, 5.2],
                  [1403, 298, 57, 15.4, 9.3, 6.1, 4], [917, 206, 36, 11.2, 7.5, 4.9, 3.3], [692, 141, 29, 9.6, 6.6, 4.7, 3.3], [483, 91, 18, 8.2, 5.8, 3.9, 2.7]],
        '5lp': [[526, 88, 17, 6, 4.1, 2.9, 2.1], [263, 44, 9, 3.3, 2.3, 1.6, 1.1], [175, 29, 6, 2.2, 1.5, 1.1, 0.8],
                [132, 22, 4, 1.8, 1.2, 0.9, 0.6], [88, 15, 3, 1.3, 0.9, 0.7, 0.5], [66, 11, 2, 1.1, 0.8, 0.6, 0.4], [44, 7, 2, 0.9, 0.7, 0.5, 0.4]],
        '5lpPp': [[5985, 1201, 208, 41.1, 27.1, 17.4, 11.9], [2953, 619, 103, 23.3, 14.8, 9.6, 6.6], [1918, 411, 62, 15.5, 10.1, 6.6, 4.6],
                  [1410, 280, 52, 12.3, 8.1, 5.9, 3.7], [896, 191, 37, 9.8, 6, 4.3, 3], [681, 139, 25, 7.8, 5.4, 3.4, 2.5], [458, 83, 16, 6.5, 4.4, 3.2, 2.2]]
      },
      pgaBW: {1: 237e3, 2: 146e3, 3: 127e3, 4: 96e3, 6: 64e3, 8: 48e3, 12: 32e3},
      ibias: 200e-12, rin: 1e9, cin: 20e-12, cmrrTyp: 115, offsetTyp: 100e-6,
      loffI: [6e-9, 12e-9, 18e-9, 24e-9],
      bias: {gbw: 100e3, isc: 0.5e-3, en: 7e-6 / Math.sqrt(150), rsum: 220e3, name: 'RLD'},
      wct: {r: 30e3, c: 80e-12, noise: [540e-9, 382e-9, 312e-9]},
      tempMv: 145, tempCoef: 0.49
    }
  };

  /* ---- schematic symbols (circuit-sim IC_LIB): functional layout, real TQFP-64 pin numbers ---- */
  (function () {
    var pins = [], nN = [15, 13, 11, 9, 7, 5, 3, 1], nP = [16, 14, 12, 10, 8, 6, 4, 2];
    for (var k = 0; k < 8; k++) {
      pins.push({name: 'IN' + (k + 1) + 'N', side: 'l', at: 2 + 4 * k, num: String(nN[k]), kind: 'a'});
      pins.push({name: 'IN' + (k + 1) + 'P', side: 'r', at: 2 + 4 * k, num: String(nP[k]), kind: 'a'});
    }
    pins.push({name: 'SRB2', side: 'l', at: 34, num: '17', kind: 'a'}, {name: 'SRB1', side: 'r', at: 34, num: '18', kind: 'a'},
      {name: 'BIASOUT', side: 'l', at: 40, num: '63', kind: 'a'}, {name: 'BIASIN', side: 'l', at: 42, num: '62', kind: 'a'},
      {name: 'BIASINV', side: 'l', at: 44, num: '61', kind: 'a'}, {name: 'BIASREF', side: 'l', at: 46, num: '60', kind: 'a'},
      {name: 'AVDD', side: 't', at: 4, num: '19', all: '19, 21, 22, 54, 56, 59', kind: 'p'}, {name: 'VREFP', side: 't', at: 7, num: '24', kind: 'a'},
      {name: 'VREFN', side: 't', at: 13, num: '25', kind: 'a'}, {name: 'VCAP1', side: 't', at: 15, num: '28', kind: 'a'},
      {name: 'VCAP2', side: 't', at: 18, num: '30', kind: 'a'}, {name: 'VCAP3', side: 't', at: 21, num: '55', kind: 'a'},
      {name: 'VCAP4', side: 't', at: 27, num: '26', kind: 'a'},
      {name: 'AVSS', side: 'b', at: 5, num: '20', all: '20, 23, 32, 53, 57, 58', kind: 'p'}, {name: 'DGND', side: 'b', at: 9, num: '33', all: '33, 49, 51', kind: 'p'},
      {name: 'DVDD', side: 'b', at: 14, num: '48', all: '48, 50', kind: 'p'}, {name: 'CLKSEL', side: 'b', at: 20, num: '52', kind: 'd'},
      {name: 'CLK', side: 'b', at: 26, num: '37', kind: 'd'});
    CS.IC_LIB.ads1299 = {title: 'ADS1299', sub: 'TQFP-64', w: 30, h: 48, stub: 2, pins: pins,
      note: 'SPI、GPIO、DAISY_IN、RESET、PWDN、START 等數位腳沒有畫出來，也不模擬。'};
  })();

  /* ---- derived chip quantities ---- */
  function fmod(chip, st) { return chip.id === 'ads1299' ? chip.fclk * st.clkErr / 2 : chip.fclk * st.clkErr / (st.hr ? 4 : 8); }
  function decim(chip, st) { return (chip.id === 'ads1299' ? 64 : 16) * Math.pow(2, st.dr); }
  function fdr(chip, st) { return fmod(chip, st) / decim(chip, st); }
  function vref(chip, st) { return chip.id === 'ads1299' ? 4.5 : (st.vref4 ? 4.0 : 2.4); }
  function rails(chip, st) {
    var span = chip.id === 'ads1299' ? 5 : st.avdd;
    return st.supply === 'bi' ? {avdd: span / 2, avss: -span / 2} : {avdd: span, avss: 0};
  }
  /* datasheet noise for a gain and data rate: {rms, pp} in volts */
  function chipNoise(chip, st, gain) {
    var gi = chip.gains.indexOf(gain);
    if (chip.id === 'ads1299') return {rms: chip.noiseRms[gi][st.dr] * 1e-6, pp: chip.noisePp[gi][st.dr] * 1e-6};
    var key = (st.avdd >= 4.5 ? '5' : '3') + (st.hr ? 'hr' : 'lp'), T = chip.noiseTables;
    return {rms: T[key][gi][st.dr] * 1e-6, pp: T[key + 'Pp'][gi][st.dr] * 1e-6};
  }
  /* sinc3 magnitude at f (Hz), decimation N at fMOD */
  function sinc3(f, fm, N) {
    var x = Math.PI * f / fm;
    if (x === 0) return 1;
    var s = Math.sin(N * x) / (N * Math.sin(x));
    return Math.abs(s * s * s);
  }
  function testSignal(chip, st) {
    var v = vref(chip, st), amp = (st.testAmp ? 2 : 1) * v / 2400, fq = st.testFreq;   // 0: fCLK/2^21, 1: fCLK/2^20, 3: DC
    var f = fq === 3 ? 0 : chip.fclk * st.clkErr / Math.pow(2, fq === 1 ? 20 : 21);
    return {amp: amp, f: f};
  }
  function loffFreq(chip, st) {
    if (st.loffMode === 'ac7') return chip.fclk * st.clkErr / Math.pow(2, 18);
    if (st.loffMode === 'ac31') return chip.fclk * st.clkErr / Math.pow(2, 16);
    if (st.loffMode === 'acdr4') return fdr(chip, st) / 4;
    return 0;
  }

  /* ===================== electrodes ===================== */
  var ELECTRODES = {
    wet: {label: '濕電極（Ag/AgCl＋導電膠）', Rs: 500, Rct: 10e3, Cdl: 1e-6, hc: 5e-3},
    dry: {label: '乾電極', Rs: 5e3, Rct: 1e6, Cdl: 10e-9, hc: 50e-3},
    gel: {label: '黏貼式心電圖電極', Rs: 300, Rct: 20e3, Cdl: 0.5e-6, hc: 3e-3}
  };
  function electrodeZ(e, f, mul) {
    var w = 2 * Math.PI * f, r = e.Rct * mul, c = e.Cdl / mul, den = 1 + w * w * r * r * c * c;
    var re = e.Rs * mul + r / den, im = -w * r * r * c / den;
    return Math.hypot(re, im);
  }

  /* ===================== front-end circuit ===================== */
  /* Common pieces used by all three builders.  Node names: 'site:X' tissue under electrode X,
     'cab:X' cable at the board connector, pins 'IN1P' etc., 'SRB1', 'BIASINV', 'BIASOUT'. */
  function Builder(chip, st) {
    this.chip = chip; this.st = st;
    this.c = new CS.Circuit();
    this.r = rails(chip, st);
    this.channels = []; this.elecs = []; this.notes = []; this.pins = {}; this.loffSrc = [];
    var c = this.c, env = st.env, r = this.r;
    c.V('VAVDD', 'AVDD', '0', r.avdd); c.V('VAVSS', 'AVSS', '0', r.avss);
    c.V('VMID', 'MID', '0', (r.avdd + r.avss) / 2);
    /* mains, body, earth.  Device ground '0' is the analog ground of the board. */
    c.V('Vmains', 'mains', 'earth', {dc: 0, ac: 1});
    c.C('Cpow', 'mains', 'body', env.Cpow);
    c.C('Cbody', 'body', 'earth', env.Cbody);
    c.C('Ciso', 'earth', '0', env.Ciso);
    c.R('Rleak', 'earth', '0', 1e12);                         // keeps 'earth' defined at DC
  }
  Builder.prototype.electrode = function (name, e, opts) {
    /* tissue source (half-cell offset as DC, signal transfer by AC), electrode impedance, contact, cable */
    opts = opts || {};
    var c = this.c, st = this.st, mul = opts.mul || 1, env = st.env;
    c.V('Ve:' + name, 'site:' + name, 'body', {dc: opts.hc || 0, ac: 0});
    c.R('Rs:' + name, 'site:' + name, 'm:' + name, e.Rs * mul);
    c.R('Rct:' + name, 'm:' + name, 'el:' + name, e.Rct * mul);
    c.C('Cdl:' + name, 'm:' + name, 'el:' + name, e.Cdl / mul);
    c.add('SW', 'K:' + name, ['el:' + name, 'cab:' + name], {on: opts.on !== false, RON: 0.01, ROFF: 1e14});
    c.C('Ccab:' + name, 'cab:' + name, '0', env.Ccab);
    if (env.Cstray > 0) c.C('Cst:' + name, 'mains', 'cab:' + name, env.Cstray);
    this.elecs.push({name: name, src: 'Ve:' + name, mul: mul, z10: electrodeZ(e, 10, mul), on: opts.on !== false, hc: opts.hc || 0});
  };
  /* input pin model: Cin, DC input resistance, bias current; optional RC filter from a cable node */
  Builder.prototype.pin = function (pin, from, filt) {
    var c = this.c, chip = this.chip, st = this.st;
    if (filt && filt.R > 0) {
      c.R('Rf:' + pin, from, pin, filt.R);
      if (filt.C > 0) c.C('Cf:' + pin, pin, '0', filt.C);
    } else if (from !== pin) c.R('Rf:' + pin, from, pin, 1e-3);
    this.pinModel(pin);
  };
  Builder.prototype.pinModel = function (pin, count) {
    var c = this.c, chip = this.chip, st = this.st;
    count = count || 1;
    var tag = pin + (this.pins[pin] ? '#' + this.pins[pin] : '');
    this.pins[pin] = (this.pins[pin] || 0) + 1;
    c.C('Cin:' + tag, pin, 'AVSS', chip.cin * count);
    c.R('Rin:' + tag, pin, 'MID', chip.rin / count);
    if (st.ibias) c.I('Ib:' + tag, 'MID', pin, {dc: chip.ibias * count * st.ibiasSign});
  };
  /* DC / AC lead-off excitation on a pin: source from AVDD (pull-up) or sink to AVSS (pull-down) */
  Builder.prototype.loff = function (pin, up, I) {
    var c = this.c, st = this.st, name = 'Ilo:' + pin + (up ? '+' : '-');
    if (st.loffMode === 'dc') {
      if (up) c.I(name, 'AVDD', pin, {dc: I, VC: 0.05});
      else c.I(name, pin, 'AVSS', {dc: I, VC: 0.05});
    } else if (st.loffMode === 'pullres') {
      c.R(name, pin, up ? 'AVDD' : 'AVSS', 10e6);
    } else {
      /* AC: square wave of +-I.  The DC average is zero; the transfer is found with an AC solve. */
      c.I(name, 'MID', pin, {dc: 0, ac: 0});
      this.loffSrc.push({name: name, pin: pin, sign: up ? 1 : -1, I: I});
    }
  };
  /* BIAS / RLD amplifier: taps from the selected pins, Rf || Cf feedback, output through Rprot to a cable node */
  Builder.prototype.biasLoop = function (taps, outCable, bp) {
    var c = this.c, chip = this.chip, r = this.r;
    c.U('Ubias', 'BIASREF', 'BIASINV', 'BIASOUT', {A0: 1e5, GBW: chip.bias.gbw, VMAX: r.avdd - 0.05, VMIN: r.avss + 0.05, ILIM: chip.bias.isc, EN: chip.bias.en, ROUT: 50});
    if (this.st.biasRefInt !== false) c.R('Rbref', 'MID', 'BIASREF', 1);
    else { c.R('Rbref', 'MID', 'BIASREF', 1e12); this.notes.push('BIASREF_INT = 0：BIASREF 要從外部提供；這裡當作浮接，BIAS 放大器的參考點不確定。'); }
    c.R('Rbf', 'BIASOUT', 'BIASINV', bp.Rf);
    c.C('Cbf', 'BIASOUT', 'BIASINV', bp.Cf);
    var rs = chip.bias.rsum;
    taps.forEach(function (pin, i) {
      c.G('Gtap' + i, '0', 'BIASINV', pin, '0', 1 / rs);        // buffered PGA tap: current (v_pin - v_inv)/Rsum
      c.R('Rtap' + i, 'BIASINV', '0', rs);
    });
    if (!taps.length) c.R('Rbinv', 'BIASINV', 'BIASOUT', 1e3);  // nothing sensed: amplifier just follows BIASREF
    c.R('Rprot:bias', 'BIASOUT', outCable, Math.max(bp.Rprot, 1));
  };
  Builder.prototype.result = function (extra) {
    var o = {chip: this.chip, st: this.st, circuit: this.c, channels: this.channels, elecs: this.elecs, notes: this.notes,
      rails: this.r, loffSrc: this.loffSrc};
    for (var k in extra || {}) o[k] = extra[k];
    return o;
  };
  function hcOffsets(n, spread, seed) {
    var r = CS.rng(seed || 7), out = [];
    for (var i = 0; i < n; i++) out.push((2 * r() - 1) * spread);
    return out;
  }
  function mulFactors(n, spread, seed) {
    var r = CS.rng((seed || 11) * 3), out = [];
    for (var i = 0; i < n; i++) out.push(Math.exp((2 * r() - 1) * Math.log(1 + spread)));
    return out;
  }

  /* ---------- ADS1299, referential montage (SRB1 common reference, datasheet Fig. 73) ---------- */
  function buildADS1299(st) {
    var chip = CHIPS.ads1299, B = new Builder(chip, st), c = B.c, e = st.elec;
    var names = st.labels, all = names.concat(['REF', 'BIAS']), hc = hcOffsets(all.length, e.hc * st.hcScale, st.seed), mul = mulFactors(all.length, st.zSpread, st.seed);
    all.forEach(function (nm, i) { B.electrode(nm, e, {mul: mul[i] * (st.zMul[nm] || 1), hc: hc[i], on: st.contact[nm] !== false}); });
    var filt = st.filt;
    for (var k = 0; k < 8; k++) {
      var P = 'IN' + (k + 1) + 'P';
      B.pin(P, 'cab:' + names[k], filt);
    }
    /* reference electrode to SRB1; with MISC1.SRB1 = 1 every channel's negative input is SRB1 */
    B.pin('SRB1', 'cab:REF', filt);
    var nOnSrb = 0;
    for (k = 0; k < 8; k++) {
      var N = 'IN' + (k + 1) + 'N';
      if (st.srb1) { nOnSrb++; }
      else { c.R('Rnc:' + N, N, 'MID', 1e12); B.pinModel(N); }
    }
    if (st.srb1 && nOnSrb > 1) B.pinModel('SRB1', nOnSrb - 1);   // the other negative inputs load SRB1 too
    /* lead-off */
    var I = chip.loffI[st.ilead];
    if (st.loffMode !== 'off') {
      for (k = 0; k < 8; k++) {
        var flip = (st.loffFlip >> k) & 1;
        if ((st.loffP >> k) & 1) B.loff('IN' + (k + 1) + 'P', !flip, I);
        if ((st.loffN >> k) & 1) B.loff(st.srb1 ? 'SRB1' : 'IN' + (k + 1) + 'N', !!flip, I);
      }
    }
    /* bias */
    if (st.biasOn) {
      var taps = [];
      for (k = 0; k < 8; k++) {
        if ((st.biasP >> k) & 1) taps.push('IN' + (k + 1) + 'P');
        if ((st.biasN >> k) & 1) taps.push(st.srb1 ? 'SRB1' : 'IN' + (k + 1) + 'N');
      }
      B.biasLoop(taps, 'cab:BIAS', st.bias);
    } else if (st.biasToGnd) {
      c.R('Rbias:gnd', 'cab:BIAS', '0', 1);
      B.notes.push('BIAS 電極直接接電路地（0 V）。' + (B.r.avss === 0 ? '單電源時輸入共模因此在 0 V 附近，低於 AVSS + 0.2 V，PGA 會飽和。' : ''));
    } else {
      c.R('Rbias:float', 'cab:BIAS', 'MID', 1e12);
      B.notes.push('BIAS 放大器關閉：BIAS 電極浮接，人體只經各輸入腳的 1 GΩ 和電容接到電路。');
    }
    for (k = 0; k < 8; k++) {
      B.channels.push({idx: k, name: 'CH' + (k + 1), label: names[k], p: 'IN' + (k + 1) + 'P', n: st.srb1 ? 'SRB1' : 'IN' + (k + 1) + 'N',
        gain: st.gain[k], mux: st.mux[k], pd: !!st.pd[k], eP: names[k], eN: st.srb1 ? 'REF' : null});
    }
    return B.result();
  }

  /* ---------- ADS1294, 4-channel ECG: lead I, lead II, V1-WCT, V2-WCT; RLD to the right leg ---------- */
  function buildADS1294(st) {
    var chip = CHIPS.ads1294, B = new Builder(chip, st), c = B.c, e = st.elec;
    var all = ['RA', 'LA', 'LL', 'V1', 'V2', 'RL'], hc = hcOffsets(all.length, e.hc * st.hcScale, st.seed), mul = mulFactors(all.length, st.zSpread, st.seed);
    all.forEach(function (nm, i) { B.electrode(nm, e, {mul: mul[i] * (st.zMul[nm] || 1), hc: hc[i], on: st.contact[nm] !== false}); });
    var f = st.filt;
    B.pin('IN1P', 'cab:LA', f); B.pin('IN1N', 'cab:RA', f);
    B.pin('IN2P', 'cab:LL', f); B.pin('IN2N', 'cab:RA', f);
    B.pin('IN3P', 'cab:V1', f); B.pin('IN4P', 'cab:V2', f);
    /* Wilson central terminal: three buffers (WCTA/B/C) into 30 kOhm each, 80 pF inside plus the external C */
    var w = chip.wct, sel = [st.wctA, st.wctB, st.wctC].filter(function (s) { return s; });
    sel.forEach(function (pin, i) {
      c.G('Gwct' + i, '0', 'WCT', pin, '0', 1 / w.r);
      c.R('Rwct' + i, 'WCT', '0', w.r);
    });
    if (!sel.length) c.R('Rwct:none', 'WCT', 'MID', 1e9);
    c.C('Cwct', 'WCT', 'AVSS', w.c + (st.wctCext || 0));
    /* WCT buffer noise (Table 6, integrated over 150 Hz) as a current noise into the 30k/N node impedance */
    if (st.wctNoise && sel.length) c.I('Iwctn', '0', 'WCT', {dc: 0, NOISE: w.noise[sel.length - 1] / Math.sqrt(150) * sel.length / w.r});
    /* chest leads use WCT as the negative input (wired externally from the WCT pin) */
    c.R('Rw3', 'WCT', 'IN3N', 1); c.R('Rw4', 'WCT', 'IN4N', 1);
    B.pinModel('IN3N'); B.pinModel('IN4N');
    var I = chip.loffI[st.ilead];
    var pinsP = ['IN1P', 'IN2P', 'IN3P', 'IN4P'], pinsN = ['IN1N', 'IN2N', 'IN3N', 'IN4N'];
    if (st.loffMode !== 'off') for (var k = 0; k < 4; k++) {
      var flip = (st.loffFlip >> k) & 1;
      if ((st.loffP >> k) & 1) B.loff(pinsP[k], !flip, I);
      if ((st.loffN >> k) & 1) B.loff(pinsN[k], !!flip, I);
    }
    if (st.biasOn) {
      var taps = [];
      for (k = 0; k < 4; k++) { if ((st.biasP >> k) & 1) taps.push(pinsP[k]); if ((st.biasN >> k) & 1) taps.push(pinsN[k]); }
      if (st.wctToRld) taps = ['WCT'];
      B.biasLoop(taps, 'cab:RL', st.bias);
    } else if (st.biasToGnd) {
      c.R('Rrl:gnd', 'cab:RL', '0', 1);
      B.notes.push('右腳電極直接接電路地（0 V）。' + (B.r.avss === 0 ? '單電源時輸入共模在 0 V 附近，PGA 會飽和。' : ''));
    } else {
      c.R('Rrl:float', 'cab:RL', 'MID', 1e12);
      B.notes.push('RLD 關閉：右腳電極浮接。');
    }
    var lab = ['Lead I（LA−RA）', 'Lead II（LL−RA）', 'V1−WCT', 'V2−WCT'], eP = ['LA', 'LL', 'V1', 'V2'], eN = ['RA', 'RA', 'WCT', 'WCT'];
    for (k = 0; k < 4; k++) B.channels.push({idx: k, name: 'CH' + (k + 1), label: lab[k], p: pinsP[k], n: pinsN[k], gain: st.gain[k], mux: st.mux[k], pd: !!st.pd[k], eP: eP[k], eN: eN[k]});
    return B.result();
  }

  /* ---------- ADS1299EEG-FE (PDK board): input network from the SLAU443B schematic ---------- */
  function buildPDK(st) {
    var chip = CHIPS.ads1299, B = new Builder(chip, st), c = B.c, e = st.elec, j = st.jp;
    var filt = {R: 4.99e3, C: 4.7e-9};
    var tol = st.tolSeed ? CS.rng(st.tolSeed) : null;
    function tR(v) { return tol ? v * (1 + 0.01 * (2 * tol() - 1)) : v; }     // BOM: 1 % resistors
    function tC(v) { return tol ? v * (1 + 0.10 * (2 * tol() - 1)) : v; }     // BOM: 10 % X7R capacitors
    /* VCM = BIAS_ELEC: U11 (OPA376) buffers mid-supply (R23/R24 2 MOhm divider), or the ADS1299 bias loop (JP1) */
    c.R('R23', 'AVDD', 'VDIV', 2e6); c.R('R24', 'VDIV', 'AVSS', 2e6); c.C('C24', 'VDIV', 'AVSS', 1e-6);
    if (j.biasElec === 'u11') {
      c.U('U11', 'VDIV', 'BIAS_ELEC', 'BIAS_ELEC', {A0: 1e6, GBW: 5.5e6, VMAX: B.r.avdd, VMIN: B.r.avss, EN: 7.5e-9, FC: 53, ROUT: 20});
    }
    var src = st.source;                                     // 'vcm' (J6 jumpers + JP25), 'gen' (SMA), 'body' (electrodes on J6)
    var names = st.labels, k;
    if (src === 'body') {
      var all = names.concat(['REF', 'BIAS']), hc = hcOffsets(all.length, e.hc * st.hcScale, st.seed), mul = mulFactors(all.length, st.zSpread, st.seed);
      all.forEach(function (nm, i) { B.electrode(nm, e, {mul: mul[i] * (st.zMul[nm] || 1), hc: hc[i], on: st.contact[nm] !== false}); });
      for (k = 0; k < 8; k++) { c.R('J6p' + k, 'cab:' + names[k], 'AIN' + (k + 1) + 'P', 1e-3); }
      /* negative inputs: with SRB1 the reference electrode goes to REF_ELEC, else each AINxN to the REF cable */
      c.R('J6ref', 'cab:REF', 'REF_ELEC', 1e-3);                 // reference electrode on REF_ELEC (JP25), routed to SRB1
      for (k = 0; k < 8; k++) c.R('AINn:open' + k, 'AIN' + (k + 1) + 'N', 'MID', 1e12);
      if (j.biasElec === 'u11') c.R('R10b', 'BIAS_ELEC', 'cab:BIAS', 4.99e3);
    } else {
      /* J6 jumpers installed: all AINxP on the Ain+ bus, all AINxN on the Ain- bus; JP25 ties buses to VCM */
      c.R('R10', 'BIAS_ELEC', 'VCM', 4.99e3);
      for (k = 0; k < 8; k++) { c.R('J6p' + k, 'AINP_BUS', 'AIN' + (k + 1) + 'P', 1e-3); c.R('J6n' + k, 'AINN_BUS', 'AIN' + (k + 1) + 'N', 1e-3); }
      if (j.jp25_12) c.R('JP25_12', 'AINN_BUS', 'VCM', 1e-3); else c.R('AINN:open', 'AINN_BUS', 'MID', 1e12);
      if (j.jp25_34) c.R('JP25_34', 'AINP_BUS', 'VCM', 1e-3);
      else if (src === 'gen') {
        /* signal generator on the AIN1 SMA (R12 4.99 kOhm, C75 4.7 nF) drives the Ain+ bus */
        c.V('Vgen', 'GEN', 'VCMg', {dc: 0, ac: 0});
        c.R('Rgen', 'BIAS_ELEC', 'VCMg', 1e-3);
        c.R('R12', 'GEN', 'AINP_BUS', 4.99e3); c.C('C75', 'AINP_BUS', '0', 4.7e-9);
      } else c.R('AINP:open', 'AINP_BUS', 'MID', 1e12);
      if (j.jp25_56) c.R('R11', 'VCM', 'REF_ELEC', 4.99e3);
      else c.R('REF:open', 'REF_ELEC', 'MID', 1e12);
    }
    /* per-channel input filters R80..R95 / C80..C93, C72, C73 */
    for (k = 0; k < 8; k++) {
      ['P', 'N'].forEach(function (s) {
        var a = 'AIN' + (k + 1) + s, pin = 'IN' + (k + 1) + s;
        c.R('Rf:' + pin, a, pin, tR(filt.R)); c.C('Cf:' + pin, pin, '0', tC(filt.C));
        if (s === 'P' || !st.srb1) B.pinModel(pin); else c.R('Rnc:' + pin, pin, 'MID', 1e12);
      });
    }
    /* REF_ELEC to SRB1: JP8 1-2 direct, or JP8 2-3 + JP7 1-2 through U4 (OPA376) */
    if (j.refBuf) {
      c.U('U4', 'REF_ELEC', 'SRB1', 'SRB1', {A0: 1e6, GBW: 5.5e6, VMAX: B.r.avdd, VMIN: B.r.avss, EN: 7.5e-9, FC: 53, ROUT: 20});
      c.R('Rref:in', 'REF_ELEC', 'MID', 1e12);
    } else c.R('JP8', 'REF_ELEC', 'SRB1', 1e-3);
    B.pinModel('SRB1', st.srb1 ? 8 : 1);
    var I = chip.loffI[st.ilead];
    if (st.loffMode !== 'off') for (k = 0; k < 8; k++) {
      var flip = (st.loffFlip >> k) & 1;
      if ((st.loffP >> k) & 1) B.loff('IN' + (k + 1) + 'P', !flip, I);
      if ((st.loffN >> k) & 1) B.loff(st.srb1 ? 'SRB1' : 'IN' + (k + 1) + 'N', !!flip, I);
    }
    /* bias loop: R8 392 kOhm, C20 10 nF on the board.  BIAS_DRV reaches BIAS_ELEC only with JP1 */
    if (st.biasOn) {
      var taps = [];
      for (k = 0; k < 8; k++) {
        if ((st.biasP >> k) & 1) taps.push('IN' + (k + 1) + 'P');
        if ((st.biasN >> k) & 1) taps.push(st.srb1 ? 'SRB1' : 'IN' + (k + 1) + 'N');
      }
      B.biasLoop(taps, j.biasElec === 'drv' ? (src === 'body' ? 'cab:BIAS' : 'BIAS_ELEC') : 'BIAS_DRV', {Rf: 392e3, Cf: 10e-9, Rprot: 1});
      if (j.biasElec !== 'drv') c.R('BIAS_DRV:open', 'BIAS_DRV', 'MID', 1e12);
    }
    if (j.biasElec === 'drv' && !st.biasOn) { c.R('BE:float', src === 'body' ? 'cab:BIAS' : 'BIAS_ELEC', 'MID', 1e12); B.notes.push('JP1 接 BIAS_DRV 但 BIAS 放大器關閉：BIAS_ELEC 浮接。'); }
    if (j.biasElec === 'drv' && src !== 'body') c.R('BE:vcm', 'BIAS_ELEC', 'VCM', 4.99e3);
    for (k = 0; k < 8; k++) {
      B.channels.push({idx: k, name: 'CH' + (k + 1), label: src === 'body' ? names[k] : 'AIN' + (k + 1), p: 'IN' + (k + 1) + 'P', n: st.srb1 ? 'SRB1' : 'IN' + (k + 1) + 'N',
        gain: st.gain[k], mux: st.mux[k], pd: !!st.pd[k], eP: src === 'body' ? names[k] : null, eN: src === 'body' ? 'REF' : null});
    }
    return B.result({pdk: true});
  }

  /* ===================== front end from a schematic document ===================== */
  /* st.doc is a circuit-sim document with one IC of the selected chip.  Everything outside the chip
     comes from the drawing; ELEC parts become Randles electrodes on the body; the chip becomes its
     input-pin, switch, lead-off, bias-amplifier and reference models on the nets of its pins. */
  var ELEC_KEYS = {wet: 'wet', dry: 'dry', gel: 'gel'};
  function elecParams(part, st) {
    var base = ELECTRODES[ELEC_KEYS[(part.params.TYPE || '').toLowerCase()]] || st.elec || ELECTRODES.wet, e = {};
    for (var k in base) e[k] = base[k];
    if (part.params.RS) e.Rs = CS.num(part.params.RS);
    if (part.params.RCT) e.Rct = CS.num(part.params.RCT);
    if (part.params.CDL) e.Cdl = CS.num(part.params.CDL);
    return e;
  }
  function docElectrodes(text) {
    return CS.parseDoc(text).parts.filter(function (p) { return p.type === 'ELEC'; }).map(function (p) { return p.name; });
  }
  /* capacitance drawn directly between two nets */
  function capBetween(doc, a, b) {
    var s = 0;
    doc.parts.forEach(function (p) {
      if (p.type !== 'C') return;
      var n = p.nets;
      if ((n[0] === a && n[1] === b) || (n[0] === b && n[1] === a)) s += p.params.value;
    });
    return s;
  }
  /* nets reachable from 'net' through two-pin parts of the drawing whose type matches 'types' */
  function passiveReach(doc, net, depth, types) {
    var seen = {}, front = [net], re = types || /^(R|C|L|SW|TVS|D)$/;
    seen[net] = true;
    for (var d = 0; d < depth && front.length; d++) {
      var next = [];
      doc.parts.forEach(function (p) {
        if (!re.test(p.type)) return;
        var a = p.nets[0], b = p.nets[1];
        front.forEach(function (f) {
          if (a === f && !seen[b] && b !== '0') { seen[b] = true; next.push(b); }
          if (b === f && !seen[a] && a !== '0') { seen[a] = true; next.push(a); }
        });
      });
      front = next;
    }
    return seen;
  }

  function expandADS1299(c, ic, st, rails, chip) {
    var pre = ic.name + ':', N = {}, out = {channels: [], loffSrc: [], notes: [], taps: []};
    CS.IC_LIB[ic.sym].pins.forEach(function (pd, i) { N[pd.name] = ic.nets[i]; });
    var MID = pre + 'MID', avdd = N.AVDD, avss = N.AVSS;
    c.V(pre + 'VMID', MID, avss, (rails.avdd - rails.avss) / 2);
    function pinModel(pin, count) {
      var net = N[pin];
      c.C(pre + 'Cin:' + pin, net, avss, chip.cin * count);
      c.R(pre + 'Rin:' + pin, net, MID, chip.rin / count);
      if (st.ibias) c.I(pre + 'Ib:' + pin, MID, net, {dc: chip.ibias * count * st.ibiasSign});
    }
    function open(pin) { c.R(pre + 'Rnc:' + pin, N[pin], MID, 1e12); }
    var anySrb2 = false;
    for (var k = 0; k < 8; k++) {
      var P = 'IN' + (k + 1) + 'P', Nn = 'IN' + (k + 1) + 'N';
      pinModel(P, 1);
      if (st.srb1) open(Nn); else pinModel(Nn, 1);
      if ((st.srb2 >> k) & 1) { c.add('SW', pre + 'SRB2:' + (k + 1), [N[P], N.SRB2], {on: true, RON: 10, ROFF: 1e14}); anySrb2 = true; }
    }
    if (st.srb1) pinModel('SRB1', 8); else open('SRB1');
    if (!anySrb2) open('SRB2');
    function negPin(k) { return st.srb1 ? 'SRB1' : 'IN' + (k + 1) + 'N'; }
    /* lead-off excitation */
    var I = chip.loffI[st.ilead];
    function loff(pin, up) {
      var name = pre + 'Ilo:' + pin + (up ? '+' : '-'), net = N[pin];
      if (st.loffMode === 'dc') { if (up) c.I(name, avdd, net, {dc: I, VC: 0.05}); else c.I(name, net, avss, {dc: I, VC: 0.05}); }
      else { c.I(name, MID, net, {dc: 0, ac: 0}); out.loffSrc.push({name: name, pin: net, sign: up ? 1 : -1, I: I}); }
    }
    if (st.loffMode !== 'off') for (k = 0; k < 8; k++) {
      var flip = (st.loffFlip >> k) & 1;
      if ((st.loffP >> k) & 1) loff('IN' + (k + 1) + 'P', !flip);
      if ((st.loffN >> k) & 1) loff(negPin(k), !!flip);
    }
    /* bias amplifier: internal taps (buffered PGA inputs through Rsum) into BIASINV */
    if (st.biasRefInt !== false) c.R(pre + 'Rbref', MID, N.BIASREF, 1e3);
    else c.R(pre + 'Rbref', MID, N.BIASREF, 1e12);
    if (st.biasOn) {
      c.U(pre + 'BIAS', N.BIASREF, N.BIASINV, N.BIASOUT, {A0: 1e5, GBW: chip.bias.gbw, VMAX: rails.avdd - 0.05, VMIN: rails.avss + 0.05, ILIM: chip.bias.isc, EN: chip.bias.en, ROUT: 50});
      var rs = chip.bias.rsum;
      for (k = 0; k < 8; k++) {
        if ((st.biasP >> k) & 1) out.taps.push('IN' + (k + 1) + 'P');
        if ((st.biasN >> k) & 1) out.taps.push(negPin(k));
      }
      out.taps.forEach(function (pin, i) {
        c.G(pre + 'Gtap' + i, '0', N.BIASINV, N[pin], '0', 1 / rs);
        c.R(pre + 'Rtap' + i, N.BIASINV, '0', rs);
      });
    } else c.R(pre + 'Roff:BIASOUT', N.BIASOUT, MID, 1e12);
    if (!st.biasOn || !out.taps.length) c.R(pre + 'Rnc:BIASINV', N.BIASINV, MID, 1e12);
    c.R(pre + 'Rnc:BIASIN', N.BIASIN, MID, 1e12);
    /* internal reference VREFP - VREFN = 4.5 V (PD_REFBUF = 1); otherwise the pins wait for an external one */
    if (st.refBuf) { c.V(pre + 'VREF', pre + 'vref', N.VREFN, 4.5); c.R(pre + 'Rref', pre + 'vref', N.VREFP, 10); }
    else c.R(pre + 'Rnc:VREFP', N.VREFP, N.VREFN, 1e12);
    ['VCAP1', 'VCAP2', 'VCAP3', 'VCAP4'].forEach(function (pin) { c.R(pre + 'Rnc:' + pin, N[pin], MID, 1e9); });
    for (k = 0; k < 8; k++) {
      out.channels.push({idx: k, name: 'CH' + (k + 1), label: '', p: N['IN' + (k + 1) + 'P'], n: N[negPin(k)],
        gain: st.gain[k], mux: st.mux[k], pd: !!st.pd[k]});
    }
    out.N = N;
    return out;
  }

  function buildDoc(st) {
    var tb = performance.now(), chip = CHIPS[st.chip], doc = CS.parseDoc(st.doc);
    var ics = doc.parts.filter(function (p) { return p.type === 'IC' && p.sym === chip.id; });
    if (!ics.length) throw new Error('電路圖裡沒有 ' + chip.name + '（IC 元件）');
    var elecs = doc.parts.filter(function (p) { return p.type === 'ELEC'; });
    var hcu = hcOffsets(elecs.length, 1, st.seed), mul = mulFactors(elecs.length, st.zSpread, st.seed);
    function once(rails) {
      var built = CS.buildFromDoc(doc), c = built.circuit, env = st.env, fe = {elecs: [], notes: [], hard: []};
      built.errors.forEach(function (e) { fe.hard.push(e); });
      try {
        c.V('Vmains', 'mains', 'earth', {dc: 0, ac: 1});
        c.C('Cpow', 'mains', 'body', env.Cpow);
        c.C('Cbody', 'body', 'earth', env.Cbody);
        c.C('Ciso', 'earth', '0', env.Ciso);
        c.R('Rleak', 'earth', '0', 1e12);
      } catch (e) { throw new Error('元件名稱 Vmains、Cpow、Cbody、Ciso、Rleak 保留給人體與市電模型：' + e.message); }
      elecs.forEach(function (p, i) {
        var e = elecParams(p, st), name = p.name, m = mul[i] * (st.zMul[name] || 1), on = st.contact[name] !== false, cab = p.nets[0], hc = hcu[i] * e.hc * st.hcScale;
        c.V('Ve:' + name, 'site:' + name, 'body', {dc: hc, ac: 0});
        c.R('Rs:' + name, 'site:' + name, 'm:' + name, e.Rs * m);
        c.R('Rct:' + name, 'm:' + name, 'el:' + name, e.Rct * m);
        c.C('Cdl:' + name, 'm:' + name, 'el:' + name, e.Cdl / m);
        c.add('SW', 'K:' + name, ['el:' + name, cab], {on: on, RON: 0.01, ROFF: 1e14});
        c.C('Ccab:' + name, cab, '0', env.Ccab);
        if (env.Cstray > 0) c.C('Cst:' + name, 'mains', cab, env.Cstray);
        fe.elecs.push({name: name, src: 'Ve:' + name, mul: m, z10: electrodeZ(e, 10, m), on: on, hc: hc, net: cab, type: e.label});
      });
      var x = expandADS1299(c, ics[0], st, rails, chip);
      var sim = new CS.Sim(c), op = sim.op();
      fe.built = built; fe.circuit = c; fe.sim = sim; fe.op = op; fe.x = x;
      return fe;
    }
    var guess = st.railGuess || {avdd: 2.5, avss: -2.5};
    var fe = once(guess), N = fe.x.N, sim = fe.sim;
    var rails = {avdd: sim.v(N.AVDD), avss: sim.v(N.AVSS)};
    var railsOk = isFinite(rails.avdd) && isFinite(rails.avss) && rails.avdd - rails.avss > 0.5;
    if (railsOk && (Math.abs(rails.avdd - guess.avdd) > 1e-3 || Math.abs(rails.avss - guess.avss) > 1e-3)) { fe = once(rails); N = fe.x.N; sim = fe.sim; }
    if (!railsOk) { rails = guess; fe.notes.push('AVDD／AVSS 沒有接到電源：用 ' + fmtV(guess.avdd) + '／' + fmtV(guess.avss) + ' 當電源軌繼續算。'); }
    if (ics.length > 1) fe.notes.push('電路圖有 ' + ics.length + ' 顆 ' + chip.name + '，只模擬 ' + ics[0].name + '。');
    /* ---- design checks ---- */
    var notes = fe.notes, x = fe.x, span = rails.avdd - rails.avss;
    function v(net) { return sim.v(net); }
    if (railsOk && (span < 4.75 || span > 5.25)) notes.push('AVDD − AVSS = ' + fmtV(span) + '：ADS1299 需要 4.75–5.25 V。');
    var dgnd = isFinite(v(N.DGND)) ? v(N.DGND) : 0, dvdd = v(N.DVDD) - dgnd;
    if (!isFinite(dvdd)) { notes.push('DVDD 沒有接電源：數位電路（SPI、時脈）不會動。'); dvdd = 3.3; }
    else if (dvdd < 1.8 || dvdd > 3.6) notes.push('DVDD − DGND = ' + fmtV(dvdd) + '：資料手冊範圍 1.8–3.6 V。');
    if (N.VREFN !== N.AVSS) notes.push('VREFN 要接到 AVSS（資料手冊腳位說明）；現在接在「' + N.VREFN + '」。');
    var cref = capBetween(doc, N.VREFP, N.VREFN);
    if (cref < 9.5e-6) notes.push('VREFP 對 VREFN 的電容 ' + CS.fmt(cref, 'F') + '：資料手冊要至少 10 µF，參考電壓的雜訊才會是表上的值。');
    [['VCAP1', 100e-6], ['VCAP2', 1e-6], ['VCAP3', 1e-6], ['VCAP4', 1e-6]].forEach(function (q) {
      var cv = capBetween(doc, N[q[0]], N.AVSS);
      if (cv < q[1] * 0.95) notes.push(q[0] + ' 對 AVSS 的電容 ' + CS.fmt(cv, 'F') + '：資料手冊要 ' + CS.fmt(q[1], 'F') + '（內部穩壓器的旁路電容）。');
    });
    if (capBetween(doc, N.AVDD, '0') + capBetween(doc, N.AVDD, N.AVSS) <= 0) notes.push('AVDD 沒有去耦電容。');
    if (st.refBuf === false && !(v(N.VREFP) - v(N.VREFN) > 0.5)) notes.push('內部參考關閉（PD_REFBUF = 0），VREFP 又沒有外部參考電壓。');
    /* clock: CLKSEL high = internal 2.048 MHz oscillator, low = external clock on CLK */
    var st2 = {}, kk;
    for (kk in st) st2[kk] = st[kk];
    var clksel = v(N.CLKSEL) - dgnd, clk = {internal: true, f: chip.fclk * st.clkErr};
    if (!(clksel > dvdd / 2)) {
      clk.internal = false;
      var ci = fe.circuit.nodeIdx[N.CLK], src = null;
      fe.circuit.elements.forEach(function (el) { if (el.type === 'V' && el.p.w.freq > 0 && ci !== undefined && el.nodes.indexOf(ci) >= 0) src = el; });
      if (src) { clk.f = src.p.w.freq; clk.src = src.name; }
      else { clk.f = chip.fclk; notes.push('CLKSEL 接低（外部時脈），但 CLK 腳沒有接時脈源：沒有時脈晶片不會轉換。這裡假設 2.048 MHz 繼續算。'); }
      if (src && Math.abs(clk.f / chip.fclk - 1) > 0.05) notes.push('外部時脈 ' + CS.fmt(clk.f, 'Hz') + '，資料手冊標稱 2.048 MHz（1.6–2.1 MHz）。');
    }
    st2.clkErr = clk.f / chip.fclk; st2.dvdd = dvdd; st2.supply = Math.abs(rails.avdd + rails.avss) < 0.2 ? 'bi' : 'uni';
    var vref = v(N.VREFP) - v(N.VREFN);
    if (!(vref > 0.5)) vref = 4.5;
    if (st.biasOn && isFinite(v(N.BIASOUT)) && (v(N.BIASOUT) > rails.avdd - 0.15 || v(N.BIASOUT) < rails.avss + 0.15))
      notes.push('BIAS 放大器輸出 ' + fmtV(v(N.BIASOUT)) + '，撞到電源軌了：' + (x.taps.length ? '迴路沒有閉合（例如 BIAS 電極沒接上，或沒有回授）。' : 'BIAS_SENSP／N 一個都沒選，BIASINV 又沒有外部回授，放大器開迴路。'));
    if (!fe.op.ok) notes.push('DC 工作點沒有收斂，結果可能不可信。');
    fe.hard.forEach(function (e) { notes.unshift(e); });
    return {chip: chip, st: st2, circuit: fe.circuit, channels: x.channels, elecs: fe.elecs, notes: notes, rails: rails, loffSrc: x.loffSrc,
      doc: doc, built: fe.built, sim: sim, op: fe.op, pinNets: N, vref: vref, clk: clk, taps: x.taps, ic: ics[0],
      biasOutNode: N.BIASOUT, biasInNode: N.BIASIN, fromDoc: true, buildMs: performance.now() - tb};
  }
  function fmtV(v) { return CS.fmt(v, 'V', 3); }

  function build(st) {
    if (st.doc) return buildDoc(st);
    if (st.board === 'pdk') return buildPDK(st);
    return st.chip === 'ads1294' ? buildADS1294(st) : buildADS1299(st);
  }

  /* ===================== analysis ===================== */
  function analyze(fe) {
    var chip = fe.chip, st = fe.st, sim = fe.sim || new CS.Sim(fe.circuit), r = fe.rails, t0 = performance.now() - (fe.buildMs || 0);
    var op = fe.op || sim.op();
    var VREF = fe.vref !== undefined ? fe.vref : vref(chip, st), fD = fdr(chip, st), fM = fmod(chip, st), N = decim(chip, st);
    var res = {op: op, sim: sim, fdr: fD, fmod: fM, decim: N, vref: VREF, ch: [], warn: [], rails: r};
    var span = r.avdd - r.avss;
    /* ---- DC ---- */
    fe.channels.forEach(function (ch) {
      var vp = sim.v(ch.p), vn = sim.v(ch.n), cm = (vp + vn) / 2, vd = vp - vn;
      var o = {vp: vp, vn: vn, cm: cm, vd: vd};
      o.headroom = Math.min(r.avdd - 0.2 - (cm + ch.gain * Math.abs(vd) / 2), (cm - ch.gain * Math.abs(vd) / 2) - (r.avss + 0.2));
      var thP = [0.95, 0.925, 0.90, 0.875, 0.85, 0.80, 0.75, 0.70][st.compTh], thN = 1 - thP;
      function off(v) { return v > r.avss + thP * span || v < r.avss + thN * span; }
      o.loffP = st.loffMode !== 'off' && st.compOn && !!((st.loffP >> ch.idx) & 1) && off(vp);
      o.loffN = st.loffMode !== 'off' && st.compOn && !!((st.loffN >> ch.idx) & 1) && off(vn);
      res.ch.push(o);
    });
    res.bodyDC = sim.v('body');
    res.biasOut = fe.biasOutNode ? sim.v(fe.biasOutNode) : fe.circuit.nodeIdx.BIASOUT !== undefined ? sim.v('BIASOUT') : NaN;
    res.biasIn = fe.biasInNode ? sim.v(fe.biasInNode) : NaN;
    /* ---- AC: mains (fundamental and 3rd harmonic), EEG-band mixing, lead-off excitation, generator ---- */
    var mainsAmp = st.env.mainsV * Math.SQRT2, f0 = st.env.mainsF;
    function diff(sol, ch) { var a = sim.vac(sol, ch.p), b = sim.vac(sol, ch.n); return [a[0] - b[0], a[1] - b[1]]; }
    function cmv(sol, ch) { var a = sim.vac(sol, ch.p), b = sim.vac(sol, ch.n); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
    [1, 3].forEach(function (h) {
      var sol = sim.acMulti(f0 * h, [{name: 'Vmains', mag: mainsAmp * (h === 1 ? 1 : st.env.h3)}])[0];
      fe.channels.forEach(function (ch, i) {
        res.ch[i]['mains' + h] = diff(sol, ch);
        res.ch[i]['cm' + h] = cmv(sol, ch);
      });
      if (h === 1) res.bodyAC = Math.hypot.apply(null, sim.vac(sol, 'body'));
    });
    var ve = fe.elecs.map(function (e) { return {name: e.src, mag: 1}; });
    if (ve.length) {
      var mix = sim.acMulti(10, ve);
      fe.channels.forEach(function (ch, i) {
        res.ch[i].mix = fe.elecs.map(function (e, j) { var d = diff(mix[j], ch); return d[0]; });
      });
    } else fe.channels.forEach(function (ch, i) { res.ch[i].mix = []; });
    if (fe.fromDoc) {
      /* name each channel after the electrodes that reach it, with their sign */
      fe.channels.forEach(function (ch, i) {
        var pos = [], neg = [];
        res.ch[i].mix.forEach(function (m, j) { if (m > 0.3) pos.push(fe.elecs[j].name); else if (m < -0.3) neg.push(fe.elecs[j].name); });
        ch.label = !pos.length && !neg.length ? '（沒有電極）' : (pos.join(' + ') || '0') + (neg.length ? ' − ' + neg.join(' − ') : '');
      });
      /* bias-driven or grounded (through resistors) electrodes are not meant to reach a channel */
      var drive = passiveReach(fe.doc, fe.biasOutNode, 6), grounded = passiveReach(fe.doc, '0', 6, /^(R|L|SW)$/);
      fe.elecs.forEach(function (e, j) {
        var mx = 0;
        res.ch.forEach(function (o) { mx = Math.max(mx, Math.abs(o.mix[j] || 0)); });
        if (mx < 0.05 && e.on && !drive[e.net] && !grounded[e.net]) res.warn.push(e.name + ' 電極沒有進到任何通道：檢查它接的輸入腳，以及 SRB1／SRB2 的設定。');
      });
    }
    if (fe.loffSrc.length) {
      var fl = loffFreq(chip, st), lo = [];
      [1, 3, 5].forEach(function (h) {
        var sols = sim.acMulti(fl * h, fe.loffSrc.map(function (s) { return {name: s.name, mag: s.sign * s.I}; }));
        lo.push(sols);
      });
      fe.channels.forEach(function (ch, i) {
        res.ch[i].loffAC = [0, 1, 2].map(function (hi) {
          var acc = [0, 0];
          lo[hi].forEach(function (sol) { var d = diff(sol, ch); acc[0] += d[0]; acc[1] += d[1]; });
          return acc;
        });
      });
      res.loffF = fl;
    }
    if (fe.circuit.byName.Vgen && st.gen) {
      var gs = sim.acMulti(Math.max(st.gen.f, 0.01), [{name: 'Vgen', mag: 1}])[0];
      fe.channels.forEach(function (ch, i) { res.ch[i].gen = diff(gs, ch); });
    }
    /* ---- noise of the circuit (resistors, electrodes, amplifiers) through the sinc3 response ---- */
    var fmax = fD / 2, freqs = CS.logspace(0.05, fmax, 28);
    var outs = fe.channels.map(function (ch) { return [ch.p, ch.n]; });
    var nz = sim.noiseMulti(outs, freqs);
    var w = freqs.map(function (f) { var h = sinc3(f, fM, N); return h * h; });
    fe.channels.forEach(function (ch, i) {
      var tot = Array.prototype.map.call(nz[i].total, function (v, k) { return v * w[k]; });
      res.ch[i].circRms = Math.sqrt(CS.integrate(freqs, tot, 0.05, fmax));
      var parts = [];
      Object.keys(nz[i].parts).forEach(function (nm) {
        var p = Array.prototype.map.call(nz[i].parts[nm], function (v, k) { return v * w[k]; }), v2 = CS.integrate(freqs, p, 0.05, fmax);
        if (v2 > 0) parts.push({name: nm, rms: Math.sqrt(v2)});
      });
      parts.sort(function (a, b) { return b.rms - a.rms; });
      res.ch[i].noiseParts = parts.slice(0, 6);
      res.ch[i].chipNoise = chipNoise(chip, st, ch.gain);
      res.ch[i].psd = {f: freqs, v: Array.prototype.map.call(nz[i].total, Math.sqrt)};
    });
    res.ms = performance.now() - t0;
    if (!op.ok && !fe.fromDoc) res.warn.push('DC 工作點沒有收斂，結果可能不可信。');
    return res;
  }

  /* CM (mains) at the body vs frequency with the present circuit, for the bias-loop plot */
  function cmSweep(fe, res, f0, f1, n) {
    var sim = res.sim, out = [], amp = fe.st.env.mainsV * Math.SQRT2;
    CS.logspace(f0, f1, n).forEach(function (f) {
      var sol = sim.acMulti(f, [{name: 'Vmains', mag: amp}])[0], b = sim.vac(sol, 'body');
      var row = {f: f, body: Math.hypot(b[0], b[1]), ch: []};
      fe.channels.forEach(function (ch) { var a = sim.vac(sol, ch.p), c = sim.vac(sol, ch.n); row.ch.push(Math.hypot(a[0] - c[0], a[1] - c[1])); });
      out.push(row);
    });
    return out;
  }

  /* ===================== signal sources ===================== */
  /* EEG: per-electrode background (1/f-like), alpha, eye blinks, EMG.  Values in volts. */
  function EEGSource(labels, opts, fs, seed) {
    this.labels = labels; this.o = opts; this.fs = fs; this.r = CS.rng(seed || 3);
    this.n = labels.length; this.t = 0;
    this.st = labels.map(function () { return {a1: 0, a2: 0, a3: 0, e1: 0, e2: 0, ph: 0, env: 0}; });
    this.common = {a1: 0, a2: 0};
    this.blinkAt = 1.5; this.blinkAmp = 0;
    var self = this;
    this.alphaW = labels.map(function (l) { return /^O|^P[3-8z]|^Pz/.test(l) ? 1 : /^C|^T[5-6]/.test(l) ? 0.35 : 0.15; });
    this.blinkW = labels.map(function (l) { return /^Fp/.test(l) ? 1 : /^F[3-8z]|^AF/.test(l) ? 0.4 : /^C/.test(l) ? 0.1 : 0.03; });
    this.emgW = labels.map(function (l) { return /^T|^F7|^F8/.test(l) ? 1 : /^Fp|^F/.test(l) ? 0.5 : 0.15; });
    this.phase = labels.map(function () { return self.r() * 6.283; });
  }
  EEGSource.prototype.next = function (out) {
    var dt = 1 / this.fs, o = this.o, r = this.r, n = this.n, i;
    function ar(prev, fc, sigma) { var a = Math.exp(-2 * Math.PI * fc * dt); return a * prev + sigma * Math.sqrt(1 - a * a) * CS.gauss(r); }
    var cm = this.common;
    cm.a1 = ar(cm.a1, 1.0, 8e-6); cm.a2 = ar(cm.a2, 8, 3e-6);
    /* blinks */
    if (o.blinks && this.t >= this.blinkAt) { this.blinkPeak = this.t + 0.12; this.blinkAt = this.t + 2.5 + 3 * r(); }
    var bl = 0;
    if (o.blinks && this.blinkPeak !== undefined) { var d = (this.t - this.blinkPeak) / 0.07; if (Math.abs(d) < 5) bl = 150e-6 * Math.exp(-d * d / 2); }
    var alphaA = o.eyesClosed ? 30e-6 : 6e-6;
    for (i = 0; i < n; i++) {
      var s = this.st[i];
      s.a1 = ar(s.a1, 1.0, 10e-6); s.a2 = ar(s.a2, 6, 5e-6); s.a3 = ar(s.a3, 25, 2e-6);
      s.env = ar(s.env, 0.4, 0.35);
      var alpha = alphaA * this.alphaW[i] * Math.max(0, 0.8 + s.env) * Math.sin(2 * Math.PI * 10.2 * this.t + this.phase[i]);
      var emg = 0;
      if (o.emg) { s.e1 = ar(s.e1, 150, 1); s.e2 = ar(s.e2, 30, 1); emg = 25e-6 * this.emgW[i] * (s.e1 - s.e2); }
      out[i] = (o.background ? 0.6 * (cm.a1 + cm.a2) + s.a1 + s.a2 + s.a3 : 0) + alpha + bl * this.blinkW[i] + emg;
    }
    this.t += dt;
  };

  /* ECG: heart dipole as a sum of Gaussian waves (P, Q, R, S, T), projected on electrode lead vectors.
     RA, LA, LL on the Einthoven triangle (their mean, the WCT, is zero); V1, V2 mostly anterior. */
  var ECG_WAVES = [
    {t: 0.10, s: 0.025, a: 0.15e-3, d: [0.5, 0.8, 0.1]},
    {t: 0.20, s: 0.010, a: 0.12e-3, d: [-0.6, -0.2, 0.4]},
    {t: 0.225, s: 0.011, a: 1.4e-3, d: [0.55, 0.75, -0.35]},
    {t: 0.250, s: 0.012, a: 0.45e-3, d: [-0.3, -0.5, -0.8]},
    {t: 0.46, s: 0.045, a: 0.32e-3, d: [0.5, 0.7, 0.25]}
  ];
  var ECG_LEADS = {RA: [-0.866 * 0.5, -0.5 * 0.5, 0], LA: [0.866 * 0.5, -0.5 * 0.5, 0], LL: [0, 0.5, 0],
    V1: [-0.25, 0.05, 0.9], V2: [0.1, 0.1, 1.0], RL: [0, 0, 0]};
  function ECGSource(labels, opts, fs, seed) {
    this.labels = labels; this.o = opts; this.fs = fs; this.r = CS.rng(seed || 5); this.t = 0; this.beat = 0.2; this.rr = 60 / (opts.hr || 72);
    this.wander = labels.map(function () { return 0; }); this.emg = labels.map(function () { return 0; });
  }
  ECGSource.prototype.next = function (out) {
    var o = this.o, dt = 1 / this.fs, r = this.r, t = this.t, i, k;
    if (t - this.beat > this.rr) { this.beat += this.rr; this.rr = 60 / (o.hr || 72) * (1 + 0.03 * Math.sin(2 * Math.PI * 0.25 * t) + 0.01 * CS.gauss(r)); }
    var tb = t - this.beat, H = [0, 0, 0];
    for (k = 0; k < ECG_WAVES.length; k++) {
      var w = ECG_WAVES[k], g = (tb - w.t) / w.s;
      if (Math.abs(g) < 6) { var a = w.a * (o.amp || 1) * Math.exp(-g * g / 2); H[0] += a * w.d[0]; H[1] += a * w.d[1]; H[2] += a * w.d[2]; }
    }
    var pace = o.pace && tb >= 0.03 && tb < 0.0305 ? 5e-3 : 0;
    for (i = 0; i < this.labels.length; i++) {
      var L = ECG_LEADS[this.labels[i]] || [0, 0, 0], v = 1.2 * (H[0] * L[0] + H[1] * L[1] + H[2] * L[2]);
      if (o.wander) { this.wander[i] = 0.9995 * this.wander[i] + 4e-6 * CS.gauss(r); v += this.wander[i] + 0.1e-3 * Math.sin(2 * Math.PI * 0.25 * t + i); }
      if (o.emg && this.labels[i] !== 'RL') { var a2 = Math.exp(-2 * Math.PI * 80 * dt); this.emg[i] = a2 * this.emg[i] + 30e-6 * Math.sqrt(1 - a2 * a2) * CS.gauss(r); v += this.emg[i]; }
      if (pace && (this.labels[i] === 'RA' || this.labels[i] === 'LA')) v += (this.labels[i] === 'LA' ? 1 : -1) * pace / 2;
      out[i] = v;
    }
    this.t += dt;
  };

  /* ===================== behavioural ADC stream ===================== */
  /* sinc3 at R x fDR: impulse response = box(R) * box(R) * box(R), length 3R - 2, sum 1 */
  function sincTaps(R) {
    var box = []; for (var i = 0; i < R; i++) box.push(1 / R);
    function conv(a, b) { var o = new Array(a.length + b.length - 1).fill(0); for (var p = 0; p < a.length; p++) for (var q = 0; q < b.length; q++) o[p + q] += a[p] * b[q]; return o; }
    return conv(conv(box, box), box);
  }

  function Stream(fe, res, st) {
    var chip = fe.chip;
    this.fe = fe; this.res = res; this.st = st; this.chip = chip;
    this.fdr = res.fdr; this.R = this.fdr <= 1000 ? 8 : this.fdr <= 4000 ? 4 : 2;
    this.fs = this.fdr * this.R; this.taps = sincTaps(this.R); this.L = this.taps.length;
    this.t = 0; this.n = 0;
    this.nch = fe.channels.length;
    this.hist = fe.channels.map(function () { return new Float64Array(64); });
    this.hpos = 0;
    this.rnd = CS.rng(st.seed * 7 + 1);
    this.offsets = fe.channels.map(function (c, i) { var r = CS.rng(st.seed + 31 * i + 5); return st.chipOffset ? chip.offsetTyp * 0.6 * CS.gauss(r) : 0; });
    this.cmrrSign = fe.channels.map(function (c, i) { return (i % 2 ? -1 : 1) * (0.5 + 0.5 * ((i * 37) % 7) / 7); });
    var labs = fe.elecs.map(function (e) { return e.name; });
    this.elecV = new Float64Array(labs.length);
    if (st.sig && st.sig.kind === 'ecg') this.srcGen = new ECGSource(labs, st.sig, this.fs, st.seed + 2);
    else if (st.sig && st.sig.kind === 'eeg') this.srcGen = new EEGSource(labs, st.sig, this.fs, st.seed + 2);
    this.test = testSignal(chip, st);
    this.mainsW = 2 * Math.PI * st.env.mainsF;
    this.loffF = res.loffF || 0;
    var VREF = res.vref;
    this.lsb = fe.channels.map(function (c) { return VREF / c.gain / (Math.pow(2, 23) - 1); });
    /* the external circuit's noise reaches the PGA only when the mux connects the input pins */
    this.noise = res.ch.map(function (o, i) {
      var ext = [0, 6, 7].indexOf(fe.channels[i].mux) >= 0 ? o.circRms : 0;
      return Math.sqrt(o.chipNoise.rms * o.chipNoise.rms + ext * ext);
    });
  }
  /* produce one output sample per channel: codes (Int32-like numbers) and volts (input-referred) */
  Stream.prototype.next = function (codes, volts) {
    var R = this.R, st = this.st, fe = this.fe, res = this.res, chans = fe.channels, rails = res.rails, i, k, j;
    var L = this.L, taps = this.taps;
    for (j = 0; j < R; j++) {
      var t = this.t;
      if (this.srcGen) this.srcGen.next(this.elecV);
      var cw = Math.cos(this.mainsW * t), sw = Math.sin(this.mainsW * t), c3 = Math.cos(3 * this.mainsW * t), s3 = Math.sin(3 * this.mainsW * t);
      var lw = this.loffF ? 2 * Math.PI * this.loffF * t : 0;
      for (i = 0; i < chans.length; i++) {
        var ch = chans[i], o = res.ch[i], x, cm;
        if (ch.pd) { x = 0; cm = (rails.avdd + rails.avss) / 2; }
        else if (ch.mux === 1) { x = 0; cm = (rails.avdd + rails.avss) / 2; }                         // input shorted
        else if (ch.mux === 5) {                                                                     // test signal
          x = this.test.f ? (Math.sin(2 * Math.PI * this.test.f * t) >= 0 ? this.test.amp : -this.test.amp) : this.test.amp;
          cm = (rails.avdd + rails.avss) / 2;
        } else if (ch.mux === 4) { x = (this.chip.tempMv + this.chip.tempCoef * (st.tempC - 25)) * 1e-3; cm = (rails.avdd + rails.avss) / 2; }
        else if (ch.mux === 3) { x = (i === 2 || i === 3) ? st.dvdd / 4 : 0.5 * (rails.avdd - rails.avss); cm = (rails.avdd + rails.avss) / 2; }
        else if (ch.mux === 2) {                                                                     // BIAS_MEAS: BIASIN against mid-supply
          var bm = isFinite(res.biasIn) ? res.biasIn : res.biasOut;
          x = (isFinite(bm) ? bm : 0) - (rails.avdd + rails.avss) / 2; cm = (rails.avdd + rails.avss) / 2;
        }
        else {
          x = o.vd;
          for (k = 0; k < this.elecV.length; k++) x += o.mix[k] * this.elecV[k];
          x += o.mains1[0] * cw - o.mains1[1] * sw + o.mains3[0] * c3 - o.mains3[1] * s3;
          cm = o.cm + o.cm1[0] * cw - o.cm1[1] * sw;
          x += (o.cm1[0] * cw - o.cm1[1] * sw) * Math.pow(10, -this.chip.cmrrTyp / 20) * this.cmrrSign[i];
          if (o.loffAC && this.loffF) {
            for (var h = 0; h < 3; h++) {                                        // square wave: 4/pi (sin w + sin 3w/3 + sin 5w/5)
              var hm = 2 * h + 1, sc = 4 / Math.PI / hm, cc = Math.cos(hm * lw), ss = Math.sin(hm * lw);
              x += sc * (o.loffAC[h][0] * ss + o.loffAC[h][1] * cc);
            }
          }
          if (o.gen && st.gen) {
            var gp = 2 * Math.PI * st.gen.f * t, gv = st.gen.shape === 'square' ? (Math.sin(gp) >= 0 ? 1 : -1) : Math.sin(gp);
            x += st.gen.amp * (st.gen.shape === 'square' ? gv * Math.hypot(o.gen[0], o.gen[1]) : (o.gen[0] * Math.sin(gp) + o.gen[1] * Math.cos(gp)));
          }
        }
        /* PGA: two outputs cm +- G x / 2, each limited to 200 mV from the rails */
        var g = ch.gain, hi = rails.avdd - 0.2, lo = rails.avss + 0.2;
        var op = Math.min(hi, Math.max(lo, cm + g * x / 2)), on = Math.min(hi, Math.max(lo, cm - g * x / 2));
        var y = (op - on) + g * this.offsets[i];
        var hb = this.hist[i];
        if (!this.primed) hb.fill(y);            // start the sinc3 filter settled, as if the input had always been there
        hb[(this.hpos + j) & 63] = y;
      }
      this.t += 1 / this.fs;
      this.primed = true;
    }
    this.hpos = (this.hpos + R) & 63;
    for (i = 0; i < chans.length; i++) {
      var hist = this.hist[i], acc = 0;
      for (k = 0; k < L; k++) acc += taps[k] * hist[(this.hpos - 1 - k + 128) & 63];
      var gn = chans[i].gain, v = acc / gn + this.noise[i] * CS.gauss(this.rnd);
      var code = Math.round(v / this.lsb[i]);
      if (code > 8388607) code = 8388607; if (code < -8388608) code = -8388608;
      if (chans[i].pd) code = 0;
      codes[i] = code; volts[i] = code * this.lsb[i];
    }
    this.n++;
  };
  /* 24-bit status word: 1100 + LOFF_STATP + LOFF_STATN + GPIO[7:4] */
  function statusWord(res) {
    var p = 0, n = 0;
    res.ch.forEach(function (o, i) { if (o.loffP) p |= 1 << i; if (o.loffN) n |= 1 << i; });
    return (0xC << 20) | (p << 12) | (n << 4);
  }

  /* ===================== registers ===================== */
  function hex2(v) { return ('0' + (v & 255).toString(16).toUpperCase()).slice(-2); }
  function regs1299(st) {
    var R = [], chip = CHIPS.ads1299;
    function add(addr, name, v, desc) { R.push({addr: addr, name: name, v: v & 255, desc: desc}); }
    add(0x00, 'ID', 0x3E, '唯讀：bit 4 = 1、DEV_ID = 11、NU_CH = 10（8 通道）；REV_ID 依晶片版本，0x3E 只是例子');
    add(0x01, 'CONFIG1', 0x90 | (st.multiRead ? 0x40 : 0) | (st.clkOut ? 0x20 : 0) | (st.dr & 7), 'DR = ' + st.dr.toString(2).padStart(3, '0') + '（fMOD/' + (64 << st.dr) + '）');
    var testFreq = st.testFreq === 3 ? 3 : st.testFreq;
    add(0x02, 'CONFIG2', 0xC0 | (st.testInt ? 0x10 : 0) | (st.testAmp ? 0x04 : 0) | (testFreq & 3), st.testInt ? '內部測試訊號' : '測試訊號由外部提供');
    add(0x03, 'CONFIG3', 0x60 | (st.refBuf ? 0x80 : 0) | (st.biasMeas ? 0x10 : 0) | (st.biasRefInt ? 0x08 : 0) | (st.biasOn ? 0x04 : 0) | (st.biasLoffSens ? 0x02 : 0),
      (st.refBuf ? '內部參考開' : '內部參考關') + (st.biasOn ? '、BIAS 放大器開' : '') + (st.biasRefInt ? '、BIASREF 內部中點' : ''));
    var flead = {off: 0, dc: 0, ac7: 1, ac31: 2, acdr4: 3}[st.loffMode] || 0;
    add(0x04, 'LOFF', (st.compTh << 5) | ((st.ilead & 3) << 2) | flead, 'COMP_TH = ' + st.compTh + '、ILEAD = ' + st.ilead + '、FLEAD = ' + flead);
    for (var k = 0; k < 8; k++) {
      add(0x05 + k, 'CH' + (k + 1) + 'SET', (st.pd[k] ? 0x80 : 0) | (chip.gainCode[st.gain[k]] << 4) | ((st.srb2 >> k) & 1 ? 0x08 : 0) | (st.mux[k] & 7),
        '增益 ' + st.gain[k] + '、MUX = ' + st.mux[k].toString(2).padStart(3, '0') + (st.pd[k] ? '、關閉' : ''));
    }
    add(0x0D, 'BIAS_SENSP', st.biasP, ''); add(0x0E, 'BIAS_SENSN', st.biasN, '');
    add(0x0F, 'LOFF_SENSP', st.loffMode === 'off' ? 0 : st.loffP, ''); add(0x10, 'LOFF_SENSN', st.loffMode === 'off' ? 0 : st.loffN, '');
    add(0x11, 'LOFF_FLIP', st.loffFlip, '');
    add(0x12, 'LOFF_STATP', 0, '唯讀'); add(0x13, 'LOFF_STATN', 0, '唯讀');
    add(0x14, 'GPIO', 0x0F, '預設：GPIO 全為輸入');
    add(0x15, 'MISC1', st.srb1 ? 0x20 : 0, st.srb1 ? 'SRB1 接到所有通道的負輸入' : '');
    add(0x16, 'MISC2', 0, '');
    add(0x17, 'CONFIG4', (st.singleShot ? 0x08 : 0) | (st.compOn ? 0x02 : 0), st.compOn ? 'lead-off 比較器開' : '');
    return R;
  }
  function regs1294(st) {
    var R = [], chip = CHIPS.ads1294;
    function add(addr, name, v, desc) { R.push({addr: addr, name: name, v: v & 255, desc: desc}); }
    add(0x00, 'ID', 0x90, '唯讀：DEV_ID[7:5] = 100（ADS129x）、[2:0] = 000（4 通道）');
    add(0x01, 'CONFIG1', (st.hr ? 0x80 : 0) | (st.multiRead ? 0x40 : 0) | (st.clkOut ? 0x20 : 0) | (st.dr & 7), (st.hr ? 'HR 模式' : 'LP 模式') + '、DR = ' + st.dr.toString(2).padStart(3, '0'));
    add(0x02, 'CONFIG2', (st.wctChop ? 0x20 : 0) | (st.testInt ? 0x10 : 0) | (st.testAmp ? 0x04 : 0) | (st.testFreq & 3), st.testInt ? '內部測試訊號' : '');
    add(0x03, 'CONFIG3', 0x40 | (st.refBuf ? 0x80 : 0) | (st.vref4 ? 0x20 : 0) | (st.biasMeas ? 0x10 : 0) | (st.biasRefInt ? 0x08 : 0) | (st.biasOn ? 0x04 : 0) | (st.biasLoffSens ? 0x02 : 0),
      (st.vref4 ? 'VREF 4 V' : 'VREF 2.4 V') + (st.biasOn ? '、RLD 開' : ''));
    var flead = {off: 0, dc: 3, pullres: 3, acdr4: 1}[st.loffMode] || 0;
    add(0x04, 'LOFF', (st.compTh << 5) | (st.loffMode === 'pullres' ? 0x10 : 0) | ((st.ilead & 3) << 2) | flead, 'FLEAD = ' + flead.toString(2).padStart(2, '0'));
    for (var k = 0; k < 4; k++) add(0x05 + k, 'CH' + (k + 1) + 'SET', (st.pd[k] ? 0x80 : 0) | (chip.gainCode[st.gain[k]] << 4) | (st.mux[k] & 7), '增益 ' + st.gain[k] + '（GAIN = ' + chip.gainCode[st.gain[k]].toString(2).padStart(3, '0') + '）');
    for (k = 4; k < 8; k++) add(0x05 + k, 'CH' + (k + 1) + 'SET', 0, 'ADS1294 沒有這個通道');
    add(0x0D, 'RLD_SENSP', st.biasP & 15, ''); add(0x0E, 'RLD_SENSN', st.biasN & 15, '');
    add(0x0F, 'LOFF_SENSP', st.loffMode === 'off' ? 0 : st.loffP & 15, ''); add(0x10, 'LOFF_SENSN', st.loffMode === 'off' ? 0 : st.loffN & 15, '');
    add(0x11, 'LOFF_FLIP', st.loffFlip & 15, '');
    add(0x12, 'LOFF_STATP', 0, '唯讀'); add(0x13, 'LOFF_STATN', 0, '唯讀');
    add(0x14, 'GPIO', 0x0F, '');
    add(0x15, 'PACE', 0, ''); add(0x16, 'RESP', 0x20, 'bit 5 保留，固定寫 1');
    add(0x17, 'CONFIG4', (st.singleShot ? 0x08 : 0) | (st.wctToRld ? 0x04 : 0) | (st.compOn ? 0x02 : 0), '');
    function wsel(pin) { return {IN1P: 0, IN1N: 1, IN2P: 2, IN2N: 3, IN3P: 4, IN3N: 5, IN4P: 6, IN4N: 7}[pin] || 0; }
    add(0x18, 'WCT1', (st.wctA ? 0x08 : 0) | wsel(st.wctA), st.wctA ? 'WCTA = ' + st.wctA : 'WCTA 關');
    add(0x19, 'WCT2', (st.wctC ? 0x80 : 0) | (st.wctB ? 0x40 : 0) | (wsel(st.wctB) << 3) | wsel(st.wctC), 'WCTB = ' + (st.wctB || '關') + '、WCTC = ' + (st.wctC || '關'));
    return R;
  }
  function registers(st) { return st.chip === 'ads1294' ? regs1294(st) : regs1299(st); }
  function initCode(st, regs) {
    var L = ['// ' + (st.chip === 'ads1294' ? 'ADS1294' : 'ADS1299') + ' 初始化（由模擬器依目前設定產生）',
      '// 上電、RESET 後等待 tPOR；SPI mode 1（CPOL = 0、CPHA = 1）',
      'ads_cmd(0x11);            // SDATAC：停止連續讀取，才能寫暫存器'];
    regs.forEach(function (r) {
      if (r.addr === 0 || r.name === 'LOFF_STATP' || r.name === 'LOFF_STATN') return;
      if (/沒有這個通道/.test(r.desc)) return;
      L.push('ads_wreg(0x' + hex2(r.addr) + ', 0x' + hex2(r.v) + ');  // ' + (r.name + '            ').slice(0, 11) + (r.desc ? ' ' + r.desc : ''));
    });
    L.push('ads_cmd(0x08);            // START（或拉高 START 腳）');
    L.push('ads_cmd(0x10);            // RDATAC：之後每次 DRDY 變低，讀 ' + (3 + 3 * (st.chip === 'ads1294' ? 4 : 8)) + ' bytes');
    L.push('', '// ads_wreg(addr, v) = { 0x40 | addr, 0x00, v }；每個 byte 之間至少 4 tCLK（約 2 µs）');
    return L.join('\n');
  }

  /* ===================== default states ===================== */
  function fill(n, v) { var a = []; for (var i = 0; i < n; i++) a.push(v); return a; }
  function baseState() {
    return {
      clkErr: 1, dr: 6, hr: true, avdd: 5, vref4: false, supply: 'bi',
      srb1: true, srb2: 0, refBuf: true, biasOn: true, biasRefInt: true, biasMeas: false, biasLoffSens: false,
      loffMode: 'off', ilead: 0, compTh: 0, loffP: 0, loffN: 0, loffFlip: 0, compOn: false,
      testInt: false, testAmp: 0, testFreq: 0,
      zSpread: 0.2, hcScale: 1, zMul: {}, contact: {},
      env: {mainsV: 110, mainsF: 60, Cpow: 2e-12, Cbody: 200e-12, Ciso: 20e-12, Ccab: 30e-12, Cstray: 0.02e-12, h3: 0.03},
      ibias: true, ibiasSign: 1, chipOffset: true, seed: 1, tempC: 30, dvdd: 3.3, multiRead: false, clkOut: false, singleShot: false
    };
  }
  function defaultState(kind) {
    var s = baseState();
    if (kind === 'ads1294') {
      s.chip = 'ads1294'; s.board = 'chip'; s.supply = 'uni'; s.avdd = 3; s.vref4 = false; s.hr = true; s.dr = 6;
      s.gain = fill(4, 6); s.mux = fill(4, 0); s.pd = fill(4, 0); s.srb1 = false;
      s.biasP = 0x03; s.biasN = 0x01;                          // RLD from LA, LL (IN1P, IN2P) and RA (IN1N)
      s.bias = {Rf: 1e6, Cf: 1.5e-9, Rprot: 51e3};
      s.wctA = 'IN1N'; s.wctB = 'IN1P'; s.wctC = 'IN2P'; s.wctCext = 100e-12; s.wctNoise = true; s.wctToRld = false; s.wctChop = false;
      s.filt = {R: 22e3, C: 1e-9};
      s.elec = ELECTRODES.gel; s.env.Ccab = 50e-12;
      s.sig = {kind: 'ecg', hr: 72, amp: 1, pace: false, wander: true, emg: false};
      return s;
    }
    s.chip = 'ads1299';
    s.gain = fill(8, 24); s.mux = fill(8, 0); s.pd = fill(8, 0);
    s.labels = ['Fp1', 'Fp2', 'C3', 'C4', 'P3', 'P4', 'O1', 'O2'];
    s.biasP = 0xFF; s.biasN = 0x00;
    s.elec = ELECTRODES.wet;
    s.sig = {kind: 'eeg', background: true, eyesClosed: true, blinks: true, emg: false};
    if (kind === 'pdk') {
      /* SLAU443B Table 1 factory jumpers: unipolar 5 V, BIAS_ELEC = U11 mid-supply buffer, REF_ELEC direct to SRB1 */
      s.board = 'pdk'; s.supply = 'uni'; s.dr = 5; s.srb1 = false; s.biasOn = false;
      s.mux = fill(8, 1);
      s.jp = {biasElec: 'u11', jp25_12: true, jp25_34: true, jp25_56: false, refBuf: false};
      s.source = 'vcm'; s.gen = {f: 10, amp: 1e-3, shape: 'sine'};
      s.bias = {Rf: 392e3, Cf: 10e-9, Rprot: 1};
      return s;
    }
    s.board = 'chip';
    s.bias = {Rf: 1e6, Cf: 1.5e-9, Rprot: 10e3};
    s.filt = {R: 4.99e3, C: 4.7e-9};
    /* the page draws the OpenBCI Cyton front end; OpenBCI's default channel setting x1060110X:
       gain 24, normal input, in the bias, SRB2 on, SRB1 off.  Electrodes on INxN, reference on SRB2. */
    if (global.AFE && global.AFE.boards) {
      s.srb1 = false; s.srb2 = 0xFF; s.biasP = 0xFF; s.biasN = 0xFF;
      s.doc = global.AFE.boards.cyton({labels: s.labels});
    }
    return s;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  global.AFE = {
    defaultState: defaultState, clone: clone,
    CHIPS: CHIPS, ELECTRODES: ELECTRODES, build: build, analyze: analyze, cmSweep: cmSweep, Stream: Stream, EEGSource: EEGSource,
    buildDoc: buildDoc, docElectrodes: docElectrodes, capBetween: capBetween,
    fdr: fdr, fmod: fmod, decim: decim, vref: vref, rails: rails, chipNoise: chipNoise, sinc3: sinc3, testSignal: testSignal,
    loffFreq: loffFreq, registers: registers, initCode: initCode, statusWord: statusWord, hex2: hex2, electrodeZ: electrodeZ, sincTaps: sincTaps
  };
})(window);
