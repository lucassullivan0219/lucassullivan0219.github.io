// Web Bluetooth transport for BLE UART modules (JDY-23 on NEEG-2).
// Produces raw bytes only; it knows nothing about the packet format.
//
// Events (all CustomEvent):
//   'data'    detail: Uint8Array
//   'state'   detail: { state: 'connecting'|'connected'|'reconnecting'|'disconnected'|'error',
//                       reason?, reconnect? }
//   'devices' the device list changed (read .known)
//   'log'     detail: string

export const JDY_SERVICE = '0000ffe0-0000-1000-8000-00805f9b34fb';
export const JDY_CHARACTERISTIC = '0000ffe1-0000-1000-8000-00805f9b34fb';

const SCAN_MS = 20000;
const RECONNECT_TRIES = 10, RECONNECT_DELAY_MS = 2000;

export function bleCapabilities() {
  const bt = navigator.bluetooth;
  return {
    bluetooth: !!bt && window.isSecureContext,
    remember: !!bt && typeof bt.getDevices === 'function',
    watch: typeof BluetoothDevice !== 'undefined' && 'watchAdvertisements' in BluetoothDevice.prototype,
    scan: !!bt && typeof bt.requestLEScan === 'function',
    brave: !!navigator.brave,
  };
}

export class BleTransport extends EventTarget {
  kind = 'ble';
  output = 'bytes';
  // id -> { device, name, rssi, seenAt, ffe0, source: 'remembered'|'picked'|'scan' }
  known = new Map();
  device = null;
  connected = false;
  reconnecting = false;
  scanning = false;

  #service; #characteristic; #namePrefix;
  #char = null; #scan = null; #scanTimer = 0;
  #userDisconnect = false;
  #watched = new WeakSet();
  #onNotify = e => {
    const v = e.target.value;
    this.#emit('data', new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  };
  #onDisconnected = () => this.#handleDrop();

  constructor({ service = JDY_SERVICE, characteristic = JDY_CHARACTERISTIC, namePrefix = 'JDY' } = {}) {
    super();
    this.#service = service;
    this.#characteristic = characteristic;
    this.#namePrefix = namePrefix;
    this.caps = bleCapabilities();
    if (navigator.bluetooth) navigator.bluetooth.addEventListener('advertisementreceived', e => {
      if (!this.#scan) return;
      const ffe0 = (e.uuids || []).some(u => u.toLowerCase() === this.#service);
      this.#upsert(e.device, { source: 'scan', name: e.name || e.device.name, rssi: e.rssi, seenAt: performance.now(), ffe0: ffe0 || undefined });
    });
  }

  #emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  #log(msg) { this.#emit('log', msg); }
  #state(state, extra = {}) { this.#emit('state', { state, ...extra }); }

  #upsert(dev, fields) {
    const e = this.known.get(dev.id) || { device: dev, name: dev.name || '', rssi: null, seenAt: 0, ffe0: false, source: fields.source };
    e.device = dev;
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') e[k] = v;
    this.known.set(dev.id, e);
    this.#emit('devices');
    return e;
  }

  #watch(dev) {
    if (!this.caps.watch || this.#watched.has(dev)) return;
    this.#watched.add(dev);
    dev.addEventListener('advertisementreceived', e =>
      this.#upsert(dev, { rssi: e.rssi, seenAt: performance.now(), name: e.name }));
    dev.watchAdvertisements().catch(err => this.#log(`watchAdvertisements failed: ${err.message}`));
  }

  async loadRemembered() {
    if (!this.caps.remember) return;
    try {
      const devs = await navigator.bluetooth.getDevices();
      this.#log(`remembered devices: ${devs.length}`);
      for (const d of devs) { this.#upsert(d, { source: 'remembered' }); this.#watch(d); }
    } catch (e) { this.#log(`getDevices failed: ${e.message}`); }
  }

  async toggleScan() {
    if (this.#scan) return this.stopScan();
    try {
      this.#scan = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true, keepRepeatedDevices: true });
    } catch (e) {
      this.#log(`scan failed: ${e.name}: ${e.message}`);
      this.#scan = null;
      return;
    }
    this.scanning = true;
    this.#log('scanning…');
    this.#emit('devices');
    this.#scanTimer = setTimeout(() => this.stopScan(), SCAN_MS);
  }

  stopScan() {
    clearTimeout(this.#scanTimer);
    if (!this.#scan) return;
    try { this.#scan.stop(); } catch {}
    this.#scan = null;
    this.scanning = false;
    this.#log('scan stopped');
    this.#emit('devices');
  }

  // Browser picker: required once per device before a page may use it.
  // Default filter lists only JDY-style modules (FFE0 advertised, or name prefix).
  async pick({ name, all } = {}) {
    let options, desc;
    if (name) {
      options = { filters: [{ name }], optionalServices: [this.#service] };
      desc = `name "${name}"`;
    } else if (all) {
      options = { acceptAllDevices: true, optionalServices: [this.#service] };
      desc = 'all nearby devices';
    } else {
      options = { filters: [{ services: [this.#service] }, { namePrefix: this.#namePrefix }], optionalServices: [this.#service] };
      desc = `FFE0 service or name ${this.#namePrefix}*`;
    }
    this.#log(`browser picker (${desc})`);
    try {
      const dev = await navigator.bluetooth.requestDevice(options);
      this.#log(`picked id=${dev.id}`);
      this.#watch(dev);
      return this.#upsert(dev, { source: 'picked' });
    } catch (e) {
      this.#log(`picker: ${e.name}: ${e.message}`);
      if (e.name === 'NotFoundError' && !all && !name)
        this.#log('headset not in the picker? tick "List every nearby device" and try again');
      if (this.caps.brave && e.name !== 'NotFoundError') this.#log('Brave: make sure the Web Bluetooth flag is enabled');
      this.#state('disconnected', { reason: e.name === 'NotFoundError' ? 'No device chosen' : e.message });
      return null;
    }
  }

  async connect(entry) {
    this.stopScan();
    if (this.device && this.device !== entry.device) this.#closeQuietly();
    try {
      await this.#open(entry.device, false);
    } catch (e) {
      this.#log(`ERROR ${e.name}: ${e.message}`);
      this.#closeQuietly();
      // Devices found by an in-page scan may still need the picker once before GATT access.
      if (entry.source === 'scan' && (e.name === 'SecurityError' || e.name === 'NotFoundError')) {
        this.#log('this device needs to be approved once in the browser picker');
        const picked = await this.pick({ name: entry.name });
        if (picked) return this.connect(picked);
        return;
      }
      const noService = e.name === 'NotFoundError';
      if (noService) this.#log('this device has no FFE0/FFE1 service; it is not the headset module');
      this.#state('error', { reason: noService ? 'Not a JDY module (no FFE0)' : e.message });
    }
  }

  async disconnect() {
    this.#userDisconnect = true;
    if (this.device?.gatt.connected) this.device.gatt.disconnect(); // fires gattserverdisconnected
    else { this.connected = false; this.#state('disconnected'); this.#emit('devices'); }
  }

  async #open(dev, reconnect) {
    this.device = dev;
    this.#userDisconnect = false;
    this.#state('connecting', { reconnect });
    this.#emit('devices');
    dev.removeEventListener('gattserverdisconnected', this.#onDisconnected);
    dev.addEventListener('gattserverdisconnected', this.#onDisconnected);
    const server = await dev.gatt.connect();
    this.#log('GATT connected');
    const service = await server.getPrimaryService(this.#service);
    this.#char = await service.getCharacteristic(this.#characteristic);
    const p = this.#char.properties;
    this.#log('characteristic properties: ' + ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate'].filter(k => p[k]).join(', '));
    this.#char.addEventListener('characteristicvaluechanged', this.#onNotify);
    await this.#char.startNotifications();
    this.#log('notifications started');
    this.connected = true;
    const e = this.known.get(dev.id);
    if (e) e.ffe0 = true;
    this.#state('connected', { reconnect });
    this.#emit('devices');
  }

  #closeQuietly() {
    this.#char?.removeEventListener('characteristicvaluechanged', this.#onNotify);
    this.#char = null;
    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this.#onDisconnected);
      if (this.device.gatt.connected) this.device.gatt.disconnect();
    }
    this.connected = false;
    this.#emit('devices');
  }

  async #handleDrop() {
    const wasConnected = this.connected;
    this.connected = false;
    this.#char?.removeEventListener('characteristicvaluechanged', this.#onNotify);
    this.#log('device disconnected');
    if (this.reconnecting) return; // a failed attempt inside the loop below
    if (this.#userDisconnect || !wasConnected) {
      this.#state('disconnected');
      this.#emit('devices');
      return;
    }
    // Unexpected drop: retry on the same page.
    this.reconnecting = true;
    for (let i = 1; i <= RECONNECT_TRIES && !this.#userDisconnect; i++) {
      this.#state('reconnecting', { reason: `${i}/${RECONNECT_TRIES}` });
      this.#emit('devices');
      await new Promise(r => setTimeout(r, RECONNECT_DELAY_MS));
      if (this.#userDisconnect) break;
      try {
        await this.#open(this.device, true);
        this.#log(`reconnected after ${i} attempt(s)`);
        this.reconnecting = false;
        this.#emit('devices');
        return;
      } catch (e) { this.#log(`reconnect ${i} failed: ${e.message}`); }
    }
    this.reconnecting = false;
    this.#state('disconnected');
    this.#emit('devices');
  }
}
