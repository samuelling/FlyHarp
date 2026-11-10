// Polyphonic Karplus–Strong harp voices (AudioWorklet). Message: {freq, vel, pan, decay, bright}
class HarpProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = [];
    this.max = 40;
    this.port.onmessage = (e) => this.pluck(e.data);
  }
  pluck({freq, vel = 0.7, pan = 0, decay = 0.996, bright = 0.6}) {
    const n = Math.max(2, Math.round(sampleRate / freq));
    const buf = new Float32Array(n);
    // excitation: noise smoothed by (1 - bright); softer plucks are darker
    let prev = 0;
    const lp = 1 - Math.min(0.95, Math.max(0.05, bright));
    for (let i = 0; i < n; i++) { const x = Math.random() * 2 - 1; prev = prev * lp + x * (1 - lp); buf[i] = prev * vel; }
    const a = (pan + 1) * Math.PI / 4;
    if (this.voices.length >= this.max) this.voices.shift();
    this.voices.push({buf, i: 0, n, decay, gl: Math.cos(a), gr: Math.sin(a), life: sampleRate * 8, energy: 1});
  }
  process(_, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], len = L.length;
    for (let k = 0; k < len; k++) { L[k] = 0; if (R !== L) R[k] = 0; }
    const alive = [];
    for (const v of this.voices) {
      const {buf, n, decay} = v;
      let i = v.i, e = 0;
      for (let k = 0; k < len; k++) {
        const j = i + 1 === n ? 0 : i + 1;
        const y = buf[i];
        buf[i] = decay * 0.5 * (y + buf[j]);
        L[k] += y * v.gl; if (R !== L) R[k] += y * v.gr;
        e += y * y;
        i = j;
      }
      v.i = i; v.life -= len;
      if (v.life > 0 && e / len > 1e-9) alive.push(v);
    }
    this.voices = alive;
    for (let k = 0; k < len; k++) { L[k] = Math.tanh(L[k] * 0.6); if (R !== L) R[k] = Math.tanh(R[k] * 0.6); }
    return true;
  }
}
registerProcessor('harp', HarpProcessor);
