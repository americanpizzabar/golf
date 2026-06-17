export const d: Record<string, string> = {
  // Page header / tabs
  "アプローチ計測": "Approach Measurement",
  "目標点を設定して着弾を自動計測": "Set a target and auto-measure landings",
  "🎯 計測する": "🎯 Measure",
  "📊 データを見る": "📊 View Data",

  // Target shapes
  "まる（標準1m）": "Round (standard 1m)",
  "縦長（前後の距離合わせ）": "Tall (depth control)",
  "横長（左右のライン重視）": "Wide (line control)",

  // Camera / alerts
  "このブラウザ/接続ではカメラを利用できません（HTTPS環境が必要です）。":
    "The camera is unavailable in this browser/connection (HTTPS is required).",
  "カメラを起動できませんでした。権限を確認してください。":
    "Could not start the camera. Please check permissions.",
  "カメラをグリーンに向けて": "Point the camera at the green",
  "目標点（ピン）を設定します": "and set the target (pin)",
  "カメラOFF": "Camera OFF",
  "📷 カメラを起動して目標を設定": "📷 Start camera and set target",

  // Measuring / calibration status
  "● 着弾を記録！": "● Landing recorded!",
  "● 計測中… 着弾を自動検知": "● Measuring… auto-detecting landings",
  "① ピン（カップ）をタップ": "① Tap the pin (cup)",
  "② ピンから「手前1m」をタップ": "② Tap 1m toward you from the pin",
  "③ ピンから「右1m」をタップ": "③ Tap 1m right of the pin",
  "較正完了（タップでピンを置き直し）": "Calibration done (tap to reposition the pin)",

  // Calibration card
  "地面の遠近を較正：3点をタップすると、奥行きと左右の尺度をAIが算出し、手前は広く奥は狭い「3D楕円ターゲット」を表示します。":
    "Calibrate ground perspective: tap 3 points and the AI computes depth and lateral scale, showing a 3D elliptical target that is wide in front and narrow at the back.",
  "① ピン": "① Pin",
  "② 手前1m": "② 1m near",
  "③ 右1m": "③ 1m right",
  "↺ 較正をやり直す": "↺ Redo calibration",
  "ターゲット形状（練習の狙いに合わせて選択）": "Target shape (choose to match your goal)",
  "▶ 計測開始（着弾を自動検知）": "▶ Start measuring (auto-detect landings)",
  "■ 計測を停止": "■ Stop measuring",

  // Lie / distance
  "ライの状況": "Lie condition",
  "距離 (m)": "Distance (m)",

  // Lie labels (from LIE_LABELS)
  "平坦な花道": "Flat fairway",
  "左足上がり": "Uphill lie",
  "左足下がり": "Downhill lie",
  "つま先上がり": "Toe-up lie",
  "つま先下がり": "Toe-down lie",
  "ラフ": "Rough",
  "バンカー": "Bunker",

  // Recorder stats
  "打数": "Shots",
  "1m以内": "Within 1m",
  "成功率": "Success rate",
  "カップイン": "Holed",
  "↩ 直前の1球を取り消し": "↩ Undo last shot",
  "このセッションを保存（{n}球）": "Save this session ({n} shots)",
  "※ 計測開始後はカメラ映像の背景差分で着弾（動きが止まった位置）を常時自動検知します。撮影環境により精度は変わるため、検知漏れ時は画面を直接タップして着弾点を記録できます（β）。":
    "Once measuring starts, landings (where motion stops) are continuously auto-detected via frame differencing. Accuracy varies with conditions; if a landing is missed, tap the screen directly to record it (beta).",

  // DataView empty / stats
  "まだデータがありません。": "No data yet.",
  "「計測する」から記録を始めましょう。": "Start recording from \"Measure\".",
  "総打数": "Total shots",
  "1m成功率": "1m success rate",

  // Weakness card
  "🔻 明確な弱点：": "🔻 Clear weakness:",
  "の成功率は": "success rate is",
  "。": ".",
  "AIコーチがこの状況のドリルを優先して提案します。":
    "The AI coach will prioritize drills for this situation.",

  // Dispersion map
  "ディスパーション・マップ（着弾の散らばり）": "Dispersion map (landing spread)",
  "全ライ": "All lies",
  "重心は": "Center is",
  "（ピンから約{d}m）・バラつき {s}m": "(about {d}m from the pin) · spread {s}m",

  // Direction labels (from dispersionStats dirLabel)
  "センター": "Center",
  "右": "Right",
  "左": "Left",
  "奥": "Long",
  "手前": "Short",
  "奥右": "Long-right",
  "奥左": "Long-left",
  "手前右": "Short-right",
  "手前左": "Short-left",

  // Cause text (from dispersionStats causeText)
  "ピン周りに集中。再現性が高く好調です。":
    "Tightly grouped around the pin. Highly consistent and in good form.",
  "方向は良好ですが距離のバラつきが大きめ。振り幅とリズムを一定に。":
    "Direction is good but distance varies a lot. Keep swing length and rhythm consistent.",
  "右奥に集中。フェースがやや開き、ロフトが寝て入る（すくい打ち）傾向です。":
    "Grouped long-right. The face is slightly open and loft lays back (a scooping tendency).",
  "左に集中。フェースターン過剰、または手元の返しが早い引っ掛け傾向です。":
    "Grouped left. Excessive face turn or early hand release causing a pull tendency.",
  "手前に集中。ダフリ・距離不足。上げにいかず体の回転でロフト通りに打ちましょう。":
    "Grouped short. Fat shots and lack of distance. Don't try to lift; use body rotation to deliver the loft.",
  "奥に集中。インパクトが強すぎるか緩みでロフトが立っています。距離コントロールを。":
    "Grouped long. Impact is too strong or loft is de-lofted. Work on distance control.",
  "右に集中。プッシュ／フェード傾向。フェース向きとアライメントを確認しましょう。":
    "Grouped right. A push/fade tendency. Check face angle and alignment.",
  "ばらつきが見られます。まずは方向（フェース向き）を安定させましょう。":
    "Spread is scattered. First stabilize direction (face angle).",

  // Bar chart
  "状況別 1m成功率": "1m success rate by situation",
  "{v}% ({n}球)": "{v}% ({n} shots)",
  "履歴": "History",
};
