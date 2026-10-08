// Wires transports → decoder → pipeline → UI. Each layer only talks through its interface:
//   transport: 'data' (Uint8Array) and 'state' events
//   decoder:   push(bytes) → samples, stats, reset()/resync()
//   pipeline:  push(samples) → listeners get indexed samples with µV values

import { NEEG_AA_V1 } from './decoders/formats.js';
import { createFramedDecoder } from './decoders/framed.js';
import { Pipeline } from './pipeline/pipeline.js';
import { SignalStore } from './pipeline/store.js';
import { DISPLAY_MODES } from './pipeline/filters.js';
import { createWaveform } from './ui/waveform.js';
import { createSpectrumView } from './ui/spectrum-view.js';
import { createQualityView } from './ui/quality-view.js';
import { Recorder, recordingBaseName, createWakeLock } from './pipeline/recorder.js';
import { BleTransport, BLE_BUILD } from './transports/ble.js';
import { SimTransport } from './transports/sim.js';
import { SerialTransport, BAUD_CHOICES, DONGLE_BAUD } from './transports/serial.js';
import { createDongleCsvDecoder } from './decoders/dongle-csv.js';
import { createPager } from './ui/pager.js';
import { createDeviceList } from './ui/devices.js';

const MAX_LINES = 200;
const STALL_MS = 2000;
const VERIFY_PACKETS = 50;
const BUILD = '2026-10-08.2'; // bump on every change so a pasted log shows which version ran

const $ = id => document.getElementById(id);
function loadPref(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function savePref(key, value) { try { localStorage.setItem(key, value); } catch {} }

const format = NEEG_AA_V1;
// The decoder follows the transport: BLE and the simulator carry binary frames, the USB
// dongle carries CSV lines. Both produce the same sample shape for the pipeline.
const framedDecoder = createFramedDecoder(format);
const dongleDecoder = createDongleCsvDecoder(format, { onMessage: m => log(`dongle ${m}`) });
let decoder = framedDecoder;
const pipeline = new Pipeline(format);
const savedMode = loadPref('neeg.mode', 'bp');
const store = new SignalStore({ channels: pipeline.channels, fs: format.fs, mode: savedMode in DISPLAY_MODES ? savedMode : 'bp' });
pipeline.on(batch => store.push(batch));
const ble = new BleTransport();
const sim = new SimTransport(format);
const serial = new SerialTransport();
const decoderFor = t => t === serial ? dongleDecoder : framedDecoder;
const transportLabel = t => t === sim ? 'Simulator' : t === serial ? 'ESP32 dongle (USB)' : devices.titleOf(ble.device.id);

let active = null;           // transport currently feeding the decoder
let connected = false;
let notifs = 0, lastChunk = 0, lastDataAt = 0;
let linkVerified = false;
const t0 = performance.now();

// ---------- pages ----------
const pager = createPager({
  pager: $('pager'), track: $('track'), tabbar: document.querySelector('.tabbar'),
  tabs: [...document.querySelectorAll('.tabs [role=tab]')], storageKey: 'neeg.page',
});

// ---------- logging ----------
const lines = { events: [], hex: [], samples: [] };
const dirty = new Set();
const stamp = () => ((performance.now() - t0) / 1000).toFixed(3).padStart(8);
function push(kind, text) {
  const arr = lines[kind];
  arr.push(text);
  if (arr.length > MAX_LINES) arr.splice(0, arr.length - MAX_LINES);
  dirty.add(kind);
}
function log(msg) { push('events', `${stamp()}s  ${msg}`); console.log('[neeg]', msg); }
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
function setStatus(s, text) { $('status').dataset.s = s; $('status').textContent = text; }

// ---------- signal view ----------
const PAGE_SIGNAL = 1;
document.documentElement.style.setProperty('--nch', pipeline.channels);
const wave = createWaveform($('wave'), { store, names: pipeline.channelNames, fs: format.fs });
for (const [value, label] of Object.entries(DISPLAY_MODES)) $('mode').add(new Option(label, value));
$('mode').value = store.mode;
$('mode').onchange = () => { store.setMode($('mode').value); savePref('neeg.mode', $('mode').value); wave.draw(); };
$('scale').value = loadPref('neeg.scale', 'auto');
const applyScale = () => wave.setSpan($('scale').value === 'auto' ? null : +$('scale').value);
applyScale();
$('scale').onchange = () => { applyScale(); savePref('neeg.scale', $('scale').value); wave.draw(); };
const PAGE_QUALITY = 2;
$('mains').value = loadPref('neeg.mains', '60');
const lineFreq = () => +$('mains').value;
$('mains').onchange = () => { savePref('neeg.mains', $('mains').value); spectrum.update(); quality.update(); };
const spectrum = createSpectrumView($('spectrum'), { store, names: pipeline.channelNames, fs: format.fs, getLineFreq: lineFreq });
const quality = createQualityView($('quality'), {
  store, names: pipeline.channelNames, fs: format.fs, adcMax: format.scale.adcMax, getLineFreq: lineFreq,
});
pipeline.channelNames.forEach((name, i) => {
  const item = document.createElement('span');
  item.innerHTML = `<i style="background:var(--series-${i + 1})"></i>`;
  item.append(name);
  $('legend').append(item);
});

// Redraw only what is on screen: waveform ~10 fps, spectrum 2.5 fps, quality 2 fps
// (refresh rates from neeg_monitor.py).
const visible = page => pager.current === page && !document.hidden;
setInterval(() => { if (visible(PAGE_SIGNAL)) wave.draw(); }, 100);
setInterval(() => { if (visible(PAGE_SIGNAL)) spectrum.update(); }, 400);
setInterval(() => { if (visible(PAGE_QUALITY)) quality.update(); }, 500);
pager.onChange(i => requestAnimationFrame(() => {
  if (i === PAGE_SIGNAL) { wave.draw(); spectrum.update(); }
  if (i === PAGE_QUALITY) quality.update();
}));

// ---------- recording ----------
const recorder = new Recorder({ format, channelNames: pipeline.channelNames });
pipeline.on(batch => recorder.push(batch));
const wakeLock = createWakeLock(log);
let lastRecording = null; // { csv, meta, name, saved: Set }
$('wakeNote').textContent = wakeLock.supported
  ? 'The screen is kept on while recording. Keep this page in the foreground: phones may pause Bluetooth for background pages.'
  : 'This browser cannot keep the screen on (no Screen Wake Lock). Keep the screen on and this page in the foreground while recording.';

const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function startRecording() {
  if (!connected || recorder.recording) return;
  recorder.start({
    transport: active.kind,
    id: active === ble ? ble.device?.id : null,
    label: transportLabel(active),
  });
  wakeLock.on();
  log('recording started');
  updateRecUi();
}

function stopRecording(reason = '') {
  const result = recorder.stop();
  wakeLock.off();
  if (!result) return;
  lastRecording = { ...result, name: recordingBaseName(new Date(recorder.startEpoch)), saved: new Set() };
  log(`recording stopped${reason}: ${recorder.sampleCount} samples, ${recorder.durationS.toFixed(1)} s`);
  updateRecUi();
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function updateRecUi() {
  const on = recorder.recording;
  $('rec').classList.toggle('on', on);
  $('rec').disabled = !on && !connected;
  $('rec').ariaLabel = $('rec').title = on ? 'Stop recording' : 'Start recording';
  $('recTime').textContent = on ? mmss(recorder.durationS) : '';
  if (on) {
    $('recInfo').textContent = `Recording · ${mmss(recorder.durationS)} · ${recorder.sampleCount.toLocaleString()} samples` +
      (wakeLock.supported ? (wakeLock.active ? ' · screen kept on' : ' · screen lock not held') : '');
  } else if (lastRecording) {
    const m = lastRecording.meta;
    $('recInfo').textContent = `${lastRecording.name} · ${mmss(m.durationS)} · ${m.samples.toLocaleString()} samples ` +
      `(expected ${m.expectedSamples.toLocaleString()})`;
  }
  $('recDownloads').hidden = on || !lastRecording;
}

$('rec').onclick = () => recorder.recording ? stopRecording() : startRecording();
$('dlCsv').onclick = () => { download(lastRecording.csv, `${lastRecording.name}.csv`); lastRecording.saved.add('csv'); };
$('dlJson').onclick = () => {
  download(new Blob([JSON.stringify(lastRecording.meta, null, 2)], { type: 'application/json' }), `${lastRecording.name}.json`);
  lastRecording.saved.add('json');
};
window.addEventListener('beforeunload', e => {
  if (recorder.recording || (lastRecording && !lastRecording.saved.has('csv'))) e.preventDefault();
});

// ---------- per-channel stats ----------
$('fsNote').textContent = format.fs;
document.querySelectorAll('.fs').forEach(el => { el.textContent = format.fs; });
const channelCells = pipeline.channelNames.map(name => {
  const div = document.createElement('div');
  div.innerHTML = '<dt></dt><dd>–</dd>';
  div.firstChild.textContent = name;
  $('stats').append(div);
  return div.lastChild;
});

// ---------- support check ----------
const caps = ble.caps;
const problems = [];
if (!window.isSecureContext) problems.push('This page is not served over HTTPS, so Web Bluetooth is blocked.');
else if (!navigator.bluetooth && caps.brave) problems.push('Brave turns Web Bluetooth off by default. Open brave://flags, search "Bluetooth", enable the Web Bluetooth API and relaunch, or use Chrome.');
else if (!navigator.bluetooth) problems.push('This browser has no Web Bluetooth. Use Chrome or Edge on Android, Windows, macOS or ChromeOS. iOS browsers, Firefox and Safari do not support it.');
if (problems.length) {
  $('support').textContent = problems.join(' ') + ' Simulate still works.';
  $('support').hidden = false;
  $('add').disabled = true;
}
$('scan').hidden = !caps.scan;
const yesNo = v => `<b>${v ? 'yes' : 'no'}</b>`;
$('caps').innerHTML = `Web Bluetooth ${yesNo(caps.bluetooth)} · Remembered devices ${yesNo(caps.remember)} · ` +
  `Signal strength ${yesNo(caps.watch)} · In-page scan ${yesNo(caps.scan)}` + (caps.brave ? ' · Brave' : '');

// ---------- devices ----------
const devices = createDeviceList({
  list: $('devices'), ble, log,
  onConnect: async entry => { await stopSim(); ble.connect(entry); },
  onDisconnect: () => ble.disconnect(),
});

// ---------- data path ----------
function onBytes(transport, bytes) {
  if (transport !== active) return;
  notifs++;
  lastChunk = bytes.length;
  lastDataAt = performance.now();
  push('hex', `${stamp()}s  [${String(bytes.length).padStart(3)} B]  ${hex(bytes)}`);
  pipeline.push(decoderFor(transport).push(bytes), lastDataAt);

  // Enough well-formed frames means this really is a NEEG-2 headset: remember that.
  const st = decoder.stats;
  if (!linkVerified && transport === ble && st.packets >= VERIFY_PACKETS && st.rejected <= st.packets / 10) {
    linkVerified = true;
    if (!devices.isVerified(ble.device.id)) {
      devices.markVerified(ble.device.id);
      log(`verified as NEEG-2 headset (${st.packets} valid frames); use ✎ to name it`);
    }
  }
}

pipeline.on(batch => {
  for (const s of batch) {
    push('samples', `#${String(s.index).padStart(6)}  t=${s.t.toFixed(3)}s  batt=${String(s.battery ?? '').padStart(3)}  ` +
      s.counts.map((c, i) => `${pipeline.channelNames[i]}=${String(c).padStart(9)} (${s.uv[i].toFixed(2).padStart(9)} µV)`).join('  '));
  }
});

function onState(transport, { state, reason, reconnect }) {
  if (state === 'connected') {
    if (active && active !== transport) active.disconnect();
    active = transport;
    connected = true;
    decoder = decoderFor(transport);
    if (reconnect) {
      decoder.resync(); // keep counters and the sample index running
    } else {
      // A new connection restarts the sample index, so it can't continue an open recording.
      if (recorder.recording) stopRecording(' (new connection)');
      decoder.reset();
      pipeline.reset();
      store.reset();
      notifs = 0; lastChunk = 0; linkVerified = false;
    }
    lastDataAt = performance.now();
    $('device').textContent = transportLabel(transport);
    setStatus('connected', transport === sim ? 'Simulating' : 'Connected');
  } else if (transport !== sim && state === 'connecting') {
    setStatus('connecting', reconnect ? 'Reconnecting…' : 'Connecting…');
  } else if (transport === ble && state === 'reconnecting') {
    connected = false;
    setStatus('connecting', `Reconnecting (${reason})…`);
  } else if (state === 'disconnected' || state === 'error') {
    // Ignore e.g. BLE closing after the simulator took over.
    if (transport === active || !active) {
      connected = false;
      active = null;
      setStatus(state === 'error' ? 'error' : 'idle', reason || 'Disconnected');
    }
  }
  $('simulate').textContent = sim.connected ? 'Stop simulation' : 'Simulate';
  $('dongle').textContent = serial.connected ? 'Disconnect dongle' : 'Connect dongle';
  $('fillerCell').hidden = decoder !== dongleDecoder;
  updateRecUi();
}

for (const t of [ble, sim, serial]) {
  t.addEventListener('data', e => onBytes(t, e.detail));
  t.addEventListener('state', e => onState(t, e.detail));
  t.addEventListener('log', e => log(e.detail));
}

async function stopSim() { if (sim.connected) await sim.disconnect(); }

// ---------- rendering (~5 fps) ----------
function render() {
  const st = decoder.stats;
  $('notifs').textContent = notifs;
  $('bytes').textContent = st.bytes;
  $('packets').textContent = st.packets;
  $('rejected').textContent = st.rejected;
  $('skipped').textContent = st.skipped;
  $('fillers').textContent = st.fillerDropped ?? 0;
  $('chunk').textContent = lastChunk ? `${lastChunk} B` : '–';
  $('rate').textContent = pipeline.rate ?? '–';
  $('liveRate').textContent = connected && pipeline.rate != null ? `${pipeline.rate} Hz` : '';
  const last = pipeline.last;
  if (last) {
    $('battery').textContent = last.battery ?? '–';
    channelCells.forEach((cell, i) => { cell.textContent = `${last.uv[i].toFixed(1)} µV`; });
  }
  if (recorder.recording) updateRecUi();
  if (connected && active !== sim) {
    const stalled = performance.now() - lastDataAt > STALL_MS;
    setStatus(stalled ? 'stalled' : 'connected', stalled ? 'No data > 2 s' : 'Connected');
  }
  if (!$('pause').checked) {
    for (const kind of dirty) {
      const el = $(kind);
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
      el.textContent = lines[kind].join('\n');
      if (atBottom) el.scrollTop = el.scrollHeight;
    }
    dirty.clear();
  }
}
setInterval(render, 200);
setInterval(() => { if (connected) pipeline.tickRate(); }, 1000);

// ---------- buttons ----------
$('scan').onclick = () => ble.toggleScan();
$('add').onclick = async () => {
  const entry = await ble.pick({ all: $('pickAll').checked });
  if (entry) { await stopSim(); ble.connect(entry); }
};
// USB dongle (Web Serial, desktop Chrome/Edge).
if (SerialTransport.supported) {
  for (const b of BAUD_CHOICES) $('baud').add(new Option(`${b} baud`, b));
  $('baud').value = loadPref('neeg.baud', DONGLE_BAUD);
  $('baud').onchange = () => savePref('neeg.baud', $('baud').value);
  $('dongle').onclick = async () => {
    if (serial.connected) return serial.disconnect();
    await serial.connect({ baudRate: +$('baud').value });
  };
} else {
  $('dongleRow').hidden = true;
  $('dongleNote').textContent = 'USB dongle: this browser has no Web Serial (desktop Chrome or Edge only).';
}

$('simulate').onclick = async () => {
  if (sim.connected) return stopSim();
  if (ble.connected) await ble.disconnect();
  await sim.connect();
  pager.goTo(0);
};
$('clear').onclick = () => { for (const k in lines) { lines[k] = []; dirty.add(k); } render(); };
$('copy').onclick = async () => {
  const st = decoder.stats;
  const text = [
    `NEEG-2 log  ${new Date().toISOString()}  build ${BUILD} / ble ${BLE_BUILD}`,
    `UA: ${navigator.userAgent}`,
    `caps: ${JSON.stringify(caps)}  format: ${format.id}`,
    `frames=${st.packets} notifs=${notifs} bytes=${st.bytes} rejected=${st.rejected} skipped=${st.skipped} rate=${pipeline.rate}`,
    '', '== events ==', ...lines.events,
    '', '== hex (last 200) ==', ...lines.hex,
    '', '== samples (last 200) ==', ...lines.samples,
  ].join('\n');
  try { await navigator.clipboard.writeText(text); log('log copied to clipboard'); }
  catch (e) { log(`copy failed: ${e.message}`); }
};

log(problems.length ? 'Web Bluetooth unavailable' :
  `ready, build ${BUILD} / ble ${BLE_BUILD} (${Object.entries(caps).map(([k, v]) => `${k}=${v ? 'yes' : 'no'}`).join(', ')})`);
if (navigator.bluetooth?.getAvailability)
  navigator.bluetooth.getAvailability().then(a => { if (!a) log('Bluetooth adapter is off or unavailable'); });
devices.render();
ble.loadRemembered();
