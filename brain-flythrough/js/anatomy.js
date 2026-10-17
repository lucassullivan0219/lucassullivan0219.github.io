// Brain, head and EEG electrodes as code.
// Coordinates are MNI-style millimetres: +x = right, +y = anterior (front), +z = superior (up).
// Every shape is a signed distance function (SDF): negative inside, zero on the surface.
// Positions and sizes follow MNI atlas coordinates (see References on the page); the shapes
// are simplified, not traced from a scan.

/* ---------------- math helpers ---------------- */
const DEG = 180 / Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function smin(a, b, k){ const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
function smax(a, b, k){ return -smin(-a, -b, k); }

/* ellipsoid distance (Inigo Quilez's approximation) */
function ell(x, y, z, cx, cy, cz, rx, ry, rz){
  const ax = (x - cx) / rx, ay = (y - cy) / ry, az = (z - cz) / rz;
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const bx = ax / rx, by = ay / ry, bz = az / rz;
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
  return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
}
/* ellipsoid whose long (y) axis is tilted by deg in the y-z plane; negative = front end lower */
function ellP(x, y, z, cx, cy, cz, rx, ry, rz, deg){
  const a = deg / DEG, c = Math.cos(a), s = Math.sin(a), dy = y - cy, dz = z - cz;
  return ell(x, c * dy + s * dz, -s * dy + c * dz, cx, 0, 0, rx, ry, rz);
}
/* tube along a polyline [x, y, z, r, x, y, z, r, ...] with the radius blending between points */
function tube(x, y, z, p){
  let d = 1e9;
  for (let i = 0; i + 4 < p.length; i += 4){
    const ex = p[i + 4] - p[i], ey = p[i + 5] - p[i + 1], ez = p[i + 6] - p[i + 2];
    const px = x - p[i], py = y - p[i + 1], pz = z - p[i + 2];
    const h = clamp((px * ex + py * ey + pz * ez) / (ex * ex + ey * ey + ez * ez), 0, 1);
    const dx = px - ex * h, dy = py - ey * h, dz = pz - ez * h;
    const v = Math.sqrt(dx * dx + dy * dy + dz * dz) - (p[i + 3] + (p[i + 7] - p[i + 3]) * h);
    if (v < d) d = v;
  }
  return d;
}

/* ---------------- 3D simplex noise (Gustavson, public domain) for the gyri ---------------- */
function mulberry32(a){
  return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function makeNoise(seed){
  const rand = mulberry32(seed), p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--){ const j = Math.floor(rand() * (i + 1)), t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512), pm = new Uint8Array(512);
  for (let i = 0; i < 512; i++){ perm[i] = p[i & 255]; pm[i] = perm[i] % 12; }
  const G = [1,1,0, -1,1,0, 1,-1,0, -1,-1,0, 1,0,1, -1,0,1, 1,0,-1, -1,0,-1, 0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1];
  const F3 = 1 / 3, G3 = 1 / 6;
  return function(x, y, z){
    const s = (x + y + z) * F3, i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3, x0 = x - i + t, y0 = y - j + t, z0 = z - k + t;
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0){
      if (y0 >= z0){ i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0){ i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0){ i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0){ i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0, tt, g;
    tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (tt > 0){ g = pm[ii + perm[jj + perm[kk]]] * 3; tt *= tt; n += tt * tt * (G[g] * x0 + G[g + 1] * y0 + G[g + 2] * z0); }
    tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (tt > 0){ g = pm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; tt *= tt; n += tt * tt * (G[g] * x1 + G[g + 1] * y1 + G[g + 2] * z1); }
    tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (tt > 0){ g = pm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; tt *= tt; n += tt * tt * (G[g] * x2 + G[g + 1] * y2 + G[g + 2] * z2); }
    tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (tt > 0){ g = pm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; tt *= tt; n += tt * tt * (G[g] * x3 + G[g + 1] * y3 + G[g + 2] * z3); }
    return 32 * n;
  };
}

/* ---------------- regions ---------------- */
export const REGIONS = [null];          // index = region id (0 = nothing)
export const BY_KEY = {};
const SIDE_NAME = { L: 'Left', R: 'Right' };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const slug = s => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
function rgb(hex){ const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function add(r){
  r.id = REGIONS.length; r.rgb = rgb(r.color); r.token = slug(r.name);
  if (r.alphaBase === undefined) r.alphaBase = 1;
  REGIONS.push(r); BY_KEY[r.key] = r; return r;
}
function sided(base, side, name){ return side === 'M' ? { key: base, name: cap(name) } : { key: base + '_' + side, name: SIDE_NAME[side] + ' ' + name }; }

const LOBES = [
  ['frontal', 'frontal lobe', '#4f8ff7', 'Planning, decisions, attention, voluntary movement and, on the left, speech production. Everything in front of the central sulcus and above the lateral fissure.'],
  ['parietal', 'parietal lobe', '#f2c14e', 'Touch and body sense, spatial attention, and turning what we sense into action. Between the central sulcus and the parieto-occipital sulcus.'],
  ['temporal', 'temporal lobe', '#3fbf7f', 'Hearing, understanding language (on the left), memory (its inner part) and recognising objects and faces. Below the lateral (Sylvian) fissure.'],
  ['occipital', 'occipital lobe', '#ef5f7c', 'Vision. At the back of the brain; the primary visual cortex lines the calcarine sulcus on the inner (medial) surface.'],
  ['limbic', 'cingulate gyrus (limbic lobe)', '#b07cf5', 'Arches over the corpus callosum on the medial surface. Emotion, motivation, error monitoring and pain (front part); memory and self-referential thought (back part). Part of the limbic system.'],
  ['insula', 'insula', '#f28a3a', 'Cortex folded deep inside the lateral fissure, hidden under the frontal, parietal and temporal lobes. Sense of the body\'s inner state, taste, pain and emotional awareness.'],
  ['medial', 'medial wall (not cortex)', '#8f97a3', 'In a real brain the two hemispheres join the diencephalon and brainstem here, under the corpus callosum. The model closes each hemisphere with a flat wall; this part of the wall is not cortex.']
];
const AREAS = [
  ['motor', 'frontal', 'primary motor cortex (M1)', '#2f62f0', 'LR', 'Precentral gyrus, Brodmann area 4. Sends movement commands to the opposite side of the body, laid out as a motor homunculus: leg at the top of the midline, hand on the side, face near the lateral fissure. C3 and C4 sit close to the hand area.'],
  ['premotor', 'frontal', 'premotor cortex and SMA', '#5d9bff', 'LR', 'Brodmann area 6, in front of M1. Plans and sequences movements; the supplementary motor area (SMA) is on the medial surface, under Fz and Cz.'],
  ['prefrontal', 'frontal', 'prefrontal cortex', '#9cc4ff', 'LR', 'Dorsolateral, medial and frontopolar cortex: working memory, planning, attention control and decisions. Fp1, Fp2 and Fz sit over it.'],
  ['orbitofrontal', 'frontal', 'orbitofrontal cortex', '#3fc9e0', 'LR', 'Underside of the frontal lobe, above the eyes: value, reward and social decisions.'],
  ['broca', 'frontal', 'Broca\'s area', '#7b5cff', 'L', 'Left inferior frontal gyrus (Brodmann areas 44 and 45): speech production and grammar.'],
  ['somatosensory', 'parietal', 'primary somatosensory cortex (S1)', '#f09a1e', 'LR', 'Postcentral gyrus, Brodmann areas 3, 1 and 2: touch, pressure and limb position from the opposite side of the body, as a sensory homunculus.'],
  ['parietal_assoc', 'parietal', 'posterior parietal cortex', '#f6dc7a', 'LR', 'Superior and inferior parietal lobules and precuneus (Brodmann areas 5, 7, 39 and 40): spatial attention, reaching, reading and number sense. Pz sits over it.'],
  ['auditory', 'temporal', 'primary auditory cortex', '#19b36f', 'LR', 'Heschl\'s gyrus (Brodmann areas 41 and 42) on the upper surface of the temporal lobe, inside the lateral fissure: the first cortical stage of hearing.'],
  ['wernicke', 'temporal', 'Wernicke\'s area', '#a3e635', 'L', 'Left posterior superior temporal gyrus (Brodmann area 22): understanding spoken language.'],
  ['temporal_assoc', 'temporal', 'temporal association cortex', '#7fd9a8', 'LR', 'Middle and inferior temporal, fusiform and parahippocampal gyri: recognising objects and faces, word meaning and memory.'],
  ['v1', 'occipital', 'primary visual cortex (V1)', '#e8364f', 'LR', 'Brodmann area 17, along the calcarine sulcus on the medial surface and at the occipital pole: the first cortical stage of vision. Each side maps the opposite half of the visual field.'],
  ['visual_assoc', 'occipital', 'visual association cortex', '#f59aab', 'LR', 'Brodmann areas 18 and 19: visual areas for shape, colour and motion. O1 and O2 sit over the occipital lobe.']
];
const DEEP = [
  ['thalamus', 'thalamus', '#ff7ab8', 'LR', 'Relay station between the senses and the cortex (every sense except smell). Thalamo-cortical loops generate sleep spindles and help pace the alpha rhythm that EEG records.'],
  ['caudate', 'caudate nucleus', '#6fd3c1', 'LR', 'C-shaped part of the striatum that follows the lateral ventricle: goal-directed behaviour and learning. Part of the basal ganglia.'],
  ['putamen', 'putamen', '#2f8fd0', 'LR', 'Outer part of the striatum (basal ganglia): movement control and motor habits. Loses its dopamine input in Parkinson\'s disease.'],
  ['pallidus', 'globus pallidus', '#7a86f0', 'LR', 'Main output stage of the basal ganglia toward the thalamus. Its inner part (GPi) is a deep brain stimulation target.'],
  ['hippocampus', 'hippocampus', '#ffb347', 'LR', 'Curved ridge in the medial temporal lobe, in the floor of the lateral ventricle\'s temporal horn: forms new memories and maps space. Part of the limbic system.'],
  ['amygdala', 'amygdala', '#ff5b45', 'LR', 'Almond-shaped group of nuclei in front of the hippocampus: threat detection, fear and emotional memory. Part of the limbic system.'],
  ['ventricle', 'lateral ventricle', '#9fe7ff', 'LR', 'Space filled with cerebrospinal fluid inside each hemisphere, with anterior, posterior and temporal horns. The third and fourth ventricles are not drawn.'],
  ['hypothalamus', 'hypothalamus', '#e85ce0', 'M', 'Below the thalamus, around the third ventricle: hunger, thirst, body temperature, sleep, and hormones through the pituitary. Drives the fight-or-flight response.'],
  ['callosum', 'corpus callosum', '#e8e8e8', 'M', 'Band of about 200 million axons that joins the left and right hemispheres, under the cingulate gyri.']
];
const HIND = [
  ['midbrain', 'midbrain', '#c99064', 'M', 'Top of the brainstem: eye movements and visual and auditory reflexes. Contains the dopamine neurons of the substantia nigra.'],
  ['pons', 'pons', '#b07a4f', 'M', 'Front bulge of the brainstem that relays signals from the cortex to the cerebellum; helps set the breathing rhythm and REM sleep.'],
  ['medulla', 'medulla oblongata', '#93623b', 'M', 'Lowest part of the brainstem: breathing, heart rate, blood pressure and swallowing. Continues into the spinal cord.'],
  ['cerebellum', 'cerebellar hemisphere', '#a8bf6a', 'LR', 'Coordinates movement, balance and motor learning. Its thin folds (folia) hold more than half of the brain\'s neurons.'],
  ['vermis', 'cerebellar vermis', '#7f9a45', 'M', 'Midline strip of the cerebellum: posture, balance and eye movements.']
];

for (const side of ['L', 'R']){
  for (const [base, name, color, info] of LOBES){
    const r = add({ ...sided(base, side, name), base, side, cat: 'cortex', kind: 'lobe', color, info, alphaBase: base === 'medial' ? 0.45 : 1 });
    r.lobe = r.id;
  }
}
for (const [base, lobe, name, color, sides, info] of AREAS){
  for (const side of sides){
    add({ ...sided(base, side, name), base, side, cat: 'cortex', kind: 'area', color, info, lobe: BY_KEY[lobe + '_' + side].id });
  }
}
for (const [list, cat] of [[DEEP, 'deep'], [HIND, 'hind']]){
  for (const [base, name, color, sides, info] of list){
    for (const side of sides === 'M' ? ['M'] : ['L', 'R']){
      const r = add({ ...sided(base, side, name), base, side, cat, kind: 'struct', color, info });
      r.lobe = r.id;
    }
  }
}
{
  const r = add({ key: 'scalp', base: 'scalp', side: 'M', name: 'Scalp', cat: 'head', kind: 'struct', color: '#f1c7a1', alphaBase: 0.42,
    info: 'Skin of the head. Skull, meninges and cerebrospinal fluid lie between it and the brain (not drawn), which is why scalp EEG sees a blurred, summed picture of the cortex.' });
  r.lobe = r.id;
}
export const isCortex = r => !!r && r.cat === 'cortex' && r.base !== 'insula';
const idOf = (base, side) => BY_KEY[base + '_' + side].id;

/* ---------------- landmark surfaces that split the cerebrum ---------------- */
export const BRAIN_CENTER = [0, -18, 12];
/* central sulcus: y position as a function of the angle phi (deg) around the convexity, measured
   from the point (|x|, z) to the axis z = 10; fitted to MNI M1/S1 coordinates (hand knob near
   |x| 38, y -24, z 58; face area near |x| 58, y -8, z 28; paracentral lobule y -37). */
export function convexityAngle(ax, z){ return Math.atan2(z - 10, Math.max(ax, 0.5)) * DEG; }
export function centralY(ax, z){
  const phi = Math.max(0, convexityAngle(ax, z));
  return -0.96 - 0.409 * phi + 2.5 * Math.sin(phi * Math.PI / 18);
}
export const sylvianZ = y => -2 - 0.6 * y;     // lateral fissure: z -8 at y 10, z 10 at y -20, z 22 at y -40
function temporalTopZ(y){ return y >= -42 ? sylvianZ(y) : 23.2 - 0.8 * (-42 - y); }
function parietoOccipitalY(ax, z){
  const med = -58 - 0.49 * Math.max(z - 8, 0), lat = -70 - 0.1 * z;
  return med + (lat - med) * smoothstep(10, 40, ax);
}
const CC = { y0: -5, z0: 7, ay: 34, az: 17 };   // corpus callosum arch in the midsagittal plane
function ccUV(y, z){ return [(y - CC.y0) / CC.ay, (z - CC.z0) / CC.az]; }
const temporalShape = (ax, y, z) => ellP(ax, y, z, 44, -24, -16, 24, 44, 22, -12);

/* which functional area (and so which lobe) a point of the cerebrum belongs to */
export function cerebralArea(x, y, z){
  const ax = Math.abs(x), S = x < 0 ? 'L' : 'R';
  if (ax < 8){
    const [u, v] = ccUV(y, z), rho = Math.hypot(u, v);
    if (rho < 1.13) return idOf('medial', S);
    if (rho < 1.8 && v > -0.35) return idOf('limbic', S);
  }
  if (y < parietoOccipitalY(ax, z)){
    if ((ax < 8 && Math.abs(z - 3) < 11) || y < -99) return idOf('v1', S);
    return idOf('visual_assoc', S);
  }
  const zt = temporalTopZ(y);
  if (z < zt && (y < -5 || temporalShape(ax, y, z) < 3)){
    if (ax > 34 && ax < 60 && y > -34 && y < -12 && z > sylvianZ(y) - 9) return idOf('auditory', S);
    if (S === 'L' && ax > 40 && y > -62 && y < -34 && z > zt - 16) return idOf('wernicke', S);
    return idOf('temporal_assoc', S);
  }
  const ycs = centralY(ax, z), phi = convexityAngle(ax, z);
  if (y < ycs) return (y > ycs - 11 && phi > 12) ? idOf('somatosensory', S) : idOf('parietal_assoc', S);
  if (S === 'L' && ax > 28 && y > 6 && y < 34 && z > -6 && z < 24) return idOf('broca', S);
  if (y < ycs + 11 && phi > 12) return idOf('motor', S);
  if (z < -6 && y > 0) return idOf('orbitofrontal', S);
  if (y < ycs + 34) return idOf('premotor', S);
  return idOf('prefrontal', S);
}

/* ---------------- cerebral hemisphere (evaluated at |x|; each side gets its own noise) ---------------- */
function hemiBase(ax, y, z){
  let f = ell(ax, y, z, 6, -17, 8, 64, 87, 70);
  // floor: flat under the frontal lobe, rising at the back and the midline over the tentorium
  const rise = 0.25 * Math.max(0, -40 - y) + Math.min(8, 0.5 * Math.max(0, -30 - y)) * (1 - smoothstep(12, 32, ax));
  f = smax(f, -24 + rise - z, 8);
  f = smin(f, temporalShape(ax, y, z), 8);                     // temporal lobe hangs below
  f = smax(f, -ell(ax, y, z, 0, -15, -16, 18, 27, 17), 4);     // keep the midline free for the brainstem
  return smax(f, 1.6 - ax, 4);                                 // longitudinal fissure
}
export function hemiSDF(ax, y, z, noise, off){
  let f = hemiBase(ax, y, z);
  // lateral (Sylvian) fissure: a 5 mm cleft down to the insula
  const w = 2.4 * smoothstep(-47, -37, y);
  if (w > 0.2){
    const slab = Math.max(Math.abs((z - sylvianZ(y)) / 1.166) - w, 35 - ax, y - 30);
    f = smax(f, -slab, 1.2);
  }
  if (f > 9 || f < -11) return f;
  // central sulcus
  const phi = convexityAngle(ax, z);
  if (phi > 8){
    const d = (y - centralY(ax, z)) * 0.85;
    const m = smoothstep(10, 20, phi) * (ax > 9 ? 1 : smoothstep(58, 70, z));
    f += 6 * m * Math.exp(-d * d / 2.6);
  }
  // calcarine and parieto-occipital sulci on the medial surface
  if (ax < 14){
    const mm = 1 - smoothstep(6, 14, ax);
    if (y < -58){ const dc = z - 3; f += 4 * mm * smoothstep(-58, -66, y) * Math.exp(-dc * dc / 2.5); }
    if (z > 4){ const dp = (y + 58 + 0.49 * Math.max(z - 8, 0)) * 0.9; f += 4 * mm * smoothstep(4, 12, z) * Math.exp(-dp * dp / 2.5); }
  }
  // gyri: narrow grooves along the zero set of warped noise, broad crowns between them
  const k = 1 / 14, wv = noise(ax * 0.035 + off, y * 0.035, z * 0.035) * 0.8;
  const g = noise(ax * k + wv + off, y * k - wv, z * k + 0.5 * wv);
  f += 3.0 * Math.exp(-g * g / 0.045);
  return f - 0.7 * noise(ax * 0.11 - off, y * 0.11, z * 0.11);
}
export const HEMI_BOX = [-0.6, -110, -66, 74, 76, 84];

/* ---------------- deep structures ---------------- */
function E(cx, cy, cz, rx, ry, rz){ return { f: (x, y, z) => ell(x, y, z, cx, cy, cz, rx, ry, rz), box: [cx - rx, cy - ry, cz - rz, cx + rx, cy + ry, cz + rz] }; }
function EP(cx, cy, cz, rx, ry, rz, deg){ const m = Math.max(ry, rz); return { f: (x, y, z) => ellP(x, y, z, cx, cy, cz, rx, ry, rz, deg), box: [cx - rx, cy - m, cz - m, cx + rx, cy + m, cz + m] }; }
function T(p){
  const b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
  for (let i = 0; i < p.length; i += 4) for (let a = 0; a < 3; a++){ b[a] = Math.min(b[a], p[i + a] - p[i + 3]); b[a + 3] = Math.max(b[a + 3], p[i + a] + p[i + 3]); }
  return { f: (x, y, z) => tube(x, y, z, p), box: b };
}
function U(a, b){ return { f: (x, y, z) => Math.min(a.f(x, y, z), b.f(x, y, z)), box: a.box.map((v, i) => i < 3 ? Math.min(v, b.box[i]) : Math.max(v, b.box[i])) }; }

/* bilateral structures, right side (x > 0); the left side is the mirror image. Order = priority. */
export const BILATERAL = [
  ['amygdala', E(22, -3, -18, 7.5, 8, 7)],
  ['hippocampus', T([24, -11, -19, 5.4, 28, -21, -14, 4.7, 28, -31, -7, 3.9, 23, -39, 1, 2.9])],
  ['thalamus', E(11, -18, 7, 8, 15, 9.5)],
  ['pallidus', E(18, -3, -1, 3.6, 9, 5.5)],
  ['putamen', E(25, 2, 1, 5.5, 15, 9.5)],
  ['caudate', T([16, 15, 6, 6.8, 17, 3, 14, 5.0, 19, -10, 20, 3.8, 22, -22, 20, 3.1, 27, -31, 14, 2.5, 33, -30, 4, 1.9, 34, -21, -4, 1.6])],
  ['ventricle', U(T([8, 22, 9, 3.2, 10, 10, 15, 3.6, 12, -6, 16.5, 3.8, 16, -22, 15.5, 3.5, 24, -36, 9, 4.2, 20, -52, 5, 2.4]),
                  T([24, -36, 9, 3.3, 32, -29, 0, 2.6, 33, -19, -8, 2.1, 31, -10, -13, 1.6]))],
  ['insula', EP(37, -3, 3, 4, 20, 13, -31)]
].map(([base, s]) => ({ base, ...s, idL: idOf(base, 'L'), idR: idOf(base, 'R') }));

const rostrum = [0, 29, 7, 4.2, 0, 25, -2, 3.0, 0, 17, -6, 2.2];
function callosumSDF(ax, y, z){
  const [u, v] = ccUV(y, z);
  let d;
  if (v >= 0){
    const th = Math.atan2(v, u), c = Math.cos(th), s = Math.sin(th);
    const t = 2.8 + (c > 0 ? 2.2 : 3.4) * c * c;              // thin body, thick genu and splenium
    d = (Math.hypot(u, v) - 1) / Math.hypot(c / CC.ay, s / CC.az) - t;
  } else {
    d = u >= 0 ? Math.hypot(y - (CC.y0 + CC.ay), z - CC.z0) - 5.0 : Math.hypot(y - (CC.y0 - CC.ay), z - CC.z0) - 6.2;
  }
  d = Math.min(d, tube(0, y, z, rostrum));
  return smax(d, ax - 14, 4);
}
/* midline structures, evaluated at |x| */
export const MIDLINE = [
  { base: 'hypothalamus', ...E(4.5, -4, -10, 4, 6.5, 4.5) },
  { base: 'callosum', f: callosumSDF, box: [0, -48, -12, 18, 38, 32] }
].map(s => ({ ...s, id: BY_KEY[s.base].id }));

export function brainstemSDF(ax, y, z){
  let f = tube(ax, y, z, [0, -24, -10, 10.5, 0, -26, -19, 11]);
  f = smin(f, ell(ax, y, z, 0, -24, -30, 15, 13, 12.5), 5);
  return smin(f, tube(ax, y, z, [0, -31, -40, 9, 0, -39, -62, 7.5, 0, -42, -84, 6.5]), 5);
}
export const BRAINSTEM_BOX = [0, -50, -91, 17, -5, 2];
export function brainstemPart(z){ return BY_KEY[z > -19 ? 'midbrain' : z > -41 ? 'pons' : 'medulla'].id; }

export function cerebellumSDF(ax, y, z){
  let f = ellP(ax, y, z, 24, -63, -40, 26, 24, 20, -6);
  f = smin(f, ell(ax, y, z, 0, -60, -33, 10, 23, 19), 6);
  f = smax(f, z - (-13 + 0.15 * (y + 55) - 0.35 * ax), 5);   // tentorium on top
  f = smax(f, -(brainstemSDF(ax, y, z) - 2.5), 3);             // room for the brainstem
  if (f > -4 && f < 4) f += 0.8 * Math.sin(Math.hypot(ax * 0.8, y + 46, z + 28) * 1.35);   // folia
  return f;
}
export const CEREBELLUM_BOX = [0, -90, -64, 52, -30, -8];
export function cerebellumPart(x){ return Math.abs(x) < 9 ? BY_KEY.vermis.id : idOf('cerebellum', x < 0 ? 'L' : 'R'); }

const inBox = (b, x, y, z, m = 0) => x >= b[0] - m && y >= b[1] - m && z >= b[2] - m && x <= b[3] + m && y <= b[4] + m && z <= b[5] + m;

/* label of any point; hemi(S, |x|, y, z) returns the cerebral SDF of side S */
export function makeLabeler(hemi){
  return function labelAt(x, y, z){
    const ax = Math.abs(x), S = x < 0 ? 'L' : 'R';
    for (const s of BILATERAL) if (inBox(s.box, ax, y, z) && s.f(ax, y, z) < 0) return S === 'L' ? s.idL : s.idR;
    for (const s of MIDLINE) if (inBox(s.box, ax, y, z) && s.f(ax, y, z) < 0) return s.id;
    if (inBox(BRAINSTEM_BOX, ax, y, z) && brainstemSDF(ax, y, z) < 0) return brainstemPart(z);
    if (inBox(CEREBELLUM_BOX, ax, y, z) && cerebellumSDF(ax, y, z) < 0) return cerebellumPart(x);
    if (hemi(S, ax, y, z) < 0) return cerebralArea(x, y, z);
    return 0;
  };
}

/* ---------------- head and electrodes ---------------- */
/* 10-20 / 10-10 positions in MNI millimetres from FieldTrip's standard_1020.elc (Oostenveld &
   Praamstra 2001). Used to shape the scalp. A1/A2 (on the earlobe) are left out of the fit. */
const SCALP_DATA = 'LPA -86.1 -20.0 -48.0;RPA 85.8 -20.0 -48.0;Nz 0.0 86.8 -40.0;Fp1 -29.4 83.9 -7.0;Fpz 0.1 88.2 -1.7;Fp2 29.9 84.9 -7.1;AF9 -49.0 64.1 -47.7;AF7 -54.8 68.6 -10.6;AF5 -45.4 72.9 6.0;AF3 -33.7 76.8 21.2;AF1 -18.5 79.9 32.8;AFz 0.2 80.8 35.4;AF2 19.8 80.3 32.8;AF4 35.7 77.7 22.0;AF6 46.6 73.8 6.0;AF8 55.7 69.7 -10.8;AF10 50.4 63.9 -48.0;F9 -70.1 41.7 -50.0;F7 -70.3 42.5 -11.4;F5 -64.5 48.0 16.9;F3 -50.2 53.1 42.2;F1 -27.5 56.9 60.3;Fz 0.3 58.5 66.5;F2 29.5 57.6 59.5;F4 51.8 54.3 40.8;F6 67.9 49.8 16.4;F8 73.0 44.4 -12.0;F10 72.1 42.1 -50.5;FT9 -84.1 14.6 -50.4;FT7 -80.8 14.1 -11.1;FC5 -77.2 18.6 24.5;FC3 -60.2 22.7 55.5;FC1 -34.1 26.0 80.0;FCz 0.4 27.4 88.7;FC2 34.8 26.4 78.8;FC4 62.3 23.7 55.6;FC6 79.5 19.9 24.4;FT8 81.8 15.4 -11.3;FT10 84.1 14.4 -50.5;T9 -85.9 -15.8 -48.3;T7 -84.2 -16.0 -9.3;C5 -80.3 -13.8 29.2;C3 -65.4 -11.6 64.4;C1 -36.2 -10.0 89.8;Cz 0.4 -9.2 100.2;C2 37.7 -9.6 88.4;C4 67.1 -10.9 63.6;C6 83.5 -12.8 29.2;T8 85.1 -15.0 -9.5;T10 85.6 -16.4 -48.3;TP9 -85.6 -46.5 -45.7;TP7 -84.8 -46.0 -7.1;CP5 -79.6 -46.6 30.9;CP3 -63.6 -47.0 65.6;CP1 -35.5 -47.3 91.3;CPz 0.4 -47.3 99.4;CP2 38.4 -47.1 90.7;CP4 66.6 -46.6 65.6;CP6 83.3 -46.1 31.2;TP8 85.5 -45.5 -7.1;TP10 86.2 -47.0 -45.9;P9 -73.0 -73.8 -41.0;P7 -72.4 -73.5 -2.5;P5 -67.3 -76.3 28.4;P3 -53.0 -78.8 55.9;P1 -28.6 -80.5 75.4;Pz 0.3 -81.1 82.6;P2 31.9 -80.5 76.7;P4 55.7 -78.6 56.6;P6 67.9 -75.9 28.1;P8 73.1 -73.1 -2.5;P10 73.9 -74.4 -41.2;PO9 -54.9 -98.0 -35.5;PO7 -54.8 -97.5 2.8;PO5 -48.4 -99.3 21.6;PO3 -36.5 -100.9 37.2;PO1 -19.0 -101.8 46.5;POz 0.2 -102.2 50.6;PO2 19.9 -101.8 46.4;PO4 36.8 -100.8 36.4;PO6 49.8 -99.4 21.7;O1 -29.4 -112.4 8.8;Oz 0.1 -114.9 14.7;O2 29.8 -112.2 8.8;O9 -29.8 -114.6 -29.2;Iz 0.0 -118.6 -23.1;O10 29.7 -114.3 -29.3;M1 -86.1 -44.9 -68.0;M2 85.8 -45.0 -68.0';
export const HEAD_CENTER = [0, -17, 0];
export const SCALP_POINTS = SCALP_DATA.split(';').map(s => { const [n, x, y, z] = s.split(' '); return { name: n, pos: [+x, +y, +z] }; });
const SU = [], SR = [];
for (const p of SCALP_POINTS){
  const d = [p.pos[0] - HEAD_CENTER[0], p.pos[1] - HEAD_CENTER[1], p.pos[2] - HEAD_CENTER[2]], r = Math.hypot(...d);
  SU.push(d[0] / r, d[1] / r, d[2] / r); SR.push(r);
}
/* scalp radius in a unit direction from HEAD_CENTER: a smooth spherical average of the electrode radii */
export function scalpRadius(ux, uy, uz){
  let sw = 0, sr = 0;
  for (let i = 0; i < SR.length; i++){
    const w = Math.exp(30 * (ux * SU[3 * i] + uy * SU[3 * i + 1] + uz * SU[3 * i + 2] - 1));
    sw += w; sr += w * SR[i];
  }
  return sr / sw;
}

/* the eight active electrodes and the two reference choices (exact values from standard_1020.elc) */
export const ELECTRODES = [
  { key: 'Fp1', pos: [-29.4367, 83.9171, -6.9900], kind: 'active', where: 'left frontal pole',
    info: 'Over the left prefrontal cortex near the frontal pole. Picks up eye blinks and eye movements more than any other site.' },
  { key: 'Fp2', pos: [29.8723, 84.8959, -7.0800], kind: 'active', where: 'right frontal pole',
    info: 'Over the right prefrontal cortex near the frontal pole. Picks up eye blinks and eye movements more than any other site.' },
  { key: 'Fz', pos: [0.3122, 58.5120, 66.4620], kind: 'active', where: 'midline frontal',
    info: 'Over the medial frontal cortex of both hemispheres (superior frontal gyrus). Frontal-midline theta and error-related potentials are largest around here.' },
  { key: 'C3', pos: [-65.3581, -11.6317, 64.3580], kind: 'active', where: 'left central',
    info: 'Over the left sensorimotor cortex, near the hand area on either side of the central sulcus. Mu (8-13 Hz) and beta rhythms; imagined movement of the right hand.' },
  { key: 'C4', pos: [67.1179, -10.9003, 63.5800], kind: 'active', where: 'right central',
    info: 'Over the right sensorimotor cortex, near the hand area on either side of the central sulcus. Mu (8-13 Hz) and beta rhythms; imagined movement of the left hand.' },
  { key: 'Pz', pos: [0.3247, -81.1150, 82.6150], kind: 'active', where: 'midline parietal',
    info: 'Over the posterior parietal cortex and precuneus of both hemispheres. The P300 is usually largest here.' },
  { key: 'O1', pos: [-29.4134, -112.4490, 8.8390], kind: 'active', where: 'left occipital',
    info: 'Over the left visual cortex. Alpha rhythm with the eyes closed, visual evoked potentials and SSVEP.' },
  { key: 'O2', pos: [29.8426, -112.1560, 8.8000], kind: 'active', where: 'right occipital',
    info: 'Over the right visual cortex. Alpha rhythm with the eyes closed, visual evoked potentials and SSVEP.' },
  { key: 'A1', pos: [-86.0761, -24.9897, -67.9860], kind: 'ear', where: 'left earlobe (ear clip)',
    info: 'Ear-clip reference on the left earlobe, which hangs on soft tissue below the ear. Quick to attach, but it moves with the ear and still picks up some temporal-lobe activity. Linked ears (A1 + A2) is a classic reference.' },
  { key: 'A2', pos: [85.7939, -25.0093, -68.0310], kind: 'ear', where: 'right earlobe (ear clip)',
    info: 'Ear-clip reference on the right earlobe, which hangs on soft tissue below the ear. Quick to attach, but it moves with the ear and still picks up some temporal-lobe activity. Linked ears (A1 + A2) is a classic reference.' },
  { key: 'M1', pos: [-86.0761, -44.9897, -67.9860], kind: 'mastoid', where: 'left mastoid',
    info: 'Reference on the left mastoid, the bone behind the ear. Contact is steady and it is common in ERP work (linked mastoids). Its nearest brain tissue is the cerebellum; placed too low it can pick up the pulse.' },
  { key: 'M2', pos: [85.7939, -45.0093, -68.0310], kind: 'mastoid', where: 'right mastoid',
    info: 'Reference on the right mastoid, the bone behind the ear. Contact is steady and it is common in ERP work (linked mastoids). Its nearest brain tissue is the cerebellum; placed too low it can pick up the pulse.' }
];
export const ELECTRODE_KIND = {
  active: { color: '#ffd447', role: 'Active electrode' },
  ear: { color: '#36d4ff', role: 'Ear-clip reference' },
  mastoid: { color: '#ff6bd5', role: 'Mastoid reference' }
};
