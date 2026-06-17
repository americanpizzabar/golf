export const d: Record<string, string> = {
  // Page header
  "スイングAI解析": "AI Swing Analysis",
  "骨格をリアルタイム計測・プロと比較": "Real-time body tracking, compared with the pros",

  // Profile prompt
  "先に": "Register your ",
  "体型プロフィール": "body profile",
  "を登録すると、あなたに最適なプロと比較できます（未登録時は標準体型で比較）。":
    " first to be matched with the pro best suited to you (a standard build is used until you register).",

  // Club selector
  "使用クラブ": "Club",
  "ドライバー": "Driver",
  "5番アイアン": "5 Iron",
  "7番アイアン": "7 Iron",
  "9番アイアン": "9 Iron",

  // Camera overlay
  "前後切替": "Flip",
  "（自動）": " (auto)",
  "正面ビュー": "Front view",
  "後方ビュー(DTL)": "Down-the-line (DTL)",
  "全身が映るようにスマホを縦に置き、": "Stand your phone vertically so your whole body is in frame,",
  "正面または後方から撮影します": "and film from the front or from behind",

  // Loading / status
  "カメラを起動中…": "Starting camera…",
  "AI解析エンジン準備中…": "Preparing AI engine…",
  "AI解析エンジンを準備中…": "Preparing the AI engine…",
  "スキャン中… {scanPct}%": "Scanning… {scanPct}%",
  "スイングを解析中…": "Analyzing swing…",

  // Detector watch states
  "スイングを検出！": "Swing detected!",
  "構えを検出 — スイングをどうぞ": "Address detected — go ahead and swing",
  "待機中（自動検出ON）": "Standing by (auto-detect ON)",
  "記録中… スイングしてください": "Recording… please swing",

  // Trim / zoom controls
  "拡大・縮小（ピンチ操作も可）— 被写体が小さいときに寄せると精度が上がります":
    "Zoom in/out (pinch supported) — zooming in on a small subject improves accuracy",
  "リセット": "Reset",
  "1本指ドラッグで表示位置を移動できます。この拡大範囲がそのまま解析されます。":
    "Drag with one finger to move the view. This zoomed area is exactly what gets analyzed.",
  "解析するスイングの範囲を指定（不要な素振り・歩行を除外すると精度が上がります）":
    "Set the swing range to analyze (excluding extra practice swings and walking improves accuracy)",
  "開始: {sec}秒": "Start: {sec}s",
  "終了: {sec}秒": "End: {sec}s",
  "この位置を表示": "Show this position",
  "選択範囲 {sec}秒（アドレス〜フィニッシュが収まる長さが目安）":
    "Selected range: {sec}s (aim for a length covering address to finish)",
  "別の動画": "Another video",
  "この範囲を解析": "Analyze this range",
  "選択範囲 {start}〜{end}秒（{frames}コマ）を解析":
    "Analyzing selected range {start}–{end}s ({frames} frames)",

  // Lens / zoom
  "レンズ": "Lens",
  "カメラ {n}": "Camera {n}",
  "広角": "Wide",
  "ズーム": "Zoom",

  // Action buttons
  "カメラで撮影": "Record with camera",
  "動画を選択": "Choose video",
  "AIエンジンを再読み込み": "Reload AI engine",
  "自動スイング検出": "Auto swing detection",
  "時間制限なし。構えてからゆっくり打ってOK": "No time limit. Set up and swing whenever you're ready",
  "終了して解析": "Stop and analyze",
  "検知開始（手動）": "Start capture (manual)",

  // Errors
  "AI解析エンジンの読み込みに失敗しました。通信環境を確認して再試行してください。":
    "Failed to load the AI analysis engine. Check your connection and try again.",
  "カメラの使用が許可されませんでした。ブラウザのアドレスバーからカメラを「許可」に変更してください。":
    "Camera access was denied. Change the camera permission to “Allow” from your browser’s address bar.",
  "利用できるカメラが見つかりませんでした。動画アップロードをご利用ください。":
    "No usable camera was found. Please upload a video instead.",
  "カメラが他のアプリで使用中の可能性があります。他のアプリを閉じて再試行してください。":
    "The camera may be in use by another app. Close other apps and try again.",
  "カメラを起動できませんでした。権限を確認するか、動画アップロードをお試しください。":
    "Couldn't start the camera. Check permissions or try uploading a video.",
  "このブラウザ/接続ではカメラを利用できません（HTTPS環境が必要です）。動画アップロードをご利用ください。":
    "The camera isn't available on this browser/connection (HTTPS is required). Please upload a video instead.",
  "動画を読み込めませんでした。別の動画ファイルでお試しください。":
    "Couldn't load the video. Please try a different video file.",
  "選択範囲で骨格を検出できませんでした。被写体（全身）がもう少し大きく映る動画か、明るい場所で撮影した動画でお試しください。":
    "No skeleton could be detected in the selected range. Try a video where the subject (full body) appears larger, or one shot in brighter lighting.",
  "骨格を検出できませんでした。全身（頭から足まで）がフレームに入るようカメラから2〜3m離れ、明るい場所で再撮影してください。":
    "No skeleton could be detected. Stand 2–3 m from the camera so your whole body (head to feet) is in frame, and re-record in a bright location.",
  "スイングをうまく解析できませんでした。全身が映る位置で、もう一度ゆっくりスイングしてみてください。":
    "Couldn't analyze the swing properly. Position yourself so your whole body is visible and try a slow swing again.",
  "解析中に問題が発生しました。もう一度お試しください。":
    "A problem occurred during analysis. Please try again.",

  // Results — phases
  "アドレス": "Address",
  "トップ": "Top",
  "インパクト": "Impact",
  "フィニッシュ": "Finish",

  // Results — sync gauge
  "{name} とのシンクロ率": "Sync with {name}",
  "スイング完成度": "Swing completeness",
  "3Dワイヤーフレーム（4ポジション）": "3D wireframe (4 positions)",
  "スイングプレーン比較": "Swing plane comparison",
  "あなた": "You",

  // Results — head speed
  "バーチャル・ヘッドスピード（骨格＋映像から推定）":
    "Virtual head speed (estimated from body tracking + video)",
  "推定ヘッドスピード": "Est. head speed",
  "手元スピード": "Hand speed",
  "効率（タメ）": "Efficiency (lag)",
  "タメが解けて効率よく加速できています（手元の減速→ヘッドが走る）。":
    "Lag is releasing and accelerating efficiently (hands decelerate, head whips through).",
  "手元が走り続け＝手打ち傾向。下半身リードでタメを保ちましょう。":
    "Hands keep accelerating = an arms-y tendency. Lead with the lower body to hold your lag.",
  "※ クラブ非検出のため映像と骨格からの推定値です。":
    "* Estimated from video and body tracking since no club was detected.",

  // Results — metrics
  "肩の回転 (トップ)": "Shoulder turn (top)",
  "腰の回転 (トップ)": "Hip turn (top)",
  "前傾(背骨)角": "Spine tilt angle",
  "テンポ比": "Tempo ratio",
  "軸の横ブレ": "Lateral sway",
  "リード腕(インパクト)": "Lead arm (impact)",
  "理想": "Ideal",

  // Results — faults
  "一言原因究明（{n}件）": "Quick diagnosis ({n})",
  "大きな悪癖は検出されませんでした。ナイススイング！": "No major flaws detected. Nice swing!",

  // Results — reverse engineering
  "リバース・エンジニアリング診断（根本原因の巻き戻し）":
    "Reverse-engineering diagnosis (rewinding to the root cause)",
  "結果から時間を遡り、悪癖の引き金になった最初の動きを特定します。":
    "Working back in time from the outcome to pinpoint the first move that triggered the flaw.",
  "（インパクト{tMs}ms）": " (impact {tMs}ms)",
  " ← 根本原因": " ← root cause",

  // Results — actions
  "もう一度": "Try again",
  "保存しました ✓": "Saved ✓",
  "記録を保存": "Save record",
  "この診断から練習メニューを作る": "Build a practice plan from this diagnosis",
};
