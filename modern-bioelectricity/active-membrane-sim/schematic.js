/* Schematic of the HW2 #2-2 active membrane, wired as the PCBs are.
   Shared by active-membrane-sim/ (live values) and hw2-debug/nodes.html (node names only).

   var s = MembraneSchematic(svgElement, {live: true});
   s.setValues(fn)        fn(code) -> volts, for every node tag
   s.setCurrents({iStim, iFi, iSo})   amps
   s.setOn({qPass: true, ...})        highlight conducting transistors
   s.setContacts(state)   state.sw / leak / fi_vm / fi_vplus / fi_gnd / so_vm / so_gnd
   s.setQsense('pcb'|'sw'|'rx'); s.setResistors(r13, rfe, soR2)
   s.setAddons(state)     state.r13p / rf / rb / rs: add-on resistors clipped on (0 = none)
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
    '.msch .sw .blade{stroke-width:2.4}'
  ].join('\n');
  if(!document.getElementById('msch-css')){
    var st = document.createElement('style'); st.id = 'msch-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  window.MembraneSchematic = function(svg, opts){
    var live = !!(opts && opts.live), out = [];
    function L(pts, cls){ out.push('<polyline class="' + (cls || 'w') + '" points="' + pts.map(function(p){ return p.join(','); }).join(' ') + '"/>'); }
    function dot(x, y){ out.push('<circle class="dotn" cx="' + x + '" cy="' + y + '" r="3"/>'); }
    function txt(x, y, s, cls, anchor){ out.push('<text class="' + cls + '" x="' + x + '" y="' + y + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + '>' + s + '</text>'); }
    /* node tag: shows "B3" (static) or "B3 0.37 V" (live) */
    function tag(code, short, x, y, anchor, two){
      out.push('<text class="nv" data-node="' + code + '" data-short="' + short + '"' + (two ? ' data-two="1"' : '') +
        ' x="' + x + '" y="' + y + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + '><tspan class="code">' + short + '</tspan></text>');
    }
    function cur(id, x, y, anchor){ if(live) out.push('<text id="' + id + '" class="cur" x="' + x + '" y="' + y + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + '></text>'); }
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
    /* BJT in local frame: base lead (-20,0)-(0,0), bar x=0, leads to (14,-30) and (14,30) */
    function bjt(cx, cy, type, rot, eTop, id){
      var s = eTop ? -1 : 1, ex0 = 0, ey0 = 6 * s, ex1 = 14, ey1 = 18 * s;
      var dxv = ex1 - ex0, dyv = ey1 - ey0, len = Math.sqrt(dxv * dxv + dyv * dyv), ux = dxv / len, uy = dyv / len;
      var tipT = type === 'n' ? 0.95 : 0.35, tx = ex0 + dxv * tipT, ty = ey0 + dyv * tipT, dir = type === 'n' ? 1 : -1;
      var bx = tx - ux * 7 * dir, by = ty - uy * 7 * dir, px = -uy * 4, py = ux * 4;
      out.push('<g transform="translate(' + cx + ',' + cy + ') rotate(' + rot + ')">' +
        '<circle id="' + id + '" class="qc" cx="5" cy="0" r="21"/>' +
        '<polyline class="sym" points="-20,0 0,0"/><polyline class="sym" points="0,-12 0,12" style="stroke-width:2.6"/>' +
        '<polyline class="sym" points="0,-6 14,-18 14,-30"/><polyline class="sym" points="0,6 14,18 14,30"/>' +
        '<polygon class="fillk" points="' + tx + ',' + ty + ' ' + (bx + px) + ',' + (by + py) + ' ' + (bx - px) + ',' + (by - py) + '"/></g>');
    }
    function contactV(key, label, x, y1, y2){
      out.push('<g class="contact" data-c="' + key + '"' + (live ? ' tabindex="0" role="button" aria-label="切換接點 ' + label + '"' : '') + '>' +
        '<rect x="' + (x - 16) + '" y="' + y1 + '" width="36" height="' + (y2 - y1) + '" fill="transparent"/>' +
        '<circle class="dotn" cx="' + x + '" cy="' + y1 + '" r="2.6"/><circle class="dotn" cx="' + x + '" cy="' + y2 + '" r="2.6"/>' +
        '<line class="blade" data-x="' + x + '" data-y1="' + y1 + '" data-y2="' + y2 + '" x1="' + x + '" y1="' + y2 + '" x2="' + x + '" y2="' + y1 + '"/>' +
        '<text class="ct" x="' + (x + 8) + '" y="' + ((y1 + y2) / 2 + 4) + '">斷開</text></g>');
    }
    /* board outline; title = bold board code + name, placed where the wiring leaves room */
    function box(x, y, w, h, code, name, tx, ty, stacked){
      out.push('<rect class="box" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="6"/>');
      if(stacked) out.push('<text class="bt" x="' + tx + '" y="' + ty + '" text-anchor="middle">' + code +
        '<tspan class="lab" x="' + tx + '" dy="15">' + name + '</tspan></text>');
      else out.push('<text class="bt" x="' + tx + '" y="' + ty + '">' + code + ' <tspan class="lab">' + name + '</tspan></text>');
    }

    box(14, 18, 308, 430, 'ST', 'Stimulator', 40, 439);
    box(332, 86, 86, 362, 'LK', 'Leak', 370, 210, true);
    box(428, 86, 262, 362, 'FI', 'Fast inward', 600, 439);
    box(700, 86, 352, 362, 'SO', 'Slow out', 962, 439);
    L([[276, 70], [1040, 70]], 'w vm');
    L([[20, 455], [1040, 455]]);
    txt(1046, 74, 'CH1', 'lab');
    out.push('<text class="nvb" data-node="Vm" data-short="Vm =" data-bus="1" x="690" y="58" text-anchor="middle">Vm</text>');
    txt(24, 472, 'GND（Extracellular，接在 Stimulator 的 −）', 'lab');

    /* ---- Stimulator ---- */
    L([[24, 36], [74, 36]]); L([[24, 36], [24, 330]]);
    L([[12, 340], [36, 340]], 'sym'); L([[18, 350], [30, 350]], 'sym');
    L([[24, 350], [24, 455]]); dot(24, 455);
    txt(30, 334, '+', 'lab'); tag('V+', 'V+', 30, 30);
    L([[74, 36], [74, 58]]);
    out.push('<g class="contact sw" data-c="sw"' + (live ? ' tabindex="0" role="button" aria-label="SW"' : '') + '>' +
      '<rect x="58" y="56" width="36" height="40" fill="transparent"/>' +
      '<circle class="dotn" cx="74" cy="58" r="2.6"/><circle class="dotn" cx="74" cy="92" r="2.6"/>' +
      '<line class="blade" data-x="74" data-y1="58" data-y2="92" x1="74" y1="92" x2="88" y2="62"/></g>');
    txt(66, 80, 'SW', 'lab', 'end');
    L([[74, 92], [74, 110]]); dot(74, 110); tag('ST.P', 'P', 80, 134);
    resH(110, 74, 134, 84, 122);
    out.push('<polyline class="sym" points="88,122 116,96"/><polygon class="fillk" points="119,93 110,96 115,101"/>');
    txt(100, 90, 'pot', 'lab', 'middle');
    dot(134, 110); tag('ST.K', 'K', 134, 150);
    resH(110, 134, 196, 144, 186); txt(165, 96, '7k', 'lab', 'middle');
    dot(196, 110); tag('ST.Q', 'Q', 200, 96);
    L([[196, 110], [200, 110]]);
    bjt(230, 124, 'p', -90, true, 'qPass'); txt(242, 160, 'Q_pass', 'lab');
    out.push('<text id="lRx" class="cur" x="242" y="176" style="display:none">E–B 並 22k</text>');
    L([[260, 110], [276, 110], [276, 70]]);
    cur('iStim', 272, 62, 'end');
    out.push('<text id="lRb" class="cur" x="300" y="62" style="display:none"></text>');
    L([[230, 144], [230, 200]]);
    L([[196, 110], [196, 166]]);
    bjt(196, 186, 'p', 90, false, 'qSense'); txt(196, 232, 'Q_sense', 'lab', 'middle');
    L([[226, 200], [230, 200]]); dot(230, 200); tag('ST.R', 'R', 238, 196);
    out.push('<polyline id="wQsPcb" class="w" points="166,200 24,200"/>');
    out.push('<polyline id="wQsSw" class="w" points="166,200 74,200 74,110" style="display:none"/>');
    out.push('<circle id="dQsPcb" class="dotn" cx="24" cy="200" r="3"/>');
    resV(230, 200, 455, 300, 380); txt(240, 345, '7k', 'lab'); dot(230, 455);

    /* ---- Leak ---- */
    L([[370, 70], [370, 76]]); dot(370, 70);
    contactV('leak', 'LK:Vm', 370, 76, 112);
    L([[370, 112], [370, 130]]); L([[344, 130], [396, 130]]); dot(370, 130);
    tag('LK.Vm', 'Vm', 370, 160, 'middle', true);
    capV(344, 130, 455, 290); txt(370, 302, '1µF', 'lab', 'middle');
    resV(396, 130, 455, 250, 330); txt(370, 345, '100k', 'lab', 'middle');
    dot(344, 455); dot(396, 455);

    /* ---- Fast inward ---- */
    L([[460, 70], [460, 76]]); dot(460, 70);
    contactV('fi_vm', 'FI:Vm', 460, 76, 112);
    L([[460, 112], [460, 120], [634, 120]]); tag('FI.Vm', 'Vm', 480, 112);
    cur('iFi', 584, 112);
    diodeV(460, 120, 220, 152, 182); txt(474, 172, 'D1', 'lab');
    dot(460, 220); tag('FI.B3', 'B3', 466, 262);
    resV(460, 220, 405, 280, 350); txt(470, 322, '3M', 'lab');
    L([[460, 220], [500, 220]]);
    bjt(520, 220, 'n', 0, false, 'qFi3904'); txt(550, 226, '3904', 'lab');
    L([[534, 190], [534, 170], [600, 170]]); dot(534, 170); tag('FI.B4', 'B4', 538, 160);
    resV(534, 250, 405, 300, 370); tag('FI.E3', 'E3', 540, 284);
    out.push('<text id="lRfe" class="lab" x="544" y="340">100 kΩ</text>');
    out.push('<text id="lRf" class="cur" x="544" y="356" style="display:none"></text>');
    bjt(620, 170, 'p', 0, false, 'qFi4403'); txt(646, 166, '4403', 'lab');
    L([[634, 140], [634, 120]]);
    resV(634, 200, 310, 228, 290); tag('FI.E4', 'E4', 628, 214, 'end');
    out.push('<text id="lR13" class="lab" x="626" y="262" text-anchor="end">R13 100 kΩ</text>');
    out.push('<text id="lR13p" class="cur" x="626" y="278" text-anchor="end" style="display:none"></text>');
    contactV('fi_vplus', 'FI:V+', 634, 310, 346);
    L([[634, 346], [634, 362]]); tag('FI.V+', 'V+', 634, 380, 'middle');
    L([[460, 405], [534, 405]]); dot(500, 405);
    contactV('fi_gnd', 'FI:GND', 500, 412, 448); L([[500, 405], [500, 412]]); L([[500, 448], [500, 455]]);
    tag('FI.GND', 'GND', 510, 432);

    /* ---- Slow out ---- */
    L([[740, 70], [740, 76]]); dot(740, 70);
    contactV('so_vm', 'SO:Vm', 740, 76, 112);
    L([[740, 112], [740, 120], [994, 120]]); tag('SO.Vm', 'Vm', 760, 112);
    cur('iSo', 944, 112);
    resV(740, 120, 230, 140, 205); txt(750, 176, '100k', 'lab');
    dot(740, 230); tag('SO.S', 'S', 748, 250);
    capV(740, 230, 405, 320); txt(756, 324, '1µF', 'lab');
    out.push('<text id="lRs" class="cur" x="756" y="340" style="display:none"></text>');
    diodeH(230, 740, 840, 772, 802); txt(787, 216, 'D1', 'lab', 'middle');
    dot(840, 230); tag('SO.B3', 'B3', 834, 272, 'end');
    resV(840, 230, 405, 290, 360);
    out.push('<text id="lSoR2" class="lab" x="850" y="330">3M</text>');   /* TA: 1 Mohm; kit shipped 100 ohm */
    L([[840, 230], [860, 230]]);
    bjt(880, 230, 'n', 0, false, 'qSo3904'); txt(910, 236, '3904', 'lab');
    L([[894, 200], [894, 170], [960, 170]]); dot(894, 170); tag('SO.B4', 'B4', 900, 160);
    L([[894, 260], [894, 405]]);
    bjt(980, 170, 'p', 0, true, 'qSo4403'); txt(1006, 176, '4403', 'lab');
    L([[994, 140], [994, 120]]);
    resV(994, 200, 405, 260, 330); txt(1004, 300, '1k', 'lab');
    tag('SO.C4', 'C4', 988, 222, 'end');
    L([[740, 405], [994, 405]]); dot(840, 405); dot(894, 405); dot(870, 405);
    contactV('so_gnd', 'SO:GND', 870, 412, 448); L([[870, 405], [870, 412]]); L([[870, 448], [870, 455]]);
    tag('SO.GND', 'GND', 880, 432);

    svg.setAttribute('viewBox', '0 0 1080 480');
    svg.classList.add('msch'); if(live) svg.classList.add('live');
    svg.innerHTML = out.join('');

    var tags = Array.prototype.slice.call(svg.querySelectorAll('[data-node]'));
    function fmtR(x){ return x >= 1e6 ? (x / 1e6) + ' MΩ' : x >= 1e3 ? (x / 1e3) + ' kΩ' : x + ' Ω'; }
    return {
      setValues: function(fn){
        tags.forEach(function(t){
          var v = fn(t.dataset.node); if(v === null || v === undefined) return;
          var s = v.toFixed(2) + ' V', short = t.dataset.short;
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
      /* 'pcb' as built, 'sw' Qsense emitter moved after SW, 'rx' 22 kohm across Qpass E-B */
      setQsense: function(mode){
        var pcb = mode !== 'sw';
        svg.querySelector('#wQsPcb').style.display = pcb ? '' : 'none';
        svg.querySelector('#dQsPcb').style.display = pcb ? '' : 'none';
        svg.querySelector('#wQsSw').style.display = pcb ? 'none' : '';
        svg.querySelector('#lRx').style.display = mode === 'rx' ? '' : 'none';
      },
      /* add-on resistors clipped onto existing legs: show what is fitted */
      setAddons: function(st){
        [['lR13p', st.r13p, function(r){ return '∥ ' + fmtR(r); }],
         ['lRf', st.rf, function(r){ return '＋' + fmtR(r) + ' ← V+'; }],
         ['lRb', st.rb, function(r){ return '＋' + fmtR(r) + '：V+ → Vm'; }],
         ['lRs', st.rs, function(r){ return '∥ ' + fmtR(r); }]].forEach(function(a){
          var e = svg.querySelector('#' + a[0]); if(!e) return;
          e.style.display = a[1] ? '' : 'none';
          if(a[1]) e.textContent = a[2](a[1]);
        });
      },
      setResistors: function(r13, rfe, soR2){
        svg.querySelector('#lR13').textContent = 'R13 ' + fmtR(r13);
        svg.querySelector('#lRfe').textContent = fmtR(rfe);
        if(soR2) svg.querySelector('#lSoR2').textContent = fmtR(soR2);
      }
    };
  };
})();
