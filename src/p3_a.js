(() => {
'use strict';
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function fnv(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function lerpHue(a, b, t) { let d = ((b - a) % 360 + 540) % 360 - 180; return (a + d * t + 360) % 360; }
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- 3D helpers ----------
function catmull3(pts, sub = 10) {
  const out = [], n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[Math.min(i + 1, n - 1)], p3 = pts[Math.min(i + 2, n - 1)];
    for (let j = 0; j < sub; j++) {
      const t = j / sub, t2 = t * t, t3 = t2 * t, q = [];
      for (let k = 0; k < 3; k++) q.push(0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
      out.push(q);
    }
  }
  out.push(pts[n - 1].slice()); return out;
}
const NT = {
  da: { name: 'Dopamine', hue: 318, receptor: 'D1 / D2 receptors', css: '#ff5fb4' },
  ne: { name: 'Norepinephrine', hue: 40, receptor: 'β-adrenergic receptors', css: '#ffb347' },
  ht: { name: 'Serotonin', hue: 150, receptor: '5-HT receptors', css: '#5fe0a8' },
  glu: { name: 'Glutamate', hue: 200, receptor: 'AMPA / NMDA receptors', css: '#7fd3ff' },
};
const CHORD_HUE = [42, 258, 178, 318]; // maj, min, dim, sus

// ---------- atlas point cloud (assets/brain-data.js, built from the MNI152 atlas) ----------
const BD = window.BRAIN_DATA; if (!BD || !window.BRAIN_BLOB) throw new Error('brain data missing');
const blob = (() => { const s = atob(window.BRAIN_BLOB); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); window.BRAIN_BLOB = null; return b; })();
const NALL = BD.n; let off = 0;
const posI16 = new Int16Array(blob.buffer, 0, NALL * 3); off += NALL * 6;
const regU8 = blob.subarray(off, off + NALL); off += NALL;
const toneU8 = blob.subarray(off, off + NALL); off += NALL;
const phU8 = blob.subarray(off, off + NALL); off += NALL;
const uU8 = blob.subarray(off, off + NALL); off += NALL;
const szU8 = blob.subarray(off, off + NALL); off += NALL;
const regions = BD.regions.map((m, i) => Object.assign({}, m, { i, start: -1, end: -1, small: m.r < 16, cx: m.c[0], cy: m.c[1], cz: m.c[2] }));
const regionById = {}; regions.forEach(r => regionById[r.id] = r);
let ND = 0; for (let i = 0; i < NALL; i++) if (regU8[i] !== BD.skullId) ND++;
// brain dots first (grouped by region in file order), skull dots after
const D = { x: new Float32Array(NALL), y: new Float32Array(NALL), z: new Float32Array(NALL), reg: new Uint8Array(NALL), tone: new Float32Array(NALL), size: new Float32Array(NALL), phase: new Float32Array(NALL), u: new Float32Array(NALL), seed: new Uint32Array(NALL), a: new Float32Array(NALL), hue: new Float32Array(NALL) };
{
  const sc = BD.scale; const rng = mulberry32(99);
  for (let i = 0; i < NALL; i++) {
    D.x[i] = posI16[i * 3] * sc; D.y[i] = posI16[i * 3 + 1] * sc; D.z[i] = posI16[i * 3 + 2] * sc;
    D.reg[i] = regU8[i]; D.tone[i] = toneU8[i] / 255 * 2 - 1; D.phase[i] = phU8[i] / 255 * TAU; D.u[i] = uU8[i] / 255; D.size[i] = szU8[i] / 100; D.seed[i] = (rng() * 4294967295) >>> 0;
    const r = regU8[i]; if (r !== BD.skullId) { if (regions[r].start < 0) regions[r].start = i; regions[r].end = i + 1; }
  }
}
const NSK = NALL - ND; // skull points (indices ND..NALL)
// spatial grid over brain dots for neighbour queries (cell 4 mm)
const GRID = new Map(), GCELL = 4;
const gkey = (x, y, z) => ((Math.floor(x / GCELL) + 512) * 1024 + (Math.floor(y / GCELL) + 512)) * 1024 + (Math.floor(z / GCELL) + 512);
for (let i = 0; i < ND; i++) { const k = gkey(D.x[i], D.y[i], D.z[i]); let l = GRID.get(k); if (!l) { l = []; GRID.set(k, l); } l.push(i); }
function neighbours(i, radius, out) { out.length = 0; const r2 = radius * radius, x = D.x[i], y = D.y[i], z = D.z[i]; const c = Math.ceil(radius / GCELL);
  for (let dx = -c; dx <= c; dx++) for (let dy = -c; dy <= c; dy++) for (let dz = -c; dz <= c; dz++) { const l = GRID.get(gkey(x + dx * GCELL, y + dy * GCELL, z + dz * GCELL)); if (!l) continue; for (const j of l) { if (j === i) continue; const ex = D.x[j] - x, ey = D.y[j] - y, ez = D.z[j] - z; const d2 = ex * ex + ey * ey + ez * ez; if (d2 < r2) out.push(j, d2); } }
  return out; }
const inner = regions.filter(r => r.small || ['thalamus', 'striatum', 'hippocampus', 'auditory', 'cingulate'].includes(r.id)).sort((a, b) => a.r - b.r);

// ---------- pathways: waypoints through atlas structures, mirrored into both hemispheres ----------
const W = BD.way;
function wp(name, dx = 0, dy = 0, dz = 0) { return { name, dx, dy, dz }; }
const PATHWAY_DEFS = [
  { id: 'mesolimbic', name: 'Mesolimbic dopamine pathway', nt: 'da', pts: [wp('vta'), wp('hypothalamus', 4, 2, 2), wp('accumbens')], to: 'accumbens' },
  { id: 'mesocortical', name: 'Mesocortical dopamine pathway', nt: 'da', pts: [wp('vta'), wp('striatum', -6, 6, -8), wp('accumbens', 0, 8, 6), wp('pfc', 0, 0, -6)], to: 'pfc' },
  { id: 'ne1', name: 'Noradrenergic projection', nt: 'ne', pts: [wp('lc'), wp('thalamus', 0, -6, -6), wp('motor', 0, 0, -12)], to: 'motor' },
  { id: 'ne2', name: 'Noradrenergic projection', nt: 'ne', pts: [wp('lc'), wp('thalamus', 4, -8, 0), wp('parietal', 0, 0, -10)], to: 'parietal' },
  { id: 'ne3', name: 'Noradrenergic projection', nt: 'ne', pts: [wp('lc'), wp('thalamus', 6, -14, 2), wp('occipital', 0, 10, 0)], to: 'occipital' },
  { id: 'ne4', name: 'Noradrenergic projection', nt: 'ne', pts: [wp('lc'), wp('vta', 2, -4, 2), wp('hypothalamus')], to: 'hypothalamus' },
  { id: 'ht1', name: 'Serotonergic projection', nt: 'ht', pts: [wp('raphe'), wp('vta', 6, 4, -4), wp('amygdala')], to: 'amygdala' },
  { id: 'ht2', name: 'Serotonergic projection', nt: 'ht', pts: [wp('raphe'), wp('thalamus', 0, 0, 6), wp('cingulate', 0, 0, -6)], to: 'cingulate' },
  { id: 'ht3', name: 'Serotonergic projection', nt: 'ht', pts: [wp('raphe'), wp('brainstem', 6, 4, 10), wp('hippocampus')], to: 'hippocampus' },
  { id: 'auditoryPath', name: 'Ascending auditory pathway', nt: 'glu', pts: [wp('@cochlear'), wp('@ic'), wp('@mgn'), wp('auditory')], to: 'auditory' },
  { id: 'arcuate', name: 'Arcuate fasciculus', nt: 'glu', pts: [wp('auditory'), wp('parietal', 8, 10, -16), wp('motor', 10, 10, -22), wp('pfc', 8, -10, -6)], to: 'pfc' },
  { id: 'ctc', name: 'Cerebello-thalamo-cortical loop', nt: 'glu', pts: [wp('cerebellum', 0, 10, 8), wp('brainstem', 2, 2, 14), wp('thalamus'), wp('motor', 0, 0, -8)], to: 'motor' },
  { id: 'fornix', name: 'Hippocampal–prefrontal loop', nt: 'glu', pts: [wp('hippocampus', 0, 0, 2), wp('@fornix_arc', 4, 0, 0), wp('accumbens', 0, 0, 6), wp('pfc', 0, 0, -10)], to: 'pfc' },
  { id: 'striatal', name: 'Cortico-striatal loop', nt: 'da', pts: [wp('striatum'), wp('motor', 0, 0, -22), wp('motor', 0, 0, -4)], to: 'motor' },
  { id: 'callosum', name: 'Corpus callosum', nt: 'glu', pts: [wp('pfc', -12, 0, 0), wp('@callosum_mid'), wp('pfc', 12, 0, 0)], to: null, once: true },
];
function resolve(w, side) {
  let base;
  if (w.name[0] === '@') { const key = w.name.slice(1); base = W[key + (side < 0 ? '_l' : '_r')] || W[key]; }
  else { const r = regionById[w.name]; base = side < 0 ? r.cl : r.cr; }
  return [base[0] + side * w.dx, base[1] + w.dy, base[2] + w.dz];
}
const paths = []; const pathById = {};
PATHWAY_DEFS.forEach(def => {
  const sides = def.once ? [-1] : [-1, 1];
  const list = [];
  for (const side of sides) {
    let ctrl = def.pts.map(w => resolve(w, side));
    if (def.once) ctrl = [resolve(def.pts[0], -1), resolve(def.pts[1], 1), resolve(def.pts[2], 1)];
    const curve = catmull3(ctrl, 12); let total = 0;
    for (let k = 1; k < curve.length; k++) total += Math.hypot(curve[k][0] - curve[k - 1][0], curve[k][1] - curve[k - 1][1], curve[k][2] - curve[k - 1][2]);
    const spacing = 2.2, pts = []; let acc = 0, next = 0; const rng = mulberry32(fnv(def.id + side));
    for (let k = 1; k < curve.length; k++) {
      const a = curve[k - 1], b = curve[k], L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      while (next <= acc + L && L > 0) { const f = (next - acc) / L; pts.push({ x: lerp(a[0], b[0], f) + (rng() - 0.5) * 1.2, y: lerp(a[1], b[1], f) + (rng() - 0.5) * 1.2, z: lerp(a[2], b[2], f) + (rng() - 0.5) * 1.2, t: next / total, r: 0.5 + rng() * 0.35 }); next += spacing; }
      acc += L;
    }
    const p = Object.assign({}, def, { i: paths.length, side, pts, length: total, glow: new Float32Array(pts.length), lastSpawn: -1, hue: NT[def.nt].hue, toR: def.to ? regionById[def.to] : null });
    paths.push(p); list.push(p);
  }
  pathById[def.id] = list;
});
function spawnPath(id, intensity, now) { const l = pathById[id]; if (l) for (const p of l) brain.spawnPulse(p, intensity, now); }
