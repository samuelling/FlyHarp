// The Tonnectome, stage 1: the fly's antenna as a filterbank (AudioWorklet).
// Input: stereo sound (left channel -> left antenna, right -> right antenna).
// The arista and third antennal segment are a broad mechanical resonator (here peaking near 250 Hz); Johnston's
// organ neurons then read the rotation in narrower bands, each on one half of the cycle (push or pull).
// Every 5 ms it posts, through a MessagePort handed to it by the page, one frame:
//   [ear L: NB push envelopes, NB pull envelopes | ear R: same | slow envelope L, slow envelope R]
const NB = 32, FLO = 40, FHI = 1600, Q = 5, F0 = 250, QA = 0.8;
class Ear extends AudioWorkletProcessor {
  constructor() {
    super();
    this.out = null;
    this.port.onmessage = e => { if (e.data && e.data.port) this.out = e.data.port; };
    this.fc = Float64Array.from({length: NB}, (_, k) => FLO * Math.pow(FHI / FLO, k / (NB - 1)));
    // RBJ band-pass (0 dB peak) per band, weighted by the antenna's broad resonance
    this.b0 = new Float64Array(NB); this.a1 = new Float64Array(NB); this.a2 = new Float64Array(NB); this.g = new Float64Array(NB);
    for (let k = 0; k < NB; k++) {
      const w = 2 * Math.PI * this.fc[k] / sampleRate, al = Math.sin(w) / (2 * Q), a0 = 1 + al;
      this.b0[k] = al / a0; this.a1[k] = -2 * Math.cos(w) / a0; this.a2[k] = (1 - al) / a0;
      const r = this.fc[k] / F0 - F0 / this.fc[k]; this.g[k] = 1 / Math.sqrt(1 + (QA * r) ** 2);
    }
    this.s = new Float64Array(2 * NB * 4);       // per ear, per band: x1, x2, y1, y2
    this.acc = new Float64Array(2 * NB * 2 + 2);
    this.slow = new Float64Array(2);
    this.n = 0; this.frame = Math.round(sampleRate * 0.005);
  }
  process(inputs, outputs) {
    const inp = inputs[0], L = inp && inp[0], R = inp && (inp[1] || inp[0]);
    const len = outputs[0] && outputs[0][0] ? outputs[0][0].length : 128;
    const s = this.s, acc = this.acc, b0 = this.b0, a1 = this.a1, a2 = this.a2, g = this.g;
    const aS = 1 - Math.exp(-1 / (0.1 * sampleRate));
    for (let i = 0; i < len; i++) {
      for (let e = 0; e < 2; e++) {
        const x = (e ? R : L) ? (e ? R : L)[i] : 0;
        this.slow[e] += aS * (Math.abs(x) - this.slow[e]);
        for (let k = 0; k < NB; k++) {
          const o = 4 * (e * NB + k);
          const y = b0[k] * x - b0[k] * s[o + 1] - a1[k] * s[o + 2] - a2[k] * s[o + 3];
          s[o + 1] = s[o]; s[o] = x; s[o + 3] = s[o + 2]; s[o + 2] = y;
          const v = y * g[k], base = e * 2 * NB;
          if (v > 0) acc[base + k] += v; else acc[base + NB + k] -= v;
        }
      }
      if (++this.n >= this.frame) {
        const f = new Float32Array(acc.length);
        for (let j = 0; j < 4 * NB; j++) f[j] = acc[j] / this.n;
        f[4 * NB] = this.slow[0]; f[4 * NB + 1] = this.slow[1];
        if (this.out) this.out.postMessage(f, [f.buffer]);
        acc.fill(0); this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('ear', Ear);
