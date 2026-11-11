// FlyHarp main thread: stimulus → worker (fly network) → string detectors → notes; plus drawing.
(() => {
  const $ = id => document.getElementById(id);
  const DT = 0.02;
  const GROUP_NAMES = ['retina', 'lamina', 'medulla', 'medulla → lobula', 'lobula plate (T4/T5)'];
  const GROUP_SUB = ['R1–R8', 'L, Lawf, Am, C2/C3, T1', 'Mi, CT1 (medulla)', 'Tm, TmY, T2, T3', 'T4, T5, CT1 (lobula)'];
  const ENGINES = {pad: 'bowed pad', modal: 'marimba', pluck: 'harp', fm: 'FM bell', glass: 'glass', click: 'pitched click'};
  const DEFAULT_ENGINE = ['pad', 'modal', 'pluck', 'fm', 'click'];
  const area = [0, 1, 2, 3, 4].map(g => ({engine: DEFAULT_ENGINE[g], level: 0.8, mute: false, solo: false, pol: 'both'}));
  let selected = new Set(), tauRank = {};
  const fbR = new Float32Array(7);   // smoothed feedback per eye region, in units of its calibrated range (signed)
  let fbInfo = null;
  const GROUP_COL = ['#8f7fd6', '#4fb3a4', '#e0c35a', '#e88a4f', '#e2576b'];
  const DECAY = [0.9988, 0.9982, 0.9975, 0.9966, 0.9955], DUR = [1.2, 0.8, 0.5, 0.35, 0.25];
  const SCALES = {majpent: [0, 2, 4, 7, 9], minpent: [0, 3, 5, 7, 10], dorian: [0, 2, 3, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
    hirajoshi: [0, 2, 3, 7, 8], whole: [0, 2, 4, 6, 8, 10], chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]};
  const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const PRESETS = {
    cascade: ['R1', 'R7', 'R8', 'L1', 'L2', 'L3', 'L4', 'L5', 'Mi1', 'Mi4', 'Mi9', 'Tm3', 'Tm1', 'Tm2', 'Tm4', 'Tm9', 'T4a', 'T4b', 'T4c', 'T4d', 'T5a', 'T5b', 'T5c', 'T5d'],
    motion: ['T4a', 'T4b', 'T4c', 'T4d', 'T5a', 'T5b', 'T5c', 'T5d'],
    early: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'L1', 'L2', 'L3', 'L4', 'L5', 'Am', 'C2', 'C3', 'Lawf1', 'Lawf2', 'T1'],
  };
  const groupOf = t => /^R\d/.test(t) ? 0 : /^(L\d|Lawf|Am|C2|C3|T1)$/.test(t) || /^Lawf/.test(t) ? 1 : /^(Mi|CT1\(M10\))/.test(t) ? 2 :
    /^(T4|T5|CT1\(Lo1\))/.test(t) ? 4 : 3;

  const P = {kind: 'webcam', contrast: 0.8, size: 8, speed: 1, direction: 0, polarity: -1};
  let types = [], X = [], Y = [], nodeOf = [], region = [], NR = 7, scale = [];
  let strings = [], det = null;
  let simT = 0, acc = 0, lastNow = performance.now(), busy = false, ready = false, playing = false;
  let lastLum = new Float32Array(721).fill(0.5), lastPR = null, lastDV = null, rings = [], tokens = 24;
  const V = window.FH_V ? '?v=' + window.FH_V : '';   // cache-busting stamp (tools/stamp.py)
  const worker = new Worker('js/worker.js' + V);
  // eye geometry (js/eyegeom.js): the idealized lattice, or the measured eye (Zhao et al. 2025)
  let G = null, eyemap = null;
  const eyemapP = fetch('data/eyemap.json' + V).then(r => r.json()).then(j => eyemap = j).catch(() => null);
  function setGeometry(mode) {
    G = EyeGeom.build(mode === 'real' && eyemap ? 'real' : 'lattice', X, Y, u, v, eyemap);
    edge = X.map((_, i) => Math.max(Math.abs(u[i]), Math.abs(v[i]), Math.abs(u[i] + v[i])) >= 14 || !G.real[i]);
    Stimuli.init(G.DX, G.DY); fineX = null; lensMax = {};
  }

  // ---------------------------------------------------------------- controls
  for (const id of ['contrast', 'size', 'speed', 'direction']) bindRange(id, v => P[id] = v);
  bindRange('tempo', () => {}); bindRange('thresh', () => {}); bindRange('rate', () => {}); bindRange('spread', buildStrings);
  bindRange('fbDepth', () => {});
  bindRange('light', v => P.light = 2 ** v);
  // gain control (js/gain.js): settings go to the simulation worker, and to the probe when it runs
  const gainParams = () => ({adapt: $('gAdapt').checked, tauA: +$('gTauA').value, k: +$('gK').value, norm: $('gNorm').checked,
    target: $('gTarget').value, poolR: +$('gPool').value, c50: +$('gC50').value, tauN: +$('gTauN').value / 1000});
  const sendGain = () => {
    const p = gainParams(); P.rawCam = p.adapt;
    $('gAdaptBox').classList.toggle('off', !p.adapt); $('gNormBox').classList.toggle('off', !p.norm);
    worker.postMessage({cmd: 'gain', p});
  };
  for (const id of ['gTauA', 'gK', 'gPool', 'gC50', 'gTauN']) bindRange(id, () => ready && sendGain());
  for (const id of ['gAdapt', 'gNorm', 'gTarget']) $(id).onchange = sendGain;
  bindRange('vol', v => Sound.setVolume(v)); bindRange('rev', v => Sound.setReverb(v));
  function bindRange(id, fn) {
    const el = $(id), o = el.parentElement.querySelector('output');
    const fmt = v => id === 'direction' ? v + '°' : id === 'tempo' ? v.toFixed(2) + '×' : id === 'light' ? '×' + +(2 ** v).toPrecision(2) : id === 'gTauA' ? v.toFixed(1) + ' s' : v;
    const upd = () => { const v = +el.value; if (o) o.textContent = fmt(v); fn(v); };
    el.addEventListener('input', upd); upd();
  }
  $('kind').onchange = async () => {
    P.kind = $('kind').value;
    $('eyehint').textContent = P.kind === 'paint' ? 'Drag on the eye to draw; polarity sets dark or bright.' : 'Tip: drag on the eye to draw on it.';
    if (P.kind === 'webcam') await useCamera();
  };
  // the webcam is the default eye; if the camera is refused or missing, fall back to a drifting grating
  async function useCamera() {
    const ok = await Stimuli.startCamera();
    if (!ok) { P.kind = 'grating'; $('kind').value = 'grating'; status('camera unavailable (permission or browser), showing a drifting grating instead'); }
    return ok;
  }
  document.querySelectorAll('.seg button').forEach(b => b.onclick = () => {
    document.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b)); P.polarity = +b.dataset.pol;
  });
  $('root').innerHTML = NOTE_NAMES.map((n, i) => `<option value="${i}" ${i === 2 ? 'selected' : ''}>${n}</option>`).join('');
  ['scale', 'root'].forEach(k => $(k).onchange = buildStrings);
  document.querySelectorAll('.presets button').forEach(b => b.onclick = () => applyPreset(b.dataset.pre));
  function applyPreset(pre) {
    selected = new Set(pre === 'all' ? types : pre === 'none' ? [] : PRESETS[pre].filter(t => types.includes(t)));
    buildStrings(); renderHier();
  }
  function toggleType(t) { selected.has(t) ? selected.delete(t) : selected.add(t); buildStrings(); renderHier(); }

  // hierarchy mixer: one panel per area, with solo / mute / timbre / level and a chip per cell type
  function renderHier() {
    const anySolo = area.some(a => a.solo);
    $('hier').innerHTML = area.map((a, g) => {
      const ts = types.filter(t => groupOf(t) === g);
      return `<div class="area ${a.mute || (anySolo && !a.solo) ? 'muted' : ''}" data-g="${g}">
        <div class="head"><span class="dot" style="background:${GROUP_COL[g]}"></span><span class="nm">${GROUP_NAMES[g]}</span>
          <span class="pol">${[['dep', '+', 'depolarisation only'], ['both', '±', 'depolarisation and hyperpolarisation'], ['hyp', '−', 'hyperpolarisation only']].map(([k, l, ttl]) => `<button class="sm pl ${a.pol === k ? 'on' : ''}" data-pol="${k}" title="${ttl}">${l}</button>`).join('')}</span>
          <button class="sm solo ${a.solo ? 'on' : ''}" title="solo">S</button><button class="sm mute ${a.mute ? 'on' : ''}" title="mute">M</button></div>
        <div class="row2"><select class="eng">${Object.entries(ENGINES).map(([k, n]) => `<option value="${k}" ${k === a.engine ? 'selected' : ''}>${n}</option>`).join('')}</select>
          <input type="range" class="lvl" min="0" max="1" step="0.05" value="${a.level}" title="level"></div>
        <div class="chips">${ts.map(t => `<button class="chip ${selected.has(t) ? 'on' : ''}" data-t="${t}" style="${selected.has(t) ? `background:${GROUP_COL[g]};border-color:${GROUP_COL[g]}` : ''}" title="${t} · τ = ${(1000 * tauOf(t)).toFixed(0)} ms">${t}</button>`).join('')}</div></div>`;
    }).join('');
    $('hier').querySelectorAll('.area').forEach(el => {
      const g = +el.dataset.g, a = area[g];
      el.querySelector('.solo').onclick = () => { a.solo = !a.solo; renderHier(); };
      el.querySelector('.mute').onclick = () => { a.mute = !a.mute; renderHier(); };
      el.querySelector('.eng').onchange = e => { a.engine = e.target.value; buildStrings(); };
      el.querySelectorAll('.pl').forEach(b => b.onclick = () => { a.pol = b.dataset.pol; buildStrings(); renderHier(); });
      el.querySelector('.lvl').oninput = e => { a.level = +e.target.value; };
      el.querySelectorAll('.chip').forEach(c => {
        c.onclick = () => toggleType(c.dataset.t);
        c.onmousemove = e => showTip(cellCard(c.dataset.t), e.clientX, e.clientY); c.onmouseleave = hideTip;
        c.removeAttribute('title');
      });
      const nm = el.querySelector('.nm');
      nm.onmousemove = e => showTip(areaCard(g), e.clientX, e.clientY); nm.onmouseleave = hideTip;
    });
  }
  const tauOf = t => tauList[types.indexOf(t)] || 0.05;
  let tauList = [];
  const audible = g => !area[g].mute && (!area.some(a => a.solo) || area[g].solo);

  // hover cards: putative roles of areas and cell types (js/info.js), plus live facts
  const tip = $('tip');
  const plucks = {};
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.classList.add('on');
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(window.innerWidth - w - 10, x + 14) + 'px';
    tip.style.top = Math.min(window.innerHeight - h - 10, y + 14) + 'px';
  }
  const hideTip = () => tip.classList.remove('on');
  function areaCard(g) {
    const A = FlyInfo.areas[g], a = area[g];
    const n = types.filter(t => groupOf(t) === g), on = n.filter(t => selected.has(t)).length;
    return `<h4 style="color:${GROUP_COL[g]}">${A.name}</h4><div class="k">${A.sub}</div>${A.text}
      <div class="meta">${n.length} cell types · ${on} strung · sounds as ${ENGINES[a.engine]}${a.mute ? ' · muted' : ''}${a.solo ? ' · solo' : ''}</div>`;
  }
  function cellCard(t) {
    const g = groupOf(t), st = strings.filter(x => x.name === t);
    const notes = st.map(x => `${x.pol > 0 ? 'depol' : 'hyperpol'} ${NOTE_NAMES[x.midi % 12]}${Math.floor(x.midi / 12) - 1}`).join(', ');
    return `<h4 style="color:${GROUP_COL[g]}">${t}</h4><div class="k">${FlyInfo.areas[g].name}</div>${FlyInfo.cells[t] || 'Cell type in the model.'}
      <div class="meta">τ = ${(1000 * tauOf(t)).toFixed(0)} ms${st.length ? ` · strung: ${notes} · plucked ${plucks[t] || 0}×` : ' · not strung (click to add)'}</div>`;
  }

  // per-cell-type timbre: the area sets the instrument family; the cell's membrane time constant
  // sets the envelope (fast cells percussive, slow cells sustained); a hash of its name varies the colour
  function hash(str, k) { let h = 2166136261 ^ k; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000; }
  function timbre(name, g, idx) {
    const eng = area[g].engine, tr = tauRank[name] ?? 0.5, h1 = hash(name, 1), h2 = hash(name, 2);
    switch (eng) {
      case 'pluck': return {engine: eng, p: {decay: 0.990 + 0.0092 * tr, bright: 0.3 + 0.55 * h1}};
      case 'modal': return {engine: eng, p: {ratios: [1, 3.9 + 0.5 * h1, 9.2 + 2.5 * h2], decays: [0.2 + 1.1 * tr, 0.07 + 0.1 * tr, 0.03], amps: [1, 0.35, 0.12], attack: 0.002}};
      case 'glass': return {engine: eng, p: {ratios: [1, 1.0035, 2.32 + 0.12 * h1, 4.25 + 0.25 * h2], decays: [1.2 + 3 * tr, 1.2 + 3 * tr, 0.7, 0.35], amps: [0.6, 0.45, 0.22, 0.1], attack: 0.004}};
      case 'fm': return {engine: eng, p: {ratio: [1, 1.4142, 2, 2.7183, 3.5, 0.5, 1.5, 4][idx % 8], index: 1.2 + 3 * h1, idecay: 0.04 + 0.4 * tr, decay: 0.25 + 1.6 * tr}};
      case 'pad': return {engine: eng, p: {detune: 0.002 + 0.006 * h1, cutoff: 1.5 + 4 * h2, attack: 0.02 + 0.35 * tr, release: 0.25 + 1.4 * tr}};
      case 'click': return {engine: eng, p: {q: 12 + 70 * h1, decay: 0.04 + 0.35 * tr, gain: 0.07 + 0.05 * h2}};
    }
  }
  $('spatial').onchange = buildStrings;
  $('reset').onclick = () => worker.postMessage({cmd: 'reset'});
  $('midiOut').onchange = () => Sound.setOutput($('midiOut').value);
  $('go').onclick = async () => {
    if (!playing) {
      await Sound.start(); Sound.setVolume(+$('vol').value); Sound.setReverb(+$('rev').value); Tonnectome.onAudioStart();
      if (P.kind === 'webcam') await useCamera();
      playing = true; $('go').textContent = '❚❚ Pause sound'; $('go').classList.add('playing');
      const outs = await Sound.initMIDI();
      $('midiOut').innerHTML = '<option value="">none</option>' + outs.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
    } else { playing = false; Sound.allNotesOff(); $('go').textContent = '▶ Start'; $('go').classList.remove('playing'); }
  };
  const status = s => $('status').textContent = s;

  // ---------------------------------------------------------------- strings and pitches
  function buildStrings() {
    if (!ready) return;
    const names = types.filter(t => selected.has(t));
    const sc = SCALES[$('scale').value], root = 36 + +$('root').value, spread = +$('spread').value;
    const byG = [[], [], [], [], []];
    names.forEach(n => byG[groupOf(n)].push(n));
    strings = [];
    byG.forEach((list, g) => list.forEach((n, i) => {
      const deg = i % sc.length, oct = Math.floor(i / sc.length) % 2;
      const midi = root + Math.round(12 * g * spread) + 12 * oct + sc[deg], pol = area[g].pol;
      if (pol !== 'hyp') strings.push(Object.assign({name: n, t: types.indexOf(n), g, pol: 1, midi}, timbre(n, g, i)));
      if (pol !== 'dep') {
        // hyperpolarisation voice: an octave down, darker, with a reversed (swelling) envelope
        const tb = timbre(n, g, i), q = tb.p;
        q.rev = 0.12 + 0.35 * (tauRank[n] ?? 0.5);
        if ('bright' in q) q.bright *= 0.6;
        if ('index' in q) q.index *= 0.5;
        if ('cutoff' in q) q.cutoff *= 0.6;
        // let the instrument ring through the swell
        if (tb.engine === 'click' || tb.engine === 'fm') q.decay += q.rev;
        if (tb.engine === 'fm') q.idecay += q.rev;
        if (tb.engine === 'pluck') q.decay = Math.max(q.decay, 0.998);
        if (q.decays) q.decays = q.decays.map(d => d + q.rev);
        strings.push(Object.assign({name: n, t: types.indexOf(n), g, pol: -1, midi: midi - 12}, tb));
      }
    }));
    const nR = $('spatial').checked ? NR : 1;
    det = {nR, base: new Float32Array(strings.length * nR), armed: new Uint8Array(strings.length * nR).fill(1), last: new Float32Array(strings.length * nR).fill(-9)};
    const nd = strings.filter(x => x.pol > 0).length, nh = strings.length - nd;
    status(`${names.length} cell types strung · ${nd} depolarisation + ${nh} hyperpolarisation strings${nR > 1 ? ' × 7 eye regions' : ''}`);
  }

  // per-step detection: a string plucks when its activity (in units of that type's response range)
  // rises past threshold above a slow running baseline; it re-arms once it falls back.
  function detect(a, tSim, events) {
    const th = +$('thresh').value, nR = det.nR, off = 2 * types.length * NR;
    for (let r = 0; r < NR; r++) fbR[r] += (a[off + r] - fbR[r]) * DT / 0.08;
    for (let s = 0; s < strings.length; s++) {
      const st = strings[s], t = st.t, nT = types.length, off = st.pol > 0 ? 0 : nT * NR, sc = st.pol > 0 ? scale[t] : scale[nT + t];
      for (let r = 0; r < nR; r++) {
        let x;
        if (nR === 1) { x = 0; for (let q = 0; q < NR; q++) x += a[off + t * NR + q]; x /= NR; } else x = a[off + t * NR + r];
        x /= sc;
        const k = s * nR + r;
        det.base[k] += (x - det.base[k]) * DT / 1.5;
        const d = x - det.base[k];
        if (det.armed[k] && d > th && tSim - det.last[k] > 0.06) {
          det.armed[k] = 0; det.last[k] = tSim;
          const ang = r === 0 ? null : -Math.PI + (r - 0.5) * Math.PI / 3;
          const fbv = nR > 1 ? fbR[r] : fbR.reduce((x, y) => x + y, 0) / NR;
          events.push({s, r, vel: Math.min(1, 0.25 + d), pan: ang === null ? 0 : 0.8 * Math.cos(ang), lift: ang === null ? 0 : Math.sin(ang), fb: fbv});
        } else if (!det.armed[k] && d < th * 0.4) det.armed[k] = 1;
      }
    }
  }

  // the medulla's hand on the lamina's strings: f < 0 (net inhibitory feedback) damps, f > 0 brightens and adds shimmer
  function feedbackTimbre(eng, p, f) {
    const damp = f < 0 ? -f : 0, lift = f > 0 ? f : 0;
    switch (eng) {
      case 'pluck': p.bright = Math.max(0.05, Math.min(0.95, p.bright * (1 - 0.6 * damp) + 0.3 * lift)); p.decay = Math.min(0.9995, p.decay - 0.006 * damp + 0.0025 * lift); break;
      case 'modal': case 'glass':
        p.decays = p.decays.map(d => d * (1 - 0.65 * damp) * (1 + 0.5 * lift));
        p.amps = p.amps.map((a, i) => i === 0 ? a : a * (1 - 0.7 * damp) * (1 + 1.2 * lift));
        if (eng === 'glass') p.ratios[1] = 1 + 0.0035 * (1 + 4 * lift); break;
      case 'fm': p.index = Math.max(0.05, p.index * (1 - 0.8 * damp) * (1 + 1.5 * lift)); p.decay *= (1 - 0.6 * damp) * (1 + 0.4 * lift); break;
      case 'pad': p.cutoff = Math.max(0.6, p.cutoff * (1 - 0.6 * damp) * (1 + 1.2 * lift)); p.detune *= 1 + 3 * lift; p.release *= 1 - 0.5 * damp; break;
      case 'click': p.q = Math.max(4, p.q * (1 - 0.7 * damp) * (1 + 1.0 * lift)); p.decay *= (1 - 0.6 * damp) * (1 + 0.5 * lift); break;
    }
  }

  // the mast plays along: the pink riso pass slips out of register when a note fires (and now and then on its own);
  // the fly's harp wings ring, left for depolarisation, right for hyperpolarisation
  const logo = document.querySelector('.logo'), wingStrings = [...document.querySelectorAll('#logo .strings')];
  let lastJit = 0;
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function jitter() { if (reduced) return; logo.classList.remove('jit'); void logo.offsetWidth; logo.classList.add('jit'); lastJit = performance.now(); }
  logo.addEventListener('animationend', e => { if (e.target.classList.contains('mis')) logo.classList.remove('jit'); });
  (function idle() { setTimeout(() => { if (!document.hidden && performance.now() - lastJit > 3000) jitter(); idle(); }, 3500 + Math.random() * 5500); })();
  function bounce(g, hyp) {
    if (performance.now() - lastJit > 420 && Math.random() < 0.35) jitter();
    const w = wingStrings[hyp ? 1 : 0];
    if (w && !w.classList.contains('ring')) { w.classList.add('ring'); setTimeout(() => w.classList.remove('ring'), 230); }
  }

  function fire(ev) {
    const st = strings[ev.s];
    if (!st) return;
    rings.push({t: st.t, r: det.nR > 1 ? ev.r : -1, born: performance.now(), g: st.g, quiet: !audible(st.g), hyp: st.pol < 0});
    if (!audible(st.g) || area[st.g].level <= 0) return;
    const p = JSON.parse(JSON.stringify(st.p));
    if (st.engine === 'pluck') p.bright = Math.min(0.95, p.bright + 0.25 * ev.vel + 0.08 * ev.lift);
    if ($('fbOn').checked && $('fbTarget').value.includes(String(st.g))) feedbackTimbre(st.engine, p, Math.max(-1, Math.min(1, ev.fb * +$('fbDepth').value)));
    const n = {midi: st.midi, vel: ev.vel * area[st.g].level, pan: ev.pan, dur: DUR[st.g], engine: st.engine, p,
      channel: $('midiCh').value === 'layer' ? st.g + (st.pol < 0 ? 5 : 0) : (st.pol < 0 ? 1 : 0)};
    if (playing) Sound.play(n, {internal: $('internal').checked, midi: true});
    plucks[st.name] = (plucks[st.name] || 0) + 1;
    bounce(st.g, st.pol < 0);
    roll.push({midi: st.midi, g: st.g, vel: ev.vel, x: rollW, hyp: st.pol < 0}); stats.notes++; stats.byGroup[st.g]++; stats[st.pol < 0 ? 'hyp' : 'dep']++;
  }

  // ---------------------------------------------------------------- worker
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.cmd === 'ready') {
      types = m.types; X = m.x; Y = m.y; nodeOf = m.nodeOf; region = m.region; NR = m.NR; scale = m.scale;
      tauList = m.tau; fbInfo = m.fbInfo; prefDir = m.prefDir || {}; decoder = m.decoder;
      // lattice indices (from pixel coords) and neighbours, for the motion arrows
      u = m.x.map((x, i) => Math.round(-m.y[i] - Math.round(x / 0.8660254) / 2)); v = m.x.map(x => Math.round(x / 0.8660254));
      nbr = m.x.map((x, i) => m.x.map((x2, j) => j).filter(j => (m.x[j] - x) ** 2 + (m.y[j] - m.y[i]) ** 2 < 1.1));
      // the outer two rings of the eye lack part of their inputs in the model: shown, but not as signal
      edge = m.x.map((x, i) => Math.max(Math.abs(u[i]), Math.abs(v[i]), Math.abs(u[i] + v[i])) >= 14);
      setGeometry('lattice');
      renderLenses();
      if (fbInfo) $('fbHint').innerHTML = `Medulla → lamina feedback shapes the timbre. In this model ${(100 * fbInfo.fraction).toFixed(0)}% of the synaptic weight onto L1–L5 comes from medulla-resident cells (${fbInfo.sources.slice(0, 4).map(([k]) => k).join(', ')}…). Net inhibitory feedback damps notes (darker, shorter); net excitatory feedback brightens them.`;
      const order = types.map((t, i) => [m.tau[i], t]).sort((a, b) => a[0] - b[0]);
      order.forEach(([, t], r) => tauRank[t] = r / (order.length - 1));
      layoutCascade(); ready = true; Tonnectome.init({P});
      eyemapP.then(() => { if (!eyemap) $('eyeGeom').disabled = true; else if ($('eyeGeom').value === 'real') setGeometry('real'); });
      $('eyeGeom').onchange = () => { setGeometry($('eyeGeom').value); $('eyehint').textContent = G.mode === 'real' ? `The measured eye: ${eyemap.ommatidia} ommatidia, ${eyemap.median_dphi_deg.toFixed(1)}° apart on average, finest along the equator. Each facet is drawn where it looks (azimuthal-equidistant projection about the centre column); the network and its wiring are unchanged.` : ''; }; applyPreset('cascade'); sendGain(); setupProbe();
      if (P.kind === 'webcam') useCamera();
      window.FlyHarp = {types, X, Y, nodeOf, scale, groupOf, N: m.N, nE: m.nE, dv: () => lastDV,
        requestEdges: k => worker.postMessage({cmd: 'edges', k})};
      window.dispatchEvent(new Event('flyharp-ready'));
      status(`${m.N.toLocaleString()} neurons, ${(m.nE / 1e6).toFixed(2)}M synapses running · press Start for sound`);
    } else if (m.cmd === 'edges') {
      window.dispatchEvent(new CustomEvent('flyharp-edges', {detail: m}));
    } else if (m.cmd === 'frames') {
      busy = false; lastDV = m.dV; lastFbc = m.fbc; lastPR = m.pr && m.pr.length ? m.pr : null;
      const batch = pendingBatch; pendingBatch = null;
      const events = [];
      m.steps.forEach((a, k) => { const evs = []; detect(a, batch.t0 + k * DT, evs); evs.forEach(ev => { ev.delay = k * DT / batch.tempo * 1000; events.push(ev); }); });
      // rate limit (token bucket), loudest first within the batch
      events.sort((p, q) => q.vel - p.vel);
      const keep = events.slice(0, Math.max(0, Math.floor(tokens))); tokens -= keep.length;
      keep.forEach(ev => setTimeout(() => fire(ev), ev.delay));
    }
  };
  worker.postMessage({cmd: 'init', url: new URL('data/fly.json' + V, location.href).href});
  let pendingBatch = null;

  function tick(now) {
    const realDt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now;
    tokens = Math.min(+$('rate').value, tokens + realDt * +$('rate').value);
    if (ready && !busy) {
      const tempo = +$('tempo').value;
      acc += realDt * tempo;
      const n = Math.min(10, Math.floor(acc / DT));
      if (n > 0) {
        acc -= n * DT;
        const frames = [];
        for (let k = 0; k < n; k++) frames.push(Stimuli.frame(P, simT + k * DT, new Float32Array(X.length)));
        lastLum = frames[frames.length - 1].slice();
        pendingBatch = {t0: simT, tempo}; simT += n * DT;
        busy = true; worker.postMessage({cmd: 'run', frames}, frames.map(f => f.buffer));
      }
      if (acc > 10 * DT) acc = 10 * DT; // don't build up debt if the browser can't keep up
    }
    drawEye(); if ((frameN & 1) === 0) drawRaw(); drawRoll(realDt); drawFb(); if ((frameN++ & 1) === 0) drawCascade();
    requestAnimationFrame(tick);
  }
  let frameN = 0;
  const stats = {notes: 0, byGroup: [0, 0, 0, 0, 0], dep: 0, hyp: 0};
  window.__flyharp = {stats, P, area, fbR, get fbInfo() { return fbInfo; }, get strings() { return strings; }, get simT() { return simT; }, toggleType: t => toggleType(t)};

  // ---------------------------------------------------------------- drawing: the eye and its lenses
  const LENSES = [
    {id: 'photo', cells: 5353, name: 'Photoreceptors', col: '#d9d6ce', sub: 'the image at 721 points',
      info: 'With photoreceptor adaptation on, this shows what the photoreceptors signal: contrast against their own recent mean light. Each facet is one ommatidium, about 5° across. Eight photoreceptors in each look at the same point; this is their input. The fly\'s acuity is roughly a hundred times coarser than yours, but it updates far faster.'},
    {id: 'lamina', cells: 1586, name: 'Lamina contrast', col: '#4fb3a4', sub: 'L1 + L2: change, not light', types: ['L1', 'L2'],
      info: 'L1 and L2 hyperpolarise to brightening (blue) and depolarise to dimming (orange). They report temporal contrast, so a still scene fades and edges flare when they move.'},
    {id: 'on', cells: 1655, name: 'ON channel', col: '#e0c35a', sub: 'Mi1 + Tm3: brightening', types: ['Mi1', 'Tm3'],
      info: 'The medulla re-inverts L1 into an ON signal: Mi1 and Tm3 depolarise (orange) where light increases. They are the fast inputs to the T4 motion detectors.'},
    {id: 'off', cells: 3032, name: 'OFF channel', col: '#e88a4f', sub: 'Tm1/2/4/9: darkening', types: ['Tm1', 'Tm2', 'Tm4', 'Tm9'],
      info: 'The transmedullary OFF cells depolarise (orange) where light decreases. They feed T5. Tm9 is slow and carries luminance from L3, so it lags the others.'},
    {id: 'motion', cells: 6100, name: 'Motion', col: '#e2576b', sub: 'T4 + T5: direction field', types: ['T4a', 'T4b', 'T4c', 'T4d', 'T5a', 'T5b', 'T5c', 'T5d'],
      info: 'The eight T4/T5 subtypes each prefer one direction. A linear read-out, fit to known motion, turns their responses into a direction field: hue is direction (see the wheel), brightness is strength. This is the input to the fly\'s optic-flow neurons. (A plain sum along each subtype\'s preferred direction drifts upward here, because two subtypes in this model are only weakly direction selective.)'},
    {id: 'feedback', cells: 1833, name: 'Feedback', col: '#7f8cff', sub: 'medulla → lamina loop', info: 'The feedback current from medulla-resident cells (C2, C3, Lawf and medulla interneurons) onto L1–L5, relative to grey. Blue is net inhibition, gold is net excitation. This is what shapes the timbre in the Feedback panel.'},
  ];
  // the lenses are laid out as the optic lobe is wired: one image, split by the lamina into ON and OFF streams,
  // which reconverge on the direction-selective T4/T5 cells; feedback is the loop from medulla back to lamina
  const LENS_STAGES = ['Retina', 'Lamina', 'Medulla', 'Lobula plate'];
  const LENS_POS = {photo: 'grid-area:1/2/2/4', lamina: 'grid-area:2/2/3/4', on: 'grid-area:3/2/4/3', off: 'grid-area:3/3/4/4',
    motion: 'grid-area:4/2/5/4', feedback: 'grid-area:2/4/4/5'};
  const LENS_EDGES = [['photo', 'lamina'], ['lamina', 'on'], ['lamina', 'off'], ['on', 'motion'], ['off', 'motion'], ['off', 'feedback', 'fb'], ['feedback', 'lamina', 'fb']];
  const LENS_UP = {photo: [], lamina: ['photo'], on: ['lamina', 'photo'], off: ['lamina', 'photo'], motion: ['on', 'off', 'lamina', 'photo'], feedback: ['on', 'off', 'lamina']};
  function drawWires(lit) {
    const box = $('lenses'), svg = box.querySelector('.wires'); if (!svg) return;
    const R = box.getBoundingClientRect(), r = id => { const q = box.querySelector(`[data-l="${id}"]`).getBoundingClientRect(); return {l: q.left - R.left, r: q.right - R.left, t: q.top - R.top, b: q.bottom - R.top, cx: (q.left + q.right) / 2 - R.left, cy: (q.top + q.bottom) / 2 - R.top}; };
    svg.setAttribute('viewBox', `0 0 ${R.width} ${R.height}`);
    const head = (x, y, ang) => { const a = 5; return `M${x},${y} L${x - a * Math.cos(ang - .5)},${y - a * Math.sin(ang - .5)} M${x},${y} L${x - a * Math.cos(ang + .5)},${y - a * Math.sin(ang + .5)}`; };
    // the hourglass behind the wiring: band width at each stage is proportional to how many neurons the lens shows
    // (one optic lobe, FlyWire v783) - 5,353 photoreceptors squeeze into 1,586 L1/L2, then fan out to 4,687 ON/OFF
    // medulla cells and 6,100 T4/T5. Per column that's 8 -> 2 -> 6 -> 8.
    const C = id => LENSES.find(x => x.id === id).cells, ON = r('on'), OFF = r('off');
    // drawn as a population profile down the stage-label column, so it never hides behind the tiles
    const st = box.querySelector('.stage').getBoundingClientRect(), span = 0, cx0 = (st.left + st.right) / 2 - R.left, max = C('motion'), wmax = Math.min(st.width, 64);
    const rows = [[r('photo'), C('photo')], [r('lamina'), C('lamina')], [{t: Math.min(ON.t, OFF.t), b: Math.max(ON.b, OFF.b)}, C('on') + C('off')], [r('motion'), C('motion')]]
      .map(([q, n]) => ({t: q.t + 6, b: q.b - 6, h: wmax * n / max / 2}));
    let L = `M${cx0 - rows[0].h},${rows[0].t}`, Rt = '';
    rows.forEach((q, i) => {
      L += ` L${cx0 - q.h},${q.b}`; const nx = rows[i + 1];
      if (nx) { const m = (q.b + nx.t) / 2; L += ` C${cx0 - q.h},${m} ${cx0 - nx.h},${m} ${cx0 - nx.h},${nx.t}`; }
    });
    for (let i = rows.length - 1; i >= 0; i--) {
      const q = rows[i]; Rt += ` L${cx0 + q.h},${q.b} L${cx0 + q.h},${q.t}`; const pv = rows[i - 1];
      if (pv) { const m = (q.t + pv.b) / 2; Rt += ` C${cx0 + q.h},${m} ${cx0 + pv.h},${m} ${cx0 + pv.h},${pv.b}`; }
    }
    const glass = `<defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9d6ce" stop-opacity=".35"/><stop offset=".35" stop-color="#4fb3a4" stop-opacity=".4"/><stop offset=".65" stop-color="#e0a35a" stop-opacity=".35"/><stop offset="1" stop-color="#e2576b" stop-opacity=".4"/></linearGradient></defs><path class="glass" d="${L}${Rt} Z"/>`;
    svg.innerHTML = glass + LENS_EDGES.map(([a, b, kind]) => {
      const A = r(a), B = r(b), on = lit.has(a) && lit.has(b);
      let d, x1, y1, x2, y2;
      if (!kind) {
        // feed-forward: bottom of the source to top of the target; side-by-side medulla nodes leave and arrive off-centre
        x1 = b === 'on' ? A.cx - (A.r - A.l) * .22 : b === 'off' ? A.cx + (A.r - A.l) * .22 : a === 'on' ? A.cx + (A.r - A.l) * .2 : a === 'off' ? A.cx - (A.r - A.l) * .2 : A.cx;
        y1 = A.b; y2 = B.t - 1;
        x2 = a === 'on' ? B.cx - (B.r - B.l) * .18 : a === 'off' ? B.cx + (B.r - B.l) * .18 : b === 'on' ? B.cx : b === 'off' ? B.cx : B.cx;
        const m = (y1 + y2) / 2; d = `M${x1},${y1} C${x1},${m} ${x2},${m} ${x2},${y2}`;
        return `<path class="${on ? 'lit' : ''}" d="${d}"/><path class="hd ${on ? 'lit' : ''}" d="${head(x2, y2, Math.PI / 2)}"/>`;
      }
      // feedback loop, dashed: OFF/medulla out to the feedback node, then back up into the lamina
      if (a === 'off') { x1 = A.r; y1 = A.cy; x2 = B.cx; y2 = B.b; d = `M${x1},${y1} C${x2},${y1} ${x2},${y1} ${x2},${y2 + 1}`; return `<path class="fb ${on ? 'lit' : ''}" d="${d}"/>`; }
      x1 = A.cx; y1 = A.t; x2 = B.r + 1; y2 = B.cy; d = `M${x1},${y1} C${x1},${y2} ${x1},${y2} ${x2},${y2}`;
      return `<path class="fb ${on ? 'lit' : ''}" d="${d}"/><path class="hd fb ${on ? 'lit' : ''}" d="${head(x2, y2, Math.PI)}"/>`;
    }).join('');
  }
  new ResizeObserver(() => drawWires(new Set([lens, ...LENS_UP[lens]]))).observe($('lenses'));
  let lens = 'motion', prefDir = {}, decoder = null, lastFbc = null;
  let lensMax = {};
  function renderLenses() {
    const lit = new Set([lens, ...LENS_UP[lens]]);
    $('lenses').innerHTML = LENS_STAGES.map((t, i) => `<span class="stage" style="grid-row:${i + 1}">${t}</span>`).join('') +
      LENSES.map(L => `<button class="lens ${L.id === lens ? 'on' : lit.has(L.id) ? 'path' : ''}" data-l="${L.id}" style="${LENS_POS[L.id]}"><i class="bar" style="background:${L.col}"></i><b>${L.name}</b><span>${L.sub}</span><em class="n">${L.cells.toLocaleString()} cells</em></button>`).join('') +
      '<svg class="wires" aria-hidden="true"></svg>';
    $('lenses').querySelectorAll('.lens').forEach(b => b.onclick = () => { lens = b.dataset.l; renderLenses(); });
    drawWires(lit);
    const L = LENSES.find(x => x.id === lens);
    $('lensInfo').textContent = L.info; $('lensTag').textContent = L.name;
    $('arrows').parentElement.style.display = lens === 'motion' ? '' : 'none';
    $('underlay').parentElement.style.display = lens === 'photo' ? 'none' : '';
    drawLegend();
  }
  function drawLegend() {
    const el = $('lensLegend');
    if (lens === 'motion') {
      el.innerHTML = '<canvas id="wheel" width="44" height="44"></canvas><span>direction on the eye (hue) · brighter = stronger motion signal</span>';
      const c = $('wheel').getContext('2d');
      for (let a = 0; a < 360; a += 3) { c.fillStyle = `hsl(${a},80%,58%)`; c.beginPath(); c.moveTo(22, 22); c.arc(22, 22, 21, -(a + 4) * Math.PI / 180, -a * Math.PI / 180); c.fill(); }   // hue = direction, counter-clockwise from rightward, up = up
      c.fillStyle = '#16181d'; c.beginPath(); c.arc(22, 22, 9, 0, 2 * Math.PI); c.fill();
    } else if (lens === 'photo') el.innerHTML = '<i class="grad" style="background:linear-gradient(90deg,#000,#fff)"></i><span>dark → bright</span>';
    else if (lens === 'feedback') el.innerHTML = '<i class="grad" style="background:linear-gradient(90deg,#7f8cff,#202228 50%,#f0c75a)"></i><span>net inhibitory · none · net excitatory</span>';
    else el.innerHTML = '<i class="grad"></i><span>hyperpolarised · rest · depolarised (relative to a grey screen)</span>';
  }
  $('underlay').onchange = () => {}; $('arrows').onchange = () => {};

  const eye = $('eye'), ex = eye.getContext('2d');
  function eyeScale() { return (eye.width / 2 - 18) / ((G ? G.R : 15) + 0.6); }
  // facet i as drawn: its polygon from the eye geometry (+y up on the eye, so flip for the canvas)
  const facetPath = (i, cx, cy, s) => { const p = G.poly; ex.beginPath(); for (let k = 0; k < 6; k++) { const x = cx + p[12 * i + 2 * k] * s, y = cy - p[12 * i + 2 * k + 1] * s; k ? ex.lineTo(x, y) : ex.moveTo(x, y); } ex.closePath(); };
  const hexPath = (x, y, r) => { ex.beginPath(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; i ? ex.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)) : ex.moveTo(x + r * Math.cos(a), y + r * Math.sin(a)); } ex.closePath(); };
  const lerp = (a, b, t) => a + (b - a) * t;
  function divColor(v) { // blue · dark grey · orange
    const t = Math.min(1, Math.abs(v)), lo = [32, 34, 40], hi = v < 0 ? [90, 166, 232] : [240, 160, 75];
    return [lerp(lo[0], hi[0], t), lerp(lo[1], hi[1], t), lerp(lo[2], hi[2], t)];
  }
  function lensValues() {
    const n = X.length, out = new Float32Array(n);
    const L = LENSES.find(x => x.id === lens);
    if (lens === 'feedback') { if (lastFbc) out.set(lastFbc); }
    else if (L.types && lastDV) {
      const ts = L.types.map(t => types.indexOf(t)).filter(i => i >= 0);
      for (const t of ts) { const arr = nodeOf[t], sc = scale[t]; for (let k = 0; k < n; k++) if (arr[k] >= 0) out[k] += lastDV[arr[k]] / sc / ts.length; }
    }
    // display gain: track the 98th percentile of |value| (fast attack, slow release)
    const a = Array.from(out, Math.abs).sort((x, y) => x - y), p98 = Math.max(a[Math.floor(0.98 * (n - 1))], 1e-6);
    const m = lensMax[lens] || p98; lensMax[lens] = p98 > m ? p98 : m * 0.985 + p98 * 0.015;
    const g = Math.max(lensMax[lens], 0.2);   // never amplify weak signals beyond a fifth of the type's (as-trained) response range
    for (let k = 0; k < n; k++) out[k] = edge[k] ? 0 : out[k] / g;
    return out;
  }
  function motionField() {
    const n = X.length, vx = new Float32Array(n), vy = new Float32Array(n);
    if (!lastDV) return {vx, vy, mags: new Float32Array(n), norm: 1};
    // linear read-out fitted to known motion (tools/fit_motion_decoder.js). A plain vector sum along each subtype's
    // preferred direction is biased here: T4d and T5b are only weakly direction selective, so they push every
    // response toward their own direction. Fallback: that vector sum.
    for (const t of Object.keys(decoder || prefDir)) {
      const ti = types.indexOf(t), arr = nodeOf[ti];
      const [c, s, sc] = decoder ? [decoder[t][0], decoder[t][1], 1] : [Math.cos(prefDir[t]), Math.sin(prefDir[t]), scale[ti]];
      for (let k = 0; k < n; k++) { const d = lastDV[arr[k]] / sc; if (d > 0) { vx[k] += d * c; vy[k] += d * s; } }
    }
    // into world directions: the read-out is in lattice coordinates; the eye maps the lattice onto the world
    const J = G.J;
    for (let k = 0; k < n; k++) { const a = vx[k], b = vy[k]; vx[k] = J[4 * k] * a + J[4 * k + 1] * b; vy[k] = J[4 * k + 2] * a + J[4 * k + 3] * b; }
    let mx = 1e-6; const mags = new Float32Array(n);
    for (let k = 0; k < n; k++) { mags[k] = Math.hypot(vx[k], vy[k]); }
    const srt = Array.from(mags).sort((a, b) => a - b); mx = Math.max(srt[Math.floor(0.98 * (n - 1))], 1e-6);
    const m = lensMax.motion || mx; lensMax.motion = mx > m ? mx : m * 0.985 + mx * 0.015;
    for (let k = 0; k < n; k++) if (edge[k]) { mags[k] = 0; vx[k] = 0; vy[k] = 0; }
    return {vx, vy, mags, norm: Math.max(lensMax.motion, 0.05)};   // decoder units; floor only guards against amplifying noise
  }
  function drawEye() {
    if (!ready) return;
    const s = eyeScale(), cx = eye.width / 2, cy = eye.height / 2, r = s * 0.555;
    ex.clearRect(0, 0, eye.width, eye.height);
    const under = $('underlay').checked || lens === 'photo';
    const vals = lens === 'photo' || lens === 'motion' ? null : lensValues();
    const mf = lens === 'motion' ? motionField() : null;
    for (let i = 0; i < X.length; i++) {
      if (!G.real[i]) continue;   // model columns beyond the measured eye (a few at the rim): not drawn
      // the photoreceptor lens shows what the photoreceptors signal: the adapted contrast image when adaptation is on
      const g = Math.min(255, ((lens === 'photo' && lastPR) ? lastPR[i] : lastLum[i]) * 255);
      let col;
      if (lens === 'photo') col = [g, g, g];
      else if (mf) {
        const m = Math.max(0, Math.min(1, mf.mags[i] / mf.norm) - 0.1) / 0.9, hue = (Math.atan2(mf.vy[i], mf.vx[i]) * 180 / Math.PI + 360) % 360;
        const [hr, hg, hb] = hsl(hue, 0.8, 0.58), base = under ? g * 0.42 : 28;
        col = [lerp(base, hr, m), lerp(base, hg, m), lerp(base, hb, m)];
      } else {
        const v = Math.max(-1, Math.min(1, vals[i])), c = lens === 'feedback' && v > 0 ? [lerp(32, 240, v), lerp(34, 199, v), lerp(40, 90, v)] : lens === 'feedback' ? [lerp(32, 127, -v), lerp(34, 140, -v), lerp(40, 255, -v)] : divColor(v);
        const base = under ? g * 0.42 : 30, t = Math.min(1, Math.abs(v) * 1.2);
        col = [lerp(base, c[0], t), lerp(base, c[1], t), lerp(base, c[2], t)];
      }
      ex.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
      facetPath(i, cx, cy, s); ex.fill();
    }
    // facet sheen: a soft highlight like light on the cornea
    const grd = ex.createRadialGradient(cx - eye.width * 0.18, cy - eye.height * 0.22, 10, cx, cy, eye.width * 0.55);
    grd.addColorStop(0, 'rgba(255,255,255,0.07)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.015)'); grd.addColorStop(1, 'rgba(0,0,0,0.18)');
    ex.fillStyle = grd; ex.fillRect(0, 0, eye.width, eye.height);
    if (mf && $('arrows').checked) {
      ex.lineWidth = 1.6; ex.lineCap = 'round';
      for (let i = 0; i < X.length; i++) {
        if ((u[i] - v[i]) % 3 !== 0 || u[i] % 3 !== 0) continue;
        let ax = 0, ay = 0, nn = 0;
        for (const j of nbr[i]) { ax += mf.vx[j]; ay += mf.vy[j]; nn++; }
        const m = Math.hypot(ax, ay) / nn / mf.norm; if (m < 0.18) continue;
        const L = Math.min(1, m) * s * 2.4, ang = Math.atan2(-ay, ax), x0 = cx + G.DX[i] * s, y0 = cy - G.DY[i] * s;   // canvas y runs down
        const x1 = x0 + Math.cos(ang) * L, y1 = y0 + Math.sin(ang) * L;
        ex.strokeStyle = `rgba(255,255,255,${0.35 + 0.6 * Math.min(1, m)})`;
        ex.beginPath(); ex.moveTo(x0 - Math.cos(ang) * L * 0.3, y0 - Math.sin(ang) * L * 0.3); ex.lineTo(x1, y1);
        ex.lineTo(x1 - Math.cos(ang - 0.5) * 5, y1 - Math.sin(ang - 0.5) * 5); ex.moveTo(x1, y1); ex.lineTo(x1 - Math.cos(ang + 0.5) * 5, y1 - Math.sin(ang + 0.5) * 5); ex.stroke();
      }
    }
    if ($('spatial').checked && G.mode === 'lattice') {
      const R = Stimuli.radius() * s;
      ex.strokeStyle = 'rgba(240,160,75,0.28)'; ex.lineWidth = 1; ex.setLineDash([4, 5]);
      ex.beginPath(); ex.arc(cx, cy, R / 3, 0, 2 * Math.PI); ex.stroke();
      for (let k = 0; k < 6; k++) { const a = -Math.PI + k * Math.PI / 3; ex.beginPath(); ex.moveTo(cx + Math.cos(a) * R / 3, cy + Math.sin(a) * R / 3); ex.lineTo(cx + Math.cos(a) * R * 1.03, cy + Math.sin(a) * R * 1.03); ex.stroke(); }
      ex.setLineDash([]);
    }
  }
  function hsl(h, s, l) {
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [255 * f(0), 255 * f(8), 255 * f(4)];
  }
  // "what you see": the camera frame (mirrored like the eye) or the stimulus at full resolution, with the eye's footprint
  const raw = $('raw'), rx2 = raw.getContext('2d');
  let fineX = null, fineY = null, fineImg = null;
  function drawRaw() {
    if (!ready) return;
    const W = raw.width, H = raw.height, vid = P.kind === 'webcam' ? Stimuli.video() : null, Rr = Stimuli.radius();
    if (vid) {
      rx2.save(); rx2.translate(W, 0); rx2.scale(-1, 1); rx2.drawImage(vid, 0, 0, W, H); rx2.restore();
      rx2.strokeStyle = 'rgba(240,160,75,0.8)'; rx2.lineWidth = 1.2; rx2.beginPath(); rx2.arc(W / 2, H / 2, (Math.min(160, 120) / 2 - 1) * W / 160, 0, 2 * Math.PI); rx2.stroke();
      return;
    }
    if (!fineX) {
      const nx = 100, ny = 75; fineX = new Float32Array(nx * ny); fineY = new Float32Array(nx * ny);
      const span = 2 * Rr * 1.15;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { fineX[j * nx + i] = (i / (nx - 1) - 0.5) * span * W / H; fineY[j * nx + i] = (0.5 - j / (ny - 1)) * span; }
      fineImg = rx2.createImageData(nx, ny);
    }
    const L = Stimuli.frameAt(fineX, fineY, P, simT, new Float32Array(fineX.length)), d = fineImg.data;
    for (let k = 0; k < L.length; k++) { const g = L[k] * 255; d[4 * k] = g; d[4 * k + 1] = g; d[4 * k + 2] = g; d[4 * k + 3] = 255; }
    const tmp = drawRaw.c || (drawRaw.c = Object.assign(document.createElement('canvas'), {width: 100, height: 75}));
    tmp.getContext('2d').putImageData(fineImg, 0, 0);
    rx2.imageSmoothingEnabled = true; rx2.drawImage(tmp, 0, 0, W, H);
    rx2.strokeStyle = 'rgba(240,160,75,0.8)'; rx2.lineWidth = 1.2; rx2.beginPath(); rx2.arc(W / 2, H / 2, H / 2 / 1.15, 0, 2 * Math.PI); rx2.stroke();
  }
  let u = [], v = [], nbr = [], edge = [];
  let drawing = false;
  const paintAt = (e) => {
    const r = eye.getBoundingClientRect(), s = eyeScale() * r.width / eye.width;
    Stimuli.addPaint((e.clientX - r.left - r.width / 2) / s, -(e.clientY - r.top - r.height / 2) / s, simT, P.polarity);
  };
  eye.addEventListener('pointerdown', e => { if (P.kind !== 'paint') { $('kind').value = 'paint'; $('kind').onchange(); } drawing = true; eye.setPointerCapture(e.pointerId); paintAt(e); });
  eye.addEventListener('pointermove', e => { if (drawing) paintAt(e); });
  eye.addEventListener('pointerup', () => drawing = false);

  // ---------------------------------------------------------------- drawing: feedback meter (7 regions, bipolar)
  const fbC = $('fbMeter'), fx = fbC.getContext('2d');
  function drawFb() {
    const W = fbC.width, H = fbC.height, LW = 52, n = 7, w = (W - LW - 4) / n, mid = 19;
    fx.fillStyle = '#0f1115'; fx.fillRect(0, 0, W, H);
    fx.font = '10px -apple-system, Segoe UI, sans-serif';
    fx.fillStyle = '#f0c75a'; fx.fillText('brighten', 4, 12);
    fx.fillStyle = '#7f8cff'; fx.fillText('damp', 4, mid + 14);
    fx.fillStyle = '#2a2d36'; fx.fillRect(LW, mid, W - LW - 4, 1);
    const labels = ['centre', '←', '↙', '↘', '→', '↗', '↖'];   // eye sectors (worker regions), with up = dorsal
    fx.textAlign = 'center';
    for (let r = 0; r < n; r++) {
      const v = Math.max(-1, Math.min(1, fbR[r] * +$('fbDepth').value)), x = LW + r * w, hgt = Math.abs(v) * 15;
      fx.fillStyle = v < 0 ? '#7f8cff' : '#f0c75a';
      fx.fillRect(x + 3, v < 0 ? mid + 1 : mid - hgt, w - 6, hgt);
      fx.fillStyle = '#6c6a64'; fx.fillText(labels[r], x + w / 2, H - 3);
    }
    fx.textAlign = 'start';
  }

  // ---------------------------------------------------------------- drawing: piano roll
  const rollC = $('roll'), rx = rollC.getContext('2d'), rollW = rollC.width, roll = [];
  function drawRoll(dt) {
    const W = rollC.width, h = rollC.height, lo = 22, hi = 112, yOf = m => h - (m - lo) / (hi - lo) * h;
    rx.fillStyle = '#0a0b0d'; rx.fillRect(0, 0, W, h);
    // one band per area spanning the pitches of its strings (both polarities)
    rx.font = '600 11px -apple-system, Segoe UI, sans-serif';
    for (let g = 0; g < 5; g++) {
      const ms = strings.filter(x => x.g === g).map(x => x.midi); if (!ms.length) continue;
      const y0 = yOf(Math.max(...ms) + 1), y1 = yOf(Math.min(...ms) - 1), q = audible(g) ? 1 : 0.35;
      rx.globalAlpha = 0.07 * q; rx.fillStyle = GROUP_COL[g]; rx.fillRect(0, y0, W, y1 - y0);
      rx.globalAlpha = 0.5 * q; rx.fillRect(0, y0, 3, y1 - y0);
      rx.globalAlpha = 0.8 * q; rx.fillText(GROUP_NAMES[g], 10, Math.max(12, y0 + 12));
    }
    rx.globalAlpha = 1;
    for (let i = roll.length - 1; i >= 0; i--) {
      const n = roll[i]; n.x -= dt * 90;
      if (n.x < -40) { roll.splice(i, 1); continue; }
      const y = yOf(n.midi), w = 6 + 18 * DUR[n.g];
      rx.globalAlpha = 0.35 + 0.65 * n.vel; rx.fillStyle = GROUP_COL[n.g]; rx.strokeStyle = GROUP_COL[n.g];
      if (n.hyp) { rx.lineWidth = 1.5; rx.strokeRect(n.x - 8, y - 3, w, 6); } else rx.fillRect(n.x - 8, y - 3, w, 6);
    }
    rx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- drawing: cascade of cell-type maps
  const casC = $('cascade'), cx2 = casC.getContext('2d');
  let tiles = [], bands = [], img = null, pix = null;
  const ROWS = [[0, t => groupOf(t) === 0], [1, t => groupOf(t) === 1], [2, t => groupOf(t) === 2], [3, t => groupOf(t) === 3 && /^Tm\d/.test(t)],
    [3, t => groupOf(t) === 3 && !/^Tm\d/.test(t)], [4, t => groupOf(t) === 4]];
  const LW = 150, TW = 78, TH = 70, MS = 2.0;
  function layoutCascade() {
    tiles = []; bands = [];
    ROWS.forEach(([g, f], row) => {
      types.filter(f).forEach((t, i) => tiles.push({t: types.indexOf(t), name: t, x0: LW + i * TW, y0: 8 + row * TH, g}));
      const b = bands.find(b => b.g === g);
      if (b) b.y1 = 8 + (row + 1) * TH; else bands.push({g, y0: 8 + row * TH, y1: 8 + (row + 1) * TH});
    });
    img = cx2.createImageData(casC.width, casC.height); pix = img.data;
  }
  const meter = new Float32Array(5);
  function drawCascade() {
    if (!ready || !lastDV) return;
    for (let i = 0; i < pix.length; i += 4) { pix[i] = 10; pix[i + 1] = 11; pix[i + 2] = 13; pix[i + 3] = 255; }
    const lvl = new Float32Array(5), cnt = new Float32Array(5);
    for (const tl of tiles) {
      const arr = nodeOf[tl.t], sc = 3 * scale[tl.t], ox = tl.x0 + 34, oy = tl.y0 + 32, on = selected.has(tl.name);
      const dim = on ? (audible(tl.g) ? 1 : 0.55) : 0.42;
      let ab = 0, n = 0;
      for (let k = 0; k < arr.length; k++) {
        const id = arr[k]; if (id < 0) continue;
        let v = lastDV[id] / sc; v = v > 1 ? 1 : v < -1 ? -1 : v; ab += Math.abs(v); n++;
        const r = (v > 0 ? 32 + 208 * v : 32 + 58 * -v) * dim, g = (v > 0 ? 34 + 126 * v : 34 + 132 * -v) * dim, b = (v > 0 ? 40 + 35 * v : 40 + 192 * -v) * dim;
        const px = Math.round(ox + X[k] * MS), py = Math.round(oy - Y[k] * MS);
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const o = 4 * ((py + dy) * casC.width + px + dx); pix[o] = r; pix[o + 1] = g; pix[o + 2] = b; }
      }
      lvl[tl.g] += ab / Math.max(n, 1); cnt[tl.g]++;
    }
    cx2.putImageData(img, 0, 0);
    // area bands: name, members, live activity meter (mean |response| across the area's cell types)
    for (const b of bands) {
      const g = b.g, q = audible(g) ? 1 : 0.45, m = lvl[g] / Math.max(cnt[g], 1);
      meter[g] += (m - meter[g]) * 0.3;
      cx2.globalAlpha = 0.06 * q; cx2.fillStyle = GROUP_COL[g]; cx2.fillRect(0, b.y0, casC.width, b.y1 - b.y0 - 4);
      cx2.globalAlpha = q; cx2.fillRect(0, b.y0, 3, b.y1 - b.y0 - 4);
      cx2.font = '600 13px -apple-system, Segoe UI, sans-serif'; cx2.fillText(FlyInfo.areas[g].name, 12, b.y0 + 20);
      cx2.globalAlpha = 0.7 * q; cx2.fillStyle = '#8d8a83'; cx2.font = '10.5px -apple-system, Segoe UI, sans-serif'; cx2.fillText(FlyInfo.areas[g].sub, 12, b.y0 + 35);
      cx2.fillStyle = '#23262e'; cx2.globalAlpha = 1; cx2.fillRect(12, b.y0 + 44, LW - 30, 4);
      cx2.fillStyle = GROUP_COL[g]; cx2.globalAlpha = q; cx2.fillRect(12, b.y0 + 44, Math.min(1, meter[g] * 2.5) * (LW - 30), 4);
    }
    cx2.globalAlpha = 1;
    cx2.font = '10px -apple-system, Segoe UI, sans-serif';
    for (const tl of tiles) {
      const on = selected.has(tl.name);
      cx2.globalAlpha = on ? (audible(tl.g) ? 1 : 0.5) : 0.38; cx2.fillStyle = on ? GROUP_COL[tl.g] : '#8d8a83';
      cx2.fillText(tl.name, tl.x0 + 2, tl.y0 + 66);
      if (on) { cx2.fillRect(tl.x0 + 2, tl.y0 + 1, 10, 2); }
    }
    cx2.globalAlpha = 1;
    const now = performance.now();
    rings = rings.filter(r => now - r.born < 400);
    for (const rg of rings) {
      const tl = tiles.find(x => x.t === rg.t); if (!tl) continue;
      const a = 1 - (now - rg.born) / 400;
      cx2.strokeStyle = rg.hyp ? '#5aa6e8' : GROUP_COL[rg.g]; cx2.globalAlpha = rg.quiet ? a * 0.3 : a; cx2.lineWidth = 2;
      let px = tl.x0 + 34, py = tl.y0 + 32, rad = 30;
      if (rg.r > 0) { const ang = -Math.PI + (rg.r - 0.5) * Math.PI / 3; px += Math.cos(ang) * 19; py += Math.sin(ang) * 19; rad = 10; } else if (rg.r === 0) rad = 10;
      cx2.setLineDash(rg.hyp ? [3, 3] : []);
      cx2.beginPath(); cx2.arc(px, py, rad, 0, 2 * Math.PI); cx2.stroke(); cx2.setLineDash([]);
    }
    cx2.globalAlpha = 1;
  }
  function hitCascade(e) {
    const r = casC.getBoundingClientRect(), x = (e.clientX - r.left) * casC.width / r.width, y = (e.clientY - r.top) * casC.height / r.height;
    if (x < LW) { const b = bands.find(b => y >= b.y0 && y < b.y1); return b ? {band: b.g} : null; }
    const tl = tiles.find(t => x >= t.x0 && x < t.x0 + TW - 4 && y >= t.y0 && y < t.y0 + TH - 2);
    return tl ? {tile: tl} : null;
  }
  casC.addEventListener('mousemove', e => {
    const h = hitCascade(e);
    if (!h) return hideTip();
    showTip(h.tile ? cellCard(h.tile.name) : areaCard(h.band), e.clientX, e.clientY);
  });
  casC.addEventListener('mouseleave', hideTip);

  casC.addEventListener('click', e => { const h = hitCascade(e); if (h && h.tile) { toggleType(h.tile.name); showTip(cellCard(h.tile.name), e.clientX, e.clientY); } });
  casC.style.cursor = 'pointer';

  requestAnimationFrame(tick);

  // ---------------------------------------------------------------- probe: gain control in silico (js/probe.js)
  let probeW = null, probeReady = null, lastProbe = null;
  function setupProbe() {
    const pref = ['Mi1', 'L2', 'Tm3', 'Tm9', 'T4b', 'T5b', 'Mi4', 'Mi9', 'Tm1', 'Tm2', 'C3', 'L3'];
    $('pType').innerHTML = pref.concat(types.filter(t => !pref.includes(t) && !/^R\d/.test(t))).filter(t => types.includes(t))
      .map(t => `<option>${t}</option>`).join('');
    $('pRun').onclick = runProbe;
    drawProbe(null);
  }
  function runProbe() {
    if (!probeW) {
      probeW = new Worker('js/probe-worker.js' + V);
      probeReady = new Promise(res => probeW.onmessage = e => { if (e.data.cmd === 'ready') res(); });
      probeW.postMessage({cmd: 'init', url: new URL('data/fly.json' + V, location.href).href});
      $('pNote').textContent = 'building a copy of the network…';
    }
    const type = $('pType').value, theta = prefDir[type] ?? 0, p = gainParams();
    $('pRun').disabled = true; $('pFill').style.width = '0%';
    probeReady.then(() => {
      $('pNote').textContent = `recording ${type}…`;
      probeW.onmessage = e => {
        const m = e.data;
        if (m.cmd === 'progress') $('pFill').style.width = (100 * m.f).toFixed(0) + '%';
        else if (m.cmd === 'result') { $('pRun').disabled = false; lastProbe = m; drawProbe(m); }
      };
      probeW.postMessage({cmd: 'probe', type, theta, p});
    });
  }
  function drawProbe(m) {
    const W = 300, H = 210, L = 44, Rr = 10, T = 38, B = 36;
    const plot = (title, xlab, series, logx, note) => {
      const xs = series.flatMap(s => s.pts.map(p => p[0])), ys = series.flatMap(s => s.pts.map(p => p[1]));
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y1 = Math.max(...ys, 1e-6) * 1.08;
      const fx = v => L + (logx ? Math.log(v / x0) / Math.log(x1 / x0) : (v - x0) / (x1 - x0)) * (W - L - Rr), fy = v => H - B - v / y1 * (H - T - B);
      const ticks = logx ? series[0].pts.map(p => p[0]) : series[0].pts.map(p => p[0]);
      let g = `<text x="${L}" y="16" class="pt">${title}</text>`;
      g += `<line x1="${L}" y1="${H - B}" x2="${W - Rr}" y2="${H - B}" class="ax"/><line x1="${L}" y1="${T}" x2="${L}" y2="${H - B}" class="ax"/>`;
      g += ticks.map(v => `<text x="${fx(v)}" y="${H - B + 14}" class="tk" text-anchor="middle">${+v.toPrecision(2)}</text>`).join('');
      g += `<text x="${(L + W - Rr) / 2}" y="${H - 6}" class="tk" text-anchor="middle">${xlab}</text>`;
      g += `<text x="12" y="${(T + H - B) / 2}" class="tk" text-anchor="middle" transform="rotate(-90 12 ${(T + H - B) / 2})">response</text>`;
      for (const s of series) {
        const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${fx(p[0]).toFixed(1)},${fy(p[1]).toFixed(1)}`).join('');
        g += `<path d="${d}" fill="none" stroke="${s.col}" stroke-width="${s.dash ? 1.5 : 2.2}" ${s.dash ? 'stroke-dasharray="4 3"' : ''}/>`;
        if (!s.dash) g += s.pts.map(p => `<circle cx="${fx(p[0]).toFixed(1)}" cy="${fy(p[1]).toFixed(1)}" r="2.6" fill="${s.col}"/>`).join('');
      }
      if (note) g += `<text x="${W - Rr}" y="30" class="tk" text-anchor="end">${note}</text>`;
      return `<svg viewBox="0 0 ${W} ${H}" class="pplot">${g}</svg>`;
    };
    if (!m) { $('pPlots').innerHTML = '<p class="hint">Pick a cell type and run the probe (about 10–20 s). It measures the contrast response, size tuning at 12% and 80% contrast, and the response to the same 40% contrast at different mean light levels.</p>'; return; }
    const A = '#f0a04b', Bc = '#5aa6e8', grey = '#8d8a83';
    const ssi = r => { const a = r.map(p => p[1]), pk = Math.max(...a); return (1 - a[a.length - 1] / pk).toFixed(2); };
    const same = !m.p.adapt && !m.p.norm;
    const cur = (pts, col) => ({pts, col}), base = pts => ({pts, col: grey, dash: true});
    const crf = plot('Contrast response', 'contrast', [base(m.base.crf), ...(same ? [] : [cur(m.cur.crf, A)])], true);
    const size = plot('Size tuning', 'radius (columns)', [base(m.base['size0.8']), base(m.base['size0.12']), ...(same ? [] : [cur(m.cur['size0.8'], A), cur(m.cur['size0.12'], Bc)])], false,
      `SSI 80%: ${ssi(m.base['size0.8'])}→${ssi(m.cur['size0.8'])} · 12%: ${ssi(m.base['size0.12'])}→${ssi(m.cur['size0.12'])}`);
    const lum = plot('Light level', 'mean luminance (grey = 0.5)', [base(m.base.lum), ...(same ? [] : [cur(m.cur.lum, A)])], true);
    $('pPlots').innerHTML = crf + size + lum;
    const on = [m.p.adapt && 'photoreceptor adaptation', m.p.norm && `normalization of the ${m.p.target === 'both' ? 'lamina and medulla' : m.p.target} (pool ${m.p.poolR}, c50 ${m.p.c50})`].filter(Boolean);
    $('pNote').innerHTML = `${m.type}: ${on.length ? on.join(' + ') : 'gain control off, so only the trained network'} · size tuning: <span style="color:${A}">80%</span> and <span style="color:${Bc}">12%</span> contrast`;
  }
})();
