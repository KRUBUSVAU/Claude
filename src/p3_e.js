
// ---------- audio engine ----------
const audio = { ac: null, an: null, monitor: null, F: null, source: 'none', node: null, stream: null, el: null, elNode: null, demo: null, fileName: '' };
function ensureContext() {
  if (audio.ac) { if (audio.ac.state === 'suspended') audio.ac.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; const ac = new AC();
  const an = ac.createAnalyser(); an.fftSize = 4096; an.smoothingTimeConstant = 0; an.minDecibels = -110; an.maxDecibels = -10;
  const monitor = ac.createGain(); monitor.gain.value = 1; an.connect(monitor); monitor.connect(ac.destination);
  audio.ac = ac; audio.an = an; audio.monitor = monitor; audio.F = new Features(ac, an);
}
function stopSource() {
  if (audio.node) { try { audio.node.disconnect(); } catch (e) { } }
  if (audio.stream) { audio.stream.getTracks().forEach(t => t.stop()); audio.stream = null; }
  if (audio.el) { audio.el.pause(); }
  if (audio.demo) { audio.demo.stop(); audio.demo = null; }
  audio.node = null; audio.source = 'none';
  if (audio.F) { audio.F.bpm = 0; audio.F.bpmConf = 0; audio.F.anchor = -1; audio.F.onsets.length = 0; audio.F.startT = -1; }
  ui.setSource('none');
}
async function startMic() {
  ensureContext(); stopSource();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('This browser does not expose a microphone here. Upload a track or run the demo loop.'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
    audio.stream = stream; audio.node = audio.ac.createMediaStreamSource(stream); audio.node.connect(audio.an); audio.monitor.gain.value = 0; audio.source = 'mic';
    ui.setSource('mic'); toast('Listening. Play music near the microphone.');
  } catch (err) {
    const name = err && err.name || '';
    toast(name === 'NotAllowedError' || name === 'SecurityError' ? 'Microphone access was refused in this view. Upload a track or run the demo loop instead.' : 'Could not open the microphone (' + (name || 'unknown error') + '). Upload a track or run the demo loop instead.');
  }
}
function startFile(file) {
  ensureContext(); stopSource();
  if (!audio.el) { audio.el = new Audio(); audio.el.preload = 'auto'; audio.elNode = audio.ac.createMediaElementSource(audio.el); audio.el.addEventListener('ended', () => ui.setPlaying(false)); audio.el.addEventListener('timeupdate', ui.updateTime); audio.el.addEventListener('loadedmetadata', ui.updateTime); }
  if (audio.el.src && audio.el.src.startsWith('blob:')) URL.revokeObjectURL(audio.el.src);
  audio.el.src = URL.createObjectURL(file); audio.fileName = file.name;
  audio.node = audio.elNode; audio.node.connect(audio.an); audio.monitor.gain.value = 1; audio.source = 'file';
  audio.el.play().then(() => ui.setPlaying(true)).catch(() => { ui.setPlaying(false); toast('Press play to start the track.'); });
  ui.setSource('file');
}
function startDemo() {
  ensureContext(); stopSource();
  audio.demo = new Demo(audio.ac, audio.an); audio.node = audio.demo.out; audio.monitor.gain.value = 1; audio.source = 'demo'; audio.demo.start(); ui.setSource('demo');
}
function isActive() { if (audio.source === 'none') return false; if (audio.source === 'file') return !!audio.el && !audio.el.paused; return true; }

// ---------- demo loop (synthesised) ----------
class Demo {
  constructor(ac, dest) {
    this.ac = ac; this.out = ac.createGain(); this.out.gain.value = 0.55; this.out.connect(dest);
    this.noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const d = this.noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.step = 0; this.bar = 0; this.next = 0; this.timer = null; this.pad = null;
  }
  bpmForBar(bar) { const c = bar % 64; return c < 24 ? 112 : c < 48 ? 126 : 112; }
  chordFor(bar) { const sec = Math.floor((bar % 64) / 16); const prog = sec % 2 === 0 ? [[0, 0], [7, 0], [9, 1], [5, 0]] : [[9, 1], [5, 0], [0, 0], [4, 0]]; return prog[bar % 4]; }
  start() { this.next = this.ac.currentTime + 0.08; this.timer = setInterval(() => this.schedule(), 30); }
  stop() { clearInterval(this.timer); const t = this.ac.currentTime; this.out.gain.setTargetAtTime(0, t, 0.05); if (this.pad) this.pad.g.gain.setTargetAtTime(0, t, 0.05); setTimeout(() => { try { this.out.disconnect(); } catch (e) { } }, 400); }
  schedule() { while (this.next < this.ac.currentTime + 0.16) { this.playStep(this.next, this.step); this.next += 60 / this.bpmForBar(this.bar) / 2; this.step++; if (this.step % 8 === 0) this.bar++; } }
  hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  osc(type, f, t0, t1, g0, dest, det) { const ac = this.ac, o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f, t0); if (det) o.detune.value = det; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(g0, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, t1); o.connect(g); g.connect(dest || this.out); o.start(t0); o.stop(t1 + 0.02); return { o, g }; }
  kick(t) { const ac = this.ac, o = ac.createOscillator(), g = ac.createGain(); o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.13); g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.32); }
  noiseHit(t, dur, hp, bp, gain) { const ac = this.ac, s = ac.createBufferSource(); s.buffer = this.noise; s.loop = true; const f = ac.createBiquadFilter(); f.type = bp ? 'bandpass' : 'highpass'; f.frequency.value = hp; f.Q.value = bp ? 1.2 : 0.7; const g = ac.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(f); f.connect(g); g.connect(this.out); s.start(t); s.stop(t + dur + 0.02); }
  playStep(t, step) {
    const s8 = step % 8, bar = this.bar, [root, q] = this.chordFor(bar), spb = 60 / this.bpmForBar(bar); const b16 = bar % 16; const breakdown = b16 >= 13; const minorSec = Math.floor((bar % 64) / 16) % 2 === 1;
    if (!breakdown) {
      if (s8 % 2 === 0) this.kick(t);
      if (s8 === 2 || s8 === 6) { this.noiseHit(t, 0.18, 1800, true, 0.5); this.osc('triangle', 190, t, t + 0.12, 0.4); }
      this.noiseHit(t, s8 % 2 ? 0.14 : 0.05, 7000, false, s8 % 2 ? 0.16 : 0.1);
      if (s8 === 0 || s8 === 3 || s8 === 6) { const ac = this.ac, f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320; f.connect(this.out); this.osc('sawtooth', this.hz(36 + root), t, t + spb * 0.45, 0.6, f); }
    } else if (s8 % 4 === 0) this.noiseHit(t, 0.4, 4000, false, 0.06);
    if (s8 === 0) {
      if (this.pad) { this.pad.g.gain.setTargetAtTime(0, t, 0.08); const old = this.pad; setTimeout(() => old.oscs.forEach(o => { try { o.stop(); } catch (e) { } }), 600); }
      const ac = this.ac, g = ac.createGain(), f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = breakdown ? 700 : 1300; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07, t + 0.25); f.connect(g); g.connect(this.out);
      const tones = [60 + root, 60 + root + (q ? 3 : 4), 67 + root, 72 + root]; const oscs = [];
      tones.forEach((m, i) => { for (const det of [-7, 7]) { const o = ac.createOscillator(); o.type = i === 3 ? 'sine' : 'triangle'; o.frequency.value = this.hz(m); o.detune.value = det; o.connect(f); o.start(t); oscs.push(o); } });
      this.pad = { g, oscs };
    }
    const motif = minorSec ? [0, 3, 7, 10, 7, 3, 0, -2] : [0, 4, 7, 12, 7, 4, 0, -5];
    if (b16 % 4 !== 3 || s8 < 4) { const m = 72 + root + motif[s8]; const ac = this.ac, f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600; f.connect(this.out); this.osc('square', this.hz(m), t, t + spb * 0.42, 0.14, f); }
  }
}

// ---------- UI ----------
const $ = id => document.getElementById(id);
const brain = new Brain();
let toastTimer = 0;
function toast(msg, ms = 4200) { const el = $('toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, ms); }
const ui = {
  setSource(s) {
    $('btnMic').classList.toggle('on', s === 'mic'); $('lblFile').classList.toggle('on', s === 'file'); $('btnDemo').classList.toggle('on', s === 'demo');
    $('btnStop').hidden = s === 'none'; $('transport').hidden = s !== 'file';
    const st = $('status');
    st.innerHTML = s === 'mic' ? 'Listening to the <b>microphone</b>.' : s === 'file' ? 'Playing <b></b>' : s === 'demo' ? 'Playing the <b>demo loop</b>: four chords, a repeating motif, a tempo shift and a drop.' : 'Resting state. Pick a sound source to begin.';
    if (s === 'file') { st.querySelector('b').textContent = audio.fileName; $('trackName').textContent = audio.fileName; }
  },
  setPlaying(p) { $('btnPlay').textContent = p ? '❚❚' : '▶'; $('btnPlay').setAttribute('aria-label', p ? 'Pause' : 'Play'); },
  updateTime() { const el = audio.el; if (!el) return; const d = el.duration || 0, c = el.currentTime || 0; if (!ui.seeking) $('seek').value = d ? Math.round(c / d * 1000) : 0; $('time').textContent = fmt(c) + ' / ' + fmt(d); },
  seeking: false,
};
function fmt(s) { if (!isFinite(s)) return '0:00'; s = Math.floor(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
$('btnMic').addEventListener('click', startMic);
$('btnDemo').addEventListener('click', startDemo);
$('btnStop').addEventListener('click', stopSource);
$('fileIn').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) startFile(f); e.target.value = ''; });
$('btnPlay').addEventListener('click', () => { if (!audio.el) return; if (audio.el.paused) { ensureContext(); audio.el.play().then(() => ui.setPlaying(true)); } else { audio.el.pause(); ui.setPlaying(false); } });
$('seek').addEventListener('input', () => { ui.seeking = true; if (audio.el && audio.el.duration) $('time').textContent = fmt($('seek').value / 1000 * audio.el.duration) + ' / ' + fmt(audio.el.duration); });
$('seek').addEventListener('change', () => { ui.seeking = false; if (audio.el && audio.el.duration) audio.el.currentTime = $('seek').value / 1000 * audio.el.duration; });
$('zIn').addEventListener('click', () => zoomAt(1.6, view.w / 2, view.h / 2));
$('zOut').addEventListener('click', () => zoomAt(1 / 1.6, view.w / 2, view.h / 2));
$('zReset').addEventListener('click', () => flyTo(505, 415, 1));
$('readoutToggle').addEventListener('click', () => { const r = $('readout'); r.classList.toggle('collapsed'); $('readoutToggle').setAttribute('aria-expanded', String(!r.classList.contains('collapsed'))); });
if (window.innerWidth < 760) { $('readout').classList.add('collapsed'); $('readoutToggle').setAttribute('aria-expanded', 'false'); }
// drag & drop a track anywhere
window.addEventListener('dragover', e => { e.preventDefault(); });
window.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f && f.type.startsWith('audio')) startFile(f); });
// legend
{
  const ul = $('legend'); const order = ['auditory', 'motor', 'cerebellum', 'striatum', 'pfc', 'cingulate', 'hippocampus', 'amygdala', 'accumbens', 'hypothalamus', 'thalamus', 'vta', 'lc', 'raphe', 'parietal', 'occipital', 'temporal', 'brainstem'];
  for (const id of order) { const r = regionById[id]; const li = document.createElement('li'); const b = document.createElement('button'); b.type = 'button'; b.innerHTML = `<span class="sw" style="background:hsl(${r.hue},${r.sat}%,${r.light}%);color:hsl(${r.hue},${r.sat}%,${r.light}%)"></span><span>${r.name}${r.limbic ? '<span class="lim">limbic</span>' : ''}</span>`; b.title = r.desc; b.addEventListener('click', () => flyTo(r.cx, r.cy, r.small ? 7 : 3.4)); li.appendChild(b); ul.appendChild(li); }
}
// pointer interaction
const ptrs = new Map(); let dragging = false, pinch0 = 0, lastTap = 0, moved = 0;
canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); } dragging = true; canvas.classList.add('dragging'); });
canvas.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) { hover(e.clientX, e.clientY); return; }
  const p = ptrs.get(e.pointerId); const dx = e.clientX - p.x, dy = e.clientY - p.y; moved += Math.abs(dx) + Math.abs(dy);
  if (ptrs.size === 1) { view.cx -= dx / view.scale; view.cy -= dy / view.scale; view.animating = false; clampCam(); }
  p.x = e.clientX; p.y = e.clientY;
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0 > 0) zoomAt(d / pinch0, (a.x + b.x) / 2, (a.y + b.y) / 2); pinch0 = d; }
  hideTip();
});
function endPtr(e) {
  if (ptrs.has(e.pointerId) && ptrs.size === 1 && moved < 6) { const now = performance.now(); if (now - lastTap < 320) { dblTap(e.clientX, e.clientY); lastTap = 0; } else lastTap = now; }
  ptrs.delete(e.pointerId); if (!ptrs.size) { dragging = false; canvas.classList.remove('dragging'); } pinch0 = 0;
}
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', e => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)), e.clientX, e.clientY); }, { passive: false });
canvas.addEventListener('dblclick', e => dblTap(e.clientX, e.clientY));
canvas.addEventListener('pointerleave', hideTip);
function regionAt(wx, wy) { for (const r of inner) if (wx >= r.bb.x && wx <= r.bb.x + r.bb.w && wy >= r.bb.y && wy <= r.bb.y + r.bb.h && pointInPoly(r.poly, wx, wy)) return r; for (const r of regions) if (r.layer === 1 && wx >= r.bb.x && wx <= r.bb.x + r.bb.w && wy >= r.bb.y && wy <= r.bb.y + r.bb.h && pointInPoly(r.poly, wx, wy)) return r; return null; }
function dblTap(sx, sy) { const [wx, wy] = toWorld(sx, sy); const r = regionAt(wx, wy); if (r) flyTo(r.cx, r.cy, view.z < 2.5 ? (r.small ? 7 : 3.4) : Math.min(18, view.z * 2.2)); else if (view.z > 1.05) flyTo(505, 415, 1); }
const tip = $('tip'); let tipRegion = null;
function hover(sx, sy) {
  const [wx, wy] = toWorld(sx, sy); const r = regionAt(wx, wy);
  if (!r) { hideTip(); return; }
  let extra = '';
  if (view.z >= 2.6) { const ntc = NT[r.nt]; const lvl = Math.round(clamp(brain.recept[r.i] + (r.nt === 'glu' ? brain.act[r.i] : brain.nt[r.nt].level), 0, 1) * 100); extra = `<div class="rc"><i style="background:${ntc.css}"></i>${ntc.receptor} · ${lvl}% active</div>`; }
  if (tipRegion !== r || extra) { tip.innerHTML = `<h3>${r.name}</h3><p>${r.desc}</p>${extra}`; tipRegion = r; }
  tip.hidden = false;
  const tw = tip.offsetWidth, th = tip.offsetHeight; let x = sx, y = sy; if (x + tw + 20 > view.w) x = sx - tw - 28; if (y + th + 20 > view.h) y = sy - th - 28;
  tip.style.transform = `translate(${x + 14}px,${y + 14}px)`;
}
function hideTip() { tip.hidden = true; tipRegion = null; }
window.addEventListener('keydown', e => { if (e.target && /INPUT|BUTTON|LABEL/.test(e.target.tagName) && e.key !== 'Escape') return; if (e.key === '+' || e.key === '=') zoomAt(1.4, view.w / 2, view.h / 2); else if (e.key === '-') zoomAt(1 / 1.4, view.w / 2, view.h / 2); else if (e.key === '0' || e.key === 'Escape') flyTo(505, 415, 1); else if (e.key === ' ' && audio.el && audio.source === 'file') { e.preventDefault(); $('btnPlay').click(); } });

// readouts
let lastUI = 0;
function updateReadout(now, F, active) {
  if (now - lastUI < 0.1) return; lastUI = now;
  const nt = brain.nt;
  $('fTempo').innerHTML = active && F.bpm > 0 && F.bpmConf > 0.12 ? Math.round(F.bpm) + ' bpm' + (now - F.bpmChangedAt < 3 ? '<span class="flag">changed</span>' : '') : '—';
  $('fKey').textContent = active && F.key.root >= 0 ? F.key.name : '—';
  $('fChord').textContent = active && F.chord.root >= 0 && F.chordEnergy > 0.3 ? F.chord.name : '—';
  $('fPitch').textContent = active && F.pitch.midi >= 0 ? F.pitch.note + ' · ' + Math.round(F.pitch.f) + ' Hz' : '—';
  $('fLevel').style.width = (active ? Math.round(F.loudN * 100) : 0) + '%';
  $('mDa').style.width = Math.round(nt.da.level * 100) + '%'; $('mNe').style.width = Math.round(nt.ne.level * 100) + '%'; $('mHt').style.width = Math.round(nt.ht.level * 100) + '%';
  $('mDaWhy').textContent = now - nt.da.whyT < 3 ? nt.da.why : ''; $('mNeWhy').textContent = now - nt.ne.whyT < 3 ? nt.ne.why : ''; $('mHtWhy').textContent = now - nt.ht.whyT < 3 ? nt.ht.why : '';
  $('fRepMel').textContent = F.repCounts.melody; $('fRepChord').textContent = F.repCounts.chord; $('fRepSample').textContent = F.repCounts.sample; $('fConn').textContent = brain.conns.length;
}

// ---------- main loop ----------
const idleF = { spec: new Float32Array(64), bands: new Float32Array(8), loudN: 0, bpm: 0, bpmConf: 0, modeMix: 0.5, tension: 0, onsetDensity: 0, centroidS: 0, events: [], key: { root: -1 }, chord: { root: -1 }, pitch: { midi: -1 }, repCounts: { melody: 0, chord: 0, sample: 0 }, chordEnergy: 0, bpmChangedAt: -10 };
let last = performance.now() / 1000, frameEMA = 0.016, perfT = 0;
function frame(ms) {
  const now = ms / 1000; let dt = now - last; last = now; if (dt > 0.06) dt = 0.06; if (dt <= 0) dt = 0.001;
  // adaptive resolution: if frames stay slow on a high-density screen, drop to 1x pixels
  frameEMA += (dt - frameEMA) * 0.04;
  if (frameEMA > 1 / 32 && view.dprCap > 1 && now - perfT > 4 && now > 3) { view.dprCap = 1; perfT = now; resize(); }
  if (view.animating) { const k = Math.min(1, dt * 5); view.cx += (view.tcx - view.cx) * k; view.cy += (view.tcy - view.cy) * k; view.z += (view.tz - view.z) * k; if (Math.abs(view.z - view.tz) < 0.003 && Math.abs(view.cx - view.tcx) < 0.2 && Math.abs(view.cy - view.tcy) < 0.2) { view.z = view.tz; view.cx = view.tcx; view.cy = view.tcy; view.animating = false; } clampCam(); }
  const active = isActive(); const F = audio.F || idleF;
  if (audio.F) audio.F.update(now, dt, active);
  brain.update(dt, F, active, now);
  render(now, dt, F, active);
  updateReadout(now, F, active);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__viz = { audio, brain, regions, paths, view, D, startDemo, stopSource, flyTo, fns: { drawDots, drawPathways, drawConnections, drawDetails, drawSkull, drawLabels, drawBackground, beginGlow, endGlow, render } };
})();
