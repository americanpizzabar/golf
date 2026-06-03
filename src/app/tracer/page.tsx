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

// Find golf-ball-like blobs: small, bright-WHITE (low saturation), roundish.
// requireMotion=true also requires the region to have changed since prev frame
// (the ball in flight); false also returns the resting ball at address.
function findBallBlobs(
  cur: Uint8ClampedArray,
  prev: Uint8ClampedArray,
  w: number,
  h: number,
  requireMotion: boolean,
): Blob[] {
  const n = w * h;
  const mask = new Uint8Array(n); // 1 = white candidate, 2 = white & moved
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = cur[i];
    const g = cur[i + 1];
    const b = cur[i + 2];
    const mn = Math.min(r, g, b);
    const mx = Math.max(r, g, b);
    const white = mn > 140 && mx - mn < 55; // bright + low saturation
    if (!white) continue;
    const moved =
      Math.abs(r - prev[i]) + Math.abs(g - prev[i + 1]) + Math.abs(b - prev[i + 2]) > 55;
    if (requireMotion && !moved) continue;
    mask[p] = moved ? 2 : 1;
  }

  const BALL_MIN = 2;
  const BALL_MAX = requireMotion ? 260 : 110; // flight streaks can be larger
  const minFill = requireMotion ? 0.25 : 0.42;
  const blobs: Blob[] = [];
  const stack = new Int32Array(n);
  const seen = new Uint8Array(n);
  for (let start = 0; start < n; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let count = 0;
    let movedCnt = 0;
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
      if (mask[p] === 2) movedCnt++;
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
    if (aspect < 0.33 || aspect > 3) continue;
    const fill = count / (bw * bh);
    if (fill < minFill) continue;
    blobs.push({
      x: sumX / count / w,
      y: sumY / count / h,
      size: count,
      // Prefer round & compact, lightly penalize larger blobs.
      score: fill - count / (BALL_MAX * 2),
      moved: movedCnt / count > 0.5,
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
  const restRef = useRef<Pt | null>(null); // resting (address) ball position
  const lastMovingRef = useRef<Pt | null>(null);
  const lastSeenRef = useRef(0);
  const startMsRef = useRef(0);
  const ballReadyRef = useRef(false);
  const [ballReady, setBallReady] = useState(false);

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
    restRef.current = null;
    lastMovingRef.current = null;
    setResult(null);
    setCamOn(true);
    rafRef.current = requestAnimationFrame(loop);
  }

  function stopCam() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    cancelAnimationFrame(rafRef.current);
    setReady(false);
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

  function setReady(v: boolean) {
    if (ballReadyRef.current !== v) {
      ballReadyRef.current = v;
      setBallReady(v);
    }
  }

  function detectStep(cur: Uint8ClampedArray, prev: Uint8ClampedArray, w: number, h: number, now: number) {
    // Only the golf ball: small, bright-WHITE (low saturation), roundish blobs.
    const moving = findBallBlobs(cur, prev, w, h, true); // white + just moved
    const still = findBallBlobs(cur, prev, w, h, false); // white (incl. at rest)

    if (activeRef.current) {
      // Track the ball: pick the moving white blob nearest the predicted spot.
      const last = ptsRef.current[ptsRef.current.length - 1];
      const pred = { x: last.x + velRef.current.x, y: last.y + velRef.current.y };
      let best: Blob | null = null;
      let bd = 0.32; // search gate (normalized)
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
      if (now - lastSeenRef.current > 200 || now - startMsRef.current > 2500) finalize();
      return;
    }

    // Idle: keep a lock on the resting ball, and watch for it launching.
    const rest = restRef.current;
    const bestMoving = moving[0] ?? null;

    if (rest && bestMoving) {
      // The ball took off: a white blob appears clearly away from address.
      const d = Math.hypot(bestMoving.x - rest.x, bestMoving.y - rest.y);
      if (d > 0.05) {
        activeRef.current = true;
        ptsRef.current = [rest, { x: bestMoving.x, y: bestMoving.y }];
        velRef.current = { x: bestMoving.x - rest.x, y: bestMoving.y - rest.y };
        lastSeenRef.current = now;
        startMsRef.current = now;
        return;
      }
    } else if (!rest && bestMoving && lastMovingRef.current) {
      // Fallback (no clear address lock): catch a fast white blob in flight.
      const d = Math.hypot(bestMoving.x - lastMovingRef.current.x, bestMoving.y - lastMovingRef.current.y);
      if (d > 0.04 && d < 0.4) {
        activeRef.current = true;
        ptsRef.current = [lastMovingRef.current, { x: bestMoving.x, y: bestMoving.y }];
        velRef.current = { x: bestMoving.x - lastMovingRef.current.x, y: bestMoving.y - lastMovingRef.current.y };
        lastSeenRef.current = now;
        startMsRef.current = now;
        return;
      }
    }
    lastMovingRef.current = bestMoving ? { x: bestMoving.x, y: bestMoving.y } : null;

    // Update the resting-ball lock from the most ball-like stationary white blob
    // in the lower part of the frame (where a teed/grounded ball sits).
    const restCand = still.find((b) => b.y > 0.3 && !b.moved);
    if (restCand) {
      restRef.current = { x: restCand.x, y: restCand.y };
      setReady(true);
    } else if (!still.some((b) => b.y > 0.3)) {
      setReady(false);
    }
  }

  function finalize() {
    activeRef.current = false;
    restRef.current = null;
    lastMovingRef.current = null;
    setReady(false);
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
                  白いゴルフボールが画面にはっきり映るように<br />
                  後方からカメラを構えてください。<br />
                  ボールを捕捉すると自動で計測します。
                </p>
              </div>
            </div>
          )}
          {camOn && (
            <div className="absolute top-2 left-2 px-3 py-1 rounded-full text-xs font-bold"
              style={{ background: "rgba(0,0,0,0.6)", color: ballReady ? "#4ade80" : "#fff" }}>
              {ballReady ? "● ボール捕捉 — 打ってOK" : "○ ボールを探しています…"}
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
          <Card>
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              推定初速 {result.ballSpeed} m/s ・ ヘッドスピード {live.headSpeed} m/s（{clubLabel(club)}）
            </div>
          </Card>
        </>
      )}

      <p className="text-[11px] leading-relaxed px-1" style={{ color: "var(--muted)" }}>
        ※ 白いゴルフボールのみを検出して軌跡を追跡し、球筋（ストレート/ドロー/フェード/スライス/フック）を判定します。
        明るい白色・小さく丸い被写体をボールとみなすため、白い服や白背景が多いと精度が下がります。
        飛距離・最高到達点・初速・ミート率は、クラブとヘッドスピードからの物理推定値です（クラブ非検出のためβ）。
      </p>
    </div>
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
