/* Shared mermaid handling for the long guide pages (UAV, Neuron Circuits).
   - Renders diagrams one at a time with unique ids. mermaid.run ids diagrams
     by Date.now(), so parallel calls collide and diagrams bleed into each other.
   - Renders only inside open <details class="sec">, since hidden text can't be measured.
   - Tall diagrams start collapsed; each diagram can be expanded on its own
     or opened full screen with zoom and drag-to-pan. */
(function(){
  var CLIP = 640;           /* diagrams taller than this start collapsed */
  var MIN = 0.1, MAX = 4;   /* zoom range in the viewer */

  var css = [
    '.flow-wrap{position:relative;margin-top:14px}',
    '.flow-wrap .flow{margin-top:0}',
    '.flow-bar{display:flex;justify-content:flex-end;gap:8px;margin-bottom:8px}',
    '.flow.clip{max-height:' + CLIP + 'px;overflow-y:hidden;',
    '  -webkit-mask-image:linear-gradient(#000 70%,transparent);mask-image:linear-gradient(#000 70%,transparent)}',
    '.flow-more{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);box-shadow:0 2px 8px rgba(0,0,0,.15)}',
    '.flow pre.mermaid svg{cursor:zoom-in}',
    '.dv{width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:var(--paper);color:var(--ink)}',
    '.dv[open]{display:flex;flex-direction:column}',
    '.dv::backdrop{background:rgba(0,0,0,.5)}',
    '.dv-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px;',
    '  padding:calc(env(safe-area-inset-top,0px) + 10px) 16px 10px;background:var(--surface);border-bottom:1.5px solid var(--ink)}',
    '.dv-title{font-weight:700;font-size:15px;line-height:1.4}',
    '.dv-tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
    '.dv-pct{min-width:4.2em;text-align:center;font-size:13.5px;font-variant-numeric:tabular-nums;color:var(--muted)}',
    '.dv-stage{flex:1;display:flex;overflow:auto;padding:24px;cursor:grab;touch-action:pan-x pan-y;background:',
    '  linear-gradient(var(--grid) 1px,transparent 1px) 0 0/22px 22px,',
    '  linear-gradient(90deg,var(--grid) 1px,transparent 1px) 0 0/22px 22px,var(--surface)}',
    '.dv-stage.drag{cursor:grabbing}',
    '.dv-stage svg{display:block;margin:auto;flex:none;max-width:none!important}'
  ].join('\n');
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  if(!window.mermaid){ console.error('mermaid failed to load'); return; }
  var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  try{
    mermaid.initialize({startOnLoad:false, theme: dark ? 'dark' : 'neutral', securityLevel:'loose',
      flowchart:{htmlLabels:true, curve:'basis'},
      themeVariables:{fontFamily:'"Noto Sans TC", system-ui, sans-serif', fontSize:'14px'}});
  }catch(e){ console.error(e); return; }

  /* ---- per-diagram controls ---- */
  function titleFor(wrap){
    for(var el = wrap.previousElementSibling; el; el = el.previousElementSibling){
      if(/^H[2-4]$/.test(el.tagName)) return el.textContent.trim();
    }
    return '圖表';
  }

  function setClip(wrap, on){
    wrap.querySelector('.flow').classList.toggle('clip', on);
    wrap.querySelector('.flow-toggle').textContent = on ? '展開全圖 ▾' : '收合 ▴';
    wrap.querySelector('.flow-more').hidden = !on;
    if(on && wrap.getBoundingClientRect().top < 0) wrap.scrollIntoView({block:'start'});
  }

  function setup(flow){
    var wrap = document.createElement('div'); wrap.className = 'flow-wrap';
    flow.parentNode.insertBefore(wrap, flow);
    var bar = document.createElement('div'); bar.className = 'flow-bar';
    bar.innerHTML = '<button type="button" class="btn flow-toggle" hidden></button>' +
                    '<button type="button" class="btn flow-full">全螢幕 ⤢</button>';
    var more = document.createElement('button');
    more.type = 'button'; more.className = 'btn flow-more'; more.textContent = '展開全圖 ▾'; more.hidden = true;
    wrap.appendChild(bar); wrap.appendChild(flow); wrap.appendChild(more);

    var pre = flow.querySelector('pre.mermaid');
    bar.querySelector('.flow-toggle').addEventListener('click', function(){ setClip(wrap, !flow.classList.contains('clip')); });
    more.addEventListener('click', function(){ setClip(wrap, false); });
    bar.querySelector('.flow-full').addEventListener('click', function(){ openViewer(pre, titleFor(wrap)); });
    pre.addEventListener('click', function(e){ if(e.target.closest('svg')) openViewer(pre, titleFor(wrap)); });
  }

  function afterRender(pre){
    var wrap = pre.closest('.flow-wrap');
    if(!wrap) return;
    var tall = pre.getBoundingClientRect().height > CLIP + 80;
    wrap.querySelector('.flow-toggle').hidden = !tall;
    if(tall) setClip(wrap, true);
  }

  /* ---- rendering ---- */
  var seq = 0, queue = Promise.resolve();
  function renderIn(sec){
    if(!sec.open) return;
    sec.querySelectorAll('pre.mermaid:not([data-queued])').forEach(function(pre){
      pre.setAttribute('data-queued', '1');
      var id = 'mmd-' + (++seq);
      var ta = document.createElement('textarea'); ta.innerHTML = pre.innerHTML;
      var src = ta.value.trim();
      queue = queue.then(function(){ return mermaid.render(id, src); })
        .then(function(r){
          pre.innerHTML = r.svg;
          if(r.bindFunctions) r.bindFunctions(pre);
          pre.setAttribute('data-processed', 'true');
          afterRender(pre);
        })
        .catch(function(e){ console.error(e); });
    });
  }

  /* ---- full-screen viewer ---- */
  var dlg = document.createElement('dialog');
  dlg.className = 'dv';
  dlg.setAttribute('aria-label', '圖表檢視');
  dlg.innerHTML =
    '<div class="dv-head"><span class="dv-title"></span><div class="dv-tools">' +
    '<button type="button" class="btn" data-z="out" aria-label="縮小">−</button>' +
    '<span class="dv-pct"></span>' +
    '<button type="button" class="btn" data-z="in" aria-label="放大">+</button>' +
    '<button type="button" class="btn" data-z="fit">符合視窗</button>' +
    '<button type="button" class="btn" data-z="one">100%</button>' +
    '<button type="button" class="btn" data-z="close" aria-label="關閉">✕ 關閉</button>' +
    '</div></div><div class="dv-stage"></div>';
  document.body.appendChild(dlg);
  var stage = dlg.querySelector('.dv-stage');
  var pct = dlg.querySelector('.dv-pct');
  var cur = null;  /* {svg, pre, w, h, style, width, height, scale} */

  function attr(el, name, val){ if(val === null) el.removeAttribute(name); else el.setAttribute(name, val); }

  function setScale(s, cx, cy){
    if(!cur) return;
    s = Math.min(MAX, Math.max(MIN, s));
    /* keep the point under (cx, cy) — default the stage centre — in place */
    var r = stage.getBoundingClientRect();
    if(cx == null){ cx = r.width / 2; cy = r.height / 2; }
    var fx = (stage.scrollLeft + cx) / (cur.w * cur.scale);
    var fy = (stage.scrollTop + cy) / (cur.h * cur.scale);
    cur.scale = s;
    cur.svg.style.width = (cur.w * s) + 'px';
    cur.svg.style.height = (cur.h * s) + 'px';
    stage.scrollLeft = fx * cur.w * s - cx;
    stage.scrollTop = fy * cur.h * s - cy;
    pct.textContent = Math.round(s * 100) + '%';
  }

  /* whole: fit the whole diagram; otherwise fit its width (capped at 100%)
     so tall flowcharts stay readable and scroll vertically */
  function fit(whole){
    var cs = getComputedStyle(stage);
    var pw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var ph = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    setScale(whole ? Math.min(pw / cur.w, ph / cur.h) : Math.min(1, pw / cur.w));
    if(!whole){ stage.scrollTop = 0; stage.scrollLeft = 0; }
  }

  function openViewer(pre, title){
    var svg = pre.querySelector('svg');
    if(!svg || dlg.open) return;
    var vb = svg.viewBox && svg.viewBox.baseVal;
    var w = vb && vb.width, h = vb && vb.height;
    if(!w || !h){ var b = svg.getBoundingClientRect(); w = b.width; h = b.height; }
    cur = {svg:svg, pre:pre, w:w, h:h, scale:1,
           style:svg.getAttribute('style'), width:svg.getAttribute('width'), height:svg.getAttribute('height')};
    dlg.querySelector('.dv-title').textContent = title;
    svg.removeAttribute('width'); svg.removeAttribute('height');
    stage.appendChild(svg);   /* move, not clone: keeps ids and arrow markers unique */
    dlg.showModal();
    fit();
  }

  dlg.addEventListener('close', function(){
    if(!cur) return;
    attr(cur.svg, 'style', cur.style); attr(cur.svg, 'width', cur.width); attr(cur.svg, 'height', cur.height);
    cur.pre.appendChild(cur.svg);
    cur = null;
  });

  dlg.querySelector('.dv-tools').addEventListener('click', function(e){
    var b = e.target.closest('[data-z]');
    if(!b || !cur) return;
    var z = b.getAttribute('data-z');
    if(z === 'close') dlg.close();
    else if(z === 'fit') fit(true);
    else if(z === 'one') setScale(1);
    else setScale(cur.scale * (z === 'in' ? 1.25 : 0.8));
  });

  /* ctrl/cmd + wheel (and trackpad pinch) zooms around the pointer */
  stage.addEventListener('wheel', function(e){
    if(!cur || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    var r = stage.getBoundingClientRect();
    setScale(cur.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
  }, {passive:false});

  /* drag to pan with a mouse; touch keeps native scrolling */
  var drag = null;
  stage.addEventListener('pointerdown', function(e){
    if(e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = {x:e.clientX, y:e.clientY, l:stage.scrollLeft, t:stage.scrollTop};
    stage.classList.add('drag'); stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', function(e){
    if(!drag) return;
    stage.scrollLeft = drag.l - (e.clientX - drag.x);
    stage.scrollTop = drag.t - (e.clientY - drag.y);
  });
  function endDrag(){ drag = null; stage.classList.remove('drag'); }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  /* ---- wire up ---- */
  document.querySelectorAll('.flow').forEach(setup);
  document.querySelectorAll('details.sec').forEach(function(s){
    s.addEventListener('toggle', function(){ renderIn(s); });
    renderIn(s);
  });
})();
