import { LM, type Frame } from "./pose";
import { detectEvents } from "./ghost-sync";

// Cross-angle ("正面 × 後方") swing analysis. The whole point of two cameras is
// that some faults are AMBIGUOUS from a single view: e.g. the front view shows
// the head "dropping", but only the down-the-line (DTL) view reveals whether the
// head genuinely sank (vertical) or the upper body dived forward (spine angle
// deepened / hips backed up). We combine both views to name the TRUE cause.
//
// All helpers operate on compact flat frames [x0,y0,x1,y1,...] for the 33 pose
// landmarks (same layout as compactFrames / ghost-sync), x,y only.

const X = (f: number[], i: number) => f[i * 2];
const Y = (f: number[], i: number) => f[i * 2 + 1];
const mX = (f: number[], a: number, b: number) => (X(f, a) + X(f, b)) / 2;
const mY = (f: number[], a: number, b: number) => (Y(f, a) + Y(f, b)) / 2;

// Flatten a full Landmark frame to the compact [x,y,...] layout.
export function toFlat(f: Frame): number[] {
  const a: number[] = [];
  for (let i = 0; i < 33; i++) {
    const p = f[i];
    a.push(p?.x ?? 0, p?.y ?? 0);
  }
  return a;
}

// Body height (nose→ankle) used to convert normalized distances into cm.
function bodyHeight(f: number[]): number {
  const ankle = (Y(f, LM.lAnkle) + Y(f, LM.rAnkle)) / 2;
  const h = Math.abs(ankle - Y(f, LM.nose));
  return h > 0.05 ? h : 0.5;
}

// Spine tilt (deg from vertical) of the hip-midpoint → shoulder-midpoint vector.
// In the DTL view this reads as forward bend (前傾角); in the front view it reads
// as lateral upper-body lean.
function spineTilt(f: number[]): number {
  const hx = mX(f, LM.lHip, LM.rHip);
  const hy = mY(f, LM.lHip, LM.rHip);
  const sx = mX(f, LM.lShoulder, LM.rShoulder);
  const sy = mY(f, LM.lShoulder, LM.rShoulder);
  return Math.abs((Math.atan2(sx - hx, hy - sy) * 180) / Math.PI);
}

const clampIdx = (i: number, n: number) => Math.max(0, Math.min(n - 1, Math.round(i)));

// Average a window of flat frames (used to get a stable "address" reference).
function avgFrame(frames: number[][], lo: number, hi: number): number[] {
  const len = frames[0]?.length ?? 66;
  const out = new Array(len).fill(0);
  let c = 0;
  for (let i = lo; i <= hi && i < frames.length; i++) {
    const f = frames[i];
    for (let k = 0; k < len; k++) out[k] += f[k];
    c++;
  }
  if (c) for (let k = 0; k < len; k++) out[k] /= c;
  return out;
}

export interface ViewMetrics {
  spineAddr: number; // 前傾角(アドレス) deg
  spineImpact: number; // 前傾角(インパクト) deg
  spineDelta: number; // +で前傾が深まる / -で起き上がり
  headDropCm: number; // +で頭が下がる
  swayCm: number; // 腰の横移動量(絶対値)
  hipMoveCm: number; // トレール側ヒップの移動量(前後/横)
}

export interface CrossFinding {
  code: string;
  title: string;
  severity: "high" | "mid" | "low" | "ok";
  front: string; // 正面ビューが示す事象
  dtl: string; // 後方ビューが示す事象
  truth: string; // 2視点クロスで判明した「真因」
  advice: string; // 修正の指針
}

export interface CrossResult {
  valid: boolean;
  front: ViewMetrics;
  dtl: ViewMetrics;
  findings: CrossFinding[];
}

function viewMetrics(frames: number[][], leftHanded: boolean, heightCm: number): ViewMetrics {
  const n = frames.length;
  const ev = detectEvents(frames, leftHanded);
  const impactIdx = clampIdx(ev[5], n);
  const addr = avgFrame(frames, 0, Math.min(2, n - 1));
  const imp = frames[impactIdx];
  const bh = bodyHeight(addr);
  const trailHip = leftHanded ? LM.lHip : LM.rHip;

  const spineAddr = spineTilt(addr);
  const spineImpact = spineTilt(imp);
  const headDropCm = ((Y(imp, LM.nose) - Y(addr, LM.nose)) / bh) * heightCm;
  const swayCm = (Math.abs(mX(imp, LM.lHip, LM.rHip) - mX(addr, LM.lHip, LM.rHip)) / bh) * heightCm;
  const hipMoveCm = (Math.abs(X(imp, trailHip) - X(addr, trailHip)) / bh) * heightCm;

  return {
    spineAddr: Math.round(spineAddr),
    spineImpact: Math.round(spineImpact),
    spineDelta: Math.round(spineImpact - spineAddr),
    headDropCm: Math.round(headDropCm * 10) / 10,
    swayCm: Math.round(swayCm * 10) / 10,
    hipMoveCm: Math.round(hipMoveCm * 10) / 10,
  };
}

const sev = (x: number, mid: number, high: number): CrossFinding["severity"] =>
  x >= high ? "high" : x >= mid ? "mid" : "low";

// Combine the two views into stereoscopic findings. `front` and `dtl` are the
// compact-frame sequences for the two cameras.
export function crossAnalyze(
  front: number[][],
  dtl: number[][],
  opts: { leftHanded?: boolean; heightCm?: number } = {},
): CrossResult {
  const leftHanded = !!opts.leftHanded;
  const heightCm = opts.heightCm ?? 170;
  const valid = front.length >= 5 && dtl.length >= 5;

  const fm = viewMetrics(front, leftHanded, heightCm);
  const dm = viewMetrics(dtl, leftHanded, heightCm);
  const findings: CrossFinding[] = [];

  if (!valid) {
    return { valid, front: fm, dtl: dm, findings };
  }

  const headDrop = fm.headDropCm; // 正面：+で頭が下がる
  const bend = dm.spineDelta; // 後方：+で前傾が深まる / -で起き上がり

  // ① 旗艦ロジック：正面の「頭の下がり」の真因を後方の前傾変化で切り分ける。
  if (headDrop >= 2.5) {
    if (bend >= 4) {
      findings.push({
        code: "dive_forward",
        title: "「頭の下がり」の真因は“前傾の深まり（突っ込み）”",
        severity: sev(Math.max(headDrop, bend), 5, 9),
        front: `正面：インパクトで頭が約 ${headDrop}cm 下がって見えます。`,
        dtl: `後方：前傾角がアドレス比 +${bend}°（${dm.spineAddr}°→${dm.spineImpact}°）深くなっています。`,
        truth:
          "頭が「沈んだ」のではなく、上体が前へ突っ込み前傾が深くなった結果です。お尻が引け、ボールへ近づいています。",
        advice: "お尻を後方の壁に当てたまま、アドレスの前傾角をキープして回転しましょう。",
      });
    } else if (bend > -3) {
      findings.push({
        code: "vertical_sink",
        title: "本物の“縦の沈み込み”（軸が下がっている）",
        severity: sev(headDrop, 4, 7),
        front: `正面：インパクトで頭が約 ${headDrop}cm 下がっています。`,
        dtl: `後方：前傾角はほぼ不変（${bend >= 0 ? "+" : ""}${bend}°）です。`,
        truth: "前傾は保てていますが体全体が沈んでいます（ヒザの入れ過ぎ・右サイドの落下）。",
        advice: "アドレス時の目線の高さをインパクトまで保つ意識を持ちましょう。",
      });
    }
  }

  // ② アーリーエクステンション（起き上がり）：後方で前傾が伸び、正面で頭が持ち上がる。
  if (bend <= -5) {
    const lift = headDrop < 0 ? Math.abs(headDrop) : 0;
    findings.push({
      code: "early_extension",
      title: "アーリーエクステンション（起き上がり）",
      severity: sev(-bend, 6, 11),
      front:
        lift >= 1
          ? `正面：頭が約 ${lift}cm 持ち上がっています。`
          : "正面：軸が伸び上がる傾向が見られます。",
      dtl: `後方：前傾が ${bend}° 伸び上がり、お尻の前後動 約${dm.hipMoveCm}cm。`,
      truth: "ダウンで上体が起き上がり、ボールとの距離が変化しています。プッシュ・チーピンの温床です。",
      advice: "切り返しでトレール側の腰を後方へ。前傾角を解かずに振り抜きましょう。",
    });
  }

  // ③ スウェー（軸の左右ブレ）：正面で腰が横移動、後方では前傾が安定＝縦/前後ではない。
  if (fm.swayCm >= 5 && Math.abs(bend) < 4) {
    findings.push({
      code: "sway",
      title: "スウェー（軸の左右ブレ）",
      severity: sev(fm.swayCm, 8, 14),
      front: `正面：腰が約 ${fm.swayCm}cm 横へスライドしています。`,
      dtl: `後方：前傾角は安定（${bend >= 0 ? "+" : ""}${bend}°）。上下・前後ではなく左右のズレです。`,
      truth: "ブレの主因は縦でも前後でもなく横方向です。体の中心軸でその場回転する意識を。",
      advice: "右股関節に乗せたら、頭の位置を変えずに回転で切り返しましょう。",
    });
  }

  if (findings.length === 0) {
    findings.push({
      code: "ok",
      title: "2視点に大きな矛盾はありません",
      severity: "ok",
      front: `正面：頭の上下 ${Math.abs(headDrop)}cm／腰の横移動 ${fm.swayCm}cm。`,
      dtl: `後方：前傾角の変化 ${bend >= 0 ? "+" : ""}${bend}°（${dm.spineAddr}°→${dm.spineImpact}°）。`,
      truth: "正面・後方どちらの軸も安定しています。良い再現性です。",
      advice: "この感覚を基準スイングとして記録し、再現性を磨きましょう。",
    });
  }

  return { valid, front: fm, dtl: dm, findings };
}
