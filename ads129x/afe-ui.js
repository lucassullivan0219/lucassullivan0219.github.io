/* Shared page UI for the ADS129x simulations.  A page calls
     AFEApp({kind: 'ads1299' | 'ads1294' | 'pdk', mount: element, presets: [...], ...})
   and gets presets, a settings panel, and the display tabs (scope, spectrum, statistics,
   front-end circuit, registers, and the delta-sigma demo when cfg.deltaSigma is set). */
(function (global) {
  'use strict';
  var CS = global.CircuitSim, AFE = global.AFE, fmt = CS.fmt;
  var CH_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];
  var MUX_NAMES = ['000 正常電極', '001 輸入短路', '010 BIAS 量測', '011 電源量測', '100 溫度', '101 測試訊號', '110 BIAS_DRP', '111 BIAS_DRN'];

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }
  function h(tag, attrs, html) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) { if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function uv(v, d) { return fmt(v, 'V', d || 3); }

  /* ---------- streaming display filters (biquads, RBJ cookbook) ---------- */
  function biquad(type, f, fs, q) {
    var w = 2 * Math.PI * f / fs, c = Math.cos(w), s = Math.sin(w), a = s / (2 * (q || Math.SQRT1_2)), b0, b1, b2, a0, a1, a2;
    if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    else if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else { b0 = 1; b1 = -2 * c; b2 = 1; }                                   // notch
    a0 = 1 + a; a1 = -2 * c; a2 = 1 - a;
    return {b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, z1: 0, z2: 0};
  }
  function runBq(f, x) { var y = f.b0 * x + f.z1; f.z1 = f.b1 * x - f.a1 * y + f.z2; f.z2 = f.b2 * x - f.a2 * y; return y; }
  /* start a chain in steady state for a constant input x0, so a DC offset does not ring through */
  function prime(chain, x0) {
    var x = x0;
    chain.forEach(function (f) {
      var g = (f.b0 + f.b1 + f.b2) / (1 + f.a1 + f.a2), y = g * x;
      f.z2 = f.b2 * x - f.a2 * y; f.z1 = f.b1 * x - f.a1 * y + f.z2;
      x = y;
    });
    chain.primed = true;
  }
  function runChain(chain, x) { if (!chain.primed) prime(chain, x); for (var q = 0; q < chain.length; q++) x = runBq(chain[q], x); return x; }
  function makeChain(mode, fs, mainsF) {
    var c = [];
    if (mode === 'raw') return c;
    if (fs <= 2) return c;
    c.push(biquad('hp', mode === 'dc' ? 0.1 : 0.5, fs));
    if (mode === 'band') {
      var top = Math.min(45, fs * 0.4);
      c.push(biquad('lp', top, fs)); c.push(biquad('lp', top, fs));
      if (mainsF < fs / 2) c.push(biquad('notch', mainsF, fs, 8));
    }
    if (mode === 'ecg') {
      var tp = Math.min(40, fs * 0.4);
      c.push(biquad('lp', tp, fs));
      if (mainsF < fs / 2) c.push(biquad('notch', mainsF, fs, 8));
    }
    return c;
  }

  global.AFEApp = function (cfg) {
    var kind = cfg.kind, mount = cfg.mount;
    var S = {st: AFE.defaultState(kind), fe: null, res: null, stream: null, running: true, buf: null, seq: 0, frame: null, bufFs: 0};
    if (cfg.init) cfg.init(S.st);
    var isECG = kind === 'ads1294', isPDK = kind === 'pdk';

    /* ======================= layout ======================= */
    mount.innerHTML = '';
    var presetCard = h('section', {class: 'card', 'aria-label': '情境'});
    presetCard.innerHTML = '<h2>情境</h2><div class="presets" id="presets"></div><p class="hint" id="presetNote" style="margin:8px 0 0"></p>';
    mount.appendChild(presetCard);
    var grid = h('div', {class: 'grid2 afe', style: 'margin-top:16px'});
    var left = h('section', {class: 'card', 'aria-label': '輸出'});
    var right = h('section', {class: 'card settings', 'aria-label': '設定'});
    grid.appendChild(left); grid.appendChild(right); mount.appendChild(grid);
    var tabsDef = [['scope', '示波器'], ['fft', '頻譜'], ['stats', '統計'], ['fe', '前端電路'], ['regs', '暫存器']];
    if (cfg.deltaSigma) tabsDef.push(['ds', 'Δ-Σ 示意']);
    left.innerHTML = '<div class="tabs" role="tablist" id="tabs">' + tabsDef.map(function (t, i) {
      return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (i ? 'false' : 'true') + '">' + t[1] + '</button>';
    }).join('') + '</div>' +
      '<div class="tabpanel" data-panel="scope">' +
        '<div class="row"><button type="button" class="btn sm" id="run">暫停</button>' +
        '<label class="inline">時間 <select id="win"><option value="2">2 s</option><option value="5" selected>5 s</option><option value="10">10 s</option></select></label>' +
        '<label class="inline">刻度 <select id="scale"><option value="auto">自動</option><option value="5e-6">5 µV/格</option><option value="20e-6">20 µV/格</option><option value="50e-6" selected>50 µV/格</option><option value="200e-6">200 µV/格</option><option value="5e-4">500 µV/格</option><option value="1e-3">1 mV/格</option><option value="0.1">100 mV/格</option></select></label>' +
        '<label class="inline">顯示濾波 <select id="dfilt"></select></label>' +
        (cfg.derived ? '<label class="inline"><input type="checkbox" id="showDerived"> 導出導程</label>' : '') + '</div>' +
        '<div class="status" id="liveStatus"></div>' +
        '<canvas id="scope" class="scopecv" aria-label="各通道輸出波形"></canvas>' +
        '<div class="row" style="margin-top:6px"><span class="hint mono" id="frameHex"></span></div>' +
        '<p class="hint" id="scopeNote"></p></div>' +
      '<div class="tabpanel" data-panel="fft" hidden><div class="row"><label class="inline">通道 <select id="fftCh"></select></label>' +
        '<label class="inline">長度 <select id="fftLen"><option value="2">2 s</option><option value="4" selected>4 s</option><option value="8">8 s</option></select></label>' +
        '<label class="inline">單位 <select id="fftUnit"><option value="psd">µV/√Hz</option><option value="db">dBFS</option></select></label></div>' +
        '<canvas class="plot tall" id="fftPlot" style="margin-top:8px"></canvas><p class="hint" id="fftNote"></p></div>' +
      '<div class="tabpanel" data-panel="stats" hidden><div class="row"><label class="inline">點數 <select id="acqN"><option>1000</option><option selected>5000</option><option>20000</option></select></label>' +
        '<button type="button" class="btn primary sm" id="acq">擷取</button><span class="status" id="acqStatus"></span></div>' +
        '<div class="scroll-x" style="margin-top:8px"><table class="data" id="statTable"></table></div>' +
        '<div class="row" style="margin-top:8px"><label class="inline">直方圖通道 <select id="histCh"></select></label><button type="button" class="btn sm" id="csv">下載 CSV</button></div>' +
        '<canvas class="plot" id="histPlot" style="margin-top:8px"></canvas><p class="hint" id="statNote"></p></div>' +
      '<div class="tabpanel" data-panel="fe" hidden><div id="feSummary"></div>' +
        '<div class="scroll-x"><table class="data" id="feTable"></table></div>' +
        '<h3>市電干擾隨頻率：人體共模與通道差模</h3><canvas class="plot" id="cmPlot"></canvas><p class="hint" id="cmNote"></p>' +
        '<h3>雜訊預算</h3><div class="row"><label class="inline">通道 <select id="nzCh"></select></label></div><div class="scroll-x"><table class="data" id="nzTable"></table></div>' +
        '<canvas class="plot short" id="nzPlot" style="margin-top:8px"></canvas>' +
        '<div class="row" style="margin-top:10px"><button type="button" class="btn sm" id="spiceBtn">下載前端 SPICE netlist</button><span class="hint" id="feTime"></span></div></div>' +
      '<div class="tabpanel" data-panel="regs" hidden><div class="scroll-x"><table class="data" id="regTable"></table></div>' +
        '<h3>初始化程式碼</h3><pre class="code" id="initCode"></pre><div class="row"><button type="button" class="btn sm" id="copyInit">複製</button></div>' +
        '<h3>資料格式與 SPI</h3><div id="frameInfo" class="notes"></div></div>' +
      (cfg.deltaSigma ? '<div class="tabpanel" data-panel="ds" hidden><div id="dsBox"></div></div>' : '');
    right.innerHTML = '<h2>設定</h2><div id="settings"></div>';

    var $ = function (id) { return mount.querySelector('#' + id); };
    var scopeCv = $('scope'), sctx = scopeCv.getContext('2d');
    var fftPlot = new global.LabPlot($('fftPlot'), {xlog: true, ylog: true, xunit: 'Hz', yunit: 'V/√Hz', ylabel: '雜訊密度'});
    var histPlot = new global.LabPlot($('histPlot'), {ylabel: '次數', xunit: 'V'});
    var cmPlot = new global.LabPlot($('cmPlot'), {xlog: true, ylog: true, xunit: 'Hz', yunit: 'V', ylabel: '振幅（峰值）'});
    var nzPlot = new global.LabPlot($('nzPlot'), {xlog: true, ylog: true, xunit: 'Hz', yunit: 'V/√Hz'});

    /* ======================= settings panel ======================= */
    var box = $('settings');
    function section(title, open) {
      var d = h('details', open ? {open: ''} : {}); d.appendChild(h('summary', {}, title));
      var body = h('div', {class: 'sbody'}); d.appendChild(body); box.appendChild(d); return body;
    }
    function row(parent, label, ctl, hint) {
      var r = h('div', {class: 'srow'}); r.appendChild(h('span', {class: 'slabel'}, label)); r.appendChild(ctl);
      parent.appendChild(r);
      if (hint) parent.appendChild(h('div', {class: 'shint'}, hint));
      return r;
    }
    function select(opts, val, onchange) {
      var s = h('select');
      opts.forEach(function (o) { var op = h('option', {value: String(o[0])}, o[1]); if (String(o[0]) === String(val)) op.selected = true; s.appendChild(op); });
      s.addEventListener('change', function () { onchange(s.value); });
      return s;
    }
    function check(val, onchange, label) {
      var l = h('label', {class: 'inline'}), c = h('input', {type: 'checkbox'}); c.checked = !!val;
      c.addEventListener('change', function () { onchange(c.checked); }); l.appendChild(c); if (label) l.appendChild(document.createTextNode(label)); return l;
    }
    function num(val, unit, onchange, w) {
      var wrap = h('span', {class: 'numw'}), i = h('input', {type: 'text', value: CS.spiceNum(val), size: w || 6});
      i.addEventListener('change', function () { var v = CS.num(i.value); if (isFinite(v)) onchange(v); });
      wrap.appendChild(i); wrap.appendChild(document.createTextNode(' ' + unit)); return wrap;
    }
    function maskBoxes(n, mask, labels, onchange) {
      var w = h('span', {class: 'masks'});
      for (var i = 0; i < n; i++) (function (i) {
        var l = h('label', {class: 'mask'}), c = h('input', {type: 'checkbox'}); c.checked = !!((mask >> i) & 1);
        c.addEventListener('change', function () { var m = 0; w.querySelectorAll('input').forEach(function (x, k) { if (x.checked) m |= 1 << k; }); onchange(m); });
        l.appendChild(c); l.appendChild(document.createTextNode(labels[i])); w.appendChild(l);
      })(i);
      return w;
    }
    function set(path, v) {
      var o = S.st, p = path.split('.');
      for (var i = 0; i < p.length - 1; i++) o = o[p[i]];
      o[p[p.length - 1]] = v;
      changed();
    }

    function renderSettings() {
      box.innerHTML = '';
      var st = S.st, chip = AFE.CHIPS[st.chip], nch = chip.nch;
      var chNames = cfg.channelLabels ? cfg.channelLabels(st) : st.labels.map(function (l, i) { return 'CH' + (i + 1) + ' ' + l; });
      /* --- chip --- */
      var a = section('晶片與資料速率', true);
      if (isECG) {
        row(a, '類比電源', select([['3uni', '3 V 單電源'], ['5uni', '5 V 單電源'], ['3bi', '±1.5 V'], ['5bi', '±2.5 V']], st.avdd + st.supply, function (v) {
          S.st.avdd = +v[0]; S.st.supply = v.slice(1); if (S.st.avdd < 4.4) S.st.vref4 = false; changed(true); }));
        row(a, '參考電壓', select([['0', '2.4 V'], ['1', '4 V（需 5 V 電源）']], st.vref4 ? 1 : 0, function (v) { S.st.vref4 = v === '1' && S.st.avdd >= 4.4; changed(true); }));
        row(a, '模式', select([['1', 'HR 高解析（fMOD = fCLK/4）'], ['0', 'LP 低功耗（fMOD = fCLK/8）']], st.hr ? 1 : 0, function (v) { S.st.hr = v === '1'; changed(true); }));
      } else if (!isPDK) {
        row(a, '類比電源', select([['bi', '±2.5 V（資料手冊範例）'], ['uni', '5 V 單電源']], st.supply, function (v) { set('supply', v); }));
      } else {
        row(a, '類比電源', select([['uni', 'JP2 2-3、JP20 1-2：5 V 單電源（出廠）'], ['bi', 'JP2 1-2、JP20 2-3：±2.5 V']], st.supply, function (v) { set('supply', v); }));
      }
      var drOpts = [];
      for (var d = 0; d < 7; d++) { var t = AFE.clone(st); t.dr = d; var f = AFE.fdr(chip, t); drOpts.push([d, d.toString(2).padStart(3, '0') + '：' + (f >= 1000 ? f / 1000 + ' kSPS' : f + ' SPS') + '（−3 dB ' + fmt(0.262 * f, 'Hz') + '）']); }
      row(a, '資料速率 DR', select(drOpts, st.dr, function (v) { S.st.dr = +v; changed(true); }));
      row(a, '時脈', select([['1', '外部 2.048 MHz'], ['1.004', '內部振盪器（例：+0.4 %）']], st.clkErr, function (v) { S.st.clkErr = +v; changed(true); }),
        '內部振盪器 25 °C 時 ±0.5 %：資料速率、測試訊號頻率都跟著偏，sinc3 的零點就對不準 60 Hz。');
      /* --- channels --- */
      var c = section('通道（CHnSET）', true), tbl = h('table', {class: 'data chtable'});
      tbl.innerHTML = '<thead><tr><th>通道</th><th>增益</th><th>MUX</th><th>關</th></tr></thead>';
      var tb = h('tbody');
      for (var k = 0; k < nch; k++) (function (k) {
        var tr = h('tr'); tr.appendChild(h('td', {}, esc(chNames[k])));
        var td1 = h('td'); td1.appendChild(select(chip.gains.map(function (g) { return [g, g + '×']; }), st.gain[k], function (v) { S.st.gain[k] = +v; changed(); })); tr.appendChild(td1);
        var td2 = h('td'); td2.appendChild(select(MUX_NAMES.map(function (m, i) { return [i, m]; }), st.mux[k], function (v) { S.st.mux[k] = +v; changed(); })); tr.appendChild(td2);
        var td3 = h('td'); var cb = h('input', {type: 'checkbox', 'aria-label': 'power down ' + chNames[k]}); cb.checked = !!st.pd[k]; cb.addEventListener('change', function () { S.st.pd[k] = cb.checked ? 1 : 0; changed(); }); td3.appendChild(cb); tr.appendChild(td3);
        tb.appendChild(tr);
      })(k);
      tbl.appendChild(tb); c.appendChild(h('div', {class: 'scroll-x'})).appendChild(tbl);
      var allRow = h('div', {class: 'row', style: 'margin-top:6px'});
      allRow.appendChild(h('span', {class: 'hint'}, '全部：'));
      allRow.appendChild(select([['', '增益…']].concat(chip.gains.map(function (g) { return [g, g + '×']; })), '', function (v) { if (v) { S.st.gain = S.st.gain.map(function () { return +v; }); changed(); renderSettings(); } }));
      allRow.appendChild(select([['', 'MUX…']].concat(MUX_NAMES.map(function (m, i) { return [i, m]; })), '', function (v) { if (v !== '') { S.st.mux = S.st.mux.map(function () { return +v; }); changed(); renderSettings(); } }));
      c.appendChild(allRow);
      /* --- reference and bias --- */
      var b = section(isECG ? 'RLD 與 WCT' : '參考（SRB1）與 BIAS', !isPDK);
      var shortLab = cfg.maskLabels || chNames.map(function (n, i) { return String(i + 1); });
      if (!isECG) row(b, 'MISC1.SRB1', check(st.srb1, function (v) { set('srb1', v); }, ' 所有負輸入接到 SRB1'),
        isPDK ? 'SRB1 腳接 REF_ELEC（JP8）。不設這個位元時負輸入接各自的 AINxN。' : '參考電極接到 SRB1 腳。忘了設這個位元，負輸入就浮接。');
      row(b, isECG ? 'RLD 放大器' : 'BIAS 放大器', check(st.biasOn, function (v) { set('biasOn', v); }, ' 開（PD_' + (isECG ? 'RLD' : 'BIAS') + ' = 1）'));
      row(b, (isECG ? 'RLD' : 'BIAS') + 'REF', check(st.biasRefInt, function (v) { set('biasRefInt', v); }, ' 內部中點（AVDD + AVSS）/ 2'));
      if (!isPDK) row(b, '放大器關時', select([['0', '電極浮接'], ['1', '電極接電路地 0 V']], st.biasToGnd ? 1 : 0, function (v) { set('biasToGnd', v === '1'); }));
      row(b, '感測（P）', maskBoxes(nch, st.biasP, shortLab, function (m) { set('biasP', m); }));
      row(b, '感測（N）', maskBoxes(nch, st.biasN, shortLab, function (m) { set('biasN', m); }));
      if (!isPDK) {
        row(b, '回授 Rf', num(st.bias.Rf, 'Ω', function (v) { set('bias.Rf', v); }));
        row(b, '回授 Cf', num(st.bias.Cf, 'F', function (v) { set('bias.Cf', v); }));
        row(b, '保護電阻', num(st.bias.Rprot, 'Ω', function (v) { set('bias.Rprot', Math.max(v, 1)); }), '資料手冊典型 1 MΩ ∥ 1.5 nF。DC 增益 = Rf ×（感測數）/ 220 kΩ（圖 38；式 11 寫 330 kΩ，兩處不一致）。');
      } else b.appendChild(h('div', {class: 'shint'}, '板上 R8 = 392 kΩ、C20 = 10 nF（使用手冊 §7.1.3）。BIAS_DRV 要接到 BIAS_ELEC 得裝 JP1。'));
      if (isECG) {
        var pins = [['', '關'], ['IN1P', 'IN1P（LA）'], ['IN1N', 'IN1N（RA）'], ['IN2P', 'IN2P（LL）'], ['IN2N', 'IN2N（RA）'], ['IN3P', 'IN3P（V1）'], ['IN4P', 'IN4P（V2）']];
        row(b, 'WCTA', select(pins, st.wctA, function (v) { set('wctA', v); }));
        row(b, 'WCTB', select(pins, st.wctB, function (v) { set('wctB', v); }));
        row(b, 'WCTC', select(pins, st.wctC, function (v) { set('wctC', v); }));
        row(b, 'WCT 外接電容', num(st.wctCext, 'F', function (v) { set('wctCext', v); }), '內部 3 × 30 kΩ ＋ 80 pF；資料手冊建議外加 100 pF。WCT 只能推很高阻抗的負載（> 500 MΩ）。');
        row(b, 'CONFIG4', check(st.wctToRld, function (v) { set('wctToRld', v); }, ' WCT_TO_RLD（用 WCT 當 RLD 輸入）'));
      }
      if (isPDK) {
        var j = section('PDK 跳線', true);
        row(j, 'BIAS_ELEC', select([['u11', 'JP6 1-2：U11 緩衝中點（出廠）'], ['drv', 'JP1 1-2：ADS1299 BIAS_DRV 迴路']], st.jp.biasElec, function (v) { set('jp.biasElec', v); }));
        row(j, 'REF_ELEC → SRB1', select([['0', 'JP8 1-2：直接（出廠）'], ['1', 'JP8 2-3、JP7 1-2：經 U4（OPA376）緩衝']], st.jp.refBuf ? 1 : 0, function (v) { set('jp.refBuf', v === '1'); }));
        row(j, 'J6', select([['vcm', '跳線全裝：輸入接 JP25 測試網路'], ['gen', '跳線全裝、JP25 3-4 拔：AIN1 SMA 訊號源'], ['body', '跳線拔掉：J6 接電極（EEG）']], st.source, function (v) {
          S.st.source = v; if (v === 'gen') S.st.jp.jp25_34 = false; changed(); renderSettings(); }));
        if (st.source !== 'body') {
          row(j, 'JP25 1-2', check(st.jp.jp25_12, function (v) { set('jp.jp25_12', v); }, ' Ain− 接 VCM'));
          row(j, 'JP25 3-4', check(st.jp.jp25_34, function (v) { set('jp.jp25_34', v); }, ' Ain+ 接 VCM'));
          row(j, 'JP25 5-6', check(st.jp.jp25_56, function (v) { set('jp.jp25_56', v); }, ' VCM 經 R11（5 kΩ）推 REF_ELEC'));
        }
        if (st.source === 'gen') {
          var g = section('訊號產生器（AIN1 SMA → Ain+）', true);
          row(g, '波形', select([['sine', '正弦'], ['square', '方波']], st.gen.shape, function (v) { set('gen.shape', v); }));
          row(g, '振幅（峰值）', num(st.gen.amp, 'V', function (v) { set('gen.amp', v); }));
          row(g, '頻率', num(st.gen.f, 'Hz', function (v) { set('gen.f', Math.max(v, 0.01)); }));
        }
      }
      /* --- lead-off --- */
      var l = section('Lead-off 偵測', false);
      var modes = isECG ? [['off', '關'], ['dc', '直流電流源'], ['pullres', '直流 10 MΩ 上拉／下拉電阻'], ['acdr4', '交流 fDR/4']]
        : [['off', '關'], ['dc', '直流電流源'], ['ac7', '交流 7.8 Hz（帶內）'], ['ac31', '交流 31.2 Hz（帶內）'], ['acdr4', '交流 fDR/4（帶外）']];
      row(l, '方式', select(modes, st.loffMode, function (v) { set('loffMode', v); }));
      row(l, '電流 ILEAD_OFF', select(chip.loffI.map(function (I, i) { return [i, fmt(I, 'A')]; }), st.ilead, function (v) { set('ilead', +v); }));
      row(l, '比較器門檻', select(['95 % / 5 %', '92.5 % / 7.5 %', '90 % / 10 %', '87.5 % / 12.5 %', '85 % / 15 %', '80 % / 20 %', '75 % / 25 %', '70 % / 30 %'].map(function (t, i) { return [i, t]; }), st.compTh, function (v) { set('compTh', +v); }));
      row(l, 'LOFF_SENSP', maskBoxes(nch, st.loffP, shortLab, function (m) { set('loffP', m); }));
      row(l, 'LOFF_SENSN', maskBoxes(nch, st.loffN, shortLab, function (m) { set('loffN', m); }));
      row(l, 'LOFF_FLIP', maskBoxes(nch, st.loffFlip, shortLab, function (m) { set('loffFlip', m); }));
      row(l, 'CONFIG4', check(st.compOn, function (v) { set('compOn', v); }, ' PD_LOFF_COMP（比較器開）'),
        st.chip === 'ads1299' ? '參考式接法（SRB1）時，TI 建議只在參考電極那一側用一個電流源；8 個負輸入都開等於 8 倍電流灌進參考電極。' : '');
      /* --- test signal --- */
      var ts = section('測試訊號（CONFIG2）', false);
      row(ts, 'INT_CAL / INT_TEST', check(st.testInt, function (v) { set('testInt', v); }, ' 內部產生'));
      row(ts, '振幅', select([['0', '1 ×（VREF / 2.4 mV）'], ['1', '2 ×']], st.testAmp, function (v) { set('testAmp', +v); }));
      row(ts, '頻率', select([['0', 'fCLK / 2²¹（約 0.98 Hz）'], ['1', 'fCLK / 2²⁰（約 1.95 Hz）'], ['3', '直流']], st.testFreq, function (v) { set('testFreq', +v); }), '把通道 MUX 設成 101 才看得到。');
      /* --- electrodes and input --- */
      if (!isPDK || st.source === 'body') {
        var e = section('電極與輸入', !isPDK);
        var eKey = Object.keys(AFE.ELECTRODES).filter(function (k) { return AFE.ELECTRODES[k] === st.elec || AFE.ELECTRODES[k].label === st.elec.label; })[0] || 'wet';
        row(e, '電極', select(Object.keys(AFE.ELECTRODES).map(function (k) { return [k, AFE.ELECTRODES[k].label]; }), eKey, function (v) { S.st.elec = AFE.ELECTRODES[v]; changed(); renderSettings(); }),
          'Randles 模型：Rs 串（Rct ∥ Cdl）。|Z(10 Hz)| ≈ ' + fmt(AFE.electrodeZ(st.elec, 10, 1), 'Ω') + '；半電池電位差 ±' + fmt(st.elec.hc, 'V') + ' 量級。');
        row(e, '阻抗不匹配', select([['0', '無'], ['0.2', '±20 %'], ['0.5', '±50 %'], ['1', '±100 %']], st.zSpread, function (v) { set('zSpread', +v); }));
        row(e, '半電池偏移', select([['0', '0'], ['1', '典型'], ['3', '3 倍']], st.hcScale, function (v) { set('hcScale', +v); }));
        var et = h('table', {class: 'data chtable'}), names = cfg.electrodeNames(st);
        et.innerHTML = '<thead><tr><th>電極</th><th>接觸</th><th>阻抗 ×</th></tr></thead>';
        var eb = h('tbody');
        names.forEach(function (nm) {
          var tr = h('tr'); tr.appendChild(h('td', {}, esc(nm)));
          var c1 = h('td'), cb = h('input', {type: 'checkbox', 'aria-label': nm + ' 接觸'}); cb.checked = S.st.contact[nm] !== false;
          cb.addEventListener('change', function () { S.st.contact[nm] = cb.checked; changed(); }); c1.appendChild(cb); tr.appendChild(c1);
          var c2 = h('td'); c2.appendChild(select([[1, '1'], [3, '3'], [10, '10'], [30, '30']], S.st.zMul[nm] || 1, function (v) { S.st.zMul[nm] = +v; changed(); })); tr.appendChild(c2);
          eb.appendChild(tr);
        });
        et.appendChild(eb); e.appendChild(h('div', {class: 'scroll-x'})).appendChild(et);
        if (!isPDK) {
          row(e, '輸入濾波 R', num(st.filt.R, 'Ω', function (v) { set('filt.R', v); }));
          row(e, '輸入濾波 C（對地）', num(st.filt.C, 'F', function (v) { set('filt.C', v); }), '截止 ' + fmt(1 / (2 * Math.PI * st.filt.R * st.filt.C), 'Hz') + '。對地電容不匹配會把共模轉成差模；資料手冊建議改用跨在 P、N 之間的差動電容。');
        }
      }
      /* --- environment --- */
      var en = section('環境（市電耦合）', false);
      row(en, '市電', select([['110,60', '110 V、60 Hz（台灣）'], ['220,50', '220 V、50 Hz']], st.env.mainsV + ',' + st.env.mainsF, function (v) { var p = v.split(','); S.st.env.mainsV = +p[0]; S.st.env.mainsF = +p[1]; changed(true); }));
      row(en, '供電', select([['2e-11', '電池（對大地 20 pF）'], ['2e-10', 'USB 接插電筆電（200 pF）'], ['2e-9', '桌上型儀器接地（2 nF）']], st.env.Ciso, function (v) { set('env.Ciso', +v); }),
        '電路地對大地的電容越大，市電電流越多流經電極和 BIAS 迴路。');
      row(en, '導線', select([['u', '未屏蔽（對市電 0.02 pF、對地 30 pF）'], ['s', '屏蔽線（對市電 0、對地 150 pF）']], st.env.Cstray > 0 ? 'u' : 's', function (v) {
        S.st.env.Cstray = v === 'u' ? 0.02e-12 : 0; S.st.env.Ccab = v === 'u' ? 30e-12 : 150e-12; changed(); }));
      row(en, '人體對市電', num(st.env.Cpow, 'F', function (v) { set('env.Cpow', v); }));
      row(en, '人體對大地', num(st.env.Cbody, 'F', function (v) { set('env.Cbody', v); }));
      /* --- signal source --- */
      if (!isPDK || st.source === 'body') {
        var sg = section(isECG ? '心電訊號' : '腦電訊號', true);
        if (isECG) {
          row(sg, '心率', num(st.sig.hr, 'bpm', function (v) { set('sig.hr', Math.max(30, Math.min(220, v))); }, 4));
          row(sg, '振幅倍率', num(st.sig.amp, '', function (v) { set('sig.amp', v); }, 4));
          row(sg, '基線飄移', check(st.sig.wander, function (v) { set('sig.wander', v); }, ' 呼吸／動作'));
          row(sg, '肌電', check(st.sig.emg, function (v) { set('sig.emg', v); }, ' 四肢肌電雜訊'));
          row(sg, '節律器', check(st.sig.pace, function (v) { set('sig.pace', v); }, ' 每拍 0.5 ms、5 mV 脈衝'), '要看得到節律器脈衝，資料速率要夠高（HR 模式 8 kSPS 以上）。');
        } else {
          row(sg, '背景', check(st.sig.background, function (v) { set('sig.background', v); }, ' 1/f 背景腦波'));
          row(sg, 'Alpha', check(st.sig.eyesClosed, function (v) { set('sig.eyesClosed', v); }, ' 閉眼（後腦 10 Hz 約 30 µV）'));
          row(sg, '眨眼', check(st.sig.blinks, function (v) { set('sig.blinks', v); }, ' Fp1、Fp2 約 150 µV'));
          row(sg, '肌電', check(st.sig.emg, function (v) { set('sig.emg', v); }, ' 咬牙（顳側、額側 30–150 Hz）'));
        }
      }
      /* --- misc --- */
      var m = section('其他', false);
      row(m, '輸入偏壓電流', check(st.ibias, function (v) { set('ibias', v); }, ' 每腳 ' + fmt(chip.ibias, 'A')));
      row(m, '晶片偏移', check(st.chipOffset, function (v) { set('chipOffset', v); }, ' 各通道隨機偏移（' + fmt(chip.offsetTyp, 'V') + ' 量級）'));
      var rb = h('button', {type: 'button', class: 'btn sm'}, '重新抽樣（電極、偏移）');
      rb.addEventListener('click', function () { S.st.seed = (S.st.seed % 997) + 1; changed(true); });
      m.appendChild(rb);
      if (isPDK) {
        var mc = h('button', {type: 'button', class: 'btn sm', style: 'margin-left:8px'}, '濾波元件公差：' + (st.tolSeed ? '抽樣中（第 ' + st.tolSeed + ' 組）' : '標稱值'));
        mc.addEventListener('click', function () { S.st.tolSeed = S.st.tolSeed ? (S.st.tolSeed < 20 ? S.st.tolSeed + 1 : 0) : 1; changed(); renderSettings(); });
        m.appendChild(mc);
        m.appendChild(h('div', {class: 'shint'}, 'BOM：4.99 kΩ 1 %、4.7 nF 10 % X7R。每按一次換一組隨機值，看 60 Hz 的共模轉差模怎麼變。'));
      }
    }

    /* ======================= presets ======================= */
    var pbox = $('presets');
    (cfg.presets || []).forEach(function (p) {
      var b = h('button', {type: 'button', class: 'btn', 'data-p': p.id}, esc(p.label));
      b.addEventListener('click', function () { applyPreset(p); });
      pbox.appendChild(b);
    });
    function applyPreset(p) {
      S.st = AFE.defaultState(kind);
      if (cfg.init) cfg.init(S.st);
      if (p.set) p.set(S.st);
      pbox.querySelectorAll('.btn').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.p === p.id ? 'true' : 'false'); });
      $('presetNote').innerHTML = p.note || '';
      if (p.tab) showTab(p.tab);
      if (p.scale) { $('scale').value = p.scale; if (!$('scale').value) $('scale').value = 'auto'; }
      if (p.dfilt) $('dfilt').value = p.dfilt;
      renderSettings(); changed(true);
      if (p.after) setTimeout(function () { p.after(api); }, 50);
    }

    /* ======================= recompute ======================= */
    var timer = null;
    function changed(resetBuf) {
      clearTimeout(timer);
      if (resetBuf) S.resetBuf = true;
      timer = setTimeout(recompute, 120);
    }
    function recompute() {
      var t0 = performance.now();
      try {
        S.fe = AFE.build(S.st);
        S.res = AFE.analyze(S.fe);
      } catch (e) { $('liveStatus').textContent = '計算失敗：' + e.message; console.error(e); return; }
      var fs = S.res.fdr;
      if (!S.buf || S.resetBuf || S.bufFs !== fs || S.buf.n !== S.fe.channels.length) makeBuf(fs, S.fe.channels.length);
      S.resetBuf = false;
      S.stream = new AFE.Stream(S.fe, S.res, S.st);
      S.codes = new Float64Array(S.fe.channels.length); S.volts = new Float64Array(S.fe.channels.length);
      S.carry = 0; S.lastT = performance.now();
      S.ms = performance.now() - t0;
      fillChannelSelects();
      renderFE(); renderRegs();
      if (cfg.deltaSigma) renderDS();
      if (activeTab === 'fft') drawFFT();
    }
    function makeBuf(fs, n) {
      var cap = Math.min(Math.max(Math.round(fs * 12), 21000), 400000);   // enough for the largest capture (20000 points)
      S.buf = {cap: cap, n: n, head: 0, len: 0, raw: [], disp: [], codes: []};
      for (var i = 0; i < n; i++) { S.buf.raw.push(new Float32Array(cap)); S.buf.disp.push(new Float32Array(cap)); S.buf.codes.push(new Int32Array(cap)); }
      S.bufFs = fs;
      S.chains = null;
    }
    function chains() {
      if (!S.chains) S.chains = S.fe.channels.map(function () { return makeChain($('dfilt').value, S.res.fdr, S.st.env.mainsF); });
      return S.chains;
    }

    /* ======================= real-time loop ======================= */
    var activeTab = 'scope';
    function tick(now) {
      if (S.stream && S.running) {
        var dt = Math.min(0.1, (now - (S.lastT || now)) / 1000); S.lastT = now;
        var want = dt * S.res.fdr + S.carry, n = Math.floor(want), k = produce(n, 12);
        S.carry = k < n ? 0 : want - n;
        S.lag = k < n;
      } else S.lastT = now;
      if (activeTab === 'scope') drawScope();
      if (now - (S.uiT || 0) > 250) { S.uiT = now; liveStatus(); if (activeTab === 'fft') drawFFT(); }
      requestAnimationFrame(tick);
    }
    /* generate n output samples into the buffers (stops early after budgetMs) */
    function produce(n, budgetMs) {
      var b = S.buf, ch = chains(), t0 = performance.now(), k = 0;
      for (; k < n; k++) {
        S.stream.next(S.codes, S.volts);
        for (var i = 0; i < b.n; i++) {
          b.raw[i][b.head] = S.volts[i]; b.codes[i][b.head] = S.codes[i];
          b.disp[i][b.head] = runChain(ch[i], S.volts[i]);
        }
        b.head = (b.head + 1) % b.cap; if (b.len < b.cap) b.len++;
        if (budgetMs && (k & 255) === 255 && performance.now() - t0 > budgetMs) { k++; break; }
      }
      return k;
    }
    function liveStatus() {
      if (!S.res) return;
      var r = S.res, flags = [];
      r.ch.forEach(function (o, i) { if (o.loffP) flags.push(S.fe.channels[i].name + 'P'); if (o.loffN) flags.push(S.fe.channels[i].name + 'N'); });
      var sat = r.ch.filter(function (o, i) { return o.headroom < 0 && S.fe.channels[i].mux === 0; }).length;
      var txt = 'fDR = ' + fmt(r.fdr, 'SPS') + ' · DRDY 每 ' + fmt(1 / r.fdr, 's') + ' · 已輸出 ' + (S.stream ? S.stream.n : 0) + ' 筆';
      if (flags.length) txt += ' · LOFF：' + flags.join('、');
      if (sat) txt += ' · ⚠ ' + sat + ' 個通道 PGA 超出共模範圍';
      if (S.lag) txt += ' · 運算跟不上，畫面變慢';
      $('liveStatus').textContent = txt;
      $('liveStatus').classList.toggle('err', !!(flags.length || sat));
      var b = S.buf, last = (b.head - 1 + b.cap) % b.cap;
      if (b.len) {
        var sw = AFE.statusWord(r), parts = [('000000' + (sw >>> 0).toString(16).toUpperCase()).slice(-6)];
        for (var i = 0; i < b.n; i++) parts.push(('000000' + ((b.codes[i][last] & 0xFFFFFF) >>> 0).toString(16).toUpperCase()).slice(-6));
        $('frameHex').textContent = '最新一筆 DOUT：' + parts.join(' ');
      }
    }

    /* ---- scope (stacked channels) ---- */
    function scaleFor(i, w) {
      var v = $('scale').value;
      if (v !== 'auto' && +v > 0) return +v;
      var lo = Infinity, hi = -Infinity, d = S.buf.disp[i], b = S.buf, n = Math.min(b.len, w);
      for (var k = 0; k < n; k++) { var x = d[(b.head - 1 - k + b.cap) % b.cap]; if (x < lo) lo = x; if (x > hi) hi = x; }
      var span = Math.max(hi - lo, 1e-7), steps = [1e-6, 2e-6, 5e-6, 1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 1e-2, 2e-2, 5e-2, 0.1, 0.2, 0.5, 1];
      for (var s = 0; s < steps.length; s++) if (steps[s] * 3.2 >= span) return steps[s];
      return 1;
    }
    function drawScope() {
      if (!S.buf || !S.fe) return;
      var r = scopeCv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, W = Math.max(280, r.width);
      var vis = S.fe.channels.map(function (c, i) { return i; }).filter(function (i) { return !S.fe.channels[i].pd; });
      if (cfg.derived && $('showDerived') && $('showDerived').checked) cfg.derived.forEach(function (d, k) { vis.push(-1 - k); });
      var lane = W < 500 ? 62 : 74, H = Math.max(160, vis.length * lane + 26);
      if (scopeCv.height !== Math.round(H * dpr) || scopeCv.width !== Math.round(W * dpr)) { scopeCv.width = Math.round(W * dpr); scopeCv.height = Math.round(H * dpr); scopeCv.style.height = H + 'px'; }
      var ctx = sctx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var css = getComputedStyle(scopeCv), bg = css.getPropertyValue('--surface').trim(), rule = css.getPropertyValue('--rule').trim(), muted = css.getPropertyValue('--muted').trim(), ink = css.getPropertyValue('--ink').trim();
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      var L = W < 500 ? 76 : 112, pw = W - L - 8, b = S.buf, win = Math.round(+$('win').value * S.res.fdr), n = Math.min(b.len, win);
      ctx.strokeStyle = rule; ctx.lineWidth = 1;
      for (var g = 0; g <= 10; g++) { var gx = L + pw * g / 10 + 0.5; ctx.beginPath(); ctx.moveTo(gx, 4); ctx.lineTo(gx, H - 20); ctx.stroke(); }
      ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
      vis.forEach(function (i, li) {
        var dv = i < 0 ? cfg.derived[-1 - i] : null;
        var y0 = 6 + li * lane, mid = y0 + lane / 2, sc = dv ? scaleFor(0, win) : scaleFor(i, win), perPx = (lane / 2 - 4) / (sc * 3);
        ctx.strokeStyle = rule; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(L, mid + 0.5); ctx.lineTo(L + pw, mid + 0.5); ctx.stroke(); ctx.globalAlpha = 1;
        if (dv) { drawDerived(dv, li, y0, mid, lane, sc, perPx, L, pw, win, n); return; }
        var ch = S.fe.channels[i], o = S.res.ch[i];
        ctx.fillStyle = global.LabDSP.cssColor(scopeCv, CH_COLORS[i % 8]); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(ch.name, 6, mid - 14);
        ctx.fillStyle = muted; ctx.fillText(ch.label.length > 12 ? ch.label.slice(0, 12) : ch.label, 6, mid);
        ctx.fillText(fmt(sc, 'V', 2) + '/格', 6, mid + 14);
        if (o.loffP || o.loffN) { ctx.fillStyle = global.LabDSP.cssColor(scopeCv, 'var(--warn)'); ctx.fillText('LOFF', L - 36, mid - 14); }
        if (n < 2) return;
        /* the window holds 'win' samples across the plot; the newest sample is at the right edge */
        var d = b.disp[i], cols = Math.max(1, Math.floor(pw)), start = (b.head - n + b.cap) % b.cap, skip = win - n;
        ctx.strokeStyle = global.LabDSP.cssColor(scopeCv, CH_COLORS[i % 8]); ctx.lineWidth = 1.3; ctx.beginPath();
        var mean = 0, started = false;
        if ($('dfilt').value === 'raw') { for (var k = 0; k < n; k++) mean += d[(start + k) % b.cap]; mean /= n; }
        for (var c = 0; c < cols; c++) {
          var a0 = Math.floor(c * win / cols) - skip, a1 = Math.max(a0 + 1, Math.floor((c + 1) * win / cols) - skip), lo = Infinity, hi = -Infinity;
          if (a1 <= 0) continue;
          for (var q = Math.max(0, a0); q < a1; q++) { var v = d[(start + q) % b.cap] - mean; if (v < lo) lo = v; if (v > hi) hi = v; }
          var x = L + c * pw / cols, yl = Math.max(y0, Math.min(y0 + lane, mid - lo * perPx)), yh = Math.max(y0, Math.min(y0 + lane, mid - hi * perPx));
          if (!started) { ctx.moveTo(x, yl); started = true; }
          ctx.lineTo(x, yl); ctx.lineTo(x, yh);
        }
        ctx.stroke();
      });
      ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(fmt(+$('win').value / 10, 's') + '/格' + ($('dfilt').value === 'raw' ? '（減去畫面平均）' : ''), W - 8, H - 5);
    }
    /* derived ECG leads from the display buffers of CH1 (lead I) and CH2 (lead II) */
    function drawDerived(dv, li, y0, mid, lane, sc, perPx, L, pw, win, n) {
      var ctx = sctx, b = S.buf, cols = Math.max(1, Math.floor(pw)), start = (b.head - n + b.cap) % b.cap, skip = win - n, muted = getComputedStyle(scopeCv).getPropertyValue('--muted').trim();
      ctx.fillStyle = muted; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(dv.name, 6, mid - 14); ctx.fillText('（計算）', 6, mid); ctx.fillText(fmt(sc, 'V', 2) + '/格', 6, mid + 14);
      if (n < 2) return;
      ctx.strokeStyle = muted; ctx.lineWidth = 1.2; ctx.beginPath();
      var started = false, d = b.disp, vals = [0, 0];
      for (var c = 0; c < cols; c++) {
        var a0 = Math.floor(c * win / cols) - skip, a1 = Math.max(a0 + 1, Math.floor((c + 1) * win / cols) - skip), lo = Infinity, hi = -Infinity;
        if (a1 <= 0) continue;
        for (var q = Math.max(0, a0); q < a1; q++) { var idx = (start + q) % b.cap; vals[0] = d[0][idx]; vals[1] = d[1][idx]; var v = dv.f(vals); if (v < lo) lo = v; if (v > hi) hi = v; }
        var x = L + c * pw / cols, yl = Math.max(y0, Math.min(y0 + lane, mid - lo * perPx)), yh = Math.max(y0, Math.min(y0 + lane, mid - hi * perPx));
        if (!started) { ctx.moveTo(x, yl); started = true; }
        ctx.lineTo(x, yl); ctx.lineTo(x, yh);
      }
      ctx.stroke();
    }
    function dispModes() {
      return isECG ? [['raw', '原始'], ['dc', '去直流（0.1 Hz 高通）'], ['ecg', '0.5–40 Hz＋市電陷波']] : [['raw', '原始'], ['dc', '去直流（0.1 Hz 高通）'], ['band', '0.5–45 Hz＋市電陷波']];
    }
    $('dfilt').innerHTML = dispModes().map(function (m) { return '<option value="' + m[0] + '">' + m[1] + '</option>'; }).join('');
    $('dfilt').value = isPDK ? 'raw' : 'dc';
    $('dfilt').addEventListener('change', function () {
      S.chains = null; var ch = chains(), b = S.buf;
      if (!b) return;
      var start = (b.head - b.len + b.cap) % b.cap;
      for (var i = 0; i < b.n; i++) for (var k = 0; k < b.len; k++) {
        var idx = (start + k) % b.cap;
        b.disp[i][idx] = runChain(ch[i], b.raw[i][idx]);
      }
    });
    $('run').addEventListener('click', function () { S.running = !S.running; this.textContent = S.running ? '暫停' : '繼續'; });

    /* ---- spectrum ---- */
    function fillChannelSelects() {
      var opts = S.fe.channels.map(function (c, i) { return '<option value="' + i + '">' + esc(c.name + ' ' + c.label) + '</option>'; }).join('');
      ['fftCh', 'histCh', 'nzCh'].forEach(function (id) { var s = $(id), v = s.value; s.innerHTML = opts; if (v && +v < S.fe.channels.length) s.value = v; });
    }
    function lastN(arr, n) {
      var b = S.buf, out = new Float64Array(n), start = (b.head - n + b.cap) % b.cap;
      for (var k = 0; k < n; k++) out[k] = arr[(start + k) % b.cap];
      return out;
    }
    function drawFFT() {
      if (!S.buf || !S.res) return;
      var i = +$('fftCh').value || 0, n = Math.min(S.buf.len, Math.round(+$('fftLen').value * S.res.fdr));
      if (n < 64) { $('fftNote').textContent = '資料還不夠，等一下。'; return; }
      var y = lastN(S.buf.raw[i], n), sp = global.LabDSP.spectrum(y, S.res.fdr);
      var psd = sp.psd.map(Math.sqrt), o = S.res.ch[i], noiseD = Math.sqrt(o.chipNoise.rms * o.chipNoise.rms + o.circRms * o.circRms) / Math.sqrt(S.res.fdr / 2);
      var unit = $('fftUnit').value;
      if (unit === 'db') {
        var fs = S.res.vref / S.fe.channels[i].gain / Math.SQRT2;
        fftPlot.o.ylog = false; fftPlot.o.yunit = 'dB'; fftPlot.o.ylabel = 'dBFS（rms）';
        fftPlot.draw([{x: sp.f, y: sp.mag.map(function (m) { return 20 * Math.log10(Math.max(m, 1e-15) / fs); }), color: CH_COLORS[i % 8], label: S.fe.channels[i].name}],
          {xRange: [sp.f[0], S.res.fdr / 2], vlines: markers()});
      } else {
        fftPlot.o.ylog = true; fftPlot.o.yunit = 'V/√Hz'; fftPlot.o.ylabel = '雜訊密度';
        fftPlot.draw([{x: sp.f, y: psd, color: CH_COLORS[i % 8], label: S.fe.channels[i].name},
          {x: [sp.f[0], S.res.fdr / 2], y: [noiseD, noiseD], color: 'var(--muted)', dash: [5, 4], width: 1.2, label: '預期白雜訊（資料手冊＋電路）'}],
          {xRange: [sp.f[0], S.res.fdr / 2], vlines: markers()});
      }
      $('fftNote').textContent = 'Hann 視窗，' + sp.n + ' 點（' + fmt(sp.n / S.res.fdr, 's') + '），解析度 ' + fmt(S.res.fdr / sp.n, 'Hz') + '。sinc3 的 −3 dB 在 ' + fmt(0.262 * S.res.fdr, 'Hz') + '，零點在 fDR 的整數倍。';
    }
    function markers() {
      var m = [{v: S.st.env.mainsF, label: '市電', color: 'var(--warn)'}];
      if (S.res.loffF) m.push({v: S.res.loffF, label: 'lead-off', color: 'var(--c4)'});
      if (!isECG && !isPDK) m.push({v: 10.2, label: 'alpha', color: 'var(--c3)'});
      return m;
    }
    ['fftCh', 'fftLen', 'fftUnit'].forEach(function (id) { $(id).addEventListener('change', drawFFT); });

    /* ---- statistics (like the TI GUI: mean, rms, peak-to-peak per channel) ---- */
    $('acq').addEventListener('click', function () {
      var N = +$('acqN').value, need = N / S.res.fdr;
      $('acqStatus').textContent = '擷取中，約 ' + fmt(need, 's') + '…';
      var startN = S.stream.n;
      (function wait() {
        if (S.stream.n - startN >= N || S.buf.len >= S.buf.cap) { finish(Math.min(N, S.buf.len)); return; }
        setTimeout(wait, 100);
      })();
      function finish(n) {
        S.acq = S.fe.channels.map(function (c, i) { return lastN(S.buf.raw[i], n); });
        S.acqN = n; showStats();
        $('acqStatus').textContent = n + ' 點（' + fmt(n / S.res.fdr, 's') + '）';
      }
    });
    function showStats() {
      if (!S.acq) return;
      var rows = S.acq.map(function (y, i) {
        var n = y.length, m = 0, lo = Infinity, hi = -Infinity, k;
        for (k = 0; k < n; k++) { m += y[k]; if (y[k] < lo) lo = y[k]; if (y[k] > hi) hi = y[k]; }
        m /= n; var v = 0; for (k = 0; k < n; k++) v += (y[k] - m) * (y[k] - m); v = Math.sqrt(v / Math.max(1, n - 1));
        var o = S.res.ch[i];
        return '<tr><td>' + esc(S.fe.channels[i].name) + '</td><td>' + esc(S.fe.channels[i].label) + '</td><td class="num">' + uv(m, 4) + '</td><td class="num">' + uv(v) + '</td><td class="num">' + uv(hi - lo) +
          '</td><td class="num">' + uv(o.chipNoise.rms) + ' / ' + uv(o.chipNoise.pp) + '</td><td class="num">' + uv(o.circRms) + '</td></tr>';
      });
      $('statTable').innerHTML = '<thead><tr><th>通道</th><th></th><th>平均（偏移）</th><th>rms</th><th>峰對峰</th><th>資料手冊（短路）rms / pp</th><th>電路熱雜訊 rms</th></tr></thead><tbody>' + rows.join('') + '</tbody>';
      drawHist();
      $('statNote').textContent = '和 TI GUI 的 Scope 表格同一種算法：平均就是通道偏移，rms 與峰對峰是 AC 雜訊。資料手冊的雜訊是輸入短路、10 秒、典型值；峰對峰約是 rms 的 6.6 倍，點數越多峰對峰越大。';
    }
    function drawHist() {
      if (!S.acq) return;
      var i = +$('histCh').value || 0, y = S.acq[i], n = y.length, m = 0, k;
      for (k = 0; k < n; k++) m += y[k]; m /= n;
      var lo = Infinity, hi = -Infinity; for (k = 0; k < n; k++) { lo = Math.min(lo, y[k]); hi = Math.max(hi, y[k]); }
      var nb = 40, w = (hi - lo) / nb || 1e-9, bins = new Array(nb).fill(0), xs = [];
      for (k = 0; k < n; k++) bins[Math.min(nb - 1, Math.floor((y[k] - lo) / w))]++;
      for (k = 0; k < nb; k++) xs.push(lo + (k + 0.5) * w);
      histPlot.draw([{x: xs, y: bins, bars: true, barWidth: w, color: CH_COLORS[i % 8]}], {xRange: [lo - w, hi + w], yRange: [0, Math.max.apply(null, bins) * 1.15], vlines: [{v: m, label: '平均'}]});
    }
    $('histCh').addEventListener('change', drawHist);
    $('csv').addEventListener('click', function () {
      if (!S.acq) return;
      var head = ['t_s'].concat(S.fe.channels.map(function (c) { return c.name + '_V'; })), L = [head.join(',')];
      for (var k = 0; k < S.acqN; k++) L.push([(k / S.res.fdr).toFixed(6)].concat(S.acq.map(function (y) { return y[k].toExponential(6); })).join(','));
      download(kind + '-capture.csv', L.join('\n'), 'text/csv');
    });

    /* ---- front-end circuit ---- */
    function renderFE() {
      var r = S.res, fe = S.fe, st = S.st, rails = r.rails;
      var cmPeak = r.bodyAC;
      var sum = '<div class="reads">' +
        read('電源', fmt(rails.avdd, 'V') + ' / ' + fmt(rails.avss, 'V')) +
        read('VREF', fmt(r.vref, 'V')) +
        read('fMOD / 抽取', fmt(r.fmod, 'Hz') + ' / ' + r.decim) +
        read('人體 DC', fmt(r.bodyDC, 'V', 4)) +
        read('人體 ' + st.env.mainsF + ' Hz 共模', fmt(cmPeak, 'V') + ' 峰值') +
        (isFinite(r.biasOut) ? read((isECG ? 'RLD' : 'BIAS') + 'OUT', fmt(r.biasOut, 'V', 4)) : '') +
        '</div>';
      if (fe.notes.length || r.warn.length) sum += '<ul class="warnlist">' + fe.notes.concat(r.warn).map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
      $('feSummary').innerHTML = sum;
      var rows = fe.channels.map(function (ch, i) {
        var o = r.ch[i], mains = 2 * Math.hypot(o.mains1[0], o.mains1[1]);
        return '<tr><td>' + esc(ch.name) + '</td><td>' + esc(ch.label) + '</td><td class="num">' + fmt(o.vp, 'V', 4) + '</td><td class="num">' + fmt(o.vn, 'V', 4) + '</td><td class="num">' + fmt(o.vd, 'V', 3) +
          '</td><td class="num ' + (o.headroom < 0 ? 'warn' : '') + '">' + (o.headroom < 0 ? '超出 ' + fmt(-o.headroom, 'V') : '餘 ' + fmt(o.headroom, 'V')) +
          '</td><td class="num">' + fmt(mains, 'V') + '</td><td class="num">' + fmt(o.circRms, 'V') + '</td><td>' + (o.loffP ? 'P ' : '') + (o.loffN ? 'N' : '') + '</td></tr>';
      });
      $('feTable').innerHTML = '<thead><tr><th>通道</th><th></th><th>V(INP)</th><th>V(INN)</th><th>差動 DC</th><th>PGA 共模範圍</th><th>' + st.env.mainsF + ' Hz 差模（峰對峰）</th><th>電路雜訊 rms</th><th>LOFF</th></tr></thead><tbody>' + rows.join('') + '</tbody>';
      $('feTime').textContent = '這組分析（DC、AC、雜訊）花 ' + r.ms.toFixed(0) + ' ms，電路有 ' + r.sim.n + ' 個未知數。';
      if (activeTab === 'fe') { drawCM(); drawNoise(); }        // the 50-point sweep only when the tab is open
    }
    function read(k, v) { return '<div class="read"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }
    function drawCM() {
      var sw = AFE.cmSweep(S.fe, S.res, 1, 10000, 50), f = sw.map(function (r) { return r.f; });
      var series = [{x: f, y: sw.map(function (r) { return r.body; }), color: 'var(--ink)', label: '人體共模'}];
      S.fe.channels.forEach(function (c, i) { if (i < 8) series.push({x: f, y: sw.map(function (r) { return Math.max(r.ch[i], 1e-15); }), color: CH_COLORS[i], label: c.name + ' 差模', width: 1.2}); });
      cmPlot.draw(series, {vlines: [{v: S.st.env.mainsF, label: '市電', color: 'var(--warn)'}]});
      $('cmNote').textContent = '假設市電在每個頻率都是 ' + S.st.env.mainsV + ' Vrms，看耦合路徑的頻率響應。差模越小越好：它直接疊在訊號上，而且和訊號同頻帶的部分濾不掉。';
    }
    function drawNoise() {
      var i = +$('nzCh').value || 0, o = S.res.ch[i];
      var rows = o.noiseParts.map(function (p) { return '<tr><td>' + esc(p.name) + '</td><td class="num">' + fmt(p.rms, 'Vrms') + '</td></tr>'; });
      var chipR = o.chipNoise.rms, tot = Math.sqrt(chipR * chipR + o.circRms * o.circRms);
      $('nzTable').innerHTML = '<thead><tr><th>來源（經 sinc3 頻寬）</th><th>換算到輸入</th></tr></thead><tbody>' +
        '<tr><td>ADS 晶片本身（資料手冊表，' + S.fe.channels[i].gain + ' 倍、' + fmt(S.res.fdr, 'SPS') + '）</td><td class="num">' + fmt(chipR, 'Vrms') + '</td></tr>' +
        rows.join('') + '<tr><td><b>合計</b>（約 ' + fmt(6.6 * tot, 'Vpp') + '）</td><td class="num"><b>' + fmt(tot, 'Vrms') + '</b></td></tr></tbody>';
      nzPlot.draw([{x: o.psd.f, y: o.psd.v.map(function (v) { return Math.max(v, 1e-12); }), color: CH_COLORS[i % 8], label: '電路雜訊密度（未經 sinc3）'}]);
    }
    $('nzCh').addEventListener('change', drawNoise);
    $('spiceBtn').addEventListener('click', function () {
      download(kind + '-frontend.cir', CS.toSpice(S.fe.circuit, {title: kind + ' front end (circuit-sim export)', ac: {f0: 1, f1: 10000}}), 'text/plain');
    });

    /* ---- registers ---- */
    function renderRegs() {
      var R = AFE.registers(S.st);
      $('regTable').innerHTML = '<thead><tr><th>位址</th><th>暫存器</th><th>值</th><th>二進位</th><th>說明</th></tr></thead><tbody>' + R.map(function (r) {
        return '<tr><td class="num">' + AFE.hex2(r.addr) + 'h</td><td>' + r.name + '</td><td class="num">' + AFE.hex2(r.v) + 'h</td><td class="num">' + r.v.toString(2).padStart(8, '0').replace(/(\d{4})/, '$1 ') + '</td><td>' + esc(r.desc || '') + '</td></tr>';
      }).join('') + '</tbody>';
      $('initCode').textContent = AFE.initCode(S.st, R);
      var n = S.fe.channels.length, bits = 24 * (n + 1), sclk = bits * S.res.fdr;
      $('frameInfo').innerHTML = '<ul><li>每次 DRDY 讀 ' + bits + ' bits：24 bits 狀態（1100 + LOFF_STATP + LOFF_STATN + GPIO[7:4]）＋ ' + n + ' 通道 × 24 bits，二補數、MSB 先。</li>' +
        '<li>LSB = VREF /（增益 ×（2²³ − 1））＝ ' + fmt(S.res.vref / S.fe.channels[0].gain / (Math.pow(2, 23) - 1), 'V') + '（CH1）。滿刻度 ±VREF / 增益 = ±' + fmt(S.res.vref / S.fe.channels[0].gain, 'V') + '。</li>' +
        '<li>' + fmt(S.res.fdr, 'SPS') + ' 時資料量 ' + fmt(sclk, 'bit/s') + '；SCLK 至少要 ' + fmt(sclk, 'Hz') + '，還要在下一次 DRDY 前讀完（實務上 ≥ 4 倍）。</li>' +
        (S.st.chip === 'ads1299' ? '<li class="warn">注意：資料手冊 10.1.2.1 的範例 <span class="kbd">WREG LOFF 0x13</span> 沿用 ADS1298 的寫法；照 ADS1299 的暫存器表，0x13 會設到保留的 bit 4，而且 FLEAD_OFF = 11 是 fDR/4 交流 lead-off，不是直流。範例裡的 RLD_SENSP 在 ADS1299 叫 BIAS_SENSP。</li>' : '') +
        (S.st.chip === 'ads1294' ? '<li>ADS1294 的增益碼不是照大小排：000 = 6、001 = 1、…、101 = 8、110 = 12。CONFIG2 bit 7:6 寫 0（表格的重置值 40h 與說明不一致）。</li>' : '') + '</ul>';
    }
    $('copyInit').addEventListener('click', function () { if (navigator.clipboard) navigator.clipboard.writeText($('initCode').textContent); });

    /* ---- delta-sigma demo ---- */
    function renderDS() {
      var boxDS = $('dsBox');
      if (!boxDS.dataset.built) {
        boxDS.dataset.built = '1';
        boxDS.innerHTML = '<p class="notes" style="margin-top:0">ADS1299 的 ADC 是二階 Δ-Σ 調變器（fMOD = fCLK / 2 = 1.024 MHz），後面接 sinc3 抽取濾波器。這裡用一個教科書式的二階調變器（不是 TI 的實際係數）跑一段輸入，看量化雜訊怎麼被推到高頻、sinc3 怎麼把它濾掉。</p>' +
          '<div class="row"><label class="inline">輸入 <select id="dsAmp"><option value="0.5">0.5 FS 正弦</option><option value="0.1">0.1 FS</option><option value="0.01">0.01 FS</option></select></label>' +
          '<label class="inline">頻率 <select id="dsF"><option value="31.25">31.25 Hz</option><option value="250">250 Hz</option><option value="1000">1 kHz</option></select></label>' +
          '<button type="button" class="btn primary sm" id="dsRun">執行</button></div>' +
          '<canvas class="plot" id="dsBits" style="margin-top:8px;height:140px"></canvas><canvas class="plot tall" id="dsPsd" style="margin-top:8px"></canvas><div id="dsTable" class="scroll-x"></div>';
        boxDS.querySelector('#dsRun').addEventListener('click', runDS);
      }
    }
    function runDS() {
      var fm = 1.024e6, N = 1 << 17, A = +$('dsAmp').value, f = +$('dsF').value, bits = new Float64Array(N), i1 = 0, i2 = 0, y = 1, x;
      for (var k = 0; k < N; k++) {
        x = A * Math.sin(2 * Math.PI * f * k / fm);
        i1 += x - y; i2 += i1 - y;
        y = i2 >= 0 ? 1 : -1; bits[k] = y;
      }
      var bp = new window.LabPlot($('dsBits'), {xunit: 's', yunit: ''}), show = 400, xs = [], ys = [], xi = [];
      for (k = 0; k < show; k++) { xs.push(k / fm); ys.push(bits[k]); xi.push(A * Math.sin(2 * Math.PI * f * k / fm)); }
      bp.draw([{x: xs, y: ys, color: 'var(--c1)', label: '調變器輸出（±1）', width: 1}, {x: xs, y: xi, color: 'var(--c2)', label: '輸入'}], {yRange: [-1.3, 1.3]});
      var sp = global.LabDSP.spectrum(bits, fm), pp = new window.LabPlot($('dsPsd'), {xlog: true, xunit: 'Hz', yunit: 'dB', ylabel: '功率密度 dB（相對 FS）'});
      var dbs = sp.psd.map(function (p) { return 10 * Math.log10(Math.max(p, 1e-30) * fm / 2); });
      var rows = [], decs = [64, 256, 1024, 4096];
      decs.forEach(function (D) {
        /* sinc3 decimate the bitstream and measure the noise left after removing the input sine */
        var taps = AFE.sincTaps(D), L = taps.length, out = [];
        for (var s = L; s + 1 < N; s += D) { var acc = 0; for (var q = 0; q < L; q++) acc += taps[q] * bits[s - q]; out.push(acc); }
        var M = out.length, fdr = fm / D, best = 0, bi = 0, bq = 0, err = 0;
        /* fit a sine at f (amplitude and phase) by least squares, rms of the rest is the quantisation noise */
        var cs = 0, sn = 0, cc = 0, ss2 = 0, cs2 = 0;
        for (var m = 0; m < M; m++) { var t = (m * D + L - 1 - (L - 1) / 2) / fm, c = Math.cos(2 * Math.PI * f * t), si = Math.sin(2 * Math.PI * f * t); cs += out[m] * c; sn += out[m] * si; cc += c * c; ss2 += si * si; cs2 += c * si; }
        var det = cc * ss2 - cs2 * cs2, a = (cs * ss2 - sn * cs2) / det, b2 = (sn * cc - cs * cs2) / det;
        for (m = 0; m < M; m++) { var t2 = (m * D + L - 1 - (L - 1) / 2) / fm, r = out[m] - a * Math.cos(2 * Math.PI * f * t2) - b2 * Math.sin(2 * Math.PI * f * t2); err += r * r; }
        var rmsE = Math.sqrt(err / Math.max(1, M)), snr = 20 * Math.log10(Math.hypot(a, b2) / Math.SQRT2 / Math.max(rmsE, 1e-12));
        rows.push('<tr><td class="num">' + D + '</td><td class="num">' + fmt(fdr, 'SPS') + '</td><td class="num">' + snr.toFixed(1) + ' dB</td><td class="num">' + ((snr - 1.76) / 6.02).toFixed(1) + ' bits</td><td class="num">' + M + '</td></tr>');
      });
      pp.draw([{x: sp.f, y: dbs, color: 'var(--c1)', label: '調變器輸出頻譜', width: 1}], {xRange: [sp.f[0], fm / 2], vlines: decs.map(function (D) { return {v: 0.262 * fm / D, label: '−3 dB @ ' + fmt(fm / D, 'SPS'), color: 'var(--c3)'}; })});
      $('dsTable').innerHTML = '<table class="data" style="margin-top:8px"><thead><tr><th>sinc3 抽取 N</th><th>輸出速率</th><th>SNR（只有量化雜訊）</th><th>等效位元</th><th>輸出點數</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>' +
        '<p class="hint">二階雜訊整形：量化雜訊每十倍頻上升約 40 dB，所以抽取比每加倍，SNR 約多 15 dB。N = 64（16 kSPS）時量化雜訊還很大，這就是資料手冊在 16 kSPS 的雜訊突然變大（增益 1 時 21.7 µVrms，8 kSPS 只有 6.9 µVrms）的原因；低速時晶片的熱雜訊和 1/f 雜訊才是主角。</p>';
    }

    /* ---- tabs ---- */
    function showTab(name) {
      activeTab = name;
      left.querySelectorAll('[role=tab]').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false'); });
      left.querySelectorAll('.tabpanel').forEach(function (p) { p.hidden = p.dataset.panel !== name; });
      if (name === 'fft') drawFFT();
      if (name === 'fe' && S.res) { drawCM(); drawNoise(); }
      if (name === 'stats') showStats();
      if (name === 'ds' && $('dsTable') && !$('dsTable').innerHTML) runDS();
    }
    left.querySelectorAll('[role=tab]').forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); }); });

    function download(name, text, type) {
      var a = document.createElement('a'), url = URL.createObjectURL(new Blob([text], {type: type}));
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    var api = {state: function () { return S; }, showTab: showTab, recompute: recompute, applyPreset: applyPreset,
      /* for testing from the console: generate 'sec' seconds of data now and redraw */
      advance: function (sec) { produce(Math.round(sec * S.res.fdr)); drawScope(); liveStatus(); if (activeTab === 'fft') drawFFT(); },
      draw: function () { drawScope(); drawFFT(); }};
    renderSettings();
    var first = (cfg.presets || [])[0];
    if (first) applyPreset(first); else recompute();
    requestAnimationFrame(tick);
    return api;
  };
})(window);
