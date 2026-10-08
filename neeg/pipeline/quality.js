// Signal quality inferred from the recent waveform; a port of evaluate_channel() in
// NEEG-2/gui/neeg_monitor.py with the same thresholds. These are estimates from the
// signal itself, NOT an electrode impedance measurement.

import { computePsd, bandPower } from './spectrum.js';

export const QUALITY_WINDOW_S = 2;

const RAILED_THRESHOLD_RATIO = 0.90;
const RAILED_PCT_WARN = 1, RAILED_PCT_BAD = 5;
const RMS_FLAT_UV = 1, RMS_HIGH_UV = 200;
const LINE_RATIO_WARN = 0.15, LINE_RATIO_BAD = 0.30;
const DRIFT_WARN_UV_PER_S = 50;

export function evaluateChannel(counts, uv, fs, lineFreq, adcMax) {
  const q = { railedPct: 0, rmsUv: 0, lineRatio: 0, driftUvPerS: 0, level: 'na', reason: 'Not enough data' };
  const n = uv.length;
  if (n < Math.round(0.5 * fs)) return q;

  // 1. Railed: share of samples near full scale (the most reliable indicator).
  const limit = RAILED_THRESHOLD_RATIO * adcMax;
  let railed = 0;
  for (const c of counts) if (Math.abs(c) > limit) railed++;
  q.railedPct = railed / counts.length * 100;

  // 2. RMS of the AC part.
  let mean = 0;
  for (const v of uv) mean += v;
  mean /= n;
  let ss = 0;
  const ac = new Float64Array(n);
  for (let i = 0; i < n; i++) { ac[i] = uv[i] - mean; ss += ac[i] * ac[i]; }
  q.rmsUv = Math.sqrt(ss / n);

  // 3. Mains share: power within ±2 Hz of the mains frequency over 1 Hz … mains + 5 Hz.
  const spec = computePsd(ac, fs);
  if (spec) {
    const pLine = bandPower(spec, lineFreq - 2, lineFreq + 2);
    const pTotal = bandPower(spec, 1, lineFreq + 5);
    q.lineRatio = Math.min(pLine / (pTotal + 1e-20), 1);
  }

  // 4. Drift: slope of a straight-line fit over time.
  let st = 0, sx = 0, stt = 0, stx = 0;
  for (let i = 0; i < n; i++) { const t = i / fs; st += t; sx += uv[i]; stt += t * t; stx += t * uv[i]; }
  q.driftUvPerS = Math.abs((n * stx - st * sx) / (n * stt - st * st));

  // Overall level: the first matching (most severe) problem wins.
  const mains = `${lineFreq} Hz`;
  if (q.railedPct >= RAILED_PCT_BAD) [q.level, q.reason] = ['bad', 'Railed: electrode loose or off'];
  else if (q.rmsUv < RMS_FLAT_UV) [q.level, q.reason] = ['bad', 'Flat: signal almost constant, check for a broken lead or short'];
  else if (q.lineRatio >= LINE_RATIO_BAD) [q.level, q.reason] = ['bad', `Strong ${mains} mains noise`];
  else if (q.railedPct >= RAILED_PCT_WARN) [q.level, q.reason] = ['warn', 'Occasional saturation, check the electrode'];
  else if (q.rmsUv > RMS_HIGH_UV) [q.level, q.reason] = ['warn', 'Large amplitude: muscle or movement artefact'];
  else if (q.lineRatio >= LINE_RATIO_WARN) [q.level, q.reason] = ['warn', `${mains} noise is high; move away from chargers and lights`];
  else if (q.driftUvPerS > DRIFT_WARN_UV_PER_S) [q.level, q.reason] = ['warn', 'Baseline drifting: the electrode may be moving'];
  else [q.level, q.reason] = ['good', 'Stable signal'];
  return q;
}
