// Web Serial transport for the ESP32 dongle (USB). Emits raw bytes; the dongle CSV decoder
// turns them into samples. Same events as the BLE transport ('data', 'state', 'log').

export const DONGLE_BAUD = 921600;
export const BAUD_CHOICES = [921600, 460800, 230400, 115200, 57600, 38400]; // as in neeg_monitor.py

export class SerialTransport extends EventTarget {
  kind = 'serial';
  output = 'bytes';
  connected = false;
  #port = null;
  #reader = null;
  #closing = false;
  #loop = null;

  static get supported() { return 'serial' in navigator; }

  #emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async connect({ baudRate = DONGLE_BAUD } = {}) {
    let port;
    try {
      port = await navigator.serial.requestPort();
    } catch (e) {
      this.#emit('log', `serial: ${e.name}: ${e.message}`);
      this.#emit('state', { state: 'disconnected', reason: e.name === 'NotFoundError' ? 'No port chosen' : e.message });
      return null;
    }
    this.#emit('state', { state: 'connecting' });
    try {
      await port.open({ baudRate, bufferSize: 64 * 1024 });
    } catch (e) {
      this.#emit('log', `serial open failed: ${e.message}`);
      this.#emit('state', { state: 'error', reason: `Cannot open port (in use by another app?)` });
      return null;
    }
    this.#port = port;
    this.#closing = false;
    const info = port.getInfo();
    const name = info.usbVendorId != null
      ? `USB ${hex4(info.usbVendorId)}:${hex4(info.usbProductId)}`
      : 'Serial port';
    this.#emit('log', `serial open: ${name} @ ${baudRate} baud`);
    this.connected = true;
    this.#loop = this.#readLoop();
    this.#emit('state', { state: 'connected' });
    return { deviceName: name };
  }

  async #readLoop() {
    try {
      while (this.#port?.readable && !this.#closing) {
        this.#reader = this.#port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await this.#reader.read();
            if (done) break;
            if (value?.length) this.#emit('data', value);
          }
        } catch (e) {
          if (!this.#closing) this.#emit('log', `serial read error: ${e.message}`);
        } finally {
          this.#reader.releaseLock();
        }
      }
    } finally {
      if (!this.#closing) {
        // Port lost (unplugged) rather than closed by us.
        this.connected = false;
        try { await this.#port?.close(); } catch {}
        this.#port = null;
        this.#emit('log', 'serial port lost');
        this.#emit('state', { state: 'disconnected', reason: 'Dongle unplugged' });
      }
    }
  }

  async disconnect() {
    if (!this.#port) return;
    this.#closing = true;
    try { await this.#reader?.cancel(); } catch {}
    await this.#loop;
    try { await this.#port.close(); } catch {}
    this.#port = null;
    this.connected = false;
    this.#emit('log', 'serial closed');
    this.#emit('state', { state: 'disconnected' });
  }
}

const hex4 = n => n.toString(16).padStart(4, '0');
