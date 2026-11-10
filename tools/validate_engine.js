// Compare the JS engine against the PyTorch flyvis reference trace (central cell of every type).
const fs = require('fs');
const FlyEngine = require('../js/engine.js');
const model = JSON.parse(fs.readFileSync(__dirname + '/../data/fly.json'));
const ref = JSON.parse(fs.readFileSync(__dirname + '/reference_trace.json'));
let t0 = Date.now();
const eng = new FlyEngine(model);
console.log('built', eng.N, 'neurons', eng.nE, 'synapses in', Date.now() - t0, 'ms');
eng.settle(0.5, 4);
const types = model.types;
let initErr = 0;
types.forEach((t, i) => initErr = Math.max(initErr, Math.abs(eng.V[eng.central[i]] - ref.init_central[t])));
console.log('max |init diff| over types', initErr.toFixed(4));
const out = types.map(() => []);
t0 = Date.now();
for (const frame of ref.stim) { eng.step(Float32Array.from(frame)); types.forEach((t, i) => out[i].push(eng.V[eng.central[i]])); }
const ms = (Date.now() - t0) / ref.stim.length;
let worst = 0, worstT = '', cors = [];
types.forEach((t, i) => {
  const a = out[i], b = ref.central[t];
  const ma = a.reduce((x, y) => x + y) / a.length, mb = b.reduce((x, y) => x + y) / b.length;
  let sab = 0, saa = 0, sbb = 0, md = 0;
  for (let k = 0; k < a.length; k++) { sab += (a[k] - ma) * (b[k] - mb); saa += (a[k] - ma) ** 2; sbb += (b[k] - mb) ** 2; md = Math.max(md, Math.abs(a[k] - b[k])); }
  const r = sab / Math.sqrt(saa * sbb + 1e-12); cors.push(r);
  if (md > worst) { worst = md; worstT = t; }
});
cors.sort((x, y) => x - y);
console.log(`ms/step ${ms.toFixed(2)}; min corr ${cors[0].toFixed(4)}, median ${cors[cors.length >> 1].toFixed(4)}; worst max|diff| ${worst.toFixed(4)} (${worstT})`);
