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
import type { BallShot, BallShape, Swing } from "@/lib/types";

interface Pt {
  x: number;
  y: number;
}

interface Blob {
  x: number; // normalized centroid
  y: number;
  size: number;
  score: number;
  moved: boolean;
}

// Find moving blobs of ANY color (golf balls may be white, yellow, orange…).
// Outdoors the struck ball is identified by SPEED + trajectory continuity, not
// color: here we extract small, compact moving regions; the caller picks the
// fastest-moving one as the ball.
function findMovingBlobs(
  cur: Uint8ClampedArray,
  prev: Uint8ClampedArray,
  w: number,
  h: number,
): Blob[] {
  const n = w * h;
  const mask = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    // Frame difference (motion). A fast ball produces a strong local change.
    const d =
      Math.abs(cur[i] - prev[i]) + Math.abs(cur[i + 1] - prev[i + 1]) + Math.abs(cur[i + 2] - prev[i + 2]);
    if (d > 60) mask[p] = 1;
  }

  const BALL_MIN = 2;
  const BALL_MAX = 150; // a small object; the body/club connect into larger blobs
  const blobs: Blob[] = [];
  const stack = new Int32Array(n);
  const seen = new Uint8Array(n);
  for (let start = 0; start < n; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;
    while (sp > 0) {
      const p = stack[--sp];
      const px = p % w;
      const py = (p / w) | 0;
      count++;
      sumX += px;
      sumY += py;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      if (px > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (px < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (py > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (py < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    if (count < BALL_MIN || count > BALL_MAX) continue;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const aspect = bw / bh;
    if (aspect < 0.25 || aspect > 4) continue; // allow some motion-blur streaking
    const fill = count / (bw * bh);
    if (fill < 0.3) continue;
    blobs.push({
      x: sumX / count / w,
      y: sumY / count / h,
      size: count,
      score: fill - count / (BALL_MAX * 2), // prefer small & compact
      moved: true,
    });
  }
  blobs.sort((a, b) => b.score - a.score);
  return blobs;
}

export default function TracerPage() {
  const [tab, setTab] = useState<"trace" | "matrix">("trace");
  const [shots, setShots] = useState<BallShot[]>([]);
  const reload = useCallback(async () => setShots(await fetchBallShots(300)), []);
  useEffect(() => {
    (async () => setShots(await fetchBallShots(300)))();
  }, []);

  return (
    <main>
      <PageHeader title="AR弾道トレーサー" subtitle="球筋を判定し弾道を描画（β）" back />
      <div className="px-4">
        <div className="flex gap-2 mb-4">
          {(["trace", "matrix"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="btn flex-1 py-2.5 text-sm"
              style={{
                background: tab === t ? "var(--green)" : "var(--card)",
                color: tab === t ? "#03260f" : "var(--fg)",
                border: "1px solid var(--line)",
              }}
            >
              {t === "trace" ? "🎥 トレーサー" : "📐 クラブ・マトリクス"}
            </button>
          ))}
        </div>
        {tab === "trace" ? <Tracer onSaved={reload} /> : <Matrix shots={shots} />}
      </div>
    </main>
  );
}

function Tracer({ onSaved }: { onSaved: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const diffRef = useRef<HTMLCanvasElement | null>(null);
  const prevRef = useRef<Uint8ClampedArray | null>(null);
  const rafRef = useRef(0);
  const activeRef = useRef(false);
  const ptsRef = useRef<Pt[]>([]);
  const velRef = useRef<Pt>({ x: 0, y: 0 });
  const prevBlobsRef = useRef<Blob[]>([]); // last frame's moving blobs
  const lastSeenRef = useRef(0);
  const startMsRef = useRef(0);
  const [tracking, setTracking] = useState(false);

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
  useEffect(() => {
    clubRef.current = club;
  }, [club]);

  // Pre-fill head speed from the latest analyzed swing of this club.
  useEffect(() => {
    (async () => {
      const sw: Swing[] = await fetchSwings(60);
      const m = sw.find((s) => s.club === club && s.head_speed);
      setHeadSpeed(m?.head_speed ?? 0);
    })();
  }, [club]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    cancelAnimationFrame(rafRef.current);
  }, []);

  async function startCam() {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("このブラウザ/接続ではカメラを利用できません（HTTPS環境が必要です）。");
      return;
    }
    let s: MediaStream | null = null;
    try {
      s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false });
    } catch {
      try {
        s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch {
        alert("カメラを起動できませんでした。");
        return;
      }
    }
    streamRef.current = s;
    if (videoRef.current) {
      videoRef.current.srcObject = s;
      videoRef.current.playsInline = true;
      await videoRef.current.play().catch(() => {});
    }
    if (!diffRef.current) {
      const c = document.createElement("canvas");
      c.width = 160;
      c.height = 120;
      diffRef.current = c;
    }
    prevRef.current = null;
    activeRef.current = false;
    ptsRef.current = [];
    prevBlobsRef.current = [];
    setTracking(false);
    setResult(null);
    setCamOn(true);
    rafRef.current = requestAnimationFrame(loop);
  }

  function stopCam() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    cancelAnimationFrame(rafRef.current);
    setTracking(false);
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
        if (prev) detectStep(cur.data, prev, dc.width, dc.height, now);
        prevRef.current = cur.data.slice(0);
        // draw tracer overlay
        octx.clearRect(0, 0, canvas.width, canvas.height);
        if (ptsRef.current.length > 1) drawTracer(octx, canvas.width, canvas.height, ptsRef.current);
      }
    }
    rafRef.current = requestAnimationFrame(loop);
  }

  // Launch when a small blob suddenly moves fast (the struck ball is by far the
  // fastest object in frame); confirmed by trajectory length in finalize().
  const LAUNCH = 0.035; // normalized displacement / frame
  const GATE = 0.34; // tracking search radius

  function detectStep(cur: Uint8ClampedArray, prev: Uint8ClampedArray, w: number, h: number, now: number) {
    const moving = findMovingBlobs(cur, prev, w, h);

    if (activeRef.current) {
      // Track the ball: nearest moving blob to the predicted (vel-extrapolated) spot.
      const last = ptsRef.current[ptsRef.current.length - 1];
      const pred = { x: last.x + velRef.current.x, y: last.y + velRef.current.y };
      let best: Blob | null = null;
      let bd = GATE;
      for (const b of moving) {
        const d = Math.hypot(b.x - pred.x, b.y - pred.y);
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      if (best) {
        velRef.current = { x: best.x - last.x, y: best.y - last.y };
        ptsRef.current.push({ x: best.x, y: best.y });
        lastSeenRef.current = now;
      }
      if (now - lastSeenRef.current > 180 || now - startMsRef.current > 2500) finalize();
      prevBlobsRef.current = moving;
      return;
    }

    // Idle: find the blob that just moved the FASTEST (largest displacement from
    // any blob in the previous frame) — that's the launched ball.
    let launchBlob: Blob | null = null;
    let launchFrom: Pt | null = null;
    let bestDisp = LAUNCH;
    for (const b of moving) {
      let near = 1;
      let from: Pt | null = null;
      for (const pb of prevBlobsRef.current) {
        const d = Math.hypot(b.x - pb.x, b.y - pb.y);
        if (d < near) {
          near = d;
          from = { x: pb.x, y: pb.y };
        }
      }
      if (near > bestDisp && near < 0.45) {
        bestDisp = near;
        launchBlob = b;
        launchFrom = from;
      }
    }
    if (launchBlob) {
      activeRef.current = true;
      ptsRef.current = launchFrom
        ? [launchFrom, { x: launchBlob.x, y: launchBlob.y }]
        : [{ x: launchBlob.x, y: launchBlob.y }];
      velRef.current = launchFrom
        ? { x: launchBlob.x - launchFrom.x, y: launchBlob.y - launchFrom.y }
        : { x: 0, y: 0 };
      lastSeenRef.current = now;
      startMsRef.current = now;
      setTracking(true);
    }
    prevBlobsRef.current = moving;
  }

  function finalize() {
    activeRef.current = false;
    prevBlobsRef.current = [];
    setTracking(false);
    const pts = ptsRef.current.slice();
    ptsRef.current = [];
    if (pts.length < 4) return; // too few points to be a real ball flight
    // Curvature: signed horizontal deviation of the apex from the launch→end line.
    const a = pts[0];
    const b = pts[pts.length - 1];
    let maxDev = 0;
    for (const p of pts) {
      const t = b.x - a.x !== 0 ? (p.x - a.x) / (b.x - a.x) : 0;
      const lineX = a.x + (b.x - a.x) * t;
      const dev = p.x - lineX;
      if (Math.abs(dev) > Math.abs(maxDev)) maxDev = dev;
    }
    const shape = classifyShape(maxDev);
    const est = estimateBall(clubRef.current, headSpeed);
    setResult({ shape, apex: est.apex, carry: est.carry, ballSpeed: est.ballSpeed, smash: est.smash, pts });
    if (navigator.vibrate) navigator.vibrate(20);
    saveBallShot({
      club: clubRef.current,
      shape,
      apex_m: est.apex,
      carry_m: est.carry,
      ball_speed: est.ballSpeed,
      head_speed: est.headSpeed,
      smash: est.smash,
      curve_px: Math.round(maxDev * 1000) / 1000,
    }).then(() => onSaved());
  }

  function drawTracer(ctx: CanvasRenderingContext2D, w: number, h: number, pts: Pt[]) {
    const col = result ? shapeColor(result.shape) : "#22d3ee";
    ctx.save();
    ctx.shadowBlur = Math.max(8, w / 90);
    ctx.shadowColor = col;
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(3, w / 180);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x * w, pts[0].y * h);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * w, pts[i].y * h);
    ctx.stroke();
    // apex tag
    let apexI = 0;
    pts.forEach((p, i) => {
      if (p.y < pts[apexI].y) apexI = i;
    });
    const ap = pts[apexI];
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ap.x * w, ap.y * h, Math.max(4, w / 150), 0, Math.PI * 2);
    ctx.fill();
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
                  飛球線の後方から、ボールと打ち出し方向が<br />
                  両方映るようにカメラを固定してください。<br />
                  打つと弾道を自動で検知・描画します（屋外OK）。
                </p>
              </div>
            </div>
          )}
          {camOn && (
            <div className="absolute top-2 left-2 px-3 py-1 rounded-full text-xs font-bold"
              style={{ background: "rgba(0,0,0,0.6)", color: tracking ? "#4ade80" : "#fff" }}>
              {tracking ? "● 弾道を追跡中…" : "○ 監視中 — 打ってください"}
            </div>
          )}
          {camOn && (
            <button onClick={stopCam} className="absolute top-2 right-2 btn btn-ghost text-xs px-3 py-1.5">
              停止
            </button>
          )}
          {result && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full text-sm font-bold flex items-center gap-2"
              style={{ background: shapeColor(result.shape), color: "#04121f" }}>
              {shapeLabel(result.shape)} ・ Peak {result.apex}m
            </div>
          )}
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs" style={{ color: "var(--muted)" }}>クラブ</span>
            <select value={club} onChange={(e) => setClub(e.target.value)} className="w-full px-3 py-2.5 mt-1">
              {CLUBS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs" style={{ color: "var(--muted)" }}>ヘッドスピード (m/s)</span>
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
          スイング解析で計測したヘッドスピードを自動反映。空欄ならクラブ標準値（{live.headSpeed}m/s）で推定します。
        </p>
      </Card>

      {!camOn ? (
        <button onClick={startCam} className="btn btn-primary w-full py-3.5">
          📷 カメラを起動して計測
        </button>
      ) : null}

      {result && (
        <>
          <div className="grid grid-cols-4 gap-2">
            <Stat label="球筋" value={shapeLabel(result.shape)} accent={shapeColor(result.shape)} />
            <Stat label="最高到達点" value={result.apex} unit="m" accent="var(--cyan)" />
            <Stat label="推定キャリー" value={result.carry} unit="m" accent="var(--green)" />
            <Stat label="ミート率" value={result.smash.toFixed(2)} accent="#fbbf24" />
          </div>
          <Replay3D shape={result.shape} apex={result.apex} carry={result.carry} />
          <Card>
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              推定初速 {result.ballSpeed} m/s ・ ヘッドスピード {live.headSpeed} m/s（{clubLabel(club)}）
            </div>
          </Card>
        </>
      )}

      <p className="text-[11px] leading-relaxed px-1" style={{ color: "var(--muted)" }}>
        ※ ボールの色は問いません。打ち出された「小さく速く動く物体」を弾道として追跡し、球筋（ストレート/ドロー/フェード/スライス/フック）を判定します。
        カメラは三脚等で固定すると精度が上がります（手ブレ・強風で背景が大きく動くと検知しにくくなります）。
        飛距離・最高到達点・初速・ミート率は、クラブとヘッドスピードからの物理推定値です（クラブ非検出のためβ）。
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
        ctx.fillText(`最高到達点 ${apex}m`, ap.x, ap.y - 8);
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
  }, [shape, apex, carry, nonce]);

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-bold">🎬 3Dズーム・リプレイ</div>
        <button onClick={() => setNonce((n) => n + 1)} className="btn btn-ghost text-xs px-3 py-1">
          🔄 もう一度
        </button>
      </div>
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--line)" }}>
        <canvas ref={canvasRef} width={340} height={300} className="w-full block" />
      </div>
      <p className="text-[10px] mt-2" style={{ color: "var(--muted)" }}>
        仮想カメラが打席後方→上空→ピン側へ回り込み、推定した3D弾道（放物線・着弾・転がり）を再現します。
        弾道は計測した球筋とクラブ推定値からの再構成です（β）。
      </p>
    </Card>
  );
}

function Matrix({ shots }: { shots: BallShot[] }) {
  const byClub = CLUBS.map((c) => {
    const list = shots.filter((s) => s.club === c.id);
    return { club: c, list };
  }).filter((g) => g.list.length > 0);

  if (shots.length === 0) {
    return (
      <Card className="text-center py-10 text-sm" style={{ color: "var(--muted)" }}>
        まだ弾道データがありません。<br />「トレーサー」で計測すると分布図が作られます。
      </Card>
    );
  }

  const palette = ["#ef4444", "#f59e0b", "#22c55e", "#22d3ee", "#3b82f6", "#a78bfa", "#ec4899", "#84cc16"];
  const data = byClub.map((g, i) => ({
    name: g.club.label,
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
      insight = `${sorted[i - 1].name}と${sorted[i].name}のキャリーが近接（${sorted[i - 1].avgCarry}m / ${sorted[i].avgCarry}m）。番手が機能していない可能性があります。`;
      break;
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
          クラブ・マトリクス（キャリー × 最高到達点）
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <ScatterChart margin={{ top: 10, right: 12, bottom: 16, left: -8 }}>
            <XAxis
              type="number"
              dataKey="x"
              name="キャリー"
              unit="m"
              tick={{ fill: "#93a4bf", fontSize: 10 }}
              axisLine={{ stroke: "#243651" }}
              tickLine={false}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="高さ"
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
            <span style={{ color: "var(--amber)" }}>📐 フィッティング示唆：</span> {insight}
          </div>
        </Card>
      )}

      <Card>
        <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>クラブ別 平均</div>
        <div className="space-y-1.5 text-sm">
          {data.map((d) => (
            <div key={d.name} className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                {d.name}
              </span>
              <span style={{ color: "var(--muted)" }}>
                {d.avgCarry}m ・ 高さ{d.avgApex}m ・ {d.points.length}球
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
