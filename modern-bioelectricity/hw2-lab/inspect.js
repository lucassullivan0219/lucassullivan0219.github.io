/* HW2 實驗台 circuit inspector: click a part or a wire on a schematic and a window shows the equations the engine
   solves for it, the engine code that does it (../active-membrane-sim/engine.js, read from the running functions)
   and the live numbers, refreshed with the scope.

   var I = HW2Inspect(AM);
   I.open({part:'r13'} | {node:'FI.E4'}, x, y)   I.update()   I.close()   I.target()
*/
(function(){
  'use strict';

  /* ---------------- names ---------------- */
  var PART = {
    sw:['SW 按鈕', 'Stimulator', '按下＝接通 V+ → ST.P。引擎把它當成一顆電阻：接通 0.05 Ω、斷開 10 TΩ。'],
    pot:['可變電阻 pot', 'Stimulator', '0–10 kΩ，和 7 kΩ 一起決定刺激電流。'],
    r7a:['7 kΩ（pot → Q_pass 射極）', 'Stimulator', '刺激電流流過 pot + 7 kΩ，壓降就是 Q_sense 的 V_EB。'],
    r7b:['7 kΩ（Q_sense 集極 → GND）', 'Stimulator', 'Q_sense 的集極電流在這裡變成 Q_pass 的基極電壓。'],
    pass:['Q_pass 2N4403', 'Stimulator', '輸出電晶體：射極 ST.Q、基極 ST.R，集極送出刺激電流。'],
    sense:['Q_sense 2N4403', 'Stimulator', '基極接 ST.Q：pot + 7 kΩ 上的壓降到約 0.65 V 就導通、把 Q_pass 關小，所以電流 ≈ V_EB／(pot + 7 kΩ)。射極接在 SW 之前，放開時還漏電。'],
    rx:['Q_pass E–B 外加電阻', '外加', '把 Q_sense 漏出的基極電流旁路掉，放開時 Q_pass 不再漏電。'],
    is:['理想電流源', '外加（模擬用）', '取代 SW：從固定節點 IS（10⁹ × I 伏特）經 1 GΩ 送出電流。'],
    lk:['LK 排針接點', 'Leak', 'Vm ↔ LK.Vm。'],
    lkc:['LK 1 µF', 'Leak', '膜電容 C_m。'],
    lkr:['LK 100 kΩ', 'Leak', '漏電阻 R_leak（E_leak = 0 V）。'],
    lk2:['LK2 排針接點', 'Leak（第二塊）', 'Vm ↔ LK2.Vm，直接疊在 LK 上，中間沒有 10 kΩ／100 Ω。'],
    lk2c:['LK2 1 µF', 'Leak（第二塊）', '和 LK 的 1 µF 並聯：C_m 變 2 µF。'],
    lk2r:['LK2 100 kΩ', 'Leak（第二塊）', '和 LK 的 100 kΩ 並聯：R_leak 變 50 kΩ。'],
    fivm:['FI 排針接點 Vm', 'Fast inward', 'Vm ↔ FI.Vm。'],
    fivp:['FI 排針接點 V+', 'Fast inward', 'FI.V+ ↔ V+（n = 0 走疊接排針，n ≥ 1 要拉飛線）。'],
    figd:['FI 排針接點 GND', 'Fast inward', 'FI.GND ↔ 細胞外。'],
    fid:['FI D1 1N4148', 'Fast inward', 'Vm → FI.B3：門檻多一個二極體壓降。'],
    fir3:['FI 3 MΩ', 'Fast inward', 'FI.B3 → FI.GND：3904 基極下拉。'],
    fi3904:['FI 2N3904', 'Fast inward', 'Vm 過門檻就導通，拉 4403 的基極。'],
    fire:['FI 3904 射極電阻', 'Fast inward', 'FI.E3 → GND：射極電壓墊高門檻。'],
    fi4403:['FI 2N4403', 'Fast inward', '送出內向電流（Na⁺）：射極 FI.E4（R13 → V+），集極 FI.Vm。'],
    r13:['R13', 'Fast inward', '4403 的射極電阻，限制內向電流的上限。'],
    r13p:['R13 兩端外加電阻', '外加', '和 R13 並聯，FI 能送更大的電流（真正的 AP 用 11 kΩ）。'],
    rf:['R13 下端 → FI.E3 外加電阻', '外加', '從 V+ 給 FI.E3 一個偏壓，門檻抬高（真正的 AP 用 680 kΩ）。'],
    sovm:['SO 排針接點 Vm', 'Slow out', 'Vm ↔ SO.Vm。'],
    sogd:['SO 排針接點 GND', 'Slow out', 'SO.GND ↔ 細胞外。'],
    sor1:['SO R1 100 kΩ', 'Slow out', 'Vm → SO.S：和 C1 組成慢的低通（K⁺ 通道的 n）。'],
    soc:['SO C1 1 µF', 'Slow out', 'SO.S 的電容：慢變數。'],
    sod:['SO D1 1N4148', 'Slow out', 'SO.S → SO.B3。'],
    sor2:['SO R2', 'Slow out', 'SO.B3 → GND（PCB 標 3M，現在都是助教的 1 MΩ）。'],
    so3904:['SO 2N3904', 'Slow out', 'SO.S 夠高就導通，拉 4403 的基極。'],
    so4403:['SO 2N4403', 'Slow out', '送出外向電流（K⁺）：射極 SO.Vm，集極經 1 kΩ 到地。'],
    sor1k:['SO 1 kΩ', 'Slow out', '4403 集極到 GND。'],
    rs:['SO C1 外加並聯電阻', '外加', 'SO.S 只到 Vm 的一部分：靜止時 Slow out 關著（真正的 AP 用 56 kΩ）。'],
    rb:['V+ → Vm 外加電阻', '外加', '把靜止電位抬高（真正的 AP 用 330 kΩ）。'],
    rl:['Vm → GND 外加電阻', '外加', '多一條 leak。'],
    p1:['示波器 CH1 探棒', '示波器', '×10 探棒＝10 MΩ 到 GND。'],
    p2:['示波器 CH2 探棒', '示波器', '×10 探棒＝10 MΩ 到 GND。']
  };
  function partInfo(name){
    if(PART[name]) return PART[name];
    var m = /^(pc|pr|ps|px|ru)(\d+)$/.exec(name || ''), k = m && +m[2];
    if(!m) return [name, '', ''];
    return ({
      pc:['Passive #' + k + ' 1 µF', 'Passive #' + k, '這段膜的電容。'],
      pr:['Passive #' + k + ' 100 kΩ', 'Passive #' + k, '這段膜的漏電阻。'],
      ps:['10 kΩ（#' + k + ' → 下一段，細胞內）', 'Passive #' + k, '細胞內的軸向電阻 r_i。'],
      px:['100 Ω（#' + k + ' → 下一段，細胞外）', 'Passive #' + k, '細胞外的軸向電阻 r_o。'],
      ru:['V+ → #' + k + ' 外加電阻', '外加', '讓這段膜靜止在和 active 端一樣的電位（真正的 AP 用 560 kΩ）。']
    })[m[1]];
  }
  var NODE = {
    'V+':'電池正極（固定）', 'GND':'電池負極（示波器地線夾這裡）', 'Vm':'膜電位：Stimulator 輸出（n = 0）或 active 端（n ≥ 1）',
    'ST.P':'SW 和 pot 之間', 'ST.K':'pot 和 7 kΩ 之間', 'ST.Q':'Q_pass 射極＝Q_sense 基極', 'ST.R':'Q_pass 基極＝Q_sense 集極',
    'LK.Vm':'Leak 板內（排針之後）', 'LK2.Vm':'第二塊 Leak 板內（排針之後）',
    'FI.Vm':'FI 板內的 Vm（排針之後）', 'FI.V+':'R13 下端（FI 的 V+）', 'FI.GND':'FI 板的地', 'FI.B3':'3904 基極（D1 之後）',
    'FI.E3':'3904 射極', 'FI.B4':'4403 基極＝3904 集極', 'FI.E4':'4403 射極＝R13 上端', 'FI.BAT':'FI 自帶電池的正極',
    'SO.Vm':'SO 板內的 Vm（排針之後）', 'SO.GND':'SO 板的地', 'SO.S':'C1 上腳：Slow out 的慢變數', 'SO.B3':'3904 基極（D1 之後）',
    'SO.B4':'4403 基極＝3904 集極', 'SO.C4':'4403 集極（1 kΩ 上端）', 'AX':'active 端的細胞外（n ≥ 1）'
  };
  function nodeInfo(n){
    if(NODE[n]) return NODE[n];
    var m = /^(PC|PX)(\d+)$/.exec(n || '');
    return m ? 'Passive #' + m[2] + (m[1] === 'PC' ? ' 細胞內' : ' 細胞外') : '';
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

  window.HW2Inspect = function(AM){
    var box = document.createElement('div');
    box.className = 'insp'; box.hidden = true;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '電路檢視');
    document.body.appendChild(box);
    var target = null, live = [], B = {}, CUR = {};

    /* live placeholders: L(fn) -> a span the update loop refills with fn() */
    function L(fn){ live.push(fn); return '<span class="lv" data-lv="' + (live.length - 1) + '">…</span>'; }
    function V(n){ return AM.has(n) || n === 'GND' || n === 'V+' ? AM.v(n) : NaN; }
    function refresh(){
      B = {}; AM.branches().forEach(function(b){ if(b.name) B[b.name] = b; });
      CUR = AM.currents();
    }

    /* ---------------- engine source, read from the running functions ---------------- */
    function src(f){ return AM.fn && AM.fn[f] ? AM.fn[f].toString() : ''; }
    function srcLines(f, re){ return src(f).split('\n').filter(function(l){ return re.test(l); }).map(function(l){ return l.trim(); }).join('\n'); }
    /* the block that starts at the first line matching re, to its closing brace */
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
    /* the line in AM.build() that creates this element */
    function buildLine(name){
      var base = name.replace(/\d+$/, ''), loop = base !== name && /^(pc|pr|ps|px|ru)$/.test(base);
      var re = loop ? new RegExp("'" + base + "' \\+ k") : new RegExp("'" + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'[\\])]");
      var l = srcLines('build', re);
      if(name === 'sw' || name === 'fivp' || name === 'lk' || name === 'lk2' || /^(fivm|figd|sovm|sogd)$/.test(name)) l += '\n' + srcLines('build', /function link|return ok \?/) + srcLines('link', /return/);
      return l;
    }
    function code(title, body, full){
      return '<div class="insp-code"><div class="ct">' + title + '</div>' + (body ? '<pre>' + esc(body) + '</pre>' : '') +
        (full ? '<details' + (body ? '' : ' open') + '><summary>完整函數 ' + esc(full) + '()</summary><pre>' + esc(src(full)) + '</pre></details>' : '') + '</div>';
    }
    function stepCode(){
      return code('AM.step(Δt)：每 0.2 ms 呼叫一次（backward Euler），解不出來就切 10 個子步', srcLines('step', /newton\(dt/), 'step');
    }

    /* ---------------- per kind ---------------- */
    function row(label, html){ return '<tr><td>' + label + '</td><td class="num">' + html + '</td></tr>'; }
    function table(rows){ return '<table class="insp-t">' + rows.join('') + '</table>'; }
    function eq(lines){ return '<div class="insp-eq">' + lines.join('\n') + '</div>'; }
    function sec(t, body){ return body ? '<h4>' + t + '</h4>' + body : ''; }

    function partHTML(name){
      var b = B[name];
      if(!b) return '<p class="insp-d warn">目前的電路裡沒有這個元件（板子拔掉、沒有外加，或這個模式不用）。</p>';
      var n0 = b.nodes[0], n1 = b.nodes[1], K = AM.K, rows = [], eqs = [], hand = [], codes = [];
      var cur = function(){ return CUR[name]; };
      if(b.kind === 'R'){
        var contact = b.val <= K.SHORT * 1.0001 || b.val >= K.OPEN * 0.999, isrc = name === 'is';
        rows.push(row(vn(n0), L(function(){ return fV(V(n0)); })), row(vn(n1), L(function(){ return fV(V(n1)); })),
          row('ΔV', L(function(){ return fV(V(n0) - V(n1)); })),
          row('R', L(function(){ var x = B[name]; return x ? fR(x.val) + (contact ? (x.val <= K.SHORT * 1.0001 ? '（接通）' : '（斷開）') : '') : '—'; })),
          row('I（' + esc(n0) + ' → ' + esc(n1) + '）', L(function(){ return fI(cur()); })),
          row('P = I²R', L(function(){ var x = B[name]; return x ? si(cur() * cur() * x.val, 'W') : '—'; })));
        eqs.push('歐姆定律：I = (' + vn(n0) + ' − ' + vn(n1) + ') / R',
          '  = (' + L(function(){ return V(n0).toFixed(4); }) + ' − ' + L(function(){ return V(n1).toFixed(4); }) + ') V / ' + L(function(){ var x = B[name]; return x ? fR(x.val) : '—'; }) + ' = ' + L(function(){ return fI(cur()); }),
          'Newton 每次迭代把 g = 1/R 蓋進 KCL：F[' + esc(n0) + '] += g·ΔV、F[' + esc(n1) + '] −= g·ΔV，J 的對角 += g、交叉 −= g');
        if(contact) eqs.push('接點／開關：link(ok) → 接通 ' + K.SHORT + ' Ω、斷開 ' + si(K.OPEN, 'Ω', 2));
        if(isrc) eqs.push('理想電流源：IS 節點固定在 10⁹ × I_set 伏特，經 1 GΩ → I ≈ I_set − ' + vn(n1) + '/1 GΩ');
        codes.push(code('AM.build() 建立這顆元件的那一行', buildLine(name)),
          code('newton()：電阻蓋進 KCL', srcLines('newton', /R\.length/), 'stampG'),
          code('currents()：上面顯示的電流', srcLines('currents', /R\.length/)));
      } else if(b.kind === 'C'){
        rows.push(row(vn(n0) + ' − ' + vn(n1), L(function(){ return fV(V(n0) - V(n1)); })),
          row('上一步', L(function(){ return fV(AM.vprev(n0) - AM.vprev(n1)); })),
          row('C', si(b.val, 'F')),
          row('I = C·dV/dt', L(function(){ return fI(cur()); })),
          row('dV/dt', L(function(){ return si(cur() / b.val, 'V/s'); })),
          row('Q = C·V', L(function(){ return si(b.val * (V(n0) - V(n1)), 'C'); })));
        eqs.push('電容：I = C · dV/dt',
          'backward Euler：I<sub>n</sub> = (C/Δt)·(V<sub>n</sub> − V<sub>n−1</sub>)，等效成電導 g = C/Δt 加一個電流源 −g·V<sub>n−1</sub>',
          '  g = ' + si(b.val, 'F') + ' / ' + L(function(){ return si(AM.h(), 's'); }) + ' = ' + L(function(){ return AM.h() ? si(b.val / AM.h(), 'S') : '—'; }),
          '  I = g × (' + L(function(){ return ((V(n0) - V(n1)) * 1e3).toFixed(3); }) + ' − ' + L(function(){ return ((AM.vprev(n0) - AM.vprev(n1)) * 1e3).toFixed(3); }) + ') mV = ' + L(function(){ return fI(cur()); }));
        codes.push(code('AM.build() 建立這顆元件的那一行', buildLine(name)),
          code('newton()：電容（backward Euler）蓋進 KCL', srcBlock('newton', /k < C\.length/), 'stampG'),
          code('currents()：電容電流用上一步', srcBlock('currents', /k < C\.length/)));
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
        codes.push(code('AM.build() 建立這顆元件的那一行', buildLine(name)),
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
          'AM.fn.bjt(\'' + b.type + '\', ' + vn(nc) + ', ' + vn(nb) + ', ' + vn(ne) + ') 流入 C、B、E = [' + L(function(){ var r = q(); return [r.ic, r.ib, r.ie].map(fI).join(', '); }) + ']');
        codes.push(code('AM.build() 建立這顆電晶體的那一行', buildLine(name)),
          code('bjt()：Ebers–Moll，回傳流入 (C, B, E) 的電流和 Jacobian', '', 'bjt'),
          code('newton()：電晶體蓋進 KCL', srcBlock('newton', /k < Q\.length/), 'lexp'));
      }
      handFor(name, hand);
      return '<p class="insp-d">' + esc(partInfo(name)[2]) + '</p>' +
        sec('即時數值', table(rows)) +
        sec('引擎解的方程式（代入現在的數字）', eq(eqs)) +
        sec('手算公式（對照，用現在的數字）', hand.length ? eq(hand) : '') +
        sec('工具包函數（engine.js 正在跑的程式碼）', codes.join('') + stepCode());
    }

    /* hand formulas from the analysis pages, evaluated with the live node voltages */
    function handFor(name, h){
      var K = AM.K, st = AM.st, base = name.replace(/\d+$/, '');
      if(/^(sw|pot|r7a|r7b|pass|sense|rx)$/.test(name)){
        h.push('按下：I<sub>stim</sub> ≈ V<sub>EB</sub>(Q_sense) / (pot + 7 kΩ) = (' + vn('ST.P') + ' − ' + vn('ST.Q') + ') / ' + L(function(){ return fR(Math.max(AM.st.rpot, 1) + 7e3); }),
          '   = ' + L(function(){ return fV(V('ST.P') - V('ST.Q')); }) + ' / ' + L(function(){ return fR(Math.max(AM.st.rpot, 1) + 7e3); }) + ' = ' + L(function(){ return fI((V('ST.P') - V('ST.Q')) / (Math.max(AM.st.rpot, 1) + 7e3)); }) + '（SW 放開時 ST.P 浮空，這行沒有意義）',
          '放開：漏電 ≈ I<sub>B</sub>(Q_sense) = I<sub>C</sub>(Q_sense)/β<sub>F</sub> = (' + vn('ST.R') + ' / 7 kΩ) / ' + K.M4403.bf + ' = ' + L(function(){ return fI(V('ST.R') / 7e3 / K.M4403.bf); }),
          '實際 Q_pass 集極輸出：' + L(function(){ var c = CUR.pass; return c ? fI(-c[0]) : '—'; }));
      }
      if(/^(r13|r13p|fi4403|fivp)$/.test(name)){
        var reff = function(){ return AM.st.r13p ? 1 / (1 / AM.st.r13 + 1 / AM.st.r13p) : AM.st.r13; };
        h.push('R13 有效值 = R13' + (st.r13p ? ' ∥ 外加' : '') + ' = ' + L(function(){ return fR(reff()); }),
          'I<sub>FI</sub> = (' + vn('FI.V+') + ' − ' + vn('FI.E4') + ') / R13<sub>eff</sub> = ' + L(function(){ return fI((V('FI.V+') - V('FI.E4')) / reff()); }),
          '上限（4403 飽和、E4 ≈ Vm + 0.1 V）≈ (' + vn('FI.V+') + ' − ' + vn('Vm') + ' − 0.1) / R13<sub>eff</sub> = ' + L(function(){ return fI(Math.max(0, V('FI.V+') - V('Vm') - 0.1) / reff()); }));
      }
      if(/^(fid|fir3|fi3904|fire|rf)$/.test(name)){
        h.push('門檻：' + vn('FI.Vm') + ' = V<sub>D1</sub> + V<sub>BE</sub>(3904) + ' + vn('FI.E3'),
          '   = ' + L(function(){ return fV(V('FI.Vm') - V('FI.B3')); }) + ' + ' + L(function(){ return fV(V('FI.B3') - V('FI.E3')); }) + ' + ' + L(function(){ return fV(V('FI.E3')); }) + ' = ' + L(function(){ return fV(V('FI.Vm')); }),
          'V<sub>BE</sub> 到約 0.55 V、D1 到約 0.5 V，3904 才開始導通（FI.E3 再墊高門檻）' + (st.rf ? '；外加偏壓：' + vn('FI.E3') + ' ≈ V+·R<sub>fe</sub>/(R<sub>fe</sub> + 外加) = ' + L(function(){ return fV(AM.st.vplus * AM.st.rfe / (AM.st.rfe + AM.st.rf)); }) : ''));
      }
      if(/^(sor1|soc|rs|sod|sor2|so3904|so4403|sor1k)$/.test(name)){
        h.push('SO.S 的時間常數：τ = (R1' + (st.rs ? ' ∥ 外加' : '') + ')·C1 = ' + L(function(){ var r = AM.st.rs ? 1 / (1 / 1e5 + 1 / AM.st.rs) : 1e5; return si(r * 1e-6, 's'); }) +
            (st.rs ? '；穩態 SO.S = Vm·外加/(R1 + 外加) = ' + L(function(){ return fV(V('Vm') * AM.st.rs / (1e5 + AM.st.rs)); }) : ''),
          '打開條件：' + vn('SO.S') + ' ≳ V<sub>D1</sub> + V<sub>BE</sub>(3904)：現在 ' + L(function(){ return fV(V('SO.S')); }) + ' vs ' + L(function(){ return fV(V('SO.S') - V('SO.B3')); }) + ' + ' + L(function(){ return fV(V('SO.B3')); }),
          '外向電流 I<sub>SO</sub>（4403 射極）= ' + L(function(){ var c = CUR.so4403; return c ? fI(c[2]) : '—'; }) + '；Slow out 能把 Vm 拉到的最低（E<sub>K</sub>）≈ ' + vn('SO.B4') + '（全開時約 0.05 V）+ V<sub>EB</sub>(10 µA) ≈ 0.59 V，現在 ' + vn('SO.B4') + ' = ' + L(function(){ return fV(V('SO.B4')); }));
      }
      if(/^(lkc|lkr|lk|lk2|lk2c|lk2r|pc|pr)$/.test(base)){
        var two = AM.st.lk2 && /^lk/.test(name);
        h.push('膜的時間常數：τ = R·C = 100 kΩ × 1 µF = 100 ms' + (two ? '（兩塊 LK 並聯：50 kΩ × 2 µF，τ 一樣是 100 ms，但同樣電流只充到一半電壓）' : ''),
          '漏電流 I = V/R：' + L(function(){ var b = B[name.replace(/c$/, 'r').replace(/^pc/, 'pr').replace(/^lk(2?)$/, 'lk$1r')]; return b ? fI((V(b.nodes[0]) - V(b.nodes[1])) / b.val) : '—'; }));
      }
      if(/^(ps|px)$/.test(base)){
        h.push('離散的電纜：λ ≈ √(r<sub>m</sub>/r<sub>i</sub>) = √(100 kΩ / 10 kΩ) ≈ 3.2 個 unit',
          '細胞外每段 100 Ω：I × 100 Ω 就是 CH2 量到的那一點點電壓');
      }
      if(name === 'rb') h.push('偏壓電流 (V+ − Vm)/R = ' + L(function(){ return fI((AM.st.vplus - V('Vm')) / AM.st.rb); }) + '；真正的 AP：(7.8 − Vm)/330k = Vm/100k + Vm/156k → Vm ≈ 1.19 V');
    }

    function netHTML(n){
      var fixed = n === 'GND' || n === 'V+';
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
        o.sort(function(a, b){ return Math.abs(b.I) - Math.abs(a.I); });
        return o;
      };
      var dvdt = function(){ return AM.h() && !fixed ? (V(n) - AM.vprev(n)) / AM.h() : 0; };
      rows.push(row(vn(n), L(function(){ return fixed ? fV(V(n)) + '（固定）' : fV(V(n)); })),
        row('上一步', L(function(){ return fixed ? '—' : fV(AM.vprev(n)); })),
        row('dV/dt', L(function(){ return fixed ? '—' : si(dvdt(), 'V/s'); })));
      var list = touching();
      var kcl = '<table class="insp-t kcl"><tr><th>元件</th><th class="num">流出這個節點</th></tr>' + list.map(function(x, i){
        var pi = partInfo(x.name), other = x.b.nodes.filter(function(y){ return y !== n; }).join('、');
        return '<tr><td>' + esc(pi[0]) + ' <span class="muted">→ ' + esc(other) + '</span></td><td class="num">' +
          L(function(){ var y = touching().filter(function(z){ return z.name === x.name; })[0]; return y ? fI(y.I) : '—'; }) + '</td></tr>';
      }).join('') +
        (fixed ? '' : '<tr><td>雜散電容 ' + si(K.CPAR, 'F') + ' × dV/dt</td><td class="num">' + L(function(){ return fI(K.CPAR * dvdt()); }) + '</td></tr>') +
        '<tr class="sum"><td>' + (fixed ? '電池送進這個節點' : 'Σ（應為 0）') + '</td><td class="num">' + L(function(){
          var s = touching().reduce(function(a, x){ return a + x.I; }, 0) + (fixed ? 0 : K.CPAR * dvdt() + K.GMIN * V(n));
          return fI(s);
        }) + '</td></tr></table>';
      if(fixed) eqs.push(n === 'V+' ? '電池正極固定在 V+ = ' + AM.st.vplus + ' V，不是未知數；引擎用 IDX = −2 代表它' : 'GND 固定 0 V（IDX = −1）：所有電壓都對它量');
      else eqs.push('KCL：Σ<sub>k</sub> I<sub>k</sub>(V) + C<sub>par</sub>·dV/dt + g<sub>min</sub>·' + vn(n) + ' = 0（每個元件的電流見下表）',
        'Newton–Raphson：J·ΔV = −F，ΔV 每步最多 0.1 V；|ΔV| < 0.1 µV 或每個節點 |F| < 10 pA 就收斂',
        '上一步：' + L(function(){ return 'Newton ' + AM.stat.it + ' 次迭代' + (AM.stat.sub ? '（切成 10 個子步）' : '') + '，Δt = ' + si(AM.h(), 's'); }),
        'g<sub>min</sub> = ' + si(K.GMIN, 'S') + '、C<sub>par</sub> = ' + si(K.CPAR, 'F') + '（×10 探棒與配線）接在每個節點到 GND');
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
      var t = target, title, sub;
      if(t.part){ var pi = partInfo(t.part); title = pi[0]; sub = (pi[1] ? pi[1] + '・' : '') + '元件 ' + t.part; }
      else { title = 'Net ' + t.node; sub = '節點（同一條導線上的電壓都一樣）'; }
      box.innerHTML = '<div class="insp-h"><div><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></div>' +
        '<button type="button" class="insp-x" aria-label="關閉">✕</button></div>' +
        '<div class="insp-b">' + (t.part ? partHTML(t.part) : netHTML(t.node)) +
        '<p class="insp-f">數字每 0.1 秒更新，和示波器同一個模擬。離線檢查用的 Python 版是 <a href="../hw2-debug/sim/sim.py">hw2-debug/sim/sim.py</a>（<code>bjt()</code>、<code>diode()</code>、<code>Circuit.solve()</code>、<code>transient()</code>），方程式相同。</p></div>';
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
    function drag(h){
      h.addEventListener('pointerdown', function(e){
        if(e.target.closest('button') || window.innerWidth <= 600) return;
        var r = box.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
        h.setPointerCapture(e.pointerId);
        var mv = function(ev){ box.style.left = Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - dx)) + 'px'; box.style.top = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy)) + 'px'; };
        var up = function(){ h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); };
        h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
      });
    }
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && target) close(); });
    return {open:open, close:close, update:update, rerender:function(){ if(target) render(); },
      target:function(){ return target; }, onClose:function(f){ onClose = f; }};
  };
})();
