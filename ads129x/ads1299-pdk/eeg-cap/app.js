/* PDK + breadboard + EEG cap: drawing, probes, oscilloscope, ADS1299 output, step-through. Model in model.js. */
(function () {
  'use strict';
  var M = window.EEGCAP, CS = window.CircuitSim, AFE = window.AFE;
  var $ = function (id) { return document.getElementById(id); };
  var st = M.defaultState(), model = null, sel = 'regs', placing = null, preset = 'ok';
  var view = 'scope', running = true;

  /* ===================== formatting ===================== */
  function fmtV(v, d) {
    if (v == null || !isFinite(v)) return '—';
    if (Math.abs(v) < 5e-9) return '0 V';
    var a = Math.abs(v);
    if (a >= 0.1) return v.toFixed(d == null ? 3 : d) + ' V';
    if (a >= 1e-4) return (v * 1e3).toFixed(a >= 0.01 ? 1 : 2) + ' mV';
    return (v * 1e6).toFixed(a >= 1e-5 ? 1 : 2) + ' µV';
  }
  function fmtI(i) {
    var a = Math.abs(i);
    if (!isFinite(i)) return '—';
    if (a >= 1e-4) return (i * 1e3).toFixed(2) + ' mA';
    if (a >= 1e-7) return (i * 1e6).toFixed(2) + ' µA';
    return (i * 1e9).toFixed(1) + ' nA';
  }
  function divTxt(v) { return v >= 1 ? v + ' V' : v >= 1e-3 ? +(v * 1e3).toPrecision(3) + ' mV' : +(v * 1e6).toPrecision(3) + ' µV'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  /* ===================== geometry ===================== */
  var P = 17, BBY = 80, XA = 470, XF = 589, COLS = 'abcdefghij';
  function hx(c) { var i = COLS.indexOf(c); return i < 5 ? XA + i * P : XF + (i - 5) * P; }
  function hy(r) { return BBY + (r - 1) * P; }
  var BX = 790, BY = 57.4;
  function fx(u) { return BX + u * P; }
  function fy(v) { return BY + v * P; }
  var HDR = {JP6: {u: 5.32, v: 23.9, d: 1}, JP7: {u: 5.32, v: 25.86, d: 1}, JP8: {u: 5.32, v: 27.9, d: 1},
    JP1: {u: 9.2, v: 6.95, d: 1}, JP2: {u: 24.73, v: 7.63, d: -1}, JP20: {u: 29.36, v: 7.63, d: -1}};
  var TPS = {TP5: [22.66, 5.81, 'TP5'], TP13: [24.73, 5.81, 'TP13'], TP6: [27.34, 5.81, 'TP6'], TP7: [24.3, 20.3, 'TP7 +5V'], TP8: [24.3, 21.4, 'TP8']};
  var HEAD = {x: 190, y: 330, r: 120};
  var EPOS = {Fp1: [-18, 0.8], Fp2: [18, 0.8], Fz: [0, 0.4], C3: [-90, 0.42], C4: [90, 0.42], Pz: [180, 0.4], O1: [198, 0.8], O2: [162, 0.8]};
  function epos(nm) {
    if (nm === 'REF') return [HEAD.x + HEAD.r + 14, HEAD.y];
    if (nm === 'BIAS') return [HEAD.x - HEAD.r - 14, HEAD.y];
    var a = EPOS[nm][0] * Math.PI / 180, r = EPOS[nm][1] * HEAD.r;
    return [HEAD.x + r * Math.sin(a), HEAD.y - r * Math.cos(a)];
  }
  function ptXY(pt) {
    var m = /^bb:(\d+):([a-j])$/.exec(pt);
    if (m) return [hx(m[2]), hy(+m[1])];
    m = /^J6\.(\d+)$/.exec(pt);
    if (m) { var n = +m[1]; return [fx(n % 2 ? 1 : 2), fy(4.33 + Math.ceil(n / 2) - 1)]; }
    m = /^JP25\.(\d)$/.exec(pt);
    if (m) { n = +m[1]; return [fx(n % 2 ? 1 : 2), fy(23.35 + Math.ceil(n / 2) - 1)]; }
    m = /^(JP\d+)\.(\d)$/.exec(pt);
    if (m && HDR[m[1]]) { var h = HDR[m[1]]; return [fx(h.u + h.d * (+m[2] - 1) * 1.06), fy(h.v)]; }
    if (TPS[pt]) return [fx(TPS[pt][0]), fy(TPS[pt][1])];
    if (pt === 'R8.1') return [fx(9.55), fy(9.75)];
    if (pt === 'R8.2') return [fx(11.0), fy(9.75)];
    return [0, 0];
  }

  /* ===================== svg helpers ===================== */
  var NS = 'http://www.w3.org/2000/svg';
  function E(tag, a, parent, text) {
    var e = document.createElementNS(NS, tag);
    for (var k in a) if (a[k] != null) e.setAttribute(k, a[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function tip(e, s) { E('title', {}, e, s); return e; }
  function G(parent, a) { return E('g', a || {}, parent); }

  /* ===================== drawing ===================== */
  var svg = $('bb');
  function draw() {
    var w = model.w;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.classList.toggle('placing', !!placing);
    E('rect', {x: 0, y: 0, width: 1500, height: 700, fill: '#e9ece6'}, svg);
    drawHead();
    drawBreadboard(w);
    drawMMB0(w);
    drawFE(w);
    drawLeads(w);
    drawElectrodes();
    drawRowLabels(w);
    drawWires(w);
    drawScopeGnd(w);
    drawProbes();
    markSel();
  }

  function drawHead() {
    var g = G(svg, {'data-info': 'head'}), h = HEAD;
    E('path', {d: 'M' + (h.x - 20) + ',' + (h.y - h.r + 4) + ' L' + h.x + ',' + (h.y - h.r - 22) + ' L' + (h.x + 20) + ',' + (h.y - h.r + 4) + 'Z', fill: '#f1d9c4', stroke: '#8a6d58', 'stroke-width': 2}, g);
    E('ellipse', {cx: h.x - h.r - 6, cy: h.y, rx: 14, ry: 30, fill: '#f1d9c4', stroke: '#8a6d58', 'stroke-width': 2}, g);
    E('ellipse', {cx: h.x + h.r + 6, cy: h.y, rx: 14, ry: 30, fill: '#f1d9c4', stroke: '#8a6d58', 'stroke-width': 2}, g);
    E('circle', {cx: h.x, cy: h.y, r: h.r, fill: '#f6e3d3', stroke: '#8a6d58', 'stroke-width': 2.5}, g);
    E('circle', {cx: h.x, cy: h.y, r: h.r * 0.8, fill: 'none', stroke: '#c9ad95', 'stroke-dasharray': '4 4'}, g);
    E('line', {x1: h.x, y1: h.y - h.r, x2: h.x, y2: h.y + h.r, stroke: '#c9ad95', 'stroke-dasharray': '4 4'}, g);
    E('line', {x1: h.x - h.r, y1: h.y, x2: h.x + h.r, y2: h.y, stroke: '#c9ad95', 'stroke-dasharray': '4 4'}, g);
    E('text', {x: h.x, y: h.y - h.r - 30, 'text-anchor': 'middle', 'font-size': 12, fill: '#5d4a3b', class: 'zh'}, g, '鼻子（俯視）');
    E('text', {x: h.x - h.r - 8, y: h.y + 52, 'text-anchor': 'middle', 'font-size': 11, fill: '#5d4a3b', class: 'zh'}, g, '左耳');
    E('text', {x: h.x + h.r + 8, y: h.y + 52, 'text-anchor': 'middle', 'font-size': 11, fill: '#5d4a3b', class: 'zh'}, g, '右耳');
  }
  /* electrodes and ear clips go on top of the leads */
  function drawElectrodes() {
    M.CH.forEach(function (nm, i) {
      var p = epos(nm), on = st.contact[nm] !== false;
      var e = G(svg, {'data-item': 'lead' + (i + 1)});
      tip(e, nm + ' → CH' + (i + 1));
      E('circle', {cx: p[0], cy: p[1], r: 15, fill: on ? '#d9dde0' : '#fff', stroke: M.COLOR[i], 'stroke-width': 4, 'stroke-dasharray': on ? null : '3 3'}, e);
      E('text', {x: p[0], y: p[1] + 4, 'text-anchor': 'middle', 'font-size': 10.5, 'font-weight': 700, fill: '#222'}, e, nm);
    });
    [['REF', 'leadref', 'A2 REF', M.REFC], ['BIAS', 'leadbias', 'A1 BIAS', M.BIASC]].forEach(function (a) {
      var p = epos(a[0]), on = st.contact[a[0]] !== false, e = G(svg, {'data-item': a[1]});
      tip(e, a[0] === 'REF' ? '右耳夾：參考（REF）' : '左耳夾：BIAS');
      E('rect', {x: p[0] - 13, y: p[1] - 22, width: 26, height: 44, rx: 6, fill: '#b8bec3', stroke: a[3] === M.REFC ? '#777' : a[3], 'stroke-width': 3, 'stroke-dasharray': on ? null : '3 3'}, e);
      E('text', {x: p[0], y: p[1] - 27, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 700, fill: '#222'}, e, a[2]);
    });
  }

  function drawBreadboard(w) {
    var g = G(svg, {'data-info': 'bb'});
    E('rect', {x: 405, y: 50, width: 326, height: 552, rx: 7, fill: '#f4f2ea', stroke: '#c9c3b1', 'stroke-width': 1.5}, g);
    E('rect', {x: 548, y: 56, width: 31, height: 540, fill: '#e2ded2'}, g);
    /* rails (unused) */
    [[421, '#2f6bd6'], [440, '#d7332a'], [697, '#2f6bd6'], [716, '#d7332a']].forEach(function (r) {
      E('line', {x1: r[0] + (r[0] < 500 ? -7 : 7), y1: 60, x2: r[0] + (r[0] < 500 ? -7 : 7), y2: 592, stroke: r[1], 'stroke-width': 1.2, opacity: .7}, g);
      for (var row = 1; row <= 30; row++) {
        if (row % 6 === 0) continue;
        var hole = E('rect', {x: r[0] - 3.5, y: hy(row) - 3.5, width: 7, height: 7, rx: 1, fill: '#4a4a4a', 'data-pt': 'rail:' + r[0], opacity: .8}, g);
        tip(hole, '電源軌（不用）');
      }
    });
    COLS.split('').forEach(function (c) {
      E('text', {x: hx(c), y: 64, 'text-anchor': 'middle', 'font-size': 9, fill: '#8a8577'}, g, c);
      E('text', {x: hx(c), y: 599, 'text-anchor': 'middle', 'font-size': 9, fill: '#8a8577'}, g, c);
    });
    for (var r = 1; r <= 30; r++) {
      E('text', {x: 457, y: hy(r) + 3, 'text-anchor': 'middle', 'font-size': 7.5, fill: '#8a8577'}, g, r);
      E('text', {x: 673, y: hy(r) + 3, 'text-anchor': 'middle', 'font-size': 7.5, fill: '#8a8577'}, g, r);
      for (var i = 0; i < 10; i++) {
        var c2 = COLS[i], pt = 'bb:' + r + ':' + c2, x = hx(c2), y = hy(r);
        var hh = E('g', {'data-pt': pt}, g);
        E('rect', {x: x - 7.5, y: y - 7.5, width: 15, height: 15, fill: 'transparent'}, hh);
        E('rect', {x: x - 3.5, y: y - 3.5, width: 7, height: 7, rx: 1, fill: '#3b3b3b'}, hh);
        tip(hh, M.pointName(pt));
      }
    }
    E('text', {x: 568, y: 44, 'text-anchor': 'middle', 'font-size': 12, fill: '#5f6b72', class: 'zh'}, svg, '麵包板（只用右半邊；第 23 排用到左半邊）');
  }
  /* row labels in the groove, drawn over the leads */
  function drawRowLabels(w) {
    function lab(row, txt, col) {
      var t = G(svg, {'pointer-events': 'none'});
      E('rect', {x: 550, y: hy(row) - 7, width: 27, height: 14, rx: 3, fill: '#fff', stroke: col, 'stroke-width': 1.5, opacity: .95}, t);
      E('text', {x: 563.5, y: hy(row) + 3.5, 'text-anchor': 'middle', 'font-size': 8.5, 'font-weight': 700, fill: '#222'}, t, txt);
    }
    for (var k = 1; k <= 8; k++) lab(M.bbRow(k), M.CH[k - 1], M.COLOR[k - 1]);
    lab(M.ROW_REF, 'REF', '#888');
    if (!w.resistor) lab(M.ROW_BIAS, 'BIAS', '#222');
    /* the 100 kOhm across the groove */
    if (w.resistor) {
      var y0 = hy(M.ROW_BIAS), rg = G(svg, {'data-item': 'r100k'});
      tip(rg, (st.biasR / 1e3) + ' kΩ：e23 ↔ f23');
      E('line', {x1: hx('e'), y1: y0, x2: hx('f'), y2: y0, stroke: '#9a9a9a', 'stroke-width': 2}, rg);
      E('rect', {x: 552, y: y0 - 5.5, width: 23, height: 11, rx: 5, fill: '#d9c39a', stroke: '#8c7650'}, rg);
      var bands = st.biasR === 47e3 ? ['#e3bf12', '#8b4fd0', '#f08a24'] : ['#8b5a2b', '#111', '#e3bf12'];
      bands.forEach(function (b, i) { E('rect', {x: 556 + i * 4.5, y: y0 - 5.5, width: 2.6, height: 11, fill: b}, rg); });
      E('rect', {x: 570, y: y0 - 5.5, width: 2.6, height: 11, fill: '#c9a227'}, rg);
      E('text', {x: 563.5, y: y0 - 9, 'text-anchor': 'middle', 'font-size': 8.5, 'font-weight': 700, fill: '#222'}, rg, (st.biasR / 1e3) + 'k');
    }
  }

  function drawMMB0(w) {
    var g = G(svg, {'data-info': 'MMB0'});
    E('rect', {x: 960, y: 12, width: 460, height: 676, rx: 8, fill: '#2b6640', stroke: '#173d25', 'stroke-width': 2}, g);
    E('text', {x: 1377, y: 330, 'text-anchor': 'middle', 'font-size': 18, 'font-weight': 700, fill: '#e8f3e8'}, g, 'MMB0');
    E('text', {x: 1377, y: 350, 'text-anchor': 'middle', 'font-size': 11, fill: '#cfe3d2', class: 'zh'}, g, '主機板（在下層）');
    E('rect', {x: 1384, y: 150, width: 34, height: 22, rx: 3, fill: '#444', stroke: '#222'}, g);
    E('text', {x: 1377, y: 190, 'text-anchor': 'middle', 'font-size': 9.5, fill: '#cfe3d2', class: 'zh'}, g, 'DC 插座不用');
    var u = G(svg, {'data-item': 'usb'});
    tip(u, 'USB → 筆電（只用電池）');
    var on = w.powered;
    E('rect', {x: 1398, y: 78, width: 24, height: 30, rx: 2, fill: '#c9ccd0', stroke: '#777'}, u);
    if (on) {
      E('path', {d: 'M1422,93 C1450,93 1440,120 1462,118', fill: 'none', stroke: '#222', 'stroke-width': 5, 'stroke-linecap': 'round'}, u);
      E('rect', {x: 1420, y: 86, width: 12, height: 14, rx: 2, fill: '#555'}, u);
    }
    E('rect', {x: 1436, y: 40, width: 58, height: 40, rx: 3, fill: '#2a3036', stroke: '#111'}, u);
    E('rect', {x: 1440, y: 44, width: 50, height: 32, fill: on ? '#7fb3e6' : '#3a434b'}, u);
    E('rect', {x: 1428, y: 80, width: 70, height: 9, rx: 2, fill: '#555', stroke: '#222'}, u);
    E('text', {x: 1463, y: 104, 'text-anchor': 'middle', 'font-size': 10, fill: '#333', class: 'zh'}, u, '筆電');
    if (st.laptop === 'charger') {
      E('path', {d: 'M1494,86 C1499,120 1490,150 1480,170', fill: 'none', stroke: '#222', 'stroke-width': 3}, u);
      E('text', {x: 1470, y: 186, 'text-anchor': 'middle', 'font-size': 10, fill: '#a33a2b', 'font-weight': 700, class: 'zh'}, u, '充電器');
    } else E('text', {x: 1463, y: 118 + (on ? 18 : 0), 'text-anchor': 'middle', 'font-size': 9.5, fill: '#2f5d3a', class: 'zh'}, u, '只用電池');
  }

  function pad(g, x, y, square, pt) {
    var p = G(g, pt ? {'data-pt': pt} : {});
    if (pt) E('rect', {x: x - 8, y: y - 8, width: 16, height: 16, fill: 'transparent'}, p);
    if (square) E('rect', {x: x - 6, y: y - 6, width: 12, height: 12, fill: '#d6b35a', stroke: '#8a6a22'}, p);
    else E('circle', {cx: x, cy: y, r: 6, fill: '#d6b35a', stroke: '#8a6a22'}, p);
    E('circle', {cx: x, cy: y, r: 2.4, fill: '#5d4614'}, p);
    if (pt) tip(p, M.pointName(pt));
    return p;
  }
  function cap(g, a, b, item) {
    var A = ptXY(a), B = ptXY(b), cx = (A[0] + B[0]) / 2, cy = (A[1] + B[1]) / 2, horiz = Math.abs(A[1] - B[1]) < 1;
    var c = E('rect', {x: cx - (horiz ? 15 : 7), y: cy - (horiz ? 7 : 15), width: horiz ? 30 : 14, height: horiz ? 14 : 30, rx: 3, fill: '#1c1c1c', stroke: '#5a5a5a', 'data-item': item}, g);
    tip(c, '跳線帽 ' + a + '–' + b);
    return c;
  }
  function park(g, a, item) {
    var A = ptXY(a), c = E('rect', {x: A[0] - 7.5, y: A[1] - 7.5, width: 15, height: 15, rx: 3, fill: '#1c1c1c', stroke: '#9a9a9a', 'stroke-dasharray': '3 2', 'data-item': item}, g);
    tip(c, '跳線帽只套在 ' + a.replace('.', ' 第 ') + ' 腳（收著，不導通）');
  }

  function drawFE(w) {
    var silk = '#eaf4ea', g = G(svg, {});
    E('rect', {x: fx(0), y: fy(0), width: 32 * P, height: 34.9 * P, rx: 6, fill: '#1e6b3d', stroke: '#0e3b20', 'stroke-width': 2}, g);
    E('text', {x: fx(14.5), y: fy(1.3), 'font-size': 13, fill: silk, 'font-weight': 600}, g, 'ADS1299EEG FE Rev A');
    E('text', {x: fx(14.5), y: fy(2.3), 'font-size': 10, fill: silk}, g, 'Texas Instruments');
    [[2, 1.2], [2, 32.9]].forEach(function (h) { E('circle', {cx: fx(h[0]), cy: fy(h[1]), r: 9, fill: '#cdb56d', stroke: '#7a6630'}, g); E('circle', {cx: fx(h[0]), cy: fy(h[1]), r: 5, fill: '#e9ece6'}, g); });
    /* J6 */
    var j6 = G(svg, {'data-item': 'j6caps'});
    tip(j6, 'J6：36 腳輸入排針');
    E('rect', {x: fx(0.42), y: fy(3.78), width: 2.16 * P, height: 18.1 * P, fill: 'none', stroke: silk, 'stroke-width': 1.3}, j6);
    E('text', {x: fx(0.45), y: fy(3.45), 'font-size': 11, fill: silk, 'font-weight': 700}, j6, 'J6');
    E('text', {x: fx(2.7), y: fy(4.33) + 3.5, 'font-size': 8.5, fill: silk}, g, 'BIAS_SHD');
    for (var c = 8; c >= 1; c--) {
      var rm = 3 + 2 * (8 - c);
      E('text', {x: fx(3.1), y: fy(4.33 + rm - 1) + 9, 'font-size': 9, fill: silk, 'font-weight': 700}, g, 'CH' + c);
      E('text', {x: fx(2.62), y: fy(4.33 + rm - 1) + 3.5, 'font-size': 9, fill: silk}, g, '−');
      E('text', {x: fx(2.62), y: fy(4.33 + rm) + 3.5, 'font-size': 9, fill: silk}, g, '+');
    }
    for (var n = 1; n <= 36; n++) { var q = ptXY('J6.' + n); pad(svg, q[0], q[1], n === 1, 'J6.' + n); }
    /* input filter array R80-R95 / C72-C93 */
    for (var row = 3; row <= 18; row++) {
      E('rect', {x: fx(4.45), y: fy(4.33 + row - 1) - 3, width: 11, height: 6, fill: '#111'}, g);
      E('rect', {x: fx(5.45), y: fy(4.33 + row - 1) - 3, width: 11, height: 6, fill: '#3c2a1a'}, g);
    }
    E('text', {x: fx(4.2), y: fy(3.0), 'font-size': 8.5, fill: silk}, g, 'R80–95 4.99k');
    E('text', {x: fx(4.2), y: fy(3.6), 'font-size': 8.5, fill: silk}, g, 'C72–93 4.7n');
    /* JP25 */
    var jp25 = G(svg, {'data-item': 'jp25'});
    tip(jp25, 'JP25：BIAS／REF');
    E('rect', {x: fx(0.42), y: fy(22.85), width: 2.16 * P, height: 3.03 * P, fill: 'none', stroke: silk, 'stroke-width': 1.3}, jp25);
    E('text', {x: fx(0.45), y: fy(22.55), 'font-size': 10, fill: silk, 'font-weight': 700}, jp25, 'JP25');
    E('text', {x: fx(2.62), y: fy(23.35) + 3.5, 'font-size': 9, fill: silk, 'font-weight': 700}, g, 'BIAS');
    E('text', {x: fx(2.62), y: fy(25.35) + 3.5, 'font-size': 9, fill: silk, 'font-weight': 700}, g, 'REF');
    for (n = 1; n <= 6; n++) { q = ptXY('JP25.' + n); pad(svg, q[0], q[1], n === 1, 'JP25.' + n); }
    /* SMA */
    var sma = G(svg, {'data-info': 'SMA'});
    E('rect', {x: fx(1.0), y: fy(27.2), width: 2.9 * P, height: 2.9 * P, fill: '#b9a46a', stroke: '#6d5d2b'}, sma);
    E('circle', {cx: fx(2.45), cy: fy(28.65), r: 11, fill: '#d8c78f', stroke: '#6d5d2b'}, sma);
    E('circle', {cx: fx(2.45), cy: fy(28.65), r: 4, fill: '#6d5d2b'}, sma);
    E('text', {x: fx(1.0), y: fy(26.95), 'font-size': 9, fill: silk}, sma, 'AIN1');
    /* 3-pin headers */
    var hdrItem = {JP6: 'jp6', JP7: null, JP8: 'jp8', JP1: 'jp1', JP2: 'jp2', JP20: 'jp20'};
    var hdrLab = {JP6: ['JP6', 'above'], JP7: ['JP7', 'above'], JP8: ['JP8', 'above'], JP1: ['JP1', 'right'], JP2: ['JP2', 'below'], JP20: ['JP20', 'below']};
    Object.keys(HDR).forEach(function (name) {
      var h = HDR[name], a = ptXY(name + '.1'), b = ptXY(name + '.3'), x0 = Math.min(a[0], b[0]) - 10, item = hdrItem[name];
      var hg = G(svg, item ? {'data-item': item} : {'data-info': name});
      E('rect', {x: x0, y: a[1] - 10, width: Math.abs(b[0] - a[0]) + 20, height: 20, rx: 4, fill: 'none', stroke: silk, 'stroke-width': 1.3}, hg);
      var L = hdrLab[name];
      if (L[1] === 'above') E('text', {x: (a[0] + b[0]) / 2, y: a[1] - 14, 'text-anchor': 'middle', 'font-size': 10, fill: silk, 'font-weight': 700}, hg, L[0]);
      if (L[1] === 'below') E('text', {x: (a[0] + b[0]) / 2, y: a[1] + 24, 'text-anchor': 'middle', 'font-size': 10, fill: silk, 'font-weight': 700}, hg, L[0]);
      if (L[1] === 'right') E('text', {x: Math.max(a[0], b[0]) + 14, y: a[1] + 4, 'font-size': 10, fill: silk, 'font-weight': 700}, hg, L[0]);
      for (var i = 1; i <= 3; i++) { var p = ptXY(name + '.' + i); pad(svg, p[0], p[1], i === 1, name + '.' + i); }
      E('text', {x: a[0], y: a[1] + (L[1] === 'below' ? -12 : 19), 'text-anchor': 'middle', 'font-size': 7.5, fill: silk}, svg, '1');
    });
    E('text', {x: (ptXY('JP2.1')[0] + ptXY('JP2.3')[0]) / 2, y: fy(7.63) - 14, 'text-anchor': 'middle', 'font-size': 10, fill: silk}, g, 'AVDD');
    E('text', {x: (ptXY('JP20.1')[0] + ptXY('JP20.3')[0]) / 2, y: fy(7.63) - 14, 'text-anchor': 'middle', 'font-size': 10, fill: silk}, g, 'AVSS');
    /* R3, R8, C20 near JP1 */
    var rr = G(svg, {'data-info': 'R8'});
    E('rect', {x: fx(9.8), y: fy(8.3) - 4, width: 18, height: 8, fill: '#111'}, rr);
    E('text', {x: fx(11.2), y: fy(8.3) + 3, 'font-size': 8.5, fill: silk}, rr, 'R3 0Ω');
    E('rect', {x: fx(9.55) - 3, y: fy(9.75) - 5, width: fx(11.0) - fx(9.55) + 6, height: 10, fill: '#111'}, rr);
    E('text', {x: fx(11.5), y: fy(9.75) + 3, 'font-size': 8.5, fill: silk}, rr, 'R8 392k');
    E('rect', {x: fx(9.8), y: fy(10.9) - 4, width: 18, height: 8, fill: '#6b4a2a'}, rr);
    E('text', {x: fx(11.2), y: fy(10.9) + 3, 'font-size': 8.5, fill: silk}, rr, 'C20 10n');
    pad(svg, ptXY('R8.1')[0], ptXY('R8.1')[1], false, 'R8.1');
    pad(svg, ptXY('R8.2')[0], ptXY('R8.2')[1], false, 'R8.2');
    /* U1 ADS1299 */
    var u1 = G(svg, {'data-info': 'U1'});
    var ux = fx(10.6), uy = fy(11.8), us = 3.6 * P;
    for (var k = 0; k < 16; k++) {
      var o = 4 + k * (us - 8) / 15;
      E('line', {x1: ux + o, y1: uy - 5, x2: ux + o, y2: uy, stroke: '#c8c8c8'}, u1);
      E('line', {x1: ux + o, y1: uy + us, x2: ux + o, y2: uy + us + 5, stroke: '#c8c8c8'}, u1);
      E('line', {x1: ux - 5, y1: uy + o, x2: ux, y2: uy + o, stroke: '#c8c8c8'}, u1);
      E('line', {x1: ux + us, y1: uy + o, x2: ux + us + 5, y2: uy + o, stroke: '#c8c8c8'}, u1);
    }
    E('rect', {x: ux, y: uy, width: us, height: us, fill: '#222', stroke: '#000'}, u1);
    E('circle', {cx: ux + 6, cy: uy + 6, r: 2, fill: '#888'}, u1);
    E('text', {x: ux + us / 2, y: uy + us / 2 + 4, 'text-anchor': 'middle', 'font-size': 10, fill: '#ddd', 'font-weight': 700}, u1, 'ADS1299');
    E('text', {x: ux - 6, y: uy - 8, 'font-size': 10, fill: silk}, u1, 'U1');
    /* decorations: OSC1, J5, J3, U4, U11 */
    E('rect', {x: fx(18.6), y: fy(26.2), width: 2.5 * P, height: 2.2 * P, fill: '#c9ccd0', stroke: '#666'}, g);
    E('text', {x: fx(18.6), y: fy(25.9), 'font-size': 9, fill: silk}, g, 'OSC1 2.048MHz');
    for (k = 0; k < 10; k++) { E('rect', {x: fx(21.6 + k * 0.97), y: fy(29.4), width: 6, height: 15, fill: '#d6b35a'}, g); E('rect', {x: fx(21.6 + k * 0.97), y: fy(31.0), width: 6, height: 15, fill: '#d6b35a'}, g); }
    E('text', {x: fx(30.9), y: fy(32.2), 'font-size': 9, fill: silk}, g, 'J3');
    for (k = 0; k < 5; k++) { E('circle', {cx: fx(14.6 + k), cy: fy(29.8), r: 4.5, fill: '#d6b35a'}, g); E('circle', {cx: fx(14.6 + k), cy: fy(30.8), r: 4.5, fill: '#d6b35a'}, g); }
    E('text', {x: fx(13.2), y: fy(30.6), 'font-size': 9, fill: silk}, g, 'J5');
    [[6.2, 'U4'], [10.6, 'U11']].forEach(function (u) {
      E('rect', {x: fx(u[0]), y: fy(30.4), width: 2.1 * P, height: 1.6 * P, fill: '#222'}, g);
      E('text', {x: fx(u[0]), y: fy(32.8), 'font-size': 9, fill: silk}, g, u[1] + ' OPA376');
    });
    /* test points */
    Object.keys(TPS).forEach(function (tp) {
      var t = TPS[tp], x = fx(t[0]), y = fy(t[1]), p = G(svg, {'data-pt': tp});
      E('circle', {cx: x, cy: y, r: 9, fill: 'transparent'}, p);
      E('circle', {cx: x, cy: y, r: 5.5, fill: '#cdb56d', stroke: silk, 'stroke-width': 1.5}, p);
      E('circle', {cx: x, cy: y, r: 2, fill: '#5d4614'}, p);
      tip(p, M.pointName(tp));
      E('text', {x: x + (tp === 'TP7' || tp === 'TP8' ? 10 : 0), y: y + (tp === 'TP7' || tp === 'TP8' ? 4 : -9), 'text-anchor': tp === 'TP7' || tp === 'TP8' ? 'start' : 'middle', 'font-size': 8.5, fill: silk}, svg, t[2]);
    });
    E('path', {d: 'M' + (fx(24.3) - 6) + ',' + (fy(21.4) + 12) + ' h12 M' + (fx(24.3) - 4) + ',' + (fy(21.4) + 15) + ' h8 M' + (fx(24.3) - 2) + ',' + (fy(21.4) + 18) + ' h4', stroke: silk, 'stroke-width': 1.3}, g);
    /* jumper caps */
    var J = svg;
    if (w.j6caps) for (row = 3; row <= 18; row++) cap(J, 'J6.' + (2 * row - 1), 'J6.' + (2 * row), 'j6caps');
    w.jp25.forEach(function (p) { var a2 = p.split('-'); cap(J, 'JP25.' + a2[0], 'JP25.' + a2[1], 'jp25'); });
    var ids = {JP2: 'jp2', JP20: 'jp20', JP1: 'jp1', JP6: 'jp6', JP7: 'jp7', JP8: 'jp8'};
    Object.keys(ids).forEach(function (j) {
      var s = w.jp[j];
      if (s === '1-2') cap(J, j + '.1', j + '.2', ids[j]);
      else if (s === '2-3') cap(J, j + '.2', j + '.3', ids[j]);
      else if (s === 'park') park(J, j + '.1', ids[j]);
    });
    if (!w.j6caps && st.step >= M.byId('j6caps').step) {
      var pile = G(svg, {'data-item': 'j6caps'});
      tip(pile, '拔下來的 16 個 J6 跳線帽（收好）');
      for (k = 0; k < 6; k++) E('rect', {x: 742 + (k % 3) * 9, y: 618 + Math.floor(k / 3) * 9 + (k % 2) * 3, width: 14, height: 8, rx: 2, fill: '#1c1c1c', stroke: '#5a5a5a', transform: 'rotate(' + (k * 23 - 40) + ' ' + (749 + (k % 3) * 9) + ' ' + (622 + Math.floor(k / 3) * 9) + ')'}, pile);
      E('text', {x: 748, y: 650, 'font-size': 9, fill: '#5f6b72', 'text-anchor': 'middle', class: 'zh'}, pile, '跳線帽');
    }
  }

  function drawLeads(w) {
    var bundle = 0;
    w.leads.forEach(function (l) {
      var it = M.byId(l.id), col = it.color, A = epos(l.elec), B = ptXY(l.to), d;
      var on = st.contact[l.elec] !== false;
      if (l.elec === 'BIAS') d = 'M' + A[0] + ',' + (A[1] + 22) + ' C' + (A[0] - 10) + ',600 300,' + (B[1] + 120) + ' ' + (B[0] - 60) + ',' + B[1] + ' L' + B[0] + ',' + B[1];
      else if (l.elec === 'REF') d = 'M' + (A[0] + 12) + ',' + A[1] + ' C420,' + A[1] + ' 400,' + B[1] + ' 452,' + B[1] + ' L' + B[0] + ',' + B[1];
      else {
        var by = 300 + (bundle++) * 7;
        d = 'M' + A[0] + ',' + A[1] + ' Q' + ((A[0] + 372) / 2) + ',' + (A[1] + by) / 2 + ' 372,' + by + ' C410,' + by + ' 415,' + B[1] + ' 452,' + B[1] + ' L' + B[0] + ',' + B[1];
      }
      var g = G(svg, {'data-item': l.id});
      tip(g, it.title);
      E('path', {d: d, fill: 'none', stroke: '#00000055', 'stroke-width': 4.6, 'stroke-linecap': 'round'}, g);
      E('path', {d: d, fill: 'none', stroke: col, 'stroke-width': 2.8, 'stroke-linecap': 'round', 'stroke-dasharray': on ? null : '6 4'}, g);
      E('rect', {x: B[0] - 4, y: B[1] - 4, width: 8, height: 8, rx: 1.5, fill: '#b9bcbf', stroke: '#555'}, g);
    });
  }

  function drawWires(w) {
    w.wires.forEach(function (x) {
      var A = ptXY(x.from), B = ptXY(x.to), it = M.byId(x.id), d;
      if (Math.abs(A[1] - B[1]) < 2) d = 'M' + A[0] + ',' + A[1] + ' L' + B[0] + ',' + B[1];
      else {
        d = 'M' + A[0] + ',' + A[1] + ' C' + (A[0] - 40) + ',' + (A[1] + 60) + ' ' + (B[0] + 120) + ',' + (B[1] + 40) + ' ' + B[0] + ',' + B[1];
      }
      var g = G(svg, {'data-item': x.id});
      tip(g, it.title);
      E('path', {d: d, fill: 'none', stroke: '#00000066', 'stroke-width': 7.5, 'stroke-linecap': 'round'}, g);
      E('path', {d: d, fill: 'none', stroke: x.color, 'stroke-width': 5, 'stroke-linecap': 'round'}, g);
      /* female housing on the PDK pin, male pin in the breadboard */
      E('rect', {x: A[0] - 6.5, y: A[1] - 6.5, width: 13, height: 13, rx: 1.5, fill: '#151515', stroke: x.color === M.BIASC ? '#777' : x.color, 'stroke-width': 1.5}, g);
      E('rect', {x: B[0] + 3, y: B[1] - 4.5, width: 14, height: 9, rx: 1.5, fill: '#151515'}, g);
    });
  }

  function drawScopeGnd(w) {
    if (!w.scope) return;
    var A = ptXY('TP8'), g = G(svg, {'data-item': 'scope'});
    tip(g, '示波器地夾 → TP8');
    E('path', {d: 'M' + A[0] + ',' + A[1] + ' C' + (A[0] + 30) + ',' + (A[1] + 60) + ' ' + (A[0] + 70) + ',600 ' + (A[0] + 90) + ',690', fill: 'none', stroke: '#111', 'stroke-width': 3}, g);
    E('path', {d: 'M' + (A[0] - 3) + ',' + (A[1] - 2) + ' l10,-8 l6,10 l-10,8 z', fill: '#333', stroke: '#000'}, g);
    E('text', {x: A[0] + 96, y: 676, 'font-size': 10.5, fill: '#e8f3e8', class: 'zh'}, g, st.scopeEarth ? '示波器地（接大地）' : '示波器地夾');
  }

  function drawProbes() {
    [['ch1', 'var(--ch1)', '#3987e5'], ['ch2', 'var(--ch2)', '#e0703f']].forEach(function (p, i) {
      var pt = st.probes[p[0]];
      if (!pt) return;
      var A = ptXY(pt), g = G(svg, {'pointer-events': 'none'});
      var dx = i ? -34 : 26, dy = -34;
      E('line', {x1: A[0], y1: A[1], x2: A[0] + dx, y2: A[1] + dy, stroke: '#222', 'stroke-width': 4, 'stroke-linecap': 'round'}, g);
      E('line', {x1: A[0], y1: A[1], x2: A[0] + dx, y2: A[1] + dy, stroke: p[2], 'stroke-width': 2.4, 'stroke-linecap': 'round'}, g);
      E('circle', {cx: A[0], cy: A[1], r: 7, fill: 'none', stroke: p[2], 'stroke-width': 3}, g);
      E('rect', {x: A[0] + dx - 18, y: A[1] + dy - 18, width: 36, height: 17, rx: 4, fill: p[2]}, g);
      E('text', {x: A[0] + dx, y: A[1] + dy - 5.5, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: '#fff'}, g, p[0].toUpperCase());
    });
  }

  function markSel() {
    svg.querySelectorAll('.sel').forEach(function (e) { e.classList.remove('sel'); });
    if (!sel) return;
    var item = M.byId(sel);
    var key = item ? sel : null;
    if (key) svg.querySelectorAll('[data-item="' + key + '"]').forEach(function (e) { e.classList.add('sel'); });
    if (sel === 'regs') svg.querySelectorAll('[data-info="U1"]').forEach(function (e) { e.classList.add('sel'); });
    if (!item) svg.querySelectorAll('[data-info="' + sel + '"]').forEach(function (e) { e.classList.add('sel'); });
  }

  /* ===================== why panel ===================== */
  var PT_GROUPS = (function () {
    var all = [];
    for (var n = 1; n <= 36; n++) all.push('J6.' + n);
    for (n = 1; n <= 6; n++) all.push('JP25.' + n);
    ['JP1', 'JP2', 'JP6', 'JP7', 'JP8', 'JP20'].forEach(function (j) { for (var i = 1; i <= 3; i++) all.push(j + '.' + i); });
    all.push('R8.1', 'R8.2', 'TP5', 'TP6', 'TP7', 'TP8', 'TP13');
    for (var r = 1; r <= 30; r++) { all.push('bb:' + r + ':f'); all.push('bb:' + r + ':a'); }
    return all;
  })();
  function netMates(pt) {
    var root = model.N(pt), out = [];
    PT_GROUPS.forEach(function (q) {
      if (q === pt || model.N(q) !== root) return;
      if (/^bb:/.test(q) && /^bb:/.test(pt) && M.holeNet(q) === M.holeNet(pt)) return;
      out.push(M.pointName(q).replace(/^麵包板 ([a-j])(\d+)/, '麵包板第 $2 排'));
    });
    model.w.leads.forEach(function (l) { if (model.N(l.to) === root) out.push(l.elec === 'REF' ? '右耳夾' : l.elec === 'BIAS' ? '左耳夾' : l.elec + ' 電極'); });
    return out;
  }
  function showWhy() {
    var box = $('why'), item = M.byId(sel), info = M.INFO[sel], h = '';
    if (item) {
      var done = st.step >= item.step;
      h += '<h3>' + item.step + '. ' + item.title + '</h3>';
      if (item.from) h += '<p class="ft">' + esc(M.pointName(item.from)) + ' → ' + esc(M.pointName(item.to)) + '</p>';
      if (!done) h += '<p class="ft">（還沒做到這一步）</p>';
      h += '<ul>' + item.why.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>';
      if (item.check) h += '<p class="chkline"><b>確認：</b>' + item.check + '</p>';
    } else if (info) {
      h += '<h3>' + info.title + '</h3><ul>' + info.why.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>';
    } else if (sel && sel.indexOf('pt:') === 0) {
      var pt = sel.slice(3), mates = netMates(pt), I = M.point(model, pt);
      h += '<h3>' + esc(M.pointName(pt)) + '</h3>';
      h += '<p class="chkline">相通的點：' + (mates.length ? mates.map(esc).join('、') : '沒有（這一點沒有接到任何東西）') + '</p>';
      if (model.res) h += '<p class="chkline">DC ' + fmtV(I.dc) + '，60 Hz ' + fmtV(2 * Math.hypot(I.a1[0], I.a1[1])) + ' 峰對峰。</p>';
      h += '<p class="chkline muted">按「放 CH1／CH2」再點這一點就能看波形。</p>';
    } else h = '<p class="small muted">點麵包板上的線、跳線帽、元件或電極。</p>';
    box.innerHTML = h;
  }

  /* ===================== state changes ===================== */
  function rebuild(resetFilters) {
    model = M.analyze(M.build(st));
    probeInfo = ['ch1', 'ch2'].map(function (p) { return st.probes[p] ? M.point(model, st.probes[p]) : null; });
    if (resetFilters) primed = false;
    draw(); showWhy(); syncControls(); updateReadouts(); fillExp(false);
  }
  function selectItem(id) { sel = id; markSel(); showWhy(); }

  /* ---- zoom and pan ---- */
  var ZOOMS = {all: [0, 0, 1500, 700], head: [30, 150, 400, 400], bb: [400, 35, 340, 575], join: [560, 150, 360, 380], pdk: [780, 0, 720, 700]};
  var VB = null, zoomKey = 'all', dragged = false;
  function setVB() { svg.setAttribute('viewBox', VB.map(function (v) { return v.toFixed(1); }).join(' ')); }
  function fit(key) {
    var r = ZOOMS[key], b = svg.getBoundingClientRect(), asp = b.width > 10 && b.height > 10 ? b.width / b.height : 1500 / 700;
    var w = r[2], h = r[3];
    if (w / h > asp) h = w / asp; else w = h * asp;
    VB = [r[0] + r[2] / 2 - w / 2, r[1] + r[3] / 2 - h / 2, w, h];
    zoomKey = key; setVB();
    document.querySelectorAll('[data-z]').forEach(function (z) { z.setAttribute('aria-pressed', z.getAttribute('data-z') === key ? 'true' : 'false'); });
  }
  function toSvg(e) { var m = svg.getScreenCTM().inverse(), p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(m); }
  document.querySelectorAll('[data-z]').forEach(function (z) { z.onclick = function () { fit(z.getAttribute('data-z')); }; });
  svg.addEventListener('wheel', function (e) {
    e.preventDefault();
    var p = toSvg(e), k = e.deltaY > 0 ? 1.15 : 1 / 1.15, nw = Math.max(150, Math.min(2200, VB[2] * k));
    k = nw / VB[2];
    VB = [p.x - (p.x - VB[0]) * k, p.y - (p.y - VB[1]) * k, nw, VB[3] * k];
    zoomKey = null; setVB();
    document.querySelectorAll('[data-z]').forEach(function (z) { z.setAttribute('aria-pressed', 'false'); });
  }, {passive: false});
  (function () {
    var start = null;
    svg.addEventListener('pointerdown', function (e) { if (e.button === 0) { start = {x: e.clientX, y: e.clientY, vb: VB.slice(), id: e.pointerId}; dragged = false; } });
    svg.addEventListener('pointermove', function (e) {
      if (!start) return;
      var dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!dragged && Math.hypot(dx, dy) < 5) return;
      if (!dragged) { dragged = true; svg.setPointerCapture(start.id); svg.classList.add('drag'); }
      var m = svg.getScreenCTM();
      VB = [start.vb[0] - dx / m.a, start.vb[1] - dy / m.d, VB[2], VB[3]];
      zoomKey = null; setVB();
    });
    function end() { start = null; svg.classList.remove('drag'); }
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  })();
  window.addEventListener('resize', function () { if (zoomKey) fit(zoomKey); });

  svg.addEventListener('click', function (e) {
    if (dragged) { dragged = false; return; }
    var t = e.target;
    if (placing) {
      var p = t.closest('[data-pt]');
      if (!p) return;
      st.probes[placing] = p.getAttribute('data-pt');
      placing = null;
      rebuild(false);
      autoset(); setPlaceButtons();
      return;
    }
    var it = t.closest('[data-item]'), inf = t.closest('[data-info]'), pt = t.closest('[data-pt]');
    if (it) selectItem(it.getAttribute('data-item'));
    else if (pt) selectItem('pt:' + pt.getAttribute('data-pt'));
    else if (inf) selectItem(inf.getAttribute('data-info'));
  });
  svg.addEventListener('mousemove', function (e) {
    var p = e.target.closest('[data-pt]');
    $('bbhint').textContent = placing ? '點一個孔或針腳放 ' + placing.toUpperCase() + (p ? '：' + M.pointName(p.getAttribute('data-pt')) : '') : (p ? M.pointName(p.getAttribute('data-pt')) : '');
  });
  svg.addEventListener('mouseleave', function () { $('bbhint').textContent = placing ? '點一個孔或針腳放 ' + placing.toUpperCase() : ''; });

  /* ---- steps ---- */
  function setStep(n, selectIt) {
    st.step = Math.max(0, Math.min(M.NSTEP, n));
    if (selectIt !== false) sel = st.step > 0 ? M.ITEMS.filter(function (i) { return i.step === st.step; })[0].id : 'head';
    rebuild(true);
  }
  $('stepPrev').onclick = function () { setStep(st.step - 1); };
  $('stepNext').onclick = function () { setStep(st.step + 1); };
  $('stepZero').onclick = function () { setStep(0); };
  $('stepAll').onclick = function () { setStep(M.NSTEP); };
  document.addEventListener('keydown', function (e) {
    var tg = e.target.tagName;
    if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') return;
    var r2 = $('r2').getBoundingClientRect();
    if (r2.bottom < 100 || r2.top > innerHeight - 100) return;
    if (e.key === 'ArrowLeft') { setStep(st.step - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setStep(st.step + 1); e.preventDefault(); }
    if (e.key === 'Escape' && placing) { placing = null; setPlaceButtons(); draw(); }
  });

  /* ---- probes ---- */
  function setPlaceButtons() {
    document.querySelectorAll('[data-place]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-place') === placing ? 'true' : 'false'); });
    svg.classList.toggle('placing', !!placing);
    $('bbhint').textContent = placing ? '點一個孔或針腳放 ' + placing.toUpperCase() + '（Esc 取消）' : '';
  }
  document.querySelectorAll('[data-place]').forEach(function (b) {
    b.onclick = function () { var p = b.getAttribute('data-place'); placing = placing === p ? null : p; setPlaceButtons(); };
  });
  $('ch2off').onclick = function () { st.probes.ch2 = null; rebuild(false); };
  var PROBE_LIST = (function () {
    var L = [];
    for (var k = 1; k <= 8; k++) L.push(['bb:' + M.bbRow(k) + ':h', 'CH' + k + ' ' + M.CH[k - 1] + ' 線（h' + M.bbRow(k) + '）']);
    L.push(['bb:' + M.ROW_REF + ':h', 'REF 線（h25）'], ['bb:' + M.ROW_BIAS + ':h', 'BIAS PDK 側（h23）'], ['bb:' + M.ROW_BIAS + ':b', 'BIAS 耳夾側（b23）']);
    L.push(['R8.1', 'R8 BIASOUT 側'], ['R8.2', 'R8 BIASINV 側'], ['JP8.2', 'SRB1（JP8 第 2 腳）'], ['JP8.1', 'REF_ELEC（JP8 第 1 腳）'], ['JP1.1', 'BIAS_ELEC（JP1 第 1 腳）'],
      ['J6.34', 'J6.34（CH1−，不用）'], ['J6.35', 'J6.35（Ain+ 匯流排）'], ['JP2.2', 'AVDD（JP2 中間）'], ['JP20.2', 'AVSS（JP20 中間）'], ['TP8', 'TP8 AGND']);
    return L;
  })();
  function fillProbeSelect(id, key) {
    var s = $(id), cur = st.probes[key], has = false, h = key === 'ch2' ? '<option value="">（沒有）</option>' : '';
    PROBE_LIST.forEach(function (o) { if (o[0] === cur) has = true; h += '<option value="' + o[0] + '">' + esc(o[1]) + '</option>'; });
    if (cur && !has) h += '<option value="' + cur + '">' + esc(M.pointName(cur)) + '</option>';
    s.innerHTML = h; s.value = cur || '';
  }
  $('selCh1').onchange = function () { st.probes.ch1 = this.value; rebuild(false); autoset(); };
  $('selCh2').onchange = function () { st.probes.ch2 = this.value || null; rebuild(false); autoset(); };

  /* ---- variations (advanced) ---- */
  function bindSel(id, fn) { $(id).onchange = function () { fn(this.value); rebuild(true); autoset(); }; }
  bindSel('supply', function (v) { st.supply = v; });
  bindSel('refbuf', function (v) { st.refBuf = v === '1'; });
  bindSel('biasR', function (v) { st.biasR = +v; });
  bindSel('elec', function (v) { st.elec = v; });
  bindSel('laptop', function (v) { st.laptop = v; });
  $('scopeEarth').onchange = function () { st.scopeEarth = this.checked; rebuild(true); autoset(); };
  (function () {
    var h = '';
    M.CH.concat(['REF', 'BIAS']).forEach(function (nm) { h += '<label class="chk"><input type="checkbox" data-contact="' + nm + '" checked> ' + (nm === 'REF' ? '右耳 REF' : nm === 'BIAS' ? '左耳 BIAS' : nm) + '</label>'; });
    $('contacts').innerHTML = h;
    $('contacts').addEventListener('change', function (e) {
      var nm = e.target.getAttribute('data-contact');
      if (!nm) return;
      st.contact[nm] = e.target.checked; rebuild(true);
    });
  })();
  function syncControls() {
    $('supply').value = st.supply; $('refbuf').value = st.refBuf ? '1' : '0'; $('biasR').value = String(st.biasR);
    $('elec').value = st.elec; $('laptop').value = st.laptop; $('scopeEarth').checked = st.scopeEarth;
    document.querySelectorAll('[data-contact]').forEach(function (c) { c.checked = st.contact[c.getAttribute('data-contact')] !== false; });
    fillProbeSelect('selCh1', 'ch1'); fillProbeSelect('selCh2', 'ch2');
    var it = M.ITEMS.filter(function (i) { return i.step === st.step; })[0];
    $('stepTxt').innerHTML = st.step === 0 ? '第 0／' + M.NSTEP + ' 步：出廠狀態' : '第 ' + st.step + '／' + M.NSTEP + ' 步：' + esc(it.short);
    $('stepPrev').disabled = st.step === 0; $('stepNext').disabled = st.step === M.NSTEP;
    document.querySelectorAll('#presets .btn').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-p') === preset ? 'true' : 'false'); });
  }

  /* ---- presets ---- */
  var PRESETS = [
    {id: 'ok', label: '正確接法', note: '照這頁接好。CH1 在 Fp1 那一排、CH2 在 BIAS（PDK 側）。示波器上只有幾 mV 的電極直流和不到 1 mV 的 60 Hz；腦波要切到「ADS1299 輸出」看。'},
    {id: 'uni', label: '5 V 單電源', set: function (s) { s.supply = 'uni'; }, note: '不改 JP2／JP20，用出廠的 5 V 單電源。BIAS 把人體拉到 +2.5 V（BIASREF = 中點），一樣能量，但電極線上全是 +2.5 V 直流；×10 探棒的 10 MΩ 還會從 BIAS 拉出約 0.25 µA 直流（看「電路讀數」）。腦波帽是雙電源，所以這頁用 ±2.5 V。'},
    {id: 'refbuf', label: '緩衝的參考', set: function (s) { s.refBuf = true; }, note: 'JP8 改 2-3：REF_ELEC 先進 U4（OPA376）再到 SRB1，右耳夾不再承受 8 × 200 pA 的偏壓電流；代價是 U4 的雜訊加到每個通道（約 0.20 → 0.25 µVrms，手冊 §8.4 說這是最吵的接法）。濕電極不需要。'},
    {id: 'nores', label: 'BIAS 不加限流', set: function (s) { s.biasR = 0; }, note: '左耳夾直接插 f23。量測上幾乎一樣（人體 60 Hz 共模反而小一點），差別在故障時：BIAS 輸出卡在電源軌，流過頭部的電流上限從約 24 µA 變成約 0.5 mA。'},
    {id: 'dry', label: '乾電極', set: function (s) { s.elec = 'dry'; }, ch2: 'bb:' + M.bbRow(7) + ':h', view: 'adc', note: '乾電極（約 1 MΩ）：半電池電位幾十 mV、阻抗差大，60 Hz 共模轉成差模，通道上的 60 Hz 從 < 1 µV 變成 5–35 µV；電極阻抗和 4.7 nF 濾波分壓，腦波也小了約 15 %。打開「60 Hz 陷波」比較。'},
    {id: 'charger', label: '筆電接充電器', set: function (s) { s.laptop = 'charger'; }, view: 'adc', note: '充電器的 Y 電容把市電耦合到電路地，人體經 200 pF 對地電容拉出 µA 級電流，全部從 BIAS 電極流（看「電路讀數」：約 9 µA 峰值的 60 Hz，電池時只有十幾 nA）。人體 60 Hz 共模約 0.2 V 峰對峰，通道上 50–180 µV 的 60 Hz（電池時 < 1 µV）。CH2 在 BIAS 線上看得到。'},
    {id: 'earth', label: '市電示波器', set: function (s) { s.scopeEarth = true; }, note: '插市電的示波器，地夾經電源線接大地：電路地 = 大地。人體 60 Hz 共模大約 10 倍、通道上 1–3 µV；更重要的是受試者經 BIAS 電極多了一條到大地的路徑。用電池或 USB 示波器。'},
    {id: 'f_j6', label: 'J6 跳線帽沒拔', fault: 'j6caps', ch2: 'bb:' + M.bbRow(8) + ':h', view: 'adc', note: '8 個電極經跳線帽接到同一條 Ain+ 匯流排，8 個通道完全一樣（8 個電極的平均 − 右耳；「各通道讀數」的直流偏移全部相同）。CH1 在 Fp1、CH2 在 O2 那一排，兩條線一模一樣。'},
    {id: 'f_jp25', label: 'JP25 5-6 沒拔', fault: 'jp25', ch2: 'bb:' + M.ROW_REF + ':h', view: 'adc', note: 'BIAS 的 VCM 經 R11 推 REF_ELEC：參考變成約 0.93 × 右耳 ＋ 0.07 × BIAS，而且 BIAS 的 60 Hz 經 R11 進 SRB1，8 個通道都有約 30 µV 的 60 Hz。'},
    {id: 'f_jp6', label: 'JP6 沒拔', fault: 'jp6', ch2: 'R8.2', note: 'U11 和 BIASOUT 同時推 BIAS_ELEC：U11 贏，BIAS_ELEC 被釘在中點；ADS1299 的 BIAS 放大器輸出電流卡在上限（約 1 mA，看「電路讀數」）一直推，迴路沒有作用，人體 60 Hz 共模比正確接法大約 4 倍。'},
    {id: 'f_odd', label: 'CH1 插到奇數腳', fault: 'odd', view: 'adc', note: 'CH1 的線插到 J6 第 35 腳（Ain+ 匯流排）而不是 36 腳。匯流排沒有連到任何通道，CH1 的輸入浮接：偏壓電流在 1 GΩ 上建立約 0.2 V，PGA 飽和，CH1 一片平；Fp1 電極掛在匯流排上，什麼都沒量到。'},
    {id: 'f_srb1', label: '沒設 SRB1', fault: 'nosrb1', view: 'adc', note: '沒寫 MISC1 = 20h：負輸入還是各自的 INxN 腳，而這些腳沒接（只有濾波電容對地），8 個通道的負輸入都浮在約 0.2 V，PGA 飽和。右耳夾接上了也沒有用到。'},
    {id: 'f_biasgnd', label: 'BIAS 接到 GND', fault: 'biasgnd', note: 'BIAS 線插到 TP8（AGND）而不是 JP25 第 2 腳：人體經左耳夾直接接地。雙電源下人體本來就在 0 V，所以還能量，但沒有回授：人體 60 Hz 共模約大 4 倍。單電源時這樣接，人體在 0 V、低於 AVSS + 0.2 V，PGA 會飽和。'},
    {id: 'f_nobias', label: 'BIAS 放大器沒開', fault: 'nobias', note: 'CONFIG3 沒開 BIAS（例如寫成 E0h）：BIASOUT 高阻抗，人體只經輸入腳的 1 GΩ 偏在電路上，直流漂到十幾 mV，60 Hz 共模約大 4 倍。濕電極、電池供電時還能量；環境吵一點就被 60 Hz 淹沒。'},
    {id: 'f_o1', label: 'O1 沒接觸', set: function (s) { s.contact.O1 = false; }, view: 'adc', note: 'O1 電極沒貼到皮膚（或線鬆了）：CH7 的輸入浮接，偏壓電流讓它漂到約 0.2 V，PGA 飽和。lead-off 偵測就是在抓這種情況。試著把探棒放到 O1 那一排（h9）：探棒的 10 MΩ 把浮接的輸入拉回 0 V 附近，飽和就消失了，探棒本身改變了電路。'}
  ];
  function applyPreset(id) {
    var p = PRESETS.filter(function (x) { return x.id === id; })[0], d = M.defaultState();
    preset = id;
    st.supply = d.supply; st.refBuf = d.refBuf; st.biasR = d.biasR; st.elec = d.elec; st.laptop = d.laptop; st.scopeEarth = d.scopeEarth;
    st.contact = {}; st.fault = d.fault; st.step = M.NSTEP;
    st.probes = {ch1: p.ch1 || d.probes.ch1, ch2: p.ch2 || d.probes.ch2};
    if (p.set) p.set(st);
    if (p.fault) st.fault[p.fault] = true;
    $('presetNote').textContent = p.note;
    if (p.view) setView(p.view);
    rebuild(true); autoset();
  }
  (function () {
    var h = '';
    PRESETS.forEach(function (p) { h += '<button class="btn' + (p.id.indexOf('f_') === 0 ? '' : ' acc') + '" type="button" data-p="' + p.id + '">' + p.label + '</button>'; });
    $('presets').innerHTML = h;
    $('presets').onclick = function (e) { var b = e.target.closest('[data-p]'); if (b) applyPreset(b.getAttribute('data-p')); };
  })();

  /* ---- mode ---- */
  function setMode(m) {
    document.body.setAttribute('data-mode', m);
    document.querySelectorAll('.mode button').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-mode') === m ? 'true' : 'false'); });
    if (m === 'basic' && preset !== 'ok') applyPreset('ok');
    if (m === 'basic') { $('ideal').checked = false; }
    try { localStorage.setItem('eegcap.mode', m); } catch (e) {}
  }
  document.querySelectorAll('.mode button').forEach(function (b) { b.onclick = function () { setMode(b.getAttribute('data-mode')); }; });

  /* ===================== real-time signals ===================== */
  var FS = 2000, R = 8, BUFN = FS * 12, ADCN = 250 * 12;
  var buf = [new Float32Array(BUFN), new Float32Array(BUFN)], nz = [new Float32Array(BUFN), new Float32Array(BUFN)], bi = 0, bcount = 0;
  var adcRaw = [], adcF = [], ai = 0, acount = 0, hist = [], hpos = 0, sub = 0;
  for (var c0 = 0; c0 < 8; c0++) { adcRaw.push(new Float32Array(ADCN)); adcF.push(new Float32Array(ADCN)); hist.push(new Float64Array(64)); }
  var taps = AFE.sincTaps(R), rnd = CS.rng(11), T = 0, probeInfo = [null, null], primed = false;
  var labels = M.CH.concat(['REF', 'BIAS']), ev = new Float64Array(labels.length);
  var subj = {background: true, eyesClosed: true, blinks: true, emg: false};
  var src = new AFE.EEGSource(labels, subj, FS, 5);
  var chipOff = M.CH.map(function (x, i) { var r = CS.rng(31 * i + 7); return 60e-6 * 0.6 * CS.gauss(r); });
  var LSB = 4.5 / 24 / (Math.pow(2, 23) - 1);
  ['eyes', 'blinks', 'emg'].forEach(function (id) {
    $(id).onchange = function () { subj.eyesClosed = $('eyes').checked; subj.blinks = $('blinks').checked; subj.emg = $('emg').checked; };
  });
  /* display filters at 250 SPS */
  function biq(b0, b1, b2, a1, a2) { return {b0: b0, b1: b1, b2: b2, a1: a1, a2: a2, x1: 0, x2: 0, y1: 0, y2: 0}; }
  function run(f, x) { var y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2; f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y; return y; }
  function makeFilters() {
    var fs = 250, K = Math.tan(Math.PI * 0.5 / fs), hp = biq(1 / (1 + K), -1 / (1 + K), 0, (K - 1) / (K + 1), 0);
    var K2 = Math.tan(Math.PI * 45 / fs), nrm = 1 / (1 + Math.SQRT2 * K2 + K2 * K2);
    var lp = biq(K2 * K2 * nrm, 2 * K2 * K2 * nrm, K2 * K2 * nrm, 2 * (K2 * K2 - 1) * nrm, (1 - Math.SQRT2 * K2 + K2 * K2) * nrm);
    var w0 = 2 * Math.PI * 60 / fs, al = Math.sin(w0) / (2 * 8), a0 = 1 + al;
    var nt = biq(1 / a0, -2 * Math.cos(w0) / a0, 1 / a0, -2 * Math.cos(w0) / a0, (1 - al) / a0);
    return {hp: hp, lp: lp, nt: nt};
  }
  var filt = M.CH.map(makeFilters);

  function sampleOnce() {
    src.next(ev); ev[8] *= 0.4; ev[9] *= 0.4;
    var w = 2 * Math.PI * 60 * T, c1 = Math.cos(w), s1 = Math.sin(w), c3 = Math.cos(3 * w), s3 = Math.sin(3 * w), j;
    for (var p = 0; p < 2; p++) {
      var I = probeInfo[p], v = 0;
      if (I && !I.dead) {
        v = I.dc + I.a1[0] * c1 - I.a1[1] * s1 + I.a3[0] * c3 - I.a3[1] * s3;
        for (j = 0; j < ev.length; j++) v += I.mix[j] * ev[j];
      }
      buf[p][bi] = v; nz[p][bi] = CS.gauss(rnd);
    }
    bi = (bi + 1) % BUFN; bcount++;
    var res = model.res;
    if (res) {
      var rails = model.w.rails, mid = (rails.avdd + rails.avss) / 2, hi = rails.avdd - 0.2, lo = rails.avss + 0.2;
      for (var i = 0; i < 8; i++) {
        var o = res.ch[i], ch = model.fe.channels[i], x, cm;
        if (ch.mux === 1) { x = 0; cm = mid; }
        else {
          x = o.vd + o.mains1[0] * c1 - o.mains1[1] * s1 + o.mains3[0] * c3 - o.mains3[1] * s3;
          for (j = 0; j < ev.length; j++) x += o.mix[j] * ev[j];
          cm = o.cm + o.cm1[0] * c1 - o.cm1[1] * s1;
          x += (o.cm1[0] * c1 - o.cm1[1] * s1) * 1e-6 * (i % 2 ? -0.7 : 0.8);
        }
        var g = 24, op = Math.min(hi, Math.max(lo, cm + g * x / 2)), on = Math.min(hi, Math.max(lo, cm - g * x / 2));
        var y = op - on + g * chipOff[i];
        if (!primed) hist[i].fill(y);            // after a rebuild the sinc3 starts settled on the new input
        hist[i][hpos & 63] = y;
      }
      hpos = (hpos + 1) & 63;
      if (++sub === R) { sub = 0; adcOut(); }
    }
    T += 1 / FS;
  }
  function adcOut() {
    var res = model.res;
    for (var i = 0; i < 8; i++) {
      var acc = 0, h = hist[i];
      for (var k = 0; k < taps.length; k++) acc += taps[k] * h[(hpos - 1 - k + 128) & 63];
      var o = res.ch[i], ext = model.fe.channels[i].mux === 1 ? 0 : o.circRms;
      var v = acc / 24 + Math.sqrt(o.chipNoise.rms * o.chipNoise.rms + ext * ext) * CS.gauss(rnd);
      var code = Math.max(-8388608, Math.min(8388607, Math.round(v / LSB)));
      v = code * LSB;
      adcRaw[i][ai] = v;
      var f = filt[i];
      if (!primed) { f.hp.x1 = v; f.hp.y1 = 0; f.lp.x1 = f.lp.x2 = f.lp.y1 = f.lp.y2 = 0; f.nt.x1 = f.nt.x2 = f.nt.y1 = f.nt.y2 = 0; }
      var y = $('fHP').checked ? run(f.hp, v) : (run(f.hp, v), v);
      if ($('fLP').checked) y = run(f.lp, y); else run(f.lp, y);
      if ($('fN').checked) y = run(f.nt, y); else run(f.nt, y);
      adcF[i][ai] = y;
    }
    primed = true;
    ai = (ai + 1) % ADCN; acount++;
  }

  /* ===================== scope ===================== */
  var VDIVS = [10e-6, 20e-6, 50e-6, 100e-6, 200e-6, 500e-6, 1e-3, 2e-3, 5e-3, 10e-3, 20e-3, 50e-3, 0.1, 0.2, 0.5, 1, 2];
  var TDIVS = [1e-3, 2e-3, 5e-3, 10e-3, 20e-3, 50e-3, 0.1, 0.2, 0.5, 1];
  var sc = {v: [5e-3, 5e-3], t: 10e-3};
  (function () {
    ['v1', 'v2'].forEach(function (id, i) {
      $(id).innerHTML = VDIVS.map(function (v) { return '<option value="' + v + '">' + divTxt(v) + '/div</option>'; }).join('');
      $(id).onchange = function () { sc.v[i] = +this.value; };
    });
    $('tdiv').innerHTML = TDIVS.map(function (t) { return '<option value="' + t + '">' + (t < 1 ? t * 1e3 + ' ms' : t + ' s') + '/div</option>'; }).join('');
    $('tdiv').onchange = function () { sc.t = +this.value; };
    $('autoset').onclick = autoset;
    $('runstop').onclick = function () { running = !running; this.textContent = running ? '停止' : '執行'; };
    $('ideal').onchange = function () { autoset(); };
  })();
  function minVdiv() { return $('ideal').checked ? 10e-6 : 1e-3; }
  function autoset() {
    var ac = $('cpl').value === 'ac';
    [0, 1].forEach(function (p) {
      var I = probeInfo[p];
      if (!I) return;
      var a = Math.hypot(I.a1[0], I.a1[1]) + Math.hypot(I.a3[0], I.a3[1]) + 50e-6 * Math.max.apply(null, I.mix.map(Math.abs));
      var need = ac ? a / 3 : (Math.abs(I.dc) + a) / 3.5;
      var v = VDIVS.filter(function (x) { return x >= Math.max(need, minVdiv()); })[0] || 2;
      sc.v[p] = v;
    });
    sc.t = 10e-3;
    $('v1').value = sc.v[0]; $('v2').value = sc.v[1]; $('tdiv').value = sc.t;
  }
  $('cpl').onchange = autoset;

  var cv = $('scope'), ctx = cv.getContext('2d');
  function sizeCanvas() {
    var r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * d) || cv.height !== Math.round(r.height * d)) { cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); }
    return d;
  }
  function drawScope() {
    var dpr = sizeCanvas(), W = cv.width, H = cv.height;
    ctx.fillStyle = '#0d1114'; ctx.fillRect(0, 0, W, H);
    var top = 30 * dpr, bot = H - 22 * dpr, ph = bot - top, cy = top + ph / 2, divy = ph / 8, divx = W / 10;
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; ctx.beginPath();
    for (var i = 1; i < 10; i++) { ctx.moveTo(i * divx, top); ctx.lineTo(i * divx, bot); }
    for (i = 0; i <= 8; i++) { ctx.moveTo(0, top + i * divy); ctx.lineTo(W, top + i * divy); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();
    var N = Math.min(BUFN - 10, Math.round(sc.t * 10 * FS)), ideal = $('ideal').checked, ac = $('cpl').value === 'ac';
    if (bcount < N + 4) N = Math.max(2, bcount - 4);
    /* trigger on CH1 rising through its mean, for fast time bases */
    var end = bi - 1, start = end - N;
    if (sc.t <= 0.05 && probeInfo[0]) {
      var mean = 0, k;
      for (k = 0; k < N; k++) mean += buf[0][(end - k + BUFN) % BUFN];
      mean /= N;
      var trig = null;
      for (k = 0; k < 400; k++) {
        var idx = end - Math.round(N * 0.9) - k, b0 = buf[0][(idx - 1 + BUFN) % BUFN], b1 = buf[0][(idx + BUFN) % BUFN];
        if (b0 < mean && b1 >= mean) { trig = idx; break; }
      }
      if (trig !== null) start = trig - Math.round(N * 0.1);
    }
    var cols = ['#3987e5', '#e0703f'];
    [0, 1].forEach(function (p) {
      if (!probeInfo[p]) return;
      var vd = sc.v[p], sig = ideal ? 0 : Math.max(50e-6, 0.04 * vd), q = ideal ? 0 : 10 * vd / 256, off = 0;
      if (ac) { var s = 0; for (var k = 0; k < N; k++) s += buf[p][(start + k + BUFN) % BUFN]; off = s / N; }
      ctx.strokeStyle = cols[p]; ctx.lineWidth = 1.6 * dpr; ctx.lineJoin = 'round'; ctx.beginPath();
      var step = Math.max(1, Math.floor(N / (W / dpr)));
      for (k = 0; k < N; k += step) {
        var ix = (start + k + BUFN) % BUFN, v = buf[p][ix] - off + sig * nz[p][ix];
        if (q) v = Math.round(v / q) * q;
        var y = cy - v / vd * divy;
        y = Math.max(top - 2, Math.min(bot + 2, y));
        var x = k / N * W;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = cols[p];
      ctx.beginPath(); var my = Math.max(top, Math.min(bot, cy + off / vd * divy * 0)); ctx.moveTo(0, my - 6 * dpr); ctx.lineTo(9 * dpr, my); ctx.lineTo(0, my + 6 * dpr); ctx.fill();
    });
    ctx.font = (12 * dpr) + 'px "IBM Plex Mono", monospace';
    var y0 = H - 7 * dpr;
    if (probeInfo[0]) { ctx.fillStyle = cols[0]; ctx.fillText('CH1 ' + divTxt(sc.v[0]) + '/div  ' + shortName(st.probes.ch1), 8 * dpr, y0); }
    if (probeInfo[1]) { ctx.fillStyle = cols[1]; var t2 = 'CH2 ' + divTxt(sc.v[1]) + '/div  ' + shortName(st.probes.ch2); ctx.fillText(t2, W / 2, y0); }
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    var tt = (sc.t < 1 ? sc.t * 1e3 + ' ms' : sc.t + ' s') + '/div  ' + ($('cpl').value === 'ac' ? 'AC' : 'DC') + (ideal ? '  理想' : '') + (running ? '' : '  STOP');
    ctx.fillText(tt, W - ctx.measureText(tt).width - 40 * dpr, 20 * dpr);
    if (!model.w.powered) overlay('MMB0 還沒接 USB：電路沒有電（第 29 步）');
    else if (!model.w.scope) overlay('示波器地夾還沒夾（第 30 步）；這裡先當作已夾在 TP8');
  }
  function overlay(t) {
    var dpr = window.devicePixelRatio || 1;
    ctx.font = (13 * dpr) + 'px "Noto Sans TC", sans-serif';
    var w = ctx.measureText(t).width + 20 * dpr;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect((cv.width - w) / 2, cv.height / 2 - 16 * dpr, w, 28 * dpr);
    ctx.fillStyle = '#ffd27a'; ctx.fillText(t, (cv.width - w) / 2 + 10 * dpr, cv.height / 2 + 3 * dpr);
  }
  function shortName(pt) { return pt ? M.pointName(pt).replace(/（[^）]*沒接東西[^）]*）/, '') : ''; }

  function drawADC() {
    var dpr = sizeCanvas(), W = cv.width, H = cv.height;
    ctx.fillStyle = '#0d1114'; ctx.fillRect(0, 0, W, H);
    var top = 30 * dpr, bot = H - 22 * dpr, lane = (bot - top) / 8, left = 74 * dpr, pw = W - left - 10 * dpr;
    var scale = +$('adcScale').value * 1e-6, pxPerV = (lane / 4) / scale;
    var secs = 5, N = Math.min(acount, 250 * secs);
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1; ctx.beginPath();
    for (var s = 0; s <= secs; s++) { var x = left + s / secs * pw; ctx.moveTo(x, top); ctx.lineTo(x, bot); }
    ctx.stroke();
    ctx.font = (11.5 * dpr) + 'px "IBM Plex Mono", monospace';
    for (var i = 0; i < 8; i++) {
      var cy = top + lane * (i + 0.5), o = model.res ? model.res.ch[i] : null;
      ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.beginPath(); ctx.moveTo(left, cy); ctx.lineTo(W, cy); ctx.stroke();
      var sat = o && o.headroom < 0 && model.fe.channels[i].mux !== 1;
      ctx.fillStyle = sat ? '#ff8a7a' : M.COLOR[i] === '#8B5A2B' ? '#c08a5a' : M.COLOR[i];
      ctx.fillText('CH' + (i + 1) + ' ' + M.CH[i], 6 * dpr, cy + 4 * dpr);
      if (!N) continue;
      ctx.strokeStyle = '#d9e2e7'; ctx.lineWidth = 1.2 * dpr; ctx.beginPath();
      var data = adcF[i], st0 = ai - N;
      for (var k = 0; k < N; k++) {
        var v = data[(st0 + k + ADCN) % ADCN], y = cy - v * pxPerV;
        y = Math.max(cy - lane / 2, Math.min(cy + lane / 2, y));
        var xx = left + (k + (250 * secs - N)) / (250 * secs) * pw;
        if (k === 0) ctx.moveTo(xx, y); else ctx.lineTo(xx, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    var t = '每格 ' + $('adcScale').selectedOptions[0].textContent.replace('/格', '') + '（通道高 = 4 格）  5 s  250 SPS  增益 24' + ($('fHP').checked ? '  HP 0.5' : '') + ($('fLP').checked ? '  LP 45' : '') + ($('fN').checked ? '  陷波 60' : '');
    ctx.font = (11.5 * dpr) + 'px "Noto Sans TC", "IBM Plex Mono", sans-serif';
    ctx.fillText(t, W - ctx.measureText(t).width - 10 * dpr, H - 5 * dpr);
    if (!model.w.powered) overlay('MMB0 還沒接 USB：沒有資料（第 29 步）');
    else if (!model.w.supplyOK) overlay('AVDD − AVSS 不是 5 V：ADS1299 不會工作（JP2、JP20 要一起改）');
    else if (!model.w.regs) overlay('暫存器還沒寫：上電預設 MUX = 001（輸入短路），只有晶片雜訊（第 31 步）');
  }

  /* ===================== readouts ===================== */
  /* which electrodes reach this point, grouped: "+0.88 Fp1, 7 個頭皮電極各 −0.12" */
  function topMix(I) {
    var groups = {};
    I.mix.forEach(function (m, j) {
      if (Math.abs(m) < 0.05) return;
      var k = m.toFixed(2);
      (groups[k] = groups[k] || []).push(labels[j] === 'REF' ? '右耳' : labels[j] === 'BIAS' ? '左耳' : labels[j]);
    });
    var keys = Object.keys(groups).sort(function (a, b) { return Math.abs(b) - Math.abs(a); });
    return keys.slice(0, 3).map(function (k) {
      var v = (+k >= 0 ? '+' : '−') + Math.abs(+k).toFixed(2), n = groups[k];
      return n.length >= 3 ? n.length + ' 個電極各 ' + v : v + ' ' + n.join('、');
    }).join('，') || '—';
  }
  function updateReadouts() {
    var h = '<tr><th></th><th>DC</th><th>60 Hz p-p</th></tr>';
    ['ch1', 'ch2'].forEach(function (p, i) {
      var I = probeInfo[i];
      if (!I) return;
      h += '<tr><td style="color:var(--' + p + ')">' + p.toUpperCase() + ' ' + esc(shortName(st.probes[p])) + '</td><td>' + fmtV(I.dc) + '</td><td>' + fmtV(2 * Math.hypot(I.a1[0], I.a1[1])) + '</td></tr>';
      h += '<tr><td colspan="3" style="text-align:left;color:var(--muted);font-family:inherit">腦波來源：' + esc(topMix(I)) + '</td></tr>';
    });
    $('probeMeas').innerHTML = h;
    var res = model.res, warn = [];
    if (!res) {
      $('adcMeas').innerHTML = ''; $('circMeas').innerHTML = '<tr><td>電路沒有電</td><td></td></tr>';
      if (!model.w.powered) warn.push('還沒接 USB（第 29 步）。'); else if (!model.w.supplyOK) warn.push('AVDD − AVSS ≠ 5 V：JP2、JP20 要一起改。');
      $('warn').textContent = warn.join(' ');
      return;
    }
    h = '<tr><th></th><th>直流</th><th>60 Hz</th><th>雜訊</th></tr>';
    res.ch.forEach(function (o, i) {
      var sat = o.headroom < 0 && model.fe.channels[i].mux !== 1;
      if (sat) warn.push('CH' + (i + 1) + ' 飽和。');
      h += '<tr><td>CH' + (i + 1) + ' ' + M.CH[i] + '</td><td>' + (sat ? '<span class="t-warn">飽和</span>' : fmtV(o.vd)) + '</td><td>' + fmtV(2 * Math.hypot(o.mains1[0], o.mains1[1])) + '</td><td>' + (Math.sqrt(o.chipNoise.rms * o.chipNoise.rms + o.circRms * o.circRms) * 1e6).toFixed(2) + ' µV</td></tr>';
    });
    $('adcMeas').innerHTML = h + '<tr><td colspan="4" style="text-align:left;color:var(--muted);font-family:inherit">直流 = 通道輸入的差（電極半電池電位差），60 Hz 為峰對峰，雜訊為 rms（晶片 ＋ 電路，sinc3 頻寬內）。</td></tr>';
    var sim = res.sim, c = model.c, N = model.N, rows = [];
    rows.push(['人體 直流／60 Hz p-p', fmtV(res.bodyDC) + '／' + fmtV(2 * res.bodyAC)]);
    if (c.byName.Ubias) rows.push(['BIAS 放大器輸出電流', fmtI(sim.i('Ubias'))]);
    else rows.push(['BIAS 放大器', model.w.regs ? '關閉' : '未設定']);
    if (c.byName.Rbb) {
      var a = sim.vac(model.s1, N('BBL:' + M.ROW_BIAS)), b = sim.vac(model.s1, N('BB:' + M.ROW_BIAS));
      rows.push(['經 ' + st.biasR / 1e3 + ' kΩ 進人體：直流／60 Hz 峰值', fmtI(sim.i('Rbb')) + '／' + fmtI(Math.hypot(a[0] - b[0], a[1] - b[1]) / st.biasR)]);
    }
    rows.push(['AVDD／AVSS', fmtV(sim.v(N('AVDD')), 2) + '／' + fmtV(sim.v(N('AVSS')), 2)]);
    $('circMeas').innerHTML = rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('');
    if (!model.w.regs) warn.push('暫存器還沒寫，通道是輸入短路。');
    if (res.bodyAC > 0.02) warn.push('人體上的 60 Hz 很大。');
    $('warn').textContent = warn.join(' ');
  }

  /* ===================== tables ===================== */
  function fillTables() {
    $('steplist').innerHTML = M.ITEMS.map(function (it) { return '<li><a href="#r2" data-go="' + it.id + '">' + esc(it.title) + '</a></li>'; }).join('');
    var h = '<tr><th class="num">步驟</th><th>做什麼</th><th>為什麼</th><th>怎麼確認</th></tr>';
    M.ITEMS.forEach(function (it) {
      var sw = it.color ? '<span class="sw" style="background:' + it.color + '"></span>' : '';
      h += '<tr class="go" data-go="' + it.id + '"><td class="num">' + it.step + '</td><td style="min-width:13em">' + sw + '<b>' + esc(it.title) + '</b>' + (it.from ? '<br><span class="small muted">' + esc(M.pointName(it.from)) + ' → ' + esc(M.pointName(it.to)) + '</span>' : '') +
        '</td><td><ul style="margin:0;padding-left:1.1em">' + it.why.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul></td><td style="min-width:11em">' + (it.check || '') + '</td></tr>';
    });
    $('whyTable').innerHTML = h;
    var R = M.registers(M.defaultState());
    $('regTable').innerHTML = '<tr><th>位址</th><th>暫存器</th><th>值</th><th>說明</th></tr>' + R.regs.filter(function (r) { return r.addr > 0 && !/^LOFF_STAT/.test(r.name); }).map(function (r) {
      return '<tr><td class="mono">' + AFE.hex2(r.addr) + 'h</td><td class="mono">' + r.name + '</td><td class="mono"><b>' + AFE.hex2(r.v) + 'h</b></td><td class="small">' + esc(r.desc) + '</td></tr>';
    }).join('');
    $('initCode').textContent = R.code;
    document.addEventListener('click', function (e) {
      var g = e.target.closest('[data-go]');
      if (!g) return;
      e.preventDefault();
      var it = M.byId(g.getAttribute('data-go'));
      if (document.body.getAttribute('data-mode') === 'adv' && preset !== 'ok') applyPreset('ok');
      sel = it.id;
      setStep(g.closest('#r1 table') ? M.NSTEP : it.step, false);
      $('r2').scrollIntoView({behavior: 'smooth'});
    });
  }
  var expModel = null;
  function fillExp(force) {
    if (expModel && !force) return;
    var s = M.defaultState(); s.probes = {ch1: null, ch2: null};
    expModel = M.analyze(M.build(s));
    var pts = [
      ['JP2.2', 'AVDD', '+2.5 V；不是的話先拔 USB 檢查 JP2／JP20。'],
      ['JP20.2', 'AVSS', '−2.5 V。'],
      ['bb:' + M.bbRow(1) + ':h', 'CH1 Fp1 線', '電極直流幾 mV，60 Hz 共模零點幾 mV；8 條電極線都類似。'],
      ['bb:' + M.ROW_REF + ':h', 'REF 線', '右耳的直流。右耳 ×1，加上 BIAS 推動人體帶來的「每個頭皮電極 −1/8」；電極線上也有同樣這一項，ADS1299 相減時消掉。'],
      ['bb:' + M.ROW_BIAS + ':h', 'BIAS（PDK 側）', 'BIAS 放大器推出來的電壓：直流抵消電極電位，60 Hz 抵消人體的共模。'],
      ['bb:' + M.ROW_BIAS + ':b', 'BIAS（耳夾側）', '和 PDK 側差 100 kΩ 上的壓降。'],
      ['R8.1', 'R8 BIASOUT 側', '手冊 §7.1.3：接近中點（0 V）。'],
      ['R8.2', 'R8 BIASINV 側', '虛短路，幾乎正好 0 V。'],
      ['JP8.2', 'SRB1', '= 右耳經 R11；8 個通道的負輸入。'],
      ['J6.34', 'J6.34（CH1−）', '沒接，經濾波電容接地，約 0 V。'],
      ['TP8', 'AGND', '0 V（示波器地夾）。']
    ];
    var h = '<tr><th>點</th><th>位置</th><th class="num">DC</th><th class="num">60 Hz p-p</th><th>腦波來源</th><th>說明</th></tr>';
    pts.forEach(function (p) {
      var I = M.point(expModel, p[0]);
      h += '<tr><td><b>' + esc(p[1]) + '</b></td><td class="small">' + esc(M.pointName(p[0])) + '</td><td class="num">' + fmtV(I.dc) + '</td><td class="num">' + fmtV(2 * Math.hypot(I.a1[0], I.a1[1])) + '</td><td class="small">' + esc(topMix(I)) + '</td><td class="small">' + esc(p[2]) + '</td></tr>';
    });
    $('expTable').innerHTML = h;
  }

  /* ===================== view, fullscreen, nav ===================== */
  function setView(v) {
    view = v;
    document.querySelectorAll('[data-view]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-view') === v ? 'true' : 'false'); });
  }
  document.querySelectorAll('[data-view]').forEach(function (b) { b.onclick = function () { setView(b.getAttribute('data-view')); }; });
  document.querySelectorAll('[data-fs]').forEach(function (b) {
    b.onclick = function () { var p = b.closest('.pane'); p.classList.toggle('fs'); b.textContent = p.classList.contains('fs') ? '✕' : '⤢'; if (zoomKey) fit(zoomKey); };
  });
  var navs = document.querySelectorAll('nav.regions a'), visible = true;
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (e.isIntersecting && e.intersectionRatio > 0.35) navs.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id); });
      if (e.target.id === 'r2') visible = e.isIntersecting;
    });
  }, {root: $('main'), threshold: [0, 0.35, 0.6]});
  document.querySelectorAll('main .region').forEach(function (s) { io.observe(s); });
  if (window.matchMedia('(max-width:900px)').matches) io.disconnect();

  /* ===================== loop ===================== */
  var last = performance.now(), accS = 0;
  function frame(now) {
    var dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (running) { accS += dt * FS; var n = Math.floor(accS); accS -= n; for (var k = 0; k < n; k++) sampleOnce(); }
    if (visible || document.querySelector('.pane.fs')) { if (view === 'scope') drawScope(); else drawADC(); }
    requestAnimationFrame(frame);
  }

  /* ===================== start ===================== */
  fillTables();
  rebuild(true);
  fit(svg.getBoundingClientRect().width < 600 ? 'join' : 'all');
  autoset();
  $('presetNote').textContent = PRESETS[0].note;
  var m0 = 'basic';
  try { m0 = localStorage.getItem('eegcap.mode') || 'basic'; } catch (e) {}
  setMode(m0);
  /* warm the signal buffers so the first frame is not empty */
  for (var w0 = 0; w0 < FS * 2; w0++) sampleOnce();
  requestAnimationFrame(frame);
})();
