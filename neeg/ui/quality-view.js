// Quality cards, one per channel. Status uses colour + icon + label, never colour alone.

import { evaluateChannel, QUALITY_WINDOW_S } from '../pipeline/quality.js';

const LEVELS = {
  good: { icon: '✓', label: 'Good' },
  warn: { icon: '!', label: 'Check' },
  bad:  { icon: '✕', label: 'Poor' },
  na:   { icon: '–', label: 'No data' },
};

export function createQualityView(container, { store, names, fs, adcMax, getLineFreq }) {
  const cards = names.map(name => {
    const card = document.createElement('div');
    card.className = 'qcard';
    card.innerHTML = `
      <div class="qhead"><b class="qname"></b><span class="qbadge"><span class="qicon"></span><span class="qlabel"></span></span></div>
      <div class="qreason"></div>
      <dl class="stats qstats">
        <div><dt>Railed</dt><dd data-k="railed">–</dd></div>
        <div><dt>RMS</dt><dd data-k="rms">–</dd></div>
        <div><dt class="qmains">Mains</dt><dd data-k="line">–</dd></div>
        <div><dt>Drift</dt><dd data-k="drift">–</dd></div>
      </dl>`;
    card.querySelector('.qname').textContent = name;
    container.append(card);
    return card;
  });

  function update() {
    const n = Math.round(QUALITY_WINDOW_S * fs);
    const lf = getLineFreq();
    cards.forEach((card, ch) => {
      const q = evaluateChannel(store.latest('counts', ch, n), store.latest('uv', ch, n), fs, lf, adcMax);
      const lv = LEVELS[q.level];
      card.dataset.level = q.level;
      card.querySelector('.qicon').textContent = lv.icon;
      card.querySelector('.qlabel').textContent = lv.label;
      card.querySelector('.qreason').textContent = q.reason;
      card.querySelector('.qmains').textContent = `${lf} Hz share`;
      const set = (k, v) => { card.querySelector(`[data-k=${k}]`).textContent = q.level === 'na' ? '–' : v; };
      set('railed', `${q.railedPct.toFixed(1)} %`);
      set('rms', `${q.rmsUv.toFixed(1)} µV`);
      set('line', `${(q.lineRatio * 100).toFixed(1)} %`);
      set('drift', `${q.driftUvPerS.toFixed(1)} µV/s`);
    });
  }

  return { update };
}
