// Ball-flight trajectory extraction & physics validation for the AR tracer.
//
// Philosophy: do NOT draw a line while the ball is in the air. Instead, buffer
// every moving-blob candidate (ball, wind-shaken net, trees, other people,
// shadows…) across the flight, then — once the shot window has elapsed — look
// BACK over the buffer and recover the single chain of detections that obeys
// projectile physics, discarding everything else as noise. Only a validated
// trajectory is ever rendered. This is the "verify the past from the future"
// approach: a short delay buys a clean, false-positive-free tracer.
//
// All coordinates are normalized to [0,1] (resolution-independent). Time is in
// seconds relative to the impact (t0).

export interface RawBlob {
  x: number; // normalized centroid
  y: number;
  size: number; // pixel area
}

export interface Detection extends RawBlob {
  t: number; // seconds (camera timestamp)
}

export interface Trajectory {
  pts: { x: number; y: number }[]; // smooth, model-sampled polyline (launch→landing)
  maxDev: number; // signed horizontal curvature (for shape classification)
  span: number; // flight duration covered (s)
  inliers: number; // supporting detections
  rms: number; // model fit residual (normalized px)
  launch: { x: number; y: number };
  landing: { x: number; y: number };
}

// ---- Motion blob detection (frame differencing) ---------------------------
// Returns ALL small, compact moving regions (not just one) so the RANSAC stage
// downstream has the full candidate set to choose the real ball from. The ball
// is NOT identified here — color/size alone can't separate it from noise; only
// the trajectory fit can. Sorted by "ball-likeness" and capped.
export function findMovingBlobs(
  cur: Uint8ClampedArray,
  prev: Uint8ClampedArray,
  w: number,
  h: number,
  cap = 16,
): RawBlob[] {
  const n = w * h;
  const mask = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const d =
      Math.abs(cur[i] - prev[i]) +
      Math.abs(cur[i + 1] - prev[i + 1]) +
      Math.abs(cur[i + 2] - prev[i + 2]);
    if (d > 60) mask[p] = 1;
  }

  const BALL_MIN = 2;
  const BALL_MAX = 150;
  const blobs: (RawBlob & { score: number })[] = [];
  const stack = new Int32Array(n);
  const seen = new Uint8Array(n);
  for (let start = 0; start < n; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let count = 0,
      sumX = 0,
      sumY = 0,
      minX = w,
      maxX = 0,
      minY = h,
      maxY = 0;
    while (sp > 0) {
      const p = stack[--sp];
      const px = p % w;
      const py = (p / w) | 0;
      count++;
      sumX += px;
      sumY += py;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      if (px > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (px < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (py > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (py < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    if (count < BALL_MIN || count > BALL_MAX) continue;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const aspect = bw / bh;
    if (aspect < 0.25 || aspect > 4) continue;
    const fill = count / (bw * bh);
    if (fill < 0.3) continue;
    blobs.push({
      x: sumX / count / w,
      y: sumY / count / h,
      size: count,
      score: fill - count / (BALL_MAX * 2), // small & compact preferred
    });
  }
  blobs.sort((a, b) => b.score - a.score);
  return blobs.slice(0, cap).map(({ x, y, size }) => ({ x, y, size }));
}

// ---- Quadratic (constant-acceleration) least squares ----------------------
// A projectile under gravity, projected to the image plane, is well-modelled by
// a quadratic in time on each axis: p(t) = a0 + a1·t + a2·t². Fitting both axes
// and checking the vertical curvature sign gives a strong physics gate.
type Quad = [number, number, number];

function solve3(A: number[][], b: number[]): Quad | null {
  // Cramer's rule on a 3x3 system.
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  if (Math.abs(D) < 1e-12) return null;
  const col = (m: number[][], c: number, v: number[]) =>
    m.map((row, i) => row.map((val, j) => (j === c ? v[i] : val)));
  return [det(col(A, 0, b)) / D, det(col(A, 1, b)) / D, det(col(A, 2, b)) / D];
}

export function fitQuadratic(pts: { t: number; v: number }[]): Quad | null {
  let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0;
  for (const { t, v } of pts) {
    const t2 = t * t;
    S0 += 1; S1 += t; S2 += t2; S3 += t2 * t; S4 += t2 * t2;
    T0 += v; T1 += v * t; T2 += v * t2;
  }
  return solve3([[S0, S1, S2], [S1, S2, S3], [S2, S3, S4]], [T0, T1, T2]);
}

const evalQuad = (c: Quad, t: number) => c[0] + c[1] * t + c[2] * t * t;

// Deterministic RNG so extraction (and its tests) are reproducible.
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export interface ExtractOptions {
  thresh?: number; // inlier distance (normalized)
  iters?: number; // RANSAC iterations
  minInliers?: number;
  minSpan?: number; // s
  maxGap?: number; // s — largest allowed hole between consecutive inliers
  minDisp?: number; // normalized path length
  gravityTol?: number; // allowed negative vertical curvature
  samples?: number; // output polyline resolution
  seed?: number;
}

// Recover the projectile trajectory from a noisy detection buffer, or null if
// no physically-valid flight is present (→ draw nothing).
export function extractTrajectory(
  dets: Detection[],
  opts: ExtractOptions = {},
): Trajectory | null {
  const thresh = opts.thresh ?? 0.028;
  const iters = opts.iters ?? 260;
  const minInliers = opts.minInliers ?? 6;
  const minSpan = opts.minSpan ?? 0.16;
  const maxGap = opts.maxGap ?? 0.13;
  const minDisp = opts.minDisp ?? 0.13;
  const gravityTol = opts.gravityTol ?? 0.0;
  const sampleN = opts.samples ?? 48;
  const rng = lcg(opts.seed ?? 0x9e3779b9);

  if (dets.length < minInliers) return null;

  // Group detections by frame time so a model gets at most one inlier per frame.
  const byTime = new Map<number, Detection[]>();
  for (const d of dets) {
    const g = byTime.get(d.t);
    if (g) g.push(d);
    else byTime.set(d.t, [d]);
  }
  const times = [...byTime.keys()].sort((a, b) => a - b);
  if (times.length < 3) return null;

  // Count inliers for a candidate model (one best detection per frame time).
  const inliersFor = (cx: Quad, cy: Quad) => {
    const chosen: Detection[] = [];
    for (const t of times) {
      const px = evalQuad(cx, t);
      const py = evalQuad(cy, t);
      let best: Detection | null = null;
      let bd = thresh;
      for (const d of byTime.get(t)!) {
        const dist = Math.hypot(d.x - px, d.y - py);
        if (dist < bd) { bd = dist; best = d; }
      }
      if (best) chosen.push(best);
    }
    return chosen;
  };

  let bestSet: Detection[] = [];
  for (let it = 0; it < iters; it++) {
    // Pick 3 distinct, time-spread frames for a minimal fit.
    const i0 = (rng() * times.length) | 0;
    const i1 = (rng() * times.length) | 0;
    const i2 = (rng() * times.length) | 0;
    if (i0 === i1 || i1 === i2 || i0 === i2) continue;
    const t0 = times[i0], t1 = times[i1], t2 = times[i2];
    const s0 = byTime.get(t0)![(rng() * byTime.get(t0)!.length) | 0];
    const s1 = byTime.get(t1)![(rng() * byTime.get(t1)!.length) | 0];
    const s2 = byTime.get(t2)![(rng() * byTime.get(t2)!.length) | 0];
    const cx = fitQuadratic([s0, s1, s2].map((d) => ({ t: d.t, v: d.x })));
    const cy = fitQuadratic([s0, s1, s2].map((d) => ({ t: d.t, v: d.y })));
    if (!cx || !cy) continue;
    const set = inliersFor(cx, cy);
    if (set.length > bestSet.length) bestSet = set;
  }

  if (bestSet.length < minInliers) return null;

  // Iteratively refit by least squares over the inliers and re-collect until
  // the support set stops growing. This extends the model to the full flight
  // (a single minimal sample rarely spans launch→landing on its own).
  let cx = fitQuadratic(bestSet.map((d) => ({ t: d.t, v: d.x })));
  let cy = fitQuadratic(bestSet.map((d) => ({ t: d.t, v: d.y })));
  if (!cx || !cy) return null;
  for (let pass = 0; pass < 6; pass++) {
    const set = inliersFor(cx, cy);
    if (set.length < minInliers) return null;
    const nx = fitQuadratic(set.map((d) => ({ t: d.t, v: d.x })));
    const ny = fitQuadratic(set.map((d) => ({ t: d.t, v: d.y })));
    if (!nx || !ny) break;
    const grew = set.length > bestSet.length;
    bestSet = set;
    cx = nx;
    cy = ny;
    if (!grew) break;
  }

  bestSet.sort((a, b) => a.t - b.t);
  const tStart = bestSet[0].t;
  const tEnd = bestSet[bestSet.length - 1].t;
  const span = tEnd - tStart;
  if (span < minSpan) return null;

  // Physics gate 1: gravity. In screen space (y down), a real flight curves
  // downward over time → positive vertical curvature. Reject concave-up-in-air
  // (i.e. physically impossible) noise chains.
  if (cy[2] < -gravityTol) return null;

  // Physics gate 2: no large temporal holes (a real flight is continuous).
  for (let i = 1; i < bestSet.length; i++) {
    if (bestSet[i].t - bestSet[i - 1].t > maxGap) return null;
  }

  // Residual RMS of the fit.
  let se = 0;
  for (const d of bestSet) {
    const ex = evalQuad(cx, d.t) - d.x;
    const ey = evalQuad(cy, d.t) - d.y;
    se += ex * ex + ey * ey;
  }
  const rms = Math.sqrt(se / bestSet.length);

  // Sample the smooth model launch→landing.
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= sampleN; i++) {
    const t = tStart + (span * i) / sampleN;
    pts.push({ x: evalQuad(cx, t), y: evalQuad(cy, t) });
  }
  const launch = pts[0];
  const landing = pts[pts.length - 1];

  // Physics gate 3: the ball must actually travel.
  let pathLen = 0;
  for (let i = 1; i < pts.length; i++) {
    pathLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  if (pathLen < minDisp) return null;

  // Signed horizontal curvature: deviation of the arc from the launch→landing
  // chord (used to classify draw/fade/slice/hook). pts are uniform in time, so
  // parameterise the chord by sample fraction (NOT by x, which is degenerate).
  let maxDev = 0;
  for (let i = 0; i <= sampleN; i++) {
    const u = i / sampleN;
    const lineX = launch.x + (landing.x - launch.x) * u;
    const dev = pts[i].x - lineX;
    if (Math.abs(dev) > Math.abs(maxDev)) maxDev = dev;
  }

  return { pts, maxDev, span, inliers: bestSet.length, rms, launch, landing };
}
