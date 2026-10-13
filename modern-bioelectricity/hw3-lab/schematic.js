/* Schematic of the HW3 circuits, laid out like the handout figures:
   Stimulator A -> pre active membrane -> synapse (drawn in full) -> post (5 passive units or active membrane 2) <- Stimulator B.

   var s = SynSchematic(svg, {syn:'exc'|'inh', post:'passive'|'active'});
   s.setState(st)     engine state: pre / postMem variants, r1p, r6, bat, swA, swB, vplus (differences from the kit in --mod)
   s.setValues(fn)    fn(code) -> volts for every tagged node
   s.setCurrents({A, B})  Stimulator output currents (A)
   s.setOn({q1, q2})  conducting synapse transistors
   s.setProbes([ch1, ch2])
*/
(function(){
  var CSS = [
    '.ssch .w{stroke:var(--ink);stroke-width:1.6;fill:none;stroke-linecap:round;stroke-linejoin:round}',
    '.ssch .sym{stroke:var(--ink);stroke-width:1.6;fill:none;stroke-linejoin:round}',
    '.ssch .fillk{fill:var(--ink);stroke:none}',
    '.ssch .dotn{fill:var(--ink)}',
    '.ssch .box{fill:none;stroke:var(--rule);stroke-width:1.4;stroke-dasharray:5 4}',
    '.ssch .sbox{fill:none;stroke-width:1.6;stroke-dasharray:6 4}',
    '.ssch .mbox{fill:var(--surface);stroke:var(--warn);stroke-width:2}',
    '.ssch .bt{fill:var(--ink);font-size:14px;font-weight:700}',
    '.ssch .lab{fill:var(--muted);font-size:11.5px}',
    '.ssch .nv{fill:var(--link);font-size:11.5px;font-family:"IBM Plex Mono",ui-monospace,monospace}',
    '.ssch .big{fill:var(--ink);font-size:14px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-weight:500}',
    '.ssch .cur{fill:var(--opt);font-size:11.5px;font-family:"IBM Plex Mono",ui-monospace,monospace}',
    '.ssch .qc{fill:transparent;stroke:var(--ink);stroke-width:1.2}',
    '.ssch .qc.on{fill:var(--qon,rgba(42,120,214,.16))}',
    '.ssch .blade{stroke-width:2.6;stroke-linecap:round}',
    '.ssch .ghost{opacity:.22}',
    '.ssch .mod .w,.ssch .mod .sym{stroke:var(--mod,#b0307f)}',
    '.ssch .mod .w{stroke-width:2}',
    '.ssch .mod .lab,.ssch .modt{fill:var(--mod,#b0307f);font-weight:700}',
    '.ssch .chip rect{stroke:none}',
    '.ssch .chip text{font-size:12px;font-weight:700;fill:#10161a;font-family:"IBM Plex Mono",ui-monospace,monospace}'
  ].join('\n');
  if(!document.getElementById('ssch-css')){
    var el = document.createElement('style'); el.id = 'ssch-css'; el.textContent = CSS; document.head.appendChild(el);
  }
  var YT = 80, YG = 272, YW = 46;              /* intracellular bus, ground, Stimulator B's wire */

  window.SynSchematic = function(svg, opts){
    var syn = opts.syn || 'exc', passive = (opts.post || 'passive') === 'passive', out = [];
    var XP = 770, DXU = 118;                   /* post: first unit (or membrane 2) */
    function ux(k){ return XP + (k - 1) * DXU; }
    var XB = passive ? ux(5) + 95 : XP + 140;  /* Stimulator B box */
    var W = XB + 140;
    var NX = {'A.Vm':225, 'SY.B':340, 'SY.S':syn === 'exc' ? 520 : 540, 'B.Vm':XP};
    for(var k = 1; k <= 5; k++) NX['P' + k] = ux(k);

    function L(pts, cls, attr){ out.push('<polyline class="' + (cls || 'w') + '"' + (attr || '') + ' points="' + pts.map(function(p){ return p.join(','); }).join(' ') + '"/>'); }
    function dot(x, y){ out.push('<circle class="dotn" cx="' + x + '" cy="' + y + '" r="3"/>'); }
    function txt(x, y, s, cls, anchor, attr){ out.push('<text class="' + cls + '" x="' + x + '" y="' + y + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + (attr || '') + '>' + s + '</text>'); }
    function g(attr){ out.push('<g ' + attr + '>'); }
    function eg(){ out.push('</g>'); }
    function resV(x, y1, y2, a, b){
      L([[x, y1], [x, a]]);
      var pts = [[x, a]], seg = (b - a) / 10;
      for(var i = 1; i < 10; i++) pts.push([x + (i % 2 ? 7 : -7), a + seg * i]);
      pts.push([x, b]); L(pts, 'sym'); L([[x, b], [x, y2]]);
    }
    function resH(y, x1, x2, a, b){
      L([[x1, y], [a, y]]);
      var pts = [[a, y]], seg = (b - a) / 10;
      for(var i = 1; i < 10; i++) pts.push([a + seg * i, y + (i % 2 ? -6 : 6)]);
      pts.push([b, y]); L(pts, 'sym'); L([[b, y], [x2, y]]);
    }
    function capV(x, y1, y2, yc){
      L([[x, y1], [x, yc - 4]]); L([[x - 12, yc - 4], [x + 12, yc - 4]], 'sym'); L([[x - 12, yc + 4], [x + 12, yc + 4]], 'sym'); L([[x, yc + 4], [x, y2]]);
    }
    function diodeV(x, y1, y2, a, b){
      L([[x, y1], [x, a]]);
      out.push('<polygon class="sym fillk" points="' + (x - 8) + ',' + a + ' ' + (x + 8) + ',' + a + ' ' + x + ',' + b + '"/>');
      L([[x - 8, b], [x + 8, b]], 'sym'); L([[x, b], [x, y2]]);
    }
    function diodeH(y, x1, x2, a, b){
      L([[x1, y], [a, y]]);
      out.push('<polygon class="sym fillk" points="' + a + ',' + (y - 8) + ' ' + a + ',' + (y + 8) + ' ' + b + ',' + y + '"/>');
      L([[b, y - 8], [b, y + 8]], 'sym'); L([[b, y], [x2, y]]);
    }
    /* battery, vertical: + plate (long) at yp, - plate (short) at yn */
    function batV(x, yp, yn){
      L([[x - 14, yp], [x + 14, yp]], 'sym'); out.push('<rect class="fillk" x="' + (x - 8) + '" y="' + (yn - 2) + '" width="16" height="4"/>');
      txt(x - 20, yp + (yp > yn ? 12 : -4), '+', 'lab', 'middle');
    }
    /* BJT: base enters from the left at (x, y); leads end at (x + 18, y -/+ 28).  up = 'c' or 'e' */
    function bjt(x, y, type, up, id){
      out.push('<circle id="' + id + '" class="qc" cx="' + (x + 12) + '" cy="' + y + '" r="17"/>');
      L([[x - 6, y], [x + 6, y]]); L([[x + 6, y - 11], [x + 6, y + 11]], 'sym', ' style="stroke-width:2.6"');
      var top = [[x + 6, y - 5], [x + 18, y - 16], [x + 18, y - 28]], bot = [[x + 6, y + 5], [x + 18, y + 16], [x + 18, y + 28]];
      L(top); L(bot);
      var e = up === 'e' ? top : bot, ax = e[1][0] - e[0][0], ay = e[1][1] - e[0][1], len = Math.sqrt(ax * ax + ay * ay), u = [ax / len, ay / len];
      var tip, base;
      if(type === 'n'){ tip = [e[0][0] + u[0] * 14, e[0][1] + u[1] * 14]; base = [tip[0] - u[0] * 7, tip[1] - u[1] * 7]; }
      else { tip = [e[0][0] + u[0] * 4, e[0][1] + u[1] * 4]; base = [tip[0] + u[0] * 7, tip[1] + u[1] * 7]; }
      var n = [-u[1] * 4, u[0] * 4];
      out.push('<polygon class="fillk" points="' + tip.join(',') + ' ' + (base[0] + n[0]) + ',' + (base[1] + n[1]) + ' ' + (base[0] - n[0]) + ',' + (base[1] - n[1]) + '"/>');
    }
    function nv(code, x, y, anchor, cls){ out.push('<text class="' + (cls || 'nv') + '" data-node="' + code + '" x="' + x + '" y="' + y + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + '></text>'); }
    function stimBox(id, x, label, color){
      out.push('<rect class="sbox" x="' + x + '" y="108" width="120" height="122" rx="10" style="stroke:' + color + '"/>');
      txt(x + 60, 132, label, 'bt', 'middle');
      out.push('<circle class="fillk" cx="' + (x + 36) + '" cy="172" r="3.5"/><circle class="fillk" cx="' + (x + 84) + '" cy="172" r="3.5"/>');
      out.push('<line class="blade" id="' + id + '-blade" x1="' + (x + 36) + '" y1="172" x2="' + (x + 80) + '" y2="150" style="stroke:' + color + '"/>');
      out.push('<text class="cur" id="' + id + '-cur" x="' + (x + 60) + '" y="212" text-anchor="middle">I = 0 µA</text>');
    }
    function memBox(code, x, title, sub){
      out.push('<rect class="mbox" x="' + (x - 52) + '" y="112" width="104" height="104" rx="9"/>');
      txt(x, 136, title, 'bt', 'middle'); txt(x, 152, sub, 'lab', 'middle');
      out.push('<text class="lab" data-var="' + code + '" x="' + x + '" y="168" text-anchor="middle"></text>');
      nv(code, x, 196, 'middle', 'big');
    }

    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' 320">');
    out.push('<g class="ssch">');
    /* ground */
    L([[40, YG], [W - 20, YG]]); L([[40, YG], [40, YG + 8]]); L([[28, YG + 8], [52, YG + 8]], 'sym'); L([[33, YG + 13], [47, YG + 13]], 'sym'); L([[37, YG + 18], [43, YG + 18]], 'sym');
    txt(60, YG + 38, 'Extracellular (ground)', 'lab');
    txt(20, 26, 'Intracellular（每個細胞各自一條）', 'lab');
    /* Stimulator A and the pre membrane */
    stimBox('swA', 18, 'Stimulator A', '#c9a227');
    L([[138, 140], [158, 140], [158, YT], [380, YT]]); L([[138, 200], [150, 200], [150, YG]]);
    out.push('<polygon class="fillk" points="164,' + (YT - 6) + ' 176,' + YT + ' 164,' + (YT + 6) + '" style="fill:#c9a227"/>');
    dot(225, YT); L([[225, YT], [225, 112]]); L([[225, 216], [225, YG]]); dot(225, YG); dot(150, YG);
    memBox('A.Vm', 225, 'Pre', 'active membrane');

    /* synapse */
    var col = syn === 'exc' ? 'var(--warn)' : 'var(--link)';
    out.push('<rect class="sbox" x="292" y="36" width="' + (syn === 'exc' ? 418 : 418) + '" height="214" rx="10" style="stroke:' + col + '"/>');
    txt(296, 28, syn === 'exc' ? 'Excitatory synapse' : 'Inhibitory synapse', 'bt');
    resH(YT, 300, 380, 318, 364); txt(341, YT + 20, '820 kΩ', 'lab', 'middle');
    g('data-mod="r1p" class="mod" style="display:none"');
    L([[304, YT], [304, 56]]); resH(56, 304, 378, 318, 364); L([[378, 56], [378, YT]]);
    out.push('<text class="lab" data-r1p x="341" y="48" text-anchor="middle"></text>');
    eg();
    dot(380, YT);
    diodeV(380, YT, 160, 104, 120); txt(392, 116, '1N4148', 'lab');
    dot(380, 160); L([[340, 160], [410, 160]]); dot(340, 160);
    capV(340, 160, YG, 212); txt(326, 216, '10 nF', 'lab', 'end'); dot(340, YG);
    resV(380, 160, YG, 190, 240); txt(390, 222, '100 kΩ', 'lab'); dot(380, YG);
    nv('SY.B', 334, 150, 'end');
    var yq2 = 160;
    bjt(420, yq2, 'n', 'c', 'q2');
    var yq1 = syn === 'exc' ? 122 : 150;
    L([[410, yq2], [414, yq2]]); L([[438, yq2 - 28], [438, yq1], [470, yq1]]);
    resV(438, yq2 + 28, YG, 206, 252); txt(448, 248, '30 kΩ', 'lab'); dot(438, YG);
    if(syn === 'exc'){
      bjt(470, yq1, 'p', 'c-top', 'q1');                 /* emitter at the bottom */
      L([[488, yq1 - 28], [488, YT], [520, YT]]); dot(520, YT);
      resV(488, yq1 + 28, 214, 162, 200); txt(498, 186, '1 kΩ', 'lab');
      batV(488, 222, 232); L([[488, 234], [488, YG]]); dot(488, YG);
      out.push('<text class="lab" data-vplus x="498" y="246"></text>');
      txt(520, YT - 10, 'S', 'bt', 'middle'); nv('SY.S', 530, YT - 24);
      L([[520, YT], [640, YT]]);
      dot(560, YT); capV(560, YT, YG, 175); txt(574, 172, '4.7 µF', 'lab'); dot(560, YG);
      dot(615, YT); resV(615, YT, YG, 150, 210); txt(625, 196, '200 kΩ', 'lab'); dot(615, YG);
      diodeH(YT, 640, 662, 646, 662); txt(640, YT + 24, '1N4148', 'lab');
      L([[662, YT], [670, YT]]);
      g('data-mod="r6"'); resH(YT, 670, 720, 675, 705); txt(690, YT - 12, '100 kΩ', 'lab', 'middle'); eg();
      g('data-mod="r6w"'); L([[670, YT], [720, YT]]); eg();
      L([[720, YT], [XP, YT]]);
    } else {
      bjt(470, yq1, 'p', 'e', 'q1');                     /* emitter at the top */
      g('data-mod="bat"'); L([[488, yq1 - 28], [488, 116]]); batV(488, 116, 106); L([[488, 104], [488, 56], [540, 56], [540, YT]]); eg();
      g('data-mod="batshort" class="mod" style="display:none"'); L([[488, yq1 - 28], [488, 116]]); L([[488, 116], [470, 116], [470, 92], [488, 92]]); L([[488, 104], [488, 56], [540, 56], [540, YT]]); txt(458, 104, '跳線', 'lab', 'end'); eg();
      out.push('<text class="lab" data-vbat x="508" y="114"></text>');
      dot(540, YT); txt(540, 50, 'S', 'bt', 'middle'); nv('SY.S', 552, 50);
      resV(488, yq1 + 28, YG, 200, 246); txt(498, 236, '15 kΩ', 'lab'); dot(488, YG);
      L([[540, YT], [650, YT]]);
      dot(580, YT); capV(580, YT, YG, 175); txt(594, 172, '4.7 µF', 'lab'); dot(580, YG);
      dot(630, YT); resV(630, YT, YG, 150, 210); txt(640, 196, '200 kΩ', 'lab'); dot(630, YG);
      resH(YT, 650, 720, 662, 702); txt(682, YT - 12, '100 kΩ', 'lab', 'middle');
      L([[720, YT], [XP, YT]]);
    }

    /* post */
    if(passive){
      for(k = 1; k <= 5; k++){
        var x = ux(k);
        dot(x, YT); L([[x, YT], [x, 124]]);
        out.push('<rect class="box" x="' + (x - 42) + '" y="104" width="84" height="122" rx="8"/>');
        L([[x - 18, 124], [x + 18, 124]]); L([[x - 18, 206], [x + 18, 206]]);
        capV(x - 18, 124, 206, 165); resV(x + 18, 124, 206, 140, 190);
        L([[x, 206], [x, YG]]); dot(x, YG);
        txt(x - 22, 246, '#' + k, 'bt', 'end'); nv('P' + k, x - 14, 246);
        if(k < 5){ resH(YT, x, ux(k + 1), x + DXU / 2 - 22, x + DXU / 2 + 22); txt(x + DXU / 2, YT - 12, '10 kΩ', 'lab', 'middle'); }
      }
    } else {
      dot(XP, YT); L([[XP, YT], [XP, 112]]); L([[XP, 216], [XP, YG]]); dot(XP, YG);
      memBox('B.Vm', XP, 'Post', 'active membrane 2');
    }
    /* Stimulator B */
    stimBox('swB', XB, 'Stimulator B', '#9b6bd6');
    L([[XB, 140], [XB - 20, 140], [XB - 20, YW], [XP, YW], [XP, YT - 12]]);
    out.push('<polygon class="fillk" points="' + (XP - 6) + ',' + (YT - 16) + ' ' + XP + ',' + (YT - 4) + ' ' + (XP + 6) + ',' + (YT - 16) + '" style="fill:#9b6bd6"/>');
    L([[XB, 200], [XB - 10, 200], [XB - 10, YG]]); dot(XB - 10, YG);
    /* probes */
    out.push('<g class="chip" id="ch1chip"><rect x="-24" y="-11" width="48" height="20" rx="5" fill="#3987e5"/><text x="0" y="4" text-anchor="middle">CH1</text></g>');
    out.push('<g class="chip" id="ch2chip"><rect x="-24" y="-11" width="48" height="20" rx="5" fill="#e0703f"/><text x="0" y="4" text-anchor="middle">CH2</text></g>');
    out.push('</g></svg>');

    var tmp = document.createElement('div'); tmp.innerHTML = out.join('');
    var made = tmp.firstChild;
    svg.setAttribute('viewBox', made.getAttribute('viewBox'));
    svg.innerHTML = made.innerHTML;
    var NODES = Array.prototype.slice.call(svg.querySelectorAll('[data-node]'));
    function q(s){ return svg.querySelector(s); }
    function show(sel, on){ var e = q(sel); if(e) e.style.display = on ? '' : 'none'; }
    function fmt(v){ if(v == null || isNaN(v)) return ''; return Math.abs(v) < 0.1 ? (v * 1e3).toFixed(1) + ' mV' : v.toFixed(2) + ' V'; }
    function fmtR(x){ return x >= 1e6 ? (x / 1e6) + ' MΩ' : (x / 1e3) + ' kΩ'; }
    var VAR = {kit:'原版', true:'HW2 真正的 AP'};
    var api = {
      setState:function(st){
        var vA = q('[data-var="A.Vm"]'); if(vA){ vA.textContent = VAR[st.pre] || ''; vA.setAttribute('class', st.pre === 'kit' ? 'lab' : 'modt'); vA.style.fontSize = '11px'; }
        var vB = q('[data-var="B.Vm"]'); if(vB){ vB.textContent = VAR[st.postMem] || ''; vB.setAttribute('class', st.postMem === 'kit' ? 'lab' : 'modt'); vB.style.fontSize = '11px'; }
        show('[data-mod="r1p"]', !!st.r1p); var t = q('[data-r1p]'); if(t) t.textContent = st.r1p ? '並 ' + fmtR(st.r1p) : '';
        show('[data-mod="r6"]', !!st.r6); show('[data-mod="r6w"]', !st.r6);
        var b = q('[data-mod="bat"]');
        if(b){ show('[data-mod="bat"]', st.bat !== 'short'); b.setAttribute('class', st.bat === 'open' ? 'ghost' : ''); show('[data-mod="batshort"]', st.bat === 'short');
          q('[data-vbat]').textContent = st.bat === 'on' ? '1.5 V' : st.bat === 'open' ? '拔掉（開路）' : '拔掉'; q('[data-vbat]').setAttribute('class', st.bat === 'on' ? 'lab' : 'modt'); }
        var vp = q('[data-vplus]'); if(vp){ vp.textContent = 'V+ ' + (st.vplus || 7.8) + ' V（排針）'; vp.setAttribute('class', st.vplus !== 7.8 ? 'modt' : 'lab'); }
        [['swA', st.swA], ['swB', st.swB]].forEach(function(p){
          var bl = q('#' + p[0] + '-blade'); if(!bl) return; var x1 = +bl.getAttribute('x1');
          bl.setAttribute('x2', x1 + (p[1] ? 48 : 44)); bl.setAttribute('y2', p[1] ? 172 : 150);
        });
      },
      setValues:function(fn){ NODES.forEach(function(n){ n.textContent = fmt(fn(n.getAttribute('data-node'))); }); },
      setCurrents:function(c){
        [['swA', c.A], ['swB', c.B]].forEach(function(p){ var e = q('#' + p[0] + '-cur'); if(e) e.textContent = 'I = ' + (p[1] == null ? '—' : (Math.max(0, p[1]) * 1e6).toFixed(1) + ' µA'); });
      },
      setOn:function(o){ ['q1', 'q2'].forEach(function(id){ var e = q('#' + id); if(e) e.setAttribute('class', 'qc' + (o[id] ? ' on' : '')); }); },
      setProbes:function(ch){
        [['#ch1chip', ch[0]], ['#ch2chip', ch[1]]].forEach(function(p, i){
          var e = q(p[0]); if(!e) return;
          var x = NX[p[1]];
          if(x == null){ e.style.display = 'none'; return; }
          e.style.display = '';
          var same = ch[0] === ch[1];
          e.setAttribute('transform', 'translate(' + (x + (same ? (i ? 26 : -26) : 0)) + ',' + (YG + 24) + ')');
        });
      }
    };
    return api;
  };
})();
