// Courtship song module, shared with FrogFood (samuelling/Frog-food, js/core/song.js), which copied it from
// Opulation (samuelling/Opulation, js/song.js, commit ebd628a). Unchanged apart from this header and the two
// integer helpers below (Opulation imports them from its js/female.js). FlyHarp's Courtship mode uses only
// the song's timing constants and renderTrue's pulse shape; the Tonnectome hears the song as real sound.
// The courtship song: the male's key-confirmation tag, sung.
//
// 16-byte tag -> 64 two-bit symbols -> four pulse trains of 16 inter-pulse intervals (IPIs), each IPI one of
// 30 / 36 / 42 / 48 ms, with sine-song hums before and between the trains, as real D. melanogaster songs alternate.
// Everything is timed in whole 0.25 ms ticks so the ideal song, and the antenna frames made from it, are integers.
//
// The phones' speakers can't play 150-270 Hz well, so on the air the song is transposed up three octaves
// (pulses at 2160 Hz, hums at 1240 Hz). The receiving phone decodes the IPIs and replays the ideal, true-pitch
// song into her ears.
// from Opulation js/female.js
export const shr = (x, k) => Math.floor(x / 2 ** k);
export function floorDiv(a, b) { let q = Math.floor(a / b); if (q * b > a) q -= 1; else if ((q + 1) * b <= a) q += 1; return q; }

export function symbolsOf(tag) { const s = []; for (const b of tag) for (let k = 6; k >= 0; k -= 2) s.push((b >> k) & 3); return s; }
export function tagOf(symbols) { const t = new Uint8Array(symbols.length >> 2); for (let i = 0; i < t.length; i++) t[i] = (symbols[4 * i] << 6) | (symbols[4 * i + 1] << 4) | (symbols[4 * i + 2] << 2) | symbols[4 * i + 3]; return t; }

export const TRAINS = 4, PER_TRAIN = 16;
/** schedule of pulses and hums, in ticks. pulses: {t, k} (k = symbol index the IPI *ending* at this pulse carries, -1 = anchor) */
export function schedule(symbols, M) {
  const ipi = M.song.ipiTicks, pulses = [], hums = []; let t = 40;
  hums.push({ t0: t, t1: t + 1200 }); t += 1200 + 160;
  for (let tr = 0; tr < TRAINS; tr++) {
    pulses.push({ t, k: -1, train: tr });
    for (let i = 0; i < PER_TRAIN; i++) { const k = tr * PER_TRAIN + i; t += ipi[symbols[k] ?? 0]; pulses.push({ t, k, train: tr }); }
    if (tr < TRAINS - 1) { t += 240; hums.push({ t0: t, t1: t + 800 }); t += 800 + 240; }
  }
  return { pulses, hums, end: t + 400 };
}

/** Ideal antenna frames (Q16 ints), one per 5 ms, made on demand so a song can be heard as it arrives. */
export class Framer {
  constructor(M) { this.M = M; this.n = 0; this.slow = 0; this.pi = 0; }
  next(sch) {
    const M = this.M, NB = M.NB, F = M.dtTicks, OFF = M.envOff, pp = M.pulseProf, sp = M.sineProf, n = this.n++;
    const a = n * F, b = a + F; let envP = 0; const here = [];
    while (this.pi < sch.pulses.length && sch.pulses[this.pi].t < a - OFF) this.pi++;
    for (let j = this.pi; j < sch.pulses.length && sch.pulses[j].t <= a + OFF; j++) { envP += M.envTable[sch.pulses[j].t - a + OFF]; if (sch.pulses[j].t >= a && sch.pulses[j].t < b) here.push(sch.pulses[j]); }
    if (envP > 65536) envP = 65536;
    let cov = 0; for (const h of sch.hums) { const o = Math.min(b, h.t1) - Math.max(a, h.t0); if (o > 0) cov += o; }
    const envS = floorDiv(cov * 65536, F), f = new Float64Array(4 * NB + 2);
    const ap = shr(envP * M.pulseAmp, 16), as = shr(envS * M.sineAmp, 16);
    for (let k = 0; k < NB; k++) {
      const push = shr(ap * pp.push[k], 16) + shr(as * sp.push[k], 16), pull = shr(ap * pp.pull[k], 16) + shr(as * sp.pull[k], 16);
      f[k] = push; f[NB + k] = pull; f[2 * NB + k] = push; f[3 * NB + k] = pull;
    }
    this.slow += shr((shr(envP * M.pulseAbs, 16) + shr(envS * M.sineAbs, 16) - this.slow) * M.aSlow, 16);
    f[4 * NB] = f[4 * NB + 1] = this.slow;
    return { n, f, pulses: here, hum: cov > 0, endTick: b };
  }
}

/**
 * She listens. expected: the symbols she expects (from her own key), or null to just listen.
 * Her decision:
 *   every IPI that matches what she expects lets the song pathway's activity raise her receptivity R;
 *   every IPI that doesn't is a wrong note: she kicks (R drops), and after more than MAX_WRONG she rejects.
 *   She accepts at the end if she has had at most MAX_WRONG wrong notes and R has reached THETA.
 * advance(heardSoFar, final) runs her brain as far as the song heard so far allows and returns the new states.
 */
// THETA: a true song ends near R = 1.2-1.35 M (tools/test-female.mjs); half the lowest seen, so a true song always clears it
export const LISTEN = { KD: 2, KH: 1, KICK: 6000, MAX_WRONG: 4, THETA: 600000 };
export class Listener {
  constructor(brain, expected, M, P = LISTEN) { this.brain = brain; this.expected = expected; this.M = M; this.P = P; brain.reset();
    this.framer = new Framer(M); this.R = 0; this.wrong = 0; this.matched = 0; this.cur = null; this.verdict = null; this.done = false; this.last = null; }
  advance(heard, final = false) {
    const M = this.M, P = this.P, out = [];
    if (this.done) return out;
    const full = heard.slice(); while (full.length < TRAINS * PER_TRAIN) full.push(0);
    const sch = schedule(full, M);
    // how far the heard part of the song reaches: the last pulse whose IPI is known, plus the pulse envelope
    let safe = sch.end;
    if (!final) { let lastKnown = 0; for (const p of sch.pulses) if (p.k < heard.length) lastKnown = p.t; else break;
      safe = heard.length >= TRAINS * PER_TRAIN ? sch.end : lastKnown - M.envOff; }
    while (!this.done && (this.framer.n + 1) * M.dtTicks <= safe) {
      const fr = this.framer.next(sch); this.brain.input(fr.f); this.brain.step(); const d = this.brain.drive();
      for (const p of fr.pulses) {
        if (p.k < 0) { this.cur = 'anchor'; continue; }
        const ok = !this.expected || heard[p.k] === this.expected[p.k]; this.cur = ok ? 'match' : 'wrong';
        if (ok) this.matched++; else { this.wrong++; this.R = Math.max(0, this.R - P.KICK); }
        if (this.wrong > P.MAX_WRONG && !this.verdict) this.verdict = 'reject';
      }
      if (!this.verdict) { if (this.cur === 'match') this.R += P.KD * d; else if (fr.hum || this.cur === 'anchor') this.R += P.KH * d; }
      const st = { n: fr.n, t: fr.n * 0.005, drive: d, R: this.R, matched: this.matched, wrong: this.wrong, cur: this.cur, hum: fr.hum, pulses: fr.pulses, verdict: this.verdict };
      out.push(st); this.last = st; if (this.onFrame) this.onFrame(st, this.brain);
      if (this.verdict) this.done = true;
    }
    if (final || (this.framer.n * M.dtTicks >= sch.end)) { this.done = true; if (!this.verdict && this.last) this.verdict = decide(this.last, P); if (this.last) this.last.verdict = this.verdict; }
    return out;
  }
}
/** the whole song at once (tests, and the male's prediction of her) */
export function* listen(brain, heard, expected, M, P = LISTEN) {
  const L = new Listener(brain, expected, M, P); const st = L.advance(heard, true); yield* st;
}
export function decide(last, P = LISTEN) { return last.verdict === 'reject' ? 'reject' : (last.wrong <= P.MAX_WRONG && last.R >= P.THETA ? 'accept' : 'reject'); }

// ------------------------------------------------------------------ on the air
export const AIR = { up: 8, pulseSigma: 0.0012, pulseAmp: 0.6, humAmp: 0.18 };
/** render a schedule for the phone's speaker (transposed up three octaves) */
export function renderAir(sch, M, fs = 48000) {
  const tick = M.song.tick, N = Math.ceil((sch.end * tick + 0.05) * fs), x = new Float32Array(N);
  const fp = M.song.pulseHz * AIR.up, fh = M.song.sineHz * AIR.up, sg = AIR.pulseSigma;
  for (const p of sch.pulses) { const tc = p.t * tick, a = Math.max(0, Math.floor((tc - 4 * sg) * fs)), b = Math.min(N, Math.ceil((tc + 4 * sg) * fs));
    for (let n = a; n < b; n++) { const t = n / fs - tc; x[n] += AIR.pulseAmp * Math.exp(-0.5 * (t / sg) ** 2) * Math.cos(2 * Math.PI * fp * t); } }
  for (const h of sch.hums) { const a = Math.floor(h.t0 * tick * fs), b = Math.floor(h.t1 * tick * fs), r = Math.round(0.01 * fs);
    for (let n = a; n < b; n++) { const e = Math.min(1, (n - a) / r, (b - n) / r); x[n] += AIR.humAmp * e * Math.sin(2 * Math.PI * fh * n / fs); } }
  return x;
}
/** render the true-pitch song (what she hears, played quietly on her phone as she listens) */
export function renderTrue(sch, M, fs = 48000) {
  const tick = M.song.tick, N = Math.ceil((sch.end * tick + 0.05) * fs), x = new Float32Array(N), sg = M.song.pulseSigma;
  for (const p of sch.pulses) { const tc = p.t * tick, a = Math.max(0, Math.floor((tc - 4 * sg) * fs)), b = Math.min(N, Math.ceil((tc + 4 * sg) * fs));
    for (let n = a; n < b; n++) { const t = n / fs - tc; x[n] += M.song.pulseAmp * Math.exp(-0.5 * (t / sg) ** 2) * Math.cos(2 * Math.PI * M.song.pulseHz * t); } }
  for (const h of sch.hums) { const a = Math.floor(h.t0 * tick * fs), b = Math.floor(h.t1 * tick * fs), r = Math.round(0.01 * fs);
    for (let n = a; n < b; n++) { const e = Math.min(1, (n - a) / r, (b - n) / r); x[n] += M.song.sineAmp * e * Math.sin(2 * Math.PI * M.song.sineHz * n / fs); } }
  return x;
}

/**
 * Streaming song detector for the microphone. Mixes the pulse carrier to baseband, smooths over ~1 ms, finds
 * pulse peaks (22 ms refractory, so echoes are ignored), groups them into trains (a gap over 80 ms ends a train)
 * and turns each train's IPIs into symbols. onSong({symbols, trains}) fires when four full trains have arrived.
 */
export class SongDetector {
  constructor(M, sampleRate, onSong, onPulse = () => {}) {
    this.M = M; this.fs = sampleRate; this.onSong = onSong; this.onPulse = onPulse;
    const f = M.song.pulseHz * AIR.up; this.w = 2 * Math.PI * f / sampleRate; this.ph = 0;
    this.wh = 2 * Math.PI * M.song.sineHz * AIR.up / sampleRate; this.phh = 0;   // the hum's band, to tell hums from pulses
    this.L = Math.max(4, Math.round(0.002 * sampleRate)); this.bi = new Float64Array(this.L); this.bq = new Float64Array(this.L); this.si = 0; this.sq = 0; this.k = 0;
    this.hi = new Float64Array(this.L); this.hq = new Float64Array(this.L); this.shi = 0; this.shq = 0; this.hum = 0;
    this.n = 0; this.floor = 1e-6; this.prev2 = 0; this.prev1 = 0; this.lastPeak = -1e9; this.peaks = []; this.trains = []; this.cur = [];
  }
  reset() { this.trains = []; this.cur = []; this.peaks = []; }
  push(x) {
    for (let i = 0; i < x.length; i++) {
      const v = x[i], ci = v * Math.cos(this.ph), cq = -v * Math.sin(this.ph); this.ph += this.w; if (this.ph > 6.283185307179586) this.ph -= 6.283185307179586;
      const hi = v * Math.cos(this.phh), hq = -v * Math.sin(this.phh); this.phh += this.wh; if (this.phh > 6.283185307179586) this.phh -= 6.283185307179586;
      this.si += ci - this.bi[this.k]; this.sq += cq - this.bq[this.k]; this.bi[this.k] = ci; this.bq[this.k] = cq;
      this.shi += hi - this.hi[this.k]; this.shq += hq - this.hq[this.k]; this.hi[this.k] = hi; this.hq[this.k] = hq; this.k = (this.k + 1) % this.L;
      const e = (this.si * this.si + this.sq * this.sq) / (this.L * this.L), eh = (this.shi * this.shi + this.shq * this.shq) / (this.L * this.L);
      this.hum = eh;
      this.floor = e < this.floor ? this.floor * 0.999 + e * 0.001 : this.floor * 0.99999 + e * 0.00001;
      const n = this.n++;
      // a local maximum well above the floor, outside the refractory window
      if (this.prev1 > this.prev2 && this.prev1 >= e && this.prev1 > 40 * this.floor && this.prev1 > 1e-7 && this.prev1 > 4 * this.hum && (n - 1 - this.lastPeak) > 0.022 * this.fs) {
        const den = this.prev2 - 2 * this.prev1 + e, off = den !== 0 ? 0.5 * (this.prev2 - e) / den : 0;
        this._peak((n - 1 + off) / this.fs, this.prev1); this.lastPeak = n - 1;
      }
      this.prev2 = this.prev1; this.prev1 = e;
      if (this.cur.length && n / this.fs - this.cur[this.cur.length - 1] > 0.08) this._endTrain();
    }
  }
  _peak(t, e) {
    // keep the stronger of two peaks closer than the refractory window (the first can be an echo's shoulder)
    this.cur.push(t); this.onPulse({ t, n: this.cur.length, train: this.trains.length });
  }
  _endTrain() {
    const c = this.cur; this.cur = [];
    if (c.length < 6) return;                         // stray clicks, not a train
    const ipiMs = this.M.song.ipiTicks.map(k => k * this.M.song.tick), syms = [];
    for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1]; let best = 0; for (let s = 1; s < 4; s++) if (Math.abs(d - ipiMs[s]) < Math.abs(d - ipiMs[best])) best = s; syms.push(best); }
    while (syms.length < PER_TRAIN) syms.push(0); syms.length = PER_TRAIN;
    this.trains.push(syms); if (this.onTrain) this.onTrain(syms, this.trains.length);
    if (this.trains.length === TRAINS) { const symbols = this.trains.flat(); const tr = this.trains; this.trains = []; this.onSong({ symbols, trains: tr }); }
  }
  flush() { if (this.cur.length) this._endTrain(); }
}
