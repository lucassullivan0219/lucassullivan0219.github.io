// Wires transports → decoder → pipeline → UI. Each layer only talks through its interface:
//   transport: 'data' (Uint8Array) and 'state' events
//   decoder:   push(bytes) → samples, stats, reset()/resync()
//   pipeline:  push(samples) → listeners get indexed samples with µV values

import { NEEG_AA_V1 } from './decoders/formats.js';
import { createFramedDecoder } from './decoders/framed.js';
import { Pipeline } from './pipeline/pipeline.js';
import { BleTransport } from './transports/ble.js';
import { SimTransport } from './transports/sim.js';
import { createPager } from './ui/pager.js';
import { createDeviceList } from './ui/devices.js';

const MAX_LINES = 200;
const STALL_MS = 2000;
const VERIFY_PACKETS = 50;

const $ = id => document.getElementById(id);

const format = NEEG_AA_V1;
const decoder = createFramedDecoder(format);
const pipeline = new Pipeline(format);
const ble = new BleTransport();
const sim = new SimTransport(format);

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

// ---------- per-channel stats ----------
$('fsNote').textContent = format.fs;
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
  pipeline.push(decoder.push(bytes), lastDataAt);

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
    if (reconnect) {
      decoder.resync(); // keep counters and the sample index running
    } else {
      decoder.reset();
      pipeline.reset();
      notifs = 0; lastChunk = 0; linkVerified = false;
    }
    lastDataAt = performance.now();
    $('device').textContent = transport === sim ? 'Simulator' : devices.titleOf(ble.device.id);
    setStatus('connected', transport === sim ? 'Simulating' : 'Connected');
  } else if (transport === ble && state === 'connecting') {
    setStatus('connecting', reconnect ? 'Reconnecting…' : 'Connecting…');
  } else if (transport === ble && state === 'reconnecting') {
    connected = false;
    setStatus('connecting', `Reconnecting (${reason})…`);
  } else if (state === 'disconnected' || state === 'error') {
    if (transport !== active && active) return; // e.g. BLE closing after the simulator took over
    connected = false;
    active = null;
    setStatus(state === 'error' ? 'error' : 'idle', reason || 'Disconnected');
  }
  $('simulate').textContent = sim.connected ? 'Stop simulation' : 'Simulate';
}

for (const t of [ble, sim]) {
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
  $('chunk').textContent = lastChunk ? `${lastChunk} B` : '–';
  $('rate').textContent = pipeline.rate ?? '–';
  $('liveRate').textContent = connected && pipeline.rate != null ? `${pipeline.rate} Hz` : '';
  const last = pipeline.last;
  if (last) {
    $('battery').textContent = last.battery ?? '–';
    channelCells.forEach((cell, i) => { cell.textContent = `${last.uv[i].toFixed(1)} µV`; });
  }
  if (connected && active === ble) {
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
    `NEEG-2 log  ${new Date().toISOString()}`,
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
  `ready (${Object.entries(caps).map(([k, v]) => `${k}=${v ? 'yes' : 'no'}`).join(', ')})`);
if (navigator.bluetooth?.getAvailability)
  navigator.bluetooth.getAvailability().then(a => { if (!a) log('Bluetooth adapter is off or unavailable'); });
devices.render();
ble.loadRemembered();
