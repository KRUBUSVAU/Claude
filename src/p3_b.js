
// ---------- audio feature extraction ----------
const CHORD_T = [
  { q: 0, iv: [0, 4, 7], w: [1, .9, .8], sym: '' },
  { q: 1, iv: [0, 3, 7], w: [1, .9, .8], sym: 'm' },
  { q: 2, iv: [0, 3, 6], w: [1, .9, .85], sym: '°' },
  { q: 3, iv: [0, 5, 7], w: [1, .85, .85], sym: 'sus4' },
];
const KK_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function pearson(a, b, rot) { let ma = 0, mb = 0; for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; } ma /= 12; mb /= 12; let n = 0, da = 0, db = 0; for (let i = 0; i < 12; i++) { const x = a[(i + rot) % 12] - ma, y = b[i] - mb; n += x * y; da += x * x; db += y * y; } return da > 0 && db > 0 ? n / Math.sqrt(da * db) : 0; }

class Features {
  constructor(ac, an) {
    this.ac = ac; this.an = an; this.sr = ac.sampleRate; this.N = an.frequencyBinCount; this.fft = an.fftSize; this.binHz = this.sr / this.fft;
    this.db = new Float32Array(this.N); this.mag = new Float32Array(this.N); this.prev = new Float32Array(this.N); this.td = new Float32Array(this.fft);
    this.bandEdges = [20, 120, 250, 500, 1000, 2000, 4000, 8000, 16000]; this.bands = new Float32Array(8); this.bandPeak = new Float32Array(8).fill(1e-3);
    this.spec = new Float32Array(64); this.specRaw = new Float32Array(64); this.specPeak = 1e-3;
    this.chroma = new Float32Array(12); this.chromaS = new Float32Array(12); this.chromaK = new Float32Array(12);
    this.pc = new Int8Array(this.N).fill(-1); this.pcw = new Float32Array(this.N);
    for (let i = 1; i < this.N; i++) { const f = i * this.binHz; if (f < 55 || f > 5000) continue; const m = 69 + 12 * Math.log2(f / 440); this.pc[i] = ((Math.round(m) % 12) + 12) % 12; this.pcw[i] = f < 110 ? 0.35 : f < 2000 ? 1 : Math.max(0.2, 1 - (f - 2000) / 4000); }
    this.rms = 0; this.loudPeak = 0.05; this.loudFast = 0; this.loudSlow = 0; this.loudN = 0; this.silence = true;
    this.fluxMean = 0.1; this.fluxHist = [0, 0, 0]; this.lastOnset = -1; this.onsets = []; this.onsetDensity = 0; this.onsetStrength = 0;
    this.bpm = 0; this.bpmConf = 0; this.bpmDisagree = 0; this.lastTempoCalc = 0; this.period = 0.5; this.anchor = -1; this.tickK = -1; this.beatPhase = 0; this.bpmChangedAt = -10;
    this.chord = { root: -1, q: 0, name: '—', score: 0 }; this.chordCand = -1; this.chordCandN = 0; this.chordSeq = []; this.lastChordT = -1; this.chordEnergy = 0;
    this.key = { root: -1, mode: 0, conf: 0, name: '—' }; this.keyCand = -1; this.keyCandT = 0; this.modeMix = 0.5; this.tension = 0;
    this.pitch = { f: 0, midi: -1, clarity: 0, note: '—' }; this.heldMidi = -1; this.noteHold = 0; this.lastNoteMidi = -1; this.lastNoteT = -10; this.melodySeq = []; this.peakMidi = -1; this.peakMidiT = -10;
    this.pbuf = new Float32Array(1024); this.nsdf = new Float32Array(1024); this.fp = new Float32Array(24);
    this.protos = []; this.protoId = 0; this.repCounts = { melody: 0, chord: 0, sample: 0 };
    this.centroid = 0; this.centroidS = 0; this.events = []; this.now = 0; this.lastDrop = -10; this.frames = 0; this.startT = -1;
  }
  emit(e) { this.events.push(e); }
  resetTrack() { this.bpm = 0; this.bpmConf = 0; this.bpmDisagree = 0; this.anchor = -1; this.tickK = -1; this.onsets.length = 0; this.startT = -1; this.chordSeq.length = 0; this.melodySeq.length = 0; this.protos.length = 0; this.chord = { root: -1, q: 0, name: '—', score: 0 }; this.chordCand = -1; this.key = { root: -1, mode: 0, conf: 0, name: '—' }; this.keyCand = -1; this.lastNoteMidi = -1; this.peakMidi = -1; this.lastDrop = -10; this.loudPeak = 0.05; this.bandPeak.fill(1e-3); this.specPeak = 1e-3; this.chromaK.fill(0); this.chromaS.fill(0); }
  update(now, dt, active) {
    this.events.length = 0; this.now = now;
    if (!active) { this.loudFast *= 0.9; this.loudN = this.loudFast; this.silence = true; return; }
    if (this.startT < 0) this.startT = now;
    const an = this.an, N = this.N, mag = this.mag, prev = this.prev, db = this.db, td = this.td;
    an.getFloatFrequencyData(db); an.getFloatTimeDomainData(td);
    let s = 0; for (let i = 0; i < td.length; i += 2) s += td[i] * td[i];
    const rms = Math.sqrt(s / (td.length / 2)); this.rms = rms;
    this.loudPeak = Math.max(rms, this.loudPeak * Math.exp(-dt / 25), 0.02);
    const loudN = clamp(rms / this.loudPeak, 0, 1);
    this.loudFast += (loudN - this.loudFast) * Math.min(1, dt / 0.08);
    this.loudSlow += (loudN - this.loudSlow) * Math.min(1, dt / 2.5);
    this.loudN = this.loudFast; this.silence = rms < 0.004;

    let flux = 0, cnum = 0, cden = 0; const maxBin = Math.min(N, Math.floor(8000 / this.binHz));
    for (let i = 1; i < N; i++) { const d = db[i]; const m = d <= -110 ? 0 : Math.pow(10, d * 0.05); mag[i] = m; if (i < maxBin) { const df = m - prev[i]; if (df > 0) flux += df; cnum += m * i; cden += m; } }
    this.centroid = cden > 0 ? cnum / cden * this.binHz : 0; this.centroidS += (this.centroid - this.centroidS) * Math.min(1, dt / 0.3);
    const be = this.bandEdges;
    for (let k = 0; k < 8; k++) {
      const i0 = Math.max(1, Math.floor(be[k] / this.binHz)), i1 = Math.min(N - 1, Math.floor(be[k + 1] / this.binHz)); let e = 0;
      for (let i = i0; i <= i1; i++) e += mag[i] * mag[i]; e = Math.sqrt(e / (i1 - i0 + 1));
      this.bandPeak[k] = Math.max(e, this.bandPeak[k] * Math.exp(-dt / 15), 1e-4);
      const v = clamp(e / this.bandPeak[k], 0, 1); this.bands[k] += (v - this.bands[k]) * (v > this.bands[k] ? 0.6 : Math.min(1, dt / 0.25));
    }
    let smax = 0;
    for (let k = 0; k < 64; k++) { const f = 55 * Math.pow(2, k / 64 * 8), fi = f / this.binHz, i = Math.floor(fi), fr = fi - i; const m = i + 1 < N ? mag[i] * (1 - fr) + mag[i + 1] * fr : 0; const v = m * Math.pow(f / 55, 0.45); this.specRaw[k] = v; if (v > smax) smax = v; }
    this.specPeak = Math.max(smax, this.specPeak * Math.exp(-dt / 6), 1e-4);
    for (let k = 0; k < 64; k++) { const v = clamp(this.specRaw[k] / this.specPeak, 0, 1), cur = this.spec[k]; this.spec[k] = v > cur ? cur + (v - cur) * 0.55 : cur + (v - cur) * Math.min(1, dt / 0.18); }

    this.fluxMean += (flux - this.fluxMean) * Math.min(1, dt / 1.5);
    const fn = flux / (this.fluxMean + 1e-6), fh = this.fluxHist; fh[0] = fh[1]; fh[1] = fh[2]; fh[2] = fn;
    this.onsetStrength *= Math.exp(-dt / 0.12);
    if (fh[1] > fh[0] && fh[1] >= fh[2] && fh[1] > 1.5 && !this.silence && now - this.lastOnset > 0.09) {
      const strength = clamp((fh[1] - 1.2) / 4, 0.1, 1) * (0.45 + 0.55 * loudN); this.onsetStrength = Math.max(this.onsetStrength, strength); this.onset(now - dt, strength);
    }
    // chroma from spectral peaks
    const ch = this.chroma; ch.fill(0);
    for (let i = 2; i < N - 1; i++) { const p = this.pc[i]; if (p < 0) continue; const m = mag[i]; if (m > mag[i - 1] && m >= mag[i + 1]) ch[p] += m * this.pcw[i]; }
    let cs = 0; for (let p = 0; p < 12; p++) cs += ch[p];
    if (cs > 1e-6 && !this.silence) { const a = Math.min(1, dt / 0.2), ak = Math.min(1, dt / 7); for (let p = 0; p < 12; p++) { ch[p] /= cs; this.chromaS[p] += (ch[p] - this.chromaS[p]) * a; this.chromaK[p] += (ch[p] - this.chromaK[p]) * ak; } }
    if (!this.silence) { this.detectChord(now); this.detectKey(now, dt); this.detectPitch(now, dt); } else this.releasePitch(now);
    if (now - this.lastTempoCalc > 0.5) { this.lastTempoCalc = now; this.computeTempo(now); }
    this.trackBeats(now);
    if (this.loudFast > this.loudSlow + 0.3 && this.loudSlow < 0.55 && now - this.lastDrop > 5 && now - this.startT > 3) { this.lastDrop = now; this.emit({ type: 'drop', amt: clamp((this.loudFast - this.loudSlow) * 1.6, 0.4, 1) }); }
    let dens = 0; for (let i = this.onsets.length - 1; i >= 0 && now - this.onsets[i].t < 2; i--) dens++;
    this.onsetDensity += (clamp(dens / 16, 0, 1) - this.onsetDensity) * Math.min(1, dt / 1);
    prev.set(mag); this.frames++;
  }
  fingerprint() { const fp = this.fp; fp.fill(0); for (let k = 0; k < 64; k++) fp[Math.min(23, (k * 24 / 64) | 0)] += this.specRaw[k]; let n = 0; for (let k = 0; k < 24; k++) n += fp[k] * fp[k]; n = Math.sqrt(n) || 1; const out = new Float32Array(24); for (let k = 0; k < 24; k++) out[k] = fp[k] / n; return out; }
  onset(t, strength) {
    this.lastOnset = t; const fp = this.fingerprint();
    this.onsets.push({ t, strength }); while (this.onsets.length && t - this.onsets[0].t > 8) this.onsets.shift();
    this.emit({ type: 'onset', strength, t });
    if (this.bpm > 0 && this.bpmConf > 0.2 && this.anchor >= 0) {
      const ph = (t - this.anchor) / this.period, k = Math.round(ph), pred = this.anchor + k * this.period, off = t - pred;
      if (Math.abs(off) < 0.12 * this.period && strength > 0.3) { this.emit({ type: 'da', amt: 0.05 + 0.07 * strength, why: 'beat landed as predicted' }); this.anchor += off * 0.3; }
      else if (strength > 0.7 && this.bpmConf < 0.5) { this.anchor += off * 0.5; }
      this.tickK = Math.floor((t - this.anchor) / this.period);
    }
    if (strength > 0.22) {
      let best = -1, bs = 0;
      for (let i = 0; i < this.protos.length; i++) { const v = this.protos[i].v; let d = 0; for (let k = 0; k < 24; k++) d += v[k] * fp[k]; if (d > bs) { bs = d; best = i; } }
      if (bs > 0.93) { const p = this.protos[best]; if (t - p.last > 0.2) { p.count++; p.last = t; if (p.count >= 2) { this.repCounts.sample++; this.emit({ type: 'rep', kind: 'sample', hash: 's' + p.id, count: p.count, strength }); } } }
      else { this.protos.push({ v: fp, count: 1, last: t, id: this.protoId++ }); if (this.protos.length > 48) { let li = 0; for (let i = 1; i < this.protos.length; i++) if (this.protos[i].last < this.protos[li].last) li = i; this.protos.splice(li, 1); } }
    }
  }
  computeTempo(now) {
    // Tempogram by voting: every pair of onsets votes for each tempo at which its gap is a near-whole
    // number of beats (1 to 4), weighted by onset strength and down-weighted for longer multiples.
    const os = this.onsets; if (os.length < 6) { this.bpmConf *= 0.85; return; }
    const hist = new Float32Array(121); let total = 0;
    for (let i = 0; i < os.length; i++) for (let j = i + 1; j < os.length; j++) {
      const d = os[j].t - os[i].t; if (d < 0.2) continue; if (d > 2.4) break; const w = os[i].strength * os[j].strength; total += w;
      for (let k = 0; k <= 120; k++) { const m = d * (60 + k) / 60, mr = Math.round(m); if (mr < 1 || mr > 4) continue; const dev = (m - mr) / 0.075; if (dev > 2.2 || dev < -2.2) continue; hist[k] += w * Math.exp(-dev * dev) / mr; }
    }
    if (total <= 0) return;
    let bi = 0, bv = -1;
    for (let k = 0; k <= 120; k++) { const pref = Math.exp(-((k + 60 - 115) ** 2) / (2 * 40 * 40)); const v = hist[k] * (0.6 + 0.4 * pref); if (v > bv) { bv = v; bi = k; } }
    let cand = 60 + bi;
    if (bi > 0 && bi < 120) { const y0 = hist[bi - 1], y1 = hist[bi], y2 = hist[bi + 1], den = y0 - 2 * y1 + y2; if (Math.abs(den) > 1e-9) cand += clamp(0.5 * (y0 - y2) / den, -1, 1); }
    const conf = clamp(hist[bi] / (total * 0.28), 0, 1); this.bpmConf += (conf - this.bpmConf) * 0.5;
    if (this.bpm === 0) { if (conf > 0.25) { this.bpm = cand; this.period = 60 / cand; this.anchor = this.lastOnset; this.tickK = Math.floor((now - this.anchor) / this.period); } return; }
    const rel = (a, b) => Math.abs(a - b) / b;
    const near = rel(cand, this.bpm) < 0.045, family = near || rel(cand, this.bpm * 2) < 0.045 || rel(cand * 2, this.bpm) < 0.045;
    if (family) { if (near) this.bpm += (cand - this.bpm) * 0.3; this.bpmDisagree = 0; }
    else { this.bpmDisagree++; if (this.bpmDisagree >= 3 && conf > 0.25) { const from = this.bpm; this.bpm = cand; this.bpmDisagree = 0; this.bpmChangedAt = now; this.emit({ type: 'bpm', from, to: cand }); this.emit({ type: 'ne', amt: clamp(rel(cand, from) * 3.2, 0.35, 1), why: 'tempo ' + (cand > from ? 'rose' : 'fell') + ' ' + Math.round(from) + '→' + Math.round(cand) }); } }
    this.period = 60 / this.bpm;
  }
  trackBeats(now) {
    if (this.bpm <= 0 || this.bpmConf < 0.12 || this.anchor < 0) { this.beatPhase = 0; return; }
    const k = Math.floor((now - this.anchor) / this.period);
    if (k > this.tickK) { this.tickK = k; this.emit({ type: 'beat', k }); }
    this.beatPhase = ((now - this.anchor) / this.period) % 1;
  }
  detectChord(now) {
    const c = this.chromaS; let best = -1e9, br = -1, bq = 0;
    for (let q = 0; q < CHORD_T.length; q++) { const t = CHORD_T[q]; for (let r = 0; r < 12; r++) { let s = 0, tot = 0; for (let k = 0; k < 3; k++) { const v = c[(r + t.iv[k]) % 12]; s += v * t.w[k]; tot += v; } s -= 0.3 * (1 - tot); if (q >= 2) s -= 0.04; if (s > best) { best = s; br = r; bq = q; } } }
    const sorted = Array.from(c).sort((a, b) => b - a); this.chordEnergy = sorted[0] + sorted[1] + sorted[2];
    let ent = 0; for (let p = 0; p < 12; p++) if (c[p] > 1e-6) ent -= c[p] * Math.log(c[p]); this.tension += (clamp((ent / Math.log(12) - 0.55) / 0.4, 0, 1) - this.tension) * 0.05;
    if (this.chordEnergy < 0.42) { this.chordCandN = 0; return; }
    const id = br * 4 + bq;
    if (id === this.chord.root * 4 + this.chord.q) { this.chord.score = best; this.chordCandN = 0; return; }
    if (id === this.chordCand) this.chordCandN++; else { this.chordCand = id; this.chordCandN = 1; }
    if (this.chordCandN >= 5 && now - this.lastChordT > 0.25) {
      const prev = Object.assign({}, this.chord);
      this.chord = { root: br, q: bq, name: NOTE_NAMES[br] + CHORD_T[bq].sym, score: best }; this.lastChordT = now; this.chordCandN = 0;
      let resolved = false;
      if (this.key.root >= 0 && prev.root >= 0 && prev.root === (this.key.root + 7) % 12 && br === this.key.root && (bq === this.key.mode)) resolved = true;
      this.emit({ type: 'chord', root: br, q: bq, name: this.chord.name, prevQ: prev.q, resolved });
      if (resolved) { this.emit({ type: 'da', amt: 0.4, why: 'cadence resolved to ' + this.chord.name }); this.emit({ type: 'ht', amt: 0.25, why: 'resolution' }); }
      if (bq === 1 && prev.q === 0) this.emit({ type: 'ne', amt: 0.1, why: 'shift to minor' });
      this.chordSeq.push(id); if (this.chordSeq.length > 48) this.chordSeq.shift();
      this.checkRepetition(this.chordSeq, 'chord', [4, 3]);
    }
  }
  checkRepetition(seq, kind, ns) {
    for (const n of ns) {
      if (seq.length < 2 * n) continue;
      const last = seq.slice(-n).join(','); let count = 0;
      for (let i = 0; i + n <= seq.length - n; i++) if (seq.slice(i, i + n).join(',') === last) count++;
      if (count > 0) { this.repCounts[kind]++; this.emit({ type: 'rep', kind, hash: kind + ':' + last, count: count + 1 }); return true; }
    }
    return false;
  }
  detectKey(now, dt) {
    const c = this.chromaK; let bestMaj = -2, bestMin = -2, bestR = 0, bestM = 0, best = -2;
    for (let r = 0; r < 12; r++) { const a = pearson(c, KK_MAJ, r), b = pearson(c, KK_MIN, r); if (a > bestMaj) bestMaj = a; if (b > bestMin) bestMin = b; if (a > best) { best = a; bestR = r; bestM = 0; } if (b > best) { best = b; bestR = r; bestM = 1; } }
    const target = 1 / (1 + Math.exp(-(bestMaj - bestMin) * 9)); this.modeMix += (target - this.modeMix) * Math.min(1, dt / 2.5);
    const id = bestR * 2 + bestM;
    if (id !== this.key.root * 2 + this.key.mode) { if (id !== this.keyCand) { this.keyCand = id; this.keyCandT = now; } else if (now - this.keyCandT > 1.5 && best > 0.3) { this.key = { root: bestR, mode: bestM, conf: best, name: NOTE_NAMES[bestR] + (bestM ? ' minor' : ' major') }; } }
    else this.key.conf = best;
  }
  detectPitch(now, dt) {
    const td = this.td, x = this.pbuf, M = 1024; let e0 = 0;
    for (let i = 0; i < M; i++) { const v = (td[2 * i] + td[2 * i + 1]) * 0.5; x[i] = v; e0 += v * v; }
    if (e0 < 1e-5) { this.releasePitch(now); return; }
    const sr2 = this.sr / 2, minLag = Math.max(2, Math.floor(sr2 / 1100)), maxLag = Math.min(M >> 1, Math.floor(sr2 / 55)), nsdf = this.nsdf;
    for (let lag = minLag; lag <= maxLag; lag++) { let acf = 0, m = 0; const L = M - lag; for (let i = 0; i < L; i++) { const a = x[i], b = x[i + lag]; acf += a * b; m += a * a + b * b; } nsdf[lag] = m > 0 ? 2 * acf / m : 0; }
    let vmax = 0; const peaks = []; let crossed = false;
    for (let lag = minLag + 1; lag < maxLag; lag++) { if (!crossed) { if (nsdf[lag] < 0) crossed = true; continue; } if (nsdf[lag] > nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1]) { peaks.push(lag); if (nsdf[lag] > vmax) vmax = nsdf[lag]; } }
    if (!peaks.length || vmax < 0.82) { this.releasePitch(now); return; }
    let lag = peaks.find(p => nsdf[p] >= 0.9 * vmax);
    const y0 = nsdf[lag - 1], y1 = nsdf[lag], y2 = nsdf[lag + 1], den = y0 - 2 * y1 + y2; let fl = lag; if (Math.abs(den) > 1e-9) fl += 0.5 * (y0 - y2) / den;
    const f = sr2 / fl; if (f < 55 || f > 1100) { this.releasePitch(now); return; }
    const midiF = 69 + 12 * Math.log2(f / 440), midi = Math.round(midiF);
    this.pitch = { f, midi, clarity: nsdf[lag], note: NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1) };
    if (midi === this.heldMidi) this.noteHold += dt; else { this.heldMidi = midi; this.noteHold = 0; }
    if (this.noteHold >= 0.06 && midi !== this.lastNoteMidi) {
      if (now - this.lastNoteT > 2.5) this.lastNoteMidi = -1;
      if (this.lastNoteMidi >= 0) {
        const iv = midi - this.lastNoteMidi; this.melodySeq.push(iv); if (this.melodySeq.length > 64) this.melodySeq.shift();
        if (iv >= 5) this.emit({ type: 'da', amt: 0.12 + 0.02 * Math.min(iv, 12), why: 'melodic leap up ' + iv + ' semitones' });
        this.checkRepetition(this.melodySeq, 'melody', [5, 4]);
      }
      if (now - this.peakMidiT > 10) this.peakMidi = -1;
      if (midi > this.peakMidi) { if (this.peakMidi >= 0) this.emit({ type: 'da', amt: 0.1, why: 'new melodic peak ' + this.pitch.note }); this.peakMidi = midi; this.peakMidiT = now; }
      this.emit({ type: 'note', midi }); this.lastNoteMidi = midi; this.lastNoteT = now;
    }
  }
  releasePitch(now) { this.heldMidi = -1; this.noteHold = 0; if (this.pitch.midi >= 0 && now - this.lastNoteT > 0.4) this.pitch = { f: 0, midi: -1, clarity: 0, note: '—' }; }
}
