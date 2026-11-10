"""Render each voice engine offline in headless Chrome and report peak/RMS (checks nothing is silent or clipping)."""
import sys, asyncio, subprocess, time
from playwright.async_api import async_playwright
JS = """async () => {
  const out = {};
  const P = {pluck: {decay: 0.995, bright: 0.6}, modal: {ratios: [1, 4.1, 10], decays: [0.6, 0.1, 0.03], amps: [1, .35, .12], attack: .002},
    glass: {ratios: [1, 1.0035, 2.38, 4.4], decays: [2.5, 2.5, .7, .35], amps: [.6, .45, .22, .1], attack: .004},
    fm: {ratio: 1.4142, index: 2.5, idecay: .2, decay: 1}, pad: {detune: .005, cutoff: 3, attack: .15, release: .8}, click: {q: 40, decay: .2, gain: .1}};
  for (const [k, v] of Object.entries(P)) P[k + '-hyp'] = Object.assign({}, v, {rev: 0.3}, v.decay !== undefined && k !== 'pluck' ? {decay: v.decay + 0.3} : {}, v.decays ? {decays: v.decays.map(d => d + 0.3)} : {});
  for (const [eng0, p] of Object.entries(P)) { const eng = eng0.replace('-hyp', '');
    const ctx = new OfflineAudioContext(2, 44100 * 2, 44100);
    await ctx.audioWorklet.addModule('js/voices-worklet.js');
    const notes = [220, 330, 440].map(f => ({engine: eng, freq: f, vel: 0.9, pan: 0, dur: 0.4, p}));
    const n = new AudioWorkletNode(ctx, 'voices', {outputChannelCount: [2], processorOptions: {notes}}); n.connect(ctx.destination);
    const buf = await ctx.startRendering(), d = buf.getChannelData(0);
    let pk = 0, ss = 0; for (const x of d) { pk = Math.max(pk, Math.abs(x)); ss += x * x; }
    out[eng0] = [pk.toFixed(3), Math.sqrt(ss / d.length).toFixed(4)];
  }
  return out;
}"""
async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8778'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
            pg = await b.new_page(); await pg.goto('http://localhost:8778/index.html')
            print('engine: [peak, rms]', await pg.evaluate(JS)); await b.close()
    finally:
        srv.terminate()
asyncio.run(main())
