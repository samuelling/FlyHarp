// Optional gain control around the trained flyvis network, which itself has none (it is linear above threshold,
// with subtractive inhibition only). Two independent stages, both off by default:
//
// 1. Photoreceptor adaptation (front end). Each ommatidium keeps an adapting luminance A (first-order low-pass,
//    time constant tauA), and passes on Weber contrast x = (I - A) / (A + sigma), compressed as x / (1 + |x| / k).
//    The network sees 0.5 * (1 + x'), so at steady state any mean luminance looks like the grey it was trained on.
//
// 2. Divisive normalization (inside the network). A contrast-energy pool per column: squared photoreceptor contrast
//    relative to a slow local mean, Gaussian-weighted over neighbouring columns (sd poolR) and low-passed (tauN).
//    The drive onto the chosen target cells is divided around its grey value:
//        D = D0 + (D - D0) / (1 + sqrt(2 * pool) / c50)
//    so a full-field grating of contrast c gives a response ~ c / (1 + c / c50), and a pool wider than the
//    receptive field gives contrast-dependent surround suppression.
(function (root) {
  const TARGETS = {
    lamina: ['L1', 'L2', 'L3'],
    medulla: ['Mi1', 'Tm3', 'Mi4', 'Mi9', 'Tm1', 'Tm2', 'Tm4', 'Tm9'],
  };
  TARGETS.both = TARGETS.lamina.concat(TARGETS.medulla);

  class GainControl {
    constructor(eng) {
      this.eng = eng; this.nC = eng.nC; this.dt = eng.dt;
      this.p = {adapt: false, tauA: 0.5, sigmaA: 0.02, k: 1.0, norm: false, target: 'lamina', poolR: 3, c50: 0.25, tauN: 0.08};
      this.A = new Float32Array(this.nC).fill(0.5);       // adapting luminance per ommatidium
      this.M = new Float32Array(this.nC).fill(0.5);       // slow local mean, for the normalization pool's contrast
      this.E = new Float32Array(this.nC);                 // pooled contrast energy (low-passed)
      this.e = new Float32Array(this.nC);
      this.out = new Float32Array(this.nC);
      this.g = new Float32Array(this.nC).fill(1);          // per-column divisive gain
      this.mask = new Uint8Array(eng.N);
      this.poolW = null; this.poolFor = -1;
      this.set({});
    }
    set(q) {
      Object.assign(this.p, q);
      const T = this.eng.types, want = new Set((TARGETS[this.p.target] || []).map(t => T.indexOf(t)));
      for (let i = 0; i < this.eng.N; i++) this.mask[i] = want.has(this.eng.nodeType[i]) ? 1 : 0;
      if (this.p.poolR !== this.poolFor) this.buildPool();
      this.eng.normMask = this.mask;
      this.eng.normG = this.p.norm ? this.g : null;
    }
    // dense Gaussian pooling weights over the eye (721^2), rows renormalized so edge columns aren't penalized
    buildPool() {
      const n = this.nC, x = this.eng.x, y = this.eng.y, s2 = 2 * this.p.poolR * this.p.poolR, W = new Float32Array(n * n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) { const w = Math.exp(-((x[i] - x[j]) ** 2 + (y[i] - y[j]) ** 2) / s2); W[i * n + j] = w; sum += w; }
        for (let j = 0; j < n; j++) W[i * n + j] /= sum;
      }
      this.poolW = W; this.poolFor = this.p.poolR;
    }
    // start fully adapted to a uniform screen of luminance `level`, with an empty pool
    reset(level = 0.5) { this.A.fill(level); this.M.fill(this.p.adapt ? 0.5 : level); this.E.fill(0); this.g.fill(1); }
    // one 20 ms frame: returns what the photoreceptors are driven with, and updates the divisive gains
    process(lum) {
      const n = this.nC, p = this.p, out = this.out;
      if (p.adapt) {
        const a = this.dt / Math.max(p.tauA, this.dt), A = this.A;
        for (let k = 0; k < n; k++) {
          const I = Math.max(lum[k], 0), x = (I - A[k]) / (A[k] + p.sigmaA);
          out[k] = 0.5 * (1 + x / (1 + Math.abs(x) / p.k));
          A[k] += a * (I - A[k]);
        }
      } else out.set(lum);
      if (p.norm) {
        const M = this.M, e = this.e, E = this.E, W = this.poolW, aM = this.dt / 1.0, aN = this.dt / Math.max(p.tauN, this.dt);
        for (let k = 0; k < n; k++) { const c = (out[k] - M[k]) / Math.max(M[k], 0.05); e[k] = c * c; M[k] += aM * (out[k] - M[k]); }
        for (let i = 0; i < n; i++) {
          let s = 0; const row = i * n;
          for (let j = 0; j < n; j++) s += W[row + j] * e[j];
          E[i] += aN * (s - E[i]);
          this.g[i] = 1 / (1 + Math.sqrt(2 * E[i]) / p.c50);
        }
      }
      return out;
    }
  }
  GainControl.TARGETS = TARGETS;
  if (typeof module !== 'undefined') module.exports = GainControl; else root.GainControl = GainControl;
})(this);
