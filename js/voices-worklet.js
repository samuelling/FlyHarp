// FlyHarp voices (AudioWorklet). One message per note:
// {engine, freq, vel, pan, dur, p:{...}}  engines: pluck, modal, fm, pad, glass, click
const TAU = 2 * Math.PI;
class Voices extends AudioWorkletProcessor {
  constructor(opts) {
    super(); this.v = []; this.max = 56; this.port.onmessage = e => this.add(e.data);
    for (const m of (opts && opts.processorOptions && opts.processorOptions.notes) || []) this.add(m); // used by offline tests
  }
  add(m) {
    const sr = sampleRate, a = (m.pan + 1) * Math.PI / 4, p = m.p || {};
    const v = {e: m.engine, f: m.freq, vel: m.vel, gl: Math.cos(a), gr: Math.sin(a), t: 0, dur: m.dur || 0.4, p, life: sr * 10};
    if (v.e === 'pluck') {
      const n = Math.max(2, Math.round(sr / m.freq)); v.buf = new Float32Array(n); v.i = 0;
      const lp = 1 - Math.min(0.95, Math.max(0.05, p.bright ?? 0.6)); let prev = 0;
      for (let i = 0; i < n; i++) { prev = prev * lp + (Math.random() * 2 - 1) * (1 - lp); v.buf[i] = prev * m.vel; }
      v.decay = p.decay ?? 0.996;
    } else if (v.e === 'modal' || v.e === 'glass') {
      v.ratios = p.ratios; v.decays = p.decays; v.amps = p.amps; v.ph = new Float64Array(p.ratios.length);
    } else if (v.e === 'fm') { v.pc = 0; v.pm = 0; }
    else if (v.e === 'pad') { v.p1 = Math.random(); v.p2 = Math.random(); v.lp = 0; }
    else if (v.e === 'click') { v.y1 = 0; v.y2 = 0; const w = TAU * m.freq / sr, q = p.q ?? 30; v.b1 = 2 * Math.exp(-w / (2 * q)) * Math.cos(w); v.b2 = -Math.exp(-w / q); }
    if (this.v.length >= this.max) this.v.shift();
    this.v.push(v);
  }
  process(_, outputs) {
    const L = outputs[0][0], R = outputs[0][1] || L, n = L.length, sr = sampleRate, dt = 1 / sr;
    L.fill(0); if (R !== L) R.fill(0);
    const keep = [];
    for (const v of this.v) {
      let e2 = 0;
      const p = v.p;
      for (let k = 0; k < n; k++) {
        let y = 0;
        const t = v.t;
        switch (v.e) {
          case 'pluck': {
            const i = v.i, j = i + 1 === v.buf.length ? 0 : i + 1; y = v.buf[i]; v.buf[i] = v.decay * 0.5 * (y + v.buf[j]); v.i = j; y *= 1.4; break;
          }
          case 'modal': case 'glass': {
            const att = Math.min(1, t / (p.attack ?? 0.002));
            for (let q = 0; q < v.ratios.length; q++) {
              v.ph[q] += v.f * v.ratios[q] * dt; y += v.amps[q] * Math.exp(-t / v.decays[q]) * Math.sin(TAU * v.ph[q]);
            }
            y *= att * v.vel * (v.e === 'glass' ? 0.22 : 0.3); break;
          }
          case 'fm': {
            v.pc += v.f * dt; v.pm += v.f * p.ratio * dt;
            const idx = p.index * Math.exp(-t / p.idecay);
            y = Math.sin(TAU * v.pc + idx * Math.sin(TAU * v.pm)) * Math.exp(-t / p.decay) * Math.min(1, t / 0.002) * v.vel * 0.28; break;
          }
          case 'pad': {
            const d = p.detune;
            v.p1 += v.f * (1 + d) * dt; v.p2 += v.f * (1 - d) * dt; v.p1 -= Math.floor(v.p1); v.p2 -= Math.floor(v.p2);
            const raw = (2 * v.p1 - 1) + (2 * v.p2 - 1);
            const c = Math.min(0.99, TAU * p.cutoff * v.f * dt); v.lp += c * (raw - v.lp);
            const env = t < p.attack ? t / p.attack : t < p.attack + v.dur ? 1 : Math.exp(-(t - p.attack - v.dur) / p.release);
            y = v.lp * env * v.vel * 0.18; break;
          }
          case 'click': {
            // struck: a 4 ms noise burst into the resonator; hyperpolarisation: breathy filtered noise that swells in
            const x = p.rev ? (Math.random() * 2 - 1) * 0.12 : t < 0.004 ? (Math.random() * 2 - 1) : 0;
            const yy = x + v.b1 * v.y1 + v.b2 * v.y2; v.y2 = v.y1; v.y1 = yy;
            y = yy * v.vel * (p.gain ?? 0.08) * (3 / (p.q ?? 30)) * Math.exp(-t / (p.decay ?? 0.25)); break;
          }
        }
        if (p.rev) { // reversed envelope for hyperpolarisation voices: swell in, then a quick release
          const A = p.rev, x = t / A;
          y *= t < A ? x * x * (p.revGain ?? 2.5) : (p.revGain ?? 2.5) * Math.exp(-(t - A) / 0.09);
        }
        L[k] += y * v.gl; if (R !== L) R[k] += y * v.gr;
        e2 += y * y; v.t += dt;
      }
      v.life -= n;
      if (v.life > 0 && (v.t < 0.05 || (p.rev && v.t < p.rev) || e2 / n > 1e-10)) keep.push(v);
    }
    this.v = keep;
    for (let k = 0; k < n; k++) { L[k] = Math.tanh(L[k] * 0.7); if (R !== L) R[k] = Math.tanh(R[k] * 0.7); }
    return true;
  }
}
registerProcessor('voices', Voices);
