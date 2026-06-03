import type { Drill, Fault, LieType, Shot } from "./types";

export const LIE_LABELS: Record<LieType, string> = {
  flat: "平坦な花道",
  uphill: "左足上がり",
  downhill: "左足下がり",
  toe_up: "つま先上がり",
  toe_down: "つま先下がり",
  rough: "ラフ",
  bunker: "バンカー",
};

export const LIE_ORDER: LieType[] = [
  "flat",
  "uphill",
  "downhill",
  "toe_up",
  "toe_down",
  "rough",
  "bunker",
];

// "処方箋" drill library, indexed by the fault it fixes.
// Each fault has multiple variations so the coach can rotate and stay fresh.
// `cat` = problem category (max 1 per session); `id` = unique (for dedupe/recency).
const DRILL_LIBRARY: Record<string, Drill[]> = {
  outside_in: [
    {
      id: "oi_headcover",
      cat: "outside_in",
      title: "右脇ヘッドカバー・ドリル",
      minutes: 10,
      balls: 20,
      desc: "右脇にヘッドカバーを挟んで打つ。落とさず振れればインサイド軌道。",
      cue: "右肘を体の近くに保つ",
      videoQuery: "ゴルフ アウトサイドイン 修正 ヘッドカバー ドリル",
      tag: "swing",
    },
    {
      id: "oi_half",
      cat: "outside_in",
      title: "8時‑4時 ハーフショット",
      minutes: 10,
      balls: 25,
      desc: "腰から腰の振り幅で軌道を確認。インから出す感覚を反復。",
      cue: "右腰の前で振り抜く",
      videoQuery: "ゴルフ ハーフショット 軌道 練習",
      tag: "swing",
    },
    {
      id: "oi_gate",
      cat: "outside_in",
      title: "ゲートドリル（ティー2本）",
      minutes: 10,
      balls: 20,
      desc: "ボール前後にティーで関門を作り、インから抜ける軌道を矯正。",
      cue: "ヘッドを関門に当てない",
      videoQuery: "ゴルフ ゲートドリル 軌道 練習",
      tag: "swing",
    },
  ],
  too_flat: [
    {
      id: "flat_towel",
      cat: "too_flat",
      title: "縦振りタオル素振り",
      minutes: 8,
      desc: "タオルを縦に振り上げる感覚でプレーンを起こす。",
      cue: "手元を高く上げる",
      videoQuery: "ゴルフ スイングプレーン 立てる 練習",
      tag: "swing",
    },
    {
      id: "flat_upright",
      cat: "too_flat",
      title: "アップライト素振りチェック",
      minutes: 8,
      desc: "鏡で手元の高さを確認しながらトップを作る。",
      cue: "右肘を下に向ける",
      videoQuery: "ゴルフ アップライト スイング 練習",
      tag: "swing",
    },
  ],
  sway: [
    {
      id: "sway_wall",
      cat: "sway",
      title: "右足壁ドリル",
      minutes: 10,
      balls: 20,
      desc: "右足の外側に壁（バッグ等）を置き、腰が流れないよう回転。",
      cue: "右股関節に乗せて回す",
      videoQuery: "ゴルフ スウェー 軸ブレ 直し方 ドリル",
      tag: "swing",
    },
    {
      id: "sway_narrow",
      cat: "sway",
      title: "両足を揃えたスタンス打ち",
      minutes: 8,
      balls: 15,
      desc: "狭いスタンスで打ち、軸を中心に回る感覚を養う。",
      cue: "頭を動かさない",
      videoQuery: "ゴルフ 軸 安定 狭いスタンス ドリル",
      tag: "swing",
    },
    {
      id: "sway_ball_between",
      cat: "sway",
      title: "右内ももボール挟み",
      minutes: 8,
      desc: "右内ももにボールを挟んでスイング。下半身の流れを防ぐ。",
      cue: "挟んだ圧を保つ",
      videoQuery: "ゴルフ 下半身 安定 ボール挟み ドリル",
      tag: "swing",
    },
  ],
  chicken_wing: [
    {
      id: "cw_left_arm",
      cat: "chicken_wing",
      title: "左腕一本フォロー",
      minutes: 8,
      balls: 15,
      desc: "左手一本でフォローまで。腕を長く保つ感覚を作る。",
      cue: "左肘を畳まない",
      videoQuery: "ゴルフ チキンウィング 直す ドリル 左肘",
      tag: "swing",
    },
    {
      id: "cw_towel_under",
      cat: "chicken_wing",
      title: "両脇タオル挟み",
      minutes: 8,
      balls: 15,
      desc: "両脇にタオルを挟みインパクト〜フォローで体と腕を同調。",
      cue: "胸の回転で振る",
      videoQuery: "ゴルフ 脇 締める タオル ドリル",
      tag: "swing",
    },
  ],
  low_shoulder_turn: [
    {
      id: "turn_club_carry",
      cat: "low_shoulder_turn",
      title: "クラブ担ぎ回転ストレッチ",
      minutes: 6,
      desc: "クラブを肩に担いでフルターン。背中をターゲットへ。",
      cue: "左肩をあごの下へ",
      videoQuery: "ゴルフ 肩の回転 深く 練習 ドリル",
      tag: "mobility",
    },
    {
      id: "turn_cross_arm",
      cat: "low_shoulder_turn",
      title: "クロスアーム捻転ドリル",
      minutes: 6,
      desc: "両腕を胸でクロスし上体だけを深く捻転。",
      cue: "下半身は我慢",
      videoQuery: "ゴルフ 捻転 深い 練習",
      tag: "mobility",
    },
  ],
  early_release: [
    {
      id: "er_pump",
      cat: "early_release",
      title: "ポンプドリル（タメ作り）",
      minutes: 8,
      balls: 15,
      desc: "ダウンの途中で2回ポンプしてから打つ。下半身リードを習得。",
      cue: "腰から動き出す",
      videoQuery: "ゴルフ アーリーリリース タメ ポンプドリル",
      tag: "swing",
    },
  ],
  tempo: [
    {
      id: "tempo_123",
      cat: "tempo",
      title: "1‑2‑3 テンポ素振り",
      minutes: 6,
      desc: "『イチ・ニ・サン』で一定のリズムを刻む。",
      cue: "切り返しを急がない",
      videoQuery: "ゴルフ スイング テンポ リズム 練習",
      tag: "tempo",
    },
    {
      id: "tempo_metronome",
      cat: "tempo",
      title: "メトロノーム・テンポ打ち",
      minutes: 8,
      balls: 20,
      desc: "一定リズム（例3:1）に合わせて打ち、再現性を高める。",
      cue: "毎球同じリズム",
      videoQuery: "ゴルフ メトロノーム テンポ 練習",
      tag: "tempo",
    },
  ],
  approach: [
    {
      id: "ap_clock",
      cat: "approach",
      title: "時計の振り幅コントロール",
      minutes: 15,
      balls: 30,
      desc: "7時・8時・9時の振り幅で距離を打ち分ける。",
      cue: "リズム一定・加減速しない",
      videoQuery: "ゴルフ アプローチ 振り幅 距離感 練習",
      tag: "approach",
    },
    {
      id: "ap_circle",
      cat: "approach",
      title: "ワンクラブ・サークル",
      minutes: 12,
      balls: 24,
      desc: "ピン周り1mに円を作り、何球入るか記録しながら反復。",
      cue: "キャリーとランの比率を一定に",
      videoQuery: "ゴルフ アプローチ 寄せ 1m 練習",
      tag: "approach",
    },
    {
      id: "ap_landing",
      cat: "approach",
      title: "ランディングスポット狙い",
      minutes: 12,
      balls: 24,
      desc: "落とし所にタオルを置き、そこへキャリーさせる練習。",
      cue: "目線は落とし所",
      videoQuery: "ゴルフ アプローチ 落とし所 練習",
      tag: "approach",
    },
  ],
};

// Foundation / time-filler drills, each in a distinct category so they never
// duplicate within one session.
const FOUNDATION: Drill[] = [
  {
    id: "found_7iron",
    cat: "full_swing",
    title: "7番アイアン・センター出し",
    minutes: 15,
    balls: 30,
    desc: "ターゲットを決めて方向と当たりを確認。",
    cue: "フィニッシュで2秒静止",
    videoQuery: "ゴルフ 7番アイアン 基本 練習",
    tag: "swing",
  },
  {
    id: "found_driver",
    cat: "driver",
    title: "ドライバー・ティーアップ",
    minutes: 12,
    balls: 20,
    desc: "高めのティーで払い打ち。アッパー軌道を確認。",
    cue: "左肩を開かない",
    videoQuery: "ゴルフ ドライバー 基本 練習",
    tag: "swing",
  },
  {
    id: "found_wedge",
    cat: "wedge",
    title: "ウェッジ50ヤード距離感",
    minutes: 12,
    balls: 20,
    desc: "キャリーを揃える振り幅を体に覚えさせる。",
    cue: "ロフトを変えない",
    videoQuery: "ゴルフ ウェッジ 距離感 練習",
    tag: "approach",
  },
  {
    id: "found_alignment",
    cat: "alignment",
    title: "アライメント・スティック確認",
    minutes: 8,
    balls: 15,
    desc: "スティックで方向を揃え、狙いと構えのズレを矯正。",
    cue: "肩のラインを平行に",
    videoQuery: "ゴルフ アライメント スティック 練習",
    tag: "swing",
  },
];

const WARMUP: Drill = {
  id: "warmup",
  cat: "warmup",
  title: "ウォームアップ（可動域）",
  minutes: 5,
  desc: "肩・股関節・手首を回し、ハーフスイングで体をほぐす。",
  cue: "いきなりフルスイングしない",
  videoQuery: "ゴルフ ウォームアップ ストレッチ",
  tag: "warmup",
};

// 自宅で出来る「ノンボール」メニュー
export const HOME_DRILLS: Drill[] = [
  {
    id: "home_mirror",
    cat: "home_address",
    title: "鏡の前アドレスチェック",
    minutes: 5,
    desc: "正面・後方から姿勢を確認。背筋・前傾・グリップを点検。",
    cue: "毎回同じ前傾角",
    videoQuery: "ゴルフ アドレス 鏡 チェック",
    tag: "home",
  },
  {
    id: "home_half_swing",
    cat: "home_swing",
    title: "1畳スペース・ハーフ素振り",
    minutes: 8,
    desc: "腰から腰の振り幅でスロー素振り。プレーンを体に覚えさせる。",
    cue: "ゆっくり正確に",
    videoQuery: "ゴルフ 室内 素振り ドリル",
    tag: "home",
  },
  {
    id: "home_putt",
    cat: "home_putt",
    title: "パターのストローク練習",
    minutes: 10,
    desc: "1.5mを想定し、まっすぐ引いてまっすぐ出す。距離感を指で覚える。",
    cue: "頭と手元を止める",
    videoQuery: "ゴルフ パター 室内 練習",
    tag: "home",
  },
  {
    id: "home_hip_stretch",
    cat: "home_mobility",
    title: "股関節ストレッチ",
    minutes: 7,
    desc: "深い前屈・四股踏みで回旋の可動域を広げる。",
    cue: "呼吸を止めない",
    videoQuery: "ゴルフ 股関節 ストレッチ 柔軟",
    tag: "mobility",
  },
  {
    id: "home_towel_approach",
    cat: "home_approach",
    title: "タオルアプローチ感触練習",
    minutes: 8,
    desc: "ボールの代わりにタオルを置き、ソールの滑りと振り幅を確認。",
    cue: "ハンドファーストを維持",
    videoQuery: "ゴルフ アプローチ 室内 タオル 練習",
    tag: "home",
  },
];

export interface MenuInput {
  availableMin: number;
  balls: number;
  mode: "range" | "home";
  faults: Fault[]; // ranked weaknesses from swing
  weakLies: LieType[]; // approach weaknesses
  recentIds?: string[]; // drill ids proposed in the last few days (de-prioritize)
}

// Pick the best variation from a list: prefer one not recently suggested and
// not already in the session; fall back to the first that fits.
function pickVariation(
  list: Drill[],
  usedIds: Set<string>,
  usedCats: Set<string>,
  recent: Set<string>,
  remainingMin: number,
): Drill | null {
  const candidates = list.filter(
    (d) => !usedIds.has(d.id) && !usedCats.has(d.cat) && d.minutes <= remainingMin,
  );
  if (!candidates.length) return null;
  // Non-recent first, then shorter (so more drills fit).
  candidates.sort((a, b) => {
    const ra = recent.has(a.id) ? 1 : 0;
    const rb = recent.has(b.id) ? 1 : 0;
    if (ra !== rb) return ra - rb;
    return a.minutes - b.minutes;
  });
  return candidates[0];
}

// AIコーチ: time-budget aware personalized menu with de-duplication.
export function generateMenu(input: MenuInput): {
  drills: Drill[];
  focus: string[];
} {
  const recent = new Set(input.recentIds ?? []);

  if (input.mode === "home") {
    const picked: Drill[] = [];
    const usedCats = new Set<string>();
    let used = 0;
    // Rotate: non-recent home drills first.
    const pool = [...HOME_DRILLS].sort(
      (a, b) => (recent.has(a.id) ? 1 : 0) - (recent.has(b.id) ? 1 : 0),
    );
    for (const d of pool) {
      if (usedCats.has(d.cat)) continue;
      if (used + d.minutes > input.availableMin && picked.length >= 2) break;
      picked.push({ ...d });
      usedCats.add(d.cat);
      used += d.minutes;
    }
    return { drills: picked, focus: ["home"] };
  }

  const drills: Drill[] = [{ ...WARMUP }];
  const usedIds = new Set<string>([WARMUP.id]);
  const usedCats = new Set<string>([WARMUP.cat]);
  let used = WARMUP.minutes;
  const focus: string[] = [];

  // Prioritize highest-severity faults; one drill per fault category.
  const ranked = [...input.faults].sort(
    (a, b) => sevWeight(b.severity) - sevWeight(a.severity),
  );
  for (const f of ranked) {
    const lib = DRILL_LIBRARY[f.code];
    if (!lib) continue;
    const d = pickVariation(lib, usedIds, usedCats, recent, input.availableMin - used);
    if (!d) continue;
    drills.push({ ...d });
    usedIds.add(d.id);
    usedCats.add(d.cat);
    used += d.minutes;
    if (!focus.includes(f.code)) focus.push(f.code);
  }

  // If user has approach weaknesses, add one approach block.
  if (input.weakLies.length) {
    const d = pickVariation(
      DRILL_LIBRARY.approach,
      usedIds,
      usedCats,
      recent,
      input.availableMin - used,
    );
    if (d) {
      drills.push({ ...d });
      usedIds.add(d.id);
      usedCats.add(d.cat);
      used += d.minutes;
      focus.push("approach");
    }
  }

  // Fill remaining time with distinct foundation drills (no category repeats).
  const foundationPool = [...FOUNDATION].sort(
    (a, b) => (recent.has(a.id) ? 1 : 0) - (recent.has(b.id) ? 1 : 0),
  );
  for (const d of foundationPool) {
    if (used >= input.availableMin) break;
    if (usedIds.has(d.id) || usedCats.has(d.cat)) continue;
    if (used + d.minutes > input.availableMin) continue;
    drills.push({ ...d });
    usedIds.add(d.id);
    usedCats.add(d.cat);
    used += d.minutes;
  }

  // Guarantee at least one full-swing block if nothing else fit.
  if (drills.length === 1) {
    drills.push({ ...FOUNDATION[0] });
  }

  // Scale ball counts on the CLONES (never mutate the shared library).
  scaleBalls(drills, input.balls);
  return { drills, focus };
}

function scaleBalls(drills: Drill[], target: number) {
  const ballDrills = drills.filter((d) => d.balls);
  const sum = ballDrills.reduce((s, d) => s + (d.balls ?? 0), 0);
  if (!sum || !target) return;
  const k = target / sum;
  ballDrills.forEach((d) => (d.balls = Math.max(5, Math.round((d.balls ?? 0) * k))));
}

function sevWeight(s: Fault["severity"]) {
  return s === "high" ? 3 : s === "mid" ? 2 : 1;
}

export function youtubeSearch(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

// Clubs + parameters used across the app:
//  factor   = hand→clubhead lever ratio (head-speed estimate)
//  loft     = nominal loft (deg)
//  defHS    = typical amateur head speed (m/s) — fallback when no measured value
//  smash    = typical smash factor (ball speed = head speed × smash)
//  carryK   = carry meters per m/s of head speed (empirical)
//  apexK    = apex meters per m/s of head speed (empirical)
export interface ClubSpec {
  id: string;
  label: string;
  factor: number;
  loft: number;
  defHS: number;
  smash: number;
  carryK: number;
  apexK: number;
}
export const CLUBS: ClubSpec[] = [
  { id: "DR", label: "ドライバー", factor: 2.45, loft: 11, defHS: 42, smash: 1.48, carryK: 5.0, apexK: 0.72 },
  { id: "3W", label: "3W", factor: 2.35, loft: 15, defHS: 40, smash: 1.45, carryK: 4.6, apexK: 0.74 },
  { id: "UT", label: "UT", factor: 2.2, loft: 19, defHS: 38, smash: 1.42, carryK: 4.4, apexK: 0.78 },
  { id: "5I", label: "5番アイアン", factor: 2.1, loft: 27, defHS: 36, smash: 1.39, carryK: 4.2, apexK: 0.8 },
  { id: "7I", label: "7番アイアン", factor: 2.0, loft: 34, defHS: 33, smash: 1.38, carryK: 4.0, apexK: 0.85 },
  { id: "9I", label: "9番アイアン", factor: 1.9, loft: 42, defHS: 30, smash: 1.33, carryK: 3.6, apexK: 0.9 },
  { id: "PW", label: "PW", factor: 1.85, loft: 46, defHS: 28, smash: 1.28, carryK: 3.3, apexK: 0.9 },
  { id: "SW", label: "SW", factor: 1.75, loft: 56, defHS: 25, smash: 1.2, carryK: 2.6, apexK: 0.85 },
];

export function clubSpec(id: string): ClubSpec {
  return CLUBS.find((c) => c.id === id) ?? CLUBS[4];
}
export function clubFactor(id: string): number {
  return clubSpec(id).factor;
}

// 弾道の推定値（クラブ＋ヘッドスピードから）。距離はカメラではなく物理推定。
export function estimateBall(clubId: string, headSpeed: number) {
  const c = clubSpec(clubId);
  const hs = headSpeed > 0 ? headSpeed : c.defHS;
  const ballSpeed = Math.round(hs * c.smash * 10) / 10;
  const carry = Math.round(hs * c.carryK);
  const apex = Math.round(hs * c.apexK);
  return { ballSpeed, carry, apex, smash: c.smash, headSpeed: Math.round(hs * 10) / 10 };
}
export function clubLabel(id: string): string {
  return CLUBS.find((c) => c.id === id)?.label ?? id;
}
export function clubLoft(id: string): number {
  return CLUBS.find((c) => c.id === id)?.loft ?? 34;
}

const SHAPE_LABEL: Record<string, string> = {
  straight: "ストレート",
  draw: "ドロー",
  fade: "フェード",
  slice: "スライス",
  hook: "フック",
};
// テレビ中継風のカラーコーディング（良い球=青系、危険=オレンジ/赤）。
const SHAPE_COLOR: Record<string, string> = {
  straight: "#22d3ee",
  draw: "#3b82f6",
  fade: "#a3e635",
  slice: "#fb923c",
  hook: "#f43f5e",
};
export function shapeLabel(s: string): string {
  return SHAPE_LABEL[s] ?? s;
}
export function shapeColor(s: string): string {
  return SHAPE_COLOR[s] ?? "#22d3ee";
}

// 左右の曲がり量(正規化)から球筋を判定（右打ち基準）。
export function classifyShape(curveNorm: number, leftHanded = false): BallShapeLite {
  const c = leftHanded ? -curveNorm : curveNorm;
  if (c > 0.12) return "slice";
  if (c > 0.04) return "fade";
  if (c < -0.12) return "hook";
  if (c < -0.04) return "draw";
  return "straight";
}
type BallShapeLite = "straight" | "draw" | "fade" | "slice" | "hook";

// ② ディスパーション（着弾の散らばり）分析。重心とバラつきから癖を逆引き。
export interface DispersionStats {
  n: number;
  centroid: { dx: number; dy: number };
  dist: number; // 重心のピンからの距離(m)
  spread: number; // バラつき(m, 標準偏差)
  dirLabel: string; // 「右奥」など
  causeText: string; // 推定される原因
}

export function dispersionStats(shots: Shot[]): DispersionStats | null {
  const valid = shots.filter((s) => s.zone !== "out" || true); // include all
  if (valid.length < 1) return null;
  const n = valid.length;
  const cx = valid.reduce((s, p) => s + p.dx, 0) / n;
  const cy = valid.reduce((s, p) => s + p.dy, 0) / n;
  const dist = Math.hypot(cx, cy);
  const spread = Math.sqrt(
    valid.reduce((s, p) => s + (p.dx - cx) ** 2 + (p.dy - cy) ** 2, 0) / n,
  );

  const lat = cx > 0.5 ? "右" : cx < -0.5 ? "左" : "";
  const lon = cy > 0.5 ? "奥" : cy < -0.5 ? "手前" : "";
  const dirLabel = lon + lat || "センター";

  let causeText: string;
  if (dist < 0.6) {
    causeText =
      spread < 1.0
        ? "ピン周りに集中。再現性が高く好調です。"
        : "方向は良好ですが距離のバラつきが大きめ。振り幅とリズムを一定に。";
  } else if (lon === "奥" && lat === "右") {
    causeText = "右奥に集中。フェースがやや開き、ロフトが寝て入る（すくい打ち）傾向です。";
  } else if (lat === "左") {
    causeText = "左に集中。フェースターン過剰、または手元の返しが早い引っ掛け傾向です。";
  } else if (lon === "手前") {
    causeText = "手前に集中。ダフリ・距離不足。上げにいかず体の回転でロフト通りに打ちましょう。";
  } else if (lon === "奥") {
    causeText = "奥に集中。インパクトが強すぎるか緩みでロフトが立っています。距離コントロールを。";
  } else if (lat === "右") {
    causeText = "右に集中。プッシュ／フェード傾向。フェース向きとアライメントを確認しましょう。";
  } else {
    causeText = "ばらつきが見られます。まずは方向（フェース向き）を安定させましょう。";
  }

  return { n, centroid: { dx: cx, dy: cy }, dist, spread, dirLabel, causeText };
}
