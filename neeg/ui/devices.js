// Device list for the BLE transport. Devices are shown by their browser-assigned id (or a
// user label); headsets that delivered valid NEEG-2 frames are tagged and kept per browser.

const META_KEY = 'neeg.deviceMeta';

export function createDeviceList({ list, ble, onConnect, onDisconnect, log }) {
  let meta = {};
  try { meta = JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch {}

  function setMeta(id, fields) {
    meta[id] = { ...meta[id], ...fields };
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch {}
    render();
  }

  const isVerified = e => !!meta[e.device.id]?.verified;
  const titleOf = e => meta[e.device.id]?.label || e.device.id;
  const isLive = e => e.device === ble.device && (ble.connected || ble.reconnecting);

  function rename(e) {
    const label = prompt('Name this device (e.g. Headset 07). Leave empty to show its id.', meta[e.device.id]?.label || '');
    if (label === null) return;
    setMeta(e.device.id, { label: label.trim() });
    log(`labelled ${e.device.id} as "${label.trim()}"`);
  }

  function render() {
    const now = performance.now();
    const entries = [...ble.known.values()].sort((a, b) =>
      isLive(b) - isLive(a) || isVerified(b) - isVerified(a) ||
      b.ffe0 - a.ffe0 || (b.rssi ?? -999) - (a.rssi ?? -999));

    list.replaceChildren(...entries.map(e => {
      const li = document.createElement('li');
      const info = document.createElement('div');
      info.className = 'info';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = titleOf(e);
      if (isVerified(e)) name.insertAdjacentHTML('beforeend', '<span class="tag">NEEG-2 ✓</span>');
      else if (e.ffe0) name.insertAdjacentHTML('beforeend', '<span class="tag">FFE0</span>');
      const metaLine = document.createElement('div');
      metaLine.className = 'meta';
      const seen = e.seenAt ? `seen ${Math.round((now - e.seenAt) / 1000)} s ago` : e.source === 'remembered' ? 'remembered' : '';
      metaLine.textContent = [meta[e.device.id]?.label && `id ${e.device.id}`, e.rssi != null && `${e.rssi} dBm`, seen]
        .filter(Boolean).join(' · ');
      info.append(name);
      if (metaLine.textContent) info.append(metaLine);

      const edit = document.createElement('button');
      edit.className = 'edit';
      edit.textContent = '✎';
      edit.title = edit.ariaLabel = 'Rename';
      edit.onclick = () => rename(e);

      const btn = document.createElement('button');
      const live = isLive(e);
      btn.textContent = live ? 'Disconnect' : 'Connect';
      if (!live) btn.className = 'primary';
      btn.onclick = () => live ? onDisconnect(e) : onConnect(e);
      li.append(info, edit, btn);
      return li;
    }));

    if (!entries.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = ble.caps.scan
        ? 'No devices yet. Press Scan, or Add device… to use the browser picker.'
        : 'No devices yet. Press Add device… and pick the headset once.';
      list.append(li);
    }
  }

  // Refresh "seen N s ago" only when something has been seen.
  setInterval(() => { if ([...ble.known.values()].some(e => e.seenAt)) render(); }, 1000);
  ble.addEventListener('devices', render);

  return {
    render,
    titleOf: id => meta[id]?.label || id,
    markVerified(id) { setMeta(id, { verified: true }); },
    isVerified: id => !!meta[id]?.verified,
  };
}
