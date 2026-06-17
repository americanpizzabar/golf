export const d: Record<string, string> = {
  // CrossHistory.tsx
  "2視点解析の履歴": "Two-angle analysis history",
  "解析結果": "Analysis result",
  "シンクロ撮影": "Synced capture",
  "動画読込": "Video import",
  "正面 前傾Δ {spine}° / 頭 {head}cm / 横ブレ {sway}cm":
    "Front spine Δ {spine}° / head {head}cm / sway {sway}cm",
  "後方 前傾Δ {spine}° / 腰前後 {hip}cm": "Down-the-line spine Δ {spine}° / hip move {hip}cm",
  "正面：": "Front: ",
  "後方：": "Down-the-line: ",
  "真因：": "Root cause: ",
  "この記録を削除": "Delete this record",

  // CrossPlayer.tsx
  "打音シンクロ": "Impact-sound sync",
  "骨格シンクロ": "Skeleton sync",
  "両動画のインパクト打音でミリ秒同期しました。":
    "Both videos were synced to the millisecond using the impact sound.",
  "音声が弱いため、一部は骨格の最速点で同期しています。下のスライダーで微調整できます。":
    "Because the audio is weak, some parts are synced at the fastest skeleton point. Use the slider below to fine-tune.",
  "正面": "Front",
  "後方(DTL)": "Down-the-line (DTL)",
  "（IMP {ms}ms）": "(IMP {ms}ms)",
  "左右": "Side by side",
  "上下": "Stacked",
  "1コマ戻る": "Step back one frame",
  "1コマ進む": "Step forward one frame",
  "骨格": "Skeleton",
  "同期の微調整（後方を {ms}ms ずらす）": "Sync fine-tune (shift down-the-line by {ms}ms)",
  "リセット": "Reset",
  "打音を基準に2本を整列。スライダーや◀▶で約{ms}msずつ、正面・後方を同時にスロー再生・巻き戻しできます。骨格オーバーレイは端末内推定です。":
    "Both videos are aligned to the impact sound. Use the slider or ◀▶ to slow-play or rewind front and down-the-line together in steps of about {ms}ms. The skeleton overlay is estimated on-device.",
  "クロスアングル診断": "Cross-angle diagnosis",
  "正面と後方を組み合わせて初めて分かる「立体的なスイングエラー」の真因です。":
    "The root cause of three-dimensional swing errors that only emerge when front and down-the-line are combined.",
  "後方": "Down-the-line",
  "真因 ▶︎": "Root cause ▶︎",
  "計測値（アドレス→インパクト）": "Measurements (address → impact)",
  "正面ビュー": "Front view",
  "後方ビュー": "Down-the-line view",
  "頭の上下動": "Head vertical movement",
  "腰の横移動": "Hip lateral movement",
  "前傾角の変化": "Spine-angle change",
  "お尻の前後動": "Hip back-and-forth movement",
  "※ 2D骨格からの推定値です。被写体の大きさ・撮影角度で多少前後します。":
    "* Estimated from a 2D skeleton. Values may vary somewhat with subject size and camera angle.",

  // Swing phase event names (EVENT_NAMES, rendered via t())
  "アドレス": "Address",
  "テイクバック": "Takeaway",
  "ハーフウェイバック": "Halfway back",
  "トップ": "Top",
  "ハーフウェイダウン": "Halfway down",
  "インパクト": "Impact",
  "フォロー": "Follow-through",
  "フィニッシュ": "Finish",
};
