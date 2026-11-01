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

// ---------- geometry ----------
function catmull(pts, closed, sub = 8) {
  const out = [], n = pts.length, cnt = closed ? n : n - 1;
  for (let i = 0; i < cnt; i++) {
    const p0 = pts[closed ? (i - 1 + n) % n : Math.max(i - 1, 0)], p1 = pts[i];
    const p2 = pts[closed ? (i + 1) % n : Math.min(i + 1, n - 1)], p3 = pts[closed ? (i + 2) % n : Math.min(i + 2, n - 1)];
    for (let j = 0; j < sub; j++) {
      const t = j / sub, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
    }
  }
  if (!closed) out.push(pts[n - 1].slice());
  return out;
}
function ellipsePoly(cx, cy, rx, ry, rot = 0, n = 40) {
  const out = [], c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < n; i++) { const a = i / n * TAU, x = Math.cos(a) * rx, y = Math.sin(a) * ry; out.push([cx + x * c - y * s, cy + x * s + y * c]); }
  return out;
}
function pointInPoly(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function polyArea(poly) { let a = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]); return Math.abs(a / 2); }
function bbox(poly) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of poly) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; } return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }
function centroid(poly) { let x = 0, y = 0; for (const p of poly) { x += p[0]; y += p[1]; } return [x / poly.length, y / poly.length]; }
function samplePoly(poly, minDist, rng, reject) {
  const bb = bbox(poly), cell = minDist / Math.SQRT2;
  const gw = Math.ceil(bb.w / cell) + 1, gh = Math.ceil(bb.h / cell) + 1;
  const grid = new Int32Array(gw * gh).fill(-1), pts = [];
  const target = Math.floor(polyArea(poly) / (minDist * minDist * 0.95));
  let tries = 0; const maxTries = target * 40 + 200;
  while (pts.length < target && tries < maxTries) {
    tries++;
    const x = bb.x + rng() * bb.w, y = bb.y + rng() * bb.h;
    if (!pointInPoly(poly, x, y)) continue;
    if (reject && reject(x, y)) continue;
    const gx = ((x - bb.x) / cell) | 0, gy = ((y - bb.y) / cell) | 0; let ok = true;
    for (let j = -2; j <= 2 && ok; j++) for (let i = -2; i <= 2; i++) {
      const nx = gx + i, ny = gy + j; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
      const k = grid[ny * gw + nx]; if (k >= 0) { const dx = pts[k][0] - x, dy = pts[k][1] - y; if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; } }
    }
    if (!ok) continue;
    grid[gy * gw + gx] = pts.length; pts.push([x, y]);
  }
  return pts;
}

// ---------- anatomy (sagittal view, facing left; world space 1000 x 820) ----------
const NT = {
  da: { name: 'Dopamine', hue: 318, receptor: 'D1 / D2 receptors', css: '#ff5fb4' },
  ne: { name: 'Norepinephrine', hue: 40, receptor: 'β-adrenergic receptors', css: '#ffb347' },
  ht: { name: 'Serotonin', hue: 150, receptor: '5-HT receptors', css: '#5fe0a8' },
  glu: { name: 'Glutamate', hue: 200, receptor: 'AMPA / NMDA receptors', css: '#7fd3ff' },
};
const CHORD_HUE = [42, 258, 178, 318]; // maj, min, dim, sus

const REGIONS = [
  { id: 'pfc', name: 'Prefrontal cortex', pts: [[178, 470], [162, 385], [190, 300], [245, 230], [330, 195], [385, 200], [395, 290], [365, 370], [300, 430], [240, 468]], hue: 262, sat: 55, light: 62, layer: 1, nt: 'da', desc: 'Harmony and expectation. Flashes on every chord change, coloured by chord quality (gold major, indigo minor, teal diminished, magenta suspended).' },
  { id: 'motor', name: 'Motor & premotor cortex', pts: [[385, 200], [475, 172], [505, 320], [470, 395], [400, 425], [365, 370], [395, 290]], hue: 12, sat: 70, light: 60, layer: 1, nt: 'glu', desc: 'The beat. Pulses with each onset and with the predicted pulse.' },
  { id: 'parietal', name: 'Parietal cortex', pts: [[475, 172], [590, 180], [700, 215], [770, 285], [700, 345], [600, 372], [520, 378], [505, 320]], hue: 196, sat: 45, light: 60, layer: 1, nt: 'ne', desc: 'Midrange energy. Brightens under norepinephrine.' },
  { id: 'occipital', name: 'Occipital cortex', pts: [[770, 285], [835, 370], [825, 450], [760, 490], [690, 465], [645, 405], [700, 345]], hue: 222, sat: 50, light: 62, layer: 1, nt: 'ne', desc: 'High frequencies shimmer here. Brightens under norepinephrine.' },
  { id: 'temporal', name: 'Temporal cortex', pts: [[282, 478], [335, 440], [440, 405], [520, 392], [600, 385], [645, 405], [650, 450], [590, 490], [470, 520], [345, 528]], hue: 182, sat: 45, light: 58, layer: 1, nt: 'glu', desc: 'Overall loudness and timbre.' },
  { id: 'auditory', name: 'Auditory cortex', pts: [[410, 416], [470, 401], [560, 394], [614, 400], [604, 432], [520, 440], [438, 450], [400, 444]], hue: 168, sat: 75, light: 66, layer: 2, pri: 2, sp: 5.0, r: 2.1, nt: 'glu', desc: 'Tonotopic map: low frequencies at the front, high at the back. Each dot follows one band of the live spectrum.' },
  { id: 'cingulate', name: 'Cingulate cortex', pts: [[345, 300], [420, 250], [520, 232], [620, 245], [690, 290], [680, 318], [610, 282], [520, 268], [430, 282], [360, 325]], hue: 285, sat: 55, light: 62, layer: 2, pri: 3, nt: 'ht', limbic: true, hueOff: 10, desc: 'Limbic. Undulates with the key: warm in major, cool in minor. Flashes with harmonic tension.' },
  { id: 'striatum', name: 'Striatum (basal ganglia)', ellipse: [455, 352, 48, 42, 0], hue: 30, sat: 80, light: 62, layer: 2, pri: 4, nt: 'da', desc: 'Groove. Locks to the beat; dopamine makes it glow.' },
  { id: 'thalamus', name: 'Thalamus', ellipse: [545, 370, 58, 36, 0], hue: 204, sat: 55, light: 66, layer: 2, pri: 4, nt: 'ne', desc: 'Relay. Brightness follows loudness; every pathway passes through.' },
  { id: 'hypothalamus', name: 'Hypothalamus', ellipse: [498, 438, 30, 18, 0], hue: 22, sat: 70, light: 62, layer: 2, pri: 5, nt: 'ne', limbic: true, hueOff: -20, desc: 'Arousal. Follows norepinephrine and loudness.' },
  { id: 'hippocampus', name: 'Hippocampus', pts: [[455, 478], [500, 462], [560, 450], [615, 438], [640, 452], [600, 470], [540, 484], [480, 496]], hue: 272, sat: 60, light: 64, layer: 2, pri: 4, nt: 'glu', limbic: true, hueOff: -10, desc: 'Memory. Flashes when a melody, chord progression or sample is recognised, and wires neurons to the cortex.' },
  { id: 'amygdala', name: 'Amygdala', ellipse: [435, 468, 20, 16, 0], hue: 345, sat: 75, light: 60, layer: 2, pri: 5, nt: 'ht', limbic: true, hueOff: 25, desc: 'Emotional salience. Minor tonality and sudden loud transients.' },
  { id: 'accumbens', name: 'Nucleus accumbens', ellipse: [405, 428, 22, 18, 0], hue: 318, sat: 80, light: 66, layer: 2, pri: 5, nt: 'da', desc: 'Reward. Lights up with dopamine: drops, resolutions, predicted beats.' },
  { id: 'cerebellum', name: 'Cerebellum', pts: [[615, 485], [710, 495], [790, 525], [780, 600], [700, 640], [610, 615], [575, 545]], hue: 300, sat: 40, light: 58, layer: 1, nt: 'glu', desc: 'Timing. Ticks on every predicted beat, even in the silence between hits.' },
  { id: 'brainstem', name: 'Brainstem', pts: [[505, 468], [575, 478], [592, 545], [585, 660], [550, 720], [505, 720], [490, 610], [495, 520]], hue: 212, sat: 35, light: 56, layer: 1, nt: 'glu', desc: 'Sound arrives here first and climbs to the thalamus.' },
  { id: 'vta', name: 'Ventral tegmental area', ellipse: [540, 520, 12, 10, 0], hue: 318, sat: 90, light: 68, layer: 2, pri: 6, sp: 4, r: 2.3, nt: 'da', label: [26, 4], desc: 'Dopamine source. Fires on drops, cadences, melodic leaps and beats that land where predicted.' },
  { id: 'lc', name: 'Locus coeruleus', ellipse: [562, 600, 10, 9, 0], hue: 40, sat: 95, light: 66, layer: 2, pri: 6, sp: 4, r: 2.3, nt: 'ne', label: [26, 4], desc: 'Norepinephrine source. Fires on tempo changes and sudden loudness.' },
  { id: 'raphe', name: 'Raphe nuclei', ellipse: [540, 645, 10, 10, 0], hue: 150, sat: 70, light: 64, layer: 2, pri: 6, sp: 4, r: 2.3, nt: 'ht', label: [26, 4], desc: 'Serotonin source. Rises with steady tempo and major tonality.' },
];

const PATHWAYS = [
  { id: 'mesolimbic', name: 'Mesolimbic dopamine pathway', nt: 'da', pts: [[540, 520], [495, 505], [445, 480], [408, 440]], to: 'accumbens' },
  { id: 'mesocortical', name: 'Mesocortical dopamine pathway', nt: 'da', pts: [[540, 520], [480, 505], [400, 470], [320, 415], [262, 335]], to: 'pfc' },
  { id: 'ne1', name: 'Noradrenergic projection', nt: 'ne', pts: [[562, 600], [548, 540], [545, 420], [480, 300], [400, 215]], to: 'motor' },
  { id: 'ne2', name: 'Noradrenergic projection', nt: 'ne', pts: [[562, 600], [548, 540], [545, 420], [600, 300], [660, 215]], to: 'parietal' },
  { id: 'ne3', name: 'Noradrenergic projection', nt: 'ne', pts: [[562, 600], [548, 540], [560, 420], [690, 390], [790, 380]], to: 'occipital' },
  { id: 'ne4', name: 'Noradrenergic projection', nt: 'ne', pts: [[562, 600], [550, 545], [520, 470], [498, 438]], to: 'hypothalamus' },
  { id: 'ht1', name: 'Serotonergic projection', nt: 'ht', pts: [[540, 645], [525, 570], [505, 480], [470, 462], [437, 468]], to: 'amygdala' },
  { id: 'ht2', name: 'Serotonergic projection', nt: 'ht', pts: [[540, 645], [520, 570], [500, 460], [455, 400], [400, 330], [340, 275]], to: 'cingulate' },
  { id: 'ht3', name: 'Serotonergic projection', nt: 'ht', pts: [[540, 645], [535, 575], [560, 500], [590, 455], [610, 445]], to: 'hippocampus' },
  { id: 'auditoryPath', name: 'Ascending auditory pathway', nt: 'glu', pts: [[515, 700], [512, 620], [545, 560], [585, 480], [585, 400], [530, 430]], to: 'auditory' },
  { id: 'arcuate', name: 'Arcuate fasciculus', nt: 'glu', pts: [[565, 395], [610, 340], [560, 250], [440, 236], [350, 280], [300, 340]], to: 'pfc' },
  { id: 'ctc', name: 'Cerebello-thalamo-cortical loop', nt: 'glu', pts: [[690, 560], [615, 515], [565, 420], [525, 300], [470, 220]], to: 'motor' },
  { id: 'fornix', name: 'Hippocampal–prefrontal loop', nt: 'glu', pts: [[610, 450], [600, 380], [540, 318], [450, 300], [370, 330], [300, 360]], to: 'pfc' },
  { id: 'striatal', name: 'Cortico-striatal loop', nt: 'da', pts: [[455, 352], [462, 290], [470, 225]], to: 'motor' },
  { id: 'callosum', name: 'Corpus callosum', nt: 'glu', pts: [[335, 330], [400, 290], [510, 272], [620, 282], [690, 330]], to: null },
];

const SKULL = {
  outline: [[115, 330], [120, 250], [175, 170], [280, 120], [430, 100], [600, 105], [760, 150], [870, 250], [905, 370], [880, 500], [810, 610], [720, 680], [640, 715], [585, 722], [560, 700], [500, 690], [420, 700], [300, 690], [200, 660], [160, 610], [130, 560], [110, 500], [90, 440], [95, 385]],
  orbit: [192, 402, 44, 37, -0.25],
  zygomatic: [[236, 446], [300, 452], [370, 450], [432, 446]],
  mandible: [[150, 560], [148, 600], [172, 640], [240, 668], [360, 680], [470, 672], [520, 630], [540, 575]],
  teeth: { x0: 158, x1: 262, y: 598, n: 7 },
  sutures: [[[430, 100], [455, 130], [470, 172]], [[790, 175], [770, 215], [770, 285]]],
};

// ---------- build dots ----------
const rng0 = mulberry32(1337);
const regions = REGIONS.map((r, i) => {
  const poly = r.pts ? catmull(r.pts, true, 8) : ellipsePoly(...r.ellipse);
  const bb = bbox(poly), c = centroid(poly);
  return Object.assign({}, r, { i, poly, bb, cx: c[0], cy: c[1], small: bb.w < 70 });
});
const regionById = {}; regions.forEach(r => regionById[r.id] = r);
const inner = regions.filter(r => r.layer === 2).sort((p, q) => q.pri - p.pri);
function insideInner(x, y, minPri) { for (const r of inner) { if (r.pri <= minPri) break; if (x < r.bb.x || x > r.bb.x + r.bb.w || y < r.bb.y || y > r.bb.y + r.bb.h) continue; if (pointInPoly(r.poly, x, y)) return true; } return false; }
const tmp = [];
regions.forEach(r => {
  const sp = r.sp || (r.layer === 2 ? 5.6 : 7.4);
  const pri = r.layer === 1 ? 0 : r.pri; const pts = samplePoly(r.poly, sp, rng0, (x, y) => insideInner(x, y, pri));
  r.start = tmp.length;
  for (const p of pts) tmp.push({ x: p[0], y: p[1], reg: r.i, tone: rng0() * 2 - 1, size: (r.r || 2.2) * (0.72 + rng0() * 0.56), phase: rng0() * TAU, u: (p[0] - r.bb.x) / r.bb.w, seed: (rng0() * 4294967295) >>> 0 });
  r.end = tmp.length;
});
const ND = tmp.length;
const D = { x: new Float32Array(ND), y: new Float32Array(ND), reg: new Int16Array(ND), tone: new Float32Array(ND), size: new Float32Array(ND), phase: new Float32Array(ND), u: new Float32Array(ND), seed: new Uint32Array(ND), a: new Float32Array(ND), hue: new Float32Array(ND) };
tmp.forEach((d, i) => { D.x[i] = d.x; D.y[i] = d.y; D.reg[i] = d.reg; D.tone[i] = d.tone; D.size[i] = d.size; D.phase[i] = d.phase; D.u[i] = d.u; D.seed[i] = d.seed; });

const paths = PATHWAYS.map((p, i) => {
  const curve = catmull(p.pts, false, 12);
  let total = 0; for (let k = 1; k < curve.length; k++) total += Math.hypot(curve[k][0] - curve[k - 1][0], curve[k][1] - curve[k - 1][1]);
  const spacing = 5.5, pts = []; let acc = 0, next = 0;
  for (let k = 1; k < curve.length; k++) {
    const a = curve[k - 1], b = curve[k], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (next <= acc + L && L > 0) { const f = (next - acc) / L; pts.push({ x: lerp(a[0], b[0], f) + (rng0() - 0.5) * 1.6, y: lerp(a[1], b[1], f) + (rng0() - 0.5) * 1.6, t: next / total, r: 1.3 + rng0() * 0.8 }); next += spacing; }
    acc += L;
  }
  return Object.assign({}, p, { i, curve, pts, length: total, glow: new Float32Array(pts.length), lastSpawn: -1, hue: NT[p.nt].hue, toR: p.to ? regionById[p.to] : null });
});
const pathById = {}; paths.forEach(p => pathById[p.id] = p);
