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
  tStart: number; // camera time of first supporting detection (s)
  tEnd: number; // camera time of last supporting detection (s)
}

// ---- Global camera-motion estimation ---------------------------------------
// Estimates the frame-to-frame translation of the WHOLE scene (handheld shake,
// small pans) from mean-subtracted luminance projection profiles: correlating
// the column sums gives dx, the row sums give dy, each refined to sub-pixel by
// parabolic interpolation. O(n + w·M) — cheap enough to run every frame.
export interface FrameShift {
  dx: number; // px the scene moved since the previous frame (+ = right)
  dy: number;
}

let scratchW = -1;
let scratchH = -1;
let sColCur = new Float64Array(0);
let sColPrev = new Float64Array(0);
let sRowCur = new Float64Array(0);
let sRowPrev = new Float64Array(0);

function best1DShift(a: Float64Array, b: Float64Array, M: number): number {
  // d minimizing mean |a[i] − b[i−d]| over the overlap, sub-pixel refined.
  const S = new Float64Array(2 * M + 1);
  let bestD = 0;
  let bestS = Infinity;
  for (let d = -M; d <= M; d++) {
    let s = 0;
    let c = 0;
    const i0 = Math.max(0, d);
    const i1 = Math.min(a.length, a.length + d);
    for (let i = i0; i < i1; i++) {
      s += Math.abs(a[i] - b[i - d]);
      c++;
    }
    s = c ? s / c : Infinity;
    S[d + M] = s;
    if (s < bestS) { bestS = s; bestD = d; }
  }
  const k = bestD + M;
  if (k > 0 && k < S.length - 1) {
    const den = S[k - 1] - 2 * S[k] + S[k + 1];
    if (den > 1e-9) bestD += (0.5 * (S[k - 1] - S[k + 1])) / den;
  }
  return bestD;
}

export function estimateShift(
  cur: Uint8ClampedArray,
  prev: Uint8ClampedArray,
  w: number,
  h: number,
): FrameShift {
  if (w !== scratchW || h !== scratchH) {
    scratchW = w;
    scratchH = h;
    sColCur = new Float64Array(w);
    sColPrev = new Float64Array(w);
    sRowCur = new Float64Array(h);
    sRowPrev = new Float64Array(h);
  } else {
    sColCur.fill(0);
    sColPrev.fill(0);
    sRowCur.fill(0);
    sRowPrev.fill(0);
  }
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const lc = cur[i] + cur[i + 1] + cur[i + 2];
      const lp = prev[i] + prev[i + 1] + prev[i + 2];
      sColCur[x] += lc;
      sColPrev[x] += lp;
      sRowCur[y] += lc;
      sRowPrev[y] += lp;
    }
  }
  // Mean-subtract so a global exposure/AGC change doesn't read as motion.
  const demean = (arr: Float64Array) => {
    let m = 0;
    for (let i = 0; i < arr.length; i++) m += arr[i];
    m /= arr.length || 1;
    for (let i = 0; i < arr.length; i++) arr[i] -= m;
  };
  demean(sColCur);
  demean(sColPrev);
  demean(sRowCur);
  demean(sRowPrev);
  return {
    dx: best1DShift(sColCur, sColPrev, Math.max(4, Math.round(w * 0.05))),
    dy: best1DShift(sRowCur, sRowPrev, Math.max(4, Math.round(h * 0.05))),
  };
}

// ---- Motion blob detection (frame differencing) ---------------------------
// Returns ALL small, compact moving regions (not just one) so the RANSAC stage
// downstream has the full candidate set to choose the real ball from. The ball
// is NOT identified here — color/size alone can't separate it from noise; only
// the trajectory fit can. Sorted by "ball-likeness" and capped.
// Scratch buffers reused across calls — this runs per camera frame (30-60/s)
// and re-allocating ~1MB each time causes measurable GC churn on phones.
let scratchN = -1;
let sDiff = new Uint16Array(0);
let sMask = new Uint8Array(0);
let sSeen = new Uint8Array(0);
let sStack = new Int32Array(0);

export interface FrameAnalysis {
  blobs: RawBlob[];
  motion: number; // moving-pixel fraction after shift compensation (0 if frame unusable)
  shift: FrameShift; // estimated global camera motion this frame (px)
}

// Full per-frame analysis: estimate global camera motion, difference the frame
// against the SHIFTED previous frame (so handheld wobble doesn't light up the
// whole scene and drown the ball), then segment ball-candidate blobs.
export function analyzeFrame(
  cur: Uint8ClampedArray,
  prev: Uint8ClampedArray,
  w: number,
  h: number,
  cap = 24,
): FrameAnalysis {
  const n = w * h;
  if (n !== scratchN) {
    scratchN = n;
    sDiff = new Uint16Array(n);
    sMask = new Uint8Array(n);
    sSeen = new Uint8Array(n);
    sStack = new Int32Array(n);
  } else {
    sMask.fill(0);
    sSeen.fill(0);
  }
  const shift = estimateShift(cur, prev, w, h);
  const sx = Math.round(shift.dx);
  const sy = Math.round(shift.dy);

  const diff = sDiff;
  let dSum = 0;
  if (sx === 0 && sy === 0) {
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const d =
        Math.abs(cur[i] - prev[i]) +
        Math.abs(cur[i + 1] - prev[i + 1]) +
        Math.abs(cur[i + 2] - prev[i + 2]);
      diff[p] = d;
      dSum += d;
    }
  } else {
    // Compensated diff: compare each pixel with where the scene WAS.
    diff.fill(0);
    const xA = Math.max(0, sx);
    const xB = Math.min(w, w + sx);
    const yA = Math.max(0, sy);
    const yB = Math.min(h, h + sy);
    for (let y = yA; y < yB; y++) {
      let p = y * w + xA;
      let q = (y - sy) * w + (xA - sx);
      for (let x = xA; x < xB; x++, p++, q++) {
        const i = p * 4;
        const j = q * 4;
        const d =
          Math.abs(cur[i] - prev[j]) +
          Math.abs(cur[i + 1] - prev[j + 1]) +
          Math.abs(cur[i + 2] - prev[j + 2]);
        diff[p] = d;
        dSum += d;
      }
    }
  }
  // Adaptive threshold on the frame's own noise floor: a quiet tripod scene
  // (mean diff ~1-4) drops to ~26 so a faint distant ball still registers,
  // while residual shake raises it toward 64 instead of flooding the mask
  // with noise blobs.
  const thr = Math.min(64, Math.max(26, 12 + (dSum / n) * 5));
  const mask = sMask;
  let on = 0;
  for (let p = 0; p < n; p++) {
    if (diff[p] > thr) {
      mask[p] = 1;
      on++;
    }
  }
  // Global change even after compensation (exposure/AGC shift, rotation, a
  // hard knock): nothing useful can be segmented — skip rather than emit
  // garbage, and report zero motion so burst triggers don't fire on it.
  if (on > n * 0.15) return { blobs: [], motion: 0, shift };

  const BALL_MIN = 2;
  const BALL_MAX = Math.max(150, (n / 128) | 0); // scales with detection resolution
  const blobs: (RawBlob & { score: number })[] = [];
  const stack = sStack;
  const seen = sSeen;
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
      // 8-connectivity: a fast ball leaves a thin diagonal motion streak that
      // 4-connectivity would fragment below BALL_MIN.
      const x0 = px > 0 ? -1 : 0;
      const x1 = px < w - 1 ? 1 : 0;
      const y0 = py > 0 ? -1 : 0;
      const y1 = py < h - 1 ? 1 : 0;
      for (let dy = y0; dy <= y1; dy++) {
        for (let dx = x0; dx <= x1; dx++) {
          const q = p + dy * w + dx;
          if (mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
        }
      }
    }
    if (count < BALL_MIN || count > BALL_MAX) continue;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const aspect = bw / bh;
    if (aspect < 0.18 || aspect > 5.5) continue;
    const fill = count / (bw * bh);
    if (fill < 0.22) continue;
    blobs.push({
      x: sumX / count / w,
      y: sumY / count / h,
      size: count,
      score: fill - count / (BALL_MAX * 2), // small & compact preferred
    });
  }
  blobs.sort((a, b) => b.score - a.score);
  return {
    blobs: blobs.slice(0, cap).map(({ x, y, size }) => ({ x, y, size })),
    motion: on / n,
    shift,
  };
}

// Back-compat convenience: blobs only (shift compensation still applied).
export function findMovingBlobs(
  cur: Uint8ClampedArray,
  prev: Uint8ClampedArray,
  w: number,
  h: number,
  cap = 24,
): RawBlob[] {
  return analyzeFrame(cur, prev, w, h, cap).blobs;
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
  maxRms?: number; // max model-fit residual (normalized)
  samples?: number; // output polyline resolution
  seed?: number;
}

// Recover the projectile trajectory from a noisy detection buffer, or null if
// no physically-valid flight is present (→ draw nothing).
export function extractTrajectory(
  dets: Detection[],
  opts: ExtractOptions = {},
): Trajectory | null {
  // Defaults tuned for a behind-the-ball phone camera: the ball is tiny, is
  // often lost against the sky for several consecutive frames (maxGap), moves
  // few on-screen pixels while flying away (minDisp), and its apparent gravity
  // curvature can be ~0 or slightly negative early in flight (gravityTol).
  const thresh = opts.thresh ?? 0.032;
  const iters = opts.iters ?? 600;
  const minInliers = opts.minInliers ?? 5;
  const minSpan = opts.minSpan ?? 0.14;
  const maxGap = opts.maxGap ?? 0.28;
  const minDisp = opts.minDisp ?? 0.06;
  const gravityTol = opts.gravityTol ?? 0.06;
  const maxRms = opts.maxRms ?? 0.009;
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

  // Per-frame spatial hash (cell = thresh) so a model only tests detections
  // that could actually be inliers. inliersFor runs ~600×(RANSAC) + 6× per
  // refine pass; scanning every blob at every frame time made a busy 60fps
  // scene cost >100ms per call, which stalled the live capture loop. Cells are
  // exact: any point within thresh of (px,py) falls in the 3×3 neighbourhood.
  const KEY = 4096;
  const cellKey = (gx: number, gy: number) => (gy + 512) * KEY + (gx + 512);
  const grids: Map<number, Detection[]>[] = times.map((t) => {
    const g = new Map<number, Detection[]>();
    for (const d of byTime.get(t)!) {
      const k = cellKey(Math.floor(d.x / thresh), Math.floor(d.y / thresh));
      const c = g.get(k);
      if (c) c.push(d);
      else g.set(k, [d]);
    }
    return g;
  });
  const thresh2 = thresh * thresh;

  // Count inliers for a candidate model (one best detection per frame time).
  const inliersFor = (cx: Quad, cy: Quad) => {
    const chosen: Detection[] = [];
    for (let ti = 0; ti < times.length; ti++) {
      const t = times[ti];
      const px = evalQuad(cx, t);
      const py = evalQuad(cy, t);
      // A wildly extrapolating model can't match anything in frame — skip it
      // before hashing (also keeps cell indices inside the key range).
      if (!(px > -8 && px < 8 && py > -8 && py < 8)) continue;
      const grid = grids[ti];
      const gx = Math.floor(px / thresh);
      const gy = Math.floor(py / thresh);
      let best: Detection | null = null;
      let bd = thresh2;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cell = grid.get(cellKey(gx + dx, gy + dy));
          if (!cell) continue;
          for (const d of cell) {
            const ex = d.x - px;
            const ey = d.y - py;
            const dist2 = ex * ex + ey * ey;
            if (dist2 < bd) { bd = dist2; best = d; }
          }
        }
      }
      if (best) chosen.push(best);
    }
    return chosen;
  };

  // Refine a candidate support set (iterative refit + re-collect) and run the
  // physics gates. Returns the validated trajectory, or null.
  const refineAndValidate = (seedSet: Detection[]): Trajectory | null => {
    let bestSet = seedSet;
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

    // Physics gate 4: fit tightness. A real ball tracks its parabola to within
    // detection jitter; a chain aliased across a band of ambient noise (net,
    // leaves) hits whatever point is nearest each frame, leaving residuals
    // near the inlier threshold. Reject sloppy fits.
    if (rms > maxRms) return null;

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

    return { pts, maxDev, span, inliers: bestSet.length, rms, launch, landing, tStart, tEnd };
  };

  // RANSAC over ALL candidate chains — not just the single largest one. The
  // largest-support chain is usually NOT the ball: the golfer's follow-through,
  // a walking person or a swaying net produces far more detections than a tiny
  // ball. Keeping only the biggest chain meant one gated-out noise chain hid a
  // perfectly valid flight behind it. Instead, collect the distinct top
  // candidates and return the best one that PASSES the physics gates.
  // Weighted pick favouring SMALL blobs: the ball is by definition one of the
  // smallest moving objects in frame, while people/club/branches are large.
  // Without this bias the minimal sample almost never lands on 3 ball points
  // when background motion outnumbers the ball 5–10×.
  const pickSmall = (arr: Detection[]): Detection => {
    if (arr.length === 1) return arr[0];
    let tot = 0;
    for (const d of arr) tot += 1 / (d.size * d.size + 1);
    let r = rng() * tot;
    for (const d of arr) {
      r -= 1 / (d.size * d.size + 1);
      if (r <= 0) return d;
    }
    return arr[arr.length - 1];
  };

  const candidates: Detection[][] = [];
  const seenSig = new Set<string>();
  for (let it = 0; it < iters; it++) {
    // Pick 3 distinct, time-spread frames for a minimal fit.
    const i0 = (rng() * times.length) | 0;
    const i1 = (rng() * times.length) | 0;
    const i2 = (rng() * times.length) | 0;
    if (i0 === i1 || i1 === i2 || i0 === i2) continue;
    const t0 = times[i0], t1 = times[i1], t2 = times[i2];
    const s0 = pickSmall(byTime.get(t0)!);
    const s1 = pickSmall(byTime.get(t1)!);
    const s2 = pickSmall(byTime.get(t2)!);
    const cx = fitQuadratic([s0, s1, s2].map((d) => ({ t: d.t, v: d.x })));
    const cy = fitQuadratic([s0, s1, s2].map((d) => ({ t: d.t, v: d.y })));
    if (!cx || !cy) continue;
    const set = inliersFor(cx, cy);
    if (set.length < minInliers) continue;
    // Coarse spatial signature (start/mid/end cells) so near-identical chains
    // collapse into one candidate instead of crowding out distinct ones.
    const mid = set[set.length >> 1];
    const last = set[set.length - 1];
    const cell = (v: number) => Math.round(v * 25);
    const sig = `${cell(set[0].x)},${cell(set[0].y)}|${cell(mid.x)},${cell(mid.y)}|${cell(last.x)},${cell(last.y)}`;
    if (seenSig.has(sig)) continue;
    seenSig.add(sig);
    candidates.push(set);
  }
  if (!candidates.length) return null;

  candidates.sort((a, b) => b.length - a.length);
  let best: Trajectory | null = null;
  for (const cand of candidates.slice(0, 64)) {
    const traj = refineAndValidate(cand);
    if (
      traj &&
      (!best ||
        traj.inliers > best.inliers ||
        (traj.inliers === best.inliers && traj.rms < best.rms))
    ) {
      best = traj;
    }
  }
  return best;
}
