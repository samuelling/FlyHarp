// Courtship mode: play a male fly's courtship song by hand and let the Tonnectome listen.
//
// The song module is shared with FrogFood and Opulation (js/courtship/song.js, songadapter.js):
//   tap the pulse pad (or J) at a steady tempo: each tap sets the wing's pulse generator, which sings ten
//   times faster than you tap (tap every 350 ms -> 35 ms between pulses, the D. melanogaster IPI);
//   hold the hum pad (or K) for sine song.
// The pulses (true pitch: 270 Hz carrier, 2.5 ms Gaussian, as Opulation's renderTrue) and the 155 Hz hum are
// played into FlyHarp's instrument bus, so they are both heard and fed to the antennae, exactly like the
// instrument's own sound (Sound.attachEar). Read-outs:
//   song      IPI, regularity (cv), sine share, and how much it sounds like a conspecific (schematic preference:
//             Gaussian around 35 ms, as FrogFood's js/core/npc.js songQuality)
//   her ears  mean rate of the 32 AVLP/PVLP/WED neurons of this FlyWire network that respond most to pulse
//             song (indices from Opulation's tools/make-model.mjs), and the four vpoEN cells
//   her mood  a schematic receptivity that rises with song-pathway drive x song quality, as in FrogFood.
// Nothing here changes the instrument or the Tonnectome; it only adds a sound source and reads the rates.
import { SongAdapter } from './songadapter.js';
import { renderTrue } from './song.js';

const READOUT = [2409, 2423, 2491, 2563, 2903, 2950, 3009, 3031, 3034, 3035, 3085, 3093, 3142, 3225, 3274, 3468, 3488, 3556, 3575, 3604, 3643, 3673, 3692, 3756, 3833, 3928, 3958, 3972, 4025, 4032, 4059, 4140];
const VPOEN = [2676, 3250, 3317, 3325];
const SONG_M = { song: { tick: 0.00025, pulseHz: 270, sineHz: 155, pulseAmp: 0.3, sineAmp: 0.12, pulseSigma: 0.0025 } };
const PREF = { ipi: 0.035, ipiSd: 0.0075, cvSlack: 0.06, cvScale: 0.12, rise: 0.085, fall: 0.03, drive: 0.05 };

function songQuality(f) {   // as FrogFood js/core/npc.js
  if (!f) return { q: 0 };
  const ipi = f.nIPI >= 3 ? Math.exp(-0.5 * ((f.ipiMean - PREF.ipi) / PREF.ipiSd) ** 2) : 0;
  const reg = f.nIPI >= 3 ? Math.exp(-Math.max(0, f.ipiCV - PREF.cvSlack) / PREF.cvScale) : 0;
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const mix = ss(0.03, 0.25, f.sineFrac) * ss(0.05, 0.25, f.pulseFrac);
  return { q: ipi * reg * (1 + 0.35 * mix) + 0.15 * ss(0.05, 0.4, f.sineFrac) * (f.nIPI < 3 ? 1 : 0), ipi, reg };
}

const $ = id => document.getElementById(id);
const S = { adapter: new SongAdapter(11), R: 0.08, open: false, pulseBuf: null, hum: null, last: 0, drive: 0, vpo: 0, ipis: [] };

function panel() {
  const p = document.createElement('div'); p.id = 'courtPanel'; p.className = 'courtPanel hidden';
  p.innerHTML = `
    <div class="cpHead"><b>Courtship</b> <span class="hint">sing to the Tonnectome</span><button class="cpX" id="cpX" aria-label="Close">×</button></div>
    <div class="cpPads"><button id="cpPulse" class="cpPad">♪ pulse<small>tap a steady tempo · J</small></button><button id="cpHum" class="cpPad hum">~ hum<small>hold · K</small></button></div>
    <canvas id="cpTrace" width="320" height="44"></canvas>
    <div class="cpRow"><span>your song</span><b id="cpIpi">— ms</b><span id="cpCv" class="hint"></span><span id="cpSine" class="hint"></span></div>
    <div class="cpRow"><span>sounds like a male</span><i class="cpBar"><i id="cpQ"></i></i></div>
    <div class="cpRow"><span>her song pathway</span><i class="cpBar"><i id="cpDrive" class="ear"></i></i><span class="hint" id="cpDriveV"></span></div>
    <div class="cpRow"><span>vpoEN</span><i class="cpBar"><i id="cpVpo" class="ear"></i></i></div>
    <div class="cpRow"><span>her receptivity</span><i class="cpBar"><i id="cpR" class="r"></i></i><span id="cpMood" class="hint"></span></div>
    <p class="hint" id="cpNote">Press ▶ Start first: the antennae listen to everything the instrument plays, your song included. Tap about every 350 ms (≈170 a minute) for 35 ms between pulses; mix in some hum.</p>
    <p class="hint small">Her ears and song pathway: this FlyWire auditory network (real wiring). Her song preference and receptivity: schematic, after pC1/vpoEN tuning (Deutsch et al. 2019; Wang et al. 2021), as in FrogFood.</p>`;
  document.body.appendChild(p);
  return p;
}

function audio() { return typeof Sound !== 'undefined' && Sound.context ? Sound.context() : null; }
function bus() { return typeof Sound !== 'undefined' && Sound.bus ? Sound.bus() : null; }
function ensureBuf(ctx) {
  if (S.pulseBuf && S.pulseBuf.sampleRate === ctx.sampleRate) return S.pulseBuf;
  // one true-pitch pulse, from the shared song module's renderTrue (centred 12 ms in)
  const x = renderTrue({ pulses: [{ t: 48 }], hums: [], end: 48 }, SONG_M, ctx.sampleRate);
  const n = Math.round(0.024 * ctx.sampleRate), b = ctx.createBuffer(1, n, ctx.sampleRate); b.getChannelData(0).set(x.subarray(0, n));
  return S.pulseBuf = b;
}
function playPulse(p) {
  const ctx = audio(), out = bus(); if (!ctx || !out) return;
  const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = ensureBuf(ctx); g.gain.value = 1.6 * p.amp;
  s.connect(g); g.connect(out); s.start(Math.max(ctx.currentTime, p.t - 0.012));
}
function humOn() {
  const ctx = audio(), out = bus(); if (!ctx || !out) return;
  const t = ctx.currentTime; S.adapter.humOn(t);
  const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = SONG_M.song.sineHz;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(SONG_M.song.sineAmp * 1.6, t + 0.012); o.connect(g); g.connect(out); o.start(t); S.hum = { o, g };
}
function humOff() {
  const ctx = audio(); if (!ctx || !S.hum) return; const t = ctx.currentTime; S.adapter.humOff(t);
  S.hum.g.gain.cancelScheduledValues(t); S.hum.g.gain.setValueAtTime(S.hum.g.gain.value, t); S.hum.g.gain.linearRampToValueAtTime(0, t + 0.015); S.hum.o.stop(t + 0.03); S.hum = null;
}
function tap() { const ctx = audio(); if (!ctx) { $('cpNote').textContent = 'Press ▶ Start first: the song needs the instrument\'s sound to be running.'; return; } S.adapter.tap(ctx.currentTime); }

function tick() {
  requestAnimationFrame(tick);
  if (!S.open) return;
  const ctx = audio(); const now = ctx ? ctx.currentTime : performance.now() / 1000;
  const dt = Math.min(0.1, now - (S.last || now)); S.last = now;
  for (const p of S.adapter.commit(now)) { playPulse(p); }
  const f = S.adapter.features(now), Q = songQuality(f);
  // her ears: the Tonnectome's current rates
  const r = typeof Tonnectome !== 'undefined' ? Tonnectome.rates : null;   // a classic-script global, not on window
  if (r) { let d = 0; for (const i of READOUT) d += r[i] || 0; d /= READOUT.length; let v = 0; for (const i of VPOEN) v += r[i] || 0; v /= VPOEN.length; S.drive += (d - S.drive) * 0.3; S.vpo += (v - S.vpo) * 0.3; }
  const H = Math.min(1.4, S.drive / PREF.drive);
  if (f.singing || f.sinceSong < 1) S.R += dt * PREF.rise * H * (Q.q - 0.3); else S.R -= dt * PREF.fall;
  S.R = Math.max(0, Math.min(1, S.R));
  // read-outs
  $('cpIpi').textContent = f.recentIPI ? (f.recentIPI * 1000).toFixed(1) + ' ms' : '— ms';
  $('cpCv').textContent = f.nIPI > 2 ? 'cv ' + f.ipiCV.toFixed(2) : ''; $('cpSine').textContent = f.sineFrac > 0.01 ? 'sine ' + Math.round(f.sineFrac * 100) + '%' : '';
  $('cpQ').style.width = Math.min(100, Q.q / 1.35 * 100) + '%';
  $('cpDrive').style.width = Math.min(100, H / 1.4 * 100) + '%'; $('cpDriveV').textContent = r ? S.drive.toFixed(3) : 'ears off';
  $('cpVpo').style.width = Math.min(100, S.vpo / 0.05 * 100) + '%';
  $('cpR').style.width = (S.R * 100) + '%';
  $('cpMood').textContent = S.R > 0.85 ? 'vaginal plate opens' : S.R > 0.5 ? 'slowing down' : f.singing ? 'listening' : '';
  // IPI trace: the last few seconds of pulses
  const c = $('cpTrace'), g = c.getContext('2d'), W = c.width, Hh = c.height; g.clearRect(0, 0, W, Hh);
  g.strokeStyle = 'rgba(255,210,63,.35)'; g.beginPath(); const y35 = Hh - (35 - 15) / 60 * Hh; g.moveTo(0, y35); g.lineTo(W, y35); g.stroke();
  const ps = S.adapter.pulses, t0 = now - 4; g.fillStyle = '#FF68BA';
  for (let i = 1; i < ps.length; i++) { const p = ps[i]; if (p.t < t0 || p.t > now) continue; const d = (p.t - ps[i - 1].t) * 1000; if (d > 100) continue; const x = (p.t - t0) / 4 * W, y = Hh - (Math.min(75, d) - 15) / 60 * Hh; g.fillRect(x - 1, y - 1, 2.5, 2.5); }
  for (const h of S.adapter.hums) { const a = Math.max(h.t0, t0), b = Math.min(h.t1, now); if (b > a) { g.fillStyle = 'rgba(125,176,255,.45)'; g.fillRect((a - t0) / 4 * W, Hh - 5, (b - a) / 4 * W, 4); } }
}

function init() {
  const p = panel();
  const btn = document.createElement('button'); btn.id = 'courtBtn'; btn.className = 'whatBtn courtBtn'; btn.textContent = '♥ Courtship';
  const what = $('whatBtn'); if (what && what.parentNode) what.parentNode.insertBefore(btn, what.nextSibling); else document.body.appendChild(btn);
  const show = v => { S.open = v; p.classList.toggle('hidden', !v); btn.classList.toggle('on', v); if (!v) humOff(); };
  btn.addEventListener('click', () => show(!S.open)); $('cpX').addEventListener('click', () => show(false));
  const pulse = $('cpPulse'), hum = $('cpHum');
  pulse.addEventListener('pointerdown', e => { e.preventDefault(); tap(); pulse.classList.add('down'); });
  pulse.addEventListener('pointerup', () => pulse.classList.remove('down')); pulse.addEventListener('pointerleave', () => pulse.classList.remove('down'));
  hum.addEventListener('pointerdown', e => { e.preventDefault(); humOn(); hum.classList.add('down'); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) hum.addEventListener(ev, () => { humOff(); hum.classList.remove('down'); });
  addEventListener('keydown', e => {
    if (!S.open || e.repeat || e.target.closest('input, select, textarea')) return;
    if (e.code === 'KeyJ') { tap(); pulse.classList.add('down'); } if (e.code === 'KeyK' && !S.hum) { humOn(); hum.classList.add('down'); }
  });
  addEventListener('keyup', e => { if (e.code === 'KeyJ') pulse.classList.remove('down'); if (e.code === 'KeyK') { humOff(); hum.classList.remove('down'); } });
  requestAnimationFrame(tick);
}
init();
window.FH_courtship = S;
