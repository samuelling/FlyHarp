// FlyHarp engine: the trained flyvis optic-lobe network (Lappalainen et al. 2024) on a 721-column hex eye.
// tau dV/dt = -V + bias + sum_j w_ij relu(V_j) + input   (input = luminance to R1-R8)
(function (root) {
  class FlyEngine {
    constructor(model) {
      this.m = model;
      const types = model.types, nT = types.length, cols = model.columns, nC = cols.length;
      this.nT = nT; this.nC = nC; this.N = nT * nC;
      this.types = types;
      const colIdx = new Map(cols.map(([u, v], i) => [u + ',' + v, i]));
      this.u = Int32Array.from(cols, c => c[0]); this.v = Int32Array.from(cols, c => c[1]);
      // pixel coords (flyvis hex_to_pixel, default mode), normalised to unit neighbour spacing
      const s3 = Math.sqrt(3);
      this.x = Float32Array.from(cols, ([u, v]) => 1.5 * v / s3);
      this.y = Float32Array.from(cols, ([u, v]) => -(u + v / 2));
      // node ids: most types tile all columns; a few (Lawf1/2) exist only in some
      this.nodeOf = []; this.nodeType = []; this.nodeCol = [];
      let id = 0;
      for (let t = 0; t < nT; t++) {
        const arr = new Int32Array(nC).fill(-1);
        const cl = (model.sparse_types && model.sparse_types[types[t]]) || null;
        for (let k = 0; k < nC; k++) if (!cl || cl.includes(k)) { arr[k] = id++; this.nodeType.push(t); this.nodeCol.push(k); }
        this.nodeOf.push(arr);
      }
      this.N = id; this.nodeType = Int32Array.from(this.nodeType); this.nodeCol = Int32Array.from(this.nodeCol);
      const counts = new Int32Array(this.N);
      const tgtMinusSrc = model.offset_convention === 'target_minus_source';
      const lists = [];
      for (const [s, t, du, dv, w] of model.filters) {
        const tgtNodes = this.nodeOf[t], srcNodes = this.nodeOf[s];
        for (let k = 0; k < nC; k++) {
          if (tgtNodes[k] < 0) continue;
          const su = tgtMinusSrc ? this.u[k] - du : this.u[k] + du;
          const sv = tgtMinusSrc ? this.v[k] - dv : this.v[k] + dv;
          const j = colIdx.get(su + ',' + sv);
          if (j === undefined || srcNodes[j] < 0) continue;
          lists.push(tgtNodes[k], srcNodes[j], w);
          counts[tgtNodes[k]]++;
        }
      }
      const nE = lists.length / 3;
      this.rowptr = new Int32Array(this.N + 1);
      for (let i = 0; i < this.N; i++) this.rowptr[i + 1] = this.rowptr[i] + counts[i];
      this.src = new Int32Array(nE); this.w = new Float32Array(nE);
      const fill = this.rowptr.slice(0, this.N);
      for (let e = 0; e < nE; e++) {
        const tg = lists[3 * e], p = fill[tg]++;
        this.src[p] = lists[3 * e + 1]; this.w[p] = lists[3 * e + 2];
      }
      this.nE = nE;
      this.bias = new Float32Array(this.N); this.alpha = new Float32Array(this.N);
      this.dt = model.dt;
      for (let i = 0; i < this.N; i++) {
        const t = this.nodeType[i];
        this.bias[i] = model.bias[t]; this.alpha[i] = this.dt / Math.max(model.tau[t], this.dt);
      }
      this.isInput = new Uint8Array(this.N);
      const inT = new Set(model.input_types.map(x => types.indexOf(x)));
      for (let i = 0; i < this.N; i++) if (inT.has(this.nodeType[i])) this.isInput[i] = 1;
      this.V = new Float32Array(this.N); this.R = new Float32Array(this.N); this.D = new Float32Array(this.N);
      this.V0 = new Float32Array(this.N); this.D0 = new Float32Array(this.N);
      this.normG = null; this.normMask = null;
      this.central = new Int32Array(nT);
      const c0 = colIdx.get('0,0');
      for (let t = 0; t < nT; t++) this.central[t] = this.nodeOf[t][c0];
    }

    step(lum) {
      const N = this.N, nC = this.nC, V = this.V, R = this.R, D = this.D;
      for (let i = 0; i < N; i++) R[i] = V[i] > 0 ? V[i] : 0;
      const rp = this.rowptr, src = this.src, w = this.w;
      for (let i = 0; i < N; i++) {
        let acc = this.bias[i];
        for (let p = rp[i], q = rp[i + 1]; p < q; p++) acc += w[p] * R[src[p]];
        if (this.isInput[i]) acc += lum[this.nodeCol[i]];
        D[i] = acc;
      }
      // optional divisive normalization (js/gain.js): scale the drive's deviation from its grey value per column
      const g = this.normG;
      if (g) { const mk = this.normMask, D0 = this.D0, col = this.nodeCol; for (let i = 0; i < N; i++) if (mk[i]) D[i] = D0[i] + (D[i] - D0[i]) * g[col[i]]; }
      for (let i = 0; i < N; i++) V[i] += this.alpha[i] * (D[i] - V[i]);
    }

    // grey screen until steady state; also records the operating point V0
    settle(level = 0.5, seconds = 3) {
      const lum = new Float32Array(this.nC).fill(level);
      this.V.fill(0);
      const n = Math.round(seconds / this.dt), g = this.normG;
      this.normG = null;
      for (let s = 0; s < n; s++) this.step(lum);
      this.normG = g;
      this.V0.set(this.V); this.D0.set(this.D);
    }
  }
  if (typeof module !== 'undefined') module.exports = FlyEngine; else root.FlyEngine = FlyEngine;
})(this);
