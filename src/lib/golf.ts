import type { Drill, Fault, LieType } from "./types";

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
const DRILL_LIBRARY: Record<string, Drill[]> = {
  outside_in: [
    {
      title: "右脇ヘッドカバー・ドリル",
      minutes: 10,
      balls: 20,
      desc: "右脇にヘッドカバーを挟んで打つ。落とさず振れればインサイド軌道。",
      cue: "右肘を体の近くに保つ",
      videoQuery: "ゴルフ アウトサイドイン 修正 ヘッドカバー ドリル",
      tag: "swing",
    },
    {
      title: "8時‑4時 ハーフショット",
      minutes: 10,
      balls: 25,
      desc: "腰から腰の振り幅で軌道を確認。インから出す感覚を反復。",
      cue: "右腰の前で振り抜く",
      videoQuery: "ゴルフ ハーフショット 軌道 練習",
      tag: "swing",
    },
  ],
  too_flat: [
    {
      title: "縦振りタオル素振り",
      minutes: 8,
      desc: "タオルを縦に振り上げる感覚でプレーンを起こす。",
      cue: "手元を高く上げる",
      videoQuery: "ゴルフ スイングプレーン 立てる 練習",
      tag: "swing",
    },
  ],
  sway: [
    {
      title: "右足壁ドリル",
      minutes: 10,
      balls: 20,
      desc: "右足の外側に壁（バッグ等）を置き、腰が流れないよう回転。",
      cue: "右股関節に乗せて回す",
      videoQuery: "ゴルフ スウェー 軸ブレ 直し方 ドリル",
      tag: "swing",
    },
    {
      title: "両足を揃えたスタンス打ち",
      minutes: 8,
      balls: 15,
      desc: "狭いスタンスで打ち、軸を中心に回る感覚を養う。",
      cue: "頭を動かさない",
      videoQuery: "ゴルフ 軸 安定 狭いスタンス ドリル",
      tag: "swing",
    },
  ],
  chicken_wing: [
    {
      title: "左腕一本フォロー",
      minutes: 8,
      balls: 15,
      desc: "左手一本でフォローまで。腕を長く保つ感覚を作る。",
      cue: "左肘を畳まない",
      videoQuery: "ゴルフ チキンウィング 直す ドリル 左肘",
      tag: "swing",
    },
  ],
  low_shoulder_turn: [
    {
      title: "クラブ担ぎ回転ストレッチ",
      minutes: 6,
      desc: "クラブを肩に担いでフルターン。背中をターゲットへ。",
      cue: "左肩をあごの下へ",
      videoQuery: "ゴルフ 肩の回転 深く 練習 ドリル",
      tag: "mobility",
    },
  ],
  early_release: [
    {
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
      title: "1‑2‑3 テンポ素振り",
      minutes: 6,
      desc: "『イチ・ニ・サン』で一定のリズムを刻む。",
      cue: "切り返しを急がない",
      videoQuery: "ゴルフ スイング テンポ リズム 練習",
      tag: "tempo",
    },
  ],
  approach: [
    {
      title: "時計の振り幅コントロール",
      minutes: 15,
      balls: 30,
      desc: "7時・8時・9時の振り幅で距離を打ち分ける。",
      cue: "リズム一定・加減速しない",
      videoQuery: "ゴルフ アプローチ 振り幅 距離感 練習",
      tag: "approach",
    },
    {
      title: "ワンクラブ・サークル",
      minutes: 12,
      balls: 24,
      desc: "ピン周り1mに円を作り、何球入るか記録しながら反復。",
      cue: "キャリーとランの比率を一定に",
      videoQuery: "ゴルフ アプローチ 寄せ 1m 練習",
      tag: "approach",
    },
  ],
};

const WARMUP: Drill = {
  title: "ウォームアップ（可動域）",
  minutes: 5,
  desc: "肩・股関節・手首を回し、ハーフスイングで体をほぐす。",
  cue: "いきなりフルスイングしない",
  videoQuery: "ゴルフ ウォームアップ ストレッチ",
  tag: "warmup",
};

const FULL_SWING_DEFAULT: Drill = {
  title: "7番アイアン・センター出し",
  minutes: 15,
  balls: 30,
  desc: "ターゲットを決めて方向と当たりを確認。",
  cue: "フィニッシュで2秒静止",
  videoQuery: "ゴルフ 7番アイアン 基本 練習",
  tag: "swing",
};

// 自宅で出来る「ノンボール」メニュー
export const HOME_DRILLS: Drill[] = [
  {
    title: "鏡の前アドレスチェック",
    minutes: 5,
    desc: "正面・後方から姿勢を確認。背筋・前傾・グリップを点検。",
    cue: "毎回同じ前傾角",
    videoQuery: "ゴルフ アドレス 鏡 チェック",
    tag: "home",
  },
  {
    title: "1畳スペース・ハーフ素振り",
    minutes: 8,
    desc: "腰から腰の振り幅でスロー素振り。プレーンを体に覚えさせる。",
    cue: "ゆっくり正確に",
    videoQuery: "ゴルフ 室内 素振り ドリル",
    tag: "home",
  },
  {
    title: "パターのストローク練習",
    minutes: 10,
    desc: "1.5mを想定し、まっすぐ引いてまっすぐ出す。距離感を指で覚える。",
    cue: "頭と手元を止める",
    videoQuery: "ゴルフ パター 室内 練習",
    tag: "home",
  },
  {
    title: "股関節ストレッチ",
    minutes: 7,
    desc: "深い前屈・四股踏みで回旋の可動域を広げる。",
    cue: "呼吸を止めない",
    videoQuery: "ゴルフ 股関節 ストレッチ 柔軟",
    tag: "mobility",
  },
  {
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
}

// AIコーチ: time-budget aware personalized menu.
export function generateMenu(input: MenuInput): {
  drills: Drill[];
  focus: string[];
} {
  if (input.mode === "home") {
    const picked: Drill[] = [];
    let used = 0;
    for (const d of HOME_DRILLS) {
      if (used + d.minutes > input.availableMin && picked.length >= 2) break;
      picked.push(d);
      used += d.minutes;
    }
    return { drills: picked, focus: ["home"] };
  }

  const drills: Drill[] = [WARMUP];
  let used = WARMUP.minutes;
  const focus: string[] = [];

  // Prioritize highest-severity faults; pull their prescription drills.
  const ranked = [...input.faults].sort(
    (a, b) => sevWeight(b.severity) - sevWeight(a.severity),
  );
  for (const f of ranked) {
    const lib = DRILL_LIBRARY[f.code];
    if (!lib) continue;
    for (const d of lib) {
      if (used + d.minutes > input.availableMin) continue;
      if (drills.some((x) => x.title === d.title)) continue;
      drills.push(d);
      used += d.minutes;
      if (!focus.includes(f.code)) focus.push(f.code);
      break; // one drill per fault first pass
    }
  }

  // If user has approach weaknesses, add an approach block.
  if (input.weakLies.length && used + 12 <= input.availableMin) {
    const d = DRILL_LIBRARY.approach[0];
    drills.push(d);
    used += d.minutes;
    focus.push("approach");
  }

  // Fill remaining time with full-swing reps.
  while (used + FULL_SWING_DEFAULT.minutes <= input.availableMin) {
    drills.push({ ...FULL_SWING_DEFAULT });
    used += FULL_SWING_DEFAULT.minutes;
    if (drills.filter((d) => d.tag === "swing").length > 3) break;
  }

  // Scale ball counts to the requested total.
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
