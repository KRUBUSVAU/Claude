
// ---------- renderer ----------
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d', { alpha: false });
const view = { w: 1, h: 1, dpr: 1, base: 1, scale: 1, z: 1, cx: 505, cy: 415, tz: 1, tcx: 505, tcy: 415, animating: false };
const WORLD = { w: 1000, h: 820 };
view.dprCap = 2;
function resize() {
  view.dpr = Math.min(view.dprCap, window.devicePixelRatio || 1); view.w = canvas.clientWidth; view.h = canvas.clientHeight;
  canvas.width = Math.round(view.w * view.dpr); canvas.height = Math.round(view.h * view.dpr);
  view.base = Math.min(view.w / WORLD.w, view.h / WORLD.h) * 0.97; view.scale = view.base * view.z;
}
window.addEventListener('resize', resize); resize();
function clampCam() { view.cx = clamp(view.cx, 60, 940); view.cy = clamp(view.cy, 60, 760); view.z = clamp(view.z, 1, 18); view.scale = view.base * view.z; }
function toWorld(sx, sy) { return [view.cx + (sx - view.w / 2) / view.scale, view.cy + (sy - view.h / 2) / view.scale]; }
function zoomAt(factor, sx, sy) { const [wx, wy] = toWorld(sx, sy); view.z = clamp(view.z * factor, 1, 18); view.scale = view.base * view.z; view.cx = wx - (sx - view.w / 2) / view.scale; view.cy = wy - (sy - view.h / 2) / view.scale; view.animating = false; clampCam(); }
function flyTo(cx, cy, z) { view.tcx = cx; view.tcy = cy; view.tz = z; view.animating = true; }

const colorCache = new Map();
function hsl(h, s, l) { const hq = ((h % 360 + 360) % 360 / 3) | 0, sq = (clamp(s, 0, 100) / 5) | 0, lq = (clamp(l, 0, 100) / 2) | 0; const key = hq * 100000 + sq * 1000 + lq; let v = colorCache.get(key); if (!v) { v = `hsl(${hq * 3},${sq * 5}%,${lq * 2}%)`; colorCache.set(key, v); } return v; }
const sprites = new Map();
function glowSprite(h) {
  const b = ((h % 360 + 360) % 360 / 12) | 0; let s = sprites.get(b);
  if (!s) { s = document.createElement('canvas'); s.width = s.height = 64; const c = s.getContext('2d'); const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, `hsla(${b * 12},90%,72%,1)`); g.addColorStop(0.25, `hsla(${b * 12},90%,65%,.45)`); g.addColorStop(1, `hsla(${b * 12},90%,60%,0)`); c.fillStyle = g; c.fillRect(0, 0, 64, 64); sprites.set(b, s); }
  return s;
}
// low-resolution additive glow layer (glows are soft, so a third of the resolution is plenty and far cheaper)
const glowLayer = document.createElement('canvas'); const gctx = glowLayer.getContext('2d'); const GL = 3;
function beginGlow() {
  const gw = Math.max(1, Math.ceil(canvas.width / GL)), gh = Math.max(1, Math.ceil(canvas.height / GL));
  if (glowLayer.width !== gw || glowLayer.height !== gh) { glowLayer.width = gw; glowLayer.height = gh; }
  gctx.setTransform(1, 0, 0, 1, 0, 0); gctx.globalCompositeOperation = 'source-over'; gctx.clearRect(0, 0, gw, gh); gctx.globalCompositeOperation = 'lighter';
  const sc = view.scale * view.dpr / GL, ox = (view.w / 2 - view.cx * view.scale) * view.dpr / GL, oy = (view.h / 2 - view.cy * view.scale) * view.dpr / GL;
  gctx.setTransform(sc, 0, 0, sc, ox, oy);
}
function glow(h, x, y, r, alpha) { if (alpha <= 0.01) return; gctx.globalAlpha = Math.min(1, alpha); gctx.drawImage(glowSprite(h), x - r, y - r, r * 2, r * 2); }
const blurLayer = document.createElement('canvas'); const bctx = blurLayer.getContext('2d'); const HAS_FILTER = 'filter' in bctx;
function endGlow() {
  let src = glowLayer;
  if (HAS_FILTER) {
    const gw = glowLayer.width, gh = glowLayer.height; if (blurLayer.width !== gw || blurLayer.height !== gh) { blurLayer.width = gw; blurLayer.height = gh; }
    bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.globalCompositeOperation = 'copy'; bctx.globalAlpha = 1; bctx.filter = 'blur(' + (2.6 * Math.pow(view.z, -0.25)).toFixed(2) + 'px)'; bctx.drawImage(glowLayer, 0, 0); bctx.filter = 'none'; src = blurLayer;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1; ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
}
let bgGrad = null, bgKey = '';
function drawBackground() {
  const key = view.w + 'x' + view.h;
  if (key !== bgKey) { bgKey = key; bgGrad = ctx.createRadialGradient(view.w * 0.5, view.h * 0.45, 10, view.w * 0.5, view.h * 0.45, Math.max(view.w, view.h) * 0.7); bgGrad.addColorStop(0, '#0a1020'); bgGrad.addColorStop(1, '#04060b'); }
  ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, view.w, view.h);
}
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
function drawPathways(now) {
  ctx.globalCompositeOperation = 'lighter'; const gz = Math.pow(view.z, -0.5), zf = Math.pow(view.z, -0.35);
  for (const p of paths) {
    const h = p.hue, pts = p.pts, gl = p.glow;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i], g = gl[i], a = 0.22 + 0.78 * Math.min(1, g);
      ctx.globalAlpha = a; ctx.fillStyle = hsl(h, 60 + 30 * g, 42 + 36 * g); ctx.beginPath(); ctx.arc(q.x, q.y, q.r * (1 + 0.5 * g) * zf, 0, TAU); ctx.fill();
      if (g > 0.15) glow(h, q.x, q.y, (6 + 9 * g) * gz, g * 0.75);
    }
  }
  for (const pu of brain.pulses) {
    const pts = pu.p.pts; const idx = clamp(Math.round(pu.t * (pts.length - 1)), 0, pts.length - 1); const q = pts[idx]; const gr = 9 + 11 * pu.i;
    glow(pu.p.hue, q.x, q.y, gr * gz, 0.9 * pu.i);
    ctx.globalAlpha = 1; ctx.fillStyle = hsl(pu.p.hue, 60, 92); ctx.beginPath(); ctx.arc(q.x, q.y, (1.8 + pu.i) * zf, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
const CONN_HUE = { melody: 172, chord: 48, sample: 305 };
function drawConnections(now) {
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; const zf = Math.pow(view.z, -0.35);
  for (const c of brain.conns) {
    const ax = D.x[c.a], ay = D.y[c.a], bx = D.x[c.b], by = D.y[c.b]; const mx = (ax + bx) / 2, my = (ay + by) / 2; const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1; const cxp = mx - dy / L * c.bend, cyp = my + dx / L * c.bend;
    const h = CONN_HUE[c.kind] || 200;
    ctx.globalAlpha = 0.12 + 0.5 * c.s; ctx.strokeStyle = hsl(h, 70, 60 + 15 * c.s); ctx.lineWidth = (0.7 + 1.3 * c.s) * zf;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cxp, cyp, bx, by); ctx.stroke();
    if (c.spark >= 0) { const t = c.spark, u = 1 - t; const sx = u * u * ax + 2 * u * t * cxp + t * t * bx, sy = u * u * ay + 2 * u * t * cyp + t * t * by; glow(h, sx, sy, 10 * Math.pow(view.z, -0.5), 0.9); ctx.globalAlpha = 0.9; ctx.fillStyle = hsl(h, 60, 95); ctx.beginPath(); ctx.arc(sx, sy, 1.8 * Math.pow(view.z, -0.35), 0, TAU); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
}
const keyBuf = new Int32Array(ND); const styleCache = new Map();
function dotStyle(k) { let s = styleCache.get(k); if (!s) { const lq = k % 51, rest = (k - lq) / 51, sq = rest % 21, hq = (rest - sq) / 21; s = `hsl(${hq * 3},${sq * 5}%,${lq * 2}%)`; styleCache.set(k, s); } return s; }
function drawDots(now, F, active) {
  const modeHue = 262 + 136 * brain.modeMix, spec = F.spec, und = brain.undPhase;
  const zf = Math.pow(view.z, -0.35), gz = Math.pow(view.z, -0.5);
  // pass 1: activation and colour key per dot
  for (const r of regions) {
    const a0 = brain.act[r.i], fl = brain.flash[r.i], fh = brain.flashHue[r.i];
    const baseHue = r.limbic ? lerpHue(modeHue + r.hueOff, r.hue, 0.25) : r.hue;
    const isAud = r.id === 'auditory', undA = (r.limbic || r.id === 'accumbens') ? 0.2 : 0.06, undW = r.limbic ? 1 : 2.2;
    const flHue = fl > 0.04 && fh >= 0 ? lerpHue(baseHue, fh, clamp(fl, 0, 1) * 0.85) : baseHue;
    const hq = ((flHue % 360 + 360) % 360 / 3) | 0;
    for (let i = r.start; i < r.end; i++) {
      let a = a0;
      if (isAud) a += spec[(D.u[i] * 63) | 0] * 0.95;
      a += undA * Math.sin(und * undW + D.phase[i] + D.u[i] * 2.5) * (0.4 + 0.6 * a0);
      a += fl * (0.65 + 0.35 * Math.sin(D.phase[i] * 3 + now * 9));
      if (a < 0) a = 0; if (a > 1.1) a = 1.1; D.a[i] = a; D.hue[i] = flHue;
      const tone = D.tone[i];
      const sq = clamp((r.sat + 8 * a - 10 * Math.max(0, tone)) / 5, 0, 20) | 0, lq = clamp((r.light - 24 + tone * 13 + a * 30) / 2, 0, 44) | 0;
      keyBuf[i] = (hq * 21 + sq) * 51 + lq;
    }
  }
  // pass 2: one fill per colour on the main canvas, and one bloom fill per colour on the low-res layer
  const buckets = new Map();
  for (let i = 0; i < ND; i++) { const k = keyBuf[i]; let arr = buckets.get(k); if (!arr) { arr = []; buckets.set(k, arr); } arr.push(i); }
  ctx.globalCompositeOperation = 'lighter';
  const ga = Math.min(1, 1.3 * gz);
  for (const [k, arr] of buckets) {
    const style = dotStyle(k), i0 = arr[0], a0 = D.a[i0];
    ctx.fillStyle = style; ctx.beginPath();
    for (let j = 0; j < arr.length; j++) { const i = arr[j], rr = D.size[i] * (1 + 0.25 * D.a[i]) * zf, x = D.x[i], y = D.y[i]; ctx.moveTo(x + rr, y); ctx.arc(x, y, rr, 0, TAU); }
    ctx.globalAlpha = 0.5 + 0.5 * Math.min(1, a0); ctx.fill();
    if (a0 > 0.36) {
      if (HAS_FILTER) {
        gctx.fillStyle = style; gctx.globalAlpha = (a0 - 0.36) * 0.9 * ga; gctx.beginPath();
        for (let j = 0; j < arr.length; j++) { const i = arr[j], rr = D.size[i] * (1.5 + 2.4 * D.a[i]) * gz, x = D.x[i], y = D.y[i]; gctx.moveTo(x + rr, y); gctx.arc(x, y, rr, 0, TAU); }
        gctx.fill();
      } else for (let j = 0; j < arr.length; j++) { const i = arr[j]; glow(D.hue[i], D.x[i], D.y[i], D.size[i] * (2.6 + 4 * D.a[i]) * gz, (a0 - 0.36) * 0.75 * ga); }
    }
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
// ---- receptor-level detail when zoomed in ----
const details = new Map();
function getDetail(i, now) {
  let d = details.get(i);
  if (!d) {
    const rng = mulberry32(D.seed[i]); const nd = 3 + Math.floor(rng() * 3); const dend = [];
    for (let k = 0; k < nd; k++) dend.push({ a: rng() * TAU, l: 4 + rng() * 5, c: (rng() - 0.5) * 1.4 });
    const nr = 4 + Math.floor(rng() * 3);
    d = { dend, ax: rng() * TAU, nr, rec: new Float32Array(nr), parts: [], seen: now, acc: rng(), rng };
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
  const z = view.z, fade = smoothstep(2.6, 4.0, z); if (fade <= 0) return; const zf = Math.pow(z, -0.35) * 1.35;
  const [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(view.w, view.h); const mcx = (x0 + x1) / 2, mcy = (y0 + y1) / 2; const maxD = Math.hypot(x1 - x0, y1 - y0) / 2;
  const vis = [];
  for (let i = 0; i < ND; i++) { const x = D.x[i], y = D.y[i]; if (x < x0 - 12 || x > x1 + 12 || y < y0 - 12 || y > y1 + 12) continue; vis.push(i); }
  if (vis.length > 240) { vis.sort((a, b) => ((D.x[a] - mcx) ** 2 + (D.y[a] - mcy) ** 2) - ((D.x[b] - mcx) ** 2 + (D.y[b] - mcy) ** 2)); vis.length = 240; }
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const i of vis) {
    const r = regions[D.reg[i]], nt = r.nt, ntc = NT[nt], d = getDetail(i, now);
    const x = D.x[i], y = D.y[i], Rr = D.size[i] * 1.5 * zf, a = D.a[i], hue = D.hue[i];
    const focus = 1 - smoothstep(0.55, 1, Math.hypot(x - mcx, y - mcy) / maxD); const al = fade * focus; if (al <= 0.02) continue;
    // dendrites
    ctx.strokeStyle = hsl(hue, 50, 62); ctx.lineWidth = 0.4; ctx.globalAlpha = al * (0.3 + 0.3 * a);
    for (const dn of d.dend) { const dl = dn.l * zf; const ex = x + Math.cos(dn.a) * (Rr + dl), ey = y + Math.sin(dn.a) * (Rr + dl); const cxp = x + Math.cos(dn.a + dn.c) * (Rr + dl * 0.55), cyp = y + Math.sin(dn.a + dn.c) * (Rr + dl * 0.55); ctx.beginPath(); ctx.moveTo(x + Math.cos(dn.a) * Rr * 0.9, y + Math.sin(dn.a) * Rr * 0.9); ctx.quadraticCurveTo(cxp, cyp, ex, ey); ctx.stroke(); }
    // presynaptic bouton + axon
    const bx = x + Math.cos(d.ax) * Rr * 3.4, by = y + Math.sin(d.ax) * Rr * 3.4, br = Rr * 0.85;
    ctx.strokeStyle = hsl(ntc.hue, 60, 60); ctx.lineWidth = 0.5; ctx.globalAlpha = al * 0.35;
    ctx.beginPath(); ctx.moveTo(bx + Math.cos(d.ax) * br, by + Math.sin(d.ax) * br); ctx.lineTo(bx + Math.cos(d.ax) * (br + Rr * 2.4), by + Math.sin(d.ax) * (br + Rr * 2.4)); ctx.stroke();
    ctx.fillStyle = hsl(ntc.hue, 70, 55); ctx.globalAlpha = al * 0.28; ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
    ctx.globalAlpha = al * 0.9; ctx.fillStyle = hsl(ntc.hue, 85, 72);
    for (let k = 0; k < 3; k++) { const a2 = d.ax + Math.PI + (k - 1) * 0.9, rr = br * 0.45; ctx.beginPath(); ctx.arc(bx + Math.cos(a2) * rr, by + Math.sin(a2) * rr, br * 0.16, 0, TAU); ctx.fill(); }
    // postsynaptic membrane with receptors
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
    // molecules crossing the cleft
    if (!REDUCED || recAct > 0.6) { d.acc += dt * (0.25 + 4.5 * recAct); while (d.acc > 1) { d.acc -= 1; if (d.parts.length < 6) d.parts.push({ k: Math.floor(Math.random() * d.nr), t: 0, st: 0, dock: 0, sp: 2.2 + Math.random() * 1.2, wob: Math.random() * TAU }); } }
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
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  drawBackground();
  const sc = view.scale, ox = w / 2 - view.cx * sc, oy = h / 2 - view.cy * sc;
  ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * ox, dpr * oy);
  beginGlow();
  drawSkull(false);
  drawPathways(now);
  drawConnections(now);
  drawDots(now, F, active);
  drawDetails(now, dt);
  endGlow();
  ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * ox, dpr * oy);
  drawSkull(true);
  drawLabels();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
