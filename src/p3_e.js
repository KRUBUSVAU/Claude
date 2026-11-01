
// ---------- audio engine ----------
const audio = { ac: null, an: null, monitor: null, F: null, source: 'none', node: null, el: null, elNode: null, demo: null, volume: 0.9 };
function ensureContext() {
  if (audio.ac) { if (audio.ac.state === 'suspended') audio.ac.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; const ac = new AC();
  const an = ac.createAnalyser(); an.fftSize = 4096; an.smoothingTimeConstant = 0; an.minDecibels = -110; an.maxDecibels = -10;
  const monitor = ac.createGain(); monitor.gain.value = audio.volume; an.connect(monitor); monitor.connect(ac.destination);
  audio.ac = ac; audio.an = an; audio.monitor = monitor; audio.F = new Features(ac, an);
  // analysis runs on its own 50 Hz clock so onsets and tempo do not depend on the frame rate
  let lastA = performance.now() / 1000;
  audio.timer = setInterval(() => { const t = performance.now() / 1000; let dt = t - lastA; lastA = t; if (dt > 0.1) dt = 0.1; audio.F.update(t, dt, isActive()); }, 20);
}
function stopSource(keepTrack) {
  if (audio.node) { try { audio.node.disconnect(); } catch (e) { } }
  if (audio.el) { audio.el.pause(); }
  if (audio.demo) { audio.demo.stop(); audio.demo = null; }
  audio.node = null; audio.source = 'none';
  if (audio.F) audio.F.resetTrack();
  if (!keepTrack) { lib.index = -1; }
  ui.setSource('none');
}
function isActive() { if (audio.source === 'none') return false; if (audio.source === 'file') return !!audio.el && !audio.el.paused && !audio.el.ended; return true; }

// ---------- library (persisted in IndexedDB so the app keeps your tracks) ----------
const LibDB = {
  ready: null,
  open() {
    if (this.ready) return this.ready;
    this.ready = new Promise(res => { try { if (!('indexedDB' in window)) return res(null); const rq = indexedDB.open('neural-resonance', 1); rq.onupgradeneeded = () => { rq.result.createObjectStore('tracks', { keyPath: 'id', autoIncrement: true }); }; rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); rq.onblocked = () => res(null); } catch (e) { res(null); } });
    return this.ready;
  },
  async tx(mode, fn) { const db = await this.open(); if (!db) return null; return new Promise(res => { try { const t = db.transaction('tracks', mode); const rq = fn(t.objectStore('tracks')); rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); } catch (e) { res(null); } }); },
  all() { return this.tx('readonly', s => s.getAll()); },
  add(rec) { return this.tx('readwrite', s => s.add(rec)); },
  put(rec) { return this.tx('readwrite', s => s.put(rec)); },
  remove(id) { return this.tx('readwrite', s => s.delete(id)); },
  clear() { return this.tx('readwrite', s => s.clear()); },
};
const lib = { tracks: [], index: -1, shuffle: false, repeat: 'off', history: [], persistent: true };
try { lib.shuffle = localStorage.getItem('nr.shuffle') === '1'; lib.repeat = localStorage.getItem('nr.repeat') || 'off'; const v = parseFloat(localStorage.getItem('nr.volume')); if (!isNaN(v)) audio.volume = clamp(v, 0, 1); } catch (e) { }
function trackTitle(t) { return t.name.replace(/\.[a-z0-9]{2,5}$/i, ''); }
async function addTracks(files, autoplay) {
  const added = [];
  for (const f of files) {
    if (!(f.type.startsWith('audio') || /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|webm|aif|aiff)$/i.test(f.name))) continue;
    const rec = { name: f.name, type: f.type, size: f.size, blob: f, added: Date.now(), duration: 0 };
    let id = await LibDB.add(rec);
    if (id == null) { lib.persistent = false; id = 'm' + Math.random().toString(36).slice(2); }
    rec.id = id; lib.tracks.push(rec); added.push(rec);
  }
  if (!added.length) { toast('No audio files in that selection.'); return; }
  ui.renderLibrary();
  if (!lib.persistent) toast('This browser will not keep the library between visits, but playback works.');
  if (autoplay || !isActive()) playIndex(lib.tracks.indexOf(added[0]));
  else toast(added.length === 1 ? 'Added to the library.' : 'Added ' + added.length + ' tracks to the library.');
}
async function restoreLibrary() {
  const rows = await LibDB.all(); if (!rows) { lib.persistent = false; ui.renderLibrary(); return; }
  rows.sort((a, b) => a.added - b.added); lib.tracks = rows; ui.renderLibrary();
  if (rows.length) $('status').innerHTML = 'Library restored: <b>' + rows.length + (rows.length === 1 ? ' track' : ' tracks') + '</b>. Press play on one to begin.';
}
function playIndex(i, fromHistory) {
  if (i < 0 || i >= lib.tracks.length) return;
  ensureContext(); stopSource(true);
  if (!audio.el) {
    audio.el = new Audio(); audio.el.preload = 'auto'; audio.elNode = audio.ac.createMediaElementSource(audio.el);
    audio.el.addEventListener('ended', onEnded); audio.el.addEventListener('timeupdate', ui.updateTime); audio.el.addEventListener('pause', () => ui.setPlaying(false)); audio.el.addEventListener('play', () => ui.setPlaying(true));
    audio.el.addEventListener('loadedmetadata', () => { ui.updateTime(); const t = lib.tracks[lib.index]; if (t && audio.el.duration && !t.duration) { t.duration = audio.el.duration; if (typeof t.id === 'number') LibDB.put(t); ui.renderLibrary(); } });
    audio.el.addEventListener('error', () => toast('This file could not be decoded by the browser.'));
  }
  if (!fromHistory && lib.index >= 0) { lib.history.push(lib.index); if (lib.history.length > 64) lib.history.shift(); }
  lib.index = i; const t = lib.tracks[i];
  if (audio.el.src && audio.el.src.startsWith('blob:')) URL.revokeObjectURL(audio.el.src);
  audio.el.src = URL.createObjectURL(t.blob);
  audio.node = audio.elNode; audio.node.connect(audio.an); audio.source = 'file';
  audio.el.play().then(() => ui.setPlaying(true)).catch(() => { ui.setPlaying(false); toast('Press play to start the track.'); });
  ui.setSource('file'); ui.renderLibrary(); ui.mediaSession();
}
function nextIndex(dir) {
  const n = lib.tracks.length; if (!n) return -1;
  if (lib.shuffle) { if (n === 1) return 0; let j; do { j = Math.floor(Math.random() * n); } while (j === lib.index); return j; }
  const j = lib.index + dir;
  if (j >= n) return lib.repeat === 'all' ? 0 : -1;
  if (j < 0) return lib.repeat === 'all' ? n - 1 : -1;
  return j;
}
function next() { const j = nextIndex(1); if (j >= 0) playIndex(j); else toast('End of the library.'); }
function prev() {
  if (audio.el && audio.el.currentTime > 4) { audio.el.currentTime = 0; return; }
  if (lib.shuffle && lib.history.length) { playIndex(lib.history.pop(), true); return; }
  const j = nextIndex(-1); if (j >= 0) playIndex(j); else if (audio.el) audio.el.currentTime = 0;
}
function onEnded() {
  if (lib.repeat === 'one') { audio.el.currentTime = 0; audio.el.play(); return; }
  const j = nextIndex(1);
  if (j >= 0) playIndex(j); else { ui.setPlaying(false); $('status').innerHTML = 'Finished <b></b>'; $('status').querySelector('b').textContent = trackTitle(lib.tracks[lib.index]); }
}
async function removeTrack(i) {
  const t = lib.tracks[i]; if (!t) return;
  if (typeof t.id === 'number') await LibDB.remove(t.id);
  lib.tracks.splice(i, 1); lib.history = [];
  if (i === lib.index) { stopSource(); lib.index = -1; } else if (i < lib.index) lib.index--;
  ui.renderLibrary();
}
async function clearLibrary() { await LibDB.clear(); stopSource(); lib.tracks = []; lib.index = -1; lib.history = []; ui.renderLibrary(); toast('Library cleared.'); }
function startDemo() {
  ensureContext(); stopSource();
  audio.demo = new Demo(audio.ac, audio.an); audio.node = audio.demo.out; audio.source = 'demo'; audio.demo.start(); ui.setSource('demo'); ui.mediaSession();
}

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
function fmt(s) { if (!isFinite(s) || s < 0) return '0:00'; s = Math.floor(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
const ui = {
  seeking: false,
  setSource(s) {
    $('btnDemo').classList.toggle('on', s === 'demo'); $('btnStop').hidden = s === 'none'; $('transport').hidden = s !== 'file';
    const st = $('status');
    if (s === 'file') { const t = lib.tracks[lib.index]; st.innerHTML = 'Playing <b></b>'; st.querySelector('b').textContent = t ? trackTitle(t) : ''; $('trackName').textContent = t ? trackTitle(t) : ''; $('trackPos').textContent = (lib.index + 1) + ' of ' + lib.tracks.length; }
    else if (s === 'demo') st.innerHTML = 'Playing the <b>demo loop</b>: four chords, a repeating motif, a tempo shift and a drop.';
    else st.textContent = lib.tracks.length ? 'Paused. Pick a track from the library.' : 'Resting state. Add a track to begin.';
  },
  setPlaying(p) { $('btnPlay').textContent = p ? '❚❚' : '▶'; $('btnPlay').setAttribute('aria-label', p ? 'Pause' : 'Play'); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = p ? 'playing' : 'paused'; },
  updateTime() { const el = audio.el; if (!el) return; const d = el.duration || 0, c = el.currentTime || 0; if (!ui.seeking) $('seek').value = d ? Math.round(c / d * 1000) : 0; $('time').textContent = fmt(c) + ' / ' + fmt(d); },
  renderLibrary() {
    const n = lib.tracks.length; $('libCount').textContent = n; $('libCount2').textContent = n; $('libEmpty').hidden = n > 0;
    const ol = $('libList'); ol.textContent = '';
    lib.tracks.forEach((t, i) => {
      const li = document.createElement('li'); li.className = i === lib.index ? 'now' : ''; li.title = t.name;
      li.innerHTML = '<span class="n"></span><span class="nm"></span><span class="d"></span><button class="rm" aria-label="Remove track">×</button>';
      li.children[0].textContent = i === lib.index && isActive() ? '▶' : String(i + 1); li.children[1].textContent = trackTitle(t); li.children[2].textContent = t.duration ? fmt(t.duration) : '';
      li.addEventListener('click', e => { if (e.target.classList.contains('rm')) return; playIndex(i); });
      li.children[3].addEventListener('click', () => removeTrack(i));
      ol.appendChild(li);
    });
    if (lib.index >= 0) $('trackPos').textContent = (lib.index + 1) + ' of ' + n;
  },
  mediaSession() {
    if (!('mediaSession' in navigator)) return;
    const t = lib.tracks[lib.index]; const title = audio.source === 'demo' ? 'Demo loop' : t ? trackTitle(t) : 'Neural Resonance';
    try { navigator.mediaSession.metadata = new MediaMetadata({ title, artist: 'Neural Resonance', album: 'Library' }); } catch (e) { }
  },
};
$('btnDemo').addEventListener('click', startDemo);
$('btnStop').addEventListener('click', () => stopSource());
$('fileIn').addEventListener('change', e => { const fs = Array.from(e.target.files || []); if (fs.length) addTracks(fs, false); e.target.value = ''; });
$('btnPlay').addEventListener('click', togglePlay);
function togglePlay() { if (audio.source === 'file' && audio.el) { if (audio.el.paused) { ensureContext(); audio.el.play().catch(() => { }); } else audio.el.pause(); } else if (lib.tracks.length) playIndex(lib.index >= 0 ? lib.index : 0); }
$('btnNext').addEventListener('click', next); $('btnPrev').addEventListener('click', prev);
$('seek').addEventListener('input', () => { ui.seeking = true; if (audio.el && audio.el.duration) $('time').textContent = fmt($('seek').value / 1000 * audio.el.duration) + ' / ' + fmt(audio.el.duration); });
$('seek').addEventListener('change', () => { ui.seeking = false; if (audio.el && audio.el.duration) audio.el.currentTime = $('seek').value / 1000 * audio.el.duration; });
$('volume').value = audio.volume;
$('volume').addEventListener('input', e => { audio.volume = parseFloat(e.target.value); if (audio.monitor) audio.monitor.gain.setTargetAtTime(audio.volume, audio.ac.currentTime, 0.02); try { localStorage.setItem('nr.volume', String(audio.volume)); } catch (err) { } });
function syncModes() { $('btnShuffle').setAttribute('aria-pressed', String(lib.shuffle)); $('btnRepeat').setAttribute('aria-pressed', String(lib.repeat !== 'off')); $('btnRepeat').textContent = lib.repeat === 'one' ? '↻ repeat one' : '↻ repeat'; try { localStorage.setItem('nr.shuffle', lib.shuffle ? '1' : '0'); localStorage.setItem('nr.repeat', lib.repeat); } catch (e) { } }
$('btnShuffle').addEventListener('click', () => { lib.shuffle = !lib.shuffle; syncModes(); });
$('btnRepeat').addEventListener('click', () => { lib.repeat = lib.repeat === 'off' ? 'all' : lib.repeat === 'all' ? 'one' : 'off'; syncModes(); });
syncModes();
$('btnLibrary').addEventListener('click', () => { const open = $('library').hidden; $('library').hidden = !open; $('btnLibrary').setAttribute('aria-expanded', String(open)); });
$('btnCloseLib').addEventListener('click', () => { $('library').hidden = true; $('btnLibrary').setAttribute('aria-expanded', 'false'); });
$('btnClearLib').addEventListener('click', () => { if (!lib.tracks.length) return; const b = $('btnClearLib'); if (b.dataset.arm) { delete b.dataset.arm; b.textContent = 'Clear all'; clearLibrary(); } else { b.dataset.arm = '1'; b.textContent = 'Tap again to clear'; setTimeout(() => { delete b.dataset.arm; b.textContent = 'Clear all'; }, 3000); } });
$('zIn').addEventListener('click', () => { touch(); dolly(1 / 1.5); });
$('zOut').addEventListener('click', () => { touch(); dolly(1.5); });
$('zReset').addEventListener('click', goHome);
$('readoutToggle').addEventListener('click', () => { const r = $('readout'); r.classList.toggle('collapsed'); $('readoutToggle').setAttribute('aria-expanded', String(!r.classList.contains('collapsed'))); });
if (window.innerWidth < 760) { $('readout').classList.add('collapsed'); $('readoutToggle').setAttribute('aria-expanded', 'false'); }
window.addEventListener('dragover', e => { e.preventDefault(); });
window.addEventListener('drop', e => { e.preventDefault(); const fs = Array.from(e.dataTransfer && e.dataTransfer.files || []); if (fs.length) addTracks(fs, true); });
// OS media keys and lock-screen controls
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession; const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch (e) { } };
  set('play', togglePlay); set('pause', togglePlay); set('previoustrack', prev); set('nexttrack', next);
  set('seekto', d => { if (audio.el && d.seekTime != null) audio.el.currentTime = d.seekTime; });
  set('seekbackward', d => { if (audio.el) audio.el.currentTime = Math.max(0, audio.el.currentTime - (d.seekOffset || 10)); });
  set('seekforward', d => { if (audio.el) audio.el.currentTime = Math.min(audio.el.duration || 0, audio.el.currentTime + (d.seekOffset || 10)); });
}
// installed app: files opened from the OS arrive here
if ('launchQueue' in window && window.launchQueue.setConsumer) { try { window.launchQueue.setConsumer(async p => { const fs = []; for (const h of p.files || []) { try { fs.push(await h.getFile()); } catch (e) { } } if (fs.length) addTracks(fs, true); }); } catch (e) { } }
// install prompt (Chromium) and service worker (only when served over http(s) with a manifest)
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('btnInstall').hidden = false; });
$('btnInstall').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch (e) { } installEvt = null; $('btnInstall').hidden = true; });
window.addEventListener('appinstalled', () => { $('btnInstall').hidden = true; toast('Installed. Neural Resonance now opens as its own app.'); });
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && document.querySelector('link[rel=manifest]')) { window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { }); }); }
// legend
{
  const ul = $('legend'); const order = ['auditory', 'motor', 'cerebellum', 'striatum', 'pfc', 'cingulate', 'hippocampus', 'amygdala', 'accumbens', 'hypothalamus', 'thalamus', 'vta', 'lc', 'raphe', 'parietal', 'occipital', 'temporal', 'brainstem'];
  for (const id of order) { const r = regionById[id]; const li = document.createElement('li'); const b = document.createElement('button'); b.type = 'button'; b.innerHTML = `<span class="sw" style="background:hsl(${r.hue},${r.sat}%,${r.light}%);color:hsl(${r.hue},${r.sat}%,${r.light}%)"></span><span>${r.name}${r.limbic ? '<span class="lim">limbic</span>' : ''}</span>`; b.title = r.desc; b.addEventListener('click', () => flyToRegion(r)); li.appendChild(b); ul.appendChild(li); }
}
// pointer interaction: drag orbits, right-drag / shift-drag / two fingers pan, wheel or pinch zooms
const ptrs = new Map(); let pinch0 = 0, pinchMid = null, lastTap = 0, moved = 0;
function touch() { view.touched = true; view.animating = false; view.lastInteract = performance.now() / 1000; }
function pan(dx, dy) { const k = 2 * view.dist * Math.tan(FOV / 2) / view.h; view.tx -= (camRight[0] * dx - camUp[0] * dy) * k; view.ty -= (camRight[1] * dx - camUp[1] * dy) * k; view.tz -= (camRight[2] * dx - camUp[2] * dy) * k; view.tx = clamp(view.tx, -120, 120); view.ty = clamp(view.ty, -150, 120); view.tz = clamp(view.tz, -110, 120); }
function dolly(f) { view.dist = clamp(view.dist * f, 14, 900); }
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey }); moved = 0; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); pinchMid = [(a.x + b.x) / 2, (a.y + b.y) / 2]; } canvas.classList.add('dragging'); hideTip(); });
canvas.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) { hover(e.clientX, e.clientY); return; }
  const p = ptrs.get(e.pointerId); const dx = e.clientX - p.x, dy = e.clientY - p.y; moved += Math.abs(dx) + Math.abs(dy); p.x = e.clientX; p.y = e.clientY;
  if (ptrs.size === 1) { touch(); if (p.b === 2 || p.b === 1 || p.shift) pan(dx, dy); else { view.yaw -= dx * 0.0055; view.pitch += dy * 0.0055; view.pitch = clamp(view.pitch, -1.45, 1.45); } }
  else if (ptrs.size === 2) { touch(); const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), mid = [(a.x + b.x) / 2, (a.y + b.y) / 2]; if (pinch0 > 0) dolly(pinch0 / d); if (pinchMid) pan(mid[0] - pinchMid[0], mid[1] - pinchMid[1]); pinch0 = d; pinchMid = mid; }
});
function endPtr(e) {
  if (ptrs.has(e.pointerId) && ptrs.size === 1 && moved < 6 && e.pointerType !== 'mouse') { const now = performance.now(); if (now - lastTap < 320) { dblTap(e.clientX, e.clientY); lastTap = 0; } else lastTap = now; }
  ptrs.delete(e.pointerId); if (!ptrs.size) canvas.classList.remove('dragging'); pinch0 = 0; pinchMid = null;
}
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', e => { e.preventDefault(); touch(); dolly(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.04 : 0.0013))); }, { passive: false });
canvas.addEventListener('dblclick', e => dblTap(e.clientX, e.clientY));
canvas.addEventListener('pointerleave', hideTip);
function dblTap(sx, sy) { const hit = regionAt(sx, sy); if (hit) flyToRegion(hit.r, hit.c); else goHome(); }
const tip = $('tip'); let tipRegion = null;
function hover(sx, sy) {
  const hit = regionAt(sx, sy); if (!hit) { hideTip(); return; } const r = hit.r;
  let extra = '';
  if (view.dist < 90) { const ntc = NT[r.nt]; const lvl = Math.round(clamp(brain.recept[r.i] + (r.nt === 'glu' ? brain.act[r.i] : brain.nt[r.nt].level), 0, 1) * 100); extra = `<div class="rc"><i style="background:${ntc.css}"></i>${ntc.receptor} · ${lvl}% active</div>`; }
  if (tipRegion !== r || extra) { tip.innerHTML = `<h3>${r.name}</h3><p>${r.desc}</p>${extra}`; tipRegion = r; }
  tip.hidden = false;
  const tw = tip.offsetWidth, th = tip.offsetHeight; let x = sx, y = sy; if (x + tw + 20 > view.w) x = sx - tw - 28; if (y + th + 20 > view.h) y = sy - th - 28;
  tip.style.transform = `translate(${x + 14}px,${y + 14}px)`;
}
function hideTip() { tip.hidden = true; tipRegion = null; }
// view buttons
const VIEWS = { left: [-Math.PI / 2, 0.05], right: [Math.PI / 2, 0.05], front: [0, 0.05], top: [-0.001, 1.44], back: [Math.PI, 0.05] };
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { const v = VIEWS[b.dataset.view]; if (v) flyTo([0, -14, 4], view.homeDist, v[0], v[1]); else goHome(); }));
$('btnSpin').addEventListener('click', () => { view.autoSpin = !view.autoSpin; $('btnSpin').setAttribute('aria-pressed', String(view.autoSpin)); view.lastInteract = -100; });
try { const b = parseFloat(localStorage.getItem('nr.brightness')); if (!isNaN(b)) view.exposure = clamp(b, 0.2, 1.6); } catch (err) { }
$('brightness').value = view.exposure;
$('brightness').addEventListener('input', ev => { view.exposure = parseFloat(ev.target.value); try { localStorage.setItem('nr.brightness', String(view.exposure)); } catch (err) { } });
$('btnSkull').addEventListener('click', () => { view.showSkull = !view.showSkull; $('btnSkull').setAttribute('aria-pressed', String(view.showSkull)); });
window.addEventListener('keydown', e => {
  if (e.target && /INPUT|BUTTON|LABEL|SELECT|TEXTAREA/.test(e.target.tagName) && e.key !== 'Escape' && e.key !== ' ') return;
  if (e.key === '+' || e.key === '=') { touch(); dolly(1 / 1.3); } else if (e.key === '-') { touch(); dolly(1.3); } else if (e.key === '0' || e.key === 'Escape') goHome();
  else if (e.key === ' ') { if (e.target && e.target.tagName === 'INPUT') return; e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowRight' && audio.el && audio.source === 'file') { audio.el.currentTime = Math.min(audio.el.duration || 0, audio.el.currentTime + 5); }
  else if (e.key === 'ArrowLeft' && audio.el && audio.source === 'file') { audio.el.currentTime = Math.max(0, audio.el.currentTime - 5); }
  else if (e.key === 'n' || e.key === 'N') next(); else if (e.key === 'p' || e.key === 'P') prev();
  else if (e.key === 'l' || e.key === 'L') $('btnLibrary').click(); else if (e.key === 's' || e.key === 'S') $('btnSpin').click();
});

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
  $('fRepMel').textContent = F.repCounts.melody + F.repCounts.phrase; $('fRepChord').textContent = F.repCounts.chord; $('fRepSample').textContent = F.repCounts.sample; $('fConn').textContent = brain.edgeCount;
}

// ---------- main loop ----------
const idleF = { spec: new Float32Array(64), bands: new Float32Array(8), loudN: 0, bpm: 0, bpmConf: 0, modeMix: 0.5, tension: 0, onsetDensity: 0, centroidS: 0, events: [], key: { root: -1 }, chord: { root: -1 }, pitch: { midi: -1 }, repCounts: { melody: 0, phrase: 0, chord: 0, sample: 0 }, chordEnergy: 0, bpmChangedAt: -10 };
let last = performance.now() / 1000, frameEMA = 0.016, perfT = 0;
function frame(ms) {
  const now = ms / 1000; let dt = now - last; last = now; if (dt > 0.06) dt = 0.06; if (dt <= 0) dt = 0.001;
  frameEMA += (dt - frameEMA) * 0.04;
  if (frameEMA > 1 / 32 && view.dprCap > 1 && now - perfT > 4 && now > 3) { view.dprCap = 1; perfT = now; resize(); }
  if (view.animating) {
    const k = Math.min(1, dt * 4.5); let dy = view.tyaw - view.yaw; dy = ((dy + Math.PI) % TAU + TAU) % TAU - Math.PI; view.yaw += dy * k; view.pitch += (view.tpitch - view.pitch) * k;
    view.dist += (view.tdist - view.dist) * k; view.tx += (view.ttx - view.tx) * k; view.ty += (view.tty - view.ty) * k; view.tz += (view.ttz - view.tz) * k;
    if (Math.abs(dy) < 0.002 && Math.abs(view.tdist - view.dist) < 0.1 && Math.abs(view.ttx - view.tx) + Math.abs(view.tty - view.ty) + Math.abs(view.ttz - view.tz) < 0.1) { view.yaw = view.tyaw; view.pitch = view.tpitch; view.dist = view.tdist; view.tx = view.ttx; view.ty = view.tty; view.tz = view.ttz; view.animating = false; }
  } else if (view.autoSpin && !REDUCED && now - view.lastInteract > 6 && view.dist > 120) view.yaw += dt * 0.07;
  const active = isActive(); const F = audio.F || idleF;
  brain.update(dt, F, active, now);
  render(now, dt, F, active);
  updateReadout(now, F, active);
  requestAnimationFrame(frame);
}
restoreLibrary();
requestAnimationFrame(frame);
window.__viz = { audio, brain, regions, paths, view, D, lib, startDemo, stopSource, flyTo, flyToRegion, goHome, addTracks, playIndex, next, prev, regionById, gl: () => gl };
})();
