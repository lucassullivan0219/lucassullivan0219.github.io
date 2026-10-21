/* Schematic of the HW3 circuits, every board drawn in full (no module boxes).  Two rows:
     row 1  Stimulator A -> pre active membrane (Leak, Fast inward, Slow out) -> synapse
     row 2  Stimulator B -> post (5 passive units, or active membrane 2); the synapse output comes down on the right
   The Stimulator, the active membrane and the passive units keep the HW2 layout (../active-membrane-sim/schematic.js,
   the same coordinates); HW3 has no pluggable contacts, so those are plain wires here.

   var s = SynSchematic(svg, {syn:'exc'|'inh', post:'passive'|'active'});
   s.setState(st)     engine state: pre / postMem variants, MEM (engine variant table), r1p, r6, bat, vbat, swA, swB, vplus
                      (everything that differs from the kit circuit is drawn in --mod)
   s.setValues(fn)    fn(code) -> volts for every tagged node (engine node codes: SA.P, A.FI.B3, SY.S, P1, ...)
   s.setCurrents({A, B})  Stimulator output currents (A)
   s.setOn(fn)        fn(tag) -> true for a conducting transistor; tags are the engine's (SA.pass, A.fi4403, sy.q1, ...)
   s.setProbes([ch1, ch2])
*/
(function(){
  var CSS = [
    '.ssch .w{stroke:var(--ink);stroke-width:1.6;fill:none;stroke-linecap:round;stroke-linejoin:round}',
    '.ssch .vm{stroke:var(--vmbus,#2a78d6);stroke-width:3}',
    '.ssch .sym{stroke:var(--ink);stroke-width:1.6;fill:none;stroke-linejoin:round}',
    '.ssch .fillk{fill:var(--ink);stroke:none}',
    '.ssch .dotn{fill:var(--ink)}',
    '.ssch .box{fill:none;stroke:var(--rule);stroke-width:1.4;stroke-dasharray:5 4}',
    '.ssch .sbox{fill:none;stroke-width:1.6;stroke-dasharray:6 4}',
    '.ssch .bt{fill:var(--muted);font-size:13px;font-weight:700}',
    '.ssch .btk{fill:var(--ink);font-size:14px;font-weight:700}',
    '.ssch .lab{fill:var(--muted);font-size:11.5px}',
    '.ssch .nv{fill:var(--ink);font-size:11.5px;font-family:"IBM Plex Mono",ui-monospace,monospace}',
    '.ssch .nv .code{fill:var(--link);font-weight:700}',
    '.ssch .sv{fill:var(--link);font-size:11.5px;font-family:"IBM Plex Mono",ui-monospace,monospace}',
    '.ssch .nvb{fill:var(--vmbus,#2a78d6);font-size:15px;font-weight:700;font-family:"IBM Plex Mono",ui-monospace,monospace}',
    '.ssch .cur{fill:var(--opt);font-size:11.5px;font-family:"IBM Plex Mono",ui-monospace,monospace}',
    '.ssch .qc{fill:transparent;stroke:var(--ink);stroke-width:1.2}',
    '.ssch .qc.on{fill:var(--qon,rgba(42,120,214,.16))}',
    '.ssch .blade{stroke-width:2.4;stroke-linecap:round}',
    '.ssch .ghost{opacity:.22}',
    '.ssch .mod .w,.ssch .mod .sym,.ssch .w.mod{stroke:var(--mod,#b0307f)}',
    '.ssch .mod .w{stroke-width:2}',
    '.ssch .mod .dotn,.ssch .mod .fillk,.ssch .mod .lab,.ssch .modt,.ssch .lgm{fill:var(--mod,#b0307f)}',
    '.ssch .mod .lab,.ssch .modt{font-weight:700}',
    '.ssch .chip rect{stroke:none}',
    '.ssch .chip text{font-size:12px;font-weight:700;fill:#10161a;font-family:"IBM Plex Mono",ui-monospace,monospace}'
  ].join('\n');
  if(!document.getElementById('ssch-css')){
    var el = document.createElement('style'); el.id = 'ssch-css'; el.textContent = CSS; document.head.appendChild(el);
  }
  var YT = 70, YG = 455;                       /* Vm bus and GND in each row (HW2 coordinates) */
  var R2 = 520;                                /* row 2 starts this far down */
  var MG = 60;                                 /* the active membrane group sits MG right of HW2's x (a breadboard column) */
  var SX = 832;                                /* synapse drawn in its own coordinates (input at 300), shifted by SX */
  var XD = 1580;                               /* x of the wire that takes the synapse output down to row 2 */
  var W = 1620, H = R2 + 480;
  var COL = {A:'#c9a227', B:'#9b6bd6'};

  window.SynSchematic = function(svg, opts){
    var syn = opts.syn || 'exc', passive = (opts.post || 'passive') === 'passive', out = [];
    function ux(k){ return 370 + (k - 1) * 130; }   /* wire x of passive unit k (HW2 #2-3) */

    function L(pts, cls, attr){ out.push('<polyline class="' + (cls || 'w') + '"' + (attr || '') + ' points="' + pts.map(function(p){ return p.join(','); }).join(' ') + '"/>'); }
    function dot(x, y){ out.push('<circle class="dotn" cx="' + x + '" cy="' + y + '" r="3"/>'); }
    function txt(x, y, s, cls, anchor, attr){ out.push('<text class="' + cls + '" x="' + x + '" y="' + y + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + (attr || '') + '>' + s + '</text>'); }
    function g(attr){ out.push('<g ' + attr + '>'); }
    function eg(){ out.push('</g>'); }
    /* node tag: "B3" until values arrive, then "B3 0.37 V" */
    function tag(code, short, x, y, anchor){
      out.push('<text class="nv" data-node="' + code + '" data-short="' + short + '" x="' + x + '" y="' + y + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + '><tspan class="code">' + short + '</tspan></text>');
    }
    /* value only (synapse nodes, which carry their own letter) */
    function nv(code, x, y, anchor){ out.push('<text class="sv" data-node="' + code + '" x="' + x + '" y="' + y + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + '></text>'); }
    function resV(x, y1, y2, a, b){
      L([[x, y1], [x, a]]);
      var pts = [[x, a]], seg = (b - a) / 12;
      for(var i = 1; i < 12; i++) pts.push([x + (i % 2 ? 7 : -7), a + seg * i]);
      pts.push([x, b]); L(pts, 'sym'); L([[x, b], [x, y2]]);
    }
    function resH(y, x1, x2, a, b){
      L([[x1, y], [a, y]]);
      var pts = [[a, y]], seg = (b - a) / 10;
      for(var i = 1; i < 10; i++) pts.push([a + seg * i, y + (i % 2 ? -6 : 6)]);
      pts.push([b, y]); L(pts, 'sym'); L([[b, y], [x2, y]]);
    }
    function capV(x, y1, y2, yc){
      L([[x, y1], [x, yc - 4]]); L([[x - 13, yc - 4], [x + 13, yc - 4]], 'sym'); L([[x - 13, yc + 4], [x + 13, yc + 4]], 'sym'); L([[x, yc + 4], [x, y2]]);
    }
    function diodeV(x, y1, y2, a, b){
      L([[x, y1], [x, a]]);
      out.push('<polygon class="sym" points="' + (x - 9) + ',' + a + ' ' + (x + 9) + ',' + a + ' ' + x + ',' + b + '"/>');
      L([[x - 9, b], [x + 9, b]], 'sym'); L([[x, b], [x, y2]]);
    }
    function diodeH(y, x1, x2, a, b){
      L([[x1, y], [a, y]]);
      out.push('<polygon class="sym" points="' + a + ',' + (y - 9) + ' ' + a + ',' + (y + 9) + ' ' + b + ',' + y + '"/>');
      L([[b, y - 9], [b, y + 9]], 'sym'); L([[b, y], [x2, y]]);
    }
    /* battery, vertical: + plate (long) at yp, - plate (short) at yn */
    function batV(x, yp, yn){
      L([[x - 14, yp], [x + 14, yp]], 'sym'); L([[x - 7, yn], [x + 7, yn]], 'sym', ' style="stroke-width:3.2"');
      txt(x - 20, yp + (yp > yn ? 12 : -4), '+', 'lab', 'middle');
    }
    /* BJT (HW2 symbol) in a local frame: base lead (-20,0)-(0,0), bar at x = 0, leads end at (14,-30) and (14,30);
       eTop: the emitter is the (14,-30) lead.  q = the engine's transistor tag, for setOn */
    function bjt(cx, cy, type, rot, eTop, q){
      var s = eTop ? -1 : 1, ex0 = 0, ey0 = 6 * s, ex1 = 14, ey1 = 18 * s;
      var dxv = ex1 - ex0, dyv = ey1 - ey0, len = Math.sqrt(dxv * dxv + dyv * dyv), ux2 = dxv / len, uy = dyv / len;
      var tipT = type === 'n' ? 0.95 : 0.35, tx = ex0 + dxv * tipT, ty = ey0 + dyv * tipT, dir = type === 'n' ? 1 : -1;
      var bx = tx - ux2 * 7 * dir, by = ty - uy * 7 * dir, px = -uy * 4, py = ux2 * 4;
      out.push('<g transform="translate(' + cx + ',' + cy + ') rotate(' + rot + ')">' +
        '<circle data-q="' + q + '" class="qc" cx="5" cy="0" r="21"/>' +
        '<polyline class="sym" points="-20,0 0,0"/><polyline class="sym" points="0,-12 0,12" style="stroke-width:2.6"/>' +
        '<polyline class="sym" points="0,-6 14,-18 14,-30"/><polyline class="sym" points="0,6 14,18 14,30"/>' +
        '<polygon class="fillk" points="' + tx + ',' + ty + ' ' + (bx + px) + ',' + (by + py) + ' ' + (bx - px) + ',' + (by - py) + '"/></g>');
    }
    function box(x, y, w, h, code, name, tx, ty, stacked, color){
      out.push('<rect class="box" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="6"' + (color ? ' style="stroke:' + color + ';stroke-width:1.8"' : '') + '/>');
      if(stacked) out.push('<text class="bt" x="' + tx + '" y="' + ty + '" text-anchor="middle">' + code +
        '<tspan class="lab" x="' + tx + '" dy="15">' + name + '</tspan></text>');
      else out.push('<text class="bt" x="' + tx + '" y="' + ty + '">' + code + ' <tspan class="lab">' + name + '</tspan></text>');
    }
    /* add-on part of a membrane variant (HW2 true AP), shown by setState */
    function mod(key){ g('data-mod="' + key + '" class="mod" style="display:none"'); }
    function modVal(key, x, y, anchor){ txt(x, y, '', 'lab', anchor, ' data-mv="' + key + '"'); }

    /* ---- Stimulator (HW2 layout), p = 'SA' | 'SB', in row coordinates ---- */
    function stimulator(p, who){
      box(14, 18, 308, 430, 'Stimulator ' + who, '', 40, 439, false, COL[who]);
      L([[24, 36], [74, 36]]); L([[24, 36], [24, 340]]);
      g('data-bat="' + p + '"'); L([[12, 340], [36, 340]], 'sym'); L([[18, 350], [30, 350]], 'sym', ' style="stroke-width:3.2"'); txt(30, 334, '+', 'lab'); eg();
      txt(42, 352, '電池', 'lab');
      L([[24, 350], [24, YG]]); dot(24, YG);
      tag('V+', 'V+', 30, 30);
      L([[74, 36], [74, 58]]);
      out.push('<circle class="dotn" cx="74" cy="58" r="2.6"/><circle class="dotn" cx="74" cy="92" r="2.6"/>');
      out.push('<line class="w blade" id="' + p + '-blade" x1="74" y1="92" x2="88" y2="62" style="stroke:' + COL[who] + '"/>');
      txt(66, 80, 'SW ' + who, 'lab', 'end');
      L([[74, 92], [74, 110]]); dot(74, 110); tag(p + '.P', 'P', 80, 134);
      resH(110, 74, 134, 84, 122);
      out.push('<polyline class="sym" points="88,122 116,96"/><polygon class="fillk" points="119,93 110,96 115,101"/>');
      txt(100, 90, 'pot', 'lab', 'middle', ' data-pot="' + p + '"');
      dot(134, 110); tag(p + '.K', 'K', 134, 150);
      resH(110, 134, 196, 144, 186); txt(165, 96, '7k', 'lab', 'middle');
      dot(196, 110); tag(p + '.Q', 'Q', 200, 96);
      L([[196, 110], [200, 110]]);
      bjt(230, 124, 'p', -90, true, p + '.pass'); txt(242, 160, 'Q_pass', 'lab');
      L([[260, 110], [276, 110], [276, YT]]);
      out.push('<text class="cur" id="' + p + '-cur" x="272" y="62" text-anchor="end"></text>');
      L([[230, 144], [230, 220]]);
      L([[196, 110], [196, 186]]);
      mod(p + '-rx');                                  /* HW2 true AP: 22 kohm across Q_pass E-B */
      resH(158, 196, 230, 202, 224); dot(196, 158); dot(230, 158); modVal(p + '-rx', 213, 179, 'middle');
      eg();
      bjt(196, 206, 'p', 90, false, p + '.sense'); txt(196, 252, 'Q_sense', 'lab', 'middle');
      L([[226, 220], [230, 220]]); dot(230, 220); tag(p + '.R', 'R', 238, 216);
      L([[166, 220], [24, 220]]); dot(24, 220);
      resV(230, 220, YG, 300, 380); txt(240, 345, '7k', 'lab'); dot(230, YG);
    }

    /* ---- active membrane (HW2 #2-2 layout: LK, FI, SO straight on Vm), p = 'A' | 'B'; drawn shifted by MG ---- */
    function membrane(p){
      out.push('<g transform="translate(' + MG + ',0)">');
      L([[370, YT], [1040, YT]], 'w vm');
      L([[344, YG], [1040, YG]]);
      /* Leak */
      box(332, 86, 86, 362, 'LK', 'Leak', 370, 210, true);
      L([[370, YT], [370, 130]]); dot(370, YT);
      L([[344, 130], [396, 130]]); dot(370, 130);
      capV(344, 130, YG, 290); txt(370, 302, '1µF', 'lab', 'middle');
      resV(396, 130, YG, 250, 330); txt(370, 345, '100k', 'lab', 'middle');
      dot(344, YG); dot(396, YG);
      /* Fast inward */
      box(428, 86, 262, 362, 'FI', 'Fast inward', 600, 439);
      L([[460, YT], [460, 120], [634, 120]]); dot(460, YT);
      diodeV(460, 120, 220, 152, 182); txt(474, 172, 'D1', 'lab');
      dot(460, 220); tag(p + '.FI.B3', 'B3', 466, 262);
      resV(460, 220, 405, 280, 350); txt(470, 322, '3M', 'lab');
      L([[460, 220], [500, 220]]);
      bjt(520, 220, 'n', 0, false, p + '.fi3904'); txt(548, 246, '3904', 'lab');
      L([[534, 190], [534, 170], [600, 170]]); dot(534, 170); tag(p + '.FI.B4', 'B4', 538, 160);
      resV(534, 250, 405, 312, 372); txt(544, 348, '100k', 'lab');
      tag(p + '.FI.E3', 'E3', 540, 280);
      bjt(620, 170, 'p', 0, false, p + '.fi4403'); txt(646, 166, '4403', 'lab');
      L([[634, 140], [634, 120]]);
      resV(634, 200, 310, 214, 262); txt(626, 263, 'R13 100k', 'lab', 'end');
      tag(p + '.FI.E4', 'E4', 628, 212, 'end');
      mod(p + '-r13p');                                /* across R13 */
      L([[634, 206], [660, 206]]); resV(660, 206, 282, 220, 268); L([[660, 282], [634, 282]]);
      dot(634, 206); dot(634, 282); modVal(p + '-r13p', 669, 249);
      eg();
      mod(p + '-rf');                                  /* V+ (R13 lower end) -> FI.E3 */
      resH(296, 634, 534, 610, 560); dot(634, 296); dot(534, 296); modVal(p + '-rf', 585, 318, 'middle');
      eg();
      L([[634, 310], [634, 362]]); tag('V+', 'V+', 642, 340);
      L([[460, 405], [534, 405]]); dot(500, 405); L([[500, 405], [500, YG]]); dot(500, YG);
      /* Slow out */
      box(700, 86, 352, 362, 'SO', 'Slow out', 962, 439);
      L([[740, YT], [740, 120], [994, 120]]); dot(740, YT);
      resV(740, 120, 230, 140, 205); txt(750, 176, '100k', 'lab');
      dot(740, 230); tag(p + '.SO.S', 'S', 748, 250);
      capV(740, 230, 405, 320); txt(734, 342, '1µF', 'lab', 'end');
      mod(p + '-rs');                                  /* across SO C1 */
      L([[740, 262], [770, 262]]); resV(770, 262, 405, 300, 365); dot(740, 262); dot(770, 405); modVal(p + '-rs', 779, 340);
      eg();
      diodeH(230, 740, 840, 772, 802); txt(787, 216, 'D1', 'lab', 'middle');
      dot(840, 230); tag(p + '.SO.B3', 'B3', 834, 272, 'end');
      resV(840, 230, 405, 290, 360); txt(850, 330, '1M', 'lab');
      L([[840, 230], [860, 230]]);
      bjt(880, 230, 'n', 0, false, p + '.so3904'); txt(908, 256, '3904', 'lab');
      L([[894, 200], [894, 170], [960, 170]]); dot(894, 170); tag(p + '.SO.B4', 'B4', 900, 160);
      L([[894, 260], [894, 405]]);
      bjt(980, 170, 'p', 0, true, p + '.so4403'); txt(1006, 176, '4403', 'lab');
      L([[994, 140], [994, 120]]);
      resV(994, 200, 405, 260, 330); txt(1004, 300, '1k', 'lab');
      tag(p + '.SO.C4', 'C4', 988, 222, 'end');
      L([[740, 405], [994, 405]]); dot(840, 405); dot(894, 405); dot(870, 405);
      L([[870, 405], [870, YG]]); dot(870, YG);
      eg();
      /* V+ along the top: stacked header from the Stimulator's battery to FI */
      L([[24, 36], [24, 10], [695 + MG, 10], [695 + MG, 362], [634 + MG, 362]]);
      txt(703 + MG, 30, 'V+（疊接排針，Stimulator → FI）', 'lab');
      mod(p + '-rb');                                  /* breadboard: V+ row -> Vm row */
      resV(352, 10, YT, 24, 56); dot(352, 10); dot(352, YT); modVal(p + '-rb', 362, 44);
      eg();
      L([[276, YT], [370 + MG, YT]], 'w vm');
      out.push('<text class="nvb" data-node="' + p + '.Vm" data-bus="' + (p === 'A' ? 'Pre' : 'Post') + ' Vm =" x="' + (640 + MG) + '" y="58" text-anchor="middle">' + (p === 'A' ? 'Pre' : 'Post') + ' Vm</text>');
      out.push('<text class="lab" data-var="' + p + '" x="' + (560 + MG) + '" y="36" text-anchor="middle"></text>');
    }

    /* ---- 5 passive units (HW2 #2-3 units: 1 uF || 100 kohm, 10 kohm apart; HW3 has no 100 ohm on the extracellular row) ---- */
    function passiveChain(){
      L([[276, YT], [ux(1), YT]]);
      L([[20, YG], [ux(5) + 26, YG]]);
      for(var k = 1; k <= 5; k++){
        var x = ux(k), gap = 418 + (k - 1) * 130;
        box(332 + (k - 1) * 130, 86, 86, 362, '#' + k, 'Passive', x, 230, true);
        L([[x, YT], [x, 130]]); dot(x, YT); L([[x - 26, 130], [x + 26, 130]]); dot(x, 130);
        capV(x - 26, 130, YG, 290); txt(x, 302, '1µF', 'lab', 'middle');
        resV(x + 26, 130, YG, 250, 330); txt(x, 345, '100k', 'lab', 'middle');
        L([[x - 26, YG], [x + 26, YG]]); dot(x - 26, YG); dot(x + 26, YG);
        tag('P' + k, '#' + k, x + 6, 108);
        if(k < 5){ resH(YT, x, ux(k + 1), gap + 4, gap + 40); txt(gap + 22, 62, '10k', 'lab', 'middle'); }
      }
    }

    /* ---- synapse (handout PCB), in its own coordinates: input at x = 300, output at x = 720 ---- */
    function synapse(){
      var col = syn === 'exc' ? 'var(--warn)' : 'var(--link)';
      out.push('<g transform="translate(' + SX + ',0)">');
      out.push('<rect class="sbox" x="292" y="30" width="418" height="410" rx="10" style="stroke:' + col + '"/>');
      txt(298, 22, syn === 'exc' ? 'Excitatory synapse' : 'Inhibitory synapse', 'btk');
      L([[290, YG], [720, YG]]);
      resH(YT, 300, 380, 318, 364); txt(341, YT + 20, '820 kΩ', 'lab', 'middle');
      g('data-mod="r1p" class="mod" style="display:none"');
      L([[304, YT], [304, 50]]); resH(50, 304, 378, 318, 364); L([[378, 50], [378, YT]]); dot(304, YT);
      out.push('<text class="lab" data-r1p x="341" y="42" text-anchor="middle"></text>');
      eg();
      dot(380, YT);
      diodeV(380, YT, 160, 104, 120); txt(370, 118, '1N4148 D1', 'lab', 'end'); tag('SY.A', 'A', 386, YT - 6);
      dot(380, 160); L([[340, 160], [404, 160]]); dot(340, 160);
      capV(340, 160, YG, 212); txt(326, 216, '10 nF', 'lab', 'end'); dot(340, YG);
      resV(380, 160, YG, 190, 240); txt(390, 222, '100 kΩ', 'lab'); dot(380, YG);
      nv('SY.B', 334, 150, 'end');
      var yq2 = 160;
      bjt(424, yq2, 'n', 0, false, 'sy.q2'); txt(452, yq2 + 28, 'Q2 3904', 'lab');
      var yq1 = 122;
      L([[438, yq2 - 30], [438, yq1], [454, yq1]]);
      resV(438, yq2 + 30, YG, 236, 282); txt(428, 266, '30 kΩ', 'lab', 'end'); dot(438, YG); tag('SY.E2', 'E2', 444, 232);
      tag('SY.C2', 'C2', 434, 100, 'end');
      if(syn === 'exc'){
        bjt(474, yq1, 'p', 0, false, 'sy.q1'); txt(500, yq1 - 4, 'Q1 4403', 'lab');   /* emitter at the bottom */
        L([[488, yq1 - 30], [488, YT], [520, YT]]); dot(520, YT);
        resV(488, yq1 + 30, 252, 196, 236); txt(498, 212, '1 kΩ', 'lab'); tag('SY.E1', 'E1', 494, 160);
        batV(488, 262, 272); L([[488, 252], [488, 262]]); L([[488, 272], [488, YG]]); dot(488, YG);
        out.push('<text class="lab" data-vplus x="500" y="290"></text>');
        txt(520, YT - 10, 'S', 'btk', 'middle'); nv('SY.S', 530, YT - 24);
        L([[520, YT], [640, YT]]);
        dot(560, YT); capV(560, YT, YG, 175); txt(548, 172, '4.7 µF', 'lab', 'end'); dot(560, YG);
        dot(615, YT); resV(615, YT, YG, 150, 210); txt(625, 196, '200 kΩ', 'lab'); dot(615, YG);
        diodeH(YT, 640, 662, 646, 662); txt(640, YT + 24, 'D2', 'lab'); tag('SY.D', 'D', 668, YT + 24);
        L([[662, YT], [670, YT]]);
        g('data-mod="r6" class="mod"'); resH(YT, 670, 720, 675, 705); txt(690, YT - 12, '100 kΩ', 'lab', 'middle'); eg();
        g('data-mod="r6w"'); L([[670, YT], [720, YT]]); eg();
      } else {
        bjt(474, yq1, 'p', 0, true, 'sy.q1'); txt(500, yq1 + 30, 'Q1 4403', 'lab');     /* emitter at the top */
        g('data-mod="bat"'); L([[488, yq1 - 30], [488, 88]]); batV(488, 88, 78); L([[488, 78], [488, 56], [540, 56], [540, YT]]); eg();
        g('data-mod="batshort" class="mod" style="display:none"'); L([[488, yq1 - 30], [488, 56], [540, 56], [540, YT]]); txt(480, 80, '跳線', 'lab', 'end'); eg();
        out.push('<text class="lab" data-vbat x="504" y="86"></text>'); tag('SY.E1', 'E1', 500, 104);
        dot(540, YT); txt(552, YT - 8, 'S', 'btk'); nv('SY.S', 566, YT - 8);
        resV(488, yq1 + 30, YG, 230, 276); txt(498, 266, '15 kΩ', 'lab'); dot(488, YG); tag('SY.C1', 'C1', 494, 196);
        L([[540, YT], [650, YT]]);
        dot(580, YT); capV(580, YT, YG, 175); txt(568, 172, '4.7 µF', 'lab', 'end'); dot(580, YG);
        dot(630, YT); resV(630, YT, YG, 150, 210); txt(640, 196, '200 kΩ', 'lab'); dot(630, YG);
        resH(YT, 650, 720, 662, 702); txt(682, YT - 12, '100 kΩ', 'lab', 'middle');
      }
      eg();
    }

    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '">');
    out.push('<g class="ssch">');

    /* row 1: Stimulator A, pre membrane, synapse */
    L([[20, YG], [720 + SX, YG]]);
    txt(24, YG + 17, 'GND（Extracellular，兩列是同一條，接在兩個 Stimulator 的 −）', 'lab');
    stimulator('SA', 'A');
    membrane('A');
    L([[1040 + MG, YT], [300 + SX, YT]], 'w vm');
    synapse();

    /* row 2: Stimulator B and the post cell */
    out.push('<g transform="translate(0,' + R2 + ')">');
    stimulator('SB', 'B');
    if(passive) passiveChain();
    else { L([[20, YG], [1040 + MG, YG]]); membrane('B'); }
    txt(24, YG + 17, 'GND', 'lab');
    eg();

    /* synapse output -> post: down the right edge */
    var yo = R2 + YT;
    if(passive){
      L([[720 + SX, YT], [XD, YT], [XD, R2 + 20], [340, R2 + 20], [340, yo]]); dot(340, yo);
      txt(XD - 8, R2 + 14, '突觸輸出 → #1（和 Stimulator B 接在同一點）', 'lab', 'end');
    } else {
      L([[720 + SX, YT], [XD, YT], [XD, yo], [1040 + MG, yo]], 'w vm');
      txt(XD - 8, yo - 8, '突觸輸出 → Post Vm', 'lab', 'end');
    }
    txt(W - 16, H - 8, '<tspan class="lgm">━━</tspan> 和原版電路不同', 'lab', 'end');

    /* probes */
    out.push('<g class="chip" id="ch1chip"><rect x="-24" y="-11" width="48" height="20" rx="5" fill="#3987e5"/><text x="0" y="4" text-anchor="middle">CH1</text></g>');
    out.push('<g class="chip" id="ch2chip"><rect x="-24" y="-11" width="48" height="20" rx="5" fill="#e0703f"/><text x="0" y="4" text-anchor="middle">CH2</text></g>');
    out.push('</g></svg>');

    /* where a probe chip sits for each node it can clip on */
    var CH = {'A.Vm':[1098, YT - 22], 'B.Vm':[1098, yo - 22], 'SY.B':[300 + SX, 186], 'SY.S':[(syn === 'exc' ? 520 : 540) + SX, YT + 22]};
    for(var k = 1; k <= 5; k++) CH['P' + k] = [ux(k), yo - 18];

    var tmp = document.createElement('div'); tmp.innerHTML = out.join('');
    var made = tmp.firstChild;
    svg.setAttribute('viewBox', made.getAttribute('viewBox'));
    svg.innerHTML = made.innerHTML;
    var NODES = Array.prototype.slice.call(svg.querySelectorAll('[data-node]'));
    function q(s){ return svg.querySelector(s); }
    function qa(s){ return Array.prototype.slice.call(svg.querySelectorAll(s)); }
    function show(sel, on){ qa(sel).forEach(function(e){ e.style.display = on ? '' : 'none'; }); }
    function fmt(v){ if(v == null || isNaN(v)) return ''; return Math.abs(v) < 0.1 ? (v * 1e3).toFixed(1) + ' mV' : v.toFixed(2) + ' V'; }
    function fmtR(x){ return x >= 1e6 ? (x / 1e6) + ' MΩ' : (x / 1e3) + ' kΩ'; }
    function fmtS(x){ return x >= 1e6 ? (x / 1e6) + 'M' : x >= 1e3 ? (x / 1e3) + 'k' : x + 'Ω'; }
    var VAR = {kit:'active membrane：原版', true:'active membrane：HW2 真正的 AP'};
    /* add-on parts of a membrane variant: Stimulator rx when qs = 'rx', the membrane's r13p / rf / rs / rb */
    function variant(p, sp, m, on){
      m = m || {};
      show('[data-mod="' + sp + '-rx"]', on && m.qs === 'rx'); var t = q('[data-mv="' + sp + '-rx"]'); if(t) t.textContent = '22k';
      ['r13p', 'rf', 'rs', 'rb'].forEach(function(k){
        show('[data-mod="' + p + '-' + k + '"]', on && !!m[k]);
        var e = q('[data-mv="' + p + '-' + k + '"]'); if(e) e.textContent = m[k] ? fmtS(m[k]) : '';
      });
    }
    var api = {
      setState:function(st){
        var MEM = st.MEM || {};
        variant('A', 'SA', MEM[st.pre], true);
        variant('B', 'SB', MEM[st.postMem], !passive);
        ['A', 'B'].forEach(function(p){
          var e = q('[data-var="' + p + '"]'), v = p === 'A' ? st.pre : st.postMem; if(!e) return;
          e.textContent = VAR[v] || ''; e.setAttribute('class', v === 'kit' ? 'lab' : 'modt');
        });
        show('[data-mod="r1p"]', !!st.r1p); var t = q('[data-r1p]'); if(t) t.textContent = st.r1p ? '並 ' + fmtR(st.r1p) : '';
        show('[data-mod="r6"]', !!st.r6); show('[data-mod="r6w"]', !st.r6);
        var b = q('[data-mod="bat"]');
        if(b){ show('[data-mod="bat"]', st.bat !== 'short'); b.setAttribute('class', st.bat === 'open' ? 'ghost' : ''); show('[data-mod="batshort"]', st.bat === 'short');
          q('[data-vbat]').textContent = st.bat === 'on' ? (st.vbat || 1.5) + ' V' : st.bat === 'open' ? '拔掉（開路）' : '拔掉'; q('[data-vbat]').setAttribute('class', st.bat === 'on' ? 'lab' : 'modt'); }
        var vp = q('[data-vplus]'), v78 = Math.abs((st.vplus || 7.0) - 7.0) < 1e-6 && !st.vsyn;   /* default: 7.0 V from the header */
        if(vp){ vp.textContent = st.vsyn ? '獨立 ' + st.vsyn + ' V 電池（講義圖）' : 'V+（排針，同 Stimulator A 電池）'; vp.setAttribute('class', v78 ? 'lab' : 'modt'); }
        qa('[data-bat]').forEach(function(e){ e.setAttribute('class', v78 ? '' : 'mod'); });
        [['SA', st.rpotA], ['SB', st.rpotB]].forEach(function(p){
          var e = q('[data-pot="' + p[0] + '"]'); if(e && p[1] != null) e.textContent = 'pot ' + (p[1] >= 1e3 ? (p[1] / 1e3).toFixed(1) + 'k' : Math.round(p[1]) + 'Ω');
        });
        [['SA', st.swA], ['SB', st.swB]].forEach(function(p){
          var bl = q('#' + p[0] + '-blade'); if(!bl) return;
          bl.setAttribute('x2', p[1] ? 74 : 88); bl.setAttribute('y2', p[1] ? 58 : 62);
        });
      },
      setValues:function(fn){
        NODES.forEach(function(n){
          var v = fn(n.getAttribute('data-node')); if(v == null || isNaN(v)) return;
          var s = fmt(v), short = n.getAttribute('data-short'), bus = n.getAttribute('data-bus');
          if(bus) n.textContent = bus + ' ' + s;
          else if(short) n.innerHTML = '<tspan class="code">' + short + '</tspan> ' + s;
          else n.textContent = s;
        });
      },
      setCurrents:function(c){
        [['SA', c.A], ['SB', c.B]].forEach(function(p){ var e = q('#' + p[0] + '-cur'); if(e) e.textContent = 'I = ' + (p[1] == null ? '—' : (Math.max(0, p[1]) * 1e6).toFixed(1) + ' µA'); });
      },
      setOn:function(fn){ qa('[data-q]').forEach(function(e){ e.setAttribute('class', 'qc' + (fn(e.getAttribute('data-q')) ? ' on' : '')); }); },
      setProbes:function(ch){
        [['#ch1chip', ch[0]], ['#ch2chip', ch[1]]].forEach(function(p, i){
          var e = q(p[0]); if(!e) return;
          var at = CH[p[1]];
          if(!at){ e.style.display = 'none'; return; }
          e.style.display = '';
          var same = ch[0] === ch[1];
          e.setAttribute('transform', 'translate(' + (at[0] + (same ? (i ? 26 : -26) : 0)) + ',' + at[1] + ')');
        });
      }
    };
    return api;
  };
})();
