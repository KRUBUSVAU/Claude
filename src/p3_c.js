
// ---------- brain model ----------
const R = regions.length;
const CORTEX = ['pfc', 'motor', 'parietal', 'occipital', 'temporal'].map(id => regionById[id].i);
class Brain {
  constructor() {
    this.act = new Float32Array(R).fill(0.12); this.flash = new Float32Array(R); this.flashHue = new Float32Array(R).fill(-1); this.recept = new Float32Array(R);
    this.nt = { da: { tonic: 0, phasic: 0, level: 0, why: '', whyT: -10 }, ne: { tonic: 0, phasic: 0, level: 0, why: '', whyT: -10 }, ht: { tonic: 0, phasic: 0, level: 0, why: '', whyT: -10 } };
    this.pulses = []; this.conns = []; this.connByHash = new Map(); this.modeMix = 0.5; this.memory = 0; this.beatPulse = 0; this.spontT = 0; this.now = 0; this.undPhase = 0;
    this.chordHue = -1; this.lastChordName = ''; this.dropT = -10; this.bpmChangeT = -10;
  }
  release(nt, amt, why, now) {
    const o = this.nt[nt]; o.phasic = Math.min(1.2, o.phasic + amt); if (why && amt >= 0.08) { o.why = why; o.whyT = now; }
    for (const p of paths) if (p.nt === nt && p.to) this.spawnPulse(p, clamp(amt * 1.3, 0.25, 1), now);
  }
  spawnPulse(p, intensity, now) {
    if (now - p.lastSpawn < 0.11) { const last = this.pulses[this.pulses.length - 1]; if (last && last.p === p) last.i = Math.min(1, last.i + intensity * 0.5); return; }
    p.lastSpawn = now; this.pulses.push({ p, t: 0, i: intensity, speed: 110 / p.length });
  }
  connect(e, now) {
    const kinds = { melody: ['auditory', 'hippocampus', 'pfc'], chord: ['pfc', 'hippocampus', 'cingulate'], sample: ['auditory', 'auditory', 'thalamus'] };
    const rs = (kinds[e.kind] || kinds.melody).map(id => regionById[id]);
    let list = this.connByHash.get(e.hash);
    if (list) { for (const c of list) { c.s = Math.min(1, c.s + 0.22); c.spark = 0; c.t = now; } return; }
    const rng = mulberry32(fnv(e.hash)); list = [];
    const K = e.kind === 'sample' ? 3 : 4;
    for (let k = 0; k < K; k++) {
      const ra = rs[k % rs.length], rb = rs[(k + 1) % rs.length];
      const a = ra.start + Math.floor(rng() * (ra.end - ra.start)), b = rb.start + Math.floor(rng() * (rb.end - rb.start));
      if (a === b) continue;
      const c = { a, b, s: 0.32, spark: 0, t: now, kind: e.kind, bend: (rng() - 0.5) * 70, hash: e.hash };
      list.push(c); this.conns.push(c);
    }
    this.connByHash.set(e.hash, list);
    if (this.conns.length > 420) { this.conns.sort((x, y) => y.s - x.s); const drop = this.conns.splice(400); for (const c of drop) { const l = this.connByHash.get(c.hash); if (l) { const i = l.indexOf(c); if (i >= 0) l.splice(i, 1); if (!l.length) this.connByHash.delete(c.hash); } } }
  }
  update(dt, F, active, now) {
    this.now = now;
    const act = this.act, flash = this.flash, recept = this.recept, nt = this.nt, g = regionById;
    const dec = Math.exp(-dt / 0.38), decR = Math.exp(-dt / 1.3);
    for (let r = 0; r < R; r++) { flash[r] *= dec; recept[r] *= decR; }
    nt.da.phasic *= Math.exp(-dt / 1.6); nt.ne.phasic *= Math.exp(-dt / 2.2); nt.ht.phasic *= Math.exp(-dt / 5);
    this.beatPulse *= Math.exp(-dt / 0.25); this.memory *= Math.exp(-dt / 6);

    for (const e of F.events) {
      switch (e.type) {
        case 'onset':
          flash[g.motor.i] += e.strength * 0.9; flash[g.striatum.i] += e.strength * 0.5; flash[g.thalamus.i] += e.strength * 0.4; flash[g.brainstem.i] += e.strength * 0.5; this.beatPulse = Math.max(this.beatPulse, e.strength);
          if (e.strength > 0.75) { flash[g.amygdala.i] += 0.5; this.release('ne', 0.12, 'sudden transient', now); }
          spawnPath('auditoryPath', e.strength, now); if (e.strength > 0.4) spawnPath('ctc', e.strength * 0.7, now);
          if (e.strength > 0.6) spawnPath('callosum', e.strength * 0.5, now);
          break;
        case 'beat': flash[g.cerebellum.i] += 0.7; flash[g.motor.i] += 0.2; spawnPath('striatal', 0.5, now); break;
        case 'chord': {
          const h = CHORD_HUE[e.q]; this.chordHue = h; this.lastChordName = e.name;
          flash[g.pfc.i] = Math.max(flash[g.pfc.i], 1); this.flashHue[g.pfc.i] = h;
          flash[g.cingulate.i] += 0.55; this.flashHue[g.cingulate.i] = h;
          if (e.q === 1 && e.prevQ !== 1) { flash[g.amygdala.i] += 0.45; this.flashHue[g.amygdala.i] = h; }
          spawnPath('arcuate', 0.8, now); break;
        }
        case 'bpm': this.bpmChangeT = now; break;
        case 'da': case 'ne': case 'ht': this.release(e.type, e.amt, e.why, now); break;
        case 'drop': this.release('da', e.amt, 'drop', now); this.release('ne', e.amt * 0.6, 'drop', now); for (const r of CORTEX) flash[r] += 0.45; this.dropT = now; break;
        case 'rep':
          flash[g.hippocampus.i] += e.kind === 'sample' ? 0.3 : 0.7; this.memory = Math.min(1, this.memory + (e.kind === 'sample' ? 0.08 : 0.3)); this.connect(e, now);
          if (e.kind !== 'sample') { this.release('da', 0.14, 'recognised a ' + (e.kind === 'melody' ? 'melody' : 'progression'), now); spawnPath('fornix', 0.8, now); }
          else if (e.count % 4 === 0) spawnPath('fornix', 0.4, now);
          break;
      }
    }
    // neuromodulator tonic levels
    if (active) {
      nt.ne.tonic = 0.22 * F.loudN + 0.3 * F.onsetDensity + 0.15 * smoothstep(0, 1, (F.centroidS - 800) / 3000);
      nt.da.tonic = 0.12 * F.loudN + 0.12 * F.bpmConf + 0.1 * this.memory;
      nt.ht.tonic = (0.3 * F.modeMix + 0.12) * F.bpmConf * (F.loudN > 0.03 ? 1 : 0) + 0.12 * (1 - F.onsetDensity) * F.loudN;
      this.modeMix += (F.modeMix - this.modeMix) * Math.min(1, dt / 1.5);
    } else { nt.ne.tonic = nt.da.tonic = nt.ht.tonic = 0; this.modeMix += (0.5 - this.modeMix) * Math.min(1, dt / 3); }
    for (const k in nt) nt[k].level = clamp(nt[k].tonic + nt[k].phasic, 0, 1);
    const da = nt.da.level, ne = nt.ne.level, ht = nt.ht.level;
    const tg = new Float32Array(R).fill(0.12);
    if (active) {
      const b = F.bands, L = F.loudN;
      tg[g.pfc.i] = 0.22 + 0.3 * F.tension + 0.25 * da;
      tg[g.motor.i] = 0.18 + 0.35 * L + 0.3 * Math.max(b[0], b[1]);
      tg[g.parietal.i] = 0.14 + 0.45 * Math.max(b[3], b[4]) + 0.3 * ne;
      tg[g.occipital.i] = 0.14 + 0.45 * Math.max(b[6], b[7]) + 0.3 * ne;
      tg[g.temporal.i] = 0.14 + 0.5 * L;
      tg[g.auditory.i] = 0.22 + 0.15 * L;
      tg[g.cingulate.i] = 0.22 + 0.3 * ht + 0.25 * F.tension;
      tg[g.striatum.i] = 0.18 + 0.45 * da + 0.35 * this.beatPulse;
      tg[g.thalamus.i] = 0.18 + 0.6 * L;
      tg[g.hypothalamus.i] = 0.18 + 0.6 * ne;
      tg[g.hippocampus.i] = 0.18 + 0.55 * this.memory;
      tg[g.amygdala.i] = 0.14 + 0.5 * (1 - this.modeMix) * L + 0.25 * ne;
      tg[g.accumbens.i] = 0.14 + 0.8 * da;
      tg[g.cerebellum.i] = 0.16 + 0.4 * F.bpmConf + 0.2 * L;
      tg[g.brainstem.i] = 0.14 + 0.5 * L;
      tg[g.vta.i] = 0.2 + 0.8 * da; tg[g.lc.i] = 0.2 + 0.8 * ne; tg[g.raphe.i] = 0.2 + 0.8 * ht;
    } else {
      // resting-state network: slow spontaneous activity
      this.spontT -= dt;
      if (this.spontT <= 0 && !REDUCED) { this.spontT = 0.9 + Math.random() * 1.6; const p = paths[Math.floor(Math.random() * paths.length)]; if (p.to) this.spawnPulse(p, 0.45, now); if (Math.random() < 0.4) flash[Math.floor(Math.random() * R)] += 0.35; }
    }
    const k = Math.min(1, dt / 0.16);
    for (let r = 0; r < R; r++) act[r] += (tg[r] - act[r]) * k;
    this.undPhase += dt * (active && F.bpm > 0 ? TAU * (F.bpm / 60) / 8 : 0.45);

    // pulses
    for (const p of paths) { const gl = p.glow, d = Math.exp(-dt / 0.22); for (let i = 0; i < gl.length; i++) gl[i] *= d; }
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pu = this.pulses[i]; pu.t += dt * pu.speed; const pts = pu.p.pts, gl = pu.p.glow;
      const head = pu.t; const lo = Math.max(0, Math.floor((head - 0.1) * pts.length)), hi = Math.min(pts.length - 1, Math.ceil(head * pts.length));
      for (let j = lo; j <= hi; j++) { const d = head - pts[j].t; if (d >= 0 && d < 0.1) gl[j] = Math.max(gl[j], pu.i * (1 - d / 0.1)); }
      if (pu.t >= 1) {
        const to = pu.p.toR; if (to) { flash[to.i] += pu.i * 0.5; recept[to.i] = Math.min(1.5, recept[to.i] + pu.i); if (pu.p.nt !== 'glu') this.flashHue[to.i] = NT[pu.p.nt].hue; }
        this.pulses.splice(i, 1);
      }
    }
    // connections
    const cd = Math.exp(-dt / 90);
    for (let i = this.conns.length - 1; i >= 0; i--) { const c = this.conns[i]; c.s *= cd; if (c.spark >= 0) { c.spark += dt / 0.7; if (c.spark > 1) c.spark = -1; } if (c.s < 0.05) { this.conns.splice(i, 1); const l = this.connByHash.get(c.hash); if (l) { const j = l.indexOf(c); if (j >= 0) l.splice(j, 1); if (!l.length) this.connByHash.delete(c.hash); } } }
  }
}
