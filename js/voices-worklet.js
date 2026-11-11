// FlyHarp voices (AudioWorklet). One message per note:
// {engine, freq, vel, pan, dur, p:{...}}
// engines: pluck, modal, fm, pad, glass, click, additive, vowel, breath, membrane, shaker, saw, grains
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
    else if (v.e === 'additive' || v.e === 'grains') {
      v.ratios = p.ratios; v.amps = p.amps; v.decays = p.decays || p.ratios.map(() => 1e9); v.ph = Float64Array.from(p.ratios, () => Math.random());
      v.lfo = Float64Array.from(p.ratios, () => Math.random() * TAU);
    } else if (v.e === 'vowel') {
      // a buzzy source through three formant resonators (two-pole band-passes)
      v.ph = Math.random(); v.fs = (p.formants || [700, 1220, 2600]).map((F, i) => { const w = TAU * F / sr, r = Math.exp(-Math.PI * (60 + 40 * i) / sr); return {b1: 2 * r * Math.cos(w), b2: -r * r, g: (1 - r) * [1, 0.6, 0.3][i], y1: 0, y2: 0}; });
    } else if (v.e === 'breath') {
      const w = TAU * m.freq / sr, r = Math.exp(-Math.PI * m.freq / (p.q ?? 40) / sr); v.b1 = 2 * r * Math.cos(w); v.b2 = -r * r; v.g = 1 - r; v.y1 = 0; v.y2 = 0; v.ph = 0;
    } else if (v.e === 'membrane') { v.ph = 0; v.ph2 = 0; }
    else if (v.e === 'shaker') {
      const F = Math.min(sr * 0.45, m.freq * (p.mult ?? 8)), w = TAU * F / sr, r = Math.exp(-Math.PI * F / (p.q ?? 6) / sr);
      v.b1 = 2 * r * Math.cos(w); v.b2 = -r * r; v.g = 1 - r; v.y1 = 0; v.y2 = 0;
    } else if (v.e === 'saw') { v.ph = 0; v.ph2 = 0.5; v.s1 = 0; v.s2 = 0; }
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
          case 'additive': case 'grains': {
            // additive: partials with their own decays and a gentle shimmer; grains: the same, slow swells, a drifting cloud
            const A = p.attack ?? 0.01, env = t < A ? t / A : t < A + v.dur * (p.hold ?? 1) ? 1 : Math.exp(-(t - A - v.dur * (p.hold ?? 1)) / (p.release ?? 0.4));
            const sh = p.shimmer ?? 0.002, rate = v.e === 'grains' ? 0.7 : 0.25;
            for (let q = 0; q < v.ratios.length; q++) {
              const mod = Math.sin(TAU * rate * (1 + 0.37 * q) * t + v.lfo[q]);
              v.ph[q] += v.f * v.ratios[q] * (1 + sh * mod) * dt;
              const a = v.e === 'grains' ? v.amps[q] * (0.55 + 0.45 * mod) : v.amps[q];
              y += a * Math.exp(-t / v.decays[q]) * Math.sin(TAU * v.ph[q]);
            }
            y *= env * v.vel * (v.e === 'grains' ? 0.27 : 0.16); break;
          }
          case 'vowel': {
            const A = p.attack ?? 0.08, env = t < A ? t / A : t < A + v.dur ? 1 : Math.exp(-(t - A - v.dur) / (p.release ?? 0.5));
            v.ph += v.f * (1 + 0.006 * Math.sin(TAU * 5.2 * t)) * dt; v.ph -= Math.floor(v.ph);
            const src = (2 * v.ph - 1) + (Math.random() * 2 - 1) * (p.breath ?? 0.15);
            for (const F of v.fs) { const yy = F.g * src + F.b1 * F.y1 + F.b2 * F.y2; F.y2 = F.y1; F.y1 = yy; y += yy; }
            y *= env * v.vel * 0.2; break;
          }
          case 'breath': {
            // a breathy resonator plus a soft tone: flutes, pipes, blown bottles
            const A = p.attack ?? 0.04, env = t < A ? t / A : t < A + v.dur ? 1 : Math.exp(-(t - A - v.dur) / (p.release ?? 0.25));
            const chiff = t < 0.03 ? 1.5 : 1, x = (Math.random() * 2 - 1) * chiff;
            const yy = v.g * x + v.b1 * v.y1 + v.b2 * v.y2; v.y2 = v.y1; v.y1 = yy;
            v.ph += v.f * dt; y = (yy * (p.noise ?? 2.5) + (p.tone ?? 0.35) * Math.sin(TAU * v.ph)) * env * v.vel * 0.3; break;
          }
          case 'membrane': {
            // a drum: the pitch falls from above onto the note, an inharmonic second mode, a stick click
            const drop = p.drop ?? 2.2, f = v.f * (1 + (drop - 1) * Math.exp(-t / (p.dropT ?? 0.03)));
            v.ph += f * dt; v.ph2 += f * 1.593 * dt;
            y = (Math.sin(TAU * v.ph) + 0.35 * Math.sin(TAU * v.ph2) * Math.exp(-t / 0.05)) * Math.exp(-t / (p.decay ?? 0.35));
            if (t < 0.003) y += (Math.random() * 2 - 1) * (p.click ?? 0.4);
            y *= v.vel * 0.42; break;
          }
          case 'shaker': {
            const A = p.attack ?? 0.002, x = (Math.random() * 2 - 1);
            const yy = v.g * x + v.b1 * v.y1 + v.b2 * v.y2; v.y2 = v.y1; v.y1 = yy;
            y = yy * Math.min(1, t / A) * Math.exp(-t / (p.decay ?? 0.06)) * v.vel * (p.gain ?? 2.0); break;
          }
          case 'saw': {
            // two detuned saws into a resonant low-pass whose cutoff snaps shut: the classic synth pluck
            v.ph += v.f * dt; v.ph -= Math.floor(v.ph); v.ph2 += v.f * (1 + (p.detune ?? 0.004)) * dt; v.ph2 -= Math.floor(v.ph2);
            const raw = (2 * v.ph - 1) + (2 * v.ph2 - 1);
            const fc = v.f * (1 + (p.env ?? 12) * Math.exp(-t / (p.fdecay ?? 0.12))) * (p.cut ?? 1.5), g = Math.min(0.95, TAU * fc / sr), res = p.res ?? 0.5;
            v.s1 += g * (raw - v.s1 - res * (v.s2 - v.s1) * 0); v.s2 += g * (v.s1 - v.s2); v.s1 += res * g * (v.s1 - v.s2);
            const A = 0.003, env = t < A ? t / A : Math.exp(-t / (p.decay ?? 0.4));
            y = v.s2 * env * v.vel * 0.42; break;
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
