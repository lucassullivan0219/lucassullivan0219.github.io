// Tiny test harness: no dependencies, runs in the browser (test.html).
const tests = [];
export const test = (name, fn) => tests.push({ name, fn });

export function assertEqual(actual, expected, msg = '') {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`.trim());
}

export function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

export function assertClose(actual, expected, tol, msg = '') {
  if (!(Math.abs(actual - expected) <= tol)) throw new Error(`${msg} expected ${expected} ± ${tol}, got ${actual}`.trim());
}

// Deterministic PRNG so failures are reproducible.
export function rng(seed) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

export function splitRandomly(bytes, rand, maxChunk = 23) {
  const chunks = [];
  for (let i = 0; i < bytes.length;) {
    const n = 1 + Math.floor(rand() * maxChunk);
    chunks.push(bytes.slice(i, i + n));
    i += n;
  }
  return chunks;
}

export async function runTests() {
  const results = [];
  for (const { name, fn } of tests) {
    try { await fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, error: e.message }); }
  }
  return results;
}
