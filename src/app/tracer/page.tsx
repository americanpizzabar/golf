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
  const armedRef = useRef(false);
  const activeRef = useRef(false);
  const ptsRef = useRef<Pt[]>([]);
  const lastSeenRef = useRef(0);
  const startMsRef = useRef(0);

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
      c.width = 128;
      c.height = 96;
      diffRef.current = c;
    }
    prevRef.current = null;
    setResult(null);
    setCamOn(true);
    rafRef.current = requestAnimationFrame(loop);
  }

  function stopCam() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    cancelAnimationFrame(rafRef.current);
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

  function detectStep(cur: Uint8ClampedArray, prev: Uint8ClampedArray, w: number, h: number, now: number) {
    let sx = 0;
    let sy = 0;
    let cnt = 0;
    // Weight toward bright (the ball) moving pixels.
    for (let i = 0; i < cur.length; i += 4) {
      const d = Math.abs(cur[i] - prev[i]) + Math.abs(cur[i + 1] - prev[i + 1]) + Math.abs(cur[i + 2] - prev[i + 2]);
      const bright = cur[i] + cur[i + 1] + cur[i + 2];
      if (d > 70 && bright > 360) {
        const px = (i / 4) % w;
        const py = Math.floor(i / 4 / w);
        sx += px;
        sy += py;
        cnt++;
      }
    }
    const motion = cnt;
    if (motion >= 2 && motion < 400) {
      const cx = sx / cnt / w;
      const cy = sy / cnt / h;
      if (!activeRef.current) {
        // start a shot only after a quiet/armed period
        if (armedRef.current) {
          activeRef.current = true;
          ptsRef.current = [{ x: cx, y: cy }];
          startMsRef.current = now;
        }
      } else {
        const last = ptsRef.current[ptsRef.current.length - 1];
        if (!last || Math.hypot(cx - last.x, cy - last.y) > 0.01) {
          ptsRef.current.push({ x: cx, y: cy });
        }
      }
      lastSeenRef.current = now;
      armedRef.current = true;
    } else if (motion < 2) {
      armedRef.current = true; // quiet → armed
      if (activeRef.current && now - lastSeenRef.current > 250) {
        finalize();
      }
    }
    if (activeRef.current && now - startMsRef.current > 2500) finalize();
  }

  function finalize() {
    activeRef.current = false;
    const pts = ptsRef.current.slice();
    ptsRef.current = [];
    if (pts.length < 4) return;
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
                  打席の後方からボールと打ち出し方向が<br />映るようにカメラを構えます
                </p>
              </div>
            </div>
          )}
          {camOn && (
            <div className="absolute top-2 left-2 px-3 py-1 rounded-full text-xs font-bold"
              style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}>
              ● 監視中… ショットを自動検知
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
        ※ 球筋（ストレート/ドロー/フェード/スライス/フック）はカメラ映像の背景差分で軌跡を追って判定します。
        飛距離・最高到達点・初速・ミート率は、クラブとヘッドスピードからの物理推定値です（クラブ非検出のためβ）。
        端末負荷軽減のため軽量な検知で動作します。
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
