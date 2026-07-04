"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { PageHeader, Card, Stat } from "@/components/ui";
import {
  CLUBS,
  clubLabel,
  estimateBall,
  classifyShape,
  shapeLabel,
  shapeColor,
} from "@/lib/golf";
import { fetchBallShots, saveBallShot, fetchSwings } from "@/lib/db";
import { useT } from "@/lib/i18n";
import type { BallShot, BallShape, Swing } from "@/lib/types";
import {
  findMovingBlobs,
  extractTrajectory,
  type Detection,
  type RawBlob,
  type Trajectory,
} from "@/lib/tracer";

interface Pt {
  x: number;
  y: number;
}

export default function TracerPage() {
  const t = useT();
  const [tab, setTab] = useState<"trace" | "matrix">("trace");
  const [shots, setShots] = useState<BallShot[]>([]);
  const reload = useCallback(async () => setShots(await fetchBallShots(300)), []);
  useEffect(() => {
    (async () => setShots(await fetchBallShots(300)))();
  }, []);

  return (
    <main>
      <PageHeader title={t("AR弾道トレーサー")} subtitle={t("球筋を判定し弾道を描画（β）")} back />
      <div className="px-4">
        <div className="flex gap-2 mb-4">
          {(["trace", "matrix"] as const).map((tabId) => (
            <button
              key={tabId}
              onClick={() => setTab(tabId)}
              className="btn flex-1 py-2.5 text-sm"
              style={{
                background: tab === tabId ? "var(--green)" : "var(--card)",
                color: tab === tabId ? "#03260f" : "var(--fg)",
                border: "1px solid var(--line)",
              }}
            >
              {tabId === "trace" ? t("🎥 トレーサー") : t("📐 クラブ・マトリクス")}
            </button>
          ))}
        </div>
        {tab === "trace" ? <Tracer onSaved={reload} /> : <Matrix shots={shots} />}
      </div>
    </main>
  );
}

function Tracer({ onSaved }: { onSaved: () => void }) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const diffRef = useRef<HTMLCanvasElement | null>(null);
  const prevRef = useRef<Uint8ClampedArray | null>(null);
  const rafRef = useRef(0);

  // Rolling buffer of EVERY moving-blob candidate (ball + noise) with timestamps.
  const bufferRef = useRef<Detection[]>([]);
  const prevBlobsRef = useRef<RawBlob[]>([]); // previous frame's blobs (visual launch)
  const t0Ref = useRef<number | null>(null); // armed impact time (s), null = watching
  const analyzeAtRef = useRef(0); // perf-ms at which to run backward verification
  const revealRef = useRef<{ traj: Trajectory; shape: BallShape; start: number } | null>(null);

  // Impact-sound detection (layer 2): a sharp audio transient sets t0.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const soundBaseRef = useRef(0.02);
  const lastImpactRef = useRef(0);

  const [phase, setPhase] = useState<"watching" | "capturing">("watching");
  const [missed, setMissed] = useState(false); // verification found no valid flight
  const missedTimerRef = useRef(0);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [club, setClub] = useState("DR");
  const [headSpeed, setHeadSpeed] = useState(0); // 0 = use default
  const [result, setResult] = useState<{
    shape: BallShape;
    apex: number;
    carry: number;
    ballSpeed: number;
    smash: number;
    pts: Pt[];
  } | null>(null);
  const clubRef = useRef(club);
  const headSpeedRef = useRef(headSpeed);
  useEffect(() => { clubRef.current = club; }, [club]);
  useEffect(() => { headSpeedRef.current = headSpeed; }, [headSpeed]);

  // Buffer / flight-window timing (seconds unless suffixed _MS).
  const BUFFER_S = 3.6; // how much history to retain
  const PRE_S = 0.3; // include just before impact (catches the launch frame)
  const MAX_FLIGHT_S = 2.2; // longest plausible flight to inspect
  const ANALYZE_DELAY_MS = 1700; // "verify the past from the future" delay (~1.7s)
  const REVEAL_MS = 750; // dramatic line-grow animation
  const LAUNCH = 0.035; // visual-launch displacement / frame (fallback trigger)

  // Pre-fill head speed from the latest analyzed swing of this club.
  useEffect(() => {
    (async () => {
      const sw: Swing[] = await fetchSwings(60);
      const m = sw.find((s) => s.club === club && s.head_speed);
      setHeadSpeed(m?.head_speed ?? 0);
    })();
  }, [club]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    audioCtxRef.current?.close().catch(() => {});
    cancelAnimationFrame(rafRef.current);
    window.clearTimeout(missedTimerRef.current);
  }, []);

  async function startCam() {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert(t("このブラウザ/接続ではカメラを利用できません（HTTPS環境が必要です）。"));
      return;
    }
    let s: MediaStream | null = null;
    // Request audio too so the impact-sound trigger can work; degrade to
    // video-only (visual-launch trigger) if the mic is unavailable/denied.
    const tries: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: true },
      { video: true, audio: true },
      { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false },
      { video: true, audio: false },
    ];
    for (const c of tries) {
      try { s = await navigator.mediaDevices.getUserMedia(c); break; } catch { /* next */ }
    }
    if (!s) { alert(t("カメラを起動できませんでした。")); return; }
    streamRef.current = s;
    if (videoRef.current) {
      videoRef.current.srcObject = s;
      videoRef.current.playsInline = true;
      await videoRef.current.play().catch(() => {});
    }
    if (!diffRef.current) {
      // Detection resolution: at 160×120 a golf ball a few metres away shrinks
      // below one pixel and frame differencing never sees it. 320×240 keeps the
      // per-frame cost low while giving the ball a 2–8 px footprint.
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = 240;
      diffRef.current = c;
    }
    // Set up impact-sound analyser if we captured an audio track.
    setMicOn(false);
    if (s.getAudioTracks().length) {
      try {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AC) {
          const actx = new AC();
          await actx.resume().catch(() => {});
          const src = actx.createMediaStreamSource(s);
          const an = actx.createAnalyser();
          an.fftSize = 1024;
          src.connect(an);
          audioCtxRef.current = actx;
          analyserRef.current = an;
          audioBufRef.current = new Uint8Array(an.fftSize);
          soundBaseRef.current = 0.02;
          setMicOn(true);
        }
      } catch { setMicOn(false); }
    }
    prevRef.current = null;
    bufferRef.current = [];
    prevBlobsRef.current = [];
    t0Ref.current = null;
    revealRef.current = null;
    lastImpactRef.current = 0;
    setPhase("watching");
    setResult(null);
    setCamOn(true);
    rafRef.current = requestAnimationFrame(loop);
  }

  function stopCam() {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    cancelAnimationFrame(rafRef.current);
    revealRef.current = null;
    t0Ref.current = null;
    setPhase("watching");
    setCamOn(false);
  }

  function loop(now: number) {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const dc = diffRef.current;
    if (video && canvas && dc && video.readyState >= 2 && video.videoWidth) {
      if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      const dctx = dc.getContext("2d", { willReadFrequently: true });
      const octx = canvas.getContext("2d");
      if (dctx && octx) {
        dctx.drawImage(video, 0, 0, dc.width, dc.height);
        const cur = dctx.getImageData(0, 0, dc.width, dc.height);
        const prev = prevRef.current;
        if (prev) captureStep(cur.data, prev, dc.width, dc.height, now);
        prevRef.current = cur.data.slice(0);

        // Render: NOTHING during flight/verification (no garbage lines). Only a
        // validated trajectory is ever drawn, as a delayed dramatic reveal.
        octx.clearRect(0, 0, canvas.width, canvas.height);
        if (revealRef.current) drawReveal(octx, canvas.width, canvas.height, now);
      }
    }
    rafRef.current = requestAnimationFrame(loop);
  }

  function captureStep(cur: Uint8ClampedArray, prev: Uint8ClampedArray, w: number, h: number, now: number) {
    const tSec = now / 1000;
    const blobs = findMovingBlobs(cur, prev, w, h);

    // Buffer all candidates, then prune to the rolling window.
    for (const b of blobs) bufferRef.current.push({ ...b, t: tSec });
    const cutoff = tSec - BUFFER_S;
    if (bufferRef.current.length > 4000 || (bufferRef.current[0]?.t ?? tSec) < cutoff) {
      bufferRef.current = bufferRef.current.filter((d) => d.t >= cutoff);
    }

    if (t0Ref.current == null) {
      // Layer 2: impact sound. Layer (fallback): visual launch.
      if (!detectImpactSound(now)) tryVisualLaunch(blobs, now);
    } else if (now >= analyzeAtRef.current) {
      analyze();
    }
    prevBlobsRef.current = blobs;
  }

  // Sharp audio transient → impact. Returns true if it armed this frame.
  function detectImpactSound(now: number): boolean {
    const an = analyserRef.current;
    const buf = audioBufRef.current;
    if (!an || !buf) return false;
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const x = (buf[i] - 128) / 128;
      sum += x * x;
    }
    const rms = Math.sqrt(sum / buf.length);
    const base = soundBaseRef.current;
    soundBaseRef.current = base * 0.95 + rms * 0.05; // slow ambient baseline
    if (rms > Math.max(0.07, base * 4) && now - lastImpactRef.current > 1200) {
      lastImpactRef.current = now;
      arm(now);
      return true;
    }
    return false;
  }

  // A small blob that jumped far since last frame = the struck ball launching.
  function tryVisualLaunch(blobs: RawBlob[], now: number) {
    let bestDisp = LAUNCH;
    let launched = false;
    for (const b of blobs) {
      let near = 1;
      for (const pb of prevBlobsRef.current) {
        const d = Math.hypot(b.x - pb.x, b.y - pb.y);
        if (d < near) near = d;
      }
      if (near > bestDisp && near < 0.45) { bestDisp = near; launched = true; }
    }
    if (launched) arm(now);
  }

  function arm(now: number) {
    if (t0Ref.current != null) return;
    t0Ref.current = now / 1000;
    analyzeAtRef.current = now + ANALYZE_DELAY_MS;
    revealRef.current = null; // clear any previous trace
    window.clearTimeout(missedTimerRef.current);
    setMissed(false);
    setResult(null);
    setPhase("capturing");
  }

  // Backward verification: recover the one physically-valid flight from the
  // buffered window, or discard silently (no false line).
  function analyze() {
    const t0 = t0Ref.current;
    t0Ref.current = null;
    setPhase("watching");
    if (t0 == null) return;
    const lo = t0 - PRE_S;
    const hi = t0 + MAX_FLIGHT_S;
    const dets = bufferRef.current.filter((d) => d.t >= lo && d.t <= hi);
    const traj = extractTrajectory(dets);
    if (!traj) {
      // Noise only → draw nothing, but tell the user we looked (a silent
      // discard reads as "the tracer is not reacting at all").
      setMissed(true);
      window.clearTimeout(missedTimerRef.current);
      missedTimerRef.current = window.setTimeout(() => setMissed(false), 3000);
      return;
    }

    const shape = classifyShape(traj.maxDev);
    const est = estimateBall(clubRef.current, headSpeedRef.current);
    revealRef.current = { traj, shape, start: performance.now() };
    setResult({ shape, apex: est.apex, carry: est.carry, ballSpeed: est.ballSpeed, smash: est.smash, pts: traj.pts });
    if (navigator.vibrate) navigator.vibrate(20);
    saveBallShot({
      club: clubRef.current,
      shape,
      apex_m: est.apex,
      carry_m: est.carry,
      ball_speed: est.ballSpeed,
      head_speed: est.headSpeed,
      smash: est.smash,
      curve_px: Math.round(traj.maxDev * 1000) / 1000,
    }).then(() => onSaved());
  }

  // Dramatic reveal: the light line streaks from launch to landing (the "シュワッ"
  // effect), parametrised by an eased progress over REVEAL_MS, then holds.
  function drawReveal(ctx: CanvasRenderingContext2D, w: number, h: number, now: number) {
    const rv = revealRef.current!;
    const pts = rv.traj.pts;
    if (pts.length < 2) return;
    const raw = Math.max(0, Math.min(1, (now - rv.start) / REVEAL_MS));
    const p = raw * raw * (3 - 2 * raw); // smoothstep
    const col = shapeColor(rv.shape);
    const head = p * (pts.length - 1);
    const upto = Math.floor(head);

    ctx.save();
    ctx.shadowBlur = Math.max(8, w / 80);
    ctx.shadowColor = col;
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(3, w / 170);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x * w, pts[0].y * h);
    for (let i = 1; i <= upto; i++) ctx.lineTo(pts[i].x * w, pts[i].y * h);
    // partial segment to the moving head
    if (upto < pts.length - 1) {
      const f = head - upto;
      const hx = (pts[upto].x + (pts[upto + 1].x - pts[upto].x) * f) * w;
      const hy = (pts[upto].y + (pts[upto + 1].y - pts[upto].y) * f) * h;
      ctx.lineTo(hx, hy);
      ctx.stroke();
      // leading comet dot
      ctx.shadowBlur = Math.max(10, w / 60);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(hx, hy, Math.max(3, w / 150), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.stroke();
      // apex marker once fully revealed
      let apexI = 0;
      pts.forEach((pt, i) => { if (pt.y < pts[apexI].y) apexI = i; });
      const ap = pts[apexI];
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(ap.x * w, ap.y * h, Math.max(4, w / 150), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  const live = estimateBall(club, headSpeed);

  return (
    <div className="space-y-4">
      <Card className="p-0 overflow-hidden">
        <div className="relative bg-black aspect-[3/4]">
          <video ref={videoRef} playsInline autoPlay muted className="absolute inset-0 w-full h-full object-contain" />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
          {!camOn && (
            <div className="absolute inset-0 grid place-items-center text-center px-6">
              <div>
                <div className="text-4xl mb-2">🎥</div>
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  {t("飛球線の後方から、ボールと打ち出し方向が")}<br />
                  {t("両方映るようにカメラを固定してください。")}<br />
                  {t("打つと弾道を物理検証し、約1.5秒後に描画します（屋外OK）。")}
                </p>
              </div>
            </div>
          )}
          {camOn && (
            <div className="absolute top-2 left-2 px-3 py-1 rounded-full text-xs font-bold"
              style={{ background: "rgba(0,0,0,0.6)", color: phase === "capturing" ? "#fbbf24" : "#fff" }}>
              {phase === "capturing" ? t("● 弾道を物理検証中…") : t("○ 監視中 — 打ってください")}
            </div>
          )}
          {camOn && (
            <div className="absolute bottom-2 left-2 px-2.5 py-1 rounded-full text-[10px] font-bold"
              style={{ background: "rgba(0,0,0,0.55)", color: micOn ? "#4ade80" : "#9ca3af" }}>
              {micOn ? t("🎙 打音同期 ON") : t("🎙 打音OFF（映像検知）")}
            </div>
          )}
          {camOn && (
            <button onClick={stopCam} className="absolute top-2 right-2 btn btn-ghost text-xs px-3 py-1.5">
              {t("停止")}
            </button>
          )}
          {result && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full text-sm font-bold flex items-center gap-2"
              style={{ background: shapeColor(result.shape), color: "#04121f" }}>
              {t(shapeLabel(result.shape))} ・ Peak {result.apex}m
            </div>
          )}
          {missed && !result && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full text-xs font-bold text-center"
              style={{ background: "rgba(0,0,0,0.65)", color: "#fbbf24" }}>
              {t("⚠ 弾道を検出できず。ボールが大きく映る位置から撮ってみてください")}
            </div>
          )}
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs" style={{ color: "var(--muted)" }}>{t("クラブ")}</span>
            <select value={club} onChange={(e) => setClub(e.target.value)} className="w-full px-3 py-2.5 mt-1">
              {CLUBS.map((c) => (
                <option key={c.id} value={c.id}>{t(c.label)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs" style={{ color: "var(--muted)" }}>{t("ヘッドスピード (m/s)")}</span>
            <input
              type="number"
              inputMode="decimal"
              value={headSpeed || ""}
              placeholder={`${live.headSpeed}`}
              onChange={(e) => setHeadSpeed(Number(e.target.value) || 0)}
              className="w-full px-3 py-2.5 mt-1"
            />
          </label>
        </div>
        <p className="text-[11px]" style={{ color: "var(--muted)" }}>
          {t("スイング解析で計測したヘッドスピードを自動反映。空欄ならクラブ標準値（{hs}m/s）で推定します。", { hs: live.headSpeed })}
        </p>
      </Card>

      {!camOn ? (
        <button onClick={startCam} className="btn btn-primary w-full py-3.5">
          {t("📷 カメラを起動して計測")}
        </button>
      ) : null}

      {result && (
        <>
          <div className="grid grid-cols-4 gap-2">
            <Stat label={t("球筋")} value={t(shapeLabel(result.shape))} accent={shapeColor(result.shape)} />
            <Stat label={t("最高到達点")} value={result.apex} unit="m" accent="var(--cyan)" />
            <Stat label={t("推定キャリー")} value={result.carry} unit="m" accent="var(--green)" />
            <Stat label={t("ミート率")} value={result.smash.toFixed(2)} accent="#fbbf24" />
          </div>
          <Replay3D shape={result.shape} apex={result.apex} carry={result.carry} />
          <Card>
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              {t("推定初速 {ballSpeed} m/s ・ ヘッドスピード {hs} m/s（{club}）", { ballSpeed: result.ballSpeed, hs: live.headSpeed, club: t(clubLabel(club)) })}
            </div>
          </Card>
        </>
      )}

      <p className="text-[11px] leading-relaxed px-1" style={{ color: "var(--muted)" }}>
        {t("※ 飛行中は線を描かず、打球の候補を一旦すべて記録 → 物理法則（放物線・重力）に合致する軌道だけを逆算抽出し、約1.5秒後にトレーサーを描画します。これにより風で揺れるネット・木々・人・影などのノイズを誤検知しません。打音（マイク）が使える場合はインパクトを基準に時間枠を絞り精度が上がります。飛距離・最高到達点・初速・ミート率は、クラブとヘッドスピードからの物理推定値です（β）。")}
      </p>
    </div>
  );
}

// ---- 3D zoom replay -------------------------------------------------------
interface V3 {
  x: number;
  y: number;
  z: number;
}
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot3 = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm3 = (a: V3): V3 => {
  const m = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / m, y: a.y / m, z: a.z / m };
};
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Reconstruct a 3D ball flight (metres) from the estimated parameters.
function buildFlight(shape: BallShape, apex: number, carry: number) {
  const N = 64;
  const dirMap: Record<string, number> = { straight: 0, draw: -1, fade: 1, slice: 1, hook: -1 };
  const magMap: Record<string, number> = { straight: 0, draw: 0.05, fade: 0.06, slice: 0.14, hook: 0.13 };
  const dir = dirMap[shape] ?? 0;
  const mag = (magMap[shape] ?? 0) * carry;
  const flight: V3[] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    flight.push({ x: dir * mag * Math.pow(u, 1.8), y: 4 * apex * u * (1 - u), z: carry * u });
  }
  const landing = flight[flight.length - 1];
  const prev = flight[flight.length - 3];
  let dx = landing.x - prev.x;
  let dz = landing.z - prev.z;
  const dl = Math.hypot(dx, dz) || 1;
  dx /= dl;
  dz /= dl;
  const rollLen = Math.max(2, carry * 0.07);
  const roll: V3[] = [];
  const Rn = 12;
  for (let i = 1; i <= Rn; i++) {
    const u = i / Rn;
    roll.push({ x: landing.x + dx * rollLen * u, y: 0, z: landing.z + dz * rollLen * u });
  }
  return { flight, roll, landing: roll[roll.length - 1] };
}

// Cinematic camera: tee-behind → drone 3/4 → pin-side → overhead-on-landing.
function cameraAt(t: number, mid: V3, landing: V3, carry: number) {
  const keys = [
    { t: 0, tgt: { x: 0, y: Math.max(2, mid.y * 0.3), z: carry * 0.12 }, yaw: 0, pitch: 0.14, dist: carry * 0.38 },
    { t: 0.4, tgt: mid, yaw: -0.55, pitch: 0.66, dist: carry * 0.95 },
    { t: 0.72, tgt: landing, yaw: 2.7, pitch: 0.38, dist: carry * 0.55 },
    { t: 1, tgt: landing, yaw: 3.5, pitch: 0.95, dist: carry * 0.5 },
  ];
  let k = 0;
  while (k < keys.length - 2 && t > keys[k + 1].t) k++;
  const a = keys[k];
  const b = keys[k + 1];
  const u = smooth(Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t || 1))));
  return {
    target: { x: lerp(a.tgt.x, b.tgt.x, u), y: lerp(a.tgt.y, b.tgt.y, u), z: lerp(a.tgt.z, b.tgt.z, u) },
    yaw: lerp(a.yaw, b.yaw, u),
    pitch: lerp(a.pitch, b.pitch, u),
    dist: lerp(a.dist, b.dist, u),
  };
}

function Replay3D({ shape, apex, carry }: { shape: BallShape; apex: number; carry: number }) {
  const tr = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const tRef = useRef(0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const { flight, roll, landing } = buildFlight(shape, apex, carry);
    const mid: V3 = { x: flight[Math.floor(flight.length * 0.5)].x, y: apex * 0.6, z: carry * 0.5 };
    const col = shapeColor(shape);
    const DURATION = 5;
    const focal = H * 0.95;

    const proj = (p: V3, cam: ReturnType<typeof cameraAt>) => {
      const cp = Math.cos(cam.pitch);
      const sp = Math.sin(cam.pitch);
      const cyaw = Math.cos(cam.yaw);
      const syaw = Math.sin(cam.yaw);
      const camPos: V3 = {
        x: cam.target.x + cam.dist * cp * syaw,
        y: cam.target.y + cam.dist * sp,
        z: cam.target.z - cam.dist * cp * cyaw,
      };
      const f = norm3(sub(cam.target, camPos));
      const r = norm3(cross(f, { x: 0, y: 1, z: 0 }));
      const up = cross(r, f);
      const v = sub(p, camPos);
      const cz = dot3(v, f);
      if (cz <= 0.05) return null;
      return { x: W / 2 + (dot3(v, r) / cz) * focal, y: H / 2 - (dot3(v, up) / cz) * focal };
    };

    tRef.current = 0;
    let last = performance.now();
    const render = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      tRef.current = Math.min(1, tRef.current + dt / DURATION);
      const t = tRef.current;
      const cam = cameraAt(t, mid, landing, carry);

      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#0b2545");
      sky.addColorStop(1, "#11324f");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      const gw = Math.max(8, Math.abs(landing.x) + 6);
      const gz = Math.max(5, Math.round(carry / 8));
      ctx.strokeStyle = "rgba(120,190,150,0.25)";
      ctx.lineWidth = 1;
      for (let z = 0; z <= carry + 1; z += gz) {
        const p1 = proj({ x: -gw, y: 0, z }, cam);
        const p2 = proj({ x: gw, y: 0, z }, cam);
        if (p1 && p2) { ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); }
      }
      for (let x = -gw; x <= gw + 1; x += gz) {
        const p1 = proj({ x, y: 0, z: 0 }, cam);
        const p2 = proj({ x, y: 0, z: carry }, cam);
        if (p1 && p2) { ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); }
      }

      for (const [rad, color] of [[2, "rgba(245,158,11,0.8)"], [1, "rgba(34,197,94,0.95)"]] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i <= 28; i++) {
          const a = (i / 28) * Math.PI * 2;
          const pp = proj({ x: landing.x + Math.cos(a) * rad, y: 0, z: landing.z + Math.sin(a) * rad }, cam);
          if (!pp) { started = false; continue; }
          if (!started) { ctx.moveTo(pp.x, pp.y); started = true; } else ctx.lineTo(pp.x, pp.y);
        }
        ctx.stroke();
      }

      let ballPos: V3;
      let flightFrac: number;
      if (t < 0.62) {
        flightFrac = t / 0.62;
        const fi = flightFrac * (flight.length - 1);
        const lo = Math.floor(fi);
        const hi = Math.min(flight.length - 1, lo + 1);
        const u = fi - lo;
        ballPos = { x: lerp(flight[lo].x, flight[hi].x, u), y: lerp(flight[lo].y, flight[hi].y, u), z: lerp(flight[lo].z, flight[hi].z, u) };
      } else {
        flightFrac = 1;
        const ri = Math.min(1, (t - 0.62) / 0.1) * (roll.length - 1);
        const lo = Math.floor(ri);
        const hi = Math.min(roll.length - 1, lo + 1);
        const u = ri - lo;
        ballPos = { x: lerp(roll[lo].x, roll[hi].x, u), y: 0, z: lerp(roll[lo].z, roll[hi].z, u) };
      }

      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let st = false;
      for (const p of flight) {
        const pp = proj(p, cam);
        if (!pp) { st = false; continue; }
        if (!st) { ctx.moveTo(pp.x, pp.y); st = true; } else ctx.lineTo(pp.x, pp.y);
      }
      ctx.stroke();

      const upto = Math.max(1, Math.floor(flightFrac * (flight.length - 1)));
      ctx.save();
      ctx.shadowBlur = 12;
      ctx.shadowColor = col;
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.beginPath();
      st = false;
      for (let i = 0; i <= upto; i++) {
        const pp = proj(flight[i], cam);
        if (!pp) { st = false; continue; }
        if (!st) { ctx.moveTo(pp.x, pp.y); st = true; } else ctx.lineTo(pp.x, pp.y);
      }
      ctx.stroke();
      ctx.restore();

      const sh = proj({ x: ballPos.x, y: 0, z: ballPos.z }, cam);
      if (sh) {
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.beginPath();
        ctx.ellipse(sh.x, sh.y, 5, 2.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      const bp = proj(ballPos, cam);
      if (bp) {
        ctx.save();
        ctx.shadowBlur = 14;
        ctx.shadowColor = "#fff";
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(bp.x, bp.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      const apexPt = flight[Math.round(flight.length * 0.5)];
      const ap = proj({ ...apexPt, y: apex }, cam);
      if (ap && t > 0.3) {
        ctx.fillStyle = "#22d3ee";
        ctx.font = "bold 12px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(tr("最高到達点 {apex}m", { apex }), ap.x, ap.y - 8);
      }
      const lp = proj({ ...landing, y: 0 }, cam);
      if (lp && t > 0.55) {
        ctx.fillStyle = "#22c55e";
        ctx.font = "bold 12px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(`${carry}m`, lp.x, lp.y + 16);
      }

      if (t < 1) rafRef.current = requestAnimationFrame(render);
    };
    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [shape, apex, carry, nonce, tr]);

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-bold">{tr("🎬 3Dズーム・リプレイ")}</div>
        <button onClick={() => setNonce((n) => n + 1)} className="btn btn-ghost text-xs px-3 py-1">
          {tr("🔄 もう一度")}
        </button>
      </div>
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--line)" }}>
        <canvas ref={canvasRef} width={340} height={300} className="w-full block" />
      </div>
      <p className="text-[10px] mt-2" style={{ color: "var(--muted)" }}>
        {tr("仮想カメラが打席後方→上空→ピン側へ回り込み、推定した3D弾道（放物線・着弾・転がり）を再現します。弾道は計測した球筋とクラブ推定値からの再構成です（β）。")}
      </p>
    </Card>
  );
}

function Matrix({ shots }: { shots: BallShot[] }) {
  const t = useT();
  const byClub = CLUBS.map((c) => {
    const list = shots.filter((s) => s.club === c.id);
    return { club: c, list };
  }).filter((g) => g.list.length > 0);

  if (shots.length === 0) {
    return (
      <Card className="text-center py-10 text-sm" style={{ color: "var(--muted)" }}>
        {t("まだ弾道データがありません。")}<br />{t("「トレーサー」で計測すると分布図が作られます。")}
      </Card>
    );
  }

  const palette = ["#ef4444", "#f59e0b", "#22c55e", "#22d3ee", "#3b82f6", "#a78bfa", "#ec4899", "#84cc16"];
  const data = byClub.map((g, i) => ({
    name: t(g.club.label),
    color: palette[i % palette.length],
    points: g.list.map((s) => ({ x: s.carry_m ?? 0, y: s.apex_m ?? 0, hs: s.head_speed ?? 0 })),
    avgCarry: Math.round(g.list.reduce((a, s) => a + (s.carry_m ?? 0), 0) / g.list.length),
    avgApex: Math.round(g.list.reduce((a, s) => a + (s.apex_m ?? 0), 0) / g.list.length),
  }));

  // Gapping insight: adjacent clubs with overlapping carry.
  let insight = "";
  const sorted = [...data].sort((a, b) => b.avgCarry - a.avgCarry);
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].avgCarry - sorted[i - 1].avgCarry) <= 6) {
      insight = t("{a}と{b}のキャリーが近接（{ca}m / {cb}m）。番手が機能していない可能性があります。", { a: sorted[i - 1].name, b: sorted[i].name, ca: sorted[i - 1].avgCarry, cb: sorted[i].avgCarry });
      break;
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
          {t("クラブ・マトリクス（キャリー × 最高到達点）")}
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <ScatterChart margin={{ top: 10, right: 12, bottom: 16, left: -8 }}>
            <XAxis
              type="number"
              dataKey="x"
              name={t("キャリー")}
              unit="m"
              tick={{ fill: "#93a4bf", fontSize: 10 }}
              axisLine={{ stroke: "#243651" }}
              tickLine={false}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={t("高さ")}
              unit="m"
              tick={{ fill: "#93a4bf", fontSize: 10 }}
              axisLine={{ stroke: "#243651" }}
              tickLine={false}
            />
            <ZAxis range={[60, 60]} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              contentStyle={{ background: "#16233a", border: "1px solid #243651", borderRadius: 12, fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {data.map((d) => (
              <Scatter key={d.name} name={d.name} data={d.points} fill={d.color} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </Card>

      {insight && (
        <Card>
          <div className="text-sm">
            <span style={{ color: "var(--amber)" }}>{t("📐 フィッティング示唆：")}</span> {insight}
          </div>
        </Card>
      )}

      <Card>
        <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>{t("クラブ別 平均")}</div>
        <div className="space-y-1.5 text-sm">
          {data.map((d) => (
            <div key={d.name} className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                {d.name}
              </span>
              <span style={{ color: "var(--muted)" }}>
                {t("{carry}m ・ 高さ{apex}m ・ {n}球", { carry: d.avgCarry, apex: d.avgApex, n: d.points.length })}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
