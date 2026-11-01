// Generates the app icons as PNGs with no dependencies (tiny PNG encoder + procedural dot-brain).
// Run: node tools/make-icons.js
const fs = require('fs'), path = require('path'), zlib = require('zlib');
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(w, h, rgba) { const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); } const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]); }
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hslToRgb(h, s, l) { h = ((h % 360) + 360) % 360 / 360; s /= 100; l /= 100; const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; const f = t => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }; return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]; }
function render(size, maskable) {
  const S = 3, W = size * S; const buf = new Float32Array(W * W * 3); const alpha = new Float32Array(W * W);
  const pad = maskable ? 0 : 0.08 * W, radius = maskable ? 0 : 0.22 * W;
  // background: rounded square (or full square for maskable), deep navy with a soft radial glow
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let inside = true;
    if (!maskable) { const cx = Math.max(pad + radius - x, 0, x - (W - pad - radius)), cy = Math.max(pad + radius - y, 0, y - (W - pad - radius)); inside = x >= pad && x < W - pad && y >= pad && y < W - pad && (cx * cx + cy * cy <= radius * radius); }
    if (!inside) continue; alpha[i] = 1;
    const dx = (x - W * 0.5) / W, dy = (y - W * 0.46) / W, d = Math.sqrt(dx * dx + dy * dy); const g = Math.max(0, 1 - d * 2.2);
    buf[i * 3] = 5 + 10 * g; buf[i * 3 + 1] = 7 + 14 * g; buf[i * 3 + 2] = 13 + 28 * g;
  }
  // brain: an ellipse of dots split into coloured clusters, with a translucent skull ring
  const rng = mulberry32(7); const cx = W * 0.5, cy = W * 0.47, rx = W * 0.33, ry = W * 0.27;
  const clusters = [[262, -0.55, -0.1], [12, -0.1, -0.45], [196, 0.35, -0.35], [222, 0.7, 0.05], [168, 0.05, 0.25], [318, -0.15, 0.45], [40, 0.5, 0.45], [300, 0.8, 0.5]];
  const dots = []; const minD = W * 0.028;
  for (let tries = 0; tries < 60000 && dots.length < 520; tries++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()); const x = cx + Math.cos(a) * r * rx, y = cy + Math.sin(a) * r * ry * (y => 1)(0);
    if (y > cy + ry * 0.75 && x < cx - rx * 0.15) continue; // notch under the frontal lobe (temporal pole)
    let ok = true; for (const d of dots) { if ((d.x - x) ** 2 + (d.y - y) ** 2 < minD * minD) { ok = false; break; } } if (!ok) continue;
    const nx = (x - cx) / rx, ny = (y - cy) / ry; let best = 0, bd = 1e9; clusters.forEach((c, k) => { const dd = (nx - c[1]) ** 2 + (ny - c[2]) ** 2; if (dd < bd) { bd = dd; best = k; } });
    const hue = clusters[best][0], tone = rng() * 2 - 1, bright = rng() < 0.12; dots.push({ x, y, hue, l: 52 + tone * 14 + (bright ? 30 : 0), s: 70, rad: W * (0.011 + rng() * 0.007), glow: bright });
  }
  const put = (x, y, r, rgb, a0, soft) => { const x0 = Math.max(0, Math.floor(x - r - 1)), x1 = Math.min(W - 1, Math.ceil(x + r + 1)), y0 = Math.max(0, Math.floor(y - r - 1)), y1 = Math.min(W - 1, Math.ceil(y + r + 1)); for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) { const d = Math.hypot(xx - x, yy - y); let a = soft ? Math.max(0, 1 - d / r) ** 2 : Math.min(1, Math.max(0, r - d + 0.5)); a *= a0; if (a <= 0) continue; const i = yy * W + xx; if (alpha[i] === 0) continue; buf[i * 3] = Math.min(255, buf[i * 3] + rgb[0] * a); buf[i * 3 + 1] = Math.min(255, buf[i * 3 + 1] + rgb[1] * a); buf[i * 3 + 2] = Math.min(255, buf[i * 3 + 2] + rgb[2] * a); } };
  // skull ring
  for (let a = 0; a < Math.PI * 2; a += 0.004) { const x = cx + Math.cos(a) * rx * 1.22, y = cy + Math.sin(a) * ry * 1.28 + W * 0.01; put(x, y, W * 0.006, [120, 160, 255], 0.08, false); }
  for (const d of dots) { if (d.glow) put(d.x, d.y, d.rad * 4, hslToRgb(d.hue, 90, 60), 0.35, true); put(d.x, d.y, d.rad, hslToRgb(d.hue, d.s, d.l), 1, false); }
  // downsample
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { let r = 0, g = 0, b = 0, a = 0; for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) { const i = (y * S + sy) * W + x * S + sx; r += buf[i * 3]; g += buf[i * 3 + 1]; b += buf[i * 3 + 2]; a += alpha[i]; } const n = S * S, o = (y * size + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = Math.round(a / n * 255); }
  return png(size, size, out);
}
const dir = path.join(__dirname, '..', 'icons');
fs.writeFileSync(path.join(dir, 'icon-192.png'), render(192, false));
fs.writeFileSync(path.join(dir, 'icon-512.png'), render(512, false));
fs.writeFileSync(path.join(dir, 'icon-maskable-512.png'), render(512, true));
fs.writeFileSync(path.join(dir, 'apple-touch-icon.png'), render(180, true));
console.log('icons written');
