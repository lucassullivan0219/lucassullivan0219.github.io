/* HW3 實驗台 circuit inspector (HW2's hw2-lab/inspect.js, on the HW3 engine): click a part or a wire on a
   schematic and a window shows the equations the engine solves for it, with the live numbers, the hand
   formulas and the engine code that does it (engine.js, read from the running functions).

   var I = HW3Inspect(function(){ return engineOfTheRegionOnScreen; });
   I.open({part:'sy.q2'} | {node:'SY.B'}, x, y)   I.update()   I.close()   I.target()   I.rerender()
*/
(function(){
  'use strict';

  /* ---------------- names ---------------- */
  var STIM = {
    sw:['SW 按鈕', '按下＝接通 V+ → P。引擎把它當成一顆 0.05 Ω 電阻，放開時這顆不存在。'],
    pot:['可變電阻 pot', '0–10 kΩ，和 7 kΩ 一起決定刺激電流。'],
    r7a:['7 kΩ（pot → Q_pass 射極）', '刺激電流流過 pot + 7 kΩ，壓降就是 Q_sense 的 V_EB。'],
    r7b:['7 kΩ（Q_sense 集極 → GND）', 'Q_sense 的集極電流在這裡變成 Q_pass 的基極電壓。'],
    pass:['Q_pass 2N4403', '輸出電晶體：射極 Q、基極 R，集極送出刺激電流。'],
    sense:['Q_sense 2N4403', '基極接 Q：pot + 7 kΩ 上的壓降到約 0.65 V 就導通、把 Q_pass 關小，所以電流 ≈ V_EB／(pot + 7 kΩ)。射極接在 SW 之前，放開時還漏電。'],
    rx:['Q_pass E–B 外加 22 kΩ', 'HW2 真正的 AP：把 Q_sense 漏出的基極電流旁路掉，放開時 Q_pass 不再漏電。']
  };
  var MEMP = {
    lkc:['LK 1 µF', 'Leak', '膜電容 C_m。'],
    lkr:['LK 100 kΩ', 'Leak', '漏電阻 R_leak（E_leak = 0 V）。'],
    fid:['FI D1 1N4148', 'Fast inward', 'Vm → B3：門檻多一個二極體壓降。'],
    fir3:['FI 3 MΩ', 'Fast inward', 'B3 → GND：3904 基極下拉。'],
    fi3904:['FI 2N3904', 'Fast inward', 'Vm 過門檻就導通，拉 4403 的基極。'],
    fire:['FI 3904 射極 100 kΩ', 'Fast inward', 'E3 → GND：射極電壓墊高門檻。'],
    fi4403:['FI 2N4403', 'Fast inward', '送出內向電流（Na⁺）：射極 E4（R13 → V+），集極 Vm。'],
    r13:['R13 100 kΩ', 'Fast inward', '4403 的射極電阻，限制內向電流的上限。'],
    r13p:['R13 兩端外加 11 kΩ', '外加（HW2 真 AP）', '和 R13 並聯，FI 能送更大的電流。'],
    rf:['V+ → FI.E3 外加 680 kΩ', '外加（HW2 真 AP）', '給 E3 一個偏壓，門檻抬高。'],
    sor1:['SO R1 100 kΩ', 'Slow out', 'Vm → SO.S：和 C1 組成慢的低通（K⁺ 通道的 n）。'],
    soc:['SO C1 1 µF', 'Slow out', 'SO.S 的電容：慢變數。'],
    sod:['SO D1 1N4148', 'Slow out', 'SO.S → SO.B3。'],
    sor2:['SO R2 1 MΩ', 'Slow out', 'SO.B3 → GND（PCB 標 3M，現在都是助教的 1 MΩ）。'],
    so3904:['SO 2N3904', 'Slow out', 'SO.S 夠高就導通，拉 4403 的基極。'],
    so4403:['SO 2N4403', 'Slow out', '送出外向電流（K⁺）：射極 Vm，集極經 1 kΩ 到地。'],
    sor1k:['SO 1 kΩ', 'Slow out', '4403 集極到 GND。'],
    rs:['SO C1 外加並聯 56 kΩ', '外加（HW2 真 AP）', 'SO.S 只到 Vm 的一部分：靜止時 Slow out 關著。'],
    rb:['V+ → Vm 外加 330 kΩ', '外加（HW2 真 AP）', '把靜止電位抬高。']
  };
  var SYN = {
    r1:['820 kΩ（Pre → D1）', '突觸輸入電阻。和 100 kΩ 組成約 1/9 的分壓：Pre 的 AP 要夠大，Q2 基極才過得了 V_BE。'],
    r1p:['820 kΩ 兩端外加電阻', '外加：降低輸入電阻、加大分壓比。10-21 我們的板子並 100 kΩ 才有 EPSP。'],
    d1:['D1 1N4148', '只讓 Pre 往上的部分進來，多一個約 0.45 V 的壓降。'],
    c1:['10 nF（Q2 基極 → GND）', '和 100 kΩ 組成約 1 ms 的低通：Ca²⁺ 進入的時間。'],
    r2:['100 kΩ（Q2 基極 → GND）', '分壓的下半；也是 Q2 基極的下拉。'],
    q2:['Q2 2N3904', '基極過 V_BE（約 0.55 V）就導通，經 30 kΩ 射極電阻把電流送進 Q1 基極。'],
    r3:['30 kΩ（Q2 射極 → GND）', '射極退化：Q2 電流 ≈ (V_B − V_BE)/30 kΩ。'],
    q1:['Q1 2N4403', 'Q2 的電流把它打開，對 S 充電（Excitatory）或放電（Inhibitory）。'],
    r4:['Q1 的 1 kΩ／15 kΩ', 'Excitatory：Q1 射極經 1 kΩ 接 V+，限制充電電流。Inhibitory：Q1 集極經 15 kΩ 到地。'],
    c2:['4.7 µF（S → GND）', '突觸輸出電容：傳導物質濃度。'],
    r5:['200 kΩ（S → GND）', '和 4.7 µF 的 τ ≈ 0.94 s：傳導物質清除。'],
    d2:['D2 1N4148', 'S → Post：只送正向電流（陽離子通道）。'],
    r6:['D2 → Post／S → Post 的電阻', 'Excitatory：PCB 沒有這顆（直線），講義圖畫 100 kΩ。Inhibitory：100 kΩ。'],
    bat:['1.5 V 電池', 'Inhibitory：− 接 S、+ 接 Q1 射極，讓 Q1 能把 S 拉到 0 V 以下（E_Cl 低於靜止）。']
  };
  function partInfo(name){
    var m = /^(SA|SB)\.(.+)$/.exec(name || '');
    if(m && STIM[m[2]]) return [STIM[m[2]][0], 'Stimulator ' + m[1].slice(1), STIM[m[2]][1]];
    m = /^(A|B)\.(.+)$/.exec(name || '');
    if(m && MEMP[m[2]]) return [MEMP[m[2]][0], (m[1] === 'A' ? 'Pre' : 'Post') + ' active membrane・' + MEMP[m[2]][1], MEMP[m[2]][2]];
    m = /^sy\.(.+)$/.exec(name || '');
    if(m && SYN[m[1]]) return [SYN[m[1]][0], '突觸板', SYN[m[1]][1]];
    m = /^(pc|pr|ps)(\d+)$/.exec(name || '');
    if(m){ var k = +m[2]; return ({
      pc:['Passive #' + k + ' 1 µF', 'Passive #' + k, '這段膜的電容。'],
      pr:['Passive #' + k + ' 100 kΩ', 'Passive #' + k, '這段膜的漏電阻。'],
      ps:['10 kΩ（#' + k + ' → #' + (k + 1) + '）', 'Passive #' + k, '細胞內的軸向電阻 r_i。']
    })[m[1]]; }
    if(name === 'p1' || name === 'p2') return ['示波器 CH' + name[1] + ' 探棒', '示波器', '×1 探棒＝示波器輸入 1 MΩ 到 GND（×10 是 10 MΩ）。'];
    return [name, '', ''];
  }
  var NODE = {
    'V+':'Stimulator 電池正極（固定）', 'VS':'突觸自己的電池正極（講義圖的 9 V）', 'GND':'電池負極（示波器地線夾這裡）',
    'A.Vm':'Pre 膜電位', 'B.Vm':'Post 膜電位',
    'SY.A':'820 kΩ 和 D1 之間', 'SY.B':'Q2 基極（突觸輸入；R2 100 kΩ 上端）', 'SY.E2':'Q2 射極（30 kΩ 上端）', 'SY.C2':'Q2 集極＝Q1 基極',
    'SY.E1':'Q1 射極', 'SY.C1':'Q1 集極（15 kΩ 上端）', 'SY.S':'S：突觸輸出電容（傳導物質濃度）', 'SY.D':'D2 之後（Post 排針）'
  };
  function nodeInfo(n){
    if(NODE[n]) return NODE[n];
    var m = /^(SA|SB)\.(P|K|Q|R)$/.exec(n || '');
    if(m) return 'Stimulator ' + m[1].slice(1) + '：' + ({P:'SW 和 pot 之間', K:'pot 和 7 kΩ 之間', Q:'Q_pass 射極＝Q_sense 基極', R:'Q_pass 基極＝Q_sense 集極'})[m[2]];
    m = /^(A|B)\.(FI|SO)\.(\w+)$/.exec(n || '');
    if(m) return (m[1] === 'A' ? 'Pre' : 'Post') + ' ' + m[2] + '.' + m[3];
    m = /^P(\d)$/.exec(n || '');
    return m ? 'Passive #' + m[1] + ' 細胞內' : '';
  }

  /* ---------------- formatting ---------------- */
  var PFX = [[1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']];
  function si(x, u, dig){
    if(x == null || !isFinite(x)) return '—';
    var a = Math.abs(x);
    if(a < 1e-16) return '0 ' + u;
    for(var i = 0; i < PFX.length; i++) if(a >= PFX[i][0] * 0.99995) return (x / PFX[i][0]).toPrecision(dig || 3) + ' ' + PFX[i][1] + u;
    return (x / 1e-15).toPrecision(dig || 3) + ' f' + u;
  }
  function fV(v){ return v == null || !isFinite(v) ? '—' : v.toFixed(3) + ' V'; }
  function fI(a){ return si(a, 'A'); }
  function fR(r){ return r >= 1e12 ? si(r, 'Ω', 2) : si(r, 'Ω', 3).replace(/(\.\d*?)0+ /, '$1 ').replace('. ', ' '); }
  function esc(s){ return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function vn(n){ return 'V<sub>' + esc(n) + '</sub>'; }

  window.HW3Inspect = function(getE){
    var box = document.createElement('div');
    box.className = 'insp'; box.hidden = true;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '電路檢視');
    document.body.appendChild(box);
    var target = null, live = [], B = {}, CUR = {}, AM = null;

    function L(fn){ live.push(fn); return '<span class="lv" data-lv="' + (live.length - 1) + '">…</span>'; }
    function V(n){ return AM && (AM.has(n) || n === 'GND' || n === 'V+' || n === 'VS') ? AM.v(n) : NaN; }
    function refresh(){
      AM = getE();
      B = {}; if(!AM) return;
      AM.branches().forEach(function(b){ if(b.name) B[b.name] = b; });
      CUR = AM.currents();
    }

    /* ---------------- engine source, read from the running functions ---------------- */
    function src(f){ return AM && AM.fn && AM.fn[f] ? AM.fn[f].toString() : ''; }
    function srcLines(f, re){ return src(f).split('\n').filter(function(l){ return re.test(l); }).map(function(l){ return l.trim(); }).join('\n'); }
    function srcBlock(f, re){
      var ls = src(f).split('\n'), out = [], depth = 0, on = false, ind = null;
      for(var i = 0; i < ls.length; i++){
        if(!on && re.test(ls[i])) on = true;
        if(!on) continue;
        if(ind === null) ind = ls[i].match(/^\s*/)[0].length;
        out.push(ls[i].slice(Math.min(ind, ls[i].match(/^\s*/)[0].length)));
        depth += (ls[i].match(/\{/g) || []).length - (ls[i].match(/\}/g) || []).length;
        if(depth <= 0) break;
      }
      return out.join('\n');
    }
    function reEsc(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    /* the line in E.build() that creates this element (names are built as p + '.pot', 'pc' + k, 'sy.r1' ...) */
    function buildLine(name){
      var m = /^(SA|SB|A|B)\.(.+)$/.exec(name), pm = /^(pc|pr|ps)\d+$/.exec(name), re;
      if(m) re = new RegExp("'\\." + reEsc(m[2]) + "'");
      else if(pm) re = new RegExp("'" + pm[1] + "' \\+ k");
      else re = new RegExp("'" + reEsc(name) + "'");
      return srcLines('build', re);
    }
    function code(title, body, full){
      return '<div class="insp-code"><div class="ct">' + title + '</div>' + (body ? '<pre>' + esc(body) + '</pre>' : '') +
        (full ? '<details' + (body ? '' : ' open') + '><summary>完整函數 ' + esc(full) + '()</summary><pre>' + esc(src(full)) + '</pre></details>' : '') + '</div>';
    }
    function stepCode(){
      return code('E.step(Δt)：每 0.2 ms 呼叫一次（backward Euler），解不出來就切 10 個子步', srcLines('step', /newton\(dt/), 'step');
    }

    /* ---------------- per kind ---------------- */
    function row(label, html){ return '<tr><td>' + label + '</td><td class="num">' + html + '</td></tr>'; }
    function table(rows){ return '<table class="insp-t">' + rows.join('') + '</table>'; }
    function eq(lines){ return '<div class="insp-eq">' + lines.join('\n') + '</div>'; }
    function sec(t, body){ return body ? '<h4>' + t + '</h4>' + body : ''; }

    function partHTML(name){
      var b = B[name];
      if(!b) return '<p class="insp-d warn">目前的電路裡沒有這個元件（SW 放開、沒有外加，或這個電路不用）。</p>';
      var n0 = b.nodes[0], n1 = b.nodes[1], K = AM.K, rows = [], eqs = [], hand = [], codes = [];
      var cur = function(){ return CUR[name]; };
      if(b.kind === 'R'){
        rows.push(row(vn(n0), L(function(){ return fV(V(n0)); })), row(vn(n1), L(function(){ return fV(V(n1)); })),
          row('ΔV', L(function(){ return fV(V(n0) - V(n1)); })),
          row('R', fR(b.val) + (/\.sw$/.test(name) ? '（SW 接通）' : '')),
          row('I（' + esc(n0) + ' → ' + esc(n1) + '）', L(function(){ return fI(cur()); })),
          row('P = I²R', L(function(){ return si(cur() * cur() * b.val, 'W'); })));
        eqs.push('歐姆定律：I = (' + vn(n0) + ' − ' + vn(n1) + ') / R',
          '  = (' + L(function(){ return V(n0).toFixed(4); }) + ' − ' + L(function(){ return V(n1).toFixed(4); }) + ') V / ' + fR(b.val) + ' = ' + L(function(){ return fI(cur()); }),
          'Newton 每次迭代把 g = 1/R 蓋進 KCL：F[' + esc(n0) + '] += g·ΔV、F[' + esc(n1) + '] −= g·ΔV，J 的對角 += g、交叉 −= g');
        codes.push(code('E.build() 建立這顆元件的那一行', buildLine(name)),
          code('newton()：電阻蓋進 KCL', srcLines('newton', /R\.length/), 'stampG'),
          code('currents()：上面顯示的電流', srcLines('currents', /R\.length/)));
      } else if(b.kind === 'C'){
        rows.push(row(vn(n0) + ' − ' + vn(n1), L(function(){ return fV(V(n0) - V(n1)); })),
          row('上一步', L(function(){ return fV(AM.vprev(n0) - (n1 === 'GND' ? 0 : AM.vprev(n1))); })),
          row('C', si(b.val, 'F')),
          row('I = C·dV/dt', L(function(){ return fI(cur()); })),
          row('dV/dt', L(function(){ return si(cur() / b.val, 'V/s'); })),
          row('Q = C·V', L(function(){ return si(b.val * (V(n0) - V(n1)), 'C'); })));
        eqs.push('電容：I = C · dV/dt',
          'backward Euler：I<sub>n</sub> = (C/Δt)·(V<sub>n</sub> − V<sub>n−1</sub>)，等效成電導 g = C/Δt 加一個電流源 −g·V<sub>n−1</sub>',
          '  g = ' + si(b.val, 'F') + ' / ' + L(function(){ return si(AM.h(), 's'); }) + ' = ' + L(function(){ return AM.h() ? si(b.val / AM.h(), 'S') : '—'; }),
          '  I = g × (' + L(function(){ return ((V(n0) - V(n1)) * 1e3).toFixed(3); }) + ' − ' + L(function(){ return ((AM.vprev(n0) - (n1 === 'GND' ? 0 : AM.vprev(n1))) * 1e3).toFixed(3); }) + ') mV = ' + L(function(){ return fI(cur()); }));
        codes.push(code('E.build() 建立這顆元件的那一行', buildLine(name)),
          code('newton()：電容（backward Euler）蓋進 KCL', srcBlock('newton', /k < C\.length/), 'stampG'),
          code('currents()：電容電流用上一步', srcLines('currents', /C\.length|lastH \?/)));
      } else if(b.kind === 'D'){
        var M = b.model;
        var dio = function(){ var v = V(n0) - V(n1), x = AM.fn.lexp(v / (M.n * K.VT)); return {v:v, i:M.Is * (x[0] - 1), g:M.Is * x[1] / (M.n * K.VT)}; };
        rows.push(row('V<sub>D</sub> = ' + vn(n0) + ' − ' + vn(n1), L(function(){ return fV(dio().v); })),
          row('I<sub>D</sub>', L(function(){ return fI(cur()); })),
          row('r<sub>d</sub> = 1/g<sub>d</sub>', L(function(){ return fR(1 / dio().g); })));
        eqs.push('Shockley：I<sub>D</sub> = I<sub>S</sub>·(e<sup>V<sub>D</sub>/(n·V<sub>T</sub>)</sup> − 1)，I<sub>S</sub> = ' + si(M.Is, 'A') + '、n = ' + M.n + '、V<sub>T</sub> = ' + (K.VT * 1e3).toFixed(2) + ' mV',
          '  = ' + si(M.Is, 'A') + ' × (e<sup>' + L(function(){ return dio().v.toFixed(4); }) + ' / ' + (M.n * K.VT * 1e3).toFixed(2) + ' mV</sup> − 1) = ' + L(function(){ return fI(dio().i); }),
          'Newton 用的電導：g<sub>d</sub> = I<sub>S</sub>·e<sup>V/(nV<sub>T</sub>)</sup>/(n·V<sub>T</sub>) = ' + L(function(){ return si(dio().g, 'S'); }),
          'lexp()：指數超過 ' + K.EXPLIM + ' 改成線性外插，避免 Newton 第一步就溢位');
        codes.push(code('E.build() 建立這顆元件的那一行', buildLine(name)),
          code('newton()：二極體蓋進 KCL', srcBlock('newton', /k < D\.length/), 'lexp'));
      } else if(b.kind === 'Q'){
        var Mq = b.model, pnp = b.type === 'p', nc = b.nodes[0], nb = b.nodes[1], ne = b.nodes[2];
        var q = function(){
          var vc = V(nc), vb = V(nb), ve = V(ne), j1 = pnp ? ve - vb : vb - ve, j2 = pnp ? vc - vb : vb - vc;
          var ef = AM.fn.lexp(j1 / K.VT), er = AM.fn.lexp(j2 / K.VT), If = Mq.Is * (ef[0] - 1), Ir = Mq.Is * (er[0] - 1);
          var o = AM.fn.bjt(b.type, vc, vb, ve, Mq);
          return {j1:j1, j2:j2, If:If, Ir:Ir, ic:o.i[0], ib:o.i[1], ie:o.i[2], vce:pnp ? ve - vc : vc - ve};
        };
        var J1 = pnp ? 'V<sub>EB</sub>' : 'V<sub>BE</sub>', J2 = pnp ? 'V<sub>CB</sub>' : 'V<sub>BC</sub>';
        var region = function(){ var r = q(); if(Math.abs(r.ic) < 1e-8) return '截止'; return r.j2 > 0.4 ? '飽和' : '主動區'; };
        rows.push(row('C／B／E', esc(nc) + '／' + esc(nb) + '／' + esc(ne)),
          row(J1, L(function(){ return fV(q().j1); })),
          row(pnp ? 'V<sub>EC</sub>' : 'V<sub>CE</sub>', L(function(){ return fV(q().vce); })),
          row('I<sub>C</sub>（流' + (pnp ? '出' : '入') + '集極）', L(function(){ return fI(Math.abs(q().ic)); })),
          row('I<sub>B</sub>（流' + (pnp ? '出' : '入') + '基極）', L(function(){ return fI(Math.abs(q().ib)); })),
          row('I<sub>E</sub>', L(function(){ return fI(Math.abs(q().ie)); })),
          row('β = I<sub>C</sub>/I<sub>B</sub>', L(function(){ var r = q(); return Math.abs(r.ib) > 1e-15 ? (r.ic / r.ib).toFixed(1) : '—'; })),
          row('狀態', L(region)));
        eqs.push('Ebers–Moll（transport 型，' + (pnp ? 'PNP' : 'NPN') + '）：I<sub>S</sub> = ' + si(Mq.Is, 'A') + '、β<sub>F</sub> = ' + Mq.bf + '、β<sub>R</sub> = ' + Mq.br,
          '  ' + J1 + ' = ' + L(function(){ return q().j1.toFixed(4); }) + ' V、' + J2 + ' = ' + L(function(){ return q().j2.toFixed(4); }) + ' V',
          '  I<sub>F</sub> = I<sub>S</sub>·(e<sup>' + J1 + '/V<sub>T</sub></sup> − 1) = ' + L(function(){ return fI(q().If); }),
          '  I<sub>R</sub> = I<sub>S</sub>·(e<sup>' + J2 + '/V<sub>T</sub></sup> − 1) = ' + L(function(){ return fI(q().Ir); }),
          '  I<sub>C</sub> = I<sub>F</sub> − I<sub>R</sub>·(1 + 1/β<sub>R</sub>) = ' + L(function(){ var r = q(); return fI(r.If - r.Ir * (1 + 1 / Mq.br)); }),
          '  I<sub>B</sub> = I<sub>F</sub>/β<sub>F</sub> + I<sub>R</sub>/β<sub>R</sub> = ' + L(function(){ var r = q(); return fI(r.If / Mq.bf + r.Ir / Mq.br); }),
          '  I<sub>E</sub> = I<sub>C</sub> + I<sub>B</sub>' + (pnp ? '（PNP 三個電流都反號）' : ''),
          'E.fn.bjt(\'' + b.type + '\', ' + vn(nc) + ', ' + vn(nb) + ', ' + vn(ne) + ') 流入 C、B、E = [' + L(function(){ var r = q(); return [r.ic, r.ib, r.ie].map(fI).join(', '); }) + ']');
        codes.push(code('E.build() 建立這顆電晶體的那一行', buildLine(name)),
          code('bjt()：Ebers–Moll，回傳流入 (C, B, E) 的電流和 Jacobian', '', 'bjt'),
          code('newton()：電晶體蓋進 KCL', srcBlock('newton', /k < Q\.length/), 'lexp'));
      } else if(b.kind === 'B'){
        rows.push(row(vn(n1) + ' − ' + vn(n0) + '（+ − −）', L(function(){ return fV(V(n1) - V(n0)); })),
          row('電動勢', b.val + ' V'), row('內阻', fR(b.rint)),
          row('I（− → +，經過電池）', L(function(){ return fI(cur()); })));
        eqs.push('電池（Norton 等效）：I = (' + vn(n0) + ' − ' + vn(n1) + ' + ' + b.val + ' V) / ' + fR(b.rint),
          '  = (' + L(function(){ return V(n0).toFixed(4); }) + ' − ' + L(function(){ return V(n1).toFixed(4); }) + ' + ' + b.val + ') / ' + fR(b.rint) + ' = ' + L(function(){ return fI(cur()); }));
        codes.push(code('E.build() 建立電池的那一行', buildLine(name)),
          code('newton()：電池蓋進 KCL', srcLines('newton', /BAT\.length|battery/), 'stampG'));
      }
      handFor(name, hand);
      return '<p class="insp-d">' + esc(partInfo(name)[2]) + '</p>' +
        sec('即時數值', table(rows)) +
        sec('引擎解的方程式（代入現在的數字）', eq(eqs)) +
        sec('手算公式（對照，用現在的數字）', hand.length ? eq(hand) : '') +
        sec('工具包函數（engine.js 正在跑的程式碼）', codes.join('') + stepCode());
    }

    /* hand formulas, evaluated with the live node voltages */
    function handFor(name, h){
      var K = AM.K, st = AM.st, m;
      if((m = /^(SA|SB)\.(sw|pot|r7a|r7b|pass|sense|rx)$/.exec(name))){
        var p = m[1], rp = function(){ return Math.max(p === 'SA' ? AM.st.rpotA : AM.st.rpotB, 1) + 7e3; };
        h.push('按下：I<sub>stim</sub> ≈ V<sub>EB</sub>(Q_sense) / (pot + 7 kΩ) = (' + vn(p + '.P') + ' − ' + vn(p + '.Q') + ') / ' + L(function(){ return fR(rp()); }),
          '   = ' + L(function(){ return fV(V(p + '.P') - V(p + '.Q')); }) + ' / ' + L(function(){ return fR(rp()); }) + ' = ' + L(function(){ return fI((V(p + '.P') - V(p + '.Q')) / rp()); }) + '（SW 放開時 P 浮空，這行沒有意義）',
          '放開：漏電 ≈ I<sub>B</sub>(Q_sense) = (' + vn(p + '.R') + ' / 7 kΩ) / ' + K.M4403.bf + ' = ' + L(function(){ return fI(V(p + '.R') / 7e3 / K.M4403.bf); }),
          '實際 Q_pass 集極輸出：' + L(function(){ var c = CUR[p + '.pass']; return c ? fI(-c[0]) : '—'; }));
      }
      if((m = /^(A|B)\.(fid|fir3|fi3904|fire|rf)$/.exec(name))){
        var a = m[1];
        h.push('門檻：' + vn(a + '.Vm') + ' = V<sub>D1</sub> + V<sub>BE</sub>(3904) + ' + vn(a + '.FI.E3'),
          '   = ' + L(function(){ return fV(V(a + '.Vm') - V(a + '.FI.B3')); }) + ' + ' + L(function(){ return fV(V(a + '.FI.B3') - V(a + '.FI.E3')); }) + ' + ' + L(function(){ return fV(V(a + '.FI.E3')); }) + ' = ' + L(function(){ return fV(V(a + '.Vm')); }));
      }
      if((m = /^(A|B)\.(r13|r13p|fi4403)$/.exec(name))){
        var a2 = m[1];
        h.push('I<sub>FI</sub>（4403 射極）= ' + L(function(){ var c = CUR[a2 + '.fi4403']; return c ? fI(-c[2]) : '—'; }),
          '上限 ≈ (V+ − ' + vn(a2 + '.Vm') + ' − 0.1 V) / R13' + (B[a2 + '.r13p'] ? ' ∥ 11 kΩ' : '') + ' = ' + L(function(){ var r = B[a2 + '.r13p'] ? 1 / (1 / 1e5 + 1 / B[a2 + '.r13p'].val) : 1e5; return fI(Math.max(0, AM.st.vplus - V(a2 + '.Vm') - 0.1) / r); }));
      }
      if((m = /^(A|B)\.(sor1|soc|rs|sod|sor2|so3904|so4403|sor1k)$/.exec(name))){
        var a3 = m[1];
        h.push('SO.S 的時間常數：τ = R1' + (B[a3 + '.rs'] ? ' ∥ 56 kΩ' : '') + ' × 1 µF = ' + L(function(){ var r = B[a3 + '.rs'] ? 1 / (1 / 1e5 + 1 / B[a3 + '.rs'].val) : 1e5; return si(r * 1e-6, 's'); }),
          '打開條件：' + vn(a3 + '.SO.S') + ' ≳ V<sub>D1</sub> + V<sub>BE</sub>(3904)：現在 ' + L(function(){ return fV(V(a3 + '.SO.S')); }),
          '外向電流 I<sub>SO</sub>（4403 射極）= ' + L(function(){ var c = CUR[a3 + '.so4403']; return c ? fI(c[2]) : '—'; }));
      }
      if(/^(A|B)\.(lkc|lkr)$/.test(name) || /^(pc|pr)\d$/.test(name)){
        h.push('膜的時間常數：τ = R·C = 100 kΩ × 1 µF = 100 ms');
      }
      if(/^ps\d$/.test(name)) h.push('離散的電纜：λ ≈ √(r<sub>m</sub>/r<sub>i</sub>) = √(100 kΩ / 10 kΩ) ≈ 3.2 個 unit');
      /* synapse input: the 820k : 100k divider after D1 decides whether Q2 opens (10-21: Q2 base 0.17 V without 100k) */
      if(/^sy\.(r1|r1p|d1|c1|r2|q2|r3)$/.test(name)){
        var r1 = function(){ var x = B['sy.r1p']; return x ? 1 / (1 / 820e3 + 1 / x.val) : 820e3; };
        h.push('輸入電阻 R1<sub>eff</sub> = 820 kΩ' + (B['sy.r1p'] ? ' ∥ ' + fR(B['sy.r1p'].val) : '') + ' = ' + L(function(){ return fR(r1()); }),
          '分壓（D1 導通時）：' + vn('SY.B') + ' ≈ (' + vn('A.Vm') + ' − V<sub>D1</sub>) × 100 kΩ / (R1<sub>eff</sub> + 100 kΩ)',
          '   = (' + L(function(){ return fV(V('A.Vm')); }) + ' − ' + L(function(){ return fV(V('SY.A') - V('SY.B')); }) + ') × ' + L(function(){ return (1e5 / (r1() + 1e5)).toFixed(3); }) + ' = ' + L(function(){ return fV((V('A.Vm') - (V('SY.A') - V('SY.B'))) * 1e5 / (r1() + 1e5)); }) + '（實際 ' + L(function(){ return fV(V('SY.B')); }) + '）',
          'Q2 要導通：' + vn('SY.B') + ' ≳ 0.55 V；Q2 電流 ≈ (' + vn('SY.B') + ' − V<sub>BE</sub>) / 30 kΩ = ' + vn('SY.E2') + ' / 30 kΩ = ' + L(function(){ return fI(V('SY.E2') / 30e3); }),
          '反推：Pre 的 AP 至少要 0.55 V × (R1<sub>eff</sub> + 100 kΩ)/100 kΩ + 0.45 V = ' + L(function(){ return fV(0.55 * (r1() + 1e5) / 1e5 + 0.45); }));
      }
      if(/^sy\.(q1|r4|c2|r5|d2|r6|bat)$/.test(name)){
        h.push('S 的時間常數：τ = 4.7 µF × 200 kΩ = 0.94 s（Post 也接在 S 上時會再快一點）',
          'Q1 電流 ≈ β × I<sub>C</sub>(Q2)，上限由 Q1 那顆 1 kΩ（Excitatory）決定',
          '現在 Q1 集極電流：' + L(function(){ var c = CUR['sy.q1']; return c ? fI(-c[0]) : '—'; }) + '；' + vn('SY.S') + ' = ' + L(function(){ return fV(V('SY.S')); }));
        if(st.syn === 'exc') h.push('S 的天花板 ≈ V+ − V<sub>EC,sat</sub>(Q1) − I·1 kΩ；P1 ≈ S − V<sub>D2</sub>（PCB 沒有 100 kΩ）。10-21 我們的板子：EPSP 頂在約 6.5 V＝飽和');
        else h.push('IPSP：S 被拉到約 −(1.5 V − V<sub>EC</sub>)，經 100 kΩ 把 Post 往下拉；拔掉電池（跳線）只剩 shunting');
      }
    }

    function netHTML(n){
      var fixed = n === 'GND' || n === 'V+' || n === 'VS';
      if(!fixed && !AM.has(n)) return '<p class="insp-d warn">目前的電路裡沒有這個節點。</p>';
      var K = AM.K, rows = [], eqs = [];
      var touching = function(){
        var o = [];
        for(var k in B){
          var b = B[k], I = 0, hit = false, c = CUR[k];
          if(b.kind === 'Q'){ b.nodes.forEach(function(x, t){ if(x === n){ hit = true; I += c ? c[t] : 0; } }); }
          else { if(b.nodes[0] === n){ hit = true; I += c || 0; } if(b.nodes[1] === n){ hit = true; I -= c || 0; } }
          if(hit && b.nodes.every(function(x){ return x === n; })) hit = false;
          if(hit) o.push({name:k, b:b, I:I});
        }
        o.sort(function(a, b2){ return Math.abs(b2.I) - Math.abs(a.I); });
        return o;
      };
      var dvdt = function(){ return AM.h() && !fixed ? (V(n) - AM.vprev(n)) / AM.h() : 0; };
      rows.push(row(vn(n), L(function(){ return fixed ? fV(V(n)) + '（固定）' : fV(V(n)); })),
        row('上一步', L(function(){ return fixed ? '—' : fV(AM.vprev(n)); })),
        row('dV/dt', L(function(){ return fixed ? '—' : si(dvdt(), 'V/s'); })));
      var list = touching();
      var kcl = '<table class="insp-t kcl"><tr><th>元件</th><th class="num">流出這個節點</th></tr>' + list.map(function(x){
        var pi = partInfo(x.name), other = x.b.nodes.filter(function(y){ return y !== n; }).join('、');
        return '<tr><td>' + esc(pi[0]) + ' <span class="muted">→ ' + esc(other) + '</span></td><td class="num">' +
          L(function(){ var y = touching().filter(function(z){ return z.name === x.name; })[0]; return y ? fI(y.I) : '—'; }) + '</td></tr>';
      }).join('') +
        (fixed ? '' : '<tr><td>雜散電容 ' + si(K.CPAR, 'F') + ' × dV/dt</td><td class="num">' + L(function(){ return fI(K.CPAR * dvdt()); }) + '</td></tr>') +
        '<tr class="sum"><td>' + (fixed ? '電池送進這個節點' : 'Σ（應為 0）') + '</td><td class="num">' + L(function(){
          var s = touching().reduce(function(a, x){ return a + x.I; }, 0) + (fixed ? 0 : K.CPAR * dvdt() + K.GMIN * V(n));
          return fI(s);
        }) + '</td></tr></table>';
      if(fixed) eqs.push(n === 'GND' ? 'GND 固定 0 V（IDX = −1）：所有電壓都對它量' : '電池正極固定在 ' + (n === 'VS' ? (AM.st.vsyn || AM.st.vplus) : AM.st.vplus) + ' V，不是未知數；引擎用 IDX = ' + (n === 'VS' ? '−3' : '−2') + ' 代表它');
      else eqs.push('KCL：Σ<sub>k</sub> I<sub>k</sub>(V) + C<sub>par</sub>·dV/dt + g<sub>min</sub>·' + vn(n) + ' = 0（每個元件的電流見下表）',
        'Newton–Raphson：J·ΔV = −F，ΔV 每步最多 0.1 V；|ΔV| < 0.1 µV 或每個節點 |F| < 10 pA 就收斂',
        '上一步：' + L(function(){ return 'Newton ' + AM.stat.it + ' 次迭代' + (AM.stat.sub ? '（切成 10 個子步）' : '') + '，Δt = ' + si(AM.h(), 's'); }),
        'g<sub>min</sub> = ' + si(K.GMIN, 'S') + '、C<sub>par</sub> = ' + si(K.CPAR, 'F') + '（配線）接在每個節點到 GND');
      return '<p class="insp-d">' + esc(nodeInfo(n)) + '</p>' +
        sec('即時數值', table(rows)) +
        sec('KCL：接在這個節點的元件', kcl) +
        sec('引擎解的方程式', eq(eqs)) +
        sec('工具包函數（engine.js 正在跑的程式碼）',
          code('newton()：每個節點的 KCL 殘差 F 和 Jacobian J', srcLines('newton', /stampG\(k, -1, gmin|CPAR \/ dt|F\.fill/), 'newton') +
          code('newton()：收斂判斷與阻尼', srcLines('newton', /fm < 1e-11|mx <= 0\.1|mx < 1e-7/), 'stampG') +
          stepCode());
    }

    /* ---------------- window ---------------- */
    function render(){
      live = [];
      refresh();
      if(!AM){ close(); return; }
      var t = target, title, sub;
      if(t.part){ var pi = partInfo(t.part); title = pi[0]; sub = (pi[1] ? pi[1] + '・' : '') + '元件 ' + t.part; }
      else { title = 'Net ' + t.node; sub = '節點（同一條導線上的電壓都一樣）'; }
      box.innerHTML = '<div class="insp-h"><div><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></div>' +
        '<button type="button" class="insp-x" aria-label="關閉">✕</button></div>' +
        '<div class="insp-b">' + (t.part ? partHTML(t.part) : netHTML(t.node)) +
        '<p class="insp-f">數字每 0.1 秒更新，和示波器同一個模擬（這一區的 SynEngine）。元件模型和 HW2 相同（<a href="../hw2-debug/sim/sim.py">hw2-debug/sim/sim.py</a>）。</p></div>';
      box.querySelector('.insp-x').addEventListener('click', close);
      drag(box.querySelector('.insp-h'));
      update();
    }
    function update(){
      if(!target || box.hidden) return;
      refresh();
      var spans = box.querySelectorAll('[data-lv]');
      for(var i = 0; i < spans.length; i++){
        var f = live[+spans[i].dataset.lv], s;
        try{ s = f(); }catch(e){ s = '—'; }
        if(spans[i].textContent !== s) spans[i].textContent = s;
      }
    }
    function place(x, y){
      var w = box.offsetWidth, h = box.offsetHeight, W = window.innerWidth, H = window.innerHeight;
      if(W <= 600){ box.style.left = ''; box.style.top = ''; return; }
      var left = x + 16 + w > W - 8 ? x - w - 16 : x + 16, top = Math.min(Math.max(8, y - 40), H - h - 8);
      box.style.left = Math.max(8, left) + 'px'; box.style.top = Math.max(8, top) + 'px';
    }
    function open(t, x, y){
      var again = !box.hidden;
      target = t; box.hidden = false;
      render();
      if(!again || x != null) place(x == null ? window.innerWidth / 2 : x, y == null ? 80 : y);
    }
    var onClose = null;
    function close(){ target = null; box.hidden = true; box.innerHTML = ''; if(onClose) onClose(); }
    function drag(hd){
      hd.addEventListener('pointerdown', function(e){
        if(e.target.closest('button') || window.innerWidth <= 600) return;
        var r = box.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
        hd.setPointerCapture(e.pointerId);
        var mv = function(ev){ box.style.left = Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - dx)) + 'px'; box.style.top = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy)) + 'px'; };
        var up = function(){ hd.removeEventListener('pointermove', mv); hd.removeEventListener('pointerup', up); };
        hd.addEventListener('pointermove', mv); hd.addEventListener('pointerup', up);
      });
    }
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && target) close(); });
    return {open:open, close:close, update:update, rerender:function(){ if(target) render(); },
      target:function(){ return target; }, onClose:function(f){ onClose = f; }};
  };
})();
