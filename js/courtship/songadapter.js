// Copied from FrogFood (samuelling/Frog-food, js/core/songadapter.js), unchanged apart from this header:
// the player's taps -> pulse/sine song (tap interval / 10 = inter-pulse interval).
// From the player's fingers to a fly's wing song.
//
// A real male sings pulse song with inter-pulse intervals (IPIs) of about 30-45 ms (D. melanogaster, ~35 ms at
// 25 C) and alternates it with sine song (a ~150 Hz hum). Nobody can tap at 28 Hz, so the player plays the
// song in "fly time": every tap sets the tempo of the wing's pulse generator, and the song runs ten times
// faster than the taps. Tap steadily every ~350 ms (about 170 per minute) and he sings 35 ms IPIs.
// Tap unevenly and his IPIs wobble. Stop tapping and the pulse train ends about one beat later. Hold the hum
// key for sine song. This is the command layer (pIP10 -> dPR1/vPR6/TN1A in js/core/male.js); the pattern
// generator underneath is the VNC's, so pulses come out evenly between taps.
//
// The flightless strain's wing defect: extra timing jitter on every pulse and a weaker wing. Song times are
// in seconds of the song clock (the audio clock in the browser); js/core/song.js's Framer wants 0.25 ms ticks.
import { gauss, mulberry32, clamp } from './rng.js';

export const SONG = { fold: 10, lookahead: 0.06, minIPI: 0.018, maxIPI: 0.09, defaultIPI: 0.04, tail: 1.15, trainGap: 0.1 };

export class SongAdapter {
  constructor(seed = 3) {
    this.rand = mulberry32(seed);
    this.pulses = [];          // committed {t, ipi, amp, train}
    this.hums = [];            // {t0, t1 (Infinity while held)}
    this.lastTap = -Infinity; this.lastIPI = SONG.defaultIPI; this.train = 0;
    this.plan = null;          // {next, ipi, until}
    this.humming = false;
    this.cond = { jitter: 0.003, amp: 0.75 };   // the wing defect, updated by the game from grooming and energy
    this.committedTo = -Infinity;
  }
  setCondition(c) { Object.assign(this.cond, c); }
  /** the pulse key, at song-clock time t */
  tap(t) {
    if (this.humming) this.humOff(t);
    const I = t - this.lastTap; this.lastTap = t;
    const fresh = I > 1.0 || I < 0.12;
    const ipi = fresh ? this.lastIPI : clamp(I / SONG.fold, SONG.minIPI, SONG.maxIPI);
    if (!fresh) this.lastIPI = ipi;
    const lastT = this.pulses.length ? this.pulses[this.pulses.length - 1].t : -Infinity;
    const continuing = lastT > t - SONG.trainGap;
    if (!continuing) this.train++;
    const next = continuing ? Math.max(this.plan ? this.plan.next : lastT + ipi, lastT + ipi * 0.9, this.committedTo + 1e-4) : Math.max(t + 0.004, this.committedTo + 1e-4);
    this.plan = { next, ipi, until: t + (fresh ? 0.36 : I) * SONG.tail };
  }
  humOn(t) { if (this.humming) return; this.humming = true; this.plan = null; this.hums.push({ t0: Math.max(t, this.committedTo), t1: Infinity }); }
  humOff(t) { if (!this.humming) return; this.humming = false; const h = this.hums[this.hums.length - 1]; h.t1 = Math.max(h.t0 + 0.01, t); }
  /** commit the song up to now + lookahead; returns the newly committed pulses (for the audio and the ear) */
  commit(now) {
    const horizon = now + SONG.lookahead, out = [];
    const P = this.plan;
    if (P) {
      while (P.next <= horizon && P.next <= P.until) {
        const j = gauss(this.rand) * this.cond.jitter;
        const p = { t: P.next, ipi: P.ipi, amp: this.cond.amp * (0.92 + 0.08 * this.rand()), train: this.train };
        this.pulses.push(p); out.push(p);
        P.next += Math.max(SONG.minIPI * 0.6, P.ipi + j);
      }
      if (P.next > P.until && now > P.until) this.plan = null;
    }
    this.committedTo = Math.max(this.committedTo, horizon);
    // forget old song
    if (this.pulses.length > 600) this.pulses.splice(0, this.pulses.length - 400);
    if (this.hums.length > 50) this.hums.splice(0, this.hums.length - 30);
    return out;
  }
  /** what a listener could measure over the last `win` seconds */
  features(now, win = 3) { return featuresOf(this.pulses, this.hums, now, this.humming, win); }
  /** the schedule for js/core/song.js's Framer, in 0.25 ms ticks relative to t0 */
  scheduleTicks(t0 = 0) {
    return { pulses: this.pulses.map(p => ({ t: Math.round((p.t - t0) * 4000) })), hums: this.hums.map(h => ({ t0: Math.round((h.t0 - t0) * 4000), t1: h.t1 === Infinity ? Infinity : Math.round((h.t1 - t0) * 4000) })), end: Infinity };
  }
}

/** song features of a pulse list and hum list (one singer's, or the air's mix of several) */
export function featuresOf(pulses, hums, now, humming = false, win = 3) {
  const t0 = now - win; let i0 = pulses.length; while (i0 > 0 && pulses[i0 - 1].t >= t0) i0--;
  const ps = []; for (let i = i0; i < pulses.length && pulses[i].t <= now; i++) ps.push(pulses[i]);
  const ipis = [];
  for (let i = 1; i < ps.length; i++) { const d = ps[i].t - ps[i - 1].t; if (d < SONG.trainGap) ipis.push(d); }
  const mean = ipis.length ? ipis.reduce((a, b) => a + b, 0) / ipis.length : 0;
  const sd = ipis.length > 1 ? Math.sqrt(ipis.reduce((a, b) => a + (b - mean) ** 2, 0) / (ipis.length - 1)) : 0;
  let sine = 0; for (const h of hums) { const a = Math.max(h.t0, t0), b = Math.min(h.t1, now); if (b > a) sine += b - a; }
  const pulseTime = ipis.reduce((a, b) => a + b, 0);
  const last = ps.length ? now - ps[ps.length - 1].t : Infinity;
  const recent = []; for (let i = Math.max(1, ps.length - 16); i < ps.length; i++) { const d = ps[i].t - ps[i - 1].t; if (d < SONG.trainGap) recent.push(d); }
  const rmean = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  return {
    ipiMean: mean, ipiCV: mean ? sd / mean : 0, nIPI: ipis.length, recentIPI: rmean,
    pulseFrac: pulseTime / win, sineFrac: sine / win, songFrac: (pulseTime + sine) / win,
    sinceSong: humming ? 0 : last, humming, singing: humming || last < 0.12,
  };
}
