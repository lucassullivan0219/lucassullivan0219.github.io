/* circuit-sim page controller: examples, real-time loop, inspector, analyses. */
(function () {
  'use strict';
  var CS = window.CircuitSim, $ = function (id) { return document.getElementById(id); };
  var EX = window.CIRCUIT_EXAMPLES;
  var COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)'];
  var TYPE_NAME = {R: '電阻', C: '電容', L: '電感', V: '電壓源', I: '電流源', D: '二極體', SW: '開關', Q: 'BJT', M: 'MOSFET', U: '運算放大器'};

  var S = {
    ex: null, text: '', doc: null, built: null, sim: null, running: true,
    speed: 1, dt: 1e-4, tdiv: 1e-2, method: 'be', start: 'op', probes: [], orig: {},
    buf: null, carry: 0, ratio: 1, sel: null, mom: null, err: ''
  };
  var sch = new window.CircuitSchematic($('sch'), {onPick: onPick});
  var scopePlot = new window.LabPlot($('scope'), {xunit: 's', yunit: 'V', aspect: 0.45});
  var acMag = new window.LabPlot($('acMag'), {xlog: true, xunit: 'Hz', yunit: 'dB', ylabel: '增益 (dB)'});
  var acPh = new window.LabPlot($('acPh'), {xlog: true, xunit: 'Hz', yunit: '°', ylabel: '相位'});
  var dcPlot = new window.LabPlot($('dcPlot'), {yunit: 'V'});
  var nzPlot = new window.LabPlot($('nzPlot'), {xlog: true, ylog: true, xunit: 'Hz', yunit: 'V/√Hz', ylabel: '雜訊密度'});
  var mcPlot = new window.LabPlot($('mcPlot'), {ylabel: '次數'});

  /* ---------------- examples ---------------- */
  EX.forEach(function (ex) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn'; b.textContent = ex.title; b.dataset.id = ex.id;
    b.addEventListener('click', function () { loadExample(ex); history.replaceState(null, '', '#ex=' + ex.id); });
    $('examples').appendChild(b);
  });
  function loadExample(ex) {
    S.ex = ex;
    document.querySelectorAll('#examples .btn').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.id === ex.id ? 'true' : 'false'); });
    $('exInfo').innerHTML = '<div class="tags">' + ex.tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</div>' +
      '<div>' + esc(ex.intro) + '</div><ol>' + ex.tryit.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol>';
    loadDoc(ex.doc, true);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }

  /* ---------------- load a document ---------------- */
  function loadDoc(text, fromExample) {
    var doc = CS.parseDoc(text), built = CS.buildFromDoc(doc);
    var hard = doc.errors.concat(built.errors.filter(function (e) { return !/浮接|沒有接地/.test(e); }));
    if (hard.length && !doc.parts.length) { setStatus(hard.join('；'), true); return false; }
    S.text = text; S.doc = doc; S.built = built;
    var tr = doc.directives.tran || {};
    S.dt = CS.num(tr.dt || '1e-4'); S.speed = CS.num(tr.speed || '1'); S.tdiv = CS.num(tr.tdiv || '1e-2');
    S.start = tr.start || 'op'; S.method = tr.method || $('method').value || 'be';
    if (fromExample) S.method = tr.method || 'be';
    $('method').value = S.method;
    S.sim = new CS.Sim(built.circuit, {method: S.method});
    S.orig = {};
    built.circuit.elements.forEach(function (el) { S.orig[el.name] = JSON.parse(JSON.stringify(stripFns(el.p))); });
    S.sel = null; sch.select(null);
    sch.setDoc(doc, built);
    fillSelects();
    S.probes = (doc.scope.length ? doc.scope : netNames().slice(0, 2)).filter(function (n) { return built.circuit.nodeIdx[n] !== undefined; }).slice(0, 4);
    setSpeedOptions(); setDtOptions(); setTdivOptions();
    restart(S.start);
    renderProbes(); renderInspector(); buildNodeReads();
    $('docText').value = text; $('docStatus').textContent = '';
    updateSpice();
    S.err = built.errors.length ? built.errors.join('；') : '';
    applyDirectives();
    return true;
  }
  function stripFns(p) { var o = {}; for (var k in p) if (k !== 'w') o[k] = p[k]; return o; }
  function netNames() {
    var c = S.built.circuit, labels = [], seen = {};
    S.doc.labels.forEach(function (l) { if (!seen[l.name] && l.name !== '0') { seen[l.name] = 1; labels.push(l.name); } });
    c.nodeNames.forEach(function (n) { if (n !== '0' && !seen[n]) { seen[n] = 1; labels.push(n); } });
    return labels;
  }

  function restart(how) {
    var r;
    if (how === 'zero') { S.sim.powerOn(); r = {ok: true}; }
    else r = S.sim.op();
    S.buf = makeBuf();
    S.carry = 0;
    sample(true);
    if (!r.ok) setStatus('DC 工作點沒有收斂（' + r.method + '），從目前的值繼續。', true);
  }

  /* ---------------- real-time loop ---------------- */
  function makeBuf() {
    var cap = 6000;
    return {cap: cap, t: new Float64Array(cap), v: [0, 1, 2, 3].map(function () { return new Float64Array(cap); }), head: 0, n: 0, last: -Infinity};
  }
  function sample(force) {
    var b = S.buf, every = S.tdiv * 10 / 2400;
    if (!force && S.sim.t - b.last < every * 0.999) return;
    b.last = S.sim.t;
    b.t[b.head] = S.sim.t;
    for (var k = 0; k < 4; k++) b.v[k][b.head] = k < S.probes.length ? S.sim.v(S.probes[k]) : NaN;
    b.head = (b.head + 1) % b.cap; if (b.n < b.cap) b.n++;
  }
  var last = performance.now(), lastUI = 0, statusUntil = 0;
  function frame(now) {
    var real = Math.min(0.05, (now - last) / 1000); last = now;
    if (S.sim && S.running) {
      var want = real * S.speed + S.carry, n = Math.floor(want / S.dt), done = 0, t0 = performance.now(), fail = 0;
      while (done < n) {
        if (!S.sim.step(S.dt)) fail++;
        done++; sample(false);
        if ((done & 7) === 0 && performance.now() - t0 > 11) break;
      }
      S.carry = done < n ? 0 : want - n * S.dt;
      var r = real > 0 ? done * S.dt / (real * S.speed) : 1;
      S.ratio = S.ratio * 0.9 + Math.min(1, r) * 0.1;
      if (fail && now > statusUntil) setStatus('有 ' + fail + ' 步 Newton 沒收斂，改用 4 個子步長（BE）', true, 1500);
    }
    if (S.doc) sch.frame(liveIf(), real);
    drawScope();
    if (now - lastUI > 120) { lastUI = now; updateReads(); if (now > statusUntil) showRunStatus(); }
    requestAnimationFrame(frame);
  }
  function liveIf() {
    var sim = S.sim;
    return {
      v: function (net) { return sim.v(net); },
      pin: function (name) { var el = sim.get(name); return el ? sim.pinCurrents(el) : null; },
      on: function (name) { var el = sim.get(name); return el ? el.p.on : true; }
    };
  }
  function showRunStatus() {
    var s = 't = ' + CS.fmt(S.sim.t, 's', 4) + ' · 每秒 ' + Math.round(S.speed / S.dt) + ' 步';
    if (S.running && S.ratio < 0.97) s += ' · 跟不上即時，實際速度 ' + Math.round(S.ratio * 100) + ' %';
    if (!S.running) s += ' · 暫停中';
    if (S.err) s += ' · ⚠ ' + S.err;
    setStatus(s, !!S.err);
  }
  function setStatus(msg, err, hold) {
    var el = $('simStatus'); el.textContent = msg; el.classList.toggle('err', !!err);
    if (hold) statusUntil = performance.now() + hold;
  }

  /* ---------------- toolbar ---------------- */
  $('run').addEventListener('click', function () { S.running = !S.running; this.textContent = S.running ? '暫停' : '繼續'; this.setAttribute('aria-pressed', S.running ? 'false' : 'true'); });
  $('resetOp').addEventListener('click', function () { restart('op'); });
  $('powerOn').addEventListener('click', function () { restart('zero'); });
  $('method').addEventListener('change', function () { S.method = this.value; S.sim.method = this.value; S.sim.restart = true; });
  $('optV').addEventListener('change', function () { sch.opts.voltColor = this.checked; });
  $('optI').addEventListener('change', function () { sch.opts.currentDots = this.checked; });
  $('optVal').addEventListener('change', function () { sch.opts.values = this.checked; });
  function setSpeedOptions() {
    var base = S.speed, opts = [base / 10, base / 4, base / 2, base, base * 2, base * 5];
    $('speed').innerHTML = opts.map(function (v) {
      return '<option value="' + v + '"' + (v === base ? ' selected' : '') + '>' + (v >= 1 ? v + '×' : '1/' + +(1 / v).toPrecision(3) + '×') + (v === base ? '（預設）' : '') + '</option>';
    }).join('');
  }
  $('speed').addEventListener('change', function () { S.speed = +this.value; });
  function setDtOptions() {
    var base = S.dt, opts = [base / 4, base / 2, base, base * 2, base * 5, base * 10];
    $('dt').innerHTML = opts.map(function (v) { return '<option value="' + v + '"' + (v === base ? ' selected' : '') + '>' + CS.fmt(v, 's') + '</option>'; }).join('');
  }
  $('dt').addEventListener('change', function () { S.dt = +this.value; S.sim.restart = true; });
  function setTdivOptions() {
    var base = S.tdiv, opts = [base / 5, base / 2, base, base * 2, base * 5, base * 10];
    $('tdiv').innerHTML = opts.map(function (v) { return '<option value="' + v + '"' + (v === base ? ' selected' : '') + '>' + CS.fmt(v, 's') + '</option>'; }).join('');
  }
  $('tdiv').addEventListener('change', function () { S.tdiv = +this.value; });

  /* ---------------- picking ---------------- */
  function onPick(hit) {
    if (!hit) { S.sel = null; sch.select(null); renderInspector(); return; }
    if (hit.part) {
      var el = S.sim.get(hit.part);
      if (el && el.type === 'SW' && !el.p.MOM) { S.sim.set(el.name, 'on', !el.p.on); syncDocParam(el); }
      S.sel = {part: hit.part}; sch.select(hit.part);
    } else if (hit.net) {
      S.sel = {net: hit.net}; sch.select(null);
    }
    renderInspector();
  }
  /* momentary switches: on while the pointer is down */
  $('sch').addEventListener('pointerdown', function (e) {
    if (!S.doc) return;
    var r = this.getBoundingClientRect(), hit = sch.hit(e.clientX - r.left, e.clientY - r.top);
    if (hit && hit.part) {
      var el = S.sim.get(hit.part);
      if (el && el.type === 'SW' && el.p.MOM) { S.mom = el.name; S.sim.set(el.name, 'on', true); this.setPointerCapture(e.pointerId); e.preventDefault(); }
    }
  });
  function momUp() { if (S.mom) { S.sim.set(S.mom, 'on', false); S.mom = null; } }
  $('sch').addEventListener('pointerup', momUp);
  $('sch').addEventListener('pointercancel', momUp);
  window.addEventListener('resize', function () { if (S.doc) sch.layout(); });

  /* ---------------- inspector ---------------- */
  function renderInspector() {
    var box = $('inspector');
    if (!S.sel) { box.innerHTML = '<p class="hint">點電路圖上的元件可以調整數值；點導線或標籤可以把那個節點加到示波器。開關點一下切換；MOM 開關要按住。</p>'; return; }
    if (S.sel.net) {
      var net = S.sel.net;
      box.innerHTML = '<h3>節點 ' + esc(net) + '</h3><div class="reads"><div class="read"><span class="k">電壓</span><span class="v" id="inspNetV">—</span></div></div>' +
        '<div class="row" style="margin-top:8px"><button type="button" class="btn sm" id="inspProbe">加到示波器</button></div>';
      $('inspProbe').addEventListener('click', function () { addProbe(net); });
      return;
    }
    var el = S.sim.get(S.sel.part), p = el.p, nets = el.nodes.map(function (i) { return S.built.circuit.nodeNames[i]; });
    var html = '<h3>' + esc(el.name) + '<span class="hint" style="font-weight:400"> · ' + TYPE_NAME[el.type] + (p.type ? ' ' + p.type.toUpperCase() : '') + '</span></h3>' +
      '<div class="hint">接在 ' + nets.map(esc).join(' · ') + '</div>';
    var rows = [];
    if (el.type === 'R' || el.type === 'C' || el.type === 'L') rows.push(logRow('value', '數值', {R: 'Ω', C: 'F', L: 'H'}[el.type], S.orig[el.name].value / 100, S.orig[el.name].value * 100));
    if (el.type === 'V' || el.type === 'I') {
      var w = p.w, u = el.type === 'V' ? 'V' : 'A';
      rows.push('<div class="insp-row"><span>波形</span><input type="text" id="inWave" value="' + esc(typeof p.wave === 'string' ? p.wave : String(p.w.dc)) + '"><button type="button" class="btn sm" id="inWaveSet">套用</button></div>');
      if (w.kind === 'SIN' || w.kind === 'PULSE') {
        var amp = w.kind === 'SIN' ? w.args[1] : w.args[1] - w.args[0], fr = w.freq || 0;
        rows.push(rangeRow('amp', '振幅', u, amp, Math.abs(amp) * 4 || 1, true));
        if (fr) rows.push(rangeRow('freq', '頻率', 'Hz', fr, fr * 10, false, fr / 10));
      } else if (w.kind === 'DC') rows.push(rangeRow('dc', '直流值', u, w.dc, Math.max(1, Math.abs(S.orig[el.name].wave || w.dc) * 2), true));
    }
    if (el.type === 'SW') rows.push('<div class="insp-row"><span>狀態</span><button type="button" class="btn sm" id="inSw">' + (p.on ? '導通（點一下打開）' : '打開（點一下導通）') + '</button><span></span></div>' + (p.MOM ? '<p class="hint">MOM 開關：在電路圖上按住它才導通。</p>' : ''));
    if (el.type === 'Q') rows.push(logRow('BF', 'β (BF)', '', 20, 1000));
    if (el.type === 'U') { rows.push(logRow('GBW', 'GBW', 'Hz', 1e3, 1e9)); rows.push(logRow('A0', 'A₀', '', 1e2, 1e8)); }
    if (el.type === 'D') rows.push(logRow('IS', 'IS', 'A', 1e-16, 1e-6));
    html += rows.join('');
    html += '<div class="reads" style="margin-top:8px"><div class="read"><span class="k">電流</span><span class="v" id="inspI">—</span></div>' +
      '<div class="read"><span class="k">兩端電壓</span><span class="v" id="inspV">—</span></div><div class="read"><span class="k">功率</span><span class="v" id="inspP">—</span></div></div>' +
      '<div class="row" style="margin-top:8px">' + nets.filter(function (n) { return n !== '0'; }).map(function (n) { return '<button type="button" class="btn sm" data-probe="' + esc(n) + '">示波器 + ' + esc(n) + '</button>'; }).join('') + '</div>';
    box.innerHTML = html;
    box.querySelectorAll('[data-probe]').forEach(function (b) { b.addEventListener('click', function () { addProbe(b.dataset.probe); }); });
    box.querySelectorAll('input[data-log]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var lo = +inp.dataset.lo, hi = +inp.dataset.hi, v = lo * Math.pow(hi / lo, +inp.value / 1000);
        v = +v.toPrecision(3);
        setParam(el, inp.dataset.log, v);
        $('val_' + inp.dataset.log).textContent = CS.fmt(v, inp.dataset.unit);
      });
    });
    box.querySelectorAll('input[data-lin]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var v = +(+inp.value).toPrecision(3), key = inp.dataset.lin;
        $('val_' + key).textContent = CS.fmt(v, inp.dataset.unit);
        if (key === 'dc') { setWave(el, v); return; }
        var w = el.p.w, a = w.args.slice();
        if (w.kind === 'SIN') { if (key === 'amp') a[1] = v; else a[2] = v; setWave(el, 'SIN(' + a.map(CS.spiceNum).join(' ') + ')'); }
        else if (w.kind === 'PULSE') {
          if (key === 'amp') a[1] = a[0] + v;
          else { var per = 1 / v, r0 = a[6] || per; a[6] = per; a[5] = a[5] * per / r0; a[3] = a[3] * per / r0; a[4] = a[4] * per / r0; }
          setWave(el, 'PULSE(' + a.map(CS.spiceNum).join(' ') + ')');
        }
      });
    });
    var ws = $('inWaveSet');
    if (ws) ws.addEventListener('click', function () { var t = $('inWave').value.trim(); setWave(el, /^[\d.+-]/.test(t) ? CS.num(t) : t); renderInspector(); });
    var sw = $('inSw');
    if (sw) sw.addEventListener('click', function () { S.sim.set(el.name, 'on', !el.p.on); syncDocParam(el); renderInspector(); });
  }
  function logRow(key, label, unit, lo, hi) {
    var el = S.sim.get(S.sel.part), v = el.p[key];
    var pos = Math.round(1000 * Math.log(v / lo) / Math.log(hi / lo));
    return '<div class="insp-row"><span>' + label + '</span><input type="range" min="0" max="1000" value="' + pos + '" data-log="' + key + '" data-lo="' + lo + '" data-hi="' + hi + '" data-unit="' + unit + '" aria-label="' + label + '"><span class="val" id="val_' + key + '">' + CS.fmt(v, unit) + '</span></div>';
  }
  function rangeRow(key, label, unit, v, hi, signed, lo) {
    var min = lo !== undefined ? lo : (signed ? -hi : 0), step = (hi - min) / 400;
    return '<div class="insp-row"><span>' + label + '</span><input type="range" min="' + min + '" max="' + hi + '" step="' + step + '" value="' + v + '" data-lin="' + key + '" data-unit="' + unit + '" aria-label="' + label + '"><span class="val" id="val_' + key + '">' + CS.fmt(v, unit) + '</span></div>';
  }
  function setParam(el, key, v) { S.sim.set(el.name, key, v); syncDocParam(el); }
  function setWave(el, w) { S.sim.set(el.name, 'wave', w); syncDocParam(el); }

  /* keep the document text in step with the inspector (so export and share links include the change) */
  function syncDocParam(el) {
    var part = null;
    S.doc.parts.forEach(function (p) { if (p.name === el.name) part = p; });
    if (!part) return;
    var p = el.p;
    if (el.type === 'R' || el.type === 'C' || el.type === 'L') part.params.value = p.value;
    if (el.type === 'V' || el.type === 'I') part.params.wave = p.wave;
    if (el.type === 'SW') part.params.on = p.on;
    ['BF', 'GBW', 'A0', 'IS'].forEach(function (k) { if (part.params[k] !== undefined || (el.type === 'Q' && k === 'BF') || (el.type === 'U' && (k === 'GBW' || k === 'A0')) || (el.type === 'D' && k === 'IS')) if (p[k] !== undefined) part.params[k] = p[k]; });
    var lines = S.text.split(/\r?\n/);
    lines[part.line] = partLine(part);
    S.text = lines.join('\n');
    $('docText').value = S.text;
    updateSpice();
  }
  function partLine(part) {
    var t = part.type, p = part.params, out = [t, part.name];
    if (part.pts) { out.push(part.pts[0].join(','), part.pts[1].join(',')); if (part.flag) out.push('[' + part.flag + ']'); }
    else { out.push(part.at.join(',')); if (p.type && t !== 'U') out.push(p.type); if (part.flag) out.push('[' + part.flag + ']'); }
    if (t === 'R' || t === 'C' || t === 'L') out.push(CS.spiceNum(p.value));
    else if (t === 'V' || t === 'I') out.push(typeof p.wave === 'number' ? CS.spiceNum(p.wave) : p.wave);
    else if (t === 'SW') out.push(p.on ? 'on' : 'off');
    Object.keys(p).forEach(function (k) {
      if (k === 'value' || k === 'wave' || k === 'type' || k === 'on' || k === 'acph') return;
      if (k === 'ac') { if (p.ac) out.push('AC=' + p.ac + (p.acph ? ',' + p.acph : '')); return; }
      out.push(k + '=' + (typeof p[k] === 'number' ? CS.spiceNum(p[k]) : p[k]));
    });
    return out.join(' ');
  }

  /* ---------------- node readouts ---------------- */
  function buildNodeReads() {
    var names = netNames().slice(0, 16);
    $('nodeReads').innerHTML = names.map(function (n) {
      return '<button type="button" class="read" data-n="' + esc(n) + '" style="text-align:left;background:var(--surface);cursor:pointer;font:inherit;color:inherit"><span class="k">' + esc(n) + '</span><span class="v" data-v="' + esc(n) + '">—</span></button>';
    }).join('');
    $('nodeReads').querySelectorAll('[data-n]').forEach(function (b) { b.addEventListener('click', function () { addProbe(b.dataset.n); }); });
  }
  function updateReads() {
    if (!S.sim) return;
    $('nodeReads').querySelectorAll('[data-v]').forEach(function (s) { s.textContent = CS.fmt(S.sim.v(s.dataset.v), 'V', 4); });
    if (S.sel && S.sel.net && $('inspNetV')) $('inspNetV').textContent = CS.fmt(S.sim.v(S.sel.net), 'V', 4);
    if (S.sel && S.sel.part && $('inspI')) {
      var el = S.sim.get(S.sel.part), i = S.sim.i(el), v = S.sim.v(el.nodes[0]) - S.sim.v(el.nodes[1]);
      if (el.type === 'Q') { var pc = S.sim.pinCurrents(el); $('inspI').textContent = 'I_C ' + CS.fmt(pc[0], 'A') + ' I_B ' + CS.fmt(pc[1], 'A'); v = S.sim.v(el.nodes[0]) - S.sim.v(el.nodes[2]); i = pc[0]; $('inspV').textContent = 'V_CE ' + CS.fmt(v, 'V', 4); }
      else if (el.type === 'U') { $('inspI').textContent = CS.fmt(i, 'A') + '（輸出）'; $('inspV').textContent = 'Vout ' + CS.fmt(S.sim.v(el.nodes[2]), 'V', 4); v = 0; }
      else { $('inspI').textContent = CS.fmt(i, 'A'); $('inspV').textContent = CS.fmt(v, 'V', 4); }
      $('inspP').textContent = el.type === 'U' ? '—' : CS.fmt(Math.abs(v * i), 'W');
    }
  }

  /* ---------------- scope ---------------- */
  function renderProbes() {
    $('probeChips').innerHTML = S.probes.map(function (n, i) {
      return '<span class="probe-chip" style="color:' + COLORS[i] + '">CH' + (i + 1) + ' ' + esc(n) + '<button type="button" data-rm="' + i + '" aria-label="移除 ' + esc(n) + '">×</button></span>';
    }).join('');
    $('probeChips').querySelectorAll('[data-rm]').forEach(function (b) { b.addEventListener('click', function () { S.probes.splice(+b.dataset.rm, 1); S.buf = makeBuf(); renderProbes(); }); });
    $('probeAdd').innerHTML = '<option value="">—</option>' + netNames().map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('');
  }
  $('probeAdd').addEventListener('change', function () { if (this.value) addProbe(this.value); this.value = ''; });
  function addProbe(n) {
    if (S.probes.indexOf(n) >= 0) return;
    if (S.probes.length >= 4) S.probes.shift();
    S.probes.push(n); S.buf = makeBuf(); renderProbes();
    showTab('scope');
  }
  function bufWindow() {
    var b = S.buf, tEnd = S.sim.t, t0 = tEnd - S.tdiv * 10, out = {t: [], v: [[], [], [], []]};
    var start = (b.head - b.n + b.cap) % b.cap;
    for (var k = 0; k < b.n; k++) {
      var i = (start + k) % b.cap;
      if (b.t[i] < t0) continue;
      out.t.push(b.t[i]);
      for (var c = 0; c < 4; c++) out.v[c].push(b.v[c][i]);
    }
    return {t0: t0, t1: tEnd, d: out};
  }
  var yLock = null;
  function drawScope() {
    if (!S.sim || $('tabs').dataset.active && $('tabs').dataset.active !== 'scope') return;
    var w = bufWindow();
    if ($('scopeFFT').checked) {
      var y = w.d.v[0].filter(isFinite), fs = 2400 / (S.tdiv * 10), sp = window.LabDSP.spectrum(y, fs);
      scopePlot.o.xlog = true; scopePlot.o.ylog = false; scopePlot.o.xunit = 'Hz'; scopePlot.o.yunit = 'dBV';
      var db = sp.mag.map(function (m) { return 20 * Math.log10(Math.max(m, 1e-9)); });
      scopePlot.draw([{x: sp.f, y: db, color: COLORS[0], label: 'CH1 ' + (S.probes[0] || '') + '（rms）'}], {xRange: [Math.max(sp.f[0] || 1, fs / 4096), fs / 2]});
      $('scopeNote').textContent = 'Hann 視窗 FFT，' + (sp.n || 0) + ' 點，取樣率 ' + CS.fmt(fs, 'Hz') + '：看得到截波產生的諧波。';
      return;
    }
    scopePlot.o.xlog = false; scopePlot.o.xunit = 's'; scopePlot.o.yunit = 'V';
    var series = S.probes.map(function (n, i) { return {x: w.d.t, y: w.d.v[i], color: COLORS[i], label: 'CH' + (i + 1) + ' ' + n}; });
    var lo = Infinity, hi = -Infinity;
    series.forEach(function (s) { s.y.forEach(function (v) { if (isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }); });
    if (!isFinite(lo)) { lo = -1; hi = 1; }
    var span = Math.max(hi - lo, Math.max(Math.abs(hi), Math.abs(lo)) * 0.2, 1e-6), pad = span * 0.08;
    var want = [lo - pad, hi + pad];
    if (!yLock || want[0] < yLock[0] || want[1] > yLock[1] || (yLock[1] - yLock[0]) > 3 * (want[1] - want[0])) yLock = want;
    scopePlot.draw(series, {xRange: [w.t0, w.t1], yRange: yLock});
    $('scopeNote').textContent = '畫面寬 10 格 = ' + CS.fmt(S.tdiv * 10, 's') + '；Y 軸自動縮放。暫停後把滑鼠移到波形上可以讀值。';
  }
  $('csv').addEventListener('click', function () {
    var w = bufWindow(), rows = ['t,' + S.probes.join(',')];
    for (var i = 0; i < w.d.t.length; i++) rows.push([w.d.t[i]].concat(S.probes.map(function (n, c) { return w.d.v[c][i]; })).join(','));
    download((S.ex ? S.ex.id : 'circuit') + '-scope.csv', rows.join('\n'), 'text/csv');
  });

  /* ---------------- tabs ---------------- */
  function showTab(name) {
    $('tabs').dataset.active = name;
    document.querySelectorAll('#tabs [role=tab]').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false'); });
    document.querySelectorAll('.tabpanel').forEach(function (p) { p.hidden = p.dataset.panel !== name; });
    if (name === 'ac' && !acMag.series.length) runAC();
    if (name === 'net') updateSpice();
  }
  document.querySelectorAll('#tabs [role=tab]').forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); }); });

  function fillSelects() {
    var c = S.built.circuit, nets = netNames();
    var srcs = c.elements.filter(function (e) { return e.type === 'V' || e.type === 'I'; }).map(function (e) { return e.name; });
    function opts(list, sel) { return list.map(function (n) { return '<option' + (n === sel ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join(''); }
    $('acSrc').innerHTML = opts(srcs); $('mcSrc').innerHTML = opts(srcs);
    $('nzIn').innerHTML = '<option value="">（不換算）</option>' + opts(srcs);
    ['acOut', 'nzOut', 'mcNode', 'dcOut'].forEach(function (id) { $(id).innerHTML = opts(nets); });
    $('acRef').innerHTML = '<option value="0">0（地）</option>' + opts(nets);
    var sweepable = c.elements.filter(function (e) { return /^(R|C|L|V|I)$/.test(e.type); }).map(function (e) { return e.name; });
    $('dcEl').innerHTML = opts(sweepable);
    acMag.draw([]); acPh.draw([]); dcPlot.draw([]); nzPlot.draw([]); mcPlot.draw([]);
    $('nzTable').innerHTML = ''; $('mcReads').innerHTML = ''; $('mcStatus').textContent = '';
    setDcRange();
  }
  function applyDirectives() {
    var d = S.doc.directives;
    function pick(id, v) { if (v === undefined) return; var s = $(id); for (var i = 0; i < s.options.length; i++) if (s.options[i].value === String(v) || s.options[i].text === String(v)) s.selectedIndex = i; }
    if (d.ac) { pick('acSrc', d.ac.src); pick('acOut', d.ac.out); if (d.ac.ref) pick('acRef', d.ac.ref); if (d.ac.f0) $('acF0').value = d.ac.f0; if (d.ac.f1) $('acF1').value = d.ac.f1; }
    else { $('acF0').value = '1'; $('acF1').value = '1meg'; if (S.probes[1]) pick('acOut', S.probes[1]); }
    if (d.noise) {
      pick('nzOut', d.noise.out); pick('nzIn', d.noise.in || '');
      var band = (d.noise.band || '1,100k').split(','); $('nzLo').value = band[0]; $('nzHi').value = band[1];
      S.nzRange = [CS.num(d.noise.f0 || band[0]), CS.num(d.noise.f1 || band[1])];
    } else { $('nzLo').value = '1'; $('nzHi').value = '100k'; S.nzRange = [1, 1e6]; if (S.probes[1]) pick('nzOut', S.probes[1]); }
    if (d.mc) { pick('mcMeas', d.mc.measure || 'ac'); pick('mcNode', d.mc.node); pick('mcSrc', d.mc.src); if (d.mc.f) $('mcF').value = d.mc.f; if (d.mc.n) $('mcN').value = d.mc.n; }
    if (d.dcsweep) { pick('dcEl', d.dcsweep.el); setDcRange(); if (d.dcsweep.from) $('dcFrom').value = d.dcsweep.from; if (d.dcsweep.to) $('dcTo').value = d.dcsweep.to; if (d.dcsweep.n) $('dcN').value = d.dcsweep.n; pick('dcOut', d.dcsweep.out); $('dcLog').checked = /^(R|C|L)/.test(S.sim.get($('dcEl').value).type); }
    else if (S.probes[1]) pick('dcOut', S.probes[1]);
  }

  /* run an analysis at the DC operating point without disturbing the running transient */
  function atOp(fn) {
    var st = S.sim.saveState(), r = S.sim.op(), out;
    try { out = fn(r); } finally { S.sim.loadState(st); }
    return out;
  }

  /* ---------------- AC ---------------- */
  $('acRun').addEventListener('click', runAC);
  function runAC() {
    var src = $('acSrc').value, out = $('acOut').value, ref = $('acRef').value, f0 = CS.num($('acF0').value), f1 = CS.num($('acF1').value);
    if (!src || !(f0 > 0) || !(f1 > f0)) return;
    var map = {}; map[src] = [1, 0];
    var res = atOp(function () { return S.sim.acSweep(f0, f1, 241, out, ref === '0' ? null : ref, map); });
    var f = res.map(function (r) { return r.f; }), db = res.map(function (r) { return 20 * Math.log10(Math.hypot(r.re, r.im) || 1e-30); });
    var ph = unwrap(res.map(function (r) { return Math.atan2(r.im, r.re) * 180 / Math.PI; }));
    var pk = 0; db.forEach(function (v, i) { if (v > db[pk]) pk = i; });
    var lvl = db[pk] - 3, fL = null, fH = null, i;
    function cross(a, b) { return f[a] * Math.pow(f[b] / f[a], (lvl - db[a]) / (db[b] - db[a])); }
    for (i = pk; i > 0; i--) if (db[i] >= lvl && db[i - 1] < lvl) { fL = cross(i - 1, i); break; }
    for (i = pk; i < db.length - 1; i++) if (db[i] >= lvl && db[i + 1] < lvl) { fH = cross(i, i + 1); break; }
    var vl = [{v: f[pk], label: '最大 ' + db[pk].toFixed(1) + ' dB'}];
    if (fL) vl.push({v: fL, label: '−3 dB ' + CS.fmt(fL, 'Hz'), color: 'var(--c2)'});
    if (fH) vl.push({v: fH, label: '−3 dB ' + CS.fmt(fH, 'Hz'), color: 'var(--c2)'});
    acMag.draw([{x: f, y: db, color: 'var(--c1)', label: 'v(' + out + (ref !== '0' ? '−' + ref : '') + ') / ' + src}], {xRange: [f0, f1], vlines: vl});
    acPh.draw([{x: f, y: ph, color: 'var(--c3)', label: '相位'}], {xRange: [f0, f1]});
    var band = fL && fH ? '−3 dB 頻帶 ' + CS.fmt(fL, 'Hz') + '–' + CS.fmt(fH, 'Hz') + '（寬 ' + CS.fmt(fH - fL, 'Hz') + '）' : fH ? '−3 dB 在 ' + CS.fmt(fH, 'Hz') : fL ? '低於 ' + CS.fmt(fL, 'Hz') + ' 掉 3 dB 以上' : '範圍內沒有掉 3 dB';
    $('acNote').textContent = '最大 ' + db[pk].toFixed(2) + ' dB（' + CS.fmt(Math.pow(10, db[pk] / 20), '', 4) + ' 倍）在 ' + CS.fmt(f[pk], 'Hz') + '；' + band +
      '。在 DC 工作點線性化，再解 (G + jωC)x = b；輸入源振幅當 1。';
  }
  function unwrap(a) { var out = a.slice(); for (var i = 1; i < out.length; i++) { while (out[i] - out[i - 1] > 180) out[i] -= 360; while (out[i] - out[i - 1] < -180) out[i] += 360; } return out; }

  /* ---------------- DC sweep ---------------- */
  $('dcEl').addEventListener('change', setDcRange);
  function setDcRange() {
    var el = S.sim.get($('dcEl').value); if (!el) return;
    if (el.type === 'V' || el.type === 'I') { var v = el.p.w.dc || 1; $('dcFrom').value = CS.spiceNum(-Math.abs(v) * 2 || -1); $('dcTo').value = CS.spiceNum(Math.abs(v) * 2 || 1); $('dcLog').checked = false; }
    else { $('dcFrom').value = CS.spiceNum(el.p.value / 10); $('dcTo').value = CS.spiceNum(el.p.value * 10); $('dcLog').checked = true; }
  }
  $('dcRun').addEventListener('click', function () {
    var name = $('dcEl').value, el = S.sim.get(name), a = CS.num($('dcFrom').value), b = CS.num($('dcTo').value), n = Math.max(3, Math.min(400, +$('dcN').value | 0)), lg = $('dcLog').checked && a > 0 && b > 0;
    var outs = [$('dcOut').value].concat(S.probes.filter(function (p) { return p !== $('dcOut').value; }).slice(0, 2));
    var vals = [];
    for (var k = 0; k < n; k++) vals.push(lg ? a * Math.pow(b / a, k / (n - 1)) : a + (b - a) * k / (n - 1));
    var key = (el.type === 'V' || el.type === 'I') ? 'wave' : 'value';
    var keepWave = el.p.wave;
    var st = S.sim.saveState();
    var res = S.sim.dcSweep(name, key, vals, function (s) { return outs.map(function (o) { return s.v(o); }); });
    if (key === 'wave') S.sim.set(name, 'wave', keepWave);
    S.sim.loadState(st);
    dcPlot.o.xlog = lg; dcPlot.o.xunit = {R: 'Ω', C: 'F', L: 'H', V: 'V', I: 'A'}[el.type]; dcPlot.o.xlabel = name;
    dcPlot.draw(outs.map(function (o, i) { return {x: vals, y: res.map(function (r) { return r.data[i]; }), color: COLORS[i], label: 'v(' + o + ')', dots: n <= 60}; }), {xRange: [Math.min(a, b), Math.max(a, b)]});
  });

  /* ---------------- noise ---------------- */
  $('nzRun').addEventListener('click', function () {
    var out = $('nzOut').value, src = $('nzIn').value, lo = CS.num($('nzLo').value), hi = CS.num($('nzHi').value);
    var fa = Math.min(S.nzRange[0], lo), fb = Math.max(S.nzRange[1], hi);
    var f = CS.logspace(fa, fb, 161);
    var r = atOp(function () {
      var nz = S.sim.noise(out, null, f), gain = null;
      if (src) { var m = {}; m[src] = [1, 0]; gain = S.sim.acSweep(fa, fb, 161, out, null, m).map(function (g) { return Math.hypot(g.re, g.im); }); }
      return {nz: nz, gain: gain};
    });
    var tot = Array.prototype.map.call(r.nz.total, Math.sqrt);
    var series = [{x: f, y: tot, color: 'var(--c1)', label: '輸出總雜訊'}];
    if (r.gain) series.push({x: f, y: tot.map(function (v, i) { return v / r.gain[i]; }), color: 'var(--c2)', label: '換算到輸入'});
    var names = Object.keys(r.nz.parts), band = {};
    names.forEach(function (n) { band[n] = CS.integrate(f, r.nz.parts[n], lo, hi); });
    var totBand = CS.integrate(f, r.nz.total, lo, hi);
    names.sort(function (a, b) { return band[b] - band[a]; });
    names.slice(0, 3).forEach(function (n, i) { if (band[n] > 0) series.push({x: f, y: Array.prototype.map.call(r.nz.parts[n], Math.sqrt), color: ['var(--c3)', 'var(--c4)', 'var(--c5)'][i], label: n, dash: [5, 4], width: 1.3}); });
    nzPlot.draw(series, {bands: [{from: lo, to: hi}]});
    var gBand = null;
    if (r.gain) { var g2 = r.gain.map(function (g) { return g * g; }); gBand = Math.sqrt(CS.integrate(f, g2, lo, hi) / (hi - lo)); }
    var rows = names.filter(function (n) { return band[n] > 0; }).slice(0, 10).map(function (n) {
      return '<tr><td>' + esc(n) + '</td><td class="num">' + CS.fmt(Math.sqrt(band[n]), 'Vrms') + '</td><td class="num">' + (100 * band[n] / totBand).toFixed(1) + ' %</td>' +
        (gBand ? '<td class="num">' + CS.fmt(Math.sqrt(band[n]) / gBand, 'Vrms') + '</td>' : '') + '</tr>';
    });
    $('nzTable').innerHTML = '<table class="data"><thead><tr><th>元件</th><th>輸出端（' + CS.fmt(lo, 'Hz') + '–' + CS.fmt(hi, 'Hz') + '）</th><th>占比（功率）</th>' + (gBand ? '<th>換算到輸入（約）</th>' : '') + '</tr></thead><tbody>' +
      rows.join('') + '<tr><td><b>合計</b></td><td class="num"><b>' + CS.fmt(Math.sqrt(totBand), 'Vrms') + '</b></td><td class="num">100 %</td>' + (gBand ? '<td class="num"><b>' + CS.fmt(Math.sqrt(totBand) / gBand, 'Vrms') + '</b></td>' : '') + '</tr></tbody></table>' +
      (gBand ? '<p class="hint">換算到輸入用頻寬內的平均增益 ' + CS.fmt(gBand, '', 4) + ' 倍。峰對峰值約為 rms 的 6.6 倍。</p>' : '');
  });

  /* ---------------- Monte Carlo ---------------- */
  $('mcRun').addEventListener('click', function () {
    var N = Math.max(10, Math.min(5000, +$('mcN').value | 0)), tr = +$('mcR').value / 100, tc = +$('mcC').value / 100, tb = +$('mcB').value / 100;
    var gauss = $('mcDist').value === 'g', meas = $('mcMeas').value, node = $('mcNode').value, src = $('mcSrc').value, f = CS.num($('mcF').value);
    var sim = S.sim, els = sim.c.elements, nominal = {}, rnd = CS.rng(12345), st = sim.saveState(), vals = [], k = 0, btn = this;
    els.forEach(function (e) { nominal[e.name] = {value: e.p.value, BF: e.p.BF}; });
    function draw() { var u = gauss ? CS.gauss(rnd) / 3 : 2 * rnd() - 1; return u; }
    function one() {
      els.forEach(function (e) {
        if (e.type === 'R') e.p.value = nominal[e.name].value * (1 + tr * draw());
        else if (e.type === 'C') e.p.value = nominal[e.name].value * (1 + tc * draw());
        else if (e.type === 'Q') e.p.BF = nominal[e.name].BF * (1 + tb * draw());
      });
      sim.buildCm();
      var r = sim.op();
      if (!r.ok) return NaN;
      if (meas === 'dc') return sim.v(node);
      var m = {}; m[src] = [1, 0];
      var a = sim.vac(sim.ac(f, m), node);
      var srcEl = sim.get(src), scale = srcEl.p.w.amp || srcEl.p.ac || 1;
      return Math.hypot(a[0], a[1]) * Math.abs(scale);
    }
    btn.disabled = true;
    (function chunk() {
      var t0 = performance.now();
      while (k < N && performance.now() - t0 < 30) { vals.push(one()); k++; }
      $('mcStatus').textContent = k + ' / ' + N;
      if (k < N) { setTimeout(chunk, 0); return; }
      els.forEach(function (e) { if (nominal[e.name].value !== undefined) e.p.value = nominal[e.name].value; if (nominal[e.name].BF !== undefined) e.p.BF = nominal[e.name].BF; });
      sim.buildCm(); sim.loadState(st);
      btn.disabled = false;
      showMC(vals.filter(isFinite), meas === 'dc' ? 'V' : 'V', meas === 'dc' ? 'v(' + node + ')' : '|v(' + node + ')| @ ' + CS.fmt(f, 'Hz') + '（' + src + ' 用它的波形振幅）');
    })();
  });
  function showMC(v, unit, what) {
    if (!v.length) { $('mcStatus').textContent = '全部沒有收斂'; return; }
    var mean = v.reduce(function (a, b) { return a + b; }, 0) / v.length;
    var sd = Math.sqrt(v.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / Math.max(1, v.length - 1));
    var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), nb = Math.min(40, Math.max(10, Math.round(Math.sqrt(v.length) * 1.5)));
    var w = (hi - lo) / nb || Math.abs(mean) * 1e-3 || 1e-9, bins = new Array(nb).fill(0), xs = [];
    v.forEach(function (x) { bins[Math.min(nb - 1, Math.floor((x - lo) / w))]++; });
    for (var i = 0; i < nb; i++) xs.push(lo + (i + 0.5) * w);
    mcPlot.o.xunit = unit; mcPlot.o.xlabel = what;
    mcPlot.draw([{x: xs, y: bins, bars: true, barWidth: w, color: 'var(--c1)'}], {xRange: [lo - w, hi + w], yRange: [0, Math.max.apply(null, bins) * 1.15], vlines: [{v: mean, label: '平均'}]});
    var sorted = v.slice().sort(function (a, b) { return a - b; });
    function pct(p) { return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]; }
    $('mcReads').innerHTML = [['次數', v.length], ['平均', CS.fmt(mean, unit, 4)], ['標準差', CS.fmt(sd, unit, 3) + '（' + (100 * sd / Math.abs(mean || 1)).toFixed(2) + ' %）'],
      ['最小', CS.fmt(lo, unit, 4)], ['最大', CS.fmt(hi, unit, 4)], ['99 %', CS.fmt(pct(0.99), unit, 4)]].map(function (r) {
      return '<div class="read"><span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span></div>';
    }).join('');
    $('mcStatus').textContent = '完成';
  }

  /* ---------------- netlist / export ---------------- */
  function updateSpice() {
    if (!S.built) return;
    var tr = S.doc.directives.tran, ac = S.doc.directives.ac;
    $('spiceOut').textContent = CS.toSpice(S.sim ? S.sim.c : S.built.circuit, {
      title: S.doc.title || (S.ex && S.ex.title) || 'circuit',
      tran: {step: S.dt, stop: S.tdiv * 10},
      ac: ac ? {f0: CS.num(ac.f0 || 1), f1: CS.num(ac.f1 || 1e6)} : null
    });
  }
  $('docApply').addEventListener('click', function () {
    var ok = loadDoc($('docText').value, false);
    $('docStatus').textContent = ok ? (S.err ? '已套用，但：' + S.err : '已套用') : '有錯誤，沒有套用';
    $('docStatus').classList.toggle('err', !ok || !!S.err);
  });
  $('docReset').addEventListener('click', function () { if (S.ex) loadExample(S.ex); });
  $('spiceDl').addEventListener('click', function () { download((S.ex ? S.ex.id : 'circuit') + '.cir', $('spiceOut').textContent, 'text/plain'); });
  $('share').addEventListener('click', function () {
    var b64 = btoa(unescape(encodeURIComponent(S.text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    var url = location.href.split('#')[0] + '#doc=' + b64;
    history.replaceState(null, '', '#doc=' + b64);
    var done = function () { $('docStatus').textContent = '連結已複製（電路文字編在網址裡）'; };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { $('docStatus').textContent = '請複製網址列'; });
    else $('docStatus').textContent = '請複製網址列';
  });
  function download(name, text, type) {
    var a = document.createElement('a'), url = URL.createObjectURL(new Blob([text], {type: type}));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------------- start ---------------- */
  function fromHash() {
    var h = location.hash.slice(1), m;
    if ((m = /^doc=([\w-]+)/.exec(h))) {
      try {
        var t = decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
        S.ex = null;
        document.querySelectorAll('#examples .btn').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
        $('exInfo').innerHTML = '<p class="hint">從分享連結載入的電路。</p>';
        if (loadDoc(t, false)) return;
      } catch (e) { /* fall through to the default example */ }
    }
    var id = (m = /^ex=(\w+)/.exec(h)) ? m[1] : 'rc', ex = EX.filter(function (e) { return e.id === id; })[0] || EX[0];
    loadExample(ex);
  }
  window.CircuitSimApp = {state: S, loadExample: loadExample};   // for debugging from the console
  fromHash();
  window.addEventListener('hashchange', function () { if (/^#ex=/.test(location.hash)) fromHash(); });
  requestAnimationFrame(frame);
})();
