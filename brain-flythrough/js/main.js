// Brain Fly-Through: a see-through brain you fly around with Minecraft-style controls.
// World units are millimetres. Everything anatomical lives in MNI coordinates inside `mni`,
// a group rotated so MNI +z (up) is three.js +y and MNI +y (front) is three.js -z.
import * as THREE from 'three';
import * as A from './anatomy.js';
import { gridFor, sampleField, trilinear, surfaceNets, voxelMesh } from './mesh.js';

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const COARSE = matchMedia('(pointer: coarse)').matches;
const R = A.REGIONS;
const toThree = (x, y, z) => new THREE.Vector3(x, z, -y);
const toMNI = v => [v.x, -v.z, v.y];
const fmt = n => (Math.round(n * 10) / 10).toFixed(1).replace('-0.0', '0.0');

/* ---------------- options (per-viewer convenience; storage may be unavailable) ---------------- */
const DEFAULTS = { opacity: 0.35, render: 'smooth', block: 3, tags: true, coords: true, grid: true, lines: true, eeg: true, fov: 70, sens: 1, invert: false, flyLook: false, speed: 30 };
const opt = Object.assign({}, DEFAULTS);
try { Object.assign(opt, JSON.parse(localStorage.getItem('brainfly.opts') || '{}')); } catch (e) {}
function saveOpts(){ try { localStorage.setItem('brainfly.opts', JSON.stringify(opt)); } catch (e) {} }

/* ---------------- renderer, camera, scene ---------------- */
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, COARSE ? 1.25 : 1.75));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0c111d');
const camera = new THREE.PerspectiveCamera(opt.fov, 1, 0.5, 6000);
camera.rotation.order = 'YXZ';
scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(0.4, 1, 0.6); scene.add(sun);
const mni = new THREE.Group(); mni.rotation.x = -Math.PI / 2; scene.add(mni);
const smoothGroup = new THREE.Group(); mni.add(smoothGroup);
const headGroup = new THREE.Group(); mni.add(headGroup);
const eegGroup = new THREE.Group(); mni.add(eegGroup);
const grid = new THREE.GridHelper(320, 32, 0x3a4766, 0x1f2840); grid.position.set(0, -98, 18); scene.add(grid);
const originAxes = new THREE.AxesHelper(25); originAxes.visible = false; mni.add(originAxes);

function resize(){
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

/* ---------------- see-through region material ---------------- */
const RN = 64, regionData = new Uint8Array(RN * 4);
const regionTex = new THREE.DataTexture(regionData, RN, 1, THREE.RGBAFormat);
regionTex.magFilter = regionTex.minFilter = THREE.NearestFilter;
const U = { uRegions: { value: regionTex }, uOpacity: { value: opt.opacity }, uTime: { value: 0 }, uHighlight: { value: -1 }, uMode: { value: 0 }, uPix: { value: 8 / opt.block } };
const VERT = `
in float aLobe;
in float aArea;
uniform float uMode;
flat out int vLabel;
out vec3 vN;
out vec3 vW;
out vec2 vUv;
void main(){
  vLabel = int((uMode > 0.5 ? aArea : aLobe) + 0.5);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
#ifdef BLOCKS
  vUv = uv;
#else
  vUv = vec2(0.5);
#endif
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FRAG = `
uniform sampler2D uRegions;
uniform float uOpacity;
uniform float uTime;
uniform int uHighlight;
uniform float uPix;
flat in int vLabel;
in vec3 vN;
in vec3 vW;
in vec2 vUv;
void main(){
  vec4 reg = texelFetch(uRegions, ivec2(vLabel, 0), 0);
  if (reg.a < 0.004) discard;
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float rim = pow(1.0 - abs(dot(N, V)), 2.0);
  float shade, edgeA = 1.0;
#ifdef BLOCKS
  vec3 an = abs(N);
  shade = an.y > 0.5 ? (N.y > 0.0 ? 1.0 : 0.55) : (an.x > 0.5 ? 0.72 : 0.86);
  float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  float edge = smoothstep(0.0, 0.1, e);
  vec3 cell = floor((vW - N * 0.05) * uPix);
  float hsh = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  shade *= mix(0.88, 1.06, hsh) * mix(0.55, 1.0, edge);
  edgeA = mix(1.8, 1.0, edge);
#else
  shade = 0.42 + 0.58 * abs(dot(N, normalize(vec3(0.35, 0.85, 0.4))));
#endif
  vec3 col = reg.rgb * shade + reg.rgb * rim * 0.35;
  float a = uOpacity * (0.5 + 1.3 * rim) * edgeA * reg.a;
  if (vLabel == uHighlight){
    float p = 0.5 + 0.5 * sin(uTime * 5.0);
    col = mix(col, vec3(1.0), 0.22 + 0.2 * p);
    a = max(a * 1.6, 0.42);
  }
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.97));
}`;
function regionMaterial(blocks){
  // WebGL2: three.js compiles ShaderMaterial as GLSL ES 3.0, so `flat` and texelFetch are available
  return new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: FRAG,
    defines: blocks ? { BLOCKS: 1 } : {}, transparent: true, depthWrite: false, side: THREE.DoubleSide });
}
const smoothMat = regionMaterial(false), blockMat = regionMaterial(true);
function makeGeometry(pos, nor, idx, lobe, area, uv){
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aLobe', new THREE.BufferAttribute(lobe, 1));
  g.setAttribute('aArea', new THREE.BufferAttribute(area, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}
let triangles = 0;
function addSurface(parent, m, labelOf, order, mirror){
  const n = m.positions.length / 3, lobe = new Float32Array(n), area = new Float32Array(n);
  if (mirror){ for (let i = 0; i < n; i++){ m.positions[3 * i] *= -1; m.normals[3 * i] *= -1; } }
  for (let i = 0; i < n; i++){
    const id = labelOf(m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]);
    area[i] = id; lobe[i] = R[id].lobe;
  }
  const mesh = new THREE.Mesh(makeGeometry(m.positions, m.normals, m.indices, lobe, area), smoothMat);
  mesh.renderOrder = order; parent.add(mesh);
  triangles += m.indices.length / 3;
  return mesh;
}

/* ---------------- state ---------------- */
let state = 'loading', locked = false, built = false;
let labelAt = null, hemiField = null, qGrid = null, qLabels = null;
const player = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, sprint: false };
const keys = Object.create(null);
const touchMove = { x: 0, z: 0, up: false, down: false, sprint: false };
const overrides = new Map();          // region id -> 'hidden' | 'shown'
const undoStack = [];
const hiddenElectrodes = new Set();
let preset = 0, colorMode = 'lobes';
let target = null, card = null;
let blocksMesh = null, blocksBuiltFor = 0;
const electrodes = [];
const SPAWN = { pos: [-235, 40, 75], look: [0, -18, 8] };

/* ---------------- views on the hotbar ---------------- */
const BY = k => A.BY_KEY[k];
const LIMBIC = new Set(['limbic', 'hippocampus', 'amygdala', 'hypothalamus', 'thalamus']);
const BASAL = new Set(['caudate', 'putamen', 'pallidus']);
const HIND = new Set(['midbrain', 'pons', 'medulla', 'cerebellum', 'vermis']);
const ghost = (r, cortex, other) => r.cat === 'head' ? 0 : r.cat === 'cortex' ? cortex : other;
const PRESETS = [
  { name: 'Whole brain', mode: 'lobes', eeg: true, icon: ['frontal_L', 'thalamus_L', 'cerebellum_L', 'scalp'], alpha: () => 1 },
  { name: 'Cerebral lobes', mode: 'lobes', eeg: true, icon: ['frontal_L', 'parietal_L', 'temporal_L', 'occipital_L'], alpha: r => r.cat === 'cortex' ? 1 : r.cat === 'hind' ? 0.3 : 0 },
  { name: 'Functional areas', mode: 'areas', eeg: true, icon: ['motor_L', 'somatosensory_L', 'auditory_L', 'v1_L'], alpha: r => r.cat === 'cortex' ? 1 : r.cat === 'hind' ? 0.3 : 0 },
  { name: 'Deep structures', mode: 'lobes', eeg: false, icon: ['thalamus_L', 'putamen_L', 'hippocampus_L', 'ventricle_L'], alpha: r => r.cat === 'deep' ? 1 : r.cat === 'hind' ? 0.45 : ghost(r, 0.12, 0) },
  { name: 'Limbic system', mode: 'areas', eeg: false, icon: ['limbic_L', 'hippocampus_L', 'amygdala_L', 'hypothalamus'], alpha: r => LIMBIC.has(r.base) ? 1 : r.base === 'callosum' ? 0.5 : ghost(r, 0.08, 0.12) },
  { name: 'Basal ganglia', mode: 'lobes', eeg: false, icon: ['caudate_L', 'putamen_L', 'pallidus_L', 'thalamus_L'], alpha: r => BASAL.has(r.base) ? 1 : r.base === 'thalamus' ? 0.45 : r.base === 'ventricle' ? 0.35 : ghost(r, 0.08, 0.12) },
  { name: 'Brainstem & cerebellum', mode: 'lobes', eeg: false, icon: ['midbrain', 'pons', 'cerebellum_L', 'medulla'], alpha: r => HIND.has(r.base) ? 1 : r.base === 'thalamus' ? 0.4 : ghost(r, 0.1, 0.15) },
  { name: 'EEG 10-20', mode: 'areas', eeg: true, icon: ['#ffd447', '#36d4ff', '#ff6bd5', 'scalp'], alpha: r => r.cat === 'cortex' ? 0.75 : r.cat === 'head' ? 1 : r.cat === 'hind' ? 0.3 : 0.12 },
  { name: 'Left hemisphere', mode: 'lobes', eeg: true, icon: ['frontal_L', 'limbic_L', 'callosum', '#0c111d'], alpha: r => r.side === 'R' || r.cat === 'head' ? 0 : 1 }
];

/* ---------------- visibility ---------------- */
function regionAlpha(r){
  const ov = overrides.get(r.id);
  if (ov === 'hidden') return 0;
  let a = ov === 'shown' ? 1 : PRESETS[preset].alpha(r);
  if (r.kind === 'area' && overrides.get(r.lobe) === 'hidden') a = 0;
  return a;
}
function refreshRegions(){
  for (let i = 1; i < R.length; i++){
    const r = R[i]; r.alpha = regionAlpha(r);
    regionData[i * 4] = r.rgb[0]; regionData[i * 4 + 1] = r.rgb[1]; regionData[i * 4 + 2] = r.rgb[2];
    regionData[i * 4 + 3] = Math.round(clamp(r.alpha * r.alphaBase, 0, 1) * 255);
  }
  regionTex.needsUpdate = true;
  U.uMode.value = colorMode === 'areas' ? 1 : 0;
  refreshEEG(); refreshInventory();
}
const dispId = id => colorMode === 'areas' ? id : R[id].lobe;
const shownFine = id => id > 0 && R[dispId(id)].alpha > 0.3;
const eegOn = () => opt.eeg && PRESETS[preset].eeg;
function refreshEEG(){
  for (const e of electrodes){
    const on = eegOn() && !hiddenElectrodes.has(e.key);
    e.obj.visible = on; e.tag.visible = on && opt.tags && state !== 'title' && state !== 'loading'; e.line.visible = on && opt.lines && !!e.proj;
  }
}
function setOverride(id, v, quiet){
  undoStack.push([id, overrides.get(id)]);
  if (v) overrides.set(id, v); else overrides.delete(id);
  refreshRegions();
  if (!quiet) toast((v === 'hidden' ? 'Hid ' : 'Showing ') + R[id].name + (v === 'hidden' ? '. Z to undo, R to restore all' : ''));
}
function hideRegion(id){ setOverride(id, 'hidden'); }
function isolate(ids){
  const keep = new Set();
  for (const id of ids){ keep.add(id); keep.add(R[id].lobe); }
  overrides.clear();
  for (let i = 1; i < R.length; i++) overrides.set(i, keep.has(i) ? 'shown' : 'hidden');
  undoStack.length = 0; refreshRegions();
  toast('Showing only ' + (ids.length === 1 ? R[ids[0]].name : ids.length + ' regions') + '. R to restore');
}
function restoreAll(){ overrides.clear(); undoStack.length = 0; hiddenElectrodes.clear(); refreshRegions(); toast('All regions restored'); }
function undo(){
  const u = undoStack.pop();
  if (!u) return toast('Nothing to undo');
  if (u[1]) overrides.set(u[0], u[1]); else overrides.delete(u[0]);
  refreshRegions(); toast('Undid: ' + R[u[0]].name);
}
function selectPreset(i, quiet){
  preset = (i + PRESETS.length) % PRESETS.length; colorMode = PRESETS[preset].mode;
  refreshRegions(); refreshHotbar();
  if (!quiet){ const el = $('#itemname'); el.textContent = (preset + 1) + ' · ' + PRESETS[preset].name; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 1600); }
}
function setColorMode(m){ colorMode = m; refreshRegions(); toast(m === 'areas' ? 'Colour: functional areas' : 'Colour: lobes'); }
function setRender(m){
  opt.render = m; saveOpts();
  if (m === 'blocks' && blocksBuiltFor !== opt.block) buildBlocks();
  smoothGroup.visible = m !== 'blocks'; if (blocksMesh) blocksMesh.visible = m === 'blocks';
  toast(m === 'blocks' ? 'Blocks (' + opt.block + ' mm)' : 'Smooth surfaces');
}

/* ---------------- building the world ---------------- */
function progress(p, msg){ $('#loadbar').style.width = Math.round(p * 100) + '%'; if (msg) $('#loadmsg').textContent = msg; }
async function build(){
  const t0 = performance.now();
  const noise = A.makeNoise(20261016);
  const hg = gridFor(A.HEMI_BOX, COARSE ? 1.6 : 1.4);
  const fields = {};
  for (const [S, off, a, b] of [['L', 37.1, 0.02, 0.27], ['R', 0, 0.27, 0.52]]){
    progress(a, 'Shaping the ' + (S === 'L' ? 'left' : 'right') + ' hemisphere…');
    fields[S] = await sampleField((x, y, z) => A.hemiSDF(x, y, z, noise, off), hg, p => progress(a + (b - a) * p));
  }
  hemiField = (S, ax, y, z) => trilinear(fields[S], hg, ax, y, z);
  labelAt = A.makeLabeler(hemiField);

  progress(0.53, 'Folding the cortex…'); await tick();
  for (const S of ['L', 'R']){
    const m = surfaceNets(fields[S], hg);
    addSurface(smoothGroup, m, (x, y, z) => A.cerebralArea(x, y, z), 3, S === 'L');
  }
  progress(0.62, 'Growing the deep structures…'); await tick();
  for (const s of A.BILATERAL){
    const g = gridFor(pad(s.box, 2.5), 0.8), f = await sampleField(s.f, g);
    for (const S of ['L', 'R']) addSurface(smoothGroup, surfaceNets(f, g), () => S === 'L' ? s.idL : s.idR, 1, S === 'L');
  }
  for (const s of A.MIDLINE){
    const b = pad(s.box, 2.5), g = gridFor([-b[3], b[1], b[2], b[3], b[4], b[5]], 0.8);
    addSurface(smoothGroup, surfaceNets(await sampleField((x, y, z) => s.f(Math.abs(x), y, z), g), g), () => s.id, 1);
  }
  progress(0.7, 'Building the brainstem and cerebellum…'); await tick();
  {
    const b = pad(A.BRAINSTEM_BOX, 2.5), g = gridFor([-b[3], b[1], b[2], b[3], b[4], b[5]], 1.0);
    addSurface(smoothGroup, surfaceNets(await sampleField((x, y, z) => A.brainstemSDF(Math.abs(x), y, z), g), g), (x, y, z) => A.brainstemPart(z), 2);
    const c = pad(A.CEREBELLUM_BOX, 2.5), gc = gridFor([-c[3], c[1], c[2], c[3], c[4], c[5]], 1.1);
    addSurface(smoothGroup, surfaceNets(await sampleField((x, y, z) => A.cerebellumSDF(Math.abs(x), y, z), gc), gc), x => A.cerebellumPart(x), 2);
  }
  progress(0.76, 'Mapping every region…'); await tick();
  qGrid = gridFor([-76, -112, -88, 76, 78, 86], 2);
  qLabels = new Uint8Array(qGrid.nx * qGrid.ny * qGrid.nz);
  {
    const sums = new Float64Array(R.length * 4);
    let o = 0, tt = performance.now();
    for (let k = 0; k < qGrid.nz; k++){
      const z = qGrid.z0 + k * qGrid.h;
      for (let j = 0; j < qGrid.ny; j++){
        const y = qGrid.y0 + j * qGrid.h;
        for (let i = 0; i < qGrid.nx; i++, o++){
          const x = qGrid.x0 + i * qGrid.h, L = labelAt(x, y, z);
          qLabels[o] = L;
          if (L){
            for (const id of R[L].lobe !== L ? [L, R[L].lobe] : [L]){ sums[id * 4] += x; sums[id * 4 + 1] += y; sums[id * 4 + 2] += z; sums[id * 4 + 3]++; }
          }
        }
      }
      if (performance.now() - tt > 40){ progress(0.76 + 0.14 * k / qGrid.nz); await tick(); tt = performance.now(); }
    }
    for (let i = 1; i < R.length; i++){
      const n = sums[i * 4 + 3];
      R[i].center = n ? [sums[i * 4] / n, sums[i * 4 + 1] / n, sums[i * 4 + 2] / n] : null;
      R[i].volume = n * 8;
    }
    R[BY('scalp').id].center = [0, -17, 60];
  }
  progress(0.92, 'Fitting the scalp…'); await tick();
  buildHead();
  progress(0.96, 'Placing electrodes…'); await tick();
  buildElectrodes();
  if (opt.render === 'blocks') buildBlocks();
  smoothGroup.visible = opt.render !== 'blocks';
  buildInventory(); buildHotbar(); buildAboutTables();
  selectPreset(0, true);
  built = true;
  console.info('Brain Fly-Through built in ' + Math.round(performance.now() - t0) + ' ms, ' + triangles.toLocaleString() + ' triangles');
  progress(1, 'Ready');
}
const tick = () => new Promise(r => setTimeout(r, 0));
const pad = (b, m) => [b[0] - m, b[1] - m, b[2] - m, b[3] + m, b[4] + m, b[5] + m];

function gridLabel(x, y, z){
  const g = qGrid, i = Math.round((x - g.x0) / g.h), j = Math.round((y - g.y0) / g.h), k = Math.round((z - g.z0) / g.h);
  if (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz) return 0;
  return qLabels[i + j * g.nx + k * g.nx * g.ny];
}

function buildBlocks(){
  const b = opt.block, half = Math.floor(76 / b) * b;
  const g = { x0: -half, y0: -Math.floor(112 / b) * b, z0: -Math.floor(88 / b) * b, h: b };
  g.nx = Math.floor((half * 2) / b) + 1; g.ny = Math.floor((78 - g.y0) / b) + 1; g.nz = Math.floor((86 - g.z0) / b) + 1;
  const lab = new Uint8Array(g.nx * g.ny * g.nz);
  let o = 0;
  for (let k = 0; k < g.nz; k++) for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) lab[o++] = labelAt(g.x0 + i * b, g.y0 + j * b, g.z0 + k * b);
  const emit = (L, M) => {
    if (M === 0) return true;
    if (M === L) return false;
    const a = R[L], c = R[M], ca = A.isCortex(a), cc = A.isCortex(c);
    if (ca && cc) return a.side !== c.side;        // keep the wall between the hemispheres
    return !ca;                                    // deep structures draw their own walls
  };
  const m = voxelMesh(lab, g, emit, id => R[id].lobe);
  if (blocksMesh){ mni.remove(blocksMesh); blocksMesh.geometry.dispose(); }
  blocksMesh = new THREE.Mesh(makeGeometry(m.positions, m.normals, m.indices, m.lobe, m.area, m.uvs), blockMat);
  blocksMesh.renderOrder = 2; blocksMesh.visible = opt.render === 'blocks';
  mni.add(blocksMesh);
  U.uPix.value = 8 / b; blocksBuiltFor = b;
}

function buildHead(){
  const C = A.HEAD_CENTER, NU = 128, NV = 72, TMAX = 132 / 180 * Math.PI;
  const pos = [], idx = [];
  for (let v = 0; v <= NV; v++){
    const th = TMAX * v / NV;
    for (let u = 0; u <= NU; u++){
      const ph = 2 * Math.PI * u / NU, d = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
      const r = A.scalpRadius(d[0], d[1], d[2]);
      pos.push(C[0] + d[0] * r, C[1] + d[1] * r, C[2] + d[2] * r);
    }
  }
  for (let v = 0; v < NV; v++) for (let u = 0; u < NU; u++){
    const a = v * (NU + 1) + u, b = a + NU + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const scalp = new THREE.BufferGeometry();
  scalp.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); scalp.setIndex(idx); scalp.computeVertexNormals();
  const parts = [scalp];
  // ears (for the ear clips) and a nose (so front and back are obvious)
  for (const sx of [-1, 1]){
    const ear = new THREE.SphereGeometry(1, 24, 16);
    ear.applyMatrix4(new THREE.Matrix4().makeScale(5, 14, 30));
    ear.applyMatrix4(new THREE.Matrix4().makeRotationX(-0.25));
    ear.applyMatrix4(new THREE.Matrix4().makeTranslation(sx * 89, -29, -44));
    parts.push(ear);
  }
  const nose = new THREE.SphereGeometry(1, 24, 16);
  nose.applyMatrix4(new THREE.Matrix4().makeScale(10, 13, 19));
  nose.applyMatrix4(new THREE.Matrix4().makeRotationX(0.35));
  nose.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 94, -57));
  parts.push(nose);
  const id = BY('scalp').id;
  for (const g of parts){
    const n = g.attributes.position.count, lab = new Float32Array(n).fill(id);
    g.setAttribute('aLobe', new THREE.BufferAttribute(lab, 1)); g.setAttribute('aArea', new THREE.BufferAttribute(lab.slice(), 1));
    const mesh = new THREE.Mesh(g, smoothMat); mesh.renderOrder = 4; headGroup.add(mesh);
    triangles += (g.index ? g.index.count : n) / 3;
  }
}
function insideHead(m){
  const C = A.HEAD_CENTER, d = [m[0] - C[0], m[1] - C[1], m[2] - C[2]], r = Math.hypot(...d);
  if (r < 1) return true;
  const th = Math.acos(clamp(d[2] / r, -1, 1));
  return th < 132 / 180 * Math.PI && r < A.scalpRadius(d[0] / r, d[1] / r, d[2] / r);
}

function makeTag(text, color){
  const c = document.createElement('canvas'), ctx = c.getContext('2d'), font = '46px "VT323", monospace';
  ctx.font = font; const w = Math.ceil(ctx.measureText(text).width) + 26;
  c.width = w; c.height = 56;
  ctx.font = font; ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, w, 56);
  ctx.fillStyle = '#2b2b2b'; ctx.fillText(text, 16, 44); ctx.fillStyle = color; ctx.fillText(text, 13, 41);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true }));
  s.scale.set(0.042 * w / 56, 0.042, 1); s.renderOrder = 20;
  return s;
}
function march(p, shiftX){
  // step from p toward the middle of the brain until the first brain region
  const c = A.BRAIN_CENTER, d = [c[0] - p[0], c[1] - p[1], c[2] - p[2]], n = Math.hypot(...d);
  for (let t = 0; t < 160; t += 0.5){
    const x = p[0] + d[0] / n * t + shiftX, y = p[1] + d[1] / n * t, z = p[2] + d[2] / n * t;
    const L = gridLabel(x, y, z);
    if (L) return { point: [x, y, z], id: L, depth: t };
  }
  return null;
}
function nearestBrain(p){
  // closest brain voxel to p (2 mm grid), searched outward in shells
  const g = qGrid;
  for (let r = 2; r <= 90; r += 2){
    let best = null;
    for (let x = p[0] - r; x <= p[0] + r; x += 2) for (let y = p[1] - r; y <= p[1] + r; y += 2) for (let z = p[2] - r; z <= p[2] + r; z += 2){
      const L = gridLabel(x, y, z);
      if (!L) continue;
      const d = Math.hypot(x - p[0], y - p[1], z - p[2]);
      if (d <= r && (!best || d < best.depth)) best = { point: [x, y, z], id: L, depth: d };
    }
    if (best) return best;
    if (r > 6) r += 2;
  }
  return null;
}
function project(e){
  if (e.kind !== 'active'){
    // references: the brain point nearest to the reference site
    const h = nearestBrain(e.pos);
    return h && { point: h.point, ids: [h.id], depth: h.depth, nearest: true };
  }
  if (Math.abs(e.pos[0]) < 5){
    // midline electrodes sit over the longitudinal fissure: report the cortex on each side
    const l = march(e.pos, -3.5), r = march(e.pos, 3.5), hits = [l, r].filter(Boolean);
    if (!hits.length) return null;
    const near = hits.reduce((a, b) => a.depth <= b.depth ? a : b);
    return { point: [near.point[0] - (near === l ? -3.5 : 3.5), near.point[1], near.point[2]], ids: hits.map(h => h.id), depth: near.depth };
  }
  const h = march(e.pos, 0);
  return h && { point: h.point, ids: [h.id], depth: h.depth };
}
function beneathText(e){
  if (!e.proj) return 'no brain region found';
  const ids = e.proj.ids;
  if (ids.length === 2 && R[ids[0]].base === R[ids[1]].base) return 'Left and right ' + lowerFirst(R[ids[0]].name.replace(/^Left /, ''));
  return ids.map(id => R[id].name).join(' / ');
}
const beneathLabel = e => e.proj && e.proj.nearest ? 'Nearest brain region' : 'Under it in this model';
const depthText = e => e.proj ? Math.round(e.proj.depth) + ' mm ' + (e.proj.nearest ? 'away' : 'below the scalp') : '';
const lowerFirst = s => s.charAt(0).toLowerCase() + s.slice(1);
const lobeName = id => R[R[id].lobe].name;
function buildElectrodes(){
  const C = new THREE.Vector3(...A.HEAD_CENTER);
  for (const e of A.ELECTRODES){
    const kind = A.ELECTRODE_KIND[e.kind], col = new THREE.Color(kind.color);
    const mat = new THREE.MeshLambertMaterial({ color: col, emissive: col.clone().multiplyScalar(0.35) });
    const p = new THREE.Vector3(...e.pos), n = p.clone().sub(C).normalize();
    const obj = new THREE.Group();
    if (e.kind === 'ear'){
      // a clip: two pads pinching the earlobe, joined by a spring at the top
      const pad = new THREE.BoxGeometry(1.8, 9, 7), clip = new THREE.Group();
      const a = new THREE.Mesh(pad, mat), b = new THREE.Mesh(pad, mat), spring = new THREE.Mesh(new THREE.BoxGeometry(10, 2.4, 2.4), mat);
      a.position.set(-4, 0, 0); b.position.set(4, 0, 0); spring.position.set(0, 0, 4.8);
      clip.add(a, b, spring); clip.position.copy(p); obj.add(clip);
    } else {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 2.6, 24), mat);
      disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      disc.position.copy(p).addScaledVector(n, 0.8);
      obj.add(disc);
    }
    const hit = new THREE.Mesh(new THREE.SphereGeometry(7, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.copy(p); hit.userData.electrode = e; obj.add(hit);
    eegGroup.add(obj);
    const tag = makeTag(e.key, kind.color); tag.position.copy(p).addScaledVector(n, 12); eegGroup.add(tag);
    const ent = { ...e, kindInfo: kind, obj, tag, hit, n: n.toArray(), proj: project(e) };
    const lineGeo = new THREE.BufferGeometry().setFromPoints([p, ent.proj ? new THREE.Vector3(...ent.proj.point) : p]);
    ent.line = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: col, dashSize: 2.5, gapSize: 1.8 }));
    ent.line.computeLineDistances();
    if (ent.proj){
      const dot = new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 8), new THREE.MeshBasicMaterial({ color: col }));
      dot.position.set(...ent.proj.point); ent.line.add(dot);
    }
    eegGroup.add(ent.line);
    electrodes.push(ent);
  }
}

/* ---------------- what is under the crosshair ---------------- */
const raycaster = new THREE.Raycaster();
const centerNDC = new THREE.Vector2(0, 0);
function computeTarget(){
  raycaster.setFromCamera(centerNDC, camera);
  let best = null;
  const picks = electrodes.filter(e => e.obj.visible).map(e => e.hit);
  const hits = raycaster.intersectObjects(picks, false);
  if (hits.length) best = { type: 'electrode', e: electrodes.find(x => x.hit === hits[0].object), dist: hits[0].distance };
  const o = toMNI(camera.position), dv = new THREE.Vector3(); camera.getWorldDirection(dv);
  const d = toMNI(dv), max = best ? best.dist : 700;
  let prev = shownFine(gridLabel(o[0], o[1], o[2])) ? gridLabel(o[0], o[1], o[2]) : 0;
  for (let t = 0.8; t < max; t += 0.8){
    const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
    let L = gridLabel(x, y, z); if (!shownFine(L)) L = 0;
    if (L === prev) continue;
    let hit = 0;
    if (L === 0) hit = prev;
    else if (prev === 0) hit = L;
    else {
      const a = R[prev], b = R[L], ca = A.isCortex(a), cb = A.isCortex(b);
      hit = ca && cb ? (a.side !== b.side ? L : 0) : cb ? 0 : L;
    }
    prev = L;
    if (hit) return { type: 'region', id: dispId(hit), fine: hit, dist: t };
  }
  return best;
}
function targetLabel(t){
  if (!t) return '';
  if (t.type === 'electrode') return t.e.key + ' · ' + t.e.kindInfo.role.toLowerCase() + '<small>' + t.e.where + ' · ' + Math.round(t.dist) + ' mm</small>';
  const r = R[t.id], sub = r.kind === 'area' ? lobeName(t.id) : r.cat === 'deep' ? 'deep structure' : r.cat === 'hind' ? 'hindbrain' : r.cat === 'head' ? 'head' : 'cortex';
  return r.name + '<small>' + sub + ' · ' + Math.round(t.dist) + ' mm</small>';
}

function insideText(m){
  const L = labelAt(m[0], m[1], m[2]);
  if (L){
    const r = R[L];
    if (A.isCortex(r) && r.base !== 'medial'){
      const depth = -hemiField(m[0] < 0 ? 'L' : 'R', Math.abs(m[0]), m[1], m[2]);
      const area = r.kind === 'area' ? r.name.replace(/^(Left|Right) /, '') : '';
      if (depth < 3.5) return lobeName(L) + (area ? ' · ' + area : '') + ' (cortex)';
      return lobeName(L) + ' · white matter, ' + Math.round(depth) + ' mm under the surface';
    }
    return r.name;
  }
  if (!insideHead(m)) return 'Outside the head';
  if (Math.abs(m[0]) < 2.4 && m[2] > 0 && Math.min(hemiField('L', Math.abs(m[0]), m[1], m[2]), hemiField('R', Math.abs(m[0]), m[1], m[2])) < 4) return 'Longitudinal fissure, between the hemispheres';
  if (Math.abs(m[0]) > 33 && m[1] > -46 && m[1] < 30 && Math.abs(m[2] - A.sylvianZ(m[1])) < 4) return 'Lateral (Sylvian) fissure';
  return 'Between scalp and brain (skull and CSF are not drawn)';
}
function facing(){
  const d = new THREE.Vector3(); camera.getWorldDirection(d);
  const m = toMNI(d), ax = m.map(Math.abs), i = ax.indexOf(Math.max(...ax));
  return [['right (+x)', 'left (-x)'], ['anterior (+y)', 'posterior (-y)'], ['superior (+z)', 'inferior (-z)']][i][m[i] > 0 ? 0 : 1];
}

/* ---------------- HUD ---------------- */
let lastInside = 0, lastDebug = 0, fps = 0, frames = 0, fpsT = 0;
const tagPos = new THREE.Vector3();
function updateHUD(now){
  target = computeTarget();
  U.uHighlight.value = target && target.type === 'region' ? target.id : -1;
  // tags on the far side of the head fade so the near ones stay readable
  const mc = toThree(...A.BRAIN_CENTER), dc = camera.position.distanceTo(mc);
  for (const e of electrodes){
    const far = camera.position.distanceTo(e.tag.getWorldPosition(tagPos)) > dc + 25;
    e.tag.material.opacity = target && target.e === e ? 1 : far ? 0.35 : 0.9;
    e.tag.renderOrder = far ? 19 : 21;
  }
  $('#target').innerHTML = targetLabel(target);
  const m = toMNI(camera.position);
  if (now - lastInside > 120){
    lastInside = now;
    $('#inside').textContent = insideText(m);
    $('#coords').textContent = 'x ' + fmt(m[0]) + '  y ' + fmt(m[1]) + '  z ' + fmt(m[2]) + ' mm';
    $('#coords').hidden = !opt.coords;
  }
  drawCompass();
  frames++; if (now - fpsT > 1000){ fps = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; }
  if (!$('#debug').hidden && now - lastDebug > 200){
    lastDebug = now;
    const b = opt.block, yawD = ((player.yaw * 180 / Math.PI) % 360 + 360) % 360;
    const lines = [
      'Brain Fly-Through · three.js r' + THREE.REVISION, fps + ' fps',
      'XYZ (MNI mm): ' + fmt(m[0]) + ' / ' + fmt(m[1]) + ' / ' + fmt(m[2]),
      'Block (' + b + ' mm): ' + Math.round(m[0] / b) + ' ' + Math.round(m[1] / b) + ' ' + Math.round(m[2] / b),
      'Facing: ' + facing() + '  yaw ' + yawD.toFixed(1) + '°  pitch ' + (player.pitch * 180 / Math.PI).toFixed(1) + '°',
      'Speed: ' + Math.round(player.vel.length()) + ' mm/s' + (player.sprint ? ' (sprinting)' : ''),
      'Inside: ' + insideText(m),
      'Looking at: ' + (target ? targetLabel(target).replace(/<small>/, ' (').replace(/<\/small>/, ')') : 'nothing'),
      'View: ' + PRESETS[preset].name + ' · colour by ' + colorMode + ' · ' + opt.render + ' · opacity ' + Math.round(opt.opacity * 100) + '%',
      'Triangles: ' + triangles.toLocaleString() + (blocksMesh ? ' + blocks ' + (blocksMesh.geometry.index.count / 3).toLocaleString() : '')
    ];
    $('#debug').innerHTML = lines.map(l => '<span>' + l.replace(/</g, '&lt;').replace(/&lt;small&gt;/g, '') + '</span>').join('\n');
  }
}
const cmp = $('#compass').getContext('2d');
function drawCompass(){
  const w = 260, h = 26, yaw = player.yaw * 180 / Math.PI;
  cmp.clearRect(0, 0, w, h);
  cmp.fillStyle = 'rgba(0,0,0,.35)'; cmp.fillRect(0, 0, w, h);
  cmp.font = '19px "VT323", monospace'; cmp.textAlign = 'center'; cmp.textBaseline = 'middle';
  const marks = [[0, 'A'], [90, 'L'], [180, 'P'], [270, 'R']];
  for (let a = 0; a < 360; a += 15){
    let rel = ((a - yaw) % 360 + 540) % 360 - 180;
    if (Math.abs(rel) > 75) continue;
    const x = w / 2 - rel * 1.6, mk = marks.find(q => q[0] === a);
    if (mk){ cmp.fillStyle = '#2b2b2b'; cmp.fillText(mk[1], x + 1.5, h / 2 + 1.5); cmp.fillStyle = mk[1] === 'A' ? '#ffef5a' : '#fff'; cmp.fillText(mk[1], x, h / 2); }
    else { cmp.fillStyle = 'rgba(255,255,255,.55)'; cmp.fillRect(x - 1, 9, 2, 8); }
  }
  cmp.fillStyle = '#fff'; cmp.fillRect(w / 2 - 1, 0, 2, 5);
}
function toast(msg){
  const el = $('#toast'); el.textContent = msg; el.classList.add('on');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2200);
}

/* ---------------- info card ---------------- */
function cardFor(t){
  if (!t) return null;
  if (t.type === 'electrode'){
    const e = t.e, p = e.proj;
    return `<h3><span class="chip" style="background:${e.kindInfo.color};border-radius:50%"></span>${e.key}</h3>
      <p class="sub">${e.kindInfo.role} · ${e.where}</p><p>${e.info}</p>
      <p class="k">Position: x ${fmt(e.pos[0])}, y ${fmt(e.pos[1])}, z ${fmt(e.pos[2])} mm (MNI)</p>
      <p class="k">${beneathLabel(e)}: ${beneathText(e)}${p ? ', ' + depthText(e) : ''}</p>`;
  }
  const r = R[t.id], c = r.center;
  const under = electrodes.filter(e => e.proj && e.proj.ids.some(id => id === r.id || R[id].lobe === r.id)).map(e => e.key);
  const sub = r.kind === 'area' ? lobeName(r.id) + ' · functional area' : r.cat === 'cortex' ? 'Cerebral cortex' : r.cat === 'deep' ? 'Deep structure' : r.cat === 'hind' ? 'Brainstem and cerebellum' : 'Head';
  return `<h3><span class="chip" style="background:${r.color}"></span>${r.name}</h3><p class="sub">${sub}</p><p>${r.info}</p>
    ${c ? `<p class="k">Centre in this model: x ${fmt(c[0])}, y ${fmt(c[1])}, z ${fmt(c[2])} mm (MNI)</p>` : ''}
    ${under.length ? `<p class="k">Electrodes over it: ${under.join(', ')}</p>` : ''}`;
}
function showCard(t){
  const el = $('#card');
  if (!t){ el.hidden = true; card = null; return; }
  const key = t.type === 'electrode' ? 'e:' + t.e.key : 'r:' + t.id;
  if (card === key){ el.hidden = true; card = null; return; }
  card = key; el.innerHTML = '<button aria-label="Close">×</button>' + cardFor(t); el.hidden = false;
  el.querySelector('button').onclick = () => { el.hidden = true; card = null; };
}

/* ---------------- actions on the target ---------------- */
function breakTarget(){
  const t = target;
  if (!t) return;
  if (t.type === 'electrode') return showCard(t);
  hideRegion(t.id);
}
function isolateTarget(){ if (target && target.type === 'region') isolate([target.id]); }

/* ---------------- teleporting ---------------- */
function setView(pos, look){
  player.pos.copy(toThree(...pos));
  const d = toThree(...look).sub(player.pos).normalize();
  player.yaw = Math.atan2(-d.x, -d.z); player.pitch = Math.asin(clamp(d.y, -1, 1)); player.vel.set(0, 0, 0);
}
function tpRegion(id){
  const c = R[id].center; if (!c) return false;
  const b = A.BRAIN_CENTER; let d = [c[0] - b[0], c[1] - b[1], c[2] - b[2]], n = Math.hypot(...d);
  if (n < 5){ d = [-1, 0.2, 0.3]; n = Math.hypot(...d); }
  const dist = R[id].cat === 'cortex' && R[id].kind === 'lobe' ? 95 : 55;
  setView([c[0] + d[0] / n * dist, c[1] + d[1] / n * dist, c[2] + d[2] / n * dist + 8], c);
  return true;
}
function tpElectrode(e){ setView([e.pos[0] + e.n[0] * 55, e.pos[1] + e.n[1] * 55, e.pos[2] + e.n[2] * 55], e.pos); }
function respawn(){ setView(SPAWN.pos, SPAWN.look); }

/* ---------------- states and screens ---------------- */
const SCREENS = ['s-title', 's-pause', 's-options', 's-controls', 's-inv'];
let returnTo = 's-title';
function show(id){ for (const s of SCREENS) $('#' + s).hidden = s !== id; }
function setState(s){
  state = s;
  const playing = s === 'play' || s === 'chat';
  $('#hud').hidden = !(playing || s === 'inv' || s === 'pause') || hudHidden;
  $('#touch').hidden = !(COARSE && s === 'play');
  $('#chatbox').classList.toggle('open', s === 'chat');
  $('#chatform').hidden = s !== 'chat';
  if (s === 'play' || s === 'chat') show(null);
  if (s !== 'play') for (const k in keys) keys[k] = false;
  if (built) refreshEEG();
}
let hudHidden = false;
function lock(){
  if (COARSE){ setState('play'); return; }
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => { setState('pause'); show('s-pause'); toast('Click "Back to brain" to keep flying'); });
  } catch (e) { setState('pause'); show('s-pause'); }
}
function play(){
  if (!built) return;
  if (state === 'title'){ if (linkView) setView(linkView.pos, linkView.look); else respawn(); }
  if (COARSE) setState('play'); else lock();
}
/* a view can be opened from a link: #at=x,y,z&look=x,y,z&view=1-9&color=areas&render=blocks (MNI mm) */
const HASH = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
const triple = s => { const v = (s || '').split(',').map(Number); return v.length === 3 && v.every(Number.isFinite) ? v : null; };
const linkView = triple(HASH.at) ? { pos: triple(HASH.at), look: triple(HASH.look) || A.BRAIN_CENTER } : null;
function applyLink(){
  if (+HASH.view >= 1 && +HASH.view <= 9) selectPreset(+HASH.view - 1, true);
  if (HASH.color === 'areas' || HASH.color === 'lobes'){ colorMode = HASH.color; refreshRegions(); }
  if (HASH.render === 'blocks' || HASH.render === 'smooth'){ opt.render = HASH.render; if (HASH.render === 'blocks') buildBlocks(); smoothGroup.visible = HASH.render !== 'blocks'; if (blocksMesh) blocksMesh.visible = HASH.render === 'blocks'; }
  if (HASH.debug){ $('#debug').hidden = false; $('#where').hidden = true; }
  if (HASH.shot && linkView){ setView(linkView.pos, linkView.look); setState('pause'); show(null); }
}
function shareLink(){
  const m = toMNI(player.pos), d = new THREE.Vector3(); camera.getWorldDirection(d);
  const l = toMNI(d.multiplyScalar(100).add(player.pos)), r1 = v => v.map(x => Math.round(x)).join(',');
  return location.origin + location.pathname + '#at=' + r1(m) + '&look=' + r1(l) + '&view=' + (preset + 1) + '&color=' + colorMode + '&render=' + opt.render;
}
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked){ setState('play'); }
  else if (state === 'play'){ setState('pause'); show('s-pause'); }
});
document.addEventListener('pointerlockerror', () => { if (state !== 'play'){ setState('pause'); show('s-pause'); } });
$('#b-play').onclick = play;
$('#b-resume').onclick = () => play();
$('#b-restore').onclick = () => { restoreAll(); };
$('#b-respawn').onclick = () => { respawn(); play(); };
for (const b of document.querySelectorAll('[data-open]')) b.onclick = () => {
  returnTo = state === 'title' ? 's-title' : 's-pause';
  if (b.dataset.open === 's-options') buildOptions();
  show(b.dataset.open); state = b.dataset.open === 's-options' ? 'options' : 'controls';
};
for (const b of document.querySelectorAll('[data-back]')) b.onclick = back;
function back(){ show(returnTo); state = returnTo === 's-title' ? 'title' : 'pause'; }
for (const a of document.querySelectorAll('.screen a[href="#about"]')) a.addEventListener('click', () => { if (state !== 'title') { show('s-pause'); state = 'pause'; } });

/* ---------------- options screen ---------------- */
const OPTION_ROWS = [
  { k: 'opacity', label: v => 'Opacity: ' + Math.round(v * 100) + '%', min: 0.1, max: 1, step: 0.05, apply: v => { U.uOpacity.value = v; } },
  { k: 'speed', label: v => 'Fly speed: ' + v + ' mm/s', min: 5, max: 150, step: 5 },
  { k: 'fov', label: v => 'FOV: ' + v + '°', min: 40, max: 110, step: 1, apply: v => { camera.fov = v; camera.updateProjectionMatrix(); } },
  { k: 'sens', label: v => 'Sensitivity: ' + Math.round(v * 100) + '%', min: 0.2, max: 3, step: 0.05 },
  { k: 'render', cycle: ['smooth', 'blocks'], label: v => 'Surfaces: ' + (v === 'blocks' ? 'Blocks' : 'Smooth'), apply: v => setRender(v) },
  { k: 'block', cycle: [2, 3, 4], label: v => 'Block size: ' + v + ' mm', apply: () => { if (opt.render === 'blocks') buildBlocks(); else blocksBuiltFor = 0; } },
  { k: 'eeg', cycle: [true, false], label: v => 'Electrodes: ' + (v ? 'ON' : 'OFF'), apply: refreshEEG },
  { k: 'tags', cycle: [true, false], label: v => 'Name tags: ' + (v ? 'ON' : 'OFF'), apply: refreshEEG },
  { k: 'lines', cycle: [true, false], label: v => 'Lines to cortex: ' + (v ? 'ON' : 'OFF'), apply: refreshEEG },
  { k: 'coords', cycle: [true, false], label: v => 'Coordinates: ' + (v ? 'ON' : 'OFF') },
  { k: 'grid', cycle: [true, false], label: v => 'Floor grid: ' + (v ? 'ON' : 'OFF'), apply: v => { grid.visible = v; } },
  { k: 'invert', cycle: [false, true], label: v => 'Invert mouse: ' + (v ? 'ON' : 'OFF') },
  { k: 'flyLook', cycle: [false, true], label: v => 'Fly where you look: ' + (v ? 'ON' : 'OFF') }
];
function buildOptions(){
  const box = $('#opts'); box.innerHTML = '';
  for (const row of OPTION_ROWS){
    if (row.cycle){
      const b = document.createElement('button'); b.className = 'mc'; b.textContent = row.label(opt[row.k]);
      b.onclick = () => { const c = row.cycle, i = c.indexOf(opt[row.k]); opt[row.k] = c[(i + 1) % c.length]; saveOpts(); if (row.apply) row.apply(opt[row.k]); b.textContent = row.label(opt[row.k]); };
      box.appendChild(b);
    } else {
      const wrap = document.createElement('label'); wrap.className = 'slider';
      wrap.innerHTML = `<input type="range" min="${row.min}" max="${row.max}" step="${row.step}" value="${opt[row.k]}" aria-label="${row.k}"><i class="knob"></i><span></span>`;
      const inp = wrap.querySelector('input'), span = wrap.querySelector('span'), knob = wrap.querySelector('.knob');
      const upd = () => { const v = +inp.value; opt[row.k] = v; span.textContent = row.label(v); knob.style.left = 'calc(' + ((v - row.min) / (row.max - row.min) * 100) + '% - ' + ((v - row.min) / (row.max - row.min) * 12) + 'px)'; if (row.apply) row.apply(v); };
      inp.oninput = () => { upd(); saveOpts(); }; upd();
      box.appendChild(wrap);
    }
  }
}
const CONTROLS = [
  ['W A S D', 'Move (level, like creative flight)'], ['Space / Shift', 'Fly up / down'], ['Double-tap W', 'Sprint (2.2× speed)'], ['+ / −', 'Change fly speed'],
  ['Mouse', 'Look around'], ['Left click', 'Hide the region under the crosshair'], ['Right click', 'Info card for what is under the crosshair'],
  ['Middle click', 'Show only that region'], ['Z / R', 'Undo last hide / restore everything'], ['1–9, wheel', 'Views (hotbar)'],
  ['E', 'Inventory: every region, show/hide, fly there'], ['T or /', 'Chat and commands (/tp C3, /hide frontal …)'],
  ['B', 'Block or smooth surfaces'], ['V', 'Colour by lobes or functional areas'], ['L', 'Electrode name tags'],
  ['F3 or G', 'Debug screen (coordinates, facing)'], ['F1 or H', 'Hide the HUD'], ['F2 or P', 'Save a screenshot'], ['Esc', 'Pause menu']
];
function buildControls(){
  $('#keys').innerHTML = CONTROLS.map(([k, v]) => `<div><b>${k}</b><span>${v}</span></div>`).join('');
  $('#ctable').innerHTML = '<tr><th>Key</th><th>Action</th></tr>' + CONTROLS.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('');
}
buildControls();

/* ---------------- hotbar ---------------- */
function iconHTML(list){ return '<span class="icon">' + list.map(k => `<i style="background:${k.startsWith('#') ? k : BY(k).color}"></i>`).join('') + '</span>'; }
function buildHotbar(){
  $('#hotbar').innerHTML = PRESETS.map((p, i) => `<button data-i="${i}" title="${i + 1}: ${p.name}">${iconHTML(p.icon)}<span class="n">${i + 1}</span></button>`).join('');
  for (const b of $('#hotbar').children) b.addEventListener('click', e => { e.stopPropagation(); selectPreset(+b.dataset.i); });
}
function refreshHotbar(){ for (const b of $('#hotbar').children) b.classList.toggle('sel', +b.dataset.i === preset); }

/* ---------------- inventory ---------------- */
const INV_GROUPS = [
  ['Cerebral lobes', r => r.cat === 'cortex' && r.kind === 'lobe'],
  ['Functional areas', r => r.kind === 'area'],
  ['Deep structures', r => r.cat === 'deep'],
  ['Brainstem and cerebellum', r => r.cat === 'hind'],
  ['Head', r => r.cat === 'head']
];
function buildInventory(){
  let html = '';
  for (const [title, test] of INV_GROUPS){
    html += `<h3>${title}</h3><div class="slots">` + R.filter(r => r && test(r)).map(r =>
      `<button class="slot" data-id="${r.id}" data-q="${r.name.toLowerCase()} ${r.base}"><span class="cube" style="--c:${r.color}"></span><span class="s">${r.side === 'M' ? '' : r.side}</span></button>`).join('') + '</div>';
  }
  html += '<h3>EEG electrodes</h3><div class="slots">' + electrodes.map(e =>
    `<button class="slot el" data-el="${e.key}" data-q="${e.key.toLowerCase()} ${e.where} ${e.kindInfo.role.toLowerCase()}"><span class="cube" style="--c:${e.kindInfo.color}"></span><span class="s">${e.key}</span></button>`).join('') + '</div>';
  const body = $('#invbody'); body.innerHTML = html;
  for (const b of body.querySelectorAll('.slot')){
    b.addEventListener('click', ev => invClick(b, ev.shiftKey));
    b.addEventListener('contextmenu', ev => { ev.preventDefault(); invFly(b); });
    b.addEventListener('mouseenter', () => showTip(b));
    b.addEventListener('mousemove', ev => moveTip(ev));
    b.addEventListener('mouseleave', hideTip);
    b.addEventListener('focus', () => showTip(b));
    b.addEventListener('blur', hideTip);
  }
  $('#invq').addEventListener('input', () => {
    const q = $('#invq').value.trim().toLowerCase();
    for (const b of body.querySelectorAll('.slot')) b.hidden = !!q && !b.dataset.q.includes(q);
  });
}
function invClick(b, shift){
  if (b.dataset.el){
    const k = b.dataset.el;
    if (hiddenElectrodes.has(k)) hiddenElectrodes.delete(k); else hiddenElectrodes.add(k);
    refreshEEG(); refreshInventory(); return;
  }
  const id = +b.dataset.id, r = R[id];
  if (shift) return isolate([id]);
  if (r.kind === 'area' && colorMode !== 'areas') setColorMode('areas');
  const vis = r.alpha > 0.02 && !(r.kind === 'area' && overrides.get(r.lobe) === 'hidden');
  setOverride(id, vis ? 'hidden' : 'shown', true);
  showTip(b);
}
function invFly(b){
  if (b.dataset.el) tpElectrode(electrodes.find(e => e.key === b.dataset.el)); else tpRegion(+b.dataset.id);
  hideTip(); closeInventory();
}
function refreshInventory(){
  for (const b of document.querySelectorAll('#invbody .slot')){
    if (b.dataset.el) b.classList.toggle('off', hiddenElectrodes.has(b.dataset.el) || !eegOn());
    else { const r = R[+b.dataset.id]; b.classList.toggle('off', !(r.alpha > 0.02) || (r.kind === 'area' && overrides.get(r.lobe) === 'hidden')); }
  }
}
function showTip(b){
  const tip = $('#tip');
  if (b.dataset.el){
    const e = electrodes.find(x => x.key === b.dataset.el);
    tip.innerHTML = `<b style="color:${e.kindInfo.color}">${e.key}</b><div class="g">${e.kindInfo.role} · ${e.where}</div>${e.info}<div class="g">${beneathLabel(e)}: ${beneathText(e)}${e.proj ? ', ' + depthText(e) : ''}</div><div class="h">Click: show / hide · Right-click: fly there</div>`;
  } else {
    const r = R[+b.dataset.id];
    const g = r.kind === 'area' ? lobeName(r.id) : r.cat === 'cortex' ? 'Cerebral lobe' : r.cat === 'deep' ? 'Deep structure' : r.cat === 'hind' ? 'Brainstem and cerebellum' : 'Head';
    tip.innerHTML = `<b>${r.name}</b><div class="g">${g}${r.alpha > 0.02 ? '' : ' · hidden'}</div>${r.info}<div class="h">Click: show / hide · Shift-click: only this · Right-click: fly there</div>`;
  }
  tip.hidden = false;
  const rc = b.getBoundingClientRect(), gr = $('#game').getBoundingClientRect();
  placeTip(rc.right - gr.left + 6, rc.top - gr.top);
}
function moveTip(ev){ const gr = $('#game').getBoundingClientRect(); placeTip(ev.clientX - gr.left + 14, ev.clientY - gr.top + 10); }
function placeTip(x, y){
  const tip = $('#tip'), gw = $('#game').clientWidth, gh = $('#game').clientHeight;
  tip.style.left = Math.max(4, Math.min(x, gw - tip.offsetWidth - 4)) + 'px';
  tip.style.top = Math.max(4, Math.min(y, gh - tip.offsetHeight - 4)) + 'px';
}
function hideTip(){ $('#tip').hidden = true; }
function openInventory(){
  setState('inv'); show('s-inv'); refreshInventory();
  if (document.pointerLockElement) document.exitPointerLock();
  setTimeout(() => { if (!COARSE) $('#invq').focus(); }, 0);
}
function closeInventory(){ hideTip(); $('#invq').blur(); show(null); if (COARSE) setState('play'); else { setState('pause'); lock(); } }

/* ---------------- chat and commands ---------------- */
const chatHistory = [];
let histPos = -1;
function chat(msg, cls){
  const log = $('#chatlog'), d = document.createElement('div');
  d.textContent = msg; if (cls) d.className = cls;
  log.appendChild(d);
  while (log.children.length > 14) log.firstChild.remove();
  setTimeout(() => d.classList.add('old'), 9000);
}
function openChat(prefix){
  setState('chat'); const inp = $('#chatin'); inp.value = prefix; histPos = -1;
  for (const d of $('#chatlog').children) d.classList.remove('old');
  if (document.pointerLockElement) document.exitPointerLock();
  setTimeout(() => { inp.focus(); inp.setSelectionRange(prefix.length, prefix.length); }, 0);
}
function closeChat(){
  $('#chatin').blur();
  for (const d of $('#chatlog').children) d.classList.add('old');
  if (COARSE) setState('play'); else { setState('pause'); lock(); }
}
$('#chatform').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('#chatin').value.trim();
  if (v){ chatHistory.unshift(v); run(v); }
  closeChat();
});
$('#chatin').addEventListener('keydown', e => {
  if (e.key === 'Escape'){ e.preventDefault(); closeChat(); }
  else if (e.key === 'Tab'){ e.preventDefault(); complete(); }
  else if (e.key === 'ArrowUp' && chatHistory.length){ e.preventDefault(); histPos = Math.min(histPos + 1, chatHistory.length - 1); $('#chatin').value = chatHistory[histPos]; }
  else if (e.key === 'ArrowDown'){ e.preventDefault(); histPos = Math.max(histPos - 1, -1); $('#chatin').value = histPos < 0 ? '' : chatHistory[histPos]; }
  e.stopPropagation();
});
const GROUPS = {
  all: r => true, cortex: r => r.cat === 'cortex', lobes: r => r.cat === 'cortex' && r.kind === 'lobe', areas: r => r.kind === 'area',
  deep: r => r.cat === 'deep', hindbrain: r => r.cat === 'hind', left: r => r.side === 'L', right: r => r.side === 'R',
  limbic_system: r => LIMBIC.has(r.base), basal_ganglia: r => BASAL.has(r.base)
};
const norm = s => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
function resolve(q){
  q = norm(q);
  if (!q) return null;
  const el = electrodes.find(e => e.key.toLowerCase() === q);
  if (el) return { electrodes: [el], regions: [] };
  if (q === 'electrodes' || q === 'eeg') return { electrodes: electrodes.slice(), regions: [] };
  if (q === 'scalp' || q === 'head') return { electrodes: [], regions: [BY('scalp').id] };
  if (GROUPS[q]) return { electrodes: [], regions: R.filter(r => r && GROUPS[q](r) && r.cat !== 'head').map(r => r.id) };
  let hits = R.filter(r => r && r.token === q);
  if (!hits.length) hits = R.filter(r => r && (r.base === q || r.token.replace(/^(left|right)_/, '') === q));
  if (!hits.length) hits = R.filter(r => r && r.token.includes(q));
  return hits.length ? { electrodes: [], regions: hits.map(r => r.id) } : null;
}
const COMMANDS = {
  help: () => { chat('Commands: /tp <electrode|region|x y z>, /hide <name>, /show <name|all>, /only <name>, /view <1-9>, /opacity <0-1>, /speed <mm/s>, /fov <deg>, /render smooth|blocks, /color lobes|areas, /where, /link, /electrodes, /list, /spawn', 'dim'); },
  tp: a => {
    if (a.length === 3 && a.every(v => !isNaN(+v))){ const p = a.map(Number); const d = toMNI(new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation)); setView(p, [p[0] + d[0], p[1] + d[1], p[2] + d[2]]); return chat('Teleported to ' + p.join(' ') + ' (MNI mm)', 'ok'); }
    if (norm(a.join(' ')) === 'spawn'){ respawn(); return chat('Back at spawn', 'ok'); }
    const m = resolve(a.join(' '));
    if (!m) return chat('Unknown place: ' + a.join(' '), 'err');
    if (m.electrodes.length){ tpElectrode(m.electrodes[0]); return chat('Teleported to ' + m.electrodes[0].key, 'ok'); }
    const id = m.regions.find(i => R[i].center) ; if (!id) return chat('Nothing to fly to', 'err');
    if (R[id].alpha <= 0.02) setOverride(id, 'shown', true);
    tpRegion(id); chat('Teleported to ' + R[id].name, 'ok');
  },
  hide: a => applyMatch(a, 'hidden'),
  show: a => { if (norm(a.join(' ')) === 'all') return restoreAll(); applyMatch(a, 'shown'); },
  only: a => { const m = resolve(a.join(' ')); if (!m || !m.regions.length) return chat('Unknown region: ' + a.join(' '), 'err'); isolate(m.regions); chat('Showing only ' + m.regions.length + ' region(s). /show all or R to restore', 'ok'); },
  view: a => { const n = parseInt(a[0], 10); if (!(n >= 1 && n <= 9)) return chat('Use /view 1 to 9', 'err'); selectPreset(n - 1); },
  opacity: a => num(a, 0.05, 1, v => { opt.opacity = v; U.uOpacity.value = v; }, 'Opacity'),
  speed: a => num(a, 1, 400, v => { opt.speed = v; }, 'Fly speed (mm/s)'),
  fov: a => num(a, 30, 120, v => { opt.fov = v; camera.fov = v; camera.updateProjectionMatrix(); }, 'FOV'),
  render: a => { const v = norm(a[0] || ''); if (v !== 'smooth' && v !== 'blocks') return chat('Use /render smooth or /render blocks', 'err'); setRender(v); },
  color: a => { const v = norm(a[0] || ''); if (v !== 'lobes' && v !== 'areas') return chat('Use /color lobes or /color areas', 'err'); setColorMode(v); },
  where: () => { const m = toMNI(player.pos); chat('x ' + fmt(m[0]) + ', y ' + fmt(m[1]) + ', z ' + fmt(m[2]) + ' mm · ' + insideText(m) + ' · facing ' + facing(), 'dim'); },
  electrodes: () => { for (const e of electrodes) chat(e.key + ' (' + e.kindInfo.role.toLowerCase() + '): ' + beneathText(e) + (e.proj ? ', ' + depthText(e) : ''), 'dim'); },
  link: () => {
    const url = shareLink();
    try { navigator.clipboard.writeText(url).then(() => chat('Link copied to the clipboard', 'ok'), () => {}); } catch (e) {}
    chat(url, 'dim');
  },
  list: () => { chat('Groups: all, cortex, lobes, areas, deep, hindbrain, left, right, limbic_system, basal_ganglia, scalp, electrodes', 'dim'); chat('Regions: ' + [...new Set(R.filter(Boolean).map(r => r.token.replace(/^(left|right)_/, '')))].join(', '), 'dim'); },
  spawn: () => { respawn(); chat('Back at spawn', 'ok'); },
  restore: () => restoreAll()
};
COMMANDS.goto = COMMANDS.tp; COMMANDS.color_mode = COMMANDS.color; COMMANDS.colour = COMMANDS.color;
function num(a, lo, hi, set, name){ const v = parseFloat(a[0]); if (isNaN(v)) return chat(name + ': give a number', 'err'); set(clamp(v, lo, hi)); saveOpts(); chat(name + ' = ' + clamp(v, lo, hi), 'ok'); }
function applyMatch(a, how){
  const m = resolve(a.join(' '));
  if (!m) return chat('Unknown region: ' + a.join(' '), 'err');
  for (const e of m.electrodes){ if (how === 'hidden') hiddenElectrodes.add(e.key); else hiddenElectrodes.delete(e.key); }
  for (const id of m.regions){ undoStack.push([id, overrides.get(id)]); overrides.set(id, how); }
  refreshRegions();
  chat((how === 'hidden' ? 'Hid ' : 'Showing ') + (m.regions.length + m.electrodes.length === 1 ? (m.regions.length ? R[m.regions[0]].name : m.electrodes[0].key) : (m.regions.length + m.electrodes.length) + ' items'), 'ok');
}
function run(text){
  chat(text, 'dim');
  if (!text.startsWith('/')) return chat('Commands start with /. Try /help', 'err');
  const [cmd, ...args] = text.slice(1).split(/\s+/);
  const f = COMMANDS[cmd.toLowerCase()];
  if (!f) return chat('Unknown command /' + cmd + '. Try /help', 'err');
  try { f(args); } catch (e) { chat('Error: ' + e.message, 'err'); }
}
function complete(){
  const inp = $('#chatin'), v = inp.value;
  const parts = v.split(/\s+/);
  let opts;
  if (parts.length <= 1) opts = Object.keys(COMMANDS).map(c => '/' + c);
  else opts = [...electrodes.map(e => e.key), ...Object.keys(GROUPS), 'scalp', 'electrodes', 'spawn', ...new Set(R.filter(Boolean).map(r => r.token)), ...new Set(R.filter(Boolean).map(r => r.token.replace(/^(left|right)_/, '')))];
  const last = parts[parts.length - 1].toLowerCase();
  const m = [...new Set(opts)].filter(o => o.toLowerCase().startsWith(last));
  if (!m.length) return;
  if (m.length === 1){ parts[parts.length - 1] = m[0]; inp.value = parts.join(' ') + ' '; return; }
  let pre = m[0];
  for (const o of m) while (!o.toLowerCase().startsWith(pre.toLowerCase())) pre = pre.slice(0, -1);
  parts[parts.length - 1] = pre; inp.value = parts.join(' ');
  chat(m.slice(0, 24).join('  ') + (m.length > 24 ? '  …' : ''), 'dim');
}

/* ---------------- keyboard and mouse ---------------- */
const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight']);
let lastW = 0, shotPending = false;
addEventListener('keydown', e => {
  if (state === 'chat') return;
  const c = e.code;
  if (state === 'inv'){
    if (c === 'Escape' || (c === 'KeyE' && e.target.id !== 'invq')){ e.preventDefault(); closeInventory(); }
    return;
  }
  if ((state === 'options' || state === 'controls') && c === 'Escape'){ back(); return; }
  if (state !== 'play') return;
  if (['Space', 'Tab', 'F1', 'F2', 'F3', 'Slash', 'ArrowUp', 'ArrowDown'].includes(c) || c.startsWith('Digit')) e.preventDefault();
  if (MOVE.has(c)){
    if (c === 'KeyW' && !e.repeat){ const t = performance.now(); if (t - lastW < 300) player.sprint = true; lastW = t; }
    keys[c] = true; return;
  }
  if (e.repeat) return;
  if (c.startsWith('Digit') && c !== 'Digit0') return selectPreset(+c.slice(5) - 1);
  switch (c){
    case 'KeyE': e.preventDefault(); openInventory(); break;
    case 'KeyT': e.preventDefault(); openChat(''); break;
    case 'Slash': openChat('/'); break;
    case 'F3': case 'KeyG': $('#debug').hidden = !$('#debug').hidden; $('#where').hidden = !$('#debug').hidden; originAxes.visible = !$('#debug').hidden; break;
    case 'F1': case 'KeyH': hudHidden = !hudHidden; $('#hud').hidden = hudHidden; break;
    case 'F2': case 'KeyP': shotPending = true; break;
    case 'KeyZ': undo(); break;
    case 'KeyR': restoreAll(); break;
    case 'KeyB': setRender(opt.render === 'blocks' ? 'smooth' : 'blocks'); break;
    case 'KeyV': setColorMode(colorMode === 'areas' ? 'lobes' : 'areas'); break;
    case 'KeyL': opt.tags = !opt.tags; saveOpts(); refreshEEG(); toast('Name tags ' + (opt.tags ? 'on' : 'off')); break;
    case 'Equal': case 'NumpadAdd': opt.speed = Math.min(400, Math.round(opt.speed * 1.25)); saveOpts(); toast('Fly speed ' + opt.speed + ' mm/s'); break;
    case 'Minus': case 'NumpadSubtract': opt.speed = Math.max(2, Math.round(opt.speed / 1.25)); saveOpts(); toast('Fly speed ' + opt.speed + ' mm/s'); break;
  }
});
addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'KeyW') player.sprint = touchMove.sprint; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
// Ctrl+W closes the tab; ask before leaving while flying with the keyboard.
addEventListener('beforeunload', e => { if (locked){ e.preventDefault(); e.returnValue = ''; } });

document.addEventListener('mousemove', e => {
  if (!locked || state !== 'play') return;
  const s = 0.0022 * opt.sens, dx = clamp(e.movementX, -250, 250), dy = clamp(e.movementY, -250, 250);
  player.yaw -= dx * s; player.pitch = clamp(player.pitch - dy * s * (opt.invert ? -1 : 1), -1.55, 1.55);
});
canvas.addEventListener('mousedown', e => {
  if (state === 'play' && locked){
    e.preventDefault();
    if (e.button === 0) breakTarget(); else if (e.button === 2) showCard(target); else if (e.button === 1) isolateTarget();
  } else if (state === 'pause' && !COARSE){ play(); }
});
$('#game').addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => {
  if (state !== 'play' || !locked) return;
  e.preventDefault(); selectPreset(preset + (e.deltaY > 0 ? 1 : -1));
}, { passive: false });

/* ---------------- touch ---------------- */
if (COARSE){
  const stick = $('#stick'), knob = $('#knob');
  let sid = null, sc = null;
  stick.addEventListener('touchstart', e => { const t = e.changedTouches[0]; sid = t.identifier; const r = stick.getBoundingClientRect(); sc = [r.left + r.width / 2, r.top + r.height / 2]; e.preventDefault(); }, { passive: false });
  stick.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) if (t.identifier === sid){
      let dx = t.clientX - sc[0], dy = t.clientY - sc[1]; const l = Math.hypot(dx, dy), m = 50;
      if (l > m){ dx *= m / l; dy *= m / l; }
      knob.style.transform = `translate(${dx}px,${dy}px)`; touchMove.x = dx / m; touchMove.z = -dy / m;
    }
    e.preventDefault();
  }, { passive: false });
  const endStick = e => { for (const t of e.changedTouches) if (t.identifier === sid){ sid = null; knob.style.transform = ''; touchMove.x = touchMove.z = 0; } };
  stick.addEventListener('touchend', endStick); stick.addEventListener('touchcancel', endStick);
  for (const b of document.querySelectorAll('[data-hold]')){
    const k = b.dataset.hold;
    b.addEventListener('touchstart', e => { touchMove[k] = true; e.preventDefault(); }, { passive: false });
    b.addEventListener('touchend', () => { touchMove[k] = false; });
    b.addEventListener('touchcancel', () => { touchMove[k] = false; });
  }
  $('[data-tog="sprint"]').addEventListener('click', ev => { touchMove.sprint = !touchMove.sprint; player.sprint = touchMove.sprint; ev.currentTarget.classList.toggle('on', touchMove.sprint); });
  $('[data-act="inv"]').addEventListener('click', openInventory);
  $('[data-act="chat"]').addEventListener('click', () => openChat('/'));
  $('[data-act="pause"]').addEventListener('click', () => { setState('pause'); show('s-pause'); });
  // look by dragging on the view; tap = info card, long press = hide
  let lid = null, lp = null, lt = 0, moved = 0, holdT = null;
  canvas.addEventListener('touchstart', e => {
    if (state !== 'play' || lid !== null) return;
    const t = e.changedTouches[0]; lid = t.identifier; lp = [t.clientX, t.clientY]; lt = performance.now(); moved = 0;
    holdT = setTimeout(() => { if (moved < 10){ breakTarget(); lid = null; } }, 550);
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) if (t.identifier === lid){
      const dx = t.clientX - lp[0], dy = t.clientY - lp[1]; moved += Math.abs(dx) + Math.abs(dy); lp = [t.clientX, t.clientY];
      player.yaw -= dx * 0.005 * opt.sens; player.pitch = clamp(player.pitch - dy * 0.005 * opt.sens * (opt.invert ? -1 : 1), -1.55, 1.55);
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchend', e => {
    for (const t of e.changedTouches) if (t.identifier === lid){
      clearTimeout(holdT); lid = null;
      if (moved < 10 && performance.now() - lt < 400) showCard(target);
    }
  });
}

/* ---------------- movement ---------------- */
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), wish = new THREE.Vector3();
function updatePlayer(dt){
  const mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + touchMove.z;
  const mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + touchMove.x;
  const my = (keys.Space || touchMove.up ? 1 : 0) - (keys.ShiftLeft || keys.ShiftRight || touchMove.down ? 1 : 0);
  const sp = opt.speed * (player.sprint ? 2.2 : 1);
  if (opt.flyLook) fwd.set(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch));
  else fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  wish.set(0, 0, 0).addScaledVector(fwd, mz).addScaledVector(right, mx);
  if (wish.lengthSq() > 1) wish.normalize();
  wish.multiplyScalar(sp); wish.y += my * sp;
  player.vel.lerp(wish, 1 - Math.exp(-dt * 9));
  player.pos.addScaledVector(player.vel, dt);
}
function applyCamera(){ camera.position.copy(player.pos); camera.rotation.set(player.pitch, player.yaw, 0); }

/* ---------------- screenshots (F2) ---------------- */
function saveShot(){
  shotPending = false;
  canvas.toBlob(b => {
    if (!b) return;
    const a = document.createElement('a'), d = new Date(), p = n => String(n).padStart(2, '0');
    a.href = URL.createObjectURL(b);
    a.download = `brain-flythrough-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Saved screenshot ' + a.download);
  });
}

/* ---------------- about-page tables ---------------- */
function buildAboutTables(){
  $('#etable').innerHTML = '<tr><th>Electrode</th><th>Role</th><th>MNI position (mm)</th><th>Brain region under it (references: nearest)</th><th>Distance</th></tr>' + electrodes.map(e =>
    `<tr><td><span class="dot" style="background:${e.kindInfo.color};border-radius:50%"></span><b>${e.key}</b></td><td>${e.kindInfo.role}, ${e.where}</td><td>${e.pos.map(v => fmt(v)).join(', ')}</td><td>${beneathText(e)}</td><td>${depthText(e) || '–'}</td></tr>`).join('');
  const n = R.length - 1;
  $('#rsum').textContent = `The model has ${n} regions: cortical lobes, functional areas inside them, deep structures, the brainstem and cerebellum, and the scalp. Left and right are counted separately.`;
  $('#rlist').innerHTML = INV_GROUPS.map(([title, test]) => {
    const seen = new Set();
    const items = R.filter(r => r && test(r) && !seen.has(r.base) && seen.add(r.base));
    return `<h3>${title}</h3><ul class="rl">` + items.map(r => `<li><span class="dot" style="background:${r.color}"></span><b>${r.name.replace(/^(Left|Right) /, '').replace(/^./, c => c.toUpperCase())}</b>${r.side === 'L' && !R.some(x => x && x.base === r.base && x.side === 'R') ? ' (left only)' : ''}: ${r.info}</li>`).join('') + '</ul>';
  }).join('');
}

/* ---------------- main loop ---------------- */
let last = performance.now();
function frame(now){
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  U.uTime.value = now / 1000;
  if (state === 'title' || state === 'loading' || (state === 'options' && returnTo === 's-title') || (state === 'controls' && returnTo === 's-title')){
    const a = now / 1000 * 0.12, c = toThree(...A.BRAIN_CENTER);
    camera.position.set(c.x + Math.sin(a) * 300, c.y + 70, c.z + Math.cos(a) * 300);
    camera.lookAt(c);
  } else {
    if (state === 'play') updatePlayer(dt);
    applyCamera();
    if (built) updateHUD(now);
  }
  renderer.render(scene, camera);
  if (shotPending) saveShot();
  requestAnimationFrame(frame);
}

/* ---------------- start ---------------- */
const SPLASHES = ['Now with 10-20 electrodes!', 'Mind the central sulcus!', 'Ear clip or mastoid?', 'Spectator mode for neurons!', '100% procedural!', 'Press E for every region!', 'Try /tp thalamus', 'Fp1 sees your blinks!'];
$('#splash').textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
U.uOpacity.value = opt.opacity; grid.visible = opt.grid;
resize();
requestAnimationFrame(frame);
(async () => {
  try { await Promise.all([document.fonts.load('46px "VT323"'), document.fonts.load('20px "Press Start 2P"')]); } catch (e) {}
  try {
    await build();
    state = 'title'; $('#loading').hidden = true; $('#titlebtns').hidden = false;
    applyLink();
    chat('Welcome! Press T or / for commands, /help to list them.', 'dim');
  } catch (e) {
    console.error(e);
    $('#loadmsg').textContent = 'Could not build the brain: ' + e.message;
  }
})();
