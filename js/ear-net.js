// The Tonnectome, stage 2: the fly's early auditory network from the FlyWire connectome (tools/ear_export.py).
// Johnston's organ neurons (JONs) read the antenna filterbank (js/ear-worklet.js); everything downstream is a
// connectome-constrained rate network: tau dV/dt = -V + G * sum_j w_ij r_j,  r = max(0, tanh V),
// w_ij = sign(j) * synapses(j -> i) / all input synapses onto i. It is NOT trained or fit to recordings:
// wiring and transmitter signs are measured; gains and time constants are set by hand.
//
// JON tuning follows the subgroups' known properties, not per-cell measurements:
//   A: vibration, high frequencies (about 250-1000 Hz), strongly adapting (phasic)
//   B: vibration, low frequencies (about 60-300 Hz), weakly adapting
//   D, and unassigned (JO-mz, JO-unclear): vibration, broad (about 80-700 Hz)
//   C, E: sustained deflection (gravity, wind): here the slow envelope of the sound, a stand-in
//   F: ventral group (grooming-related): slow envelope, weakly
// Each vibration JON is normalized by the sound energy across all bands of its antenna (divisive normalization
// across frequency), which keeps tuning sharp at any loudness.
(function (root) {
  const NB = 32, FLO = 40, FHI = 1600;
  const bandOf = f => Math.max(0, Math.min(NB - 1, Math.round((NB - 1) * Math.log(f / FLO) / Math.log(FHI / FLO))));
  const GROUP = {
    A: {lo: 250, hi: 1000, tauA: 0.04, kA: 0.85, gain: 1.0},
    B: {lo: 60, hi: 300, tauA: 0.25, kA: 0.35, gain: 1.0},
    D: {lo: 80, hi: 700, tauA: 0.12, kA: 0.5, gain: 0.8},
    X: {lo: 80, hi: 700, tauA: 0.12, kA: 0.5, gain: 0.6},
    C: {slow: 1, tauA: 1.0, kA: 0.2, gain: 0.3},
    E: {slow: 1, tauA: 1.0, kA: 0.2, gain: 0.3},
    F: {slow: 1, tauA: 0.5, kA: 0.3, gain: 0.15},
  };
  const TAU = [0.005, 0.01, 0.025, 0.06];   // s, per tier: JONs, then 2nd, 3rd, 4th order

  class EarNet {
    constructor(meta, bin, opts = {}) {
      const N = meta.n; this.N = N; this.meta = meta; this.dt = 0.005; this.G = opts.G ?? 8;
      const rowptr = new Int32Array(bin, 0, N + 1), E = rowptr[N];
      const pre = new Uint16Array(bin, 4 * (N + 1), E), syn = new Uint16Array(bin, 4 * (N + 1) + 2 * E, E);
      this.rowptr = rowptr; this.pre = pre; this.w = new Float32Array(E);
      for (let i = 0; i < N; i++) {
        const tot = Math.max(meta.intot[i], 1);
        for (let p = rowptr[i]; p < rowptr[i + 1]; p++) this.w[p] = meta.sign[pre[p]] * syn[p] / tot;
      }
      this.tier = new Uint8Array(N); let k = 0;
      meta.tiers.forEach((n, t) => { for (let j = 0; j < n; j++) this.tier[k++] = t; });
      this.alpha = Float32Array.from(this.tier, t => Math.min(1, this.dt / TAU[t]));
      // JONs: ear (side of the brain = same-side antenna), band, push/pull, adaptation
      const nJ = meta.tiers[0]; this.nJ = nJ;
      this.jEar = new Uint8Array(nJ); this.jBand = new Int16Array(nJ); this.jPol = new Uint8Array(nJ); this.jSlow = new Uint8Array(nJ);
      this.jTauA = new Float32Array(nJ); this.jKA = new Float32Array(nJ); this.jGain = new Float32Array(nJ); this.jA = new Float32Array(nJ);
      const byGroup = {};
      for (let j = 0; j < nJ; j++) (byGroup[meta.jo[j]] = byGroup[meta.jo[j]] || []).push(j);
      for (const [g, js] of Object.entries(byGroup)) {
        const P = GROUP[g] || GROUP.X;
        js.forEach((j, q) => {
          this.jEar[j] = meta.side[j] === 'R' ? 1 : 0; this.jPol[j] = q & 1; this.jSlow[j] = P.slow ? 1 : 0;
          // spread characteristic frequencies evenly (log) across the group's range
          if (!P.slow) this.jBand[j] = bandOf(P.lo * Math.pow(P.hi / P.lo, (q + 0.5) / js.length));
          this.jTauA[j] = P.tauA; this.jKA[j] = P.kA; this.jGain[j] = P.gain;
        });
      }
      this.V = new Float32Array(N); this.r = new Float32Array(N); this.acc = new Float32Array(N);
      this.c50 = opts.c50 ?? 0.01; this.cSlow = opts.cSlow ?? 0.2; this.kNorm = opts.kNorm ?? 3; this.pool = new Float32Array(2);
    }
    // frame from the ear worklet: [L push NB, L pull NB, R push NB, R pull NB, slow L, slow R]
    input(f) {
      const dt = this.dt, r = this.r;
      // pooled energy per antenna: mean envelope over bands and both half-cycles
      for (let e = 0; e < 2; e++) { let s = 0; for (let k = 0; k < 2 * NB; k++) s += f[e * 2 * NB + k]; this.pool[e] = s / (2 * NB); }
      for (let j = 0; j < this.nJ; j++) {
        const e = this.jEar[j];
        const env = this.jSlow[j] ? f[4 * NB + e] : f[e * 2 * NB + this.jPol[j] * NB + this.jBand[j]];
        const c = this.jSlow[j] ? this.cSlow : this.c50 + this.kNorm * this.pool[e];
        const d = this.jGain[j] * env / (env + c);
        this.jA[j] += (d - this.jA[j]) * dt / this.jTauA[j];
        const v = d - this.jKA[j] * this.jA[j];
        r[j] = v > 0 ? (v < 1 ? v : 1) : 0;
      }
    }
    step() {
      const N = this.N, rp = this.rowptr, pre = this.pre, w = this.w, r = this.r, V = this.V, acc = this.acc, G = this.G;
      for (let i = this.nJ; i < N; i++) {
        let s = 0; for (let p = rp[i]; p < rp[i + 1]; p++) s += w[p] * r[pre[p]];
        acc[i] = G * s;
      }
      for (let i = this.nJ; i < N; i++) { V[i] += this.alpha[i] * (acc[i] - V[i]); const v = V[i]; r[i] = v > 0 ? Math.tanh(v) : 0; }
    }
    reset() { this.V.fill(0); this.r.fill(0); this.jA.fill(0); }
    // What each neuron listens to, inherited through the wiring: a 2 x NB profile (which antenna, which band).
    // A vibration JON is tuned to its band (Gaussian, about 1 band wide) on its own antenna; a deflection JON
    // (C, E, F) has no pitch, so it is flat across its antenna's bands. Every other neuron takes the sum of its
    // excitatory inputs' profiles, weighted by synapse share, normalised to 1. Inhibition shapes responses but is
    // not counted as a preference. Four passes in tier order settle the feed-forward chain.
    tuning() {
      const N = this.N, K = 2 * NB, T = new Float32Array(N * K);
      for (let j = 0; j < this.nJ; j++) {
        const o = j * K + this.jEar[j] * NB;
        if (this.jSlow[j]) { for (let b = 0; b < NB; b++) T[o + b] = 1 / NB; continue; }
        let s = 0; for (let b = 0; b < NB; b++) { const g = Math.exp(-0.5 * ((b - this.jBand[j]) / 1.0) ** 2); T[o + b] = g; s += g; }
        for (let b = 0; b < NB; b++) T[o + b] /= s;
      }
      const rp = this.rowptr, pre = this.pre, w = this.w, acc = new Float32Array(K);
      for (let pass = 0; pass < 4; pass++) for (let i = this.nJ; i < N; i++) {
        acc.fill(0); let tot = 0;
        for (let p = rp[i]; p < rp[i + 1]; p++) { const ww = w[p]; if (ww <= 0) continue; const o = pre[p] * K; for (let k = 0; k < K; k++) acc[k] += ww * T[o + k]; tot += ww; }
        const o = i * K;
        let s = 0; for (let k = 0; k < K; k++) s += acc[k];
        if (tot > 0 && s > 0) for (let k = 0; k < K; k++) T[o + k] = acc[k] / s;
      }
      // the few with no excitatory path from the ear listen to everything equally
      for (let i = this.nJ; i < N; i++) { let s = 0; for (let k = 0; k < K; k++) s += T[i * K + k]; if (!(s > 0)) for (let k = 0; k < K; k++) T[i * K + k] = 1 / K; }
      this.T = T; return T;
    }
  }
  EarNet.NB = NB; EarNet.FLO = FLO; EarNet.FHI = FHI;
  if (typeof module !== 'undefined') module.exports = EarNet; else root.EarNet = EarNet;
})(this);
