// Fixed-capacity ring buffer over a typed array; oldest values are overwritten.
export class Ring {
  constructor(capacity, Type = Float64Array) {
    this.capacity = capacity;
    this.data = new Type(capacity);
    this.head = 0;   // next write position
    this.length = 0;
  }

  push(v) {
    this.data[this.head] = v;
    this.head = (this.head + 1) % this.capacity;
    if (this.length < this.capacity) this.length++;
  }

  clear() { this.head = 0; this.length = 0; }

  // Newest n values (or fewer if not yet available), oldest first.
  latest(n = this.length) {
    n = Math.min(n, this.length);
    const out = new this.data.constructor(n);
    const start = (this.head - n + this.capacity) % this.capacity;
    const firstPart = Math.min(n, this.capacity - start);
    out.set(this.data.subarray(start, start + firstPart));
    if (firstPart < n) out.set(this.data.subarray(0, n - firstPart), firstPart);
    return out;
  }
}
