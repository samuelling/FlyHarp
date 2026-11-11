// Where each of the model's 721 columns looks. Two geometries share the network (whose wiring is defined on
// the hex lattice, as the fly's is) and differ only in the eye:
//   lattice: the flyvis idealization, a flat regular hex grid (x anterior, y dorsal, unit neighbour spacing)
//   real:    the measured viewing directions of the right eye's ommatidia (micro-CT, Zhao et al. 2025),
//            shown in an azimuthal-equidistant projection about the centre column, in units of the median
//            interommatidial angle, so the two geometries have the same scale
// For each column: display/world position (DX, DY; +DY = up), a facet polygon, and the local Jacobian J from
// lattice displacements to world displacements (used to turn the motion read-out into a direction in the world).
const EyeGeom = (() => {
  const NB = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];   // hex neighbours in cyclic order
  function build(mode, X, Y, u, v, eyemap) {
    const n = X.length, DX = new Float32Array(n), DY = new Float32Array(n), real = new Uint8Array(n).fill(1);
    if (mode === 'real' && eyemap) {
      const rad = Math.PI / 180, dphi = eyemap.median_dphi_deg * rad;
      const vec = (az, el) => [Math.cos(el * rad) * Math.cos(az * rad), Math.cos(el * rad) * Math.sin(az * rad), Math.sin(el * rad)];
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const norm = a => { const l = Math.hypot(...a); return a.map(x => x / l); };
      const c = vec(...eyemap.centre);
      const up = norm([0 - c[2] * c[0], 0 - c[2] * c[1], 1 - c[2] * c[2]]);
      let ant = [1 - c[0] * c[0], -c[0] * c[1], -c[0] * c[2]];        // straight ahead, projected onto the tangent plane
      const k = dot(ant, up); ant = norm(ant.map((x, i) => x - k * up[i]));
      for (let i = 0; i < n; i++) {
        const [az, el, r] = eyemap.columns[i], d = vec(az, el), cs = Math.max(-1, Math.min(1, dot(d, c))), th = Math.acos(cs);
        const t = d.map((x, j) => x - cs * c[j]), tl = Math.hypot(...t) || 1;
        DX[i] = th * dot(t, ant) / tl / dphi; DY[i] = th * dot(t, up) / tl / dphi; real[i] = r;
      }
    } else { DX.set(X); DY.set(Y); }
    const at = new Map(); for (let i = 0; i < n; i++) at.set(u[i] + ',' + v[i], i);
    const nbrs = Array.from({length: n}, (_, i) => NB.map(([du, dv]) => at.get((u[i] + du) + ',' + (v[i] + dv))));
    // facets: vertices at the centroids of the triangles formed with consecutive neighbours (an exact tiling)
    const poly = new Float32Array(n * 12), J = new Float32Array(n * 4);
    let R = 0;
    for (let i = 0; i < n; i++) {
      R = Math.max(R, Math.hypot(DX[i], DY[i]));
      const nb = nbrs[i];
      // Jacobian: least squares over neighbours, lattice displacement (X, Y) -> world displacement (DX, DY)
      let sxx = 0, sxy = 0, syy = 0, ax = 0, ay = 0, bx = 0, by = 0;
      for (const j of nb) {
        if (j === undefined) continue;
        const lx = X[j] - X[i], ly = Y[j] - Y[i], wx = DX[j] - DX[i], wy = DY[j] - DY[i];
        sxx += lx * lx; sxy += lx * ly; syy += ly * ly; ax += wx * lx; ay += wx * ly; bx += wy * lx; by += wy * ly;
      }
      const det = sxx * syy - sxy * sxy;
      if (det > 1e-6) { J[4 * i] = (ax * syy - ay * sxy) / det; J[4 * i + 1] = (ay * sxx - ax * sxy) / det; J[4 * i + 2] = (bx * syy - by * sxy) / det; J[4 * i + 3] = (by * sxx - bx * sxy) / det; }
      else { J[4 * i] = 1; J[4 * i + 3] = 1; }
      for (let k = 0; k < 6; k++) {
        const a = nb[k], b = nb[(k + 1) % 6];
        let vx, vy;
        if (a !== undefined && b !== undefined) { vx = (DX[i] + DX[a] + DX[b]) / 3; vy = (DY[i] + DY[a] + DY[b]) / 3; }
        else {
          // missing neighbour (rim): place the vertex where the local lattice, mapped through J, puts it
          const [du1, dv1] = NB[k], [du2, dv2] = NB[(k + 1) % 6];
          const lx = (1.5 * (dv1 + dv2) / Math.sqrt(3)) / 3, ly = (-(du1 + dv1 / 2) - (du2 + dv2 / 2)) / 3;
          vx = DX[i] + J[4 * i] * lx + J[4 * i + 1] * ly; vy = DY[i] + J[4 * i + 2] * lx + J[4 * i + 3] * ly;
        }
        poly[12 * i + 2 * k] = DX[i] + (vx - DX[i]) * 0.94; poly[12 * i + 2 * k + 1] = DY[i] + (vy - DY[i]) * 0.94;
      }
    }
    return {mode, DX, DY, poly, J, R, real, nbrs};
  }
  return {build};
})();
