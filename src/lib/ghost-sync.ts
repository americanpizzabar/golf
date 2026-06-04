import { LM } from "./pose";

// High-precision ghost comparison helpers. Frames are compact flat arrays
// [x0,y0,x1,y1,...] for the 33 pose landmarks (see compactFrames). All math
// works on x,y only (no club / no depth), so "shaft horizontal" style events are
// approximated from the lead-hand trajectory — robust enough to time-align two
// swings so their key positions overlap.

export const EVENT_NAMES = [
  "アドレス",
  "テイクバック",
  "ハーフウェイバック",
  "トップ",
  "ハーフウェイダウン",
  "インパクト",
  "フォロー",
  "フィニッシュ",
] as const;

// Canonical phase (0..1) each event occupies on the shared, time-remapped axis.
// Both swings are warped so their detected events land on exactly these phases,
// making them move "in the same rhythm".
export const EVENT_PHASES = [0, 0.16, 0.31, 0.45, 0.57, 0.66, 0.82, 1] as const;

const leadWrist = (leftHanded: boolean) => (leftHanded ? LM.rWrist : LM.lWrist);
const X = (f: number[], i: number) => f[i * 2];
const Y = (f: number[], i: number) => f[i * 2 + 1];

// --- Camera angle auto-detection (Front vs Down-the-Line) ------------------
export type ViewAngle = "front" | "dtl";
export const ANGLE_LABEL: Record<ViewAngle, string> = { front: "正面ビュー", dtl: "後方ビュー(DTL)" };

// Shoulder width collapses when the golfer is side-on (DTL), while torso height
// stays similar — so shoulderWidth / torsoHeight cleanly separates the two.
export function angleRatio(f: number[]): number {
  const shW = Math.abs(X(f, LM.lShoulder) - X(f, LM.rShoulder));
  const torso =
    Math.abs((Y(f, LM.lShoulder) + Y(f, LM.rShoulder)) / 2 - (Y(f, LM.lHip) + Y(f, LM.rHip)) / 2) || 1e-3;
  return shW / torso;
}
export function angleOfFrame(f: number[]): ViewAngle {
  return angleRatio(f) > 0.85 ? "front" : "dtl";
}
// Vote across the address region (first few frames) for stability.
export function detectAngle(frames: number[][]): ViewAngle {
  const n = Math.min(frames.length, 6);
  let front = 0;
  for (let i = 0; i < n; i++) if (angleOfFrame(frames[i]) === "front") front++;
  return front * 2 >= n ? "front" : "dtl";
}

// Detect the 8 swing events, returned as fractional frame indices (increasing).
export function detectEvents(frames: number[][], leftHanded: boolean): number[] {
  const n = frames.length;
  if (n < 5) return EVENT_PHASES.map((p) => p * (n - 1));
  const w = leadWrist(leftHanded);
  const wx = (i: number) => X(frames[i], w);
  const wy = (i: number) => Y(frames[i], w);

  const spd: number[] = [0];
  for (let i = 1; i < n; i++) spd.push(Math.hypot(wx(i) - wx(i - 1), wy(i) - wy(i - 1)));

  // Impact = fastest hand frame (skip the first couple of frames).
  let impact = Math.max(2, Math.floor(n * 0.5));
  let sp = -1;
  for (let i = 2; i < n; i++) {
    if (spd[i] > sp) {
      sp = spd[i];
      impact = i;
    }
  }
  // Top = highest hands (min y) at/before impact.
  let top = 0;
  let miny = Infinity;
  for (let i = 0; i <= impact; i++) {
    if (wy(i) < miny) {
      miny = wy(i);
      top = i;
    }
  }
  if (top < 1) top = Math.max(1, Math.floor(impact * 0.55));

  const addrX = wx(0);
  const addrY = wy(0);
  // Takeaway = first frame the hands have clearly left address.
  let takeaway = Math.max(1, Math.round(top * 0.25));
  for (let i = 1; i <= top; i++) {
    if (Math.hypot(wx(i) - addrX, wy(i) - addrY) > 0.04) {
      takeaway = i;
      break;
    }
  }
  const finish = n - 1;

  // Fractional frame where lead-hand height crosses `target` within [lo,hi].
  const crossY = (lo: number, hi: number, target: number, fallback: number) => {
    for (let i = Math.floor(lo) + 1; i <= hi; i++) {
      const a = wy(i - 1);
      const b = wy(i);
      if ((a - target) * (b - target) <= 0 && a !== b) return i - 1 + (target - a) / (b - a);
    }
    return fallback;
  };
  const halfBack = crossY(takeaway, top, (addrY + miny) / 2, (takeaway + top) / 2);
  const halfDown = crossY(top, impact, (miny + wy(impact)) / 2, (top + impact) / 2);
  const follow = crossY(impact, finish, (wy(impact) + wy(finish)) / 2, (impact + finish) / 2);

  const ev = [0, takeaway, halfBack, top, halfDown, impact, follow, finish];
  for (let i = 1; i < ev.length; i++) if (ev[i] <= ev[i - 1]) ev[i] = ev[i - 1] + 1e-3;
  return ev;
}

// Linear-interpolated frame at a fractional index (smooth scrubbing).
export function interpFrame(frames: number[][], f: number): number[] {
  const n = frames.length;
  const lo = Math.max(0, Math.min(n - 1, Math.floor(f)));
  const hi = Math.min(n - 1, lo + 1);
  const u = f - lo;
  const a = frames[lo];
  const b = frames[hi];
  const out = new Array(a.length);
  for (let k = 0; k < a.length; k++) out[k] = a[k] + (b[k] - a[k]) * u;
  return out;
}

// Map a shared phase (0..1) to a swing's fractional frame via its events.
export function phaseToFrame(events: number[], phase: number): number {
  if (phase <= 0) return events[0];
  if (phase >= 1) return events[events.length - 1];
  for (let s = 1; s < EVENT_PHASES.length; s++) {
    if (phase <= EVENT_PHASES[s]) {
      const u = (phase - EVENT_PHASES[s - 1]) / (EVENT_PHASES[s] - EVENT_PHASES[s - 1] || 1);
      return events[s - 1] + (events[s] - events[s - 1]) * u;
    }
  }
  return events[events.length - 1];
}

export function phaseEventName(phase: number): string {
  let idx = 0;
  for (let s = 0; s < EVENT_PHASES.length; s++) if (phase >= EVENT_PHASES[s] - 1e-6) idx = s;
  return EVENT_NAMES[idx];
}

// --- Joint angles (for the deviation heat-map) ----------------------------
const angleAt = (f: number[], a: number, b: number, c: number) => {
  const v1x = X(f, a) - X(f, b);
  const v1y = Y(f, a) - Y(f, b);
  const v2x = X(f, c) - X(f, b);
  const v2y = Y(f, c) - Y(f, b);
  const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1;
  const d = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / m));
  return (Math.acos(d) * 180) / Math.PI;
};

export interface JointDef {
  name: string;
  vertex: number;
  a: number;
  b: number;
  c: number;
}
export const JOINTS: JointDef[] = [
  { name: "右ひざ", vertex: LM.rKnee, a: LM.rHip, b: LM.rKnee, c: LM.rAnkle },
  { name: "左ひざ", vertex: LM.lKnee, a: LM.lHip, b: LM.lKnee, c: LM.lAnkle },
  { name: "右ひじ", vertex: LM.rElbow, a: LM.rShoulder, b: LM.rElbow, c: LM.rWrist },
  { name: "左ひじ", vertex: LM.lElbow, a: LM.lShoulder, b: LM.lElbow, c: LM.lWrist },
  { name: "右肩", vertex: LM.rShoulder, a: LM.rElbow, b: LM.rShoulder, c: LM.rHip },
  { name: "左肩", vertex: LM.lShoulder, a: LM.lElbow, b: LM.lShoulder, c: LM.lHip },
];

export interface JointDeviation {
  name: string;
  vertex: number;
  you: number;
  ref: number;
  diff: number;
}
// Compare two synced frames; return joints whose angle differs by > threshold.
export function jointDeviations(you: number[], ref: number[], threshold = 14): JointDeviation[] {
  const out: JointDeviation[] = [];
  for (const j of JOINTS) {
    const yA = angleAt(you, j.a, j.b, j.c);
    const rA = angleAt(ref, j.a, j.b, j.c);
    const diff = Math.abs(yA - rA);
    if (diff >= threshold) out.push({ name: j.name, vertex: j.vertex, you: Math.round(yA), ref: Math.round(rA), diff });
  }
  return out.sort((p, q) => q.diff - p.diff);
}

// --- Kinematic sequence (pelvis → thorax → arm) ---------------------------
const lineAngle = (f: number[], i1: number, i2: number) =>
  Math.atan2(Y(f, i2) - Y(f, i1), X(f, i2) - X(f, i1));
const angDelta = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
};

export interface Kinematics {
  pelvis: number[];
  thorax: number[];
  arm: number[];
}
export function kinematics(frames: number[][], leftHanded: boolean): Kinematics {
  const n = frames.length;
  const w = leadWrist(leftHanded);
  const pelvis: number[] = [];
  const thorax: number[] = [];
  const arm: number[] = [];
  for (let i = 1; i < n; i++) {
    pelvis.push(angDelta(lineAngle(frames[i], LM.lHip, LM.rHip), lineAngle(frames[i - 1], LM.lHip, LM.rHip)));
    thorax.push(angDelta(lineAngle(frames[i], LM.lShoulder, LM.rShoulder), lineAngle(frames[i - 1], LM.lShoulder, LM.rShoulder)));
    arm.push(Math.hypot(X(frames[i], w) - X(frames[i - 1], w), Y(frames[i], w) - Y(frames[i - 1], w)));
  }
  return { pelvis, thorax, arm };
}

// Peak order of the three segments within the downswing (top→impact window).
export function sequenceVerdict(
  k: Kinematics,
  events: number[],
): { order: string[]; good: boolean } {
  const lo = Math.max(0, Math.floor(events[3]) - 1); // around top
  const hi = Math.min(k.pelvis.length - 1, Math.ceil(events[5])); // impact
  const peak = (arr: number[]) => {
    let pi = lo;
    let pv = -1;
    for (let i = lo; i <= hi; i++) if (arr[i] > pv) { pv = arr[i]; pi = i; }
    return pi;
  };
  const segs = [
    { name: "骨盤", t: peak(k.pelvis) },
    { name: "胸郭", t: peak(k.thorax) },
    { name: "腕", t: peak(k.arm) },
  ].sort((a, b) => a.t - b.t);
  const order = segs.map((s) => s.name);
  const good = order[0] === "骨盤" && order[2] === "腕";
  return { order, good };
}
