/* Schematic of the HW2 #2-2 active membrane, wired as the PCBs are.
   Shared by hw2-lab/, active-membrane-sim/ (live values) and hw2-debug/nodes.html (node names only).

   var s = MembraneSchematic(svgElement, {live: true});
   s.setValues(fn)        fn(code) -> volts, for every node tag
   s.setCurrents({iStim, iFi, iSo})   amps
   s.setOn({qPass: true, ...})        highlight conducting transistors
   s.setContacts(state)   state.sw / leak / fi_vm / fi_vplus / fi_gnd / so_vm / so_gnd
   s.setQsense('pcb'|'sw'|'rx'|'rx10'|'rx12'); s.setResistors(r13, rfe, soR2)
   s.setAddons(state)     state.r13p / rf / rb / rl / rs / ru: add-on resistors clipped on (0 = none), each drawn
                          as a part.  Everything that differs from the kit circuit (add-ons, Q_sense moved, pulled
                          wires, FI battery, ideal source, R13 / Rfe != 100 kohm, R2 != 1 Mohm, V+ != 7.8 V) is
                          drawn in --mod.
   opts.chain = n         #2-3: n passive units between the Stimulator and the Leak, 10 kohm
                          apart on top, 100 ohm apart on the extracellular row (PC1.., PX2.., AX)
   s.setSupply('stim'|'local'|'none')  FI.V+ wired to the Stimulator's V+ (n = 0: through the stacked header;
                          n >= 1: a pulled wire, the Passive PCBs do not carry V+), FI's own battery, or not wired
   s.setSource('stim'|'ideal')  draw the ideal current source that replaces SW
   opts.passiveOnly       #2-1: only the passive units; the Leak board is drawn as the last unit
   s.setBoards({lk, fi, so})    grey out boards that are unplugged
   s.setProbes([ch1, ch2])      scope probes, so their current leaves at the CH label
   s.flow(dt, cur)        electron flow: cur = AM.currents() (null hides it).  Each drawn wire carries the
                          current KCL gives it from the branch currents; dots move against the conventional
                          current at a speed ~ |I|^0.38 (none below 20 nA).
   Node codes follow hw2-debug/nodes.html: board + node, e.g. FI.B3.
*/
(function(){
  var CSS = [
    '.msch .w{stroke:var(--ink);stroke-width:1.6;fill:none;stroke-linecap:round;stroke-linejoin:round}',
    '.msch .vm{stroke:var(--vmbus,#2a78d6);stroke-width:3}',
    '.msch .sym{stroke:var(--ink);stroke-width:1.6;fill:none;stroke-linejoin:round}',
    '.msch .fillk{fill:var(--ink);stroke:none}',
    '.msch .dotn{fill:var(--ink)}',
    '.msch .box{fill:none;stroke:var(--rule);stroke-width:1.4;stroke-dasharray:5 4}',
    '.msch .bt{fill:var(--muted);font-size:13px;font-weight:700}',
    '.msch .lab{fill:var(--muted);font-size:11.5px}',
    '.msch .nv{fill:var(--ink);font-size:11.5px;font-family:"IBM Plex Mono",ui-monospace,monospace}',
    '.msch .nv .code,.msch .nv.code{fill:var(--link);font-weight:700}',
    '.msch .nvb{fill:var(--vmbus,#2a78d6);font-size:15px;font-weight:700;font-family:"IBM Plex Mono",ui-monospace,monospace}',
    '.msch .cur{fill:var(--opt);font-size:11.5px;font-family:"IBM Plex Mono",ui-monospace,monospace}',
    '.msch .qc{fill:transparent;stroke:var(--ink);stroke-width:1.2}',
    '.msch .qc.on{fill:var(--qon,rgba(42,120,214,.16))}',
    '.msch .contact .blade{stroke:var(--ink);stroke-width:2.2}',
    '.msch .contact.open .blade{stroke:var(--warn)}',
    '.msch .contact .ct{font-size:10.5px;fill:var(--warn);font-weight:700}',
    '.msch .contact:not(.open) .ct{display:none}',
    '.msch.live .contact{cursor:pointer}',
    '.msch.live .contact:hover .blade{stroke-width:3}',
    '.msch .sw .blade{stroke-width:2.4}',
    '.msch .ghost{opacity:.2}',
    /* differences from the kit circuit */
    '.msch .mod .w,.msch .mod .sym{stroke:var(--mod,#b0307f)}',
    '.msch .mod .w{stroke-width:2}',
    '.msch .mod .dotn,.msch .mod .fillk,.msch .mod .lab,.msch .lgm{fill:var(--mod,#b0307f)}',
    '.msch .mod .lab{font-weight:700}',
    /* electron flow */
    '.msch .ef{pointer-events:none}',
    '.msch .ef path{fill:none;stroke:var(--eflow,#e8720c);stroke-width:5;stroke-linecap:round;stroke-dasharray:0.001 16}',
    '.msch .lge{fill:var(--eflow,#e8720c)}'
  ].join('\n');
  if(!document.getElementById('msch-css')){
    var st = document.createElement('style'); st.id = 'msch-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  var NS = 'http://www.w3.org/2000/svg', SP = 16;   /* SP: electron spacing along a wire */

  window.MembraneSchematic = function(svg, opts){
    var live = !!(opts && opts.live), out = [];
    var n = (opts && opts.chain) || 0, DX = 130, OX = n * DX, po = !!(opts && opts.passiveOnly);
    var EX = po ? 0 : 60, G = OX + EX;                 /* the active group sits EX further right: a breadboard column */
    var XE = po ? 430 : 1040;                          /* right end of the buses inside the active group */
    var XA = 352 + OX, XR = 695 + G;                   /* breadboard column (V+ -> Vm, Vm -> GND); V+ wire down to FI */
    function ux(k){ return 370 + (k - 1) * DX; }       /* wire x of passive unit k (like the Leak) */

    /* everything that carries current, in global coordinates, with the show/hide keys around it */
    var WIRES = [], ELS = [], SRCS = [], KEYS = [], GX = 0;
    var VIS = {qspcb:true, qssw:false, rx:false, isrc:false, bat:false, fiw:!n,
               rb:false, rl:false, r13p:false, rf:false, rs:false, ru:false};
    function gp(p){ return [p[0] + GX, p[1]]; }
    function beginG(key, cls, id){
      out.push('<g data-key="' + key + '"' + (id ? ' id="' + id + '"' : '') + (cls ? ' class="' + cls + '"' : '') +
        (VIS[key] === false ? ' style="display:none"' : '') + '>');
      KEYS.push(key);
    }
    function endG(){ out.push('</g>'); KEYS.pop(); }
    /* two-terminal branch a -> b (engine order); path = where the electrons are drawn, null = none (capacitor) */
    function el2(name, a, b, path){
      ELS.push({name:name, q:false, keys:KEYS.slice(), T:[gp(a), gp(b)], P:path === null ? [] : [(path || [a, b]).map(gp)]});
    }

    function L(pts, cls, attr){
      cls = cls || 'w';
      out.push('<polyline class="' + cls + '"' + (attr || '') + ' points="' + pts.map(function(p){ return p.join(','); }).join(' ') + '"/>');
      if(/(^| )w( |$)/.test(cls)) WIRES.push({pts:pts.map(gp), keys:KEYS.slice()});
    }
    function dot(x, y){ out.push('<circle class="dotn" cx="' + x + '" cy="' + y + '" r="3"/>'); }
    function txt(x, y, s, cls, anchor, attr){ out.push('<text class="' + cls + '" x="' + x + '" y="' + y + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + (attr || '') + '>' + s + '</text>'); }
    /* node tag: shows "B3" (static) or "B3 0.37 V" (live) */
    function tag(code, short, x, y, anchor, two){
      out.push('<text class="nv" data-node="' + code + '" data-short="' + short + '"' + (two ? ' data-two="1"' : '') +
        ' x="' + x + '" y="' + y + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + '><tspan class="code">' + short + '</tspan></text>');
    }
    function cur(id, x, y, anchor){ if(live) out.push('<text id="' + id + '" class="cur" x="' + x + '" y="' + y + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + '></text>'); }
    function resV(x, y1, y2, a, b, name, rev){
      L([[x, y1], [x, a]]);
      var pts = [[x, a]], seg = (b - a) / 12;
      for(var i = 1; i < 12; i++) pts.push([x + (i % 2 ? 7 : -7), a + seg * i]);
      pts.push([x, b]); L(pts, 'sym'); L([[x, b], [x, y2]]);
      if(name) el2(name, rev ? [x, b] : [x, a], rev ? [x, a] : [x, b]);
    }
    function resH(y, x1, x2, a, b, name){
      L([[x1, y], [a, y]]);
      var pts = [[a, y]], seg = (b - a) / 10;
      for(var i = 1; i < 10; i++) pts.push([a + seg * i, y + (i % 2 ? -6 : 6)]);
      pts.push([b, y]); L(pts, 'sym'); L([[b, y], [x2, y]]);
      if(name) el2(name, [a, y], [b, y]);
    }
    function capV(x, y1, y2, yc, name){
      L([[x, y1], [x, yc - 4]]); L([[x - 13, yc - 4], [x + 13, yc - 4]], 'sym'); L([[x - 13, yc + 4], [x + 13, yc + 4]], 'sym'); L([[x, yc + 4], [x, y2]]);
      if(name) el2(name, [x, yc - 4], [x, yc + 4], null);
    }
    function diodeV(x, y1, y2, a, b, name){
      L([[x, y1], [x, a]]);
      out.push('<polygon class="sym" points="' + (x - 9) + ',' + a + ' ' + (x + 9) + ',' + a + ' ' + x + ',' + b + '"/>');
      L([[x - 9, b], [x + 9, b]], 'sym'); L([[x, b], [x, y2]]);
      el2(name, [x, a], [x, b]);
    }
    function diodeH(y, x1, x2, a, b, name){
      L([[x1, y], [a, y]]);
      out.push('<polygon class="sym" points="' + a + ',' + (y - 9) + ' ' + a + ',' + (y + 9) + ' ' + b + ',' + y + '"/>');
      L([[b, y - 9], [b, y + 9]], 'sym'); L([[b, y], [x2, y]]);
      el2(name, [a, y], [b, y]);
    }
    /* BJT in local frame: base lead (-20,0)-(0,0), bar x=0, leads to (14,-30) and (14,30) */
    function bjt(cx, cy, type, rot, eTop, id, name){
      var s = eTop ? -1 : 1, ex0 = 0, ey0 = 6 * s, ex1 = 14, ey1 = 18 * s;
      var dxv = ex1 - ex0, dyv = ey1 - ey0, len = Math.sqrt(dxv * dxv + dyv * dyv), ux = dxv / len, uy = dyv / len;
      var tipT = type === 'n' ? 0.95 : 0.35, tx = ex0 + dxv * tipT, ty = ey0 + dyv * tipT, dir = type === 'n' ? 1 : -1;
      var bx = tx - ux * 7 * dir, by = ty - uy * 7 * dir, px = -uy * 4, py = ux * 4;
      out.push('<g transform="translate(' + cx + ',' + cy + ') rotate(' + rot + ')">' +
        '<circle id="' + id + '" class="qc" cx="5" cy="0" r="21"/>' +
        '<polyline class="sym" points="-20,0 0,0"/><polyline class="sym" points="0,-12 0,12" style="stroke-width:2.6"/>' +
        '<polyline class="sym" points="0,-6 14,-18 14,-30"/><polyline class="sym" points="0,6 14,18 14,30"/>' +
        '<polygon class="fillk" points="' + tx + ',' + ty + ' ' + (bx + px) + ',' + (by + py) + ' ' + (bx - px) + ',' + (by - py) + '"/></g>');
      /* electrons: each lead end to the middle of the bar */
      var r = rot * Math.PI / 180, c = Math.round(Math.cos(r)), sn = Math.round(Math.sin(r));
      var T = function(p){ return gp([p[0] * c - p[1] * sn + cx, p[0] * sn + p[1] * c + cy]); };
      var pc = [[14, -30 * s], [14, -18 * s], [0, -6 * s], [0, 0]].map(T), pb = [[-20, 0], [0, 0]].map(T),
          pe = [[14, 30 * s], [14, 18 * s], [0, 6 * s], [0, 0]].map(T);
      ELS.push({name:name, q:true, keys:KEYS.slice(), T:[pc[0], pb[0], pe[0]], P:[pc, pb, pe]});
    }
    /* rev: the engine's first node is the lower contact */
    function contactV(key, label, x, y1, y2, name, rev){
      out.push('<g class="contact" data-c="' + key + '"' + (live ? ' tabindex="0" role="button" aria-label="切換接點 ' + label + '"' : '') + '>' +
        '<rect x="' + (x - 16) + '" y="' + y1 + '" width="36" height="' + (y2 - y1) + '" fill="transparent"/>' +
        '<circle class="dotn" cx="' + x + '" cy="' + y1 + '" r="2.6"/><circle class="dotn" cx="' + x + '" cy="' + y2 + '" r="2.6"/>' +
        '<line class="blade" data-x="' + x + '" data-y1="' + y1 + '" data-y2="' + y2 + '" x1="' + x + '" y1="' + y2 + '" x2="' + x + '" y2="' + y1 + '"/>' +
        '<text class="ct" x="' + (x + 8) + '" y="' + ((y1 + y2) / 2 + 4) + '">斷開</text></g>');
      el2(name, rev ? [x, y2] : [x, y1], rev ? [x, y1] : [x, y2]);
    }
    /* board outline; title = bold board code + name, placed where the wiring leaves room */
    function box(x, y, w, h, code, name, tx, ty, stacked){
      out.push('<rect class="box" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="6"/>');
      if(stacked) out.push('<text class="bt" x="' + tx + '" y="' + ty + '" text-anchor="middle">' + code +
        '<tspan class="lab" x="' + tx + '" dy="15">' + name + '</tspan></text>');
      else out.push('<text class="bt" x="' + tx + '" y="' + ty + '">' + code + ' <tspan class="lab">' + name + '</tspan></text>');
    }
    function val(key, x, y, anchor){ txt(x, y, '', 'lab', anchor, ' data-v="' + key + '"'); }

    box(14, 18, 308, 430, 'ST', 'Stimulator', 40, 439);
    L([[276, 70], [n ? ux(1) : 370 + EX, 70]], n ? 'w' : 'w vm');
    L([[20, 455], [n ? ux(1) : 344 + EX, 455]]);
    txt(24, 472, n ? 'GND（Stimulator 的 −，示波器地線夾這裡）' : 'GND（Extracellular，接在 Stimulator 的 −）', 'lab');

    /* ---- #2-3 passive units: 1 uF || 100 kohm, 10 kohm / 100 ohm to the next ---- */
    for(var k = 1; k <= n; k++){
      var x = ux(k), gap = 418 + (k - 1) * DX, nx = k < n ? ux(k + 1) : 370 + G, nb = k < n ? ux(k + 1) - 26 : 344 + G;
      box(332 + (k - 1) * DX, 86, 86, 362, '#' + k, 'Passive', x, 210, true);
      L([[x, 70], [x, 130]]); dot(x, 70); L([[x - 26, 130], [x + 26, 130]]); dot(x, 130);
      capV(x - 26, 130, 455, 290, 'pc' + k); txt(x, 302, '1µF', 'lab', 'middle');
      resV(x + 26, 130, 455, 250, 330, 'pr' + k); txt(x, 345, '100k', 'lab', 'middle');
      L([[x - 26, 455], [x + 26, 455]]); dot(x - 26, 455); dot(x + 26, 455);
      out.push('<text class="nv" data-node="PC' + k + '" data-short="PC' + k + '" x="' + (x + 6) + '" y="62"><tspan class="code">PC' + k + '</tspan></text>');
      if(k > 1) out.push('<text class="nv" data-node="PX' + k + '" data-short="PX' + k + '" data-mv="1" x="' + (x - 20) + '" y="472"><tspan class="code">PX' + k + '</tspan></text>');
      resH(70, x, nx, gap + 4, gap + 40, 'ps' + k); txt(gap + 22, 86, '10k', 'lab', 'middle');
      resH(455, x + 26, nb, gap + 4, gap + 40, 'px' + k); txt(gap + 22, 446, '100Ω', 'lab', 'middle');
      if(!po){                                          /* add-on: V+ -> this unit, so it rests where the active end does */
        beginG('ru', 'mod');
        resV(x - 20, 10, 70, 24, 56, 'ru' + k); dot(x - 20, 10); dot(x - 20, 70); val('ru', x - 10, 40);
        endG();
      }
    }

    /* ---- Stimulator ---- */
    L([[24, 36], [74, 36]]); L([[24, 36], [24, 340]]);
    out.push('<g id="gBatM">'); L([[12, 340], [36, 340]], 'sym'); L([[18, 350], [30, 350]], 'sym'); txt(30, 334, '+', 'lab'); out.push('</g>');
    SRCS.push({p:[24, 340], m:[24, 350], keys:[]});
    L([[24, 350], [24, 455]]); dot(24, 455);
    tag('V+', 'V+', 30, 30);
    L([[74, 36], [74, 58]]);
    out.push('<g class="contact sw" data-c="sw"' + (live ? ' tabindex="0" role="button" aria-label="SW"' : '') + '>' +
      '<rect x="58" y="56" width="36" height="40" fill="transparent"/>' +
      '<circle class="dotn" cx="74" cy="58" r="2.6"/><circle class="dotn" cx="74" cy="92" r="2.6"/>' +
      '<line class="blade" data-x="74" data-y1="58" data-y2="92" x1="74" y1="92" x2="88" y2="62"/></g>');
    el2('sw', [74, 58], [74, 92]);
    txt(66, 80, 'SW', 'lab', 'end');
    L([[74, 92], [74, 110]]); dot(74, 110); tag('ST.P', 'P', 80, 134);
    resH(110, 74, 134, 84, 122, 'pot');
    out.push('<polyline class="sym" points="88,122 116,96"/><polygon class="fillk" points="119,93 110,96 115,101"/>');
    txt(100, 90, 'pot', 'lab', 'middle');
    dot(134, 110); tag('ST.K', 'K', 134, 150);
    resH(110, 134, 196, 144, 186, 'r7a'); txt(165, 96, '7k', 'lab', 'middle');
    dot(196, 110); tag('ST.Q', 'Q', 200, 96);
    L([[196, 110], [200, 110]]);
    bjt(230, 124, 'p', -90, true, 'qPass', 'pass'); txt(242, 160, 'Q_pass', 'lab');
    L([[260, 110], [276, 110], [276, 70]]);
    cur('iStim', 272, 62, 'end');
    L([[230, 144], [230, 220]]);
    L([[196, 110], [196, 186]]);
    beginG('rx', 'mod');                               /* add-on: 22 kohm across Q_pass E-B */
    resH(158, 196, 230, 202, 224, 'rx'); dot(196, 158); dot(230, 158); val('rx', 213, 179, 'middle');
    endG();
    bjt(196, 206, 'p', 90, false, 'qSense', 'sense'); txt(196, 252, 'Q_sense', 'lab', 'middle');
    L([[226, 220], [230, 220]]); dot(230, 220); tag('ST.R', 'R', 238, 216);
    beginG('qspcb'); L([[166, 220], [24, 220]]); dot(24, 220); endG();
    beginG('qssw', 'mod'); L([[166, 220], [74, 220], [74, 110]]); endG();
    resV(230, 220, 455, 300, 380, 'r7b'); txt(240, 345, '7k', 'lab'); dot(230, 455);
    beginG('isrc', 'mod');                             /* ideal current source in place of SW */
    L([[300, 70], [300, 246]]); out.push('<circle class="sym" cx="300" cy="262" r="16"/>');
    L([[300, 272], [300, 255]], 'sym'); out.push('<polygon class="fillk" points="300,249 295,258 305,258"/>');
    L([[300, 278], [300, 455]]); dot(300, 70); dot(300, 455);
    el2('is', [300, 278], [300, 246]);
    txt(292, 244, '理想電流源', 'lab', 'end');
    endG();

    /* ---- the active membrane: Leak, Fast inward, Slow out (shifted right by the passive units) ---- */
    out.push('<g transform="translate(' + G + ',0)">'); GX = G;
    L([[370, 70], [XE, 70]], 'w vm');
    L([[344, 455], [XE, 455]]);
    if(po){
      out.push('<text class="nvb" data-node="Vm" data-short="#' + (n + 1) + ' =" data-bus="1" x="375" y="40" text-anchor="middle">Vm</text>');
      out.push('</g><text class="lab" x="' + (ux(1) + 6) + '" y="44">CH1</text><g transform="translate(' + G + ',0)">');
      txt(436, 74, 'CH2', 'lab');
    } else {
      txt(1046, 74, 'CH1', 'lab');
      out.push('<text class="nvb" data-node="Vm" data-short="Vm =" data-bus="1" x="580" y="58" text-anchor="middle">Vm</text>');
      if(n){
        txt(1046, 459, 'CH2', 'lab');
        out.push('<text class="nv" data-node="AX" data-short="AX" data-mv="1" x="420" y="472"><tspan class="code">AX</tspan></text>');
        txt(505, 472, '（active 端細胞外）', 'lab');
      }
    }
    if(!po){                                           /* FI's own battery (handout simulator) */
      beginG('bat', 'mod', 'gBat');
      L([[634, 362], [662, 362], [662, 390]]);
      L([[650, 390], [674, 390]], 'sym'); L([[656, 398], [668, 398]], 'sym', ' style="stroke-width:3"');
      L([[662, 398], [662, 455]]); dot(662, 455);
      SRCS.push({p:gp([662, 390]), m:gp([662, 398]), keys:KEYS.slice()});
      txt(670, 386, 'FI 自帶', 'lab'); txt(670, 412, '電池', 'lab');
      endG();
    }

    /* ---- Leak ---- */
    out.push('<g id="bLK">');
    box(332, 86, 86, 362, po ? '#' + (n + 1) : 'LK', po ? 'Passive' : 'Leak', 370, 210, true);
    L([[370, 70], [370, 76]]); dot(370, 70);
    contactV('leak', 'LK:Vm', 370, 76, 112, 'lk');
    L([[370, 112], [370, 130]]); L([[344, 130], [396, 130]]); dot(370, 130);
    tag('LK.Vm', 'Vm', 370, 160, 'middle', true);
    capV(344, 130, 455, 290, 'lkc'); txt(370, 302, '1µF', 'lab', 'middle');
    resV(396, 130, 455, 250, 330, 'lkr'); txt(370, 345, '100k', 'lab', 'middle');
    dot(344, 455); dot(396, 455);
    out.push('</g>');

    if(!po){
    /* ---- Fast inward ---- */
    out.push('<g id="bFI">');
    box(428, 86, 262, 362, 'FI', 'Fast inward', 600, 439);
    L([[460, 70], [460, 76]]); dot(460, 70);
    contactV('fi_vm', 'FI:Vm', 460, 76, 112, 'fivm', true);
    L([[460, 112], [460, 120], [634, 120]]); tag('FI.Vm', 'Vm', 480, 112);
    cur('iFi', 584, 112);
    diodeV(460, 120, 220, 152, 182, 'fid'); txt(474, 172, 'D1', 'lab');
    dot(460, 220); tag('FI.B3', 'B3', 466, 262);
    resV(460, 220, 405, 280, 350, 'fir3'); txt(470, 322, '3M', 'lab');
    L([[460, 220], [500, 220]]);
    bjt(520, 220, 'n', 0, false, 'qFi3904', 'fi3904'); txt(548, 246, '3904', 'lab');
    L([[534, 190], [534, 170], [600, 170]]); dot(534, 170); tag('FI.B4', 'B4', 538, 160);
    out.push('<g id="gRfe">'); resV(534, 250, 405, 312, 372, 'fire'); out.push('<text id="lRfe" class="lab" x="544" y="348">100 kΩ</text></g>');
    tag('FI.E3', 'E3', 540, 280);
    bjt(620, 170, 'p', 0, false, 'qFi4403', 'fi4403'); txt(646, 166, '4403', 'lab');
    L([[634, 140], [634, 120]]);
    out.push('<g id="gR13">'); resV(634, 200, 310, 214, 262, 'r13'); out.push('<text id="lR13" class="lab" x="626" y="263" text-anchor="end">R13 100 kΩ</text></g>');
    tag('FI.E4', 'E4', 628, 212, 'end');
    beginG('r13p', 'mod');                             /* add-on: across R13 */
    L([[634, 206], [660, 206]]); resV(660, 206, 282, 220, 268, 'r13p', true); L([[660, 282], [634, 282]]);
    dot(634, 206); dot(634, 282); val('r13p', 669, 249);
    endG();
    beginG('rf', 'mod');                               /* add-on: R13 lower end -> FI.E3 */
    resH(296, 634, 534, 610, 560, 'rf'); dot(634, 296); dot(534, 296); val('rf', 585, 318, 'middle');
    endG();
    contactV('fi_vplus', 'FI:V+', 634, 310, 346, 'fivp');
    L([[634, 346], [634, 362]]); tag('FI.V+', 'V+', 634, 380, 'middle');
    L([[460, 405], [534, 405]]); dot(500, 405);
    contactV('fi_gnd', 'FI:GND', 500, 412, 448, 'figd'); L([[500, 405], [500, 412]]); L([[500, 448], [500, 455]]);
    tag('FI.GND', 'GND', 510, 432);
    out.push('</g>');

    /* ---- Slow out ---- */
    out.push('<g id="bSO">');
    box(700, 86, 352, 362, 'SO', 'Slow out', 962, 439);
    L([[740, 70], [740, 76]]); dot(740, 70);
    contactV('so_vm', 'SO:Vm', 740, 76, 112, 'sovm', true);
    L([[740, 112], [740, 120], [994, 120]]); tag('SO.Vm', 'Vm', 760, 112);
    cur('iSo', 944, 112);
    resV(740, 120, 230, 140, 205, 'sor1'); txt(750, 176, '100k', 'lab');
    dot(740, 230); tag('SO.S', 'S', 748, 250);
    capV(740, 230, 405, 320, 'soc'); txt(734, 342, '1µF', 'lab', 'end');
    beginG('rs', 'mod');                               /* add-on: across SO C1 */
    L([[740, 262], [770, 262]]); resV(770, 262, 405, 300, 365, 'rs'); dot(740, 262); dot(770, 405); val('rs', 779, 340);
    endG();
    diodeH(230, 740, 840, 772, 802, 'sod'); txt(787, 216, 'D1', 'lab', 'middle');
    dot(840, 230); tag('SO.B3', 'B3', 834, 272, 'end');
    out.push('<g id="gSoR2">'); resV(840, 230, 405, 290, 360, 'sor2');
    out.push('<text id="lSoR2" class="lab" x="850" y="330">1M</text></g>');   /* PCB label 3M; every board now has the TA's 1 Mohm */
    L([[840, 230], [860, 230]]);
    bjt(880, 230, 'n', 0, false, 'qSo3904', 'so3904'); txt(908, 256, '3904', 'lab');
    L([[894, 200], [894, 170], [960, 170]]); dot(894, 170); tag('SO.B4', 'B4', 900, 160);
    L([[894, 260], [894, 405]]);
    bjt(980, 170, 'p', 0, true, 'qSo4403', 'so4403'); txt(1006, 176, '4403', 'lab');
    L([[994, 140], [994, 120]]);
    resV(994, 200, 405, 260, 330, 'sor1k'); txt(1004, 300, '1k', 'lab');
    tag('SO.C4', 'C4', 988, 222, 'end');
    L([[740, 405], [994, 405]]); dot(840, 405); dot(894, 405); dot(870, 405);
    contactV('so_gnd', 'SO:GND', 870, 412, 448, 'sogd'); L([[870, 405], [870, 412]]); L([[870, 448], [870, 455]]);
    tag('SO.GND', 'GND', 880, 432);
    out.push('</g>');
    }
    out.push('</g>'); GX = 0;

    /* ---- V+ wire along the top: header (n = 0) or pulled wire (n >= 1), plus the breadboard add-ons ---- */
    var TAPS = [];
    if(!po){
      for(k = 1; k <= n; k++) TAPS.push(['ru', ux(k) - 20]);
      TAPS.push(['rb', XA], ['fiw', XR]);
      railVis(false);
      var px0 = 24;
      TAPS.forEach(function(t, i){
        beginG('rail' + i, n ? 'mod' : '');
        L(i ? [[px0, 10], [t[1], 10]] : [[24, 36], [24, 10], [t[1], 10]]);
        endG(); px0 = t[1];
      });
      beginG('fiw', n ? 'mod' : '');
      L([[XR, 10], [XR, 362], [634 + G, 362]]);
      txt(XR + 8, 30, n ? 'V+ 飛線到 FI（Passive 底板沒串 V+）' : 'V+（疊接排針，Stimulator → FI）', 'lab');
      endG();
      beginG('rb', 'mod');                             /* add-on: breadboard V+ row -> Vm row */
      resV(XA, 10, 70, 24, 56, 'rb'); dot(XA, 10); dot(XA, 70); val('rb', XA + 10, 44);
      endG();
      if(!n){
        beginG('rl', 'mod');                           /* extra leak: Vm row -> GND row */
        resV(XA, 70, 455, 230, 330, 'rl'); dot(XA, 70); dot(XA, 455); val('rl', XA + 10, 284);
        endG();
      }
    }
    /* legend */
    var lx = (po ? 430 : XE) + G, ly = po ? 20 : 472;
    out.push('<text class="lab" x="' + lx + '" y="' + ly + '" text-anchor="end"><tspan class="lgm">━━</tspan> 和原版電路不同' +
      (live ? '　<tspan class="lge">●</tspan> 電子（逆著電流、往電池 + 極走；越快＝電流越大）' : '') + '</text>');

    svg.setAttribute('viewBox', '0 0 ' + ((po ? 480 : 1080) + G) + ' 480');
    svg.classList.add('msch'); if(live) svg.classList.add('live');
    svg.innerHTML = out.join('');

    var tags = Array.prototype.slice.call(svg.querySelectorAll('[data-node]'));
    function fmtR(x){ return x >= 1e6 ? (x / 1e6) + ' MΩ' : x >= 1e3 ? (x / 1e3) + ' kΩ' : x + ' Ω'; }
    function fmtS(x){ return x >= 1e6 ? (x / 1e6) + 'M' : x >= 1e3 ? (x / 1e3) + 'k' : x + 'Ω'; }

    /* ---------------- show / hide, rail ---------------- */
    var dirty = true;
    function setKey(key, on){
      on = !!on;
      if(VIS[key] === on) return;
      VIS[key] = on; dirty = true;
      svg.querySelectorAll('[data-key="' + key + '"]').forEach(function(g){ g.style.display = on ? '' : 'none'; });
    }
    /* rail piece i is needed when any tap at or right of it is fitted */
    function railVis(dom){
      for(var i = 0; i < TAPS.length; i++){
        var need = false;
        for(var j = i; j < TAPS.length; j++) if(VIS[TAPS[j][0]]) need = true;
        if(dom) setKey('rail' + i, need); else VIS['rail' + i] = need;
      }
    }

    /* ---------------- electron flow ---------------- */
    var EF = null, FL = null, PROBES = [];
    /* where a scope probe on node `code` takes its current from (its ground clip is on the battery minus) */
    function probePt(code){
      var m = /^(PC|PX)(\d)$/.exec(code || ''), q = function(x, y){ return [x + G, y]; };
      if(m) return m[1] === 'PC' ? [ux(+m[2]), 70] : [ux(+m[2]) - 26, 455];
      return ({'Vm':q(XE, 70), 'AX':q(XE, 455), 'SO.S':q(740, 230), 'SO.B3':q(840, 230), 'FI.E4':q(634, 200),
               'FI.E3':q(534, 250), 'FI.V+':q(634, 310)})[code] || null;
    }
    function shown(keys){ for(var i = 0; i < keys.length; i++) if(VIS[keys[i]] === false) return false; return true; }
    function pk(p){ return (Math.round(p[0] * 2) / 2) + ',' + (Math.round(p[1] * 2) / 2); }
    /* wires -> graph (split at every endpoint or terminal lying on a wire; crossings stay apart), a spanning
       tree per electrical node rooted at a battery terminal when there is one, then the drawn pieces:
       chains of tree edges between junctions, element paths, battery paths */
    function buildFlow(){
      dirty = false;
      var pts = {}, segs = [], els = ELS.filter(function(e){ return shown(e.keys); }), srcs = SRCS.filter(function(s){ return shown(s.keys); });
      function add(p){ var key = pk(p); if(!pts[key]) pts[key] = p; return key; }
      WIRES.forEach(function(w){
        if(!shown(w.keys)) return;
        for(var i = 0; i + 1 < w.pts.length; i++){ add(w.pts[i]); add(w.pts[i + 1]); segs.push([w.pts[i], w.pts[i + 1]]); }
      });
      els.forEach(function(e){ e.T.forEach(add); });
      srcs.forEach(function(s){ add(s.p); add(s.m); });
      var probes = PROBES.map(function(p){ return p ? add(p) : null; });
      var keys = Object.keys(pts), plist = keys.map(function(q){ return pts[q]; }), adj = {}, seen = {};
      keys.forEach(function(q){ adj[q] = []; });
      function link(a, b){
        var ka = pk(a), kb = pk(b), ek = ka < kb ? ka + '|' + kb : kb + '|' + ka;
        if(ka === kb || seen[ek]) return;
        seen[ek] = 1; adj[ka].push(kb); adj[kb].push(ka);
      }
      segs.forEach(function(s){
        var a = s[0], b = s[1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, on = [[0, a], [1, b]];
        if(!l2) return;
        plist.forEach(function(p){
          var t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
          if(t <= 1e-6 || t >= 1 - 1e-6) return;
          var ex = a[0] + t * dx - p[0], ey = a[1] + t * dy - p[1];
          if(ex * ex + ey * ey < 0.01) on.push([t, p]);
        });
        on.sort(function(u, v){ return u[0] - v[0]; });
        for(var i = 0; i + 1 < on.length; i++) link(on[i][1], on[i + 1][1]);
      });
      var term = {}, isSrc = {};
      els.forEach(function(e){ e.TK = e.T.map(function(p){ var q = pk(p); term[q] = 1; return q; }); });
      probes.forEach(function(q){ if(q) term[q] = 1; });
      srcs.forEach(function(s){ s.pk = pk(s.p); s.mk = pk(s.m); isSrc[s.pk] = isSrc[s.mk] = 1; });
      keys.sort(function(a, b){ return (isSrc[b] ? 1 : 0) - (isSrc[a] ? 1 : 0); });
      var parent = {}, kids = {}, order = [];
      keys.forEach(function(k0){
        if(k0 in parent) return;
        parent[k0] = null;
        for(var q = [k0], i = 0; i < q.length; i++){
          var u = q[i]; order.push(u); kids[u] = [];
          adj[u].forEach(function(w){ if(!(w in parent)){ parent[w] = u; kids[u].push(w); q.push(w); } });
        }
      });
      function nb(u){ return parent[u] === null ? kids[u] : kids[u].concat([parent[u]]); }
      function junction(u){ return nb(u).length !== 2 || term[u] || isSrc[u] || parent[u] === null; }
      var items = [], used = {};
      function ekey(a, b){ return a < b ? a + '|' + b : b + '|' + a; }
      keys.forEach(function(u){
        if(!junction(u)) return;
        nb(u).forEach(function(w){
          if(used[ekey(u, w)]) return;
          used[ekey(u, w)] = 1;
          var path = [u], prev = u, c = w;
          for(;;){
            path.push(c);
            if(junction(c)) break;
            var nx2 = nb(c).filter(function(z){ return z !== prev; })[0];
            used[ekey(c, nx2)] = 1; prev = c; c = nx2;
          }
          /* along u -> w: if w hangs below u the tree edge carries S[w] upward, i.e. against the path */
          var child = parent[w] === u ? w : u, sign = child === w ? -1 : 1;
          items.push({pts:path.map(function(q){ return pts[q]; }), get:function(S){ return sign * S[child]; }});
        });
      });
      els.forEach(function(e){
        e.P.forEach(function(path, i){ items.push({pts:path, get:function(){ return e.q ? e.cur[i] : e.cur; }}); });
      });
      srcs.forEach(function(s){ items.push({pts:[s.m, s.p], get:function(S){ return -S[s.pk]; }}); });
      if(!EF){ EF = document.createElementNS(NS, 'g'); EF.setAttribute('class', 'ef'); }
      svg.appendChild(EF);
      EF.innerHTML = '';
      items.forEach(function(it){
        it.el = document.createElementNS(NS, 'path');
        it.el.setAttribute('d', 'M' + it.pts.map(function(p){ return p[0] + ' ' + p[1]; }).join('L'));
        it.el.style.display = 'none'; it.on = false; it.off = 0;
        EF.appendChild(it.el);
      });
      FL = {els:els, keys:keys, order:order, parent:parent, items:items, probes:probes};
    }
    var Z3 = [0, 0, 0];
    function flow(dt, cur){
      if(!cur){ if(EF) EF.style.display = 'none'; return; }
      if(dirty || !FL) buildFlow();
      EF.style.display = '';
      var S = {}, i, u;
      FL.keys.forEach(function(q){ S[q] = 0; });
      FL.els.forEach(function(e){
        if(e.q){ e.cur = cur[e.name] || Z3; for(var j = 0; j < 3; j++) S[e.TK[j]] -= e.cur[j]; }
        else { e.cur = cur[e.name] || 0; S[e.TK[0]] -= e.cur; S[e.TK[1]] += e.cur; }
      });
      FL.probes.forEach(function(q, j){ if(q) S[q] -= cur['p' + (j + 1)] || 0; });
      for(i = FL.order.length - 1; i >= 0; i--){ u = FL.order[i]; if(FL.parent[u] !== null) S[FL.parent[u]] += S[u]; }
      FL.items.forEach(function(it){
        var I = it.get(S), a = Math.abs(I);
        it.el._I = I;                                    /* for checking from the console */
        if(!(a >= 2e-8)){ if(it.on){ it.el.style.display = 'none'; it.on = false; } return; }
        if(!it.on){ it.el.style.display = ''; it.on = true; }
        var v = Math.min(240, 2742 * Math.pow(a, 0.38));
        it.off = (it.off + (I > 0 ? v : -v) * dt) % SP;   /* dashes drift toward the path start as the offset grows */
        it.el.setAttribute('stroke-dashoffset', it.off.toFixed(2));
        it.el.style.opacity = (0.45 + 0.55 * Math.max(0, Math.min(1, (Math.log(a) / Math.LN10 + 7.7) / 4))).toFixed(2);
      });
    }

    return {
      setValues: function(fn){
        tags.forEach(function(t){
          var v = fn(t.dataset.node); if(v === null || v === undefined) return;
          var s = t.dataset.mv ? (v * 1e3).toFixed(1) + ' mV' : v.toFixed(2) + ' V', short = t.dataset.short;
          if(t.dataset.bus){ t.textContent = short + ' ' + s; return; }
          if(t.dataset.two){
            var x = t.getAttribute('x');
            t.innerHTML = '<tspan class="code" x="' + x + '">' + short + '</tspan><tspan x="' + x + '" dy="13">' + s + '</tspan>';
          } else t.innerHTML = '<tspan class="code">' + short + '</tspan> ' + s;
        });
      },
      setCurrents: function(c){
        var u = function(a){ return (a * 1e6).toFixed(1) + ' µA'; };
        var e;
        if((e = svg.querySelector('#iStim'))) e.textContent = 'I_stim ' + u(c.iStim);
        if((e = svg.querySelector('#iFi'))) e.textContent = 'I_FI ' + u(c.iFi);
        if((e = svg.querySelector('#iSo'))) e.textContent = 'I_SO ' + u(c.iSo);
      },
      setOn: function(map){ for(var id in map){ var c = svg.querySelector('#' + id); if(c) c.classList.toggle('on', !!map[id]); } },
      setContacts: function(st){
        svg.querySelectorAll('.contact').forEach(function(g){
          var key = g.dataset.c, closed = !!st[key];
          g.classList.toggle('open', !closed);
          var b = g.querySelector('.blade'), x = +b.dataset.x, y1 = +b.dataset.y1;
          b.setAttribute('x2', closed ? x : x + 14); b.setAttribute('y2', closed ? y1 : y1 + 4);
        });
      },
      /* 'pcb' as built, 'sw' Qsense emitter moved after SW, 'rx*' a resistor across Qpass E-B */
      setQsense: function(mode){
        setKey('qspcb', mode !== 'sw'); setKey('qssw', mode === 'sw'); setKey('rx', /^rx/.test(mode));
        var t = svg.querySelector('[data-v="rx"]'); if(t) t.textContent = ({rx:'22k', rx10:'10k', rx12:'12k'})[mode] || '';
      },
      /* add-on resistors clipped onto existing legs */
      setAddons: function(st){
        ['r13p', 'rf', 'rb', 'rl', 'rs', 'ru'].forEach(function(key){
          setKey(key, st[key]);
          svg.querySelectorAll('[data-v="' + key + '"]').forEach(function(t){ t.textContent = st[key] ? fmtS(st[key]) : ''; });
        });
        railVis(true);
        var bm = svg.querySelector('#gBatM');
        if(bm && st.vplus !== undefined) bm.classList.toggle('mod', Math.abs(st.vplus - 7.8) > 1e-6);
      },
      setSupply: function(mode){
        setKey('fiw', mode === 'stim' || (!n && mode !== 'local')); setKey('bat', mode === 'local'); railVis(true);
      },
      setBoards: function(m){
        [['bLK', m.lk], ['bFI', m.fi], ['bSO', m.so]].forEach(function(a){
          var g = svg.querySelector('#' + a[0]); if(g) g.classList.toggle('ghost', a[1] === false);
        });
      },
      setSource: function(src){ setKey('isrc', src === 'ideal'); },
      /* [ch1, ch2] node codes; their 10 Mohm probes draw current at the scope label */
      setProbes: function(codes){
        var p = codes.map(function(c){ return c ? probePt(c) : null; });
        if(JSON.stringify(p) !== JSON.stringify(PROBES)){ PROBES = p; dirty = true; }
      },
      setResistors: function(r13, rfe, soR2){
        var e;
        if((e = svg.querySelector('#lR13'))) e.textContent = 'R13 ' + fmtR(r13);
        if((e = svg.querySelector('#lRfe'))) e.textContent = fmtR(rfe);
        if(soR2 && (e = svg.querySelector('#lSoR2'))) e.textContent = fmtR(soR2);
        [['gR13', r13 !== 1e5], ['gRfe', rfe !== 1e5], ['gSoR2', !!soR2 && soR2 !== 1e6]].forEach(function(a){
          var g = svg.querySelector('#' + a[0]); if(g) g.classList.toggle('mod', a[1]);
        });
      },
      flow: flow
    };
  };
})();
