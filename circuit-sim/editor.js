/* Drag-and-drop schematic editor on top of CircuitSchematic (pan mode).

   var ed = new CircuitEditor(rootElement, {
     text: docText,                       // the schematic document (engine.js parseDoc format)
     onChange: function (text) {},        // after every committed edit
     palette: ['R', 'C', ...],            // part types offered in the toolbar
     elecTypes: [['wet', '濕電極'], ...],  // choices for ELEC TYPE= in the inspector
     describe: function (part, live) {},  // optional extra inspector html for a part
     height: 560
   });
   ed.setText(text)                       // replace the document (keeps undo history)
   ed.setLive(live, text)                 // DC solution to color nets: {v(net), pin(name), on(name)}
   ed.setMessages([{text, level}])        // warnings shown under the canvas

   The document text is the single source of truth: every edit changes a parsed copy, writes it
   back with CircuitSim.docToText and parses it again.  The pure editing operations are in
   CircuitEditor.core so they can be tested without a canvas. */
(function (global) {
  'use strict';
  var CS = global.CircuitSim, SCH = global.CircuitSchematic;

  /* ======================= pure document operations ======================= */
  function key(p) { return p[0] + ',' + p[1]; }
  function eq(a, b) { return a[0] === b[0] && a[1] === b[1]; }
  function wkey(w) { var a = key(w.a), b = key(w.b); return a < b ? a + '|' + b : b + '|' + a; }
  function lkey(l) { return l.name + '@' + key(l.at); }
  function tkey(t) { return key(t.at) + '|' + t.text; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function refreshPins(p) { p.pins = p.pts ? p.pts : CS.pinsOf(p.type, p.at, p.flag, p.sym); }
  function emptySel() { return {parts: {}, wires: {}, grounds: {}, labels: {}, texts: {}}; }
  function selCount(s) { var n = 0; for (var k in s) n += Object.keys(s[k]).length; return n; }

  var PREFIX = {R: 'R', C: 'C', L: 'L', V: 'V', I: 'I', D: 'D', TVS: 'D', SW: 'S', U: 'U', Q: 'Q', M: 'M', ELEC: 'E', J: 'J:', IC: 'U'};
  function nextName(doc, type, base) {
    var pre = base || PREFIX[type] || type, used = {}, n = 1;
    doc.parts.forEach(function (p) { used[p.name] = true; });
    while (used[pre + n]) n++;
    return pre + n;
  }

  /* move the selection by (dx, dy); unselected wires attached to moved points stretch (and turn into
     an L when they would go diagonal), grounds and labels sitting on moved pins come along */
  function translate(doc, sel, dx, dy) {
    if (!dx && !dy) return doc;
    var moved = {}, still = {}, stretched = {};
    function mv(p) { return [p[0] + dx, p[1] + dy]; }
    doc.parts.forEach(function (p) { if (!sel.parts[p.name]) p.pins.forEach(function (q) { still[key(q)] = q; }); });
    doc.parts.forEach(function (p) {
      if (!sel.parts[p.name]) return;
      p.pins.forEach(function (q) { moved[key(q)] = q; });
      if (p.pts) p.pts = p.pts.map(mv); else p.at = mv(p.at);
      refreshPins(p);
    });
    var extra = [];
    doc.wires.forEach(function (w) {
      if (sel.wires[wkey(w)]) { moved[key(w.a)] = w.a; moved[key(w.b)] = w.b; }
    });
    doc.wires.forEach(function (w) {
      if (sel.wires[wkey(w)]) { w.a = mv(w.a); w.b = mv(w.b); return; }
      var ma = moved[key(w.a)], mb = moved[key(w.b)];
      if (ma && mb) { w.a = mv(w.a); w.b = mv(w.b); return; }
      if (!ma && !mb) return;
      stretched[key(ma ? w.a : w.b)] = true;
      var horiz = w.a[1] === w.b[1], fixed = ma ? w.b : w.a, m = mv(ma ? w.a : w.b);
      if (fixed[0] === m[0] || fixed[1] === m[1]) { if (ma) w.a = m; else w.b = m; return; }
      var corner = horiz ? [m[0], fixed[1]] : [fixed[0], m[1]];
      w.a = fixed; w.b = corner; extra.push({a: corner, b: m});
    });
    /* a moved pin that touched a pin left behind keeps the connection with a new L-shaped wire */
    Object.keys(moved).forEach(function (k) {
      if (!still[k] || stretched[k]) return;
      var p0 = moved[k].slice(), pts = route(p0, mv(p0));
      for (var i = 1; i < pts.length; i++) extra.push({a: pts[i - 1], b: pts[i]});
    });
    doc.wires = doc.wires.concat(extra);
    doc.grounds.forEach(function (g) { if (sel.grounds[key(g.at)] || moved[key(g.at)]) g.at = mv(g.at); });
    doc.labels.forEach(function (l) { if (sel.labels[lkey(l)] || moved[key(l.at)]) l.at = mv(l.at); });
    (doc.texts || []).forEach(function (t) { if (sel.texts[tkey(t)]) t.at = mv(t.at); });
    return doc;
  }
  /* the same selection after translate (keys contain coordinates) */
  function shiftSel(sel, dx, dy) {
    var out = emptySel();
    out.parts = sel.parts;
    function sh(k) { var q = k.split(',').map(Number); return (q[0] + dx) + ',' + (q[1] + dy); }
    Object.keys(sel.wires).forEach(function (k) { var ab = k.split('|').map(sh); out.wires[ab[0] < ab[1] ? ab[0] + '|' + ab[1] : ab[1] + '|' + ab[0]] = 1; });
    Object.keys(sel.grounds).forEach(function (k) { out.grounds[sh(k)] = 1; });
    Object.keys(sel.labels).forEach(function (k) { var i = k.lastIndexOf('@'); out.labels[k.slice(0, i) + '@' + sh(k.slice(i + 1))] = 1; });
    Object.keys(sel.texts).forEach(function (k) { var i = k.indexOf('|'); out.texts[sh(k.slice(0, i)) + k.slice(i)] = 1; });
    return out;
  }
  function remove(doc, sel) {
    doc.parts = doc.parts.filter(function (p) { return !sel.parts[p.name]; });
    doc.wires = doc.wires.filter(function (w) { return !sel.wires[wkey(w)]; });
    doc.grounds = doc.grounds.filter(function (g) { return !sel.grounds[key(g.at)]; });
    doc.labels = doc.labels.filter(function (l) { return !sel.labels[lkey(l)]; });
    doc.texts = (doc.texts || []).filter(function (t) { return !sel.texts[tkey(t)]; });
    return doc;
  }
  /* every point where something can connect */
  function connPoints(doc) {
    var pts = {};
    doc.parts.forEach(function (p) { p.pins.forEach(function (q) { pts[key(q)] = q; }); });
    doc.wires.forEach(function (w) { pts[key(w.a)] = w.a; pts[key(w.b)] = w.b; });
    doc.grounds.forEach(function (g) { pts[key(g.at)] = g.at; });
    doc.labels.forEach(function (l) { pts[key(l.at)] = l.at; });
    return pts;
  }
  /* split wires at T-junctions, drop zero-length and duplicate wires */
  function normalize(doc) {
    var pts = connPoints(doc), out = [], seen = {};
    doc.wires.forEach(function (w) {
      if (eq(w.a, w.b)) return;
      var cuts = [w.a, w.b];
      if (w.a[0] === w.b[0] || w.a[1] === w.b[1]) {
        Object.keys(pts).forEach(function (k) {
          var q = pts[k];
          if (eq(q, w.a) || eq(q, w.b)) return;
          if (w.a[0] === w.b[0] && q[0] === w.a[0] && q[1] > Math.min(w.a[1], w.b[1]) && q[1] < Math.max(w.a[1], w.b[1])) cuts.push(q);
          if (w.a[1] === w.b[1] && q[1] === w.a[1] && q[0] > Math.min(w.a[0], w.b[0]) && q[0] < Math.max(w.a[0], w.b[0])) cuts.push(q);
        });
      }
      cuts.sort(function (p, q) { return (p[0] - q[0]) || (p[1] - q[1]); });
      for (var i = 1; i < cuts.length; i++) {
        var s = {a: cuts[i - 1], b: cuts[i]}, k = wkey(s);
        if (eq(s.a, s.b) || seen[k]) continue;
        seen[k] = true; out.push(s);
      }
    });
    doc.wires = out;
    return doc;
  }
  /* L-shaped route from a to b */
  function route(a, b) {
    if (a[0] === b[0] || a[1] === b[1]) return [a, b];
    var hFirst = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
    return [a, hFirst ? [b[0], a[1]] : [a[0], b[1]], b];
  }
  function addPolyline(doc, pts) {
    for (var i = 1; i < pts.length; i++) if (!eq(pts[i - 1], pts[i])) doc.wires.push({a: pts[i - 1].slice(), b: pts[i].slice()});
    return doc;
  }
  /* rotate a two-pin part 90° clockwise about its middle (or pin 1 when the middle is off-grid);
     three-pin parts flip vertically, electrodes and connector pins turn their label */
  function rotate(doc, name) {
    doc.parts.forEach(function (p) {
      if (p.name !== name) return;
      if (p.pts) {
        var a = p.pts[0], b = p.pts[1], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        if (mx % 1 || my % 1) { mx = a[0]; my = a[1]; }
        p.pts = p.pts.map(function (q) { return [mx - (q[1] - my), my + (q[0] - mx)]; });
      } else if (p.type === 'U' || p.type === 'Q' || p.type === 'M') p.flag = toggle(p.flag, 'v');
      else if (p.type === 'ELEC') p.flag = cycle(SCH.elecDir(p), ['l', 'u', 'r', 'd']);
      else if (p.type === 'J') p.flag = cycle(p.flag || 'a', ['a', 'r', 'b', 'l']);
      refreshPins(p);
    });
    return doc;
  }
  function flip(doc, name) {
    doc.parts.forEach(function (p) {
      if (p.name !== name) return;
      if (p.pts) p.pts = [p.pts[1], p.pts[0]];
      else if (p.type === 'U' || p.type === 'Q' || p.type === 'M') p.flag = toggle(p.flag, 'h');
      else if (p.type === 'ELEC') p.flag = {l: 'r', r: 'l', u: 'd', d: 'u'}[SCH.elecDir(p)];
      refreshPins(p);
    });
    return doc;
  }
  function toggle(f, c) { f = f || ''; return f.indexOf(c) >= 0 ? f.replace(c, '') : f + c; }
  function cycle(v, list) { var i = list.indexOf(v); return list[(i + 1) % list.length]; }

  var DEFAULTS = {
    R: {value: 10e3}, C: {value: 100e-9}, L: {value: 1e-3}, V: {wave: 1}, I: {wave: 1e-6}, D: {}, TVS: {BV: '6'}, SW: {on: true},
    U: {GBW: '1meg'}, Q: {type: 'npn'}, M: {type: 'nmos'}, ELEC: {TYPE: 'wet'}, J: {}
  };
  /* a new part of 'type' at grid point g; vertical two-pin parts when rot is odd */
  function makePart(doc, type, g, rot, defaults) {
    var p = {type: type, name: nextName(doc, type), params: clone((defaults && defaults[type]) || DEFAULTS[type] || {}), flag: ''};
    if (CS.TYPES[type] && CS.TYPES[type].pins === 2) p.pts = [g.slice(), rot % 2 ? [g[0], g[1] + 4] : [g[0] + 4, g[1]]];
    else { p.at = g.slice(); if (type === 'ELEC') p.flag = 'l'; if (type === 'J') p.flag = 'a'; if (type === 'IC') p.sym = defaults && defaults.IC && defaults.IC.sym; }
    refreshPins(p);
    return p;
  }
  /* copy of the selection with fresh part names, shifted by (dx, dy) */
  function duplicate(doc, sel, dx, dy) {
    var src = clone({parts: doc.parts.filter(function (p) { return sel.parts[p.name]; }),
      wires: doc.wires.filter(function (w) { return sel.wires[wkey(w)]; }),
      grounds: doc.grounds.filter(function (g) { return sel.grounds[key(g.at)]; }),
      labels: doc.labels.filter(function (l) { return sel.labels[lkey(l)]; }),
      texts: (doc.texts || []).filter(function (t) { return sel.texts[tkey(t)]; })});
    return paste(doc, src, dx, dy);
  }
  function paste(doc, clip, dx, dy) {
    var c = clone(clip), nsel = emptySel(), all = emptySel();
    c.parts.forEach(function (p) {
      var base = p.type === 'ELEC' || p.type === 'J' ? p.name.replace(/\d+$/, '') : null;
      p.name = nextName(doc, p.type, base && base !== p.name ? base : null);
      doc.parts.push(p); all.parts[p.name] = 1;
    });
    c.wires.forEach(function (w) { doc.wires.push(w); all.wires[wkey(w)] = 1; });
    c.grounds.forEach(function (g) { doc.grounds.push(g); all.grounds[key(g.at)] = 1; });
    c.labels.forEach(function (l) { doc.labels.push(l); all.labels[lkey(l)] = 1; });
    c.texts.forEach(function (t) { doc.texts.push(t); all.texts[tkey(t)] = 1; });
    /* move only the pasted items */
    var tmp = {parts: c.parts, wires: c.wires, grounds: c.grounds, labels: c.labels, texts: c.texts};
    translate(tmp, all, dx, dy);
    nsel = shiftSel(all, dx, dy);
    return {doc: doc, sel: nsel};
  }
  /* items whose points all lie in a grid rectangle */
  function inRect(doc, x0, y0, x1, y1) {
    var s = emptySel(), lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    function inside(q) { return q[0] >= lx && q[0] <= hx && q[1] >= ly && q[1] <= hy; }
    doc.parts.forEach(function (p) { if ((p.at ? inside(p.at) : true) && p.pins.every(inside)) s.parts[p.name] = 1; });
    doc.wires.forEach(function (w) { if (inside(w.a) && inside(w.b)) s.wires[wkey(w)] = 1; });
    doc.grounds.forEach(function (g) { if (inside(g.at)) s.grounds[key(g.at)] = 1; });
    doc.labels.forEach(function (l) { if (inside(l.at)) s.labels[lkey(l)] = 1; });
    (doc.texts || []).forEach(function (t) { if (inside(t.at)) s.texts[tkey(t)] = 1; });
    return s;
  }

  var core = {key: key, wkey: wkey, lkey: lkey, tkey: tkey, clone: clone, translate: translate, shiftSel: shiftSel, remove: remove,
    normalize: normalize, route: route, addPolyline: addPolyline, rotate: rotate, flip: flip, makePart: makePart, nextName: nextName,
    duplicate: duplicate, paste: paste, inRect: inRect, emptySel: emptySel, connPoints: connPoints, refreshPins: refreshPins};

  /* ======================= UI ======================= */
  var TYPE_NAME = {R: '電阻', C: '電容', L: '電感', V: '電壓源', I: '電流源', D: '二極體', TVS: 'TVS 保護二極體', SW: '開關', U: '運算放大器', Q: 'BJT', M: 'MOSFET',
    ELEC: '電極', J: '接頭腳位', IC: 'IC', GND: '接地', NODE: '網路標籤', TEXT: '文字'};
  var TOOL_LABEL = {R: 'R', C: 'C', L: 'L', V: 'V 源', I: 'I 源', D: '二極體', TVS: 'TVS', SW: '開關', U: '運放', Q: 'BJT', M: 'MOS', GND: '接地', NODE: '標籤', J: '接頭', ELEC: '電極', TEXT: '文字'};
  var PARAM_KEYS = {D: ['IS', 'N', 'BV', 'CJ'], TVS: ['BV', 'CJ', 'IS'], U: ['GBW', 'A0', 'VMAX', 'VMIN', 'ROUT', 'EN', 'VOS'], SW: ['RON', 'ROFF'],
    Q: ['BF', 'IS'], M: ['KP', 'VT', 'LAMBDA']};
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }

  function CircuitEditor(root, opts) {
    var self = this;
    this.o = opts || {};
    this.root = root;
    this.tool = 'select'; this.placeType = null; this.rot = 0;
    this.sel = emptySel(); this.hist = []; this.hpos = -1; this.clip = null; this.live = null; this.liveText = null; this.msgs = [];
    var pal = this.o.palette || ['R', 'C', 'L', 'V', 'I', 'D', 'TVS', 'SW', 'U', 'GND', 'NODE', 'J', 'TEXT'];
    root.classList.add('sched');
    root.innerHTML =
      '<div class="sched-bar" role="toolbar" aria-label="電路圖工具">' +
        '<span class="sched-grp"><button type="button" class="btn sm" data-tool="select" title="選取／移動（V）">選取</button>' +
        '<button type="button" class="btn sm" data-tool="wire" title="畫導線（W）：點起點、點轉折，點到接點或按 Esc 結束">導線</button></span>' +
        '<span class="sched-grp sched-pal">' + pal.map(function (t) { return '<button type="button" class="btn sm" data-place="' + t + '" title="放置' + (TYPE_NAME[t] || t) + '">' + (TOOL_LABEL[t] || t) + '</button>'; }).join('') + '</span>' +
        '<span class="sched-grp"><button type="button" class="btn sm" data-act="rotate" title="旋轉（R）">旋轉</button>' +
        '<button type="button" class="btn sm" data-act="flip" title="鏡像／反向（F）">鏡像</button>' +
        '<button type="button" class="btn sm" data-act="dup" title="複製一份（Ctrl+D）">複製</button>' +
        '<button type="button" class="btn sm" data-act="del" title="刪除（Delete）">刪除</button></span>' +
        '<span class="sched-grp"><button type="button" class="btn sm" data-act="undo" title="復原（Ctrl+Z）" aria-label="復原">↶</button>' +
        '<button type="button" class="btn sm" data-act="redo" title="重做（Ctrl+Y）" aria-label="重做">↷</button></span>' +
        '<span class="sched-grp"><button type="button" class="btn sm" data-act="zout" aria-label="縮小">−</button>' +
        '<button type="button" class="btn sm" data-act="zin" aria-label="放大">+</button>' +
        '<button type="button" class="btn sm" data-act="fit" title="整張電路圖">全圖</button></span>' +
        '<span class="sched-grp sched-opts"><label class="inline"><input type="checkbox" data-opt="voltColor" checked> 電壓色</label>' +
        '<label class="inline"><input type="checkbox" data-opt="values" checked> 數值</label>' +
        '<label class="inline"><input type="checkbox" data-opt="currentDots"> 電流</label></span>' +
      '</div>' +
      '<div class="sched-main"><div class="sched-cv"><canvas tabindex="0" aria-label="可編輯的電路圖"></canvas></div>' +
        '<aside class="sched-insp" aria-label="元件屬性"></aside></div>' +
      '<div class="sched-status" aria-live="polite"></div>' +
      '<details class="sched-text"><summary>電路圖文字（可直接編輯）</summary><textarea spellcheck="false" aria-label="電路圖文字"></textarea>' +
        '<div class="row" style="margin-top:6px"><button type="button" class="btn sm primary" data-act="applyText">套用文字</button><span class="hint">格式見 circuit-sim/engine.js 的說明：R、C、L、V、I、D、TVS、SW、U、IC、ELEC、J、W、GND、NODE、TEXT。</span></div></details>';
    this.cv = root.querySelector('canvas');
    this.wrap = root.querySelector('.sched-cv');
    this.insp = root.querySelector('.sched-insp');
    this.status = root.querySelector('.sched-status');
    this.ta = root.querySelector('textarea');
    /* on a phone leave room above and below the canvas to scroll the page (one finger on the canvas pans it) */
    var hh = this.o.height || 560;
    if ((global.innerWidth || 1000) < 700) hh = Math.min(hh, Math.max(300, Math.round((global.innerHeight || 800) * 0.5)));
    this.wrap.style.height = hh + 'px';
    this.sch = new SCH(this.cv, {pan: true, height: hh, currentDots: false, overlay: function (ctx) { self.overlay(ctx); }});
    this.bindUI();
    this.bindPointer();
    if (this.o.text) this.setText(this.o.text, true);
    this.resize();
    this.loop();
  }

  CircuitEditor.prototype.bindUI = function () {
    var self = this, root = this.root;
    root.querySelectorAll('[data-tool]').forEach(function (b) { b.addEventListener('click', function () { self.setTool(b.dataset.tool); }); });
    root.querySelectorAll('[data-place]').forEach(function (b) { b.addEventListener('click', function () { self.setTool('place', b.dataset.place); self.cv.focus(); }); });
    root.querySelectorAll('[data-act]').forEach(function (b) { b.addEventListener('click', function () { self.act(b.dataset.act); }); });
    root.querySelectorAll('[data-opt]').forEach(function (c) { c.addEventListener('change', function () { self.sch.opts[c.dataset.opt] = c.checked; self.dirty = true; }); });
    this.cv.addEventListener('keydown', function (e) { self.key(e); });
    if (global.ResizeObserver) new global.ResizeObserver(function () { self.resize(); }).observe(this.wrap);
    else global.addEventListener('resize', function () { self.resize(); });
    this.setTool('select');
  };
  CircuitEditor.prototype.resize = function () {
    var h = this.wrap.clientHeight;
    if (h > 50) this.sch.opts.height = h;
    var bb = this.sch.bb, G = this.sch.G;
    this.sch.layout();
    if (this.userView) { this.sch.bb = bb; this.sch.G = G; } else this.sch.fit();
    this.dirty = true;
  };
  CircuitEditor.prototype.setTool = function (t, type) {
    this.finishWire(true);
    this.tool = t; this.placeType = type || null; this.ghost = null;
    this.root.querySelectorAll('[data-tool]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.tool === t ? 'true' : 'false'); });
    this.root.querySelectorAll('[data-place]').forEach(function (b) { b.setAttribute('aria-pressed', t === 'place' && b.dataset.place === type ? 'true' : 'false'); });
    this.cv.style.cursor = t === 'select' ? 'default' : 'crosshair';
    this.dirty = true;
  };

  /* ---------- document state ---------- */
  /* opt: true = start a new undo history; {silent: true} = keep history, do not call onChange */
  CircuitEditor.prototype.setText = function (text, opt) {
    if (opt === true) { this.hist = [text]; this.hpos = 0; }
    else if (text !== this.text) this.pushHist(text);
    this.load(text);
    if (opt !== true && !(opt && opt.silent) && this.o.onChange) this.o.onChange(text);
  };
  CircuitEditor.prototype.pushHist = function (text) {
    this.hist = this.hist.slice(0, this.hpos + 1);
    this.hist.push(text);
    if (this.hist.length > 120) this.hist.shift();
    this.hpos = this.hist.length - 1;
  };
  CircuitEditor.prototype.load = function (text) {
    this.text = text;
    this.doc = CS.parseDoc(text);
    this.built = CS.buildFromDoc(this.doc);
    this.sch.setDoc(this.doc, this.built);
    this.pruneSel();
    this.ta.value = text;
    this.renderInspector(); this.showStatus();
    this.dirty = true;
  };
  CircuitEditor.prototype.commit = function (doc, sel) {
    normalize(doc);
    var text = CS.docToText(doc);
    if (sel) this.sel = sel;
    if (text === this.text) { this.load(text); return; }
    this.pushHist(text);
    this.load(text);
    if (this.o.onChange) this.o.onChange(text);
  };
  CircuitEditor.prototype.work = function () { return clone(this.doc); };
  CircuitEditor.prototype.pruneSel = function () {
    var d = this.doc, s = this.sel, ok = emptySel();
    d.parts.forEach(function (p) { if (s.parts[p.name]) ok.parts[p.name] = 1; });
    d.wires.forEach(function (w) { if (s.wires[wkey(w)]) ok.wires[wkey(w)] = 1; });
    d.grounds.forEach(function (g) { if (s.grounds[key(g.at)]) ok.grounds[key(g.at)] = 1; });
    d.labels.forEach(function (l) { if (s.labels[lkey(l)]) ok.labels[lkey(l)] = 1; });
    (d.texts || []).forEach(function (t) { if (s.texts[tkey(t)]) ok.texts[tkey(t)] = 1; });
    this.sel = ok; this.syncSel();
  };
  /* selection keys -> indices for the renderer */
  CircuitEditor.prototype.syncSel = function () {
    var d = this.doc, s = this.sel, out = {parts: s.parts, wires: {}, grounds: {}, labels: {}, texts: {}};
    d.wires.forEach(function (w, i) { if (s.wires[wkey(w)]) out.wires[i] = 1; });
    d.grounds.forEach(function (g, i) { if (s.grounds[key(g.at)]) out.grounds[i] = 1; });
    d.labels.forEach(function (l, i) { if (s.labels[lkey(l)]) out.labels[i] = 1; });
    (d.texts || []).forEach(function (t, i) { if (s.texts[tkey(t)]) out.texts[i] = 1; });
    this.sch.selSet = out; this.dirty = true;
  };
  CircuitEditor.prototype.setLive = function (live, text) { this.live = live; this.liveText = text; this.dirty = true; this.renderInspector(true); };
  CircuitEditor.prototype.liveNow = function () { return this.live && this.liveText === this.text ? this.live : null; };
  CircuitEditor.prototype.setMessages = function (m) { this.msgs = m || []; this.showStatus(); };
  CircuitEditor.prototype.showStatus = function () {
    var errs = (this.built ? this.built.errors : []).filter(function (e) { return !/浮接|沒有接到電路/.test(e); });
    var items = errs.map(function (t) { return {text: t, level: 'err'}; }).concat(this.msgs);
    var tip = this.tool === 'wire' ? '導線：點起點，再點轉折點；點到元件腳或導線就會接上並結束，Esc 取消。' :
      this.tool === 'place' ? '放置' + (TYPE_NAME[this.placeType] || '') + '：點畫面放下，R 旋轉，Esc 結束。' :
      '拖拉元件移動，拖拉空白處平移，點一下電路圖後滾輪縮放（或 Ctrl＋滾輪），Shift＋拖拉框選。Delete 刪除、R 旋轉、Ctrl+Z 復原。';
    this.status.innerHTML = '<div class="hint">' + tip + '</div>' + (items.length ? '<ul class="sched-msgs">' + items.slice(0, 12).map(function (m) {
      return '<li class="' + (m.level === 'err' ? 'warn' : m.level === 'ok' ? 'okc' : '') + '">' + esc(m.text) + '</li>'; }).join('') + (items.length > 12 ? '<li>… 還有 ' + (items.length - 12) + ' 則</li>' : '') + '</ul>' : '');
  };

  /* ---------- actions ---------- */
  CircuitEditor.prototype.act = function (a) {
    var self = this, d, n = selCount(this.sel), sch = this.sch;
    if (a === 'undo' || a === 'redo') {
      var np = this.hpos + (a === 'undo' ? -1 : 1);
      if (np < 0 || np >= this.hist.length) return;
      this.hpos = np; this.load(this.hist[np]);
      if (this.o.onChange) this.o.onChange(this.text);
      return;
    }
    if (a === 'zin' || a === 'zout') { sch.zoomAt(sch.W / 2, sch.H / 2, a === 'zin' ? 1.25 : 0.8); this.userView = true; this.dirty = true; return; }
    if (a === 'fit') { sch.fit(true); this.userView = true; this.dirty = true; return; }
    if (a === 'applyText') { this.setText(this.ta.value); return; }
    if (this.tool === 'place' && (a === 'rotate' || a === 'flip')) { this.rot++; this.dirty = true; return; }
    if (!n) return;
    if (a === 'del') { this.commit(remove(this.work(), this.sel), emptySel()); return; }
    if (a === 'dup') { var r = duplicate(this.work(), this.sel, 2, 2); this.commit(r.doc, r.sel); return; }
    if (a === 'rotate' || a === 'flip') {
      d = this.work();
      Object.keys(this.sel.parts).forEach(function (nm) { (a === 'rotate' ? rotate : flip)(d, nm); });
      this.sel.labels && Object.keys(this.sel.labels).length && d.labels.forEach(function (l) { if (self.sel.labels[lkey(l)]) l.flag = cycle(l.flag || '', ['', 'a', 'l', 'b']); });
      this.commit(d);
    }
  };
  CircuitEditor.prototype.key = function (e) {
    var k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target !== this.cv) return;
    var handled = true;
    if (ctrl && (k === 'z' || k === 'Z')) this.act(e.shiftKey ? 'redo' : 'undo');
    else if (ctrl && (k === 'y' || k === 'Y')) this.act('redo');
    else if (ctrl && (k === 'd' || k === 'D')) this.act('dup');
    else if (ctrl && (k === 'c' || k === 'C')) this.copy();
    else if (ctrl && (k === 'v' || k === 'V')) this.pasteClip();
    else if (ctrl && (k === 'a' || k === 'A')) { this.sel = inRect(this.doc, -1e9, -1e9, 1e9, 1e9); this.syncSel(); this.renderInspector(); }
    else if (k === 'Delete' || k === 'Backspace') this.act('del');
    else if (k === 'Escape') {
      if (this.tool === 'wire' && this.wire) this.finishWire(false);
      else if (this.tool !== 'select') this.setTool('select');
      else { this.sel = emptySel(); this.syncSel(); this.renderInspector(); }
    }
    else if (k === 'r' || k === 'R') this.act('rotate');
    else if (k === 'f' || k === 'F') this.act('flip');
    else if (k === 'w' || k === 'W') this.setTool('wire');
    else if (k === 'v' || k === 'V') this.setTool('select');
    else if (/^Arrow/.test(k) && selCount(this.sel)) {
      var dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, dy = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
      this.commit(translate(this.work(), this.sel, dx, dy), shiftSel(this.sel, dx, dy));
    } else handled = false;
    if (handled) { e.preventDefault(); this.showStatus(); }
  };
  CircuitEditor.prototype.copy = function () {
    var s = this.sel, d = this.doc;
    this.clip = clone({parts: d.parts.filter(function (p) { return s.parts[p.name]; }), wires: d.wires.filter(function (w) { return s.wires[wkey(w)]; }),
      grounds: d.grounds.filter(function (g) { return s.grounds[key(g.at)]; }), labels: d.labels.filter(function (l) { return s.labels[lkey(l)]; }),
      texts: (d.texts || []).filter(function (t) { return s.texts[tkey(t)]; })});
    this.pasteN = 0;
  };
  CircuitEditor.prototype.pasteClip = function () {
    if (!this.clip) return;
    this.pasteN = (this.pasteN || 0) + 1;
    var r = paste(this.work(), this.clip, 2 * this.pasteN, 2 * this.pasteN);
    this.commit(r.doc, r.sel);
  };

  /* ---------- pointer ---------- */
  CircuitEditor.prototype.pos = function (e) { var r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  CircuitEditor.prototype.snap = function (xy) { var g = this.sch.toGrid(xy[0], xy[1]); return [Math.round(g[0]), Math.round(g[1])]; };
  function itemOf(hit) {
    if (hit.part) return {kind: 'parts', k: hit.part};
    return null;
  }
  CircuitEditor.prototype.hitItem = function (xy) {
    var h = this.sch.hit(xy[0], xy[1]), d = this.doc;
    if (!h) return null;
    if (h.part) return {kind: 'parts', k: h.part};
    if (h.wire !== undefined) return {kind: 'wires', k: wkey(d.wires[h.wire]), i: h.wire};
    if (h.label !== undefined) return {kind: 'labels', k: lkey(d.labels[h.label])};
    if (h.ground !== undefined) return {kind: 'grounds', k: key(d.grounds[h.ground].at)};
    if (h.text !== undefined) return {kind: 'texts', k: tkey(d.texts[h.text])};
    return itemOf(h);
  };
  CircuitEditor.prototype.bindPointer = function () {
    var self = this, cv = this.cv, ptrs = {};
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cv.addEventListener('pointerdown', function (e) {
      cv.focus();
      cv.setPointerCapture(e.pointerId);
      ptrs[e.pointerId] = self.pos(e);
      var ids = Object.keys(ptrs);
      if (ids.length === 2) {                                   // pinch
        var a = ptrs[ids[0]], b = ptrs[ids[1]];
        self.drag = {kind: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]), G0: self.sch.G, bb0: self.sch.bb, c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]};
        return;
      }
      var xy = self.pos(e), g = self.snap(xy);
      if (e.button === 2) { if (self.tool === 'wire') self.finishWire(false); else self.setTool('select'); return; }
      if (self.tool === 'wire') { self.wireClick(g); return; }
      if (self.tool === 'place') { self.place(g); return; }
      var it = self.hitItem(xy);
      if (it) {
        /* dragging an end of a selected wire moves just that end */
        if (it.kind === 'wires' && self.sel.wires[it.k]) {
          var w = self.doc.wires[it.i], pa = self.sch.px(w.a), pb = self.sch.px(w.b), G = self.sch.G;
          var ea = Math.hypot(xy[0] - pa[0], xy[1] - pa[1]) < G * 0.5, eb = Math.hypot(xy[0] - pb[0], xy[1] - pb[1]) < G * 0.5;
          if (ea || eb) { self.drag = {kind: 'wend', i: it.i, end: ea ? 'a' : 'b', g0: g, moved: false}; return; }
        }
        if (e.shiftKey) { if (self.sel[it.kind][it.k]) delete self.sel[it.kind][it.k]; else self.sel[it.kind][it.k] = 1; self.syncSel(); self.renderInspector(); return; }
        if (!self.sel[it.kind][it.k]) { self.sel = emptySel(); self.sel[it.kind][it.k] = 1; self.syncSel(); self.renderInspector(); }
        self.drag = {kind: 'move', g0: g, dx: 0, dy: 0, moved: false};
      } else if (e.shiftKey) self.drag = {kind: 'band', a: xy, b: xy};
      else self.drag = {kind: 'pan', last: xy, moved: false};
    });
    cv.addEventListener('pointermove', function (e) {
      var xy = self.pos(e);
      if (ptrs[e.pointerId]) ptrs[e.pointerId] = xy;
      self.cursor = xy; self.cursorG = self.snap(xy);
      var d = self.drag;
      if (!d) {
        if (self.tool !== 'select') self.dirty = true;
        else { var h = self.sch.hit(xy[0], xy[1]); self.sch.hoverHit = h; cv.style.cursor = h ? 'pointer' : 'default'; self.dirty = true; }
        return;
      }
      if (d.kind === 'pinch') {
        var ids = Object.keys(ptrs); if (ids.length < 2) return;
        var a = ptrs[ids[0]], b = ptrs[ids[1]], f = Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(d.d0, 1);
        self.sch.G = d.G0; self.sch.bb = d.bb0; self.sch.zoomAt(d.c[0], d.c[1], f); self.userView = true; self.dirty = true; return;
      }
      if (d.kind === 'pan') { self.sch.panBy(xy[0] - d.last[0], xy[1] - d.last[1]); if (Math.abs(xy[0] - d.last[0]) + Math.abs(xy[1] - d.last[1]) > 0) { d.moved = true; self.userView = true; } d.last = xy; self.dirty = true; return; }
      if (d.kind === 'band') { d.b = xy; self.dirty = true; return; }
      var g = self.snap(xy);
      if (d.kind === 'move') {
        var dx = g[0] - d.g0[0], dy = g[1] - d.g0[1];
        if (dx === d.dx && dy === d.dy) return;
        d.dx = dx; d.dy = dy; d.moved = d.moved || !!(dx || dy);
        d.preview = translate(self.work(), self.sel, dx, dy);
        self.sch.setDoc(d.preview, CS.buildFromDoc(d.preview));
        var keep = self.sel; self.sel = shiftSel(keep, dx, dy); var doc0 = self.doc; self.doc = d.preview; self.syncSel(); self.doc = doc0; self.sel = keep;
        self.dirty = true; return;
      }
      if (d.kind === 'wend') {
        if (eq(g, d.g0) && !d.moved) return;
        d.moved = true;
        d.preview = self.work(); d.preview.wires[d.i][d.end] = g;
        self.sch.setDoc(d.preview, CS.buildFromDoc(d.preview)); self.dirty = true;
      }
    });
    function up(e) {
      delete ptrs[e.pointerId];
      var d = self.drag; self.drag = null;
      if (!d) return;
      if (d.kind === 'move') {
        if (d.moved) self.commit(d.preview, shiftSel(self.sel, d.dx, d.dy));
        else { self.sch.setDoc(self.doc, self.built); self.syncSel(); }
      } else if (d.kind === 'wend') {
        if (d.moved) self.commit(d.preview); else self.sch.setDoc(self.doc, self.built);
      } else if (d.kind === 'band') {
        var a = self.sch.toGrid(d.a[0], d.a[1]), b = self.sch.toGrid(d.b[0], d.b[1]);
        self.sel = inRect(self.doc, a[0], a[1], b[0], b[1]); self.syncSel(); self.renderInspector();
      } else if (d.kind === 'pan' && !d.moved) { self.sel = emptySel(); self.syncSel(); self.renderInspector(); }
      self.dirty = true;
    }
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', function () { self.cursor = null; self.sch.hoverHit = null; self.dirty = true; });
    cv.addEventListener('wheel', function (e) {
      if (document.activeElement !== cv && !e.ctrlKey) return;     // until the canvas is clicked, the wheel scrolls the page
      e.preventDefault();
      var xy = self.pos(e);
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) self.sch.zoomAt(xy[0], xy[1], Math.pow(1.0015, -e.deltaY * (e.deltaMode === 1 ? 30 : 1)));
      else self.sch.panBy(-e.deltaX, 0);
      self.userView = true; self.dirty = true;
    }, {passive: false});
    cv.addEventListener('dblclick', function () {
      var f = self.insp.querySelector('input,select'); if (f) f.focus();
    });
  };

  /* wire tool: click start, click corners; a click on a connection point (not the start) finishes */
  CircuitEditor.prototype.wireClick = function (g) {
    if (!this.wire) { this.wire = {pts: [g]}; this.dirty = true; return; }
    var pts = this.wire.pts, last = pts[pts.length - 1];
    if (eq(g, last)) { this.finishWire(false); return; }
    route(last, g).slice(1).forEach(function (q) { pts.push(q); });
    if (this.isConn(g) && !eq(g, pts[0])) this.finishWire(false);
    this.dirty = true;
  };
  CircuitEditor.prototype.isConn = function (g) {
    var k = key(g);
    if (this.built.count[k]) return true;
    if (this.doc.labels.some(function (l) { return eq(l.at, g); })) return true;
    return this.doc.wires.some(function (w) {
      return (w.a[0] === w.b[0] && g[0] === w.a[0] && g[1] > Math.min(w.a[1], w.b[1]) && g[1] < Math.max(w.a[1], w.b[1])) ||
        (w.a[1] === w.b[1] && g[1] === w.a[1] && g[0] > Math.min(w.a[0], w.b[0]) && g[0] < Math.max(w.a[0], w.b[0]));
    });
  };
  CircuitEditor.prototype.finishWire = function (silent) {
    var w = this.wire; this.wire = null;
    if (!w || w.pts.length < 2) { this.dirty = true; return; }
    this.commit(addPolyline(this.work(), w.pts));
  };
  CircuitEditor.prototype.place = function (g) {
    var t = this.placeType, d = this.work(), sel = emptySel();
    if (t === 'GND') { d.grounds.push({at: g}); sel.grounds[key(g)] = 1; }
    else if (t === 'NODE') {
      var n = 1, used = {}; d.labels.forEach(function (l) { used[l.name] = 1; });
      while (used['net' + n]) n++;
      d.labels.push({name: 'net' + n, at: g, flag: ''}); sel.labels['net' + n + '@' + key(g)] = 1;
    } else if (t === 'TEXT') { var tt = {at: g, flag: '', text: '說明文字'}; d.texts.push(tt); sel.texts[tkey(tt)] = 1; }
    else {
      var p = makePart(d, t, g, this.rot, this.o.defaults);
      d.parts.push(p); sel.parts[p.name] = 1;
    }
    this.commit(d, sel);
    if (t === 'NODE' || t === 'TEXT' || t === 'ELEC' || t === 'J') {
      this.setTool('select');
      var f = this.insp.querySelector('input'); if (f) { f.focus(); f.select(); }
    }
  };

  /* ---------- drawing ---------- */
  CircuitEditor.prototype.loop = function () {
    var self = this, last = performance.now();
    function tick(now) {
      var dt = (now - last) / 1000; last = now;
      var r = self.cv.getBoundingClientRect(), vis = r.bottom > 0 && r.top < (global.innerHeight || 800) && r.width > 0;
      if (vis && (self.dirty || (self.sch.opts.currentDots && self.liveNow()))) { self.render(dt); }
      global.requestAnimationFrame(tick);
    }
    global.requestAnimationFrame(tick);
  };
  CircuitEditor.prototype.render = function (dt) {
    this.dirty = false;
    if (this.doc) this.sch.frame(this.drag && (this.drag.kind === 'move' || this.drag.kind === 'wend') ? null : this.liveNow(), dt || 0.016);
  };
  CircuitEditor.prototype.overlay = function (ctx) {
    var sch = this.sch, G = sch.G, col = sch.col, self = this;
    ctx.save();
    /* open pins (nothing connected) in wire mode, and the snap point */
    if (this.tool === 'wire') {
      ctx.fillStyle = col.sel; ctx.globalAlpha = 0.55;
      this.doc.parts.forEach(function (p) {
        p.pins.forEach(function (q) { var P = sch.px(q); ctx.fillRect(P[0] - 3, P[1] - 3, 6, 6); });
      });
      ctx.globalAlpha = 1;
    }
    if ((this.tool === 'wire' || this.tool === 'place') && this.cursorG && this.cursor) {
      var C = sch.px(this.cursorG);
      ctx.strokeStyle = col.sel; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(C[0], C[1], Math.max(4, G * 0.25), 0, 7); ctx.stroke();
    }
    if (this.wire) {
      var pts = this.wire.pts.slice(), last = pts[pts.length - 1];
      if (this.cursorG) route(last, this.cursorG).slice(1).forEach(function (q) { pts.push(q); });
      ctx.strokeStyle = col.sel; ctx.lineWidth = Math.max(1.4, G * 0.09); ctx.setLineDash([6, 4]);
      ctx.beginPath(); pts.forEach(function (q, i) { var P = sch.px(q); if (i) ctx.lineTo(P[0], P[1]); else ctx.moveTo(P[0], P[1]); }); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.tool === 'place' && this.cursorG && this.cursor) {
      var t = this.placeType;
      ctx.globalAlpha = 0.55;
      if (t === 'GND' || t === 'NODE' || t === 'TEXT') {
        var P = sch.px(this.cursorG); ctx.fillStyle = col.sel; ctx.font = sch.font(0.5, 600, true); ctx.textBaseline = 'middle';
        ctx.fillText(t === 'GND' ? '⏚' : t === 'NODE' ? 'net' : '文字', P[0] + 6, P[1]);
      } else {
        var gp = makePart(this.doc, t, this.cursorG, this.rot, this.o.defaults);
        gp.nets = gp.pins.map(function () { return ''; });
        sch.drawPart(gp, function () { return NaN; }, null, Math.max(1.2, G * 0.085));
      }
      ctx.globalAlpha = 1;
    }
    if (this.drag && this.drag.kind === 'band') {
      var a = this.drag.a, b = this.drag.b;
      ctx.strokeStyle = col.sel; ctx.fillStyle = col.sel; ctx.globalAlpha = 0.08;
      ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      ctx.globalAlpha = 1; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
      ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); ctx.setLineDash([]);
    }
    ctx.restore();
    void self;
  };

  /* ---------- inspector ---------- */
  CircuitEditor.prototype.renderInspector = function (liveOnly) {
    var box = this.insp, self = this, s = this.sel, n = selCount(s), live = this.liveNow(), fmt = CS.fmt, d = this.doc;
    if (liveOnly && this.inspFor) {             // just refresh the readouts
      box.querySelectorAll('[data-v]').forEach(function (el) { var v = live ? live.v(el.dataset.v) : NaN; el.textContent = isFinite(v) ? fmt(v, 'V', 4) : '—'; });
      var ex = box.querySelector('.sched-extra'), part = this.inspFor;
      if (ex && this.o.describe) ex.innerHTML = this.o.describe(part, live) || '';
      return;
    }
    this.inspFor = null;
    if (!n) {
      box.innerHTML = '<h3>屬性</h3><p class="hint">點元件看它的數值與接法；工具列可以放新元件、畫導線。電壓顏色是 DC 工作點（綠＝正、紅＝負）。</p>' +
        '<p class="hint"><span class="kbd">R</span> 旋轉 <span class="kbd">F</span> 鏡像 <span class="kbd">Del</span> 刪除 <span class="kbd">Ctrl+D</span> 複製 <span class="kbd">Ctrl+Z</span> 復原 <span class="kbd">W</span> 導線 <span class="kbd">Esc</span> 取消</p>';
      return;
    }
    if (n > 1) { box.innerHTML = '<h3>已選 ' + n + ' 個項目</h3><p class="hint">拖拉一起移動；Delete 刪除；Ctrl+D 複製一份。</p>'; return; }
    var html = '', bind = [];
    function field(label, id, val, hint) { html += '<label class="sched-f"><span>' + label + '</span><input type="text" data-k="' + id + '" value="' + esc(val === undefined ? '' : val) + '"></label>' + (hint ? '<div class="hint">' + hint + '</div>' : ''); }
    function vread(label, net) { html += '<div class="read"><span class="k">' + esc(label) + '</span><span class="v" data-v="' + esc(net) + '">—</span></div>'; }
    var pname = Object.keys(s.parts)[0];
    if (pname) {
      var p = d.parts.filter(function (q) { return q.name === pname; })[0];
      if (!p) return;
      this.inspFor = p;
      var pr = p.params;
      html += '<h3>' + esc(TYPE_NAME[p.type] || p.type) + (p.type === 'IC' ? ' ' + esc(CS.IC_LIB[p.sym].title) : '') + '</h3>';
      field('名稱', '@name', p.name);
      if (p.type === 'R' || p.type === 'C' || p.type === 'L') field('數值', 'value', CS.spiceNum(pr.value), '可用 k、meg、u、n、p 等字尾。');
      if (p.type === 'V' || p.type === 'I') { field('波形／直流', 'wave', typeof pr.wave === 'number' ? CS.spiceNum(pr.wave) : pr.wave, '數字＝直流；或 SIN(…)、SQUARE(…)、PULSE(…)。第一腳是 +。'); }
      if (p.type === 'SW') html += '<label class="sched-f"><span>狀態</span><select data-k="on"><option value="on"' + (pr.on !== false ? ' selected' : '') + '>導通</option><option value="off"' + (pr.on === false ? ' selected' : '') + '>打開</option></select></label>';
      if (p.type === 'ELEC') {
        var types = this.o.elecTypes || [['wet', 'wet'], ['dry', 'dry']];
        html += '<label class="sched-f"><span>電極種類</span><select data-k="TYPE">' + types.map(function (t) { return '<option value="' + t[0] + '"' + ((pr.TYPE || 'wet') === t[0] ? ' selected' : '') + '>' + esc(t[1]) + '</option>'; }).join('') + '</select></label>';
        html += '<div class="hint">名稱就是電極位置（例如 Fp1、O2、M1）：腦波模型照名稱給 alpha、眨眼、肌電的強弱。</div>';
      }
      (PARAM_KEYS[p.type] || []).forEach(function (k) { field(k, k, pr[k] !== undefined ? pr[k] : '', ''); });
      if (p.type === 'J') html += '<div class="hint">接頭腳位只是連接點，本身不是元件。</div>';
      if (p.type === 'IC') {
        var def = CS.IC_LIB[p.sym];
        html += '<div class="scroll-x"><table class="data sched-pins"><thead><tr><th>腳</th><th>#</th><th>網路</th><th>DC</th></tr></thead><tbody>' + def.pins.map(function (pd, i) {
          return '<tr><td>' + esc(pd.name) + '</td><td class="num">' + esc(pd.all || pd.num || '') + '</td><td>' + esc(p.nets[i]) + '</td><td class="num" data-v="' + esc(p.nets[i]) + '">—</td></tr>';
        }).join('') + '</tbody></table></div>' + (def.note ? '<p class="hint">' + esc(def.note) + '</p>' : '');
      } else if (p.pins.length) {
        html += '<div class="reads" style="margin-top:8px">';
        p.pins.forEach(function (q, i) { vread((p.pins.length > 1 ? '腳 ' + (i + 1) + ' ' : '') + p.nets[i], p.nets[i]); });
        html += '</div>';
      }
      html += '<div class="sched-extra"></div>';
      box.innerHTML = html;
      if (this.o.describe) box.querySelector('.sched-extra').innerHTML = this.o.describe(p, live) || '';
      box.querySelectorAll('[data-k]').forEach(function (inp) {
        inp.addEventListener('change', function () { self.editPart(p.name, inp.dataset.k, inp.value); });
      });
      this.renderInspector(true);
      return;
    }
    var wk = Object.keys(s.wires)[0], lk = Object.keys(s.labels)[0], tk = Object.keys(s.texts)[0], gk = Object.keys(s.grounds)[0];
    if (wk) {
      var w = d.wires.filter(function (x) { return wkey(x) === wk; })[0], net = w ? this.built.netAt(w.a) : '';
      html = '<h3>導線</h3><div class="reads">'; vread('網路 ' + net, net); html += '</div><p class="hint">再拖拉導線的端點可以改接點。</p>';
    } else if (lk) {
      var l = d.labels.filter(function (x) { return lkey(x) === lk; })[0];
      html = '<h3>網路標籤</h3>'; field('名稱', '@label', l.name, '同名的標籤是同一個網路；名稱 0 或 GND 等於接地。');
      html += '<label class="sched-f"><span>文字位置</span><select data-k="@lflag">' + [['', '右'], ['l', '左'], ['a', '上'], ['b', '下']].map(function (o) { return '<option value="' + o[0] + '"' + ((l.flag || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>';
      html += '<div class="reads">'; vread(l.name, l.name); html += '</div>';
    } else if (tk) {
      var t = d.texts.filter(function (x) { return tkey(x) === tk; })[0];
      html = '<h3>文字</h3>'; field('內容', '@text', t.text, '不能含 # 或 ;（會被當成註解）。');
      html += '<label class="sched-f"><span>樣式</span><select data-k="@tflag"><option value=""' + (!/h/.test(t.flag) ? ' selected' : '') + '>說明</option><option value="h"' + (/h/.test(t.flag) ? ' selected' : '') + '>標題</option></select></label>';
    } else if (gk) html = '<h3>接地</h3><p class="hint">電路的 0 V 參考點。</p>';
    box.innerHTML = html;
    box.querySelectorAll('[data-k]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var dd = self.work(), v = inp.value, ns = emptySel();
        if (inp.dataset.k === '@label' || inp.dataset.k === '@lflag') {
          dd.labels.forEach(function (x) { if (lkey(x) === lk) { if (inp.dataset.k === '@label') x.name = v.trim().replace(/\s+/g, '_') || x.name; else x.flag = v; ns.labels[lkey(x)] = 1; } });
        } else if (inp.dataset.k === '@text' || inp.dataset.k === '@tflag') {
          dd.texts.forEach(function (x) { if (tkey(x) === tk) { if (inp.dataset.k === '@text') x.text = v.replace(/[#;]/g, ''); else x.flag = v; ns.texts[tkey(x)] = 1; } });
        }
        self.commit(dd, ns);
      });
    });
    this.renderInspector(true);
  };
  CircuitEditor.prototype.editPart = function (name, k, v) {
    var d = this.work(), sel = emptySel(), err = null;
    d.parts.forEach(function (p) {
      if (p.name !== name) return;
      if (k === '@name') {
        var nn = v.trim().replace(/\s+/g, '_');
        if (!nn || d.parts.some(function (q) { return q !== p && q.name === nn; })) { err = '名稱 ' + nn + ' 已經有人用了'; nn = p.name; }
        p.name = nn;
      } else if (k === 'value') { var x = CS.num(v); if (isFinite(x) && x > 0) p.params.value = x; else err = '數值看不懂：' + v; }
      else if (k === 'wave') { var t = v.trim(); p.params.wave = /^\s*(PULSE|SIN|PWL|SQUARE)/i.test(t) ? t : CS.num(t); if (typeof p.params.wave === 'number' && !isFinite(p.params.wave)) { err = '波形看不懂：' + v; p.params.wave = 0; } }
      else if (k === 'on') p.params.on = v === 'on';
      else if (v.trim() === '') delete p.params[k];
      else p.params[k] = v.trim();
      sel.parts[p.name] = 1;
    });
    if (err) this.setMessages([{text: err, level: 'err'}].concat(this.msgs.filter(function (m) { return m.level !== 'err'; })));
    this.commit(d, sel);
  };

  CircuitEditor.core = core;
  global.CircuitEditor = CircuitEditor;
})(window);
