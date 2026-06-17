export const d: Record<string, string> = {
  "AR弾道トレーサー": "AR Ball Tracer",
  "球筋を判定し弾道を描画（β）": "Detect shot shape and draw the trajectory (beta)",
  "🎥 トレーサー": "🎥 Tracer",
  "📐 クラブ・マトリクス": "📐 Club Matrix",
  "このブラウザ/接続ではカメラを利用できません（HTTPS環境が必要です）。":
    "The camera is not available on this browser/connection (HTTPS is required).",
  "カメラを起動できませんでした。": "Could not start the camera.",
  "飛球線の後方から、ボールと打ち出し方向が":
    "From behind the ball-to-target line, position the camera so",
  "両方映るようにカメラを固定してください。":
    "both the ball and the launch direction are in frame.",
  "打つと弾道を物理検証し、約1.5秒後に描画します（屋外OK）。":
    "On your shot, the flight is physically verified and drawn after about 1.5s (outdoor OK).",
  "● 弾道を物理検証中…": "● Verifying flight…",
  "○ 監視中 — 打ってください": "○ Watching — go ahead and hit",
  "🎙 打音同期 ON": "🎙 Impact-sound sync ON",
  "🎙 打音OFF（映像検知）": "🎙 Impact sound OFF (visual detection)",
  "停止": "Stop",
  "クラブ": "Club",
  "ヘッドスピード (m/s)": "Head speed (m/s)",
  "スイング解析で計測したヘッドスピードを自動反映。空欄ならクラブ標準値（{hs}m/s）で推定します。":
    "Head speed measured in swing analysis is applied automatically. If left blank, the club default ({hs}m/s) is used.",
  "📷 カメラを起動して計測": "📷 Start camera and measure",
  "球筋": "Shot shape",
  "最高到達点": "Apex",
  "推定キャリー": "Est. carry",
  "ミート率": "Smash factor",
  "推定初速 {ballSpeed} m/s ・ ヘッドスピード {hs} m/s（{club}）":
    "Est. ball speed {ballSpeed} m/s · Head speed {hs} m/s ({club})",
  "※ 飛行中は線を描かず、打球の候補を一旦すべて記録 → 物理法則（放物線・重力）に合致する軌道だけを逆算抽出し、約1.5秒後にトレーサーを描画します。これにより風で揺れるネット・木々・人・影などのノイズを誤検知しません。打音（マイク）が使える場合はインパクトを基準に時間枠を絞り精度が上がります。飛距離・最高到達点・初速・ミート率は、クラブとヘッドスピードからの物理推定値です（β）。":
    "* During flight no line is drawn; every shot candidate is recorded first, then only trajectories matching physics (parabola, gravity) are back-solved and the tracer is drawn after about 1.5s. This avoids false detections from wind-swaying nets, trees, people, or shadows. When impact sound (mic) is available, the time window is narrowed around impact for higher accuracy. Distance, apex, ball speed, and smash factor are physics estimates from club and head speed (beta).",
  "最高到達点 {apex}m": "Apex {apex}m",
  "🎬 3Dズーム・リプレイ": "🎬 3D Zoom Replay",
  "🔄 もう一度": "🔄 Again",
  "仮想カメラが打席後方→上空→ピン側へ回り込み、推定した3D弾道（放物線・着弾・転がり）を再現します。弾道は計測した球筋とクラブ推定値からの再構成です（β）。":
    "A virtual camera sweeps from behind the tee → overhead → pin side, recreating the estimated 3D flight (parabola, landing, roll). The trajectory is reconstructed from the measured shot shape and club estimates (beta).",
  "まだ弾道データがありません。": "No flight data yet.",
  "「トレーサー」で計測すると分布図が作られます。":
    "Measure in “Tracer” to build the distribution chart.",
  "{a}と{b}のキャリーが近接（{ca}m / {cb}m）。番手が機能していない可能性があります。":
    "{a} and {b} have similar carry ({ca}m / {cb}m). Your gapping may not be working.",
  "クラブ・マトリクス（キャリー × 最高到達点）": "Club matrix (carry × apex)",
  "キャリー": "Carry",
  "高さ": "Height",
  "📐 フィッティング示唆：": "📐 Fitting insight:",
  "クラブ別 平均": "Average by club",
  "{carry}m ・ 高さ{apex}m ・ {n}球": "{carry}m · height {apex}m · {n} shots",
  "ドライバー": "Driver",
  "5番アイアン": "5 iron",
  "7番アイアン": "7 iron",
  "9番アイアン": "9 iron",
  "ストレート": "Straight",
  "ドロー": "Draw",
  "フェード": "Fade",
  "スライス": "Slice",
  "フック": "Hook",
};
