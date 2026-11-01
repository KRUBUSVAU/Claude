
// ---------- renderer ----------
// Two stacked canvases: a WebGL canvas draws every dot as a GPU point sprite (one draw call for the
// clouds, one for their bloom); a transparent 2D canvas above it draws the skull, synapse lines,
// labels and the zoomed-in neuron detail. If WebGL is unavailable, the 2D canvas draws everything.
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d', { alpha: true });
const glCanvas = document.getElementById('gl');
const view = { w: 1, h: 1, dpr: 1, base: 1, scale: 1, z: 1, cx: 505, cy: 415, tz: 1, tcx: 505, tcy: 415, animating: false, dprCap: 2 };
const WORLD = { w: 1000, h: 820 };
function resize() {
  view.dpr = Math.min(view.dprCap, window.devicePixelRatio || 1); view.w = canvas.clientWidth; view.h = canvas.clientHeight;
  const pw = Math.round(view.w * view.dpr), ph = Math.round(view.h * view.dpr);
  canvas.width = pw; canvas.height = ph; glCanvas.width = pw; glCanvas.height = ph;
  view.base = Math.min(view.w / WORLD.w, view.h / WORLD.h) * 0.97; view.scale = view.base * view.z;
  // portrait phones: keep the brain in the upper part of the screen, clear of the panels
  const homeY = view.h > view.w * 1.25 ? 415 + Math.min(260, (view.h - view.w * 0.82) / view.base * 0.22) : 415;
  if (!view.touched) { view.cy = homeY; view.tcy = homeY; } view.homeY = homeY;
}
window.addEventListener('resize', resize); resize();
function clampCam() { view.cx = clamp(view.cx, 60, 940); view.cy = clamp(view.cy, 60, 760); view.z = clamp(view.z, 1, 18); view.scale = view.base * view.z; }
function toWorld(sx, sy) { return [view.cx + (sx - view.w / 2) / view.scale, view.cy + (sy - view.h / 2) / view.scale]; }
function zoomAt(factor, sx, sy) { view.touched = true; const [wx, wy] = toWorld(sx, sy); view.z = clamp(view.z * factor, 1, 18); view.scale = view.base * view.z; view.cx = wx - (sx - view.w / 2) / view.scale; view.cy = wy - (sy - view.h / 2) / view.scale; view.animating = false; clampCam(); }
function flyTo(cx, cy, z) { view.touched = true; view.tcx = cx; view.tcy = cy; view.tz = z; view.animating = true; }
function goHome() { flyTo(505, view.homeY || 415, 1); }

// ---- colour helpers ----
const colorCache = new Map();
function hsl(h, s, l) { const hq = ((h % 360 + 360) % 360 / 3) | 0, sq = (clamp(s, 0, 100) / 5) | 0, lq = (clamp(l, 0, 100) / 2) | 0; const key = hq * 100000 + sq * 1000 + lq; let v = colorCache.get(key); if (!v) { v = `hsl(${hq * 3},${sq * 5}%,${lq * 2}%)`; colorCache.set(key, v); } return v; }
const rgbTmp = [0, 0, 0];
function hslRgb(h, s, l) { // h 0..360, s,l 0..100 -> rgbTmp 0..1
  h = ((h % 360) + 360) % 360 / 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  for (let k = 0; k < 3; k++) { let t = h + (1 - k) / 3; if (t < 0) t += 1; if (t > 1) t -= 1; rgbTmp[k] = t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }
  return rgbTmp;
}
const sprites = new Map();
function glowSprite(h) {
  const b = ((h % 360 + 360) % 360 / 12) | 0; let s = sprites.get(b);
  if (!s) { s = document.createElement('canvas'); s.width = s.height = 64; const c = s.getContext('2d'); const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, `hsla(${b * 12},90%,72%,1)`); g.addColorStop(0.25, `hsla(${b * 12},90%,65%,.45)`); g.addColorStop(1, `hsla(${b * 12},90%,60%,0)`); c.fillStyle = g; c.fillRect(0, 0, 64, 64); sprites.set(b, s); }
  return s;
}

// ---- WebGL point-cloud layer ----
let gl = null, glProg = null, glBuf = null, glLoc = null, glMaxPt = 64;
const NPATH = paths.reduce((s, p) => s + p.pts.length, 0);
const CAP = ND + NPATH + 4096;
const ptData = new Float32Array(CAP * 7), blData = new Float32Array(CAP * 7);
let nPt = 0, nBl = 0;
const extraGlow = []; // soft glow requests from the 2D pass (sparks, receptor flashes)
function initGL() {
  try { gl = glCanvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' }); } catch (e) { gl = null; }
  if (!gl) return;
  const vs = 'attribute vec2 aPos;attribute vec4 aCol;attribute float aSize;uniform vec2 uScale;uniform vec2 uOff;varying vec4 vCol;void main(){gl_Position=vec4(aPos*uScale+uOff,0.0,1.0);gl_PointSize=aSize;vCol=aCol;}';
  const fs = 'precision mediump float;varying vec4 vCol;uniform float uSoft;void main(){vec2 d=gl_PointCoord-0.5;float r=length(d)*2.0;float a=uSoft>0.5?pow(max(0.0,1.0-r),2.2):1.0-smoothstep(0.75,1.0,r);gl_FragColor=vec4(vCol.rgb*vCol.a*a,vCol.a*a);}';
  const mk = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  try {
    glProg = gl.createProgram(); gl.attachShader(glProg, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(glProg, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(glProg);
    if (!gl.getProgramParameter(glProg, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glProg));
  } catch (e) { gl = null; return; }
  gl.useProgram(glProg);
  glLoc = { aPos: gl.getAttribLocation(glProg, 'aPos'), aCol: gl.getAttribLocation(glProg, 'aCol'), aSize: gl.getAttribLocation(glProg, 'aSize'), uScale: gl.getUniformLocation(glProg, 'uScale'), uOff: gl.getUniformLocation(glProg, 'uOff'), uSoft: gl.getUniformLocation(glProg, 'uSoft') };
  glBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
  gl.enableVertexAttribArray(glLoc.aPos); gl.enableVertexAttribArray(glLoc.aCol); gl.enableVertexAttribArray(glLoc.aSize);
  gl.vertexAttribPointer(glLoc.aPos, 2, gl.FLOAT, false, 28, 0); gl.vertexAttribPointer(glLoc.aCol, 4, gl.FLOAT, false, 28, 8); gl.vertexAttribPointer(glLoc.aSize, 1, gl.FLOAT, false, 28, 24);
  glMaxPt = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1] || 64;
  gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
}
glCanvas.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; });
glCanvas.addEventListener('webglcontextrestored', () => initGL());
initGL();
function pushPt(buf, n, x, y, r, g, b, a, size) { const o = n * 7; buf[o] = x; buf[o + 1] = y; buf[o + 2] = r; buf[o + 3] = g; buf[o + 4] = b; buf[o + 5] = a; buf[o + 6] = size > glMaxPt ? glMaxPt : size; }
function glow(h, x, y, r, alpha) { if (alpha <= 0.01) return; if (gl) { extraGlow.push(h, x, y, r, alpha); return; } gctx.globalAlpha = Math.min(1, alpha); gctx.drawImage(glowSprite(h), x - r, y - r, r * 2, r * 2); }

function buildCloud(now, F) {
  const modeHue = 262 + 136 * brain.modeMix, spec = F.spec, und = brain.undPhase;
  const zf = Math.pow(view.z, -0.35), gz = Math.pow(view.z, -0.5), sc = view.scale * view.dpr, ga = Math.min(1, 1.3 * gz);
  const drift = REDUCED ? 0 : 0.7;
  nPt = 0; nBl = 0;
  for (const r of regions) {
    const a0 = brain.act[r.i], fl = brain.flash[r.i], fh = brain.flashHue[r.i];
    const baseHue = r.limbic ? lerpHue(modeHue + r.hueOff, r.hue, 0.25) : r.hue;
    const isAud = r.id === 'auditory', undA = (r.limbic || r.id === 'accumbens') ? 0.2 : 0.06, undW = r.limbic ? 1 : 2.2;
    const flHue = fl > 0.04 && fh >= 0 ? lerpHue(baseHue, fh, clamp(fl, 0, 1) * 0.85) : baseHue;
    for (let i = r.start; i < r.end; i++) {
      let a = a0; const ph = D.phase[i];
      if (isAud) a += spec[(D.u[i] * 63) | 0] * 0.95;
      const sn = Math.sin(und * undW + ph + D.u[i] * 2.5);
      a += undA * sn * (0.4 + 0.6 * a0);
      a += fl * (0.65 + 0.35 * Math.sin(ph * 3 + now * 9));
      if (a < 0) a = 0; if (a > 1.1) a = 1.1; D.a[i] = a; D.hue[i] = flHue;
      const tone = D.tone[i];
      const c = hslRgb(flHue, r.sat + 8 * a - 10 * Math.max(0, tone), Math.min(86, r.light - 24 + tone * 13 + a * 30));
      const jx = drift * (0.3 + a) * Math.sin(now * 0.6 + ph * 7), jy = drift * (0.3 + a) * Math.cos(now * 0.45 + ph * 5);
      const x = D.x[i] + jx, y = D.y[i] + jy, size = D.size[i];
      pushPt(ptData, nPt++, x, y, c[0], c[1], c[2], 0.42 + 0.58 * Math.min(1, a), Math.max(1.6, 2 * size * (1 + 0.25 * a) * zf * sc));
      if (a > 0.36) pushPt(blData, nBl++, x, y, c[0], c[1], c[2], (a - 0.36) * 0.55 * ga, 2 * size * (3.2 + 4.5 * a) * gz * sc);
    }
  }
  for (const p of paths) {
    const h = p.hue, pts = p.pts, gl_ = p.glow;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i], g = gl_[i]; const c = hslRgb(h, 60 + 30 * g, 42 + 36 * g);
      pushPt(ptData, nPt++, q.x, q.y, c[0], c[1], c[2], 0.22 + 0.78 * Math.min(1, g), Math.max(1.2, 2 * q.r * (1 + 0.5 * g) * zf * sc));
      if (g > 0.15) pushPt(blData, nBl++, q.x, q.y, c[0], c[1], c[2], g * 0.6, (10 + 14 * g) * gz * sc);
    }
  }
  for (const pu of brain.pulses) {
    const pts = pu.p.pts, q = pts[clamp(Math.round(pu.t * (pts.length - 1)), 0, pts.length - 1)]; const c = hslRgb(pu.p.hue, 85, 65);
    pushPt(blData, nBl++, q.x, q.y, c[0], c[1], c[2], 0.9 * pu.i, (18 + 22 * pu.i) * gz * sc);
    const w = hslRgb(pu.p.hue, 60, 92); pushPt(ptData, nPt++, q.x, q.y, w[0], w[1], w[2], 1, Math.max(2, 2 * (1.8 + pu.i) * zf * sc));
  }
  for (let k = 0; k < extraGlow.length; k += 5) { const c = hslRgb(extraGlow[k], 90, 68); pushPt(blData, nBl++, extraGlow[k + 1], extraGlow[k + 2], c[0], c[1], c[2], extraGlow[k + 4] * 0.9, 2 * extraGlow[k + 3] * sc * 1.2); }
  extraGlow.length = 0;
}
function drawGL() {
  gl.viewport(0, 0, glCanvas.width, glCanvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  const sx = 2 * view.scale / view.w, sy = -2 * view.scale / view.h;
  gl.uniform2f(glLoc.uScale, sx, sy); gl.uniform2f(glLoc.uOff, -view.cx * sx, -view.cy * sy);
  gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
  gl.uniform1f(glLoc.uSoft, 1); gl.bufferData(gl.ARRAY_BUFFER, blData.subarray(0, nBl * 7), gl.DYNAMIC_DRAW); gl.drawArrays(gl.POINTS, 0, nBl);
  gl.uniform1f(glLoc.uSoft, 0); gl.bufferData(gl.ARRAY_BUFFER, ptData.subarray(0, nPt * 7), gl.DYNAMIC_DRAW); gl.drawArrays(gl.POINTS, 0, nPt);
}

// ---- 2D fallback for the clouds (used only without WebGL) ----
const glowLayer = document.createElement('canvas'); const gctx = glowLayer.getContext('2d'); const GL = 3;
const blurLayer = document.createElement('canvas'); const bctx = blurLayer.getContext('2d'); const HAS_FILTER = 'filter' in bctx;
function beginGlow() {
  const gw = Math.max(1, Math.ceil(canvas.width / GL)), gh = Math.max(1, Math.ceil(canvas.height / GL));
  if (glowLayer.width !== gw || glowLayer.height !== gh) { glowLayer.width = gw; glowLayer.height = gh; }
  gctx.setTransform(1, 0, 0, 1, 0, 0); gctx.globalCompositeOperation = 'source-over'; gctx.clearRect(0, 0, gw, gh); gctx.globalCompositeOperation = 'lighter';
  const sc = view.scale * view.dpr / GL, ox = (view.w / 2 - view.cx * view.scale) * view.dpr / GL, oy = (view.h / 2 - view.cy * view.scale) * view.dpr / GL;
  gctx.setTransform(sc, 0, 0, sc, ox, oy);
}
function endGlow() {
  let src = glowLayer;
  if (HAS_FILTER) { const gw = glowLayer.width, gh = glowLayer.height; if (blurLayer.width !== gw || blurLayer.height !== gh) { blurLayer.width = gw; blurLayer.height = gh; } bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.globalCompositeOperation = 'copy'; bctx.globalAlpha = 1; bctx.filter = 'blur(' + (2.6 * Math.pow(view.z, -0.25)).toFixed(2) + 'px)'; bctx.drawImage(glowLayer, 0, 0); bctx.filter = 'none'; src = blurLayer; }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1; ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
}
function drawClouds2D(now, F) {
  buildCloud(now, F); // reuse the same per-dot colours
  ctx.globalCompositeOperation = 'lighter'; const sc = view.scale * view.dpr;
  for (let i = 0; i < nPt; i++) { const o = i * 7; ctx.fillStyle = `rgb(${(ptData[o + 2] * 255) | 0},${(ptData[o + 3] * 255) | 0},${(ptData[o + 4] * 255) | 0})`; ctx.globalAlpha = ptData[o + 5]; ctx.beginPath(); ctx.arc(ptData[o], ptData[o + 1], ptData[o + 6] / sc / 2, 0, TAU); ctx.fill(); }
  for (let i = 0; i < nBl; i++) { const o = i * 7; gctx.globalAlpha = blData[o + 5]; gctx.fillStyle = `rgb(${(blData[o + 2] * 255) | 0},${(blData[o + 3] * 255) | 0},${(blData[o + 4] * 255) | 0})`; gctx.beginPath(); gctx.arc(blData[o], blData[o + 1], blData[o + 6] / sc / 3, 0, TAU); gctx.fill(); }
  ctx.globalAlpha = 1;
}

// ---- skull, synapses, labels, neuron detail (2D) ----
const skullPoly = catmull(SKULL.outline, true, 10), mandiblePoly = catmull(SKULL.mandible, false, 8), zygPoly = catmull(SKULL.zygomatic, false, 8);
function tracePoly(poly, close) { ctx.beginPath(); ctx.moveTo(poly[0][0], poly[0][1]); for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]); if (close) ctx.closePath(); }
function drawSkull(front) {
  const px = 1 / view.scale;
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  if (!front) { tracePoly(skullPoly, true); ctx.fillStyle = 'rgba(120,170,255,0.045)'; ctx.fill(); return; }
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  tracePoly(skullPoly, true); ctx.lineWidth = 1.6 * Math.max(1, px * 1.2); ctx.strokeStyle = 'rgba(156,192,255,0.30)'; ctx.stroke();
  ctx.lineWidth = 5 * Math.max(1, px); ctx.strokeStyle = 'rgba(156,192,255,0.05)'; ctx.stroke();
  ctx.lineWidth = 1.1 * Math.max(1, px * 1.2); ctx.strokeStyle = 'rgba(156,192,255,0.22)';
  const o = SKULL.orbit; ctx.beginPath(); ctx.ellipse(o[0], o[1], o[2], o[3], o[4], 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(112, 452); ctx.quadraticCurveTo(132, 440, 138, 470); ctx.quadraticCurveTo(126, 492, 110, 482); ctx.stroke();
  tracePoly(zygPoly, false); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(118, 492); ctx.quadraticCurveTo(128, 548, 158, 586); ctx.stroke();
  tracePoly(mandiblePoly, false); ctx.stroke();
  for (const s of SKULL.sutures) { ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]); ctx.quadraticCurveTo(s[1][0], s[1][1], s[2][0], s[2][1]); ctx.stroke(); }
  const t = SKULL.teeth, tw = (t.x1 - t.x0) / t.n;
  ctx.strokeStyle = 'rgba(156,192,255,0.2)';
  for (let i = 0; i < t.n; i++) { const x = t.x0 + i * tw + 1.5; ctx.beginPath(); ctx.roundRect(x, t.y - 11, tw - 3, 11, 2); ctx.stroke(); ctx.beginPath(); ctx.roundRect(x + 2, t.y + 2, tw - 3, 10, 2); ctx.stroke(); }
  ctx.globalAlpha = 1;
}
const CONN_HUE = { melody: 172, chord: 48, sample: 305 };
function drawConnections(now) {
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; const zf = Math.pow(view.z, -0.35);
  for (const c of brain.conns) {
    const ax = D.x[c.a], ay = D.y[c.a], bx = D.x[c.b], by = D.y[c.b]; const mx = (ax + bx) / 2, my = (ay + by) / 2; const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1; const cxp = mx - dy / L * c.bend, cyp = my + dx / L * c.bend;
    const h = CONN_HUE[c.kind] || 200;
    ctx.globalAlpha = 0.12 + 0.5 * c.s; ctx.strokeStyle = hsl(h, 70, 60 + 15 * c.s); ctx.lineWidth = (0.7 + 1.3 * c.s) * zf * zf;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cxp, cyp, bx, by); ctx.stroke();
    if (c.spark >= 0) { const t = c.spark, u = 1 - t; const sx = u * u * ax + 2 * u * t * cxp + t * t * bx, sy = u * u * ay + 2 * u * t * cyp + t * t * by; glow(h, sx, sy, 10 * Math.pow(view.z, -0.5), 0.9); ctx.globalAlpha = 0.9; ctx.fillStyle = hsl(h, 60, 95); ctx.beginPath(); ctx.arc(sx, sy, 1.8 * zf, 0, TAU); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
}
function drawLabels() {
  const z = view.z; if (z < 1.25) return;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.textBaseline = 'middle';
  ctx.font = 'italic 500 15px "Cormorant Garamond", Georgia, serif';
  const sc = view.scale, ox = view.w / 2 - view.cx * sc, oy = view.h / 2 - view.cy * sc;
  for (const r of regions) {
    if (r.small && z < 2.4) continue;
    const sx = r.cx * sc + ox, sy = r.cy * sc + oy;
    if (sx < -120 || sx > view.w + 120 || sy < -30 || sy > view.h + 30) continue;
    const al = clamp((z - 1.2) / 0.8, 0, 1) * 0.62;
    let lx = sx, ly = sy;
    if (r.label) { lx += r.label[0] * 2.2; ly += r.label[1]; ctx.strokeStyle = `rgba(215,228,255,${al * 0.5})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx + 8, sy); ctx.lineTo(lx - 2, ly); ctx.stroke(); ctx.textAlign = 'left'; lx += 2; }
    else ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(215,228,255,${al})`; ctx.fillText(r.name, lx, ly);
  }
}
// receptor-level detail when zoomed in
const details = new Map();
function getDetail(i, now) {
  let d = details.get(i);
  if (!d) {
    const rng = mulberry32(D.seed[i]); const nd = 3 + Math.floor(rng() * 3); const dend = [];
    for (let k = 0; k < nd; k++) dend.push({ a: rng() * TAU, l: 4 + rng() * 5, c: (rng() - 0.5) * 1.4 });
    const nr = 4 + Math.floor(rng() * 3);
    d = { dend, ax: rng() * TAU, nr, rec: new Float32Array(nr), parts: [], seen: now, acc: rng() };
    details.set(i, d);
  }
  d.seen = now; return d;
}
function recGlyph(nt, x, y, s, ang) {
  ctx.beginPath();
  if (nt === 'da') { ctx.arc(x, y, s, ang + 0.6, ang + TAU - 0.6); }
  else if (nt === 'ne') { ctx.moveTo(x + Math.cos(ang) * s * 1.3, y + Math.sin(ang) * s * 1.3); ctx.lineTo(x + Math.cos(ang + 2.3) * s, y + Math.sin(ang + 2.3) * s); ctx.lineTo(x + Math.cos(ang - 2.3) * s, y + Math.sin(ang - 2.3) * s); ctx.closePath(); }
  else if (nt === 'ht') { for (let k = 0; k < 6; k++) { const a = ang + k / 6 * TAU, px = x + Math.cos(a) * s, py = y + Math.sin(a) * s; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); }
  else { const c = Math.cos(ang), sn = Math.sin(ang); ctx.moveTo(x - sn * s, y + c * s); ctx.lineTo(x + sn * s, y - c * s); }
}
function drawDetails(now, dt) {
  const z = view.z, fade = smoothstep(2.6, 4.0, z); if (fade <= 0) return; const zf = Math.pow(z, -0.35) * 1.5;
  const [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(view.w, view.h); const mcx = (x0 + x1) / 2, mcy = (y0 + y1) / 2; const maxD = Math.hypot(x1 - x0, y1 - y0) / 2;
  const vis = [];
  for (let i = 0; i < ND; i++) { const x = D.x[i], y = D.y[i]; if (x < x0 - 12 || x > x1 + 12 || y < y0 - 12 || y > y1 + 12) continue; vis.push(i); }
  if (vis.length > 260) { vis.sort((a, b) => ((D.x[a] - mcx) ** 2 + (D.y[a] - mcy) ** 2) - ((D.x[b] - mcx) ** 2 + (D.y[b] - mcy) ** 2)); vis.length = 260; }
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const i of vis) {
    const r = regions[D.reg[i]], nt = r.nt, ntc = NT[nt], d = getDetail(i, now);
    const x = D.x[i], y = D.y[i], Rr = D.size[i] * 1.5 * zf, a = D.a[i], hue = D.hue[i];
    const focus = 1 - smoothstep(0.55, 1, Math.hypot(x - mcx, y - mcy) / maxD); const al = fade * focus; if (al <= 0.03) continue;
    ctx.strokeStyle = hsl(hue, 50, 62); ctx.lineWidth = 0.4; ctx.globalAlpha = al * (0.3 + 0.3 * a);
    for (const dn of d.dend) { const dl = dn.l * zf; const ex = x + Math.cos(dn.a) * (Rr + dl), ey = y + Math.sin(dn.a) * (Rr + dl); const cxp = x + Math.cos(dn.a + dn.c) * (Rr + dl * 0.55), cyp = y + Math.sin(dn.a + dn.c) * (Rr + dl * 0.55); ctx.beginPath(); ctx.moveTo(x + Math.cos(dn.a) * Rr * 0.9, y + Math.sin(dn.a) * Rr * 0.9); ctx.quadraticCurveTo(cxp, cyp, ex, ey); ctx.stroke(); }
    const bx = x + Math.cos(d.ax) * Rr * 3.4, by = y + Math.sin(d.ax) * Rr * 3.4, br = Rr * 0.85;
    ctx.strokeStyle = hsl(ntc.hue, 60, 60); ctx.lineWidth = 0.5; ctx.globalAlpha = al * 0.35;
    ctx.beginPath(); ctx.moveTo(bx + Math.cos(d.ax) * br, by + Math.sin(d.ax) * br); ctx.lineTo(bx + Math.cos(d.ax) * (br + Rr * 2.4), by + Math.sin(d.ax) * (br + Rr * 2.4)); ctx.stroke();
    ctx.fillStyle = hsl(ntc.hue, 70, 55); ctx.globalAlpha = al * 0.28; ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
    ctx.globalAlpha = al * 0.9; ctx.fillStyle = hsl(ntc.hue, 85, 72);
    for (let k = 0; k < 3; k++) { const a2 = d.ax + Math.PI + (k - 1) * 0.9, rr = br * 0.45; ctx.beginPath(); ctx.arc(bx + Math.cos(a2) * rr, by + Math.sin(a2) * rr, br * 0.16, 0, TAU); ctx.fill(); }
    const mr = Rr * 1.25, spread = 1.25;
    ctx.strokeStyle = hsl(hue, 50, 70); ctx.lineWidth = 0.35; ctx.globalAlpha = al * 0.45; ctx.beginPath(); ctx.arc(x, y, mr, d.ax - spread * 0.62, d.ax + spread * 0.62); ctx.stroke();
    const recAct = brain.recept[r.i] + (nt === 'glu' ? Math.max(0, a - 0.3) * 1.5 : 0);
    const recPos = [];
    for (let k = 0; k < d.nr; k++) {
      const ang = d.ax + (d.nr > 1 ? (k / (d.nr - 1) - 0.5) * spread : 0); const rx = x + Math.cos(ang) * mr, ry = y + Math.sin(ang) * mr; recPos.push([rx, ry]);
      const g = d.rec[k]; d.rec[k] *= Math.exp(-dt / 0.45);
      const gs = Rr * 0.26 * (1 + 0.6 * g);
      ctx.lineWidth = 0.45 + 0.35 * g; ctx.strokeStyle = hsl(ntc.hue, 80, 60 + 30 * g); ctx.globalAlpha = al * (0.45 + 0.55 * g); recGlyph(nt, rx, ry, gs, ang); ctx.stroke();
      if (g > 0.05) glow(ntc.hue, rx, ry, Rr * (0.9 + 1.4 * g), al * g * 0.9);
    }
    if ((!REDUCED || recAct > 0.6) && al > 0.2) { d.acc += dt * (0.25 + 4.5 * recAct); while (d.acc > 1) { d.acc -= 1; if (d.parts.length < 6) d.parts.push({ k: Math.floor(Math.random() * d.nr), t: 0, st: 0, dock: 0, sp: 2.2 + Math.random() * 1.2, wob: Math.random() * TAU }); } }
    for (let j = d.parts.length - 1; j >= 0; j--) {
      const pt = d.parts[j], [rx, ry] = recPos[pt.k];
      if (pt.st === 0) { pt.t += dt * pt.sp; if (pt.t >= 1) { pt.t = 1; pt.st = 1; pt.dock = 0; d.rec[pt.k] = 1; } }
      else if (pt.st === 1) { pt.dock += dt; if (pt.dock > 0.3) { if (nt === 'glu') { d.parts.splice(j, 1); continue; } pt.st = 2; } }
      else { pt.t -= dt * pt.sp * 0.8; if (pt.t <= 0) { d.parts.splice(j, 1); continue; } }
      const e = pt.t * pt.t * (3 - 2 * pt.t); const wob = Math.sin(now * 14 + pt.wob) * Rr * 0.18 * (1 - e);
      const px = lerp(bx, rx, e) + Math.cos(d.ax + Math.PI / 2) * wob, py = lerp(by, ry, e) + Math.sin(d.ax + Math.PI / 2) * wob;
      ctx.globalAlpha = al * (pt.st === 2 ? 0.55 : 0.95); ctx.fillStyle = hsl(ntc.hue, 90, 80); ctx.beginPath(); ctx.arc(px, py, Rr * 0.15, 0, TAU); ctx.fill();
    }
  }
  if (details.size > 1200) for (const [k, d] of details) if (now - d.seen > 3) details.delete(k);
  ctx.globalAlpha = 1;
}
function render(now, dt, F, active) {
  const { w, h, dpr } = view;
  const sc = view.scale, ox = w / 2 - view.cx * sc, oy = h / 2 - view.cy * sc;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * ox, dpr * oy);
  drawSkull(false);
  if (gl) {
    drawConnections(now); drawDetails(now, dt);   // these queue glows for the GL pass
    buildCloud(now, F); drawGL();
  } else {
    beginGlow(); drawClouds2D(now, F); drawConnections(now); drawDetails(now, dt); endGlow();
    ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * ox, dpr * oy);
  }
  drawSkull(true);
  drawLabels();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
