/* HW2 進階目標 2：breadboard layouts for every board, a connectivity check, and a BOM for any selection.

   Breadboard: columns 1..N; rows a–e (upper strip) and f–j (lower strip), each strip one net per column;
   four rails that run the whole length: T+ = V+ (9 V), T- = GND, B1 = Vm (membrane bus), B2 = X (extracellular of
   the active end; jumpered to GND when there are no passive units).
   Every part pin carries the net it must be on; HW2BB.check() traces strips, rails and jumpers and reports any pin
   that lands elsewhere, two leads in one hole, or a net split in two.

   HW2BB.modules(scheme)            board definitions ('A' | 'B')
   HW2BB.assemble(sel)              sel = {scheme, st, pu, lk, fi, so} -> {cols, parts}
   HW2BB.check(layout)              -> [] or a list of problems
   HW2BB.draw(svg, layout, opts)    render
   HW2BB.bom(sel)                   -> rows for the parts list
*/
(function(){
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var ROWS = 'abcdefghij';

  /* ---------------- part helpers (local columns, 1-based) ---------------- */
  function H(r, c){ return {r:r, c:c}; }
  function R(ref, ohm, a, b, na, nb){ return {t:'R', ref:ref, val:ohm, pins:[a, b], nets:[na, nb]}; }
  function C(ref, a, b, na, nb){ return {t:'C', ref:ref, val:1e-6, pins:[a, b], nets:[na, nb]}; }
  function D(ref, an, ca, nan, nca){ return {t:'D', ref:ref, pins:[an, ca], nets:[nan, nca]}; }
  /* TO-92 in one row, three consecutive columns: E B C (flat side toward row j) */
  function Q(ref, type, row, c, ne, nb, nc){ return {t:'Q', ref:ref, type:type, pins:[H(row, c), H(row, c + 1), H(row, c + 2)], nets:[ne, nb, nc]}; }
  function W(a, b, net){ return {t:'W', pins:[a, b], nets:[net, net], net:net}; }
  function POT(ref, ohm, row, c, n1, nw){ return {t:'POT', ref:ref, val:ohm, pins:[H(row, c), H(row, c + 1), H(row, c + 2)], nets:[n1, nw, null]}; }
  function SW(ref, a, b, na, nb){ return {t:'SW', ref:ref, pins:[a, b], nets:[na, nb]}; }

  /* ---------------- boards ---------------- */
  /* Stimulator: V+ -SW- P -pot- K -6.8k- Q;  Q_sense E=P B=Q C=R;  Q_pass E=Q B=R C=Cn;  R -6.8k- GND;  Cn -1N4148- OUT */
  function ST(){
    return {name:'ST', title:'Stimulator', cols:17, out:H('g', 16), outRail:H('j', 16), parts:[
      W(H('a', 2), H('T+', 2), 'V+'),
      SW('SW', H('b', 2), H('b', 5), 'V+', 'ST.P'),
      POT('VR', 100e3, 'c', 5, 'ST.P', 'ST.K'),
      W(H('d', 5), H('d', 9), 'ST.P'),
      R('R7a', 6.8e3, H('e', 6), H('e', 10), 'ST.K', 'ST.Q'),
      Q('Q_sense', '2N4403', 'b', 9, 'ST.P', 'ST.Q', 'ST.R'),
      W(H('d', 10), H('g', 10), 'ST.Q'),
      W(H('d', 11), H('g', 11), 'ST.R'),
      Q('Q_pass', '2N4403', 'h', 10, 'ST.Q', 'ST.R', 'ST.C'),
      R('R7b', 6.8e3, H('c', 11), H('T-', 15), 'ST.R', 'GND'),
      D('D_out', H('i', 12), H('i', 16), 'ST.C', 'ST.OUT')
    ]};
  }
  /* Leak: 1 µF ∥ 100 kΩ from Vm to X */
  function LK(i){
    var p = 'LK' + i;
    return {name:p, title:'Leak ' + i, cols:6, parts:[
      W(H('j', 1), H('B1', 1), 'Vm'),
      W(H('j', 5), H('B2', 5), 'X'),
      R(p + '.R', 100e3, H('g', 1), H('g', 5), 'Vm', 'X'),
      C(p + '.C', H('h', 1), H('h', 5), 'Vm', 'X')
    ]};
  }
  /* 方案 B: bias V+ -> Vm (rest 1.19 V) */
  function BIAS(){
    return {name:'BIAS', title:'偏壓', cols:4, parts:[
      W(H('j', 1), H('B1', 1), 'Vm'),
      W(H('f', 1), H('e', 1), 'Vm'),
      R('Rb', 390e3, H('a', 1), H('T+', 4), 'Vm', 'V+')
    ]};
  }
  /* Fast inward: Vm -D1- B3;  B3 -3M- X;  3904 E=E3 B=B3 C=B4;  E3 -100k- X;  4403 E=E4 B=B4 C=Vm;  E4 -R13- V+ */
  function FI(scheme){
    var b = scheme === 'B', parts = [
      W(H('j', 1), H('B2', 1), 'X'),
      Q('FI.Q1', '2N3904', 'f', 5, 'FI.E3', 'FI.B3', 'FI.B4'),
      R('FI.Rfe', 100e3, H('g', 1), H('g', 5), 'X', 'FI.E3'),
      R('FI.R3M', 3e6, H('i', 1), H('i', 6), 'X', 'FI.B3'),
      W(H('e', 9), H('f', 9), 'Vm'),
      W(H('j', 9), H('B1', 9), 'Vm'),
      D('FI.D1', H('h', 9), H('h', 6), 'Vm', 'FI.B3'),
      Q('FI.Q2', '2N4403', 'd', 7, 'FI.E4', 'FI.B4', 'Vm'),
      W(H('g', 7), H('e', 8), 'FI.B4'),
      R('FI.R13', b ? 2.2e3 : 1e3, H('a', 7), H('T+', 11), 'FI.E4', 'V+')
    ];
    if(b) parts.push(W(H('h', 5), H('e', 5), 'FI.E3'), R('FI.Rf', 680e3, H('a', 5), H('T+', 1), 'FI.E3', 'V+'));
    return {name:'FI', title:'Fast inward', cols:12, parts:parts};
  }
  /* Slow out: Vm -100k- S;  S -1µF- X;  S -D1- B3;  B3 -1M- X;  3904 E=X B=B3 C=B4;  4403 E=Vm B=B4 C=C4;  C4 -1k- X */
  function SO(scheme){
    var parts = [
      W(H('j', 1), H('B2', 1), 'X'),
      Q('SO.Q1', '2N3904', 'f', 1, 'X', 'SO.B3', 'SO.B4'),
      Q('SO.Q2', '2N4403', 'd', 3, 'Vm', 'SO.B4', 'SO.C4'),
      W(H('g', 3), H('e', 4), 'SO.B4'),
      W(H('b', 3), H('B1', 3), 'Vm'),
      R('SO.R1k', 1e3, H('e', 5), H('g', 5), 'SO.C4', 'X'),
      W(H('j', 5), H('B2', 5), 'X'),
      W(H('j', 13), H('B1', 13), 'Vm'),
      R('SO.R1', 100e3, H('i', 13), H('i', 9), 'Vm', 'SO.S'),
      C('SO.C1', H('h', 9), H('h', 5), 'SO.S', 'X'),
      D('SO.D1', H('g', 9), H('g', 2), 'SO.S', 'SO.B3'),
      R('SO.R2', 1e6, H('i', 2), H('i', 5), 'SO.B3', 'X')
    ];
    if(scheme === 'B') parts.push(R('SO.Rs', 56e3, H('f', 9), H('f', 5), 'SO.S', 'X'));
    return {name:'SO', title:'Slow out', cols:14, parts:parts};
  }
  /* passive chain of n units: PC_k on the upper strip, PX_k on the lower strip, 4 columns apart */
  function PU(n, scheme){
    var parts = [], k, c;
    for(k = 1; k <= n; k++){
      c = 1 + (k - 1) * 4;
      var pc = 'PC' + k, px = k === 1 ? 'GND' : 'PX' + k, npc = k < n ? 'PC' + (k + 1) : 'Vm', npx = k < n ? 'PX' + (k + 1) : 'X';
      parts.push(C('U' + k + '.C', H('e', c), H('f', c), pc, px),
                 R('U' + k + '.R', 100e3, H('d', c), H('g', c), pc, px),
                 R('U' + k + '.Ri', 10e3, H('b', c), H('c', c + 4), pc, npc),     /* lands one row lower than the next unit's own */
                 R('U' + k + '.Ro', 100, H('i', c), H('h', c + 4), px, npx));
      if(scheme === 'B') parts.push(R('U' + k + '.Ru', 680e3, H('a', c), H('T+', c + 2), pc, 'V+'));
    }
    c = 1 + n * 4;
    parts.push(W(H('j', 1), H('T-', 1), 'GND'),                 /* PX1 is the ground end */
               W(H('a', c), H('B1', c), 'Vm'),                    /* chain end -> membrane bus */
               W(H('j', c), H('B2', c), 'X'));
    return {name:'PU', title:n + ' 個 Passive unit', cols:c + 1, parts:parts};
  }
  function modules(scheme){ return {ST:ST(), LK:LK(1), BIAS:BIAS(), FI:FI(scheme), SO:SO(scheme), PU:PU(1, scheme)}; }

  /* ---------------- assembly ---------------- */
  function shift(p, dc){
    var q = Object.assign({}, p);
    q.pins = p.pins.map(function(h){ return {r:h.r, c:h.c + dc}; });
    return q;
  }
  function assemble(sel){
    var mods = [], at = 1, parts = [], spans = [];
    if(sel.st) mods.push(ST());
    /* 方案 B's bias (V+ -> Vm, V+ -> each unit) only matters with an active membrane */
    var biased = sel.scheme === 'B' && (sel.fi || sel.so);
    if(sel.pu) mods.push(PU(sel.pu, biased ? 'B' : 'A'));
    if(biased && !sel.lk) mods.push(BIAS());
    for(var i = 1; i <= (sel.lk || 0); i++){
      var lk = LK(i);
      if(biased && i === 1){                         /* the 390 kΩ fits in Leak 1's free upper strip */
        lk.title = 'Leak 1＋偏壓';
        lk.parts.push(W(H('f', 1), H('e', 1), 'Vm'), R('Rb', 390e3, H('a', 1), H('T+', 4), 'Vm', 'V+'));
      }
      mods.push(lk);
    }
    if(sel.fi) mods.push(FI(sel.scheme));
    if(sel.so) mods.push(SO(sel.scheme));
    var stAt = null, puAt = null;
    mods.forEach(function(m){
      if(m.name === 'ST') stAt = at;
      if(m.name === 'PU') puAt = at;
      m.parts.forEach(function(p){ parts.push(shift(p, at - 1)); });
      spans.push({name:m.name, title:m.title, c0:at, c1:at + m.cols - 1});
      at += m.cols + 1;
    });
    var cols = at - 1;
    /* Stimulator output: onto the membrane bus, or into the first passive unit */
    if(stAt !== null){
      if(puAt !== null) parts.push(W(H('g', stAt + 15), H('c', puAt), 'ST.OUT'));
      else parts.push(W(H('j', stAt + 15), H('B1', stAt + 15), 'ST.OUT'));
    }
    /* no passive units: the extracellular rail is ground */
    if(!sel.pu && mods.length) parts.push(W(H('B2', cols), H('T-', cols), 'X'));
    /* the Stimulator output is the node it plugs into */
    return {cols:Math.max(cols, 8), parts:parts, spans:spans, sel:sel, alias:{'ST.OUT':puAt !== null ? 'PC1' : 'Vm'}};
  }

  /* ---------------- connectivity check ---------------- */
  function key(h){
    if(h.r.length > 1) return h.r;                                 /* rail */
    return (ROWS.indexOf(h.r) < 5 ? 'U' : 'L') + h.c;
  }
  var RAILNET = {'T+':'V+', 'T-':'GND', 'B1':'Vm', 'B2':'X'};
  function check(lay){
    var par = {}, errs = [], holes = {}, alias = lay.alias || {};
    function find(x){ while(par[x] !== undefined && par[x] !== x) x = par[x]; return x; }
    function uni(a, b){ a = find(a); b = find(b); if(a !== b) par[a] = b; }
    function touch(k){ if(par[k] === undefined) par[k] = k; }
    lay.parts.forEach(function(p){
      p.pins.forEach(function(h){
        var hk = h.r + h.c;
        if(h.c < 1 || h.c > lay.cols) errs.push(p.ref + '：腳位超出麵包板（' + hk + '）');
        if(holes[hk]) errs.push(hk + ' 插了兩支腳（' + holes[hk] + '、' + (p.ref || '跳線') + '）');
        holes[hk] = p.ref || '跳線';
        touch(key(h));
      });
      if(p.t === 'W') uni(key(p.pins[0]), key(p.pins[1]));
    });
    /* each rail is its own net; when X is jumpered to GND they merge, which is intended */
    var netOf = {}, groupOf = {};
    Object.keys(RAILNET).forEach(function(r){ touch(r); });
    function claim(g, net, who){
      if(netOf[g] && netOf[g] !== net && !(isGnd(netOf[g]) && isGnd(net))) errs.push(who + ' 應在 ' + net + '，卻接到 ' + netOf[g]);
      else if(!netOf[g]) netOf[g] = net;
    }
    function isGnd(n){ return n === 'GND' || (n === 'X' && !lay.sel.pu); }
    Object.keys(RAILNET).forEach(function(r){ claim(find(r), RAILNET[r], '軌 ' + r); });
    lay.parts.forEach(function(p){
      p.pins.forEach(function(h, i){
        var net = alias[p.nets[i]] || p.nets[i]; if(!net) return;
        claim(find(key(h)), net, (p.ref || '跳線') + ' 第 ' + (i + 1) + ' 腳（' + h.r + h.c + '）');
      });
    });
    lay.parts.forEach(function(p){
      p.pins.forEach(function(h, i){
        var net = alias[p.nets[i]] || p.nets[i]; if(!net) return;
        var g = find(key(h)), n2 = isGnd(net) ? 'GND' : net;
        if(groupOf[n2] && groupOf[n2] !== g) errs.push(net + ' 分成了兩塊（' + (p.ref || '跳線') + ' ' + h.r + h.c + '）');
        groupOf[n2] = g;
      });
    });
    return errs.filter(function(e, i, a){ return a.indexOf(e) === i; });
  }

  /* ---------------- drawing ---------------- */
  var P = 13, X0 = 74;
  var Y = {'T+':18, 'T-':31, a:72, b:85, c:98, d:111, e:124, f:154, g:167, h:180, i:193, j:206, 'B1':236, 'B2':249};
  function hx(h){ return X0 + (h.c - 1) * P; }
  function hy(h){ return Y[h.r]; }
  var BAND = ['#000', '#7a4a1f', '#d0312d', '#f28c28', '#f2d024', '#2e9a48', '#2b6cb0', '#7e57c2', '#8d8d8d', '#fff'];
  function bands(ohm){
    var e = Math.floor(Math.log10(ohm) + 1e-9), d = Math.round(ohm / Math.pow(10, e - 1));
    if(d >= 100){ d = Math.round(d / 10); e += 1; }
    return [BAND[Math.floor(d / 10)], BAND[d % 10], BAND[e - 1]];
  }
  function fmtR(o){ return o >= 1e6 ? +(o / 1e6).toPrecision(3) + 'M' : o >= 1e3 ? +(o / 1e3).toPrecision(3) + 'k' : o + 'Ω'; }
  var NETCOL = {'V+':'#d7263d', 'GND':'#222', 'Vm':'#f28c28', 'X':'#2b6cb0', 'ST.OUT':'#f28c28'};
  function wireCol(net){ return NETCOL[net] || '#2e8b57'; }
  function el(tag, attr, parent){
    var e = document.createElementNS(NS, tag);
    for(var k in attr) e.setAttribute(k, attr[k]);
    if(parent) parent.appendChild(e);
    return e;
  }
  function tip(g, s){ var t = el('title', {}, g); t.textContent = s; }

  function draw(svg, lay, opts){
    opts = opts || {};
    var W = X0 + lay.cols * P + 18, H0 = 264;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H0);
    svg.innerHTML = '';
    var g = el('g', {}, svg);
    /* board */
    el('rect', {x:6, y:4, width:W - 12, height:H0 - 8, rx:8, fill:'#f3efe6', stroke:'#cfc7b6'}, g);
    el('rect', {x:X0 - 10, y:135, width:lay.cols * P + 7, height:8, rx:2, fill:'#e3dccd'}, g);
    /* module spans */
    (lay.spans || []).forEach(function(s){
      var x0 = hx({c:s.c0}) - 6, x1 = hx({c:s.c1}) + 6;
      el('rect', {x:x0, y:56, width:x1 - x0, height:160, rx:5, fill:'none', stroke:'#b9ad95', 'stroke-dasharray':'4 3'}, g);
      var t = el('text', {x:(x0 + x1) / 2, y:52, 'text-anchor':'middle', class:'bb-mod'}, g); t.textContent = s.title;
    });
    /* rails */
    [['T+', '#d7263d', '+9V'], ['T-', '#2b2b2b', 'GND'], ['B1', '#f28c28', 'Vm'], ['B2', '#2b6cb0', 'X']].forEach(function(r){
      var y = Y[r[0]];
      el('line', {x1:X0 - 10, y1:y + (r[0] === 'T+' || r[0] === 'B1' ? -6 : 6), x2:X0 + lay.cols * P - 3, y2:y + (r[0] === 'T+' || r[0] === 'B1' ? -6 : 6), stroke:r[1], 'stroke-width':1.6}, g);
      var t = el('text', {x:X0 - 14, y:y + 3.5, 'text-anchor':'end', class:'bb-rail', fill:r[1]}, g); t.textContent = r[2];
    });
    /* holes */
    var hg = el('g', {fill:'#8f8676'}, g);
    for(var c = 1; c <= lay.cols; c++){
      ['T+', 'T-', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'B1', 'B2'].forEach(function(r){
        el('rect', {x:hx({c:c}) - 2, y:Y[r] - 2, width:4, height:4, rx:0.8}, hg);
      });
      if(c === 1 || c % 5 === 0){ var t = el('text', {x:hx({c:c}), y:64, 'text-anchor':'middle', class:'bb-num'}, g); t.textContent = c; }
    }
    ['a', 'e', 'f', 'j'].forEach(function(r){ var t = el('text', {x:X0 - 14, y:Y[r] + 3, 'text-anchor':'end', class:'bb-num'}, g); t.textContent = r; });
    /* wires under parts */
    lay.parts.filter(function(p){ return p.t === 'W'; }).forEach(function(p){
      var a = p.pins[0], b = p.pins[1], x1 = hx(a), y1 = hy(a), x2 = hx(b), y2 = hy(b), col = wireCol(p.net);
      var mid = Math.abs(x1 - x2) < 2 ? '' : ' Q ' + ((x1 + x2) / 2) + ' ' + (Math.min(y1, y2) - 10);
      var w = el('path', {d:'M' + x1 + ' ' + y1 + (mid || ' L') + ' ' + x2 + ' ' + y2, fill:'none', stroke:col, 'stroke-width':3.2, 'stroke-linecap':'round', class:'bb-w'}, g);
      if(mid) w.setAttribute('d', 'M' + x1 + ' ' + y1 + ' Q ' + ((x1 + x2) / 2) + ' ' + (Math.min(y1, y2) - 10) + ' ' + x2 + ' ' + y2);
      tip(w, '跳線：' + a.r + a.c + ' → ' + b.r + b.c + '（' + p.net + '）');
      el('circle', {cx:x1, cy:y1, r:2.6, fill:col}, g); el('circle', {cx:x2, cy:y2, r:2.6, fill:col}, g);
    });
    lay.parts.filter(function(p){ return p.t !== 'W'; }).forEach(function(p){ drawPart(g, p); });
    /* battery and probes */
    var bx = 22;
    el('rect', {x:bx - 10, y:8, width:20, height:30, rx:3, fill:'#333'}, g);
    var bt = el('text', {x:bx, y:27, 'text-anchor':'middle', class:'bb-bat'}, g); bt.textContent = '9V';
    el('path', {d:'M' + (bx + 4) + ' 12 Q ' + (X0 - 14) + ' 6 ' + hx({c:1}) + ' ' + Y['T+'], stroke:'#d7263d', 'stroke-width':2.4, fill:'none'}, g);
    el('path', {d:'M' + (bx + 4) + ' 34 Q ' + (X0 - 14) + ' 36 ' + hx({c:1}) + ' ' + Y['T-'], stroke:'#222', 'stroke-width':2.4, fill:'none'}, g);
    if(opts.probes !== false && (lay.sel ? (lay.sel.lk || lay.sel.fi || lay.sel.so || lay.sel.pu) : true)){
      var pc = lay.cols - 1;
      probe(g, hx({c:pc}), Y['B1'], 'CH1');
      if(lay.sel && lay.sel.pu) probe(g, hx({c:pc - 3}), Y['B2'], 'CH2');
    }
  }
  function probe(g, x, y, s){
    el('path', {d:'M' + x + ' ' + y + ' l 0 12', stroke:'#555', 'stroke-width':1.5}, g);
    el('circle', {cx:x, cy:y, r:4, fill:'none', stroke:'#555', 'stroke-width':1.5}, g);
    var t = el('text', {x:x + 6, y:y + 14, class:'bb-probe'}, g); t.textContent = s;
  }
  function drawPart(g, p){
    var a = p.pins[0], b = p.pins[p.pins.length - 1], x1 = hx(a), y1 = hy(a), x2 = hx(b), y2 = hy(b);
    var gg = el('g', {class:'bb-part'}, g), mx = (x1 + x2) / 2, my = (y1 + y2) / 2, ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
    var name = {R:'電阻', C:'電容', D:'二極體', Q:'電晶體', POT:'可變電阻', SW:'按鈕'}[p.t];
    tip(gg, p.ref + '　' + name + (p.val ? ' ' + (p.t === 'C' ? '1 µF' : fmtR(p.val)) : '') + (p.type ? ' ' + p.type : '') + '\n' +
      p.pins.map(function(h, i){ return (p.t === 'Q' ? 'EBC'[i] : (i + 1)) + '：' + h.r + h.c + (p.nets[i] ? '（' + p.nets[i] + '）' : '（不接）'); }).join('\n'));
    if(p.t === 'R' || p.t === 'C' || p.t === 'D' || p.t === 'SW'){
      el('line', {x1:x1, y1:y1, x2:x2, y2:y2, stroke:'#9a9a9a', 'stroke-width':1.4}, gg);
      [a, b].forEach(function(h){ el('circle', {cx:hx(h), cy:hy(h), r:2, fill:'#777'}, gg); });
      var body = el('g', {transform:'translate(' + mx + ',' + my + ') rotate(' + ang + ')'}, gg);
      if(p.t === 'R'){
        el('rect', {x:-11, y:-4.2, width:22, height:8.4, rx:3.5, fill:'#e9d5a8', stroke:'#b49b6b', 'stroke-width':0.8}, body);
        bands(p.val).forEach(function(col, i){ el('rect', {x:-7 + i * 4, y:-4.2, width:2.2, height:8.4, fill:col}, body); });
        el('rect', {x:7, y:-4.2, width:2, height:8.4, fill:'#c9a227'}, body);
      } else if(p.t === 'C'){
        el('rect', {x:-6, y:-5, width:12, height:10, rx:4, fill:'#3b82c4', stroke:'#255e92', 'stroke-width':0.8}, body);
        var ct = el('text', {x:0, y:2.6, 'text-anchor':'middle', class:'bb-ctext', transform:'rotate(' + (-ang) + ')'}, body); ct.textContent = '105';
      } else if(p.t === 'D'){
        el('rect', {x:-8, y:-3.4, width:16, height:6.8, rx:2.5, fill:'#d9744a', stroke:'#a54e2c', 'stroke-width':0.8}, body);
        el('rect', {x:4.2, y:-3.4, width:2.6, height:6.8, fill:'#1d1d1d'}, body);    /* cathode band, toward pin 2 */
      } else {
        el('rect', {x:-7, y:-7, width:14, height:14, rx:2, fill:'#444'}, body);
        el('circle', {cx:0, cy:0, r:4, fill:'#c33'}, body);
      }
      var lx = mx, ly = p.t === 'C' ? my + 13 : my - 8, anc = 'middle';
      if(Math.abs(ang) > 45 && Math.abs(ang) < 135){ lx = mx + 9; ly = my + 3; anc = 'start'; }
      var onRail = a.r.length > 1 ? b : b.r.length > 1 ? a : null;   /* leads to a rail: label beside the strip end */
      if(onRail){ lx = hx(onRail) + 6; ly = hy(onRail) - 7; anc = 'start'; }
      var lt = el('text', {x:lx, y:ly, 'text-anchor':anc, class:'bb-lab'}, gg);
      lt.textContent = p.t === 'R' ? fmtR(p.val) : p.t === 'C' ? '1µF' : p.t === 'D' ? '1N4148' : 'SW';
    } else if(p.t === 'Q'){
      var xs = p.pins.map(hx), y = hy(a);
      p.pins.forEach(function(h){ el('circle', {cx:hx(h), cy:hy(h), r:2, fill:'#777'}, gg); });
      el('path', {d:'M ' + (xs[0] - 5) + ' ' + (y - 2) + ' L ' + (xs[2] + 5) + ' ' + (y - 2) + ' A ' + ((xs[2] - xs[0]) / 2 + 5) + ' 11 0 0 0 ' + (xs[0] - 5) + ' ' + (y - 2) + ' Z',
        fill:p.type === '2N3904' ? '#2b2b2b' : '#3a3a3a', stroke:'#111', 'stroke-width':0.8}, gg);
      var qt = el('text', {x:xs[1], y:y - 6, 'text-anchor':'middle', class:'bb-q'}, gg); qt.textContent = p.type.slice(2);
      ['E', 'B', 'C'].forEach(function(s, i){ var t = el('text', {x:xs[i], y:y + 10, 'text-anchor':'middle', class:'bb-pin'}, gg); t.textContent = s; });
    } else if(p.t === 'POT'){
      var px = p.pins.map(hx), py = hy(a);
      p.pins.forEach(function(h, i){ el('circle', {cx:hx(h), cy:hy(h), r:2, fill:i === 2 ? '#bbb' : '#777'}, gg); });
      el('rect', {x:px[0] - 6, y:py - 15, width:px[2] - px[0] + 12, height:12, rx:2, fill:'#2f5fa8', stroke:'#1e3f72', 'stroke-width':0.8}, gg);
      el('circle', {cx:px[2] + 2, cy:py - 9, r:2.4, fill:'#e8d38a'}, gg);
      var pt = el('text', {x:px[1], y:py - 18, 'text-anchor':'middle', class:'bb-lab'}, gg); pt.textContent = fmtR(p.val) + ' 可變';
      var nc = el('text', {x:px[2], y:py + 10, 'text-anchor':'middle', class:'bb-pin'}, gg); nc.textContent = '空';
    }
  }

  /* ---------------- BOM ---------------- */
  var NOTE = {
    'R:6800':'電路圖 7 kΩ，E12 最近 6.8 kΩ（電流約大 3 %）',
    'R:3000000':'E24 有 3.0 MΩ；買不到用 3.3 MΩ',
    'R:1000000':'助教指定值（電路圖 3 MΩ）；按住才會連續發放',
    'R:2200':'方案 B：電路圖 1 kΩ 改 2.2 kΩ，避免 FI 和 SO 互鎖',
    'POT:100000':'3 腳、0.1" 腳距的微調型（例如 3296W-104）；電流約 11–100 µA',
    'D:':'玻璃管，色環那端是陰極（K）',
    'C:':'無極性（陶瓷 MLCC 105 或薄膜），不要用電解',
    'Q:2N4403':'PNP，平面朝下時腳位左到右 E B C',
    'Q:2N3904':'NPN，平面朝下時腳位左到右 E B C',
    'SW:':'常開按鈕，2 腳（4 腳的 6×6 mm 按鈕也可，用對角兩腳）'
  };
  function bom(sel){
    var lay = assemble(sel), rows = {}, wires = 0;
    lay.parts.forEach(function(p){
      if(p.t === 'W'){ wires++; return; }
      var spec = p.t === 'R' ? fmtR(p.val).replace('k', ' kΩ').replace('M', ' MΩ').replace(/(\d)Ω/, '$1 Ω') : p.t === 'C' ? '1 µF' : p.t === 'D' ? '1N4148' : p.t === 'Q' ? p.type : p.t === 'POT' ? fmtR(p.val).replace('k', ' kΩ') : '按鈕';
      var k = p.t + ':' + (p.val || p.type || '');
      if(!rows[k]) rows[k] = {t:p.t, spec:spec, n:0, refs:[], note:NOTE[k] || NOTE[p.t + ':'] || NOTE[p.t + ':' + (p.type || '')] || '', sort:p.t + (p.val ? String(1e12 + p.val) : p.type)};
      rows[k].n++; rows[k].refs.push(p.ref);
    });
    var order = {Q:0, D:1, R:2, C:3, POT:4, SW:5}, kind = {R:'電阻 1/4 W', C:'電容', D:'二極體', Q:'電晶體', POT:'可變電阻', SW:'開關'};
    var list = Object.keys(rows).map(function(k){ var r = rows[k]; r.kind = kind[r.t]; return r; })
      .sort(function(a, b){ return order[a.t] - order[b.t] || (a.sort < b.sort ? -1 : 1); });
    var boards = Math.ceil(lay.cols / 63);
    list.push({kind:'麵包板', spec:'830 孔（63 列）', n:boards, refs:[lay.cols + ' 列'], note:boards > 1 ? '超過 63 列：兩塊並排，四條軌各用一條跳線接起來' : ''},
              {kind:'跳線', spec:'公對公／單芯線', n:wires + (boards > 1 ? 4 : 0), refs:[], note:'顏色照圖：紅 V+、黑 GND、橘 Vm、藍 X'},
              {kind:'電池', spec:'9 V＋扣式電池線', n:1, refs:[], note:''});
    return {rows:list, cols:lay.cols, layout:lay};
  }

  window.HW2BB = {modules:modules, assemble:assemble, check:check, draw:draw, bom:bom, fmtR:fmtR};

  /* ---------------- the page's selector, drawing and BOM (#rb) ---------------- */
  var root = document.getElementById('bbCtl');
  if(!root) return;
  var $ = function(q){ return document.querySelector(q); }, $$ = function(q){ return Array.prototype.slice.call(document.querySelectorAll(q)); };
  function esc(t){ return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function sel(){
    var o = {scheme:($('input[name="bbScheme"]:checked') || {}).value || 'B'};
    $$('[data-bb]').forEach(function(i){ var v = Math.max(+i.min, Math.min(+i.max, Math.round(+i.value || 0))); i.value = v; o[i.dataset.bb] = v; });
    return o;
  }
  var last = null;
  function render(){
    var s0 = sel(), out = bom(s0), lay = out.layout, errs = check(lay);
    draw($('#bbAsm'), lay);
    $('#bbAsm').style.width = Math.max(100, lay.cols / 63 * 100) + '%';
    $('#bbAsm').style.minWidth = (X0 + lay.cols * P + 18) + 'px';   /* 1:1 at least; narrow screens scroll sideways */
    var boards = Math.ceil(lay.cols / 63);
    $('#bbStatus').innerHTML = (errs.length ? '<span class="bb-err">接線檢查發現 ' + errs.length + ' 個問題：' + esc(errs.slice(0, 3).join('；')) + '</span>'
      : '<span class="bb-ok">✓ 接線檢查通過</span>：每支腳都在該在的節點（從麵包板的列、軌、跳線推出來的）') +
      '　共 ' + lay.cols + ' 列，' + (boards > 1 ? boards + ' 塊 830 孔麵包板（圖可左右捲動）' : '一塊 830 孔麵包板') + '。';
    $('#bbBom').innerHTML = '<tr><th>零件</th><th>規格</th><th class="num">數量</th><th>位置</th><th>備註</th></tr>' + out.rows.map(function(r){
      return '<tr><td>' + esc(r.kind) + '</td><td>' + esc(r.spec) + '</td><td class="num">' + r.n + '</td><td class="refs">' + esc(r.refs.join(' ')) + '</td><td class="small">' + esc(r.note) + '</td></tr>';
    }).join('');
    last = out;
    $$('[data-bbp]').forEach(function(b){
      var v = b.dataset.bbp.split(',').map(Number);
      b.setAttribute('aria-pressed', v[0] === s0.st && v[1] === s0.pu && v[2] === s0.lk && v[3] === s0.fi && v[4] === s0.so ? 'true' : 'false');
    });
    mods(s0.scheme);
  }
  /* one board at a time, on its own short breadboard */
  var modsFor = null;
  function mods(scheme){
    if(modsFor === scheme) return;
    modsFor = scheme;
    var box = $('#bbMods'), list = [
      ['Stimulator（ST）', {st:1}], ['Passive unit × 2（#2-3 一個接一個）', {pu:2}], ['Leak（LK）', {lk:1}],
      ['Fast inward（FI）' + (scheme === 'B' ? '：R13 2.2 kΩ＋680 kΩ' : '：R13 1 kΩ'), {fi:1}],
      ['Slow out（SO）' + (scheme === 'B' ? '：C1 並 56 kΩ' : ''), {so:1}]];
    if(scheme === 'B') list.push(['方案 B 的偏壓：390 kΩ V+ → Vm（和 FI 或 SO 一起用）', {fi:1, onlyBias:true}]);
    box.innerHTML = '';
    list.forEach(function(it){
      var f = document.createElement('figure'), svg = document.createElementNS(NS, 'svg'), cap = document.createElement('figcaption');
      var sel1 = Object.assign({scheme:scheme, st:0, pu:0, lk:0, fi:0, so:0}, it[1]);
      var lay = assemble(sel1);
      if(it[1].onlyBias){ var m = BIAS(); lay = {cols:m.cols + 1, parts:m.parts, spans:[{name:'BIAS', title:m.title, c0:1, c1:m.cols}], sel:{scheme:'B', fi:1}}; }
      draw(svg, lay, {probes:false});
      cap.textContent = it[0];
      f.appendChild(cap); f.appendChild(svg); box.appendChild(f);
    });
  }
  root.addEventListener('input', render);
  root.addEventListener('change', render);
  $$('[data-bbp]').forEach(function(b){
    b.addEventListener('click', function(){
      var v = b.dataset.bbp.split(','), keys = ['st', 'pu', 'lk', 'fi', 'so'];
      keys.forEach(function(k, i){ $('[data-bb="' + k + '"]').value = v[i]; });
      render();
    });
  });
  $('#bbCopy').addEventListener('click', function(){
    if(!last) return;
    var s0 = sel(), head = '方案 ' + s0.scheme + '：ST ' + s0.st + '、Passive unit ' + s0.pu + '、LK ' + s0.lk + '、FI ' + s0.fi + '、SO ' + s0.so;
    var NL = String.fromCharCode(10), TAB = String.fromCharCode(9);
    var tsv = head + NL + ['零件', '規格', '數量', '位置', '備註'].join(TAB) + NL +
      last.rows.map(function(r){ return [r.kind, r.spec, r.n, r.refs.join(' '), r.note].join(TAB); }).join(NL);
    var b = $('#bbCopy');
    (navigator.clipboard ? navigator.clipboard.writeText(tsv) : Promise.reject()).then(function(){ b.textContent = '已複製'; }, function(){ b.textContent = '複製失敗'; });
    setTimeout(function(){ b.textContent = '複製成表格'; }, 1500);
  });
  render();
})();
