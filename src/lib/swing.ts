import type { Frame } from "./pose";
import { LM } from "./pose";
import type { Fault, Pro, SwingAngles, PhaseAngles } from "./types";

type V = { x: number; y: number };
const v = (a: Frame[number]): V => ({ x: a.x, y: a.y });
const mid = (a: V, b: V): V => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y);

// angle (deg) of vector a->b measured from horizontal, 0..180
function lineAngle(a: V, b: V): number {
  return Math.abs((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
}
// angle (deg) from vertical of vector a->b, 0 = straight up
function tiltFromVertical(a: V, b: V): number {
  const ang = (Math.atan2(b.x - a.x, a.y - b.y) * 180) / Math.PI;
  return Math.abs(ang);
}
// interior angle at point b formed by a-b-c
function jointAngle(a: V, b: V, c: V): number {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const m = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y) || 1;
  return (Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180) / Math.PI;
}

export interface FrameMetrics {
  leadWristY: number;
  midHipX: number;
  midHipY: number;
  midShoulder: V;
  bodyHeight: number; // nose->ankle, normalized
  shoulderWidth: number;
  hipWidth: number;
  spineTilt: number;
  shoulderLine: number;
  hipLine: number;
  leadArmAngle: number; // shoulder-elbow-wrist
  leadArm: { sh: V; el: V; wr: V };
  trailKneeAngle: number; // hip-knee-ankle of the trail leg (≈180 = straight)
  ok: boolean;
}

export function frameMetrics(lm: Frame, leftHanded = false): FrameMetrics {
  const lead = leftHanded
    ? { sh: LM.rShoulder, el: LM.rElbow, wr: LM.rWrist, hip: LM.rHip }
    : { sh: LM.lShoulder, el: LM.lElbow, wr: LM.lWrist, hip: LM.lHip };
  // Trail leg is the opposite side (right knee for a right-handed golfer).
  const trail = leftHanded
    ? { hip: LM.lHip, knee: LM.lKnee, ankle: LM.lAnkle }
    : { hip: LM.rHip, knee: LM.rKnee, ankle: LM.rAnkle };

  const lSh = v(lm[LM.lShoulder]);
  const rSh = v(lm[LM.rShoulder]);
  const lHip = v(lm[LM.lHip]);
  const rHip = v(lm[LM.rHip]);
  const midSh = mid(lSh, rSh);
  const midHip = mid(lHip, rHip);
  const nose = v(lm[LM.nose]);
  const ankle = mid(v(lm[LM.lAnkle]), v(lm[LM.rAnkle]));

  const sh = v(lm[lead.sh]);
  const el = v(lm[lead.el]);
  const wr = v(lm[lead.wr]);

  const vis = [LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip, lead.wr];
  const ok = vis.every((i) => (lm[i]?.visibility ?? 1) > 0.3);

  return {
    leadWristY: wr.y,
    midHipX: midHip.x,
    midHipY: midHip.y,
    midShoulder: midSh,
    bodyHeight: Math.abs(ankle.y - nose.y) || 0.6,
    shoulderWidth: dist(lSh, rSh),
    hipWidth: dist(lHip, rHip),
    spineTilt: tiltFromVertical(midHip, midSh),
    shoulderLine: lineAngle(lSh, rSh),
    hipLine: lineAngle(lHip, rHip),
    leadArmAngle: jointAngle(sh, el, wr),
    leadArm: { sh, el, wr },
    trailKneeAngle: jointAngle(v(lm[trail.hip]), v(lm[trail.knee]), v(lm[trail.ankle])),
    ok,
  };
}

// Estimate rotation (deg) of a segment by how much its projected width
// shrinks relative to its address width (face-on foreshortening proxy).
function turnDeg(current: number, reference: number): number {
  if (reference <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, current / reference));
  return Math.round((Math.acos(ratio) * 180) / Math.PI);
}

// One link in the "ドミノ倒し" causal chain (effect ← cause ← root cause).
export interface RootCauseStep {
  phase: string; // フェーズ名
  tMs: number; // インパクトを0msとした相対時刻（負=前）
  label: string; // 起きている事象
  detail: string; // 補足
}

export interface SwingResult {
  angles: SwingAngles;
  shoulderTurn: number;
  hipTurn: number;
  spineTilt: number;
  swingPlane: number;
  tempoRatio: number;
  swayCm: number;
  leadArmImpact: number; // for chicken wing (lead arm angle at impact)
  handSpeed: number; // 推定リード手元スピード (m/s)
  headSpeed: number; // 推定ヘッドスピード (m/s)
  efficiency: number; // 0-100: 手元→ヘッドの効率（タメの解放）
  earlyExtensionDeg: number; // 起き上がり量（アドレス比、+で起き上がり）
  rootCause: RootCauseStep[]; // リバース・エンジニアリング診断
  phaseIdx: { address: number; top: number; impact: number; finish: number };
  valid: boolean;
}

// Analyze a sequence of pose frames into golf swing metrics.
export function analyzeSwing(
  frames: Frame[],
  opts: { heightCm?: number; leftHanded?: boolean; fps?: number; clubFactor?: number } = {},
): SwingResult {
  const fps = opts.fps && opts.fps > 0 ? opts.fps : 30;
  const fm = frames.map((f) => frameMetrics(f, opts.leftHanded));
  const good = fm.filter((m) => m.ok);
  const valid = good.length >= 5 && frames.length >= 6;

  // Guard: if the skeleton was barely (or never) detected, bail out with a
  // safe, invalid result instead of indexing into an empty array (which would
  // throw and leave the UI stuck on "解析中").
  if (fm.length < 4) {
    const zero: PhaseAngles = { shoulderTurn: 0, hipTurn: 0, spineTilt: 0, swingPlane: 0 };
    return {
      angles: { address: zero, top: zero, impact: zero, finish: zero },
      shoulderTurn: 0,
      hipTurn: 0,
      spineTilt: 0,
      swingPlane: 0,
      tempoRatio: 0,
      swayCm: 0,
      leadArmImpact: 0,
      handSpeed: 0,
      headSpeed: 0,
      efficiency: 0,
      earlyExtensionDeg: 0,
      rootCause: [],
      phaseIdx: { address: 0, top: 0, impact: 0, finish: 0 },
      valid: false,
    };
  }

  // Address = first stable frames; reference widths from address window.
  const addrWin = fm.slice(0, Math.max(1, Math.floor(fm.length * 0.12)));
  const refShoulderW = Math.max(...addrWin.map((m) => m.shoulderWidth));
  const refHipW = Math.max(...addrWin.map((m) => m.hipWidth));
  const addrHipX = avg(addrWin.map((m) => m.midHipX));

  const addressIdx = 0;
  // Top = frame with the highest lead hands (min y) in the first 65%.
  const topSearch = fm.slice(0, Math.floor(fm.length * 0.65));
  let topIdx = 0;
  let minY = Infinity;
  topSearch.forEach((m, i) => {
    if (m.leadWristY < minY) {
      minY = m.leadWristY;
      topIdx = i;
    }
  });
  // Impact = hands return near address height, after top.
  const addrWristY = avg(addrWin.map((m) => m.leadWristY));
  let impactIdx = topIdx;
  let bestDelta = Infinity;
  for (let i = topIdx + 1; i < fm.length; i++) {
    const d = Math.abs(fm[i].leadWristY - addrWristY);
    if (d < bestDelta) {
      bestDelta = d;
      impactIdx = i;
    }
  }
  const finishIdx = fm.length - 1;

  const phaseAt = (i: number): PhaseAngles => {
    const m = fm[Math.max(0, Math.min(fm.length - 1, i))];
    return {
      shoulderTurn: turnDeg(m.shoulderWidth, refShoulderW),
      hipTurn: turnDeg(m.hipWidth, refHipW),
      spineTilt: Math.round(m.spineTilt),
      swingPlane: Math.round(lineAngleSafe(m.leadArm.sh, m.leadArm.wr)),
    };
  };

  const angles: SwingAngles = {
    address: phaseAt(addressIdx),
    top: phaseAt(topIdx),
    impact: phaseAt(impactIdx),
    finish: phaseAt(finishIdx),
  };

  // Tempo = backswing frames : downswing frames
  const back = Math.max(1, topIdx - addressIdx);
  const down = Math.max(1, impactIdx - topIdx);
  const tempoRatio = Math.round((back / down) * 10) / 10;

  // Sway = max lateral hip travel during backswing, converted to cm.
  const maxHipShift = Math.max(
    ...fm.slice(0, impactIdx + 1).map((m) => Math.abs(m.midHipX - addrHipX)),
  );
  const bodyPx = avg(addrWin.map((m) => m.bodyHeight)) || 0.6;
  const heightCm = opts.heightCm ?? 170;
  const swayCm = Math.round((maxHipShift / bodyPx) * heightCm);

  // Chicken-wing is judged at impact (the lead arm should still be extended).
  // The follow-through naturally folds the arm, so it must NOT be averaged in.
  const leadArmImpact = Math.round(fm[impactIdx].leadArmAngle);

  // ② バーチャル・ヘッドスピード：リード手首の移動ピクセル/フレームを実寸へ換算。
  // metersPerNorm = 身長(m) / 体の縦ピクセル割合(正規化)。
  const metersPerNorm = (heightCm / 100) / bodyPx;
  const dt = 1 / fps;
  const wristSpeedAt = (i: number) => {
    if (i <= 0) return 0;
    const a = fm[i].leadArm.wr;
    const b = fm[i - 1].leadArm.wr;
    return (Math.hypot(a.x - b.x, a.y - b.y) * metersPerNorm) / dt;
  };
  let peakHand = 0;
  let peakHandIdx = impactIdx;
  for (let i = topIdx + 1; i <= Math.min(impactIdx + 1, fm.length - 1); i++) {
    const s = wristSpeedAt(i);
    if (s > peakHand) {
      peakHand = s;
      peakHandIdx = i;
    }
  }
  const handSpeed = Math.round(peakHand * 10) / 10;
  const clubFactor = opts.clubFactor ?? 2.0;
  const headSpeed = Math.round(peakHand * clubFactor * 10) / 10;
  // 効率：ピーク手元速度がインパクト“手前”に来て、インパクトで減速＝エネルギー伝達(良)。
  const handAtImpact = wristSpeedAt(impactIdx);
  const decel = peakHand > 0 ? (peakHand - handAtImpact) / peakHand : 0;
  const timing = peakHandIdx <= impactIdx ? 1 : 0.7; // ピークが遅れる=解けが遅い
  const efficiency = Math.max(0, Math.min(100, Math.round((35 + decel * 130) * timing)));

  // ① リバース・エンジニアリング診断（ドミノ倒し）
  // 「結果（インパクトでの起き上がり）」から時間を巻き戻して根本原因を辿る。
  const dtMs = 1000 / fps;
  const tFromImpact = (i: number) => Math.round((i - impactIdx) * dtMs);
  const earlyExtensionDeg = Math.round(
    angles.address.spineTilt - angles.impact.spineTilt,
  ); // +なら前傾が起きた（起き上がり）

  const rootCause: RootCauseStep[] = [];
  if (earlyExtensionDeg >= 6) {
    rootCause.push({
      phase: "インパクト",
      tMs: 0,
      label: `前傾角が${earlyExtensionDeg}°起き上がっています`,
      detail: "ボールとの距離が変わり、ダフリ・トップやプッシュの原因に。",
    });
    // 原因候補1: ダウン始動での腰の横スライド（トップ→インパクト間の最大横移動）
    let dsSwayIdx = topIdx;
    let dsSway = 0;
    for (let i = topIdx; i <= impactIdx; i++) {
      const s = Math.abs(fm[i].midHipX - fm[topIdx].midHipX);
      if (s > dsSway) {
        dsSway = s;
        dsSwayIdx = i;
      }
    }
    const dsSwayCm = Math.round((dsSway / bodyPx) * (opts.heightCm ?? 170));
    if (dsSwayCm >= 4) {
      rootCause.push({
        phase: "ダウンスイング始動",
        tMs: tFromImpact(dsSwayIdx),
        label: `腰が約${dsSwayCm}cm横にスライド`,
        detail: "切り返しで腰が突っ込み、体が伸び上がる引き金に。回転で下ろす意識を。",
      });
    }
    // 原因候補2: トップでの右（トレール）膝の伸び
    const kneeTop = fm[topIdx].trailKneeAngle;
    const kneeAddr = avg(addrWin.map((m) => m.trailKneeAngle));
    const kneeExt = Math.round(kneeTop - kneeAddr);
    if (kneeExt >= 8) {
      rootCause.push({
        phase: "トップ",
        tMs: tFromImpact(topIdx),
        label: `右膝が${kneeExt}°伸びています`,
        detail: "トップで右膝が伸びると軸が高くなり、ダウンでの起き上がりを誘発します。",
      });
    }
  }

  return {
    angles,
    shoulderTurn: angles.top.shoulderTurn,
    hipTurn: angles.top.hipTurn,
    spineTilt: angles.address.spineTilt,
    swingPlane: angles.top.swingPlane,
    tempoRatio,
    swayCm,
    leadArmImpact,
    handSpeed,
    headSpeed,
    efficiency,
    earlyExtensionDeg,
    rootCause,
    phaseIdx: {
      address: addressIdx,
      top: topIdx,
      impact: impactIdx,
      finish: finishIdx,
    },
    valid,
  };
}

function lineAngleSafe(a: V, b: V) {
  return Math.abs((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
}
function avg(arr: number[]) {
  return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
}

// Downsample a swing's frames to a compact flat-array sequence for storage
// (ghost overlay / replay). Keeps x,y for all 33 landmarks.
export function compactFrames(frames: Frame[], max = 45): number[][] {
  if (!frames.length) return [];
  const n = Math.min(max, frames.length);
  const out: number[][] = [];
  for (let k = 0; k < n; k++) {
    const idx = Math.round((k / (n - 1 || 1)) * (frames.length - 1));
    const f = frames[idx];
    const flat: number[] = [];
    for (let i = 0; i < 33; i++) {
      const p = f[i];
      flat.push(Math.round((p?.x ?? 0) * 1000) / 1000, Math.round((p?.y ?? 0) * 1000) / 1000);
    }
    out.push(flat);
  }
  return out;
}

// Expand a compact frame back into a drawable Frame (z/visibility filled).
export function expandFrame(flat: number[]): Frame {
  const f: Frame = [];
  for (let i = 0; i < 33; i++) {
    f.push({ x: flat[i * 2] ?? 0, y: flat[i * 2 + 1] ?? 0, z: 0, visibility: 1 });
  }
  return f;
}

// Lead-wrist speed (relative) across a compact sequence, normalized in time —
// used to visualize the "acceleration process" in the ghost comparison.
export function wristSpeedSeries(frames: number[][], leftHanded = false): number[] {
  const wr = leftHanded ? LM.rWrist : LM.lWrist;
  const out: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const ax = frames[i][wr * 2];
    const ay = frames[i][wr * 2 + 1];
    const bx = frames[i - 1][wr * 2];
    const by = frames[i - 1][wr * 2 + 1];
    out.push(Math.hypot(ax - bx, ay - by));
  }
  return out;
}

// Pick the pro whose body proportions best match the user.
export function matchPro(
  pros: Pro[],
  body: {
    height_cm?: number | null;
    arm_length_cm?: number | null;
    shoulder_width_cm?: number | null;
    leg_length_cm?: number | null;
  },
): { pro: Pro; sync: number; ranking: { pro: Pro; sync: number }[] } | null {
  if (!pros.length) return null;
  const h = body.height_cm ?? 172;
  // Normalize user metrics as ratios to height for shape comparison.
  const userArm = (body.arm_length_cm ?? h * 0.44) / h;
  const userSh = (body.shoulder_width_cm ?? h * 0.26) / h;
  const userLeg = (body.leg_length_cm ?? h * 0.52) / h;

  const ranking = pros
    .map((p) => {
      const dh = Math.abs(p.height_cm - h) / 25; // ~25cm spread
      // Approx one-arm (shoulder→wrist) length from wingspan minus shoulders,
      // to match the user's hand-measured arm length dimension.
      const proArm = (p.arm_span_cm - p.shoulder_width_cm) / 2;
      const da = Math.abs(proArm / p.height_cm - userArm) * 6;
      const ds = Math.abs(p.shoulder_width_cm / p.height_cm - userSh) * 6;
      const dl = Math.abs(p.leg_length_cm / p.height_cm - userLeg) * 6;
      const score = dh * 0.45 + da * 0.2 + ds * 0.15 + dl * 0.2;
      const sync = Math.max(40, Math.round(100 - score * 100));
      return { pro: p, sync };
    })
    .sort((a, b) => b.sync - a.sync);

  return { pro: ranking[0].pro, sync: ranking[0].sync, ranking };
}

// Detect swing faults by comparing measured metrics against the matched pro.
export function detectFaults(r: SwingResult, pro: Pro | null): Fault[] {
  const faults: Fault[] = [];
  const sev = (x: number, mid: number, high: number): Fault["severity"] =>
    x >= high ? "high" : x >= mid ? "mid" : "low";

  // スウェー（軸ブレ）
  if (r.swayCm >= 5) {
    faults.push({
      code: "sway",
      label: "スウェー（軸ブレ）",
      severity: sev(r.swayCm, 8, 14),
      detail: `バックスイングで腰が右に流れています。基準より約${r.swayCm}cm横移動。その場で回転する意識を。`,
      cm: r.swayCm,
    });
  }

  // チキンウィング（左肘の引け）: lead arm bent at impact (should be ~extended).
  if (r.leadArmImpact < 155) {
    const dev = Math.round(165 - r.leadArmImpact);
    faults.push({
      code: "chicken_wing",
      label: "チキンウィング（左肘の引け）",
      severity: sev(dev, 18, 30),
      detail: `インパクトでリード腕が${dev}°曲がっています。腕を長く保ち、体の回転で振り抜きましょう。`,
      deg: dev,
    });
  }

  // スイングプレーン / アウトサイドイン傾向
  if (pro) {
    const planeDev = Math.round(Math.abs(r.swingPlane - pro.swing_plane_deg));
    if (planeDev >= 8) {
      const steep = r.swingPlane > pro.swing_plane_deg;
      faults.push({
        code: steep ? "outside_in" : "too_flat",
        label: steep ? "アウトサイドイン傾向" : "プレーンがフラット過ぎ",
        severity: sev(planeDev, 10, 18),
        detail: steep
          ? `トップのプレーンが理想より${planeDev}°立っています。右脇を締めてインサイドから下ろす意識を。`
          : `プレーンが理想より${planeDev}°寝ています。やや縦の軌道を意識しましょう。`,
        deg: planeDev,
      });
    }

    // 肩の回転不足: only when the measured turn is genuinely shallow.
    // (The 2D width-foreshortening proxy maxes near 90°, so we compare against
    //  an attainable target rather than the raw pro value to avoid over-firing.)
    const target = Math.min(85, pro.shoulder_turn_deg);
    const turnDev = Math.round(target - r.shoulderTurn);
    if (r.shoulderTurn < 72 && turnDev >= 12) {
      faults.push({
        code: "low_shoulder_turn",
        label: "肩の回転不足",
        severity: sev(turnDev, 18, 28),
        detail: `トップの肩の回転が浅めです（${r.shoulderTurn}°）。背中をターゲットに向ける意識を。`,
        deg: turnDev,
      });
    }

    // テンポ
    const tempoDev = Math.round(Math.abs(r.tempoRatio - pro.tempo_ratio) * 10) / 10;
    if (tempoDev >= 0.8) {
      faults.push({
        code: "tempo",
        label: r.tempoRatio < pro.tempo_ratio ? "切り返しが急（早い）" : "テンポが緩慢",
        severity: tempoDev >= 1.4 ? "mid" : "low",
        detail: `テンポ比 ${r.tempoRatio} に対し理想は ${pro.tempo_ratio}。一定のリズムを意識しましょう。`,
      });
    }
  }

  // 注: アーリーリリース（キャスティング）はクラブ位置が必要で、単一2Dカメラ＋
  //     骨格のみでは信頼できる検出ができないため、誤診断を避けて自動判定は行わない。
  //     （修正用ドリルは AIコーチの early_release カテゴリに用意してある）

  return faults;
}

// Overall sync rate: blend body-match sync with how close the swing matched.
export function syncRate(
  bodySync: number,
  r: SwingResult,
  pro: Pro | null,
): number {
  if (!pro) return bodySync;
  const planeDev = Math.abs(r.swingPlane - pro.swing_plane_deg);
  const turnDev = Math.abs(r.shoulderTurn - pro.shoulder_turn_deg);
  const tempoDev = Math.abs(r.tempoRatio - pro.tempo_ratio) * 20;
  const swingScore = Math.max(
    0,
    100 - planeDev * 1.5 - turnDev * 1.0 - tempoDev - r.swayCm * 1.2,
  );
  return Math.round(bodySync * 0.35 + swingScore * 0.65);
}
