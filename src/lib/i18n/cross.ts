export const d: Record<string, string> = {
  "正面": "Front",
  "後方(DTL)": "Down the line (DTL)",
  "正面動画を解析中…（打音を検出しています）": "Analyzing front video… (detecting impact sound)",
  "後方動画を解析中…（骨格を抽出しています）": "Analyzing DTL video… (extracting pose)",
  "どちらかの動画で骨格を十分に検出できませんでした。全身が大きく・明るく映った動画でお試しください。":
    "Couldn't detect enough of your body in one of the videos. Try a video where your whole body appears large and well-lit.",
  "解析中にエラーが発生しました。動画ファイルを変えてお試しください。":
    "An error occurred during analysis. Please try a different video file.",
  "クロスアングル解析": "Cross-Angle Analysis",
  "正面×後方を打音で完全同期・2視点で真因を判定":
    "Front and DTL perfectly synced by impact sound — find the root cause from two angles",
  "2つの視点の動画を読み込み": "Load videos from two angles",
  "同じスイングを「正面」と「後方(DTL)」から撮った2本を選んでください。打球音(打音)の波形を照合して、2本を1コマのズレもなく自動同期します。":
    "Pick two videos of the same swing, one from the front and one down the line (DTL). We match the impact-sound waveforms to auto-sync them without a single frame of drift.",
  "✓ 選択済み": "✓ Selected",
  "タップして選択": "Tap to select",
  "同期して解析する": "Sync and analyze",
  "💡 同期のコツ：両方の動画に「インパクトの打音」がはっきり入っていると精度が上がります。音声が無い動画でも、骨格から推定した最速点(インパクト)で自動同期します。2台同時撮影には":
    "💡 Sync tip: accuracy improves when both videos clearly capture the impact sound. Even for videos without audio, we auto-sync using the fastest point (impact) estimated from your pose. For filming with two cameras at once,",
  "シンクロ撮影": "Sync Recording",
  "が便利です。解析はすべて端末内(MediaPipe)で行われます。":
    "is handy. All analysis runs entirely on your device (MediaPipe).",
  "別の動画で解析する": "Analyze another video",
};
