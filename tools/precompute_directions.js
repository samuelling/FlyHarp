// Measure each T4/T5 subtype's preferred direction on the hex eye (moving ON/OFF edges, 12 directions)
// and store it in data/fly.json, so the browser doesn't have to at start-up.
const fs = require('fs'), vm = require('vm');
const FlyEngine = require('../js/engine.js');
const path = __dirname + '/../data/fly.json';
const model = JSON.parse(fs.readFileSync(path)); delete model.pref_dir;
const src = fs.readFileSync(__dirname + '/../js/worker.js', 'utf8');
const ctx = {FlyEngine, importScripts() {}, fetch: async () => ({json: async () => model}), Math, Float32Array, Int32Array, Uint8Array, Array, Object, Set, Map, console,
  self: {postMessage(m) { if (m.cmd !== 'ready') return; model.pref_dir = m.prefDir; fs.writeFileSync(path, JSON.stringify(model));
    console.log(Object.fromEntries(Object.entries(m.prefDir).map(([k, v]) => [k, Math.round(v * 180 / Math.PI)]))); }}};
vm.createContext(ctx); vm.runInContext(src, ctx);
ctx.self.onmessage({data: {cmd: 'init', url: ''}});
