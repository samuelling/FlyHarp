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
  let lastLum = new Float32Array(721).fill(0.5), lastDV = null, rings = [], tokens = 24;
  const worker = new Worker('js/worker.js');

  // ---------------------------------------------------------------- controls
  for (const id of ['contrast', 'size', 'speed', 'direction']) bindRange(id, v => P[id] = v);
  bindRange('tempo', () => {}); bindRange('thresh', () => {}); bindRange('rate', () => {}); bindRange('spread', buildStrings);
  bindRange('vol', v => Sound.setVolume(v)); bindRange('rev', v => Sound.setReverb(v));
  function bindRange(id, fn) {
    const el = $(id), o = el.parentElement.querySelector('output');
    const upd = () => { const v = +el.value; if (o) o.textContent = id === 'direction' ? v + '°' : (id === 'tempo' ? v.toFixed(2) + '×' : v); fn(v); };
    el.addEventListener('input', upd); upd();
  }
  $('kind').onchange = async () => {
    P.kind = $('kind').value;
    $('eyehint').textContent = P.kind === 'paint' ? '· drag on the eye to draw (polarity sets dark/bright)' : '';
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
      await Sound.start(); Sound.setVolume(+$('vol').value); Sound.setReverb(+$('rev').value);
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
    const th = +$('thresh').value, nR = det.nR;
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
          events.push({s, r, vel: Math.min(1, 0.25 + d), pan: ang === null ? 0 : 0.8 * Math.cos(ang), lift: ang === null ? 0 : Math.sin(ang)});
        } else if (!det.armed[k] && d < th * 0.4) det.armed[k] = 1;
      }
    }
  }

  function fire(ev) {
    const st = strings[ev.s];
    if (!st) return;
    rings.push({t: st.t, r: det.nR > 1 ? ev.r : -1, born: performance.now(), g: st.g, quiet: !audible(st.g), hyp: st.pol < 0});
    if (!audible(st.g) || area[st.g].level <= 0) return;
    const p = Object.assign({}, st.p);
    if (st.engine === 'pluck') p.bright = Math.min(0.95, p.bright + 0.25 * ev.vel + 0.08 * ev.lift);
    const n = {midi: st.midi, vel: ev.vel * area[st.g].level, pan: ev.pan, dur: DUR[st.g], engine: st.engine, p,
      channel: $('midiCh').value === 'layer' ? st.g + (st.pol < 0 ? 5 : 0) : (st.pol < 0 ? 1 : 0)};
    if (playing) Sound.play(n, {internal: $('internal').checked, midi: true});
    plucks[st.name] = (plucks[st.name] || 0) + 1;
    roll.push({midi: st.midi, g: st.g, vel: ev.vel, x: rollW, hyp: st.pol < 0}); stats.notes++; stats.byGroup[st.g]++; stats[st.pol < 0 ? 'hyp' : 'dep']++;
  }

  // ---------------------------------------------------------------- worker
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.cmd === 'ready') {
      types = m.types; X = m.x; Y = m.y; nodeOf = m.nodeOf; region = m.region; NR = m.NR; scale = m.scale;
      tauList = m.tau;
      const order = types.map((t, i) => [m.tau[i], t]).sort((a, b) => a[0] - b[0]);
      order.forEach(([, t], r) => tauRank[t] = r / (order.length - 1));
      Stimuli.init(X, Y); layoutCascade(); ready = true; applyPreset('cascade');
      if (P.kind === 'webcam') useCamera();
      status(`${m.N.toLocaleString()} neurons, ${(m.nE / 1e6).toFixed(2)}M synapses running · press Start for sound`);
    } else if (m.cmd === 'frames') {
      busy = false; lastDV = m.dV;
      const batch = pendingBatch; pendingBatch = null;
      const events = [];
      m.steps.forEach((a, k) => { const evs = []; detect(a, batch.t0 + k * DT, evs); evs.forEach(ev => { ev.delay = k * DT / batch.tempo * 1000; events.push(ev); }); });
      // rate limit (token bucket), loudest first within the batch
      events.sort((p, q) => q.vel - p.vel);
      const keep = events.slice(0, Math.max(0, Math.floor(tokens))); tokens -= keep.length;
      keep.forEach(ev => setTimeout(() => fire(ev), ev.delay));
    }
  };
  worker.postMessage({cmd: 'init', url: new URL('data/fly.json', location.href).href});
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
    drawEye(); drawRoll(realDt); if ((frameN++ & 1) === 0) drawCascade();
    requestAnimationFrame(tick);
  }
  let frameN = 0;
  const stats = {notes: 0, byGroup: [0, 0, 0, 0, 0], dep: 0, hyp: 0};
  window.__flyharp = {stats, P, area, get strings() { return strings; }, get simT() { return simT; }, toggleType: t => toggleType(t)};

  // ---------------------------------------------------------------- drawing: eye
  const eye = $('eye'), ex = eye.getContext('2d');
  function eyeScale() { return (eye.width / 2 - 12) / 15.5; }
  function drawEye() {
    if (!ready) return;
    const s = eyeScale(), cx = eye.width / 2, cy = eye.height / 2;
    ex.fillStyle = '#0a0b0d'; ex.fillRect(0, 0, eye.width, eye.height);
    for (let i = 0; i < X.length; i++) {
      const v = Math.round(lastLum[i] * 255);
      ex.fillStyle = `rgb(${v},${v},${v})`;
      ex.beginPath(); ex.arc(cx + X[i] * s, cy + Y[i] * s, s * 0.47, 0, 2 * Math.PI); ex.fill();
    }
    if ($('spatial').checked) {
      // the 7 eye regions that each string listens to separately (centre + 6 sectors)
      const R = Stimuli.radius() * s;
      ex.strokeStyle = 'rgba(240,160,75,0.45)'; ex.lineWidth = 1; ex.setLineDash([4, 4]);
      ex.beginPath(); ex.arc(cx, cy, R / 3, 0, 2 * Math.PI); ex.stroke();
      for (let k = 0; k < 6; k++) { const a = -Math.PI + k * Math.PI / 3; ex.beginPath(); ex.moveTo(cx + Math.cos(a) * R / 3, cy + Math.sin(a) * R / 3); ex.lineTo(cx + Math.cos(a) * R * 1.02, cy + Math.sin(a) * R * 1.02); ex.stroke(); }
      ex.setLineDash([]);
    }
  }
  let drawing = false;
  const paintAt = (e) => {
    const r = eye.getBoundingClientRect(), s = eyeScale() * r.width / eye.width;
    Stimuli.addPaint((e.clientX - r.left - r.width / 2) / s, (e.clientY - r.top - r.height / 2) / s, simT, P.polarity);
  };
  eye.addEventListener('pointerdown', e => { if (P.kind !== 'paint') { $('kind').value = 'paint'; $('kind').onchange(); } drawing = true; eye.setPointerCapture(e.pointerId); paintAt(e); });
  eye.addEventListener('pointermove', e => { if (drawing) paintAt(e); });
  eye.addEventListener('pointerup', () => drawing = false);

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
        const px = Math.round(ox + X[k] * MS), py = Math.round(oy + Y[k] * MS);
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
})();
