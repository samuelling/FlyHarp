// In-silico physiology on a private copy of the network: contrast response, size tuning at a low and a high
// contrast, and response vs mean luminance, for the central cell of one type. Stimulus: a drifting grating
// (period 6 columns, 2 Hz) inside a disk, grey around it; for T4/T5 it moves in that subtype's preferred direction.
// Response = mean |V - V_before| over the last 0.8 s of 1.6 s, where V_before is the cell's value after 0.6 s of
// the uniform screen at the test luminance (so a pure change of mean light doesn't count as a response).
(function (root) {
  const CONTRASTS = [0.03, 0.06, 0.12, 0.25, 0.5, 1];
  const RADII = [0.5, 1.5, 2.5, 3.5, 5, 7, 10];
  const SIZE_C = [0.12, 0.8];
  const MEANS = [0.06, 0.15, 0.5, 1.5];

  function conditions() {
    const c = [];
    for (const k of CONTRASTS) c.push({set: 'crf', x: k, c: k, r: 10, mean: 0.5});
    for (const sc of SIZE_C) for (const r of RADII) c.push({set: 'size' + sc, x: r, c: sc, r, mean: 0.5});
    for (const m of MEANS) c.push({set: 'lum', x: m, c: 0.4, r: 10, mean: m});
    return c;
  }

  // eng: FlyEngine settled at grey (V0/D0 recorded); gc: GainControl with the settings to test
  function measure(eng, gc, type, cond, theta) {
    const nC = eng.nC, x = eng.x, y = eng.y, dt = eng.dt, cell = eng.central[eng.types.indexOf(type)];
    eng.V.set(eng.V0); gc.reset(cond.mean);
    const lum = new Float32Array(nC), ct = Math.cos(theta), st = Math.sin(theta);
    lum.fill(cond.mean);
    for (let s = 0; s < 30; s++) eng.step(gc.process(lum));
    let before = 0; for (let s = 0; s < 5; s++) { eng.step(gc.process(lum)); before += eng.V[cell] / 5; }
    const n = 80; let acc = 0;
    for (let s = 0; s < n; s++) {
      for (let k = 0; k < nC; k++) {
        const g = Math.sin(2 * Math.PI * ((x[k] * ct + y[k] * st) / 6 - 2 * s * dt));
        lum[k] = Math.hypot(x[k], y[k]) <= cond.r ? cond.mean * (1 + cond.c * g) : cond.mean;
      }
      eng.step(gc.process(lum));
      if (s >= n / 2) acc += Math.abs(eng.V[cell] - before);
    }
    return acc / (n / 2);
  }

  function run(eng, gc, type, theta, onProgress) {
    const cs = conditions(), out = {};
    cs.forEach((c, i) => {
      (out[c.set] = out[c.set] || []).push([c.x, measure(eng, gc, type, c, theta)]);
      if (onProgress) onProgress((i + 1) / cs.length);
    });
    return out;
  }
  const api = {run, conditions, CONTRASTS, RADII, SIZE_C, MEANS};
  if (typeof module !== 'undefined') module.exports = api; else root.FlyProbe = api;
})(this);
