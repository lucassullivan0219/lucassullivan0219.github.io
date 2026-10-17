/* HW2 進階目標：the Stimulator rebuilt on a breadboard (the other boards stay on their PCBs).

   Current source as the handout schematic draws it (Q_sense emitter after the switch, so no leak when released),
   plus a 1N4148 in series with the output (with the switch open Q_pass's base sits at 0 V and its collector-base
   junction would clamp Vm at ~0.6 V).  The switch is either a push button ('manual') or a 555 one-shot ('555'):
   the button only triggers the 555, the pulse length is 1.1·R·C and does not depend on how long it is held.

   Breadboard: columns 1..N, rows a–e / f–j (one net per column and half), rails T+ / B1 = V+, T- / B2 = GND
   (the bottom pair is jumpered to the top pair at column 1).  Every pin carries the net it must be on;
   STIM.check() traces strips, rails and jumpers and reports any pin on the wrong net, two leads in one hole, a
   split net, or anything sharing a strip with a push button's unused legs.

   STIM.layout('manual' | '555')   STIM.check(layout)   STIM.draw(svg, layout)   STIM.bom(kind)
*/
(function(){
  'use strict';
  var NS = 'http://www.w3.org/2000/svg', ROWS = 'abcdefghij';

  function H(r, c){ return {r:r, c:c}; }
  function R(ref, ohm, a, b, na, nb){ return {t:'R', ref:ref, val:ohm, pins:[a, b], nets:[na, nb]}; }
  function C(ref, f, a, b, na, nb){ return {t:'C', ref:ref, val:f, pins:[a, b], nets:[na, nb]}; }
  function D(ref, an, ca, nan, nca){ return {t:'D', ref:ref, pins:[an, ca], nets:[nan, nca]}; }
  /* TO-92 in one row, three consecutive columns: E B C (flat side toward row j) */
  function Q(ref, type, row, c, ne, nb, nc){ return {t:'Q', ref:ref, type:type, pins:[H(row, c), H(row, c + 1), H(row, c + 2)], nets:[ne, nb, nc]}; }
  function W(a, b, net){ return {t:'W', pins:[a, b], nets:[net, net], net:net}; }
  function POT(ref, ohm, row, c, n1, nw){ return {t:'POT', ref:ref, val:ohm, pins:[H(row, c), H(row, c + 1), H(row, c + 2)], nets:[n1, nw, null]}; }
  /* 6×6 tact switch across the channel at columns c, c+2: only the diagonal legs e_c and f_{c+2} are used, so it
     works whichever pairs are joined inside; the strips of the other two legs must stay empty */
  function TACT(ref, c, nTop, nBot){ return {t:'SW', ref:ref, pins:[H('e', c), H('e', c + 2), H('f', c), H('f', c + 2)], nets:[nTop, null, null, nBot], reserve:[H('e', c + 2), H('f', c)]}; }
  /* DIP-8 across the channel, pin 1 at f_c (notch to the left): pins 1–4 along row f, 5–8 back along row e */
  function IC8(ref, type, c, nets){ return {t:'IC', ref:ref, type:type, pins:[H('f', c), H('f', c + 1), H('f', c + 2), H('f', c + 3), H('e', c + 3), H('e', c + 2), H('e', c + 1), H('e', c)], nets:nets}; }
  /* a wire leaving the board for the PCB stack */
  function EXT(at, net, label){ return {t:'EXT', pins:[at], nets:[net], net:net, label:label}; }

  /* the current source, starting at column o (o + 0 .. o + 16) */
  function core(o, withButton){
    var c = function(k){ return o + k; }, parts = [
      POT('VR', 100e3, 'i', c(4), 'ST.P', 'ST.K'),
      W(H('h', c(4)), H('h', c(8)), 'ST.P'),
      R('R7a', 6.8e3, H('g', c(5)), H('g', c(9)), 'ST.K', 'ST.Q'),
      Q('Q_sense', '2N4403', 'j', c(8), 'ST.P', 'ST.Q', 'ST.R'),
      Q('Q_pass', '2N4403', 'f', c(9), 'ST.Q', 'ST.R', 'ST.C'),
      R('R7b', 6.8e3, H('h', c(10)), H('B2', c(13)), 'ST.R', 'GND'),
      D('D_out', H('g', c(11)), H('g', c(15)), 'ST.C', 'Vm'),
      EXT(H('j', c(15)), 'Vm', 'Vm → PCB 疊接排針 Intracellular')
    ];
    if(withButton) parts.unshift(TACT('SW', c(2), 'V+', 'ST.P'), W(H('a', c(2)), H('T+', c(2)), 'V+'));
    return parts;
  }
  function layout(kind){
    var parts = [W(H('T+', 1), H('B1', 1), 'V+'), W(H('T-', 1), H('B2', 1), 'GND')], o = 0, cols, spans;
    if(kind === '555'){
      parts.push(
        TACT('SW', 1, 'GND', 'BTN'),
        W(H('a', 1), H('T-', 2), 'GND'),
        R('R_btn', 10e3, H('h', 3), H('B1', 2), 'BTN', 'V+'),
        C('C_trig', 10e-9, H('g', 3), H('g', 7), 'BTN', 'TRIG'),
        R('R_trig', 10e3, H('h', 7), H('B1', 11), 'TRIG', 'V+'),
        IC8('U1', 'ICM7555', 6, ['GND', 'TRIG', 'ST.P', 'V+', 'CTRL', 'TC', 'TC', 'V+']),
        W(H('a', 6), H('T+', 6), 'V+'),
        W(H('j', 6), H('B2', 6), 'GND'),
        W(H('j', 9), H('B1', 9), 'V+'),
        C('C_ctrl', 10e-9, H('c', 9), H('T-', 11), 'CTRL', 'GND'),
        W(H('d', 7), H('d', 8), 'TC'),
        C('C_t', 1e-6, H('b', 7), H('T-', 8), 'TC', 'GND'),
        POT('VR_t', 1e6, 'b', 10, 'TM', 'TC2'),
        W(H('c', 11), H('c', 8), 'TC'),
        R('R_t', 10e3, H('a', 10), H('T+', 14), 'TM', 'V+'),
        W(H('j', 8), H('j', 17), 'ST.P'));
      o = 13;
      parts = parts.concat(core(o, false));
      cols = o + 19;
      spans = [{title:'555 單擊', c0:1, c1:12}, {title:'電流源', c0:o + 2, c1:o + 16}];
    } else {
      parts = parts.concat(core(0, true));
      cols = 19;
      spans = [{title:'電流源（按鈕）', c0:2, c1:16}];
    }
    parts.push(EXT(H('T+', cols - 1), 'V+', 'V+ → PCB 疊接排針（V+ 腳）'), EXT(H('T-', cols), 'GND', 'GND → PCB 疊接排針（GND 腳）'));
    /* the two nets that differ only by name: the TC wire into the trimmer's wiper */
    return {kind:kind, cols:cols, parts:parts, spans:spans, alias:{TC2:'TC'}};
  }

  /* ---------------- check ---------------- */
  var RAILNET = {'T+':'V+', 'B1':'V+', 'T-':'GND', 'B2':'GND'};
  function key(h){ return h.r.length > 1 ? h.r : (ROWS.indexOf(h.r) < 5 ? 'U' : 'L') + h.c; }
  function check(lay){
    var par = {}, errs = [], holes = {}, alias = lay.alias || {};
    function find(x){ while(par[x] !== undefined && par[x] !== x) x = par[x]; return x; }
    function touch(k){ if(par[k] === undefined) par[k] = k; }
    function uni(a, b){ a = find(a); b = find(b); if(a !== b) par[a] = b; }
    Object.keys(RAILNET).forEach(touch);
    lay.parts.forEach(function(p){
      p.pins.forEach(function(h){
        var hk = h.r + h.c;
        if(h.c < 1 || h.c > lay.cols) errs.push((p.ref || '跳線') + '：腳位超出（' + hk + '）');
        if(holes[hk]) errs.push(hk + ' 插了兩支腳（' + holes[hk] + '、' + (p.ref || '跳線') + '）');
        holes[hk] = p.ref || '跳線'; touch(key(h));
      });
      if(p.t === 'W') uni(key(p.pins[0]), key(p.pins[1]));
    });
    var netOf = {}, groupOf = {};
    function claim(g, net, who){
      if(netOf[g] && netOf[g] !== net) errs.push(who + ' 應在 ' + net + '，卻接到 ' + netOf[g]);
      else netOf[g] = net;
      if(groupOf[net] !== undefined && groupOf[net] !== g) errs.push(net + ' 分成了兩塊（' + who + '）');
      groupOf[net] = g;
    }
    Object.keys(RAILNET).forEach(function(r){ claim(find(r), RAILNET[r], '軌 ' + r); });
    lay.parts.forEach(function(p){
      p.pins.forEach(function(h, i){ var n = alias[p.nets[i]] || p.nets[i]; if(n) claim(find(key(h)), n, (p.ref || '跳線') + ' 第 ' + (i + 1) + ' 腳（' + h.r + h.c + '）'); });
    });
    /* a push button's unused legs: nothing else may share their strips */
    lay.parts.forEach(function(p){
      (p.reserve || []).forEach(function(h){
        var k = key(h);
        lay.parts.forEach(function(q){ q.pins.forEach(function(g){ if(q !== p && key(g) === k) errs.push((q.ref || '跳線') + ' 和 ' + p.ref + ' 沒用的腳在同一列（' + g.r + g.c + '）'); }); });
      });
    });
    return errs.filter(function(e, i, a){ return a.indexOf(e) === i; });
  }

  /* ---------------- drawing ---------------- */
  var P = 13, X0 = 74, XR = 150;
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
  function fmtC(f){ return f >= 1e-6 ? +(f / 1e-6).toPrecision(3) + 'µF' : f >= 1e-9 ? +(f / 1e-9).toPrecision(3) + 'nF' : f + 'F'; }
  function capCode(f){ var pf = Math.round(f / 1e-12), e = Math.floor(Math.log10(pf)) - 1; return String(Math.round(pf / Math.pow(10, e))) + e; }
  var NETCOL = {'V+':'#d7263d', 'GND':'#222', 'Vm':'#f28c28', 'ST.P':'#7e57c2'};
  function wireCol(net){ return NETCOL[net] || '#2e8b57'; }
  function el(tag, attr, parent){ var e = document.createElementNS(NS, tag); for(var k in attr) e.setAttribute(k, attr[k]); if(parent) parent.appendChild(e); return e; }
  function tip(g, s){ el('title', {}, g).textContent = s; }
  function txt(g, x, y, s, cls, anchor){ var t = el('text', {x:x, y:y, class:cls, 'text-anchor':anchor || 'start'}, g); t.textContent = s; return t; }

  function draw(svg, lay){
    var Wd = X0 + lay.cols * P + XR, H0 = 264;
    svg.setAttribute('viewBox', '0 0 ' + Wd + ' ' + H0);
    svg.innerHTML = '';
    var g = el('g', {}, svg), xEnd = X0 + lay.cols * P - 3;
    el('rect', {x:6, y:4, width:X0 + lay.cols * P + 4, height:H0 - 8, rx:8, fill:'#f3efe6', stroke:'#cfc7b6'}, g);
    el('rect', {x:X0 - 10, y:135, width:lay.cols * P + 7, height:8, rx:2, fill:'#e3dccd'}, g);
    lay.spans.forEach(function(s){
      var x0 = hx({c:s.c0}) - 6, x1 = hx({c:s.c1}) + 6;
      el('rect', {x:x0, y:56, width:x1 - x0, height:160, rx:5, fill:'none', stroke:'#b9ad95', 'stroke-dasharray':'4 3'}, g);
      txt(g, (x0 + x1) / 2, 52, s.title, 'bb-mod', 'middle');
    });
    [['T+', '#d7263d', '+9V', -6], ['T-', '#2b2b2b', 'GND', 6], ['B1', '#d7263d', '+9V', -6], ['B2', '#2b2b2b', 'GND', 6]].forEach(function(r){
      var y = Y[r[0]] + r[3];
      el('line', {x1:X0 - 10, y1:y, x2:xEnd, y2:y, stroke:r[1], 'stroke-width':1.6}, g);
      txt(g, X0 - 14, Y[r[0]] + 3.5, r[2], 'bb-rail', 'end').setAttribute('fill', r[1]);
    });
    var hg = el('g', {fill:'#8f8676'}, g);
    for(var c = 1; c <= lay.cols; c++){
      ['T+', 'T-', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'B1', 'B2'].forEach(function(r){ el('rect', {x:hx({c:c}) - 2, y:Y[r] - 2, width:4, height:4, rx:0.8}, hg); });
      if(c === 1 || c % 5 === 0) txt(g, hx({c:c}), 64, c, 'bb-num', 'middle');
    }
    ['a', 'e', 'f', 'j'].forEach(function(r){ txt(g, X0 - 14, Y[r] + 3, r, 'bb-num', 'end'); });
    /* off-board wires to the PCB stack */
    var ext = lay.parts.filter(function(p){ return p.t === 'EXT'; });
    el('rect', {x:xEnd + 46, y:60, width:XR - 54, height:150, rx:6, fill:'#1f2a24', stroke:'#0d140f'}, g);
    txt(g, xEnd + 46 + (XR - 54) / 2, 76, 'PCB 疊接', 'bb-pcb', 'middle');
    ext.forEach(function(p, i){
      var h = p.pins[0], x1 = hx(h), y1 = hy(h), y2 = 100 + i * 40, x2 = xEnd + 58, col = wireCol(p.net);
      el('path', {d:'M' + x1 + ' ' + y1 + ' C ' + (x1 + 30) + ' ' + y1 + ' ' + (x2 - 40) + ' ' + y2 + ' ' + x2 + ' ' + y2, fill:'none', stroke:col, 'stroke-width':3.2, 'stroke-linecap':'round'}, g);
      el('circle', {cx:x1, cy:y1, r:2.6, fill:col}, g);
      el('rect', {x:x2, y:y2 - 5, width:10, height:10, fill:'#c9a227'}, g);
      txt(g, x2 + 14, y2 - 2, ['Vm', 'V+', 'GND'][['Vm', 'V+', 'GND'].indexOf(p.net)], 'bb-pcbt');
      txt(g, x2 + 14, y2 + 9, p.net === 'Vm' ? 'Intracellular' : '2×2 排針', 'bb-pcbs');
      tip(g.lastChild, p.label);
    });
    lay.parts.filter(function(p){ return p.t === 'W'; }).forEach(function(p){
      var a = p.pins[0], b = p.pins[1], x1 = hx(a), y1 = hy(a), x2 = hx(b), y2 = hy(b), col = wireCol(p.net);
      var d = Math.abs(x1 - x2) < 2 ? 'M' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2 : 'M' + x1 + ' ' + y1 + ' Q ' + ((x1 + x2) / 2) + ' ' + (Math.min(y1, y2) - 10) + ' ' + x2 + ' ' + y2;
      var w = el('path', {d:d, fill:'none', stroke:col, 'stroke-width':3.2, 'stroke-linecap':'round'}, g);
      tip(w, '跳線：' + a.r + a.c + ' → ' + b.r + b.c + '（' + p.net + '）');
      el('circle', {cx:x1, cy:y1, r:2.6, fill:col}, g); el('circle', {cx:x2, cy:y2, r:2.6, fill:col}, g);
    });
    lay.parts.filter(function(p){ return p.t !== 'W' && p.t !== 'EXT'; }).forEach(function(p){ part(g, p); });
    /* battery */
    el('rect', {x:12, y:8, width:20, height:30, rx:3, fill:'#333'}, g);
    txt(g, 22, 27, '9V', 'bb-bat', 'middle');
    el('path', {d:'M26 12 Q ' + (X0 - 14) + ' 6 ' + hx({c:1}) + ' ' + Y['T+'], stroke:'#d7263d', 'stroke-width':2.4, fill:'none'}, g);
    el('path', {d:'M26 34 Q ' + (X0 - 14) + ' 36 ' + hx({c:1}) + ' ' + Y['T-'], stroke:'#222', 'stroke-width':2.4, fill:'none'}, g);
    if(lay.kind === '555') probe(g, hx({c:8}) + 0, Y.f + 0, 'CH2：555 輸出');
  }
  function probe(g, x, y, s){
    el('path', {d:'M' + x + ' ' + y + ' l -14 -14', stroke:'#555', 'stroke-width':1.5}, g);
    el('circle', {cx:x - 16, cy:y - 16, r:4, fill:'none', stroke:'#555', 'stroke-width':1.5}, g);
    txt(g, x - 22, y - 22, s, 'bb-probe', 'end');
  }
  function part(g, p){
    var a = p.pins[0], b = p.pins[1], gg = el('g', {class:'bb-part'}, g);
    var name = {R:'電阻', C:'電容', D:'二極體', Q:'電晶體', POT:'可變電阻', SW:'按鈕', IC:'IC'}[p.t];
    var pinName = p.t === 'Q' ? function(i){ return 'EBC'[i]; } : p.t === 'IC' ? function(i){ return '腳 ' + (i + 1); } : function(i){ return '' + (i + 1); };
    tip(gg, p.ref + '　' + name + (p.t === 'R' || p.t === 'POT' ? ' ' + fmtR(p.val) : p.t === 'C' ? ' ' + fmtC(p.val) : '') + (p.type ? ' ' + p.type : '') + '\n' +
      p.pins.map(function(h, i){ return pinName(i) + '：' + h.r + h.c + (p.nets[i] ? '（' + p.nets[i] + '）' : '（不接）'); }).join('\n'));
    if(p.t === 'R' || p.t === 'C' || p.t === 'D'){
      var x1 = hx(a), y1 = hy(a), x2 = hx(b), y2 = hy(b), mx = (x1 + x2) / 2, my = (y1 + y2) / 2, ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      el('line', {x1:x1, y1:y1, x2:x2, y2:y2, stroke:'#9a9a9a', 'stroke-width':1.4}, gg);
      [a, b].forEach(function(h){ el('circle', {cx:hx(h), cy:hy(h), r:2, fill:'#777'}, gg); });
      var body = el('g', {transform:'translate(' + mx + ',' + my + ') rotate(' + ang + ')'}, gg);
      if(p.t === 'R'){
        el('rect', {x:-11, y:-4.2, width:22, height:8.4, rx:3.5, fill:'#e9d5a8', stroke:'#b49b6b', 'stroke-width':0.8}, body);
        bands(p.val).forEach(function(col, i){ el('rect', {x:-7 + i * 4, y:-4.2, width:2.2, height:8.4, fill:col}, body); });
        el('rect', {x:7, y:-4.2, width:2, height:8.4, fill:'#c9a227'}, body);
      } else if(p.t === 'C'){
        var film = p.val >= 1e-6;
        el('rect', {x:-7, y:-5, width:14, height:10, rx:film ? 1.5 : 4, fill:film ? '#c8102e' : '#3b82c4', stroke:film ? '#8a0b20' : '#255e92', 'stroke-width':0.8}, body);
        el('text', {x:0, y:2.4, 'text-anchor':'middle', class:'bb-ctext', transform:'rotate(' + (-ang) + ')'}, body).textContent = capCode(p.val);
      } else {
        el('rect', {x:-8, y:-3.4, width:16, height:6.8, rx:2.5, fill:'#d9744a', stroke:'#a54e2c', 'stroke-width':0.8}, body);
        el('rect', {x:4.2, y:-3.4, width:2.6, height:6.8, fill:'#1d1d1d'}, body);
      }
      var lx = mx, ly = p.t === 'C' ? my + 13 : my - 8, anc = 'middle';
      if(Math.abs(ang) > 45 && Math.abs(ang) < 135){ lx = mx + 9; ly = my + 3; anc = 'start'; }
      var onRail = a.r.length > 1 ? b : b.r.length > 1 ? a : null;
      if(onRail){ lx = hx(onRail) + 6; ly = hy(onRail) - 7; anc = 'start'; }
      txt(gg, lx, ly, p.t === 'R' ? fmtR(p.val) : p.t === 'C' ? fmtC(p.val) : '1N4148', 'bb-lab', anc);
    } else if(p.t === 'Q'){
      var xs = p.pins.map(hx), y = hy(a);
      p.pins.forEach(function(h){ el('circle', {cx:hx(h), cy:hy(h), r:2, fill:'#777'}, gg); });
      el('path', {d:'M ' + (xs[0] - 5) + ' ' + (y - 2) + ' L ' + (xs[2] + 5) + ' ' + (y - 2) + ' A ' + ((xs[2] - xs[0]) / 2 + 5) + ' 11 0 0 0 ' + (xs[0] - 5) + ' ' + (y - 2) + ' Z', fill:'#333', stroke:'#111', 'stroke-width':0.8}, gg);
      txt(gg, xs[1], y - 6, p.type.slice(2), 'bb-q', 'middle');
      ['E', 'B', 'C'].forEach(function(s, i){ txt(gg, xs[i], y + 10, s, 'bb-pin', 'middle'); });
    } else if(p.t === 'POT'){
      var px = p.pins.map(hx), py = hy(a);
      p.pins.forEach(function(h, i){ el('circle', {cx:hx(h), cy:hy(h), r:2, fill:i === 2 ? '#bbb' : '#777'}, gg); });
      el('rect', {x:px[0] - 6, y:py - 15, width:px[2] - px[0] + 12, height:12, rx:2, fill:'#2f5fa8', stroke:'#1e3f72', 'stroke-width':0.8}, gg);
      el('circle', {cx:px[2] + 2, cy:py - 9, r:2.4, fill:'#e8d38a'}, gg);
      txt(gg, px[1], py - 18, fmtR(p.val) + ' 可變', 'bb-lab', 'middle');
      txt(gg, px[2], py + 10, '空', 'bb-pin', 'middle');
    } else if(p.t === 'SW'){
      var sx = hx(p.pins[0]), ex = hx(p.pins[1]), ty = hy(p.pins[0]), by = hy(p.pins[2]);
      p.pins.forEach(function(h, i){ el('circle', {cx:hx(h), cy:hy(h), r:2.2, fill:p.nets[i] ? '#444' : '#bbb'}, gg); });
      el('rect', {x:sx - 4, y:ty + 2, width:ex - sx + 8, height:by - ty - 4, rx:2, fill:'#444'}, gg);
      el('circle', {cx:(sx + ex) / 2, cy:(ty + by) / 2, r:6, fill:'#c33'}, gg);
      el('line', {x1:sx, y1:ty, x2:ex, y2:by, stroke:'#f2b705', 'stroke-width':1.4, 'stroke-dasharray':'2 2'}, gg);
      txt(gg, ex + 6, ty + 4, '按鈕（用對角兩腳）', 'bb-lab');
    } else if(p.t === 'IC'){
      var x0 = hx(p.pins[0]) - 6, x1i = hx(p.pins[3]) + 6, yt = hy(p.pins[4]) + 3, yb = hy(p.pins[0]) - 3;
      p.pins.forEach(function(h){ el('circle', {cx:hx(h), cy:hy(h), r:2, fill:'#777'}, gg); });
      el('rect', {x:x0, y:yt, width:x1i - x0, height:yb - yt, rx:2, fill:'#2b2b2b'}, gg);
      el('path', {d:'M ' + x0 + ' ' + ((yt + yb) / 2 - 4) + ' a 4 4 0 0 1 0 8', fill:'#555'}, gg);
      txt(gg, (x0 + x1i) / 2 + 2, (yt + yb) / 2 + 3, p.type, 'bb-ic', 'middle');
      [1, 2, 3, 4].forEach(function(n, i){ txt(gg, hx(p.pins[i]), yb - 3, n, 'bb-icp', 'middle'); });
      [5, 6, 7, 8].forEach(function(n, i){ txt(gg, hx(p.pins[4 + i]), yt + 8, n, 'bb-icp', 'middle'); });
    }
  }

  /* ---------------- BOM with 百年電子 光復店（清大）shelf stock, read 2026-10-17 from 100y.com.tw ---------------- */
  var SHOP = {
    '2N4403': ['2N4403TA', '32207', '41', 'NT$120／20 顆', '替代：2N3906（#51612，219，NT$56／20）'],
    '1N4148': ['1N4148', '52986', '3280', 'NT$55／20 顆', ''],
    'R6.8k': ['RM046K80FT 6.8 kΩ 1 %', '9548', '812', 'NT$18／20 顆', '電路圖 7 kΩ，E12 最近 6.8 kΩ'],
    'R10k': ['RM0410K0FT 10 kΩ 1 %', '4592', '9170', 'NT$18／20 顆', ''],
    'VR100k': ['WIW3296W-100KΩ 25 轉', '15424', '295', 'NT$80／5 顆', '刺激電流約 13.5–100 µA'],
    'VR1M': ['3296W-1-105LF 1 MΩ 25 轉', '14994', '436', 'NT$52／2 顆', '脈衝長度 11 ms–1.1 s'],
    'ICM7555': ['ICM7555IPAZ（CMOS，DIP-8）', '76888', '28', 'NT$115／2 顆', '替代：NE555P（#4484，205，NT$85／5）'],
    'C1u': ['MKT 1 µF／250 V 薄膜', '72820', '75', 'NT$158／5 顆', '定時電容，用薄膜（陶瓷電容隨電壓、溫度變很多）'],
    'C10n': ['A103K15X7RF5UAA 0.01 µF 50 V', '154500', '427', 'NT$40／10 顆', ''],
    'SW': ['TS-1109-H10-160g 6×6 輕觸開關', '148557', '1303', 'NT$18／10 顆', '跨中間的溝插，用對角兩腳'],
    'BB': ['MB-102T 830 孔麵包板', '99344', '31', 'NT$120', '400 孔的 BB-801T（#99345，NT$48）也放得下'],
    'JW': ['TS-65 麵包板跳線', '98102', '61', 'NT$73／包', ''],
    'DUP': ['杜邦線 公對母 20 cm（40P）', '102097', '167', 'NT$130', '麵包板 → PCB 疊接排針，撕 3 條'],
    'BAT': ['3132 9 V 電池扣', '5236', '610', 'NT$25／5 個', '電池另買（9 V 方型）']
  };
  function bom(kind){
    var rows = [
      ['電晶體', '2N4403（PNP）', 2, 'Q_sense、Q_pass', '2N4403'],
      ['二極體', '1N4148', 1, 'D_out（色環朝 PCB 那端）', '1N4148'],
      ['電阻', '6.8 kΩ 1/4 W', 2, 'R7a、R7b', 'R6.8k'],
      ['可變電阻', '100 kΩ（3296W）', 1, 'VR', 'VR100k']];
    if(kind === '555') rows.push(
      ['IC', 'ICM7555（CMOS 555）', 1, 'U1', 'ICM7555'],
      ['可變電阻', '1 MΩ（3296W）', 1, 'VR_t：脈衝長度', 'VR1M'],
      ['電阻', '10 kΩ 1/4 W', 3, 'R_t、R_btn、R_trig', 'R10k'],
      ['電容', '1 µF 薄膜', 1, 'C_t（換 0.1 µF：1.1–110 ms）', 'C1u'],
      ['電容', '0.01 µF（103）', 2, 'C_trig、C_ctrl', 'C10n']);
    rows.push(
      ['開關', '6×6 輕觸開關', 1, kind === '555' ? '觸發 555' : 'SW', 'SW'],
      ['麵包板', '830 孔', 1, '', 'BB'],
      ['跳線', '麵包板跳線', 1, '', 'JW'],
      ['杜邦線', '公對母', 3, 'Vm、V+、GND → PCB', 'DUP'],
      ['電池扣', '9 V', 1, '', 'BAT']);
    return rows.map(function(r){ var s = SHOP[r[4]]; return {kind:r[0], spec:r[1], n:r[2], use:r[3], item:s[0], no:s[1], stock:s[2], price:s[3], note:s[4]}; });
  }

  window.STIM = {layout:layout, check:check, draw:draw, bom:bom};

  /* ---------------- page: draw both versions with their check and BOM ---------------- */
  Array.prototype.forEach.call(document.querySelectorAll('[data-stim]'), function(box){
    var kind = box.dataset.stim, lay = layout(kind), errs = check(lay), svg = box.querySelector('svg'), st = box.querySelector('.bb-status'), tb = box.querySelector('table');
    draw(svg, lay);
    svg.style.minWidth = (X0 + lay.cols * P + XR) * 0.9 + 'px';
    if(st) st.innerHTML = errs.length ? '<span class="bb-err">接線檢查：' + errs.join('；') + '</span>'
      : '<span class="bb-ok">✓ 接線檢查通過</span>：每支腳都在該在的節點（從麵包板的列、軌、跳線推出來的）。滑鼠停在零件上看腳位。';
    if(tb) tb.innerHTML = '<tr><th>零件</th><th>規格</th><th class="num">數量</th><th>位置</th><th>百年電子 光復店（清大）</th><th class="num">庫存</th><th>價格</th></tr>' +
      bom(kind).map(function(r){
        return '<tr><td>' + r.kind + '</td><td>' + r.spec + '</td><td class="num">' + r.n + '</td><td class="small">' + r.use + '</td><td class="small">' + r.item + '（#' + r.no + '）' + (r.note ? '<br><span class="muted">' + r.note + '</span>' : '') + '</td><td class="num">' + r.stock + '</td><td class="small">' + r.price + '</td></tr>';
      }).join('');
  });
})();
