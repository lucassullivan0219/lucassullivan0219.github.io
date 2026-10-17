// Turning signed distance fields into triangle meshes.
// Smooth surfaces use surface nets (Gibson 1998): one vertex per grid cell that the surface
// crosses, placed at the average of the edge crossings. Block surfaces emit one square per
// exposed voxel face, like a voxel game's chunk mesher.

export function gridFor(box, h){
  const g = { x0: box[0], y0: box[1], z0: box[2], h };
  g.nx = Math.ceil((box[3] - box[0]) / h) + 1;
  g.ny = Math.ceil((box[4] - box[1]) / h) + 1;
  g.nz = Math.ceil((box[5] - box[2]) / h) + 1;
  return g;
}

/* sample fn on the grid; yields to the browser every ~40 ms so the progress bar can move */
export async function sampleField(fn, g, onProgress){
  const { nx, ny, nz, x0, y0, z0, h } = g, f = new Float32Array(nx * ny * nz);
  let o = 0, t0 = performance.now();
  for (let k = 0; k < nz; k++){
    const z = z0 + k * h;
    for (let j = 0; j < ny; j++){
      const y = y0 + j * h;
      for (let i = 0; i < nx; i++) f[o++] = fn(x0 + i * h, y, z);
    }
    if (performance.now() - t0 > 40){
      if (onProgress) onProgress((k + 1) / nz);
      await new Promise(r => setTimeout(r, 0));
      t0 = performance.now();
    }
  }
  return f;
}

export function trilinear(f, g, x, y, z){
  const fx = (x - g.x0) / g.h, fy = (y - g.y0) / g.h, fz = (z - g.z0) / g.h;
  if (!(fx >= 0 && fy >= 0 && fz >= 0 && fx < g.nx - 1 && fy < g.ny - 1 && fz < g.nz - 1)) return 99;
  const i = fx | 0, j = fy | 0, k = fz | 0, u = fx - i, v = fy - j, w = fz - k;
  const sy = g.nx, sz = g.nx * g.ny, o = i + j * sy + k * sz;
  const a = f[o] + (f[o + 1] - f[o]) * u, b = f[o + sy] + (f[o + sy + 1] - f[o + sy]) * u;
  const c = f[o + sz] + (f[o + sz + 1] - f[o + sz]) * u, d = f[o + sy + sz] + (f[o + sy + sz + 1] - f[o + sy + sz]) * u;
  const e = a + (b - a) * v, h = c + (d - c) * v;
  return e + (h - e) * w;
}

const EDGES = [];
for (let c = 0; c < 8; c++) for (const b of [1, 2, 4]) if (!(c & b)) EDGES.push(c, c | b);

/* surface nets on a sampled field; returns MNI-space positions, outward normals and triangle indices */
export function surfaceNets(f, g){
  const { nx, ny, nz, x0, y0, z0, h } = g, sy = nx, sz = nx * ny;
  const cx = nx - 1, cy = ny - 1, cz = nz - 1, vid = new Int32Array(cx * cy * cz).fill(-1);
  const P = [], N = [], v = new Float64Array(8);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++){
    const o = i + j * sy + k * sz;
    let mask = 0;
    for (let c = 0; c < 8; c++){
      const val = f[o + (c & 1) + ((c >> 1) & 1) * sy + ((c >> 2) & 1) * sz];
      v[c] = val; if (val < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let px = 0, py = 0, pz = 0, n = 0;
    for (let e = 0; e < EDGES.length; e += 2){
      const a = EDGES[e], b = EDGES[e + 1], va = v[a], vb = v[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      px += (a & 1) + ((b & 1) - (a & 1)) * t;
      py += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
      pz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
      n++;
    }
    const gx = v[1] - v[0] + v[3] - v[2] + v[5] - v[4] + v[7] - v[6];
    const gy = v[2] - v[0] + v[3] - v[1] + v[6] - v[4] + v[7] - v[5];
    const gz = v[4] - v[0] + v[5] - v[1] + v[6] - v[2] + v[7] - v[3];
    const gl = Math.hypot(gx, gy, gz) || 1;
    vid[i + j * cx + k * cx * cy] = P.length / 3;
    P.push(x0 + (i + px / n) * h, y0 + (j + py / n) * h, z0 + (k + pz / n) * h);
    N.push(gx / gl, gy / gl, gz / gl);
  }
  const I = [], cell = (i, j, k) => vid[i + j * cx + k * cx * cy];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) I.push(a, b, c, a, c, d); else I.push(a, c, b, a, d, c); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++){
    const o = i + j * sy + k * sz, s = f[o] < 0;
    if ((f[o + 1] < 0) !== s) quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), s);
    if ((f[o + sy] < 0) !== s) quad(cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1), s);
    if ((f[o + sz] < 0) !== s) quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), s);
  }
  return { positions: new Float32Array(P), normals: new Float32Array(N), indices: new Uint32Array(I) };
}

/* one square per voxel face that emit(label, neighbourLabel) allows */
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export function voxelMesh(lab, g, emit, lobeOf){
  const { nx, ny, nz, x0, y0, z0, h } = g, sy = nx, sz = nx * ny, hh = h / 2;
  const P = [], N = [], UV = [], AL = [], AA = [], I = [];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){
    const L = lab[i + j * sy + k * sz];
    if (!L) continue;
    const cxp = x0 + i * h, cyp = y0 + j * h, czp = z0 + k * h;
    for (let d = 0; d < 6; d++){
      const [dx, dy, dz] = DIRS[d], ni = i + dx, nj = j + dy, nk = k + dz;
      const M = (ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz) ? 0 : lab[ni + nj * sy + nk * sz];
      if (!emit(L, M)) continue;
      const axis = dx ? 0 : dy ? 1 : 2, sgn = dx + dy + dz, u = (axis + 1) % 3, w = (axis + 2) % 3;
      const base = P.length / 3, c = [cxp, cyp, czp];
      for (const [su, sw] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]){
        const p = c.slice();
        p[axis] += sgn * hh; p[u] += su * hh; p[w] += sw * hh;
        P.push(p[0], p[1], p[2]); N.push(dx, dy, dz);
        UV.push(su > 0 ? 1 : 0, sw > 0 ? 1 : 0); AL.push(lobeOf(L)); AA.push(L);
      }
      I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { positions: new Float32Array(P), normals: new Float32Array(N), uvs: new Float32Array(UV),
           lobe: new Float32Array(AL), area: new Float32Array(AA), indices: new Uint32Array(I) };
}
